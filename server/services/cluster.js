/**
 * services/cluster.js
 * The one place that knows whether Dobby is running as one process or several.
 *
 * Everything Phase 4 added is optional and keyed on a single variable. With
 * `REDIS_URL` unset the server behaves exactly as it did through Phase 3:
 * in-process room membership, in-process quotas, documents served by whoever
 * you connected to. With it set, the same code paths reach a shared store
 * instead.
 *
 * It fails **closed**. If `REDIS_URL` is set and Redis is unreachable, startup
 * throws rather than quietly continuing single-node — a replica that thinks it
 * is alone is precisely the split-brain this module exists to prevent, and it
 * would present as "the other person's edits sometimes don't arrive" rather
 * than as an outage.
 */

import { randomUUID } from 'crypto';
import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';

/** Namespace for every key this process writes, so Redis can be shared. */
export const KEY_PREFIX = process.env.REDIS_KEY_PREFIX || 'dobby';

export const key = (...parts) => [KEY_PREFIX, ...parts].join(':');

/**
 * Stable-ish identity for this process. `NODE_ID` when the orchestrator supplies
 * one (a pod name, a task id), otherwise a fresh uuid — which is correct rather
 * than merely convenient: a restarted process should not inherit the document
 * leases of the one it replaced.
 */
export const NODE_ID = process.env.NODE_ID || `node-${randomUUID().slice(0, 8)}`;

/**
 * The address other nodes and the load balancer can reach this process at.
 * Only used for diagnostics and for the routing hint returned when a client
 * lands on the wrong node for a document.
 */
export const NODE_ADDRESS = process.env.NODE_ADDRESS || null;

const REDIS_URL = process.env.REDIS_URL || '';

/** Whether this process is configured to participate in a cluster. */
export const CLUSTER_ENABLED = Boolean(REDIS_URL);

/**
 * Connect the three clients a clustered Dobby needs.
 *
 * The adapter requires a dedicated subscriber, because a client in subscriber
 * mode cannot issue ordinary commands — so the state store and the document
 * leases get the third one rather than sharing the pub/sub pair.
 *
 * @returns {Promise<{enabled: boolean, adapter: Function|null, redis: object|null, close: () => Promise<void>}>}
 */
export async function connectCluster() {
    if (!CLUSTER_ENABLED) {
        return { enabled: false, adapter: null, redis: null, async close() {} };
    }

    // reconnectStrategy caps the backoff so a Redis restart is recovered from
    // without the node hammering it, and never gives up: a node that stopped
    // retrying would be a silent single-node island for the rest of its life.
    const options = {
        url: REDIS_URL,
        socket: {
            reconnectStrategy: (retries) => Math.min(1000 * 2 ** Math.min(retries, 5), 30_000),
        },
    };

    const pubClient = createClient(options);
    const subClient = pubClient.duplicate();
    const commandClient = pubClient.duplicate();

    // Without a listener, node-redis emits `error` as an unhandled exception and
    // takes the process down on a transient blip.
    for (const [name, client] of [
        ['pub', pubClient],
        ['sub', subClient],
        ['cmd', commandClient],
    ]) {
        client.on('error', (error) => console.error(`[Cluster] Redis ${name} error:`, error.message));
    }

    try {
        await Promise.all([pubClient.connect(), subClient.connect(), commandClient.connect()]);
    } catch (error) {
        await Promise.allSettled([
            pubClient.destroy?.(),
            subClient.destroy?.(),
            commandClient.destroy?.(),
        ]);
        throw new Error(
            `REDIS_URL is set but Redis is unreachable (${error.message}). ` +
                'Refusing to start single-node: replicas would not share room membership.'
        );
    }

    console.log(`✓ Cluster mode: node ${NODE_ID} attached to Redis`);

    return {
        enabled: true,
        adapter: createAdapter(pubClient, subClient, { key: key('io') }),
        redis: commandClient,
        async close() {
            await Promise.allSettled([
                pubClient.quit(),
                subClient.quit(),
                commandClient.quit(),
            ]);
        },
    };
}
