/**
 * services/documentRouter.js
 * Which node is allowed to serve a given Yjs document.
 *
 * The Redis adapter makes Socket.IO rooms cluster-wide, and that is enough for
 * chat, the client list, and WebRTC signalling — they are relayed messages, and
 * relaying them through Redis is exactly what the adapter does. It is **not**
 * enough for Yjs. `YSocketIO` keeps a live `Y.Doc` in the process serving it and
 * writes it to that process's LevelDB directory. Two nodes each holding a copy
 * of the same document would each apply only the updates their own clients
 * sent, and each persist their own divergent state; the last one to write wins
 * whatever the other person typed. Broadcasting harder does not fix that,
 * because the document is state, not a message.
 *
 * So documents are routed rather than replicated: **exactly one node owns a
 * document at a time.** That has two halves.
 *
 *  1. *The load balancer sends the right client to the right node.* The client
 *     appends `?doc=<roomId>:<fileId>` to its Yjs connection, so an ordinary
 *     hash-balancing rule (`hash $arg_doc consistent` in nginx) puts every
 *     client of one document on one node without the proxy needing to parse the
 *     Socket.IO payload. See `deploy/nginx.conf`.
 *  2. *The node checks that it really is the right one.* Routing is a
 *     configuration, and configurations are wrong sometimes — during a rescale,
 *     with a stale upstream list, or when someone forgets the rule entirely.
 *     Before serving a document a node takes a short lease on it in Redis. A
 *     node that finds the lease held elsewhere refuses the connection and names
 *     the owner.
 *
 * The second half is the point. Without it a misrouted client is silently
 * served a second copy of the document and the two people quietly lose each
 * other's work; with it they get a connection error naming the node that should
 * have had them. A loud failure is recoverable — the client retries, and a
 * correctly configured balancer never produces one. Silent divergence is not.
 *
 * Leases are short and renewed on a heartbeat rather than held for the life of
 * the connection, so a node that crashes releases its documents by expiry
 * instead of stranding them until an operator intervenes.
 */

import { NODE_ID, NODE_ADDRESS, key } from './cluster.js';

/** How long a lease survives without a heartbeat. */
const LEASE_TTL_MS = Number(process.env.DOCUMENT_LEASE_TTL_MS || 30_000);

/**
 * Renewals are deliberately frequent relative to the TTL: two heartbeats can be
 * missed — a GC pause, a Redis blip — before a live document's lease lapses and
 * another node could claim it.
 *
 * Derived from the TTL in use rather than from the module default, so a router
 * built with a shorter lease actually heartbeats faster. The two numbers are one
 * decision and must not be able to drift apart.
 */
const heartbeatFor = (ttlMs) => Math.max(50, Math.floor(ttlMs / 3));

const leaseKey = (docName) => key('doc', docName, 'owner');

/** `nodeId|address`; the address half is a hint for the client, and may be empty. */
const selfValue = () => `${NODE_ID}|${NODE_ADDRESS ?? ''}`;

const parseOwner = (value) => {
    if (!value) return null;
    const [id, address] = String(value).split('|');
    return { nodeId: id, address: address || null };
};

// Release and renew are compare-and-act: a node must never drop or extend a
// lease that has already passed to someone else, which a bare DEL/PEXPIRE
// would do if the lease expired between our read and our write.
const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0`;

const RENEW_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0`;

/**
 * Single-node router. Every claim succeeds, because there is nobody to conflict
 * with — one process serving every document is the Phase 3 deployment, and it
 * was always correct for one process.
 */
function standaloneRouter() {
    return {
        enabled: false,
        async claim() {
            return { ok: true, owner: { nodeId: NODE_ID, address: NODE_ADDRESS } };
        },
        async release() {},
        async ownerOf() {
            return { nodeId: NODE_ID, address: NODE_ADDRESS };
        },
        held() {
            return [];
        },
        start() {},
        async close() {},
    };
}

function clusteredRouter(redis, ttlMs) {
    /** Documents this node currently believes it owns, kept alive by the heartbeat. */
    const held = new Set();
    let heartbeat = null;

    async function renewAll() {
        for (const docName of [...held]) {
            try {
                const renewed = await redis.eval(RENEW_SCRIPT, {
                    keys: [leaseKey(docName)],
                    arguments: [selfValue(), String(ttlMs)],
                });
                // A lost lease means another node has taken the document —
                // almost always because this one was unreachable long enough to
                // expire. Dropping it from the set stops us renewing a lease we
                // do not hold; the connections are closed by whoever notices
                // next, and the client reconnects onto the new owner.
                if (!renewed) {
                    held.delete(docName);
                    console.warn(`[Router] Lost the lease on ${docName}`);
                }
            } catch (error) {
                console.error(`[Router] Renew failed for ${docName}:`, error.message);
            }
        }
    }

    return {
        enabled: true,

        /**
         * Take (or confirm) ownership of a document.
         *
         * @returns {Promise<{ok: boolean, owner: {nodeId: string, address: string|null}|null}>}
         */
        async claim(docName) {
            const value = selfValue();
            const acquired = await redis.set(leaseKey(docName), value, { NX: true, PX: ttlMs });

            if (acquired) {
                held.add(docName);
                return { ok: true, owner: parseOwner(value) };
            }

            const current = await redis.get(leaseKey(docName));
            const owner = parseOwner(current);

            // Already ours: a second client for a document we are serving, which
            // is the common case. Renew rather than re-acquire.
            if (owner?.nodeId === NODE_ID) {
                held.add(docName);
                await redis.pExpire(leaseKey(docName), ttlMs);
                return { ok: true, owner };
            }

            // The lease vanished between the SET and the GET — it expired. Retry
            // once; a second miss means genuine contention and the caller should
            // be told to go elsewhere.
            if (!owner) {
                const retry = await redis.set(leaseKey(docName), value, { NX: true, PX: ttlMs });
                if (retry) {
                    held.add(docName);
                    return { ok: true, owner: parseOwner(value) };
                }
            }

            return { ok: false, owner };
        },

        async release(docName) {
            held.delete(docName);
            try {
                await redis.eval(RELEASE_SCRIPT, {
                    keys: [leaseKey(docName)],
                    arguments: [selfValue()],
                });
            } catch (error) {
                console.error(`[Router] Release failed for ${docName}:`, error.message);
            }
        },

        async ownerOf(docName) {
            return parseOwner(await redis.get(leaseKey(docName)));
        },

        held() {
            return [...held];
        },

        start() {
            if (heartbeat) return;
            heartbeat = setInterval(renewAll, heartbeatFor(ttlMs));
            heartbeat.unref?.();
        },

        async close() {
            if (heartbeat) clearInterval(heartbeat);
            heartbeat = null;
            // Hand the documents back immediately on a clean shutdown rather
            // than making the next owner wait out the TTL.
            await Promise.allSettled([...held].map((docName) => this.release(docName)));
        },
    };
}

/**
 * @param {object} [options]
 * @param {object|null} [options.redis]
 * @param {number} [options.ttlMs]
 */
export function createDocumentRouter({ redis = null, ttlMs = LEASE_TTL_MS } = {}) {
    return redis ? clusteredRouter(redis, ttlMs) : standaloneRouter();
}

export { LEASE_TTL_MS, heartbeatFor };
