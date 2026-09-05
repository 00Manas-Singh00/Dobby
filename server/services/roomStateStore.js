/**
 * services/roomStateStore.js
 * The last piece of per-room state that was still a plain object in `index.js`.
 *
 * Phase 3 moved chat into SQLite and the whiteboard into Yjs. What remained was
 * `roomID_to_State_Map` — the selected language — plus a `Map` of timers to
 * expire it. Both were process-local, so on two replicas one person's language
 * change would reach the other only if they happened to be served by the same
 * node.
 *
 * The store presents one async interface over two backends:
 *
 *  - **memory** (no `REDIS_URL`): a plain object with `setTimeout` expiry.
 *    Byte-for-byte the Phase 3 behaviour, kept so the single-node deployment
 *    gains no dependency.
 *  - **redis**: a hash per room with a TTL. `retain` clears the TTL while
 *    anyone is connected anywhere in the cluster; `release` re-arms it.
 *
 * Expiry is modelled as retain/release rather than as "delete N minutes after
 * the last leave" because with several nodes there is no single process that
 * knows the room emptied. Anyone joining, on any node, persists the key; the
 * last leave anywhere re-arms the TTL, and a join before it fires cancels it.
 */

import { key } from './cluster.js';

const DEFAULT_TTL_MS = Number(process.env.ROOM_STATE_TTL_MS || 30 * 60 * 1000);

const roomKey = (roomId) => key('room', roomId, 'state');

/** In-process backend. Identical semantics, no shared store. */
function memoryBackend(ttlMs) {
    const state = new Map(); // roomId -> { languageUsed }
    const timers = new Map(); // roomId -> timeout

    const cancel = (roomId) => {
        const timer = timers.get(roomId);
        if (timer) {
            clearTimeout(timer);
            timers.delete(roomId);
        }
    };

    return {
        backend: 'memory',
        async get(roomId) {
            return state.get(roomId) ?? null;
        },
        async setLanguage(roomId, languageUsed) {
            state.set(roomId, { ...(state.get(roomId) ?? {}), languageUsed });
        },
        async retain(roomId) {
            cancel(roomId);
        },
        async release(roomId) {
            cancel(roomId);
            const timer = setTimeout(() => {
                state.delete(roomId);
                timers.delete(roomId);
                console.log(`[Room] Expired state for inactive room ${roomId}`);
            }, ttlMs);
            // An expiry timer must not be the reason the process stays alive.
            timer.unref?.();
            timers.set(roomId, timer);
        },
        async clear(roomId) {
            cancel(roomId);
            state.delete(roomId);
        },
        async close() {
            for (const timer of timers.values()) clearTimeout(timer);
            timers.clear();
            state.clear();
        },
    };
}

/** Shared backend. One hash per room, TTL armed only while the room is empty. */
function redisBackend(redis, ttlMs) {
    const ttlSeconds = Math.max(1, Math.round(ttlMs / 1000));

    return {
        backend: 'redis',
        async get(roomId) {
            const hash = await redis.hGetAll(roomKey(roomId));
            // node-redis returns {} for a missing key, so emptiness is the test
            // for existence rather than a null check.
            return Object.keys(hash).length > 0 ? hash : null;
        },
        async setLanguage(roomId, languageUsed) {
            await redis.hSet(roomKey(roomId), 'languageUsed', languageUsed);
            // A language change is itself activity: without this, a key written
            // while a TTL was armed would still expire on the old schedule.
            await redis.persist(roomKey(roomId));
        },
        async retain(roomId) {
            await redis.persist(roomKey(roomId));
        },
        async release(roomId) {
            await redis.expire(roomKey(roomId), ttlSeconds);
        },
        async clear(roomId) {
            await redis.del(roomKey(roomId));
        },
        async close() {},
    };
}

/**
 * @param {object} [options]
 * @param {object|null} [options.redis] connected client, or null for in-process
 * @param {number} [options.ttlMs]
 */
export function createRoomStateStore({ redis = null, ttlMs = DEFAULT_TTL_MS } = {}) {
    return redis ? redisBackend(redis, ttlMs) : memoryBackend(ttlMs);
}
