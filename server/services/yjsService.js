/**
 * services/yjsService.js
 * Manages Yjs document state per room using y-socket.io.
 * Provides conflict-free, real-time collaborative editing via CRDT.
 *
 * Beyond transport, this module owns two things the rest of the server relies
 * on:
 *  1. Authorization for document namespaces. Yjs rides its own dynamic
 *     namespaces (`/yjs|<roomId>:<fileId>`), which do NOT pass through the main
 *     Socket.IO connection middleware. Without the check below, an
 *     authenticated user could open any room's document by naming it.
 *  2. Retention. Document state is the one thing Dobby persists to disk, so the
 *     delete path and the expiry sweep live here.
 *  3. Single-owner routing. A `Y.Doc` is state held in one process, not a
 *     message that can be broadcast, so it cannot simply be replicated across
 *     replicas the way the Redis adapter replicates chat. The namespace check
 *     therefore also takes a lease on the document before serving it — see
 *     `documentRouter.js` for why that is the shape of the answer.
 */

import { createRequire } from 'module';
import { isMember } from './roomService.js';
import { verifyAccessToken } from './authService.js';
import { createDocumentRouter } from './documentRouter.js';
import { createRedisDocumentPersistence } from './yjsRedisPersistence.js';
import { documentLeaseConflicts } from './metrics.js';

const require = createRequire(import.meta.url);
const { YSocketIO } = require('y-socket.io/dist/server');
// Required rather than imported, deliberately. y-socket.io and y-leveldb are
// CommonJS and pull Yjs in through `require`; an ESM `import` of the same
// package is a *second* module instance, and Yjs's constructor checks are
// identity-based — two copies make `instanceof` fail on documents that came
// from the other one. Sharing their instance is the only way to hand a live
// y-socket.io document to our own encode/apply calls.
const Y = require('yjs');

// LevelDB takes an exclusive lock on its directory, so two servers in one
// process cannot share it. Setting YJS_PERSISTENCE_DIR to an empty string runs
// the CRDT entirely in memory, which is what the integration tests want.
const PERSISTENCE_DIR =
    process.env.YJS_PERSISTENCE_DIR === ''
        ? null
        : process.env.YJS_PERSISTENCE_DIR || './.yjs-persistence';

let ysocketio = null;
let documentRouter = createDocumentRouter();

/**
 * Document names are `<roomId>:<fileId>`. The room id is the part that carries
 * authorization; the file id only scopes the document within it.
 */
function roomIdFromDocName(docName) {
    const [roomId] = docName.split(':');
    return roomId || null;
}

/** Namespace names are `/yjs|<docName>`. */
function docNameFromNamespace(namespaceName) {
    return namespaceName.replace(/^\/yjs\|/, '');
}

/**
 * Set up the Yjs provider on the existing Socket.IO server.
 *
 * @param {import('socket.io').Server} io - The Socket.IO server instance
 * @param {object} [options]
 * @param {object|null} [options.redis] connected client; enables document leases
 */
export function setupYjs(io, { redis = null } = {}) {
    documentRouter = createDocumentRouter({ redis });
    documentRouter.start();

    // In cluster mode LevelDB is not merely suboptimal, it is wrong: it takes
    // an exclusive lock on its directory, so two replicas cannot share one, and
    // a document's state would live on whichever node's disk happened to serve
    // it first. Redis is the shared store that lets the lease actually move a
    // document between nodes rather than only pinning it to one.
    ysocketio = new YSocketIO(io, {
        ...(!redis && PERSISTENCE_DIR ? { levelPersistenceDir: PERSISTENCE_DIR } : {}),
        gcEnabled: true,
    });
    ysocketio.initialize();

    if (redis) {
        // Assigned after the constructor rather than passed in, because
        // y-socket.io only exposes `levelPersistenceDir`. `initDocument` reads
        // `this.persistence` on every open, so setting it here — before any
        // connection is served — is picked up for every document.
        ysocketio.persistence = createRedisDocumentPersistence(redis, Y);
    }

    // Registered after initialize() so it runs alongside y-socket.io's own
    // handshake hook. Middleware added to a parent (dynamic) namespace is
    // copied onto each child namespace as it is created, so this applies to
    // every document namespace including ones that do not exist yet.
    ysocketio.nsp.use(async (socket, next) => {
        const token =
            socket.handshake.auth?.token ||
            (socket.handshake.headers?.authorization || '').replace(/^Bearer /, '');

        if (!token) return next(new Error('Authentication required.'));

        let user;
        try {
            user = await verifyAccessToken(token);
        } catch (error) {
            return next(new Error(error.message));
        }

        // The room is taken from the namespace the client actually connected
        // to, never from the handshake payload — otherwise a client could
        // present a room it belongs to while opening a document from another.
        const roomId = roomIdFromDocName(docNameFromNamespace(socket.nsp.name));
        if (!roomId) return next(new Error('Malformed document name.'));

        if (!(await isMember(roomId, user.id))) {
            console.warn(
                `[Yjs] Rejected ${user.username} (${user.id}) for document in room ${roomId}`
            );
            return next(new Error('Not a member of this room.'));
        }

        // Ownership last, and only once the caller is known to belong here: a
        // lease is a scarce resource, and taking one for a request that was
        // going to be rejected anyway would let a non-member evict the document
        // from the node legitimately serving it.
        const docName = docNameFromNamespace(socket.nsp.name);
        let claim;
        try {
            claim = await documentRouter.claim(docName);
        } catch (error) {
            // Redis is down. Refusing is the conservative answer: serving the
            // document unclaimed is how two nodes end up with divergent copies,
            // and that damage outlives the outage.
            console.error(`[Yjs] Lease check failed for ${docName}:`, error.message);
            return next(new Error('Document routing is unavailable. Retry shortly.'));
        }

        if (!claim.ok) {
            documentLeaseConflicts.inc();
            console.warn(
                `[Yjs] ${docName} is owned by ${claim.owner?.nodeId ?? 'another node'}; refusing`
            );
            // The message carries the owner so the failure is diagnosable from
            // the browser console rather than only from server logs. The client
            // reconnects, and a correctly configured balancer lands it on the
            // owner; a misconfigured one produces this repeatedly, which is
            // exactly the signal `dobby_document_lease_conflicts_total` alerts
            // on.
            const error = new Error('This document is served by another node. Reconnecting.');
            error.data = { code: 'DOCUMENT_MOVED', owner: claim.owner };
            return next(error);
        }

        socket.data.user = user;
        socket.data.docName = docName;
        return next();
    });

    // A lease is held for as long as this node is actually serving the
    // document, and released when the last editor leaves — not on a timer.
    // Releasing eagerly is what lets a document move to another node during a
    // rescale without waiting out the TTL.
    ysocketio.nsp.on('connection', (socket) => {
        socket.on('disconnect', async () => {
            const docName = socket.data?.docName;
            if (!docName || !documentRouter.enabled) return;
            // `disconnect` fires before the socket leaves the namespace's set,
            // so this socket is still counted; 1 means it was the last one.
            if (socket.nsp.sockets.size > 1) return;
            await documentRouter.release(docName);
        });
    });

    const backend = redis ? 'Redis (shared)' : PERSISTENCE_DIR ? 'LevelDB' : 'memory, no persistence';
    console.log(`✓ Yjs CRDT service initialized — ${backend}, membership-gated`);
}

/** The underlying `LeveldbPersistence`, or null when persistence is disabled. */
function persistenceProvider() {
    return ysocketio?.persistence?.provider ?? null;
}

/**
 * Delete every stored document belonging to a room, and disconnect anyone
 * currently editing them. Called when a room is deleted and by the retention
 * sweep.
 *
 * @param {string} roomId
 * @returns {Promise<number>} number of documents removed
 */
export async function deleteRoomDocuments(roomId) {
    if (!ysocketio) return 0;

    // Destroy live documents first. Destroying (rather than deleting from the
    // map) is what closes the open connections; otherwise a connected client
    // would immediately re-persist the state we just cleared.
    for (const [name, doc] of [...ysocketio.documents.entries()]) {
        if (roomIdFromDocName(name) === roomId) {
            try {
                await doc.destroy();
            } catch (error) {
                console.error(`[Yjs] Failed to destroy document ${name}:`, error.message);
            }
        }
    }

    const provider = persistenceProvider();
    if (!provider) return 0;

    const names = await provider.getAllDocNames();
    const owned = names.filter((name) => roomIdFromDocName(name) === roomId);

    for (const name of owned) {
        await provider.clearDocument(name);
    }

    for (const name of owned) {
        await documentRouter.release(name);
    }

    if (owned.length > 0) {
        console.log(`[Yjs] Cleared ${owned.length} document(s) for room ${roomId}`);
    }
    return owned.length;
}

/**
 * Drop documents whose room no longer exists in SQLite.
 *
 * Document state previously accumulated on disk forever with no delete path.
 * This is the backstop for rooms deleted while the process was down, and for
 * documents orphaned by a partial delete.
 *
 * @param {(roomId: string) => boolean} roomExists
 * @returns {Promise<number>}
 */
export async function pruneOrphanedDocuments(roomExists) {
    const provider = persistenceProvider();
    if (!provider) return 0;

    const names = await provider.getAllDocNames();
    let removed = 0;

    for (const name of names) {
        const roomId = roomIdFromDocName(name);
        if (!roomId || (await roomExists(roomId))) continue;
        // Never clear a document that is currently open — its room row may be
        // mid-creation, and the live doc would rewrite the state anyway.
        if (ysocketio?.documents.has(name)) continue;

        await provider.clearDocument(name);
        removed += 1;
    }

    if (removed > 0) console.log(`[Yjs] Retention sweep cleared ${removed} orphaned document(s)`);
    return removed;
}

/** Names of every persisted document. Exposed for diagnostics and tests. */
export async function listDocumentNames() {
    const provider = persistenceProvider();
    return provider ? provider.getAllDocNames() : [];
}

/**
 * Live documents, name → `Y.Doc`. Drives the snapshot sweep.
 *
 * Returned as an iterable of entries rather than the map itself so callers
 * cannot mutate y-socket.io's registry.
 */
export function openDocuments() {
    return ysocketio ? [...ysocketio.documents.entries()] : [];
}

/** The live `Y.Doc` for a document name, or null when nobody has it open. */
export function getOpenDocument(docName) {
    return ysocketio?.documents.get(docName) ?? null;
}

/**
 * Run `fn` against a document whether or not anyone currently has it open.
 *
 * A live document is handed over directly: mutating it propagates to every
 * connected editor through the normal update path, which is what makes a
 * restore visible immediately. A document that is not open is loaded from
 * LevelDB, mutated, and written back — and it must be written back explicitly,
 * because nothing is observing it to persist the change.
 *
 * @param {string} docName
 * @param {(doc: import('yjs').Doc) => T} fn
 * @returns {Promise<T>}
 * @template T
 */
export async function withDocument(docName, fn) {
    const live = getOpenDocument(docName);
    if (live) return fn(live);

    const provider = persistenceProvider();

    // With persistence disabled — the test configuration, and any deployment
    // that has deliberately turned it off — a document nobody has open has no
    // state anywhere, so an empty document is its honest current value. The
    // write-back below is then a no-op because there is nowhere to write.
    const doc = provider ? await provider.getYDoc(docName) : new Y.Doc();
    try {
        // Awaited: `fn` became async when the snapshot store did, and storing
        // the state before it had finished mutating the document would persist
        // the state the caller was replacing.
        const result = await fn(doc);
        if (provider) await provider.storeUpdate(docName, Y.encodeStateAsUpdate(doc));
        return result;
    } finally {
        doc.destroy();
    }
}

/**
 * Delete one document's stored state and disconnect anyone editing it.
 *
 * The file-tree row is deleted by the caller; this is the content half, and it
 * mirrors `deleteRoomDocuments` for a single file rather than a whole room.
 */
export async function deleteDocument(docName) {
    if (!ysocketio) return false;

    const live = ysocketio.documents.get(docName);
    if (live) {
        try {
            await live.destroy();
        } catch (error) {
            console.error(`[Yjs] Failed to destroy document ${docName}:`, error.message);
        }
    }

    await documentRouter.release(docName);

    const provider = persistenceProvider();
    if (!provider) return Boolean(live);

    await provider.clearDocument(docName);
    return true;
}

/** Whether a document has stored state. Used by the snapshot prune. */
export async function documentExists(docName) {
    if (ysocketio?.documents.has(docName)) return true;
    const provider = persistenceProvider();
    if (!provider) return false;
    return (await provider.getAllDocNames()).includes(docName);
}

/**
 * Open documents with their encoded size, for the `dobby_yjs_document_bytes`
 * gauge. Encoding every document on each scrape is the honest way to measure
 * growth — Yjs exposes no cheaper size — so it is deliberately only done on
 * demand rather than on a timer.
 */
export function documentStats() {
    if (!ysocketio) return { count: 0, bytes: 0 };

    let bytes = 0;
    for (const doc of ysocketio.documents.values()) {
        try {
            bytes += Y.encodeStateAsUpdate(doc).byteLength;
        } catch {
            // A document mid-destroy can throw. It is about to be gone; a
            // scrape is not worth failing over it.
        }
    }
    return { count: ysocketio.documents.size, bytes };
}

/** The lease router, for diagnostics and for shutdown. */
export function getDocumentRouter() {
    return documentRouter;
}

/**
 * Close every open document, waiting for each to flush.
 *
 * Called during shutdown, and the ordering it enables is the whole point:
 * destroying a document disconnects its sockets (a broadcast, which in cluster
 * mode goes through Redis) and flushes its state (a write, also Redis). Letting
 * `io.close()` trigger that asynchronously and then quitting the Redis clients
 * produced an unhandled `ClientClosedError` and, worse, a document whose final
 * state was never written. Doing it here, awaited, means the connection is
 * still open for the work that needs it.
 */
export async function closeDocuments() {
    if (!ysocketio) return;

    for (const doc of [...ysocketio.documents.values()]) {
        try {
            await doc.destroy();
        } catch (error) {
            console.error(`[Yjs] Failed to close document ${doc.name}:`, error.message);
        }
    }
}
