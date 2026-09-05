/**
 * Room state store.
 *
 * The memory backend is tested against real timers with a very short TTL rather
 * than fake ones, because the property that matters — "a join before the TTL
 * fires cancels it" — is about the interaction of two timers and is exactly
 * what a mocked clock would paper over.
 *
 * The Redis backend is covered by a fake client that implements the six
 * commands it uses. That is enough to pin the semantics this module actually
 * depends on: `persist` clears an expiry, `expire` sets one, and `hGetAll`
 * returns `{}` rather than null for a missing key — the last of which is the
 * one that would silently break `get()` if node-redis ever changed it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRoomStateStore } from '../../services/roomStateStore.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('roomStateStore — memory backend', () => {
    let store;

    beforeEach(() => {
        store = createRoomStateStore({ ttlMs: 60 });
    });

    it('reports no state for a room nobody has touched', async () => {
        expect(await store.get('room-1')).toBeNull();
    });

    it('round-trips the selected language', async () => {
        await store.setLanguage('room-1', 'python');
        expect(await store.get('room-1')).toEqual({ languageUsed: 'python' });
    });

    it('keeps rooms separate', async () => {
        await store.setLanguage('room-1', 'python');
        await store.setLanguage('room-2', 'javascript');

        expect((await store.get('room-1')).languageUsed).toBe('python');
        expect((await store.get('room-2')).languageUsed).toBe('javascript');
    });

    it('expires state once the room is released', async () => {
        await store.setLanguage('room-1', 'python');
        await store.release('room-1');

        expect(await store.get('room-1')).not.toBeNull();
        await sleep(100);
        expect(await store.get('room-1')).toBeNull();
    });

    it('cancels a pending expiry when someone rejoins', async () => {
        await store.setLanguage('room-1', 'python');
        await store.release('room-1');
        await store.retain('room-1');

        await sleep(100);
        // This is the regression that matters: the old implementation scheduled
        // the delete and re-checked occupancy inside the timer, so the check and
        // the cancel were two different mechanisms.
        expect(await store.get('room-1')).toEqual({ languageUsed: 'python' });
    });

    it('re-arms the expiry on a second release rather than stacking timers', async () => {
        await store.setLanguage('room-1', 'python');
        await store.release('room-1');
        await sleep(40);
        await store.release('room-1');
        await sleep(40);

        // 80ms have passed against a 60ms TTL; only the second release counts.
        expect(await store.get('room-1')).not.toBeNull();
        await sleep(40);
        expect(await store.get('room-1')).toBeNull();
    });

    it('clears immediately when asked', async () => {
        await store.setLanguage('room-1', 'python');
        await store.clear('room-1');
        expect(await store.get('room-1')).toBeNull();
    });

    it('drops every pending timer on close', async () => {
        await store.setLanguage('room-1', 'python');
        await store.release('room-1');
        await store.close();
        expect(await store.get('room-1')).toBeNull();
    });
});

/** The subset of node-redis this module uses, with observable expiry state. */
function fakeRedis() {
    const hashes = new Map();
    const expiries = new Map();

    return {
        expiries,
        async hGetAll(key) {
            return Object.fromEntries(hashes.get(key) ?? []);
        },
        async hSet(key, field, value) {
            if (!hashes.has(key)) hashes.set(key, new Map());
            hashes.get(key).set(field, value);
        },
        async persist(key) {
            expiries.delete(key);
        },
        async expire(key, seconds) {
            expiries.set(key, seconds);
        },
        async del(key) {
            hashes.delete(key);
            expiries.delete(key);
        },
    };
}

describe('roomStateStore — redis backend', () => {
    let redis;
    let store;

    beforeEach(() => {
        redis = fakeRedis();
        store = createRoomStateStore({ redis, ttlMs: 30 * 60 * 1000 });
    });

    it('reads a missing key as no state, not as an empty object', async () => {
        expect(await store.get('room-1')).toBeNull();
    });

    it('round-trips the language through a hash', async () => {
        await store.setLanguage('room-1', 'python');
        expect(await store.get('room-1')).toEqual({ languageUsed: 'python' });
    });

    it('clears the expiry when the language changes', async () => {
        await store.release('room-1');
        expect(redis.expiries.size).toBe(1);

        // A language change is activity. Without the persist, a key written
        // while a TTL was armed would still expire on the old schedule and the
        // room would silently lose its language mid-session.
        await store.setLanguage('room-1', 'python');
        expect(redis.expiries.size).toBe(0);
    });

    it('arms a TTL on release and clears it on retain', async () => {
        await store.setLanguage('room-1', 'python');

        await store.release('room-1');
        expect([...redis.expiries.values()][0]).toBe(1800);

        await store.retain('room-1');
        expect(redis.expiries.size).toBe(0);
    });

    it('clears the key outright', async () => {
        await store.setLanguage('room-1', 'python');
        await store.clear('room-1');
        expect(await store.get('room-1')).toBeNull();
    });
});
