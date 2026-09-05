/**
 * Document leases.
 *
 * This is the piece that decides whether two replicas can quietly serve
 * divergent copies of one file, so the tests are written around the *failure*:
 * a second node claiming a document another node holds must be refused, and it
 * must be refused for the whole life of the lease and not just at the instant
 * of the race.
 *
 * The fake client implements SET NX PX, GET, PEXPIRE, and EVAL of the two
 * scripts, with expiry driven by an injectable clock — a real lapse would mean
 * a sleeping test, and lapse behaviour is precisely what needs asserting.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDocumentRouter } from '../../services/documentRouter.js';
import { NODE_ID } from '../../services/cluster.js';

/** Minimal Redis with time under test control. */
function fakeRedis(now = { value: 0 }) {
    const values = new Map(); // key -> { value, expiresAt }

    const live = (key) => {
        const entry = values.get(key);
        if (!entry) return null;
        if (entry.expiresAt !== null && entry.expiresAt <= now.value) {
            values.delete(key);
            return null;
        }
        return entry;
    };

    return {
        now,
        values,
        async set(key, value, options = {}) {
            if (options.NX && live(key)) return null;
            values.set(key, {
                value,
                expiresAt: options.PX ? now.value + options.PX : null,
            });
            return 'OK';
        },
        async get(key) {
            return live(key)?.value ?? null;
        },
        async pExpire(key, ms) {
            const entry = live(key);
            if (!entry) return 0;
            entry.expiresAt = now.value + ms;
            return 1;
        },
        async eval(script, { keys, arguments: args }) {
            const entry = live(keys[0]);
            if (!entry || entry.value !== args[0]) return 0;
            if (script.includes('del')) {
                values.delete(keys[0]);
                return 1;
            }
            entry.expiresAt = now.value + Number(args[1]);
            return 1;
        },
    };
}

describe('documentRouter — standalone', () => {
    it('grants every claim, because one process cannot conflict with itself', async () => {
        const router = createDocumentRouter();
        expect(router.enabled).toBe(false);
        expect((await router.claim('room:file')).ok).toBe(true);
        expect((await router.claim('room:file')).ok).toBe(true);
    });

    it('has no leases to hand back', async () => {
        const router = createDocumentRouter();
        await router.claim('room:file');
        expect(router.held()).toEqual([]);
        await expect(router.close()).resolves.toBeUndefined();
    });
});

describe('documentRouter — clustered', () => {
    let redis;
    let router;

    beforeEach(() => {
        redis = fakeRedis({ value: 0 });
        router = createDocumentRouter({ redis, ttlMs: 30_000 });
    });

    it('claims an unowned document', async () => {
        const claim = await router.claim('room:file');

        expect(claim.ok).toBe(true);
        expect(claim.owner.nodeId).toBe(NODE_ID);
        expect(router.held()).toEqual(['room:file']);
    });

    it('grants a second claim for a document it already owns', async () => {
        await router.claim('room:file');
        // The common case, not an edge case: the second person opening the same
        // file lands on the node already serving it.
        expect((await router.claim('room:file')).ok).toBe(true);
    });

    it('refuses a document another node holds, and names the owner', async () => {
        await redis.set('dobby:doc:room:file:owner', 'other-node|http://other:5001', {
            PX: 30_000,
        });

        const claim = await router.claim('room:file');

        expect(claim.ok).toBe(false);
        expect(claim.owner).toEqual({
            nodeId: 'other-node',
            address: 'http://other:5001',
        });
    });

    it('keeps refusing for as long as the other node keeps its lease alive', async () => {
        await redis.set('dobby:doc:room:file:owner', 'other-node|', { PX: 30_000 });

        redis.now.value = 20_000;
        expect((await router.claim('room:file')).ok).toBe(false);

        // The owner heartbeats.
        await redis.pExpire('dobby:doc:room:file:owner', 30_000);
        redis.now.value = 40_000;
        expect((await router.claim('room:file')).ok).toBe(false);
    });

    it('takes over a document whose owner stopped heartbeating', async () => {
        await redis.set('dobby:doc:room:file:owner', 'dead-node|', { PX: 30_000 });

        // A crashed node releases its documents by expiry rather than stranding
        // them until someone intervenes — which is the whole reason the lease is
        // short and renewed rather than held for the connection's lifetime.
        redis.now.value = 31_000;
        const claim = await router.claim('room:file');

        expect(claim.ok).toBe(true);
        expect(claim.owner.nodeId).toBe(NODE_ID);
    });

    it('releases a lease it holds', async () => {
        await router.claim('room:file');
        await router.release('room:file');

        expect(await router.ownerOf('room:file')).toBeNull();
        expect(router.held()).toEqual([]);
    });

    it('will not release a lease that has passed to another node', async () => {
        await router.claim('room:file');
        // Expired here, claimed there.
        redis.now.value = 31_000;
        await redis.set('dobby:doc:room:file:owner', 'other-node|', { PX: 30_000 });

        await router.release('room:file');

        // A bare DEL would have deleted the new owner's lease and let a third
        // node claim a document that is actively being served.
        expect((await router.ownerOf('room:file')).nodeId).toBe('other-node');
    });

    it('renews the leases it holds on the heartbeat', async () => {
        vi.useFakeTimers();
        try {
            const heartbeatRouter = createDocumentRouter({ redis, ttlMs: 3000 });
            await heartbeatRouter.claim('room:file');
            heartbeatRouter.start();

            // Past the original expiry, but the heartbeat (ttl/3 = 1s) has run.
            await vi.advanceTimersByTimeAsync(1100);
            redis.now.value = 2000;
            await vi.advanceTimersByTimeAsync(1100);
            redis.now.value = 3500;

            expect((await heartbeatRouter.ownerOf('room:file'))?.nodeId).toBe(NODE_ID);
        } finally {
            vi.useRealTimers();
        }
    });

    it('stops tracking a document whose lease it lost', async () => {
        vi.useFakeTimers();
        try {
            const heartbeatRouter = createDocumentRouter({ redis, ttlMs: 3000 });
            await heartbeatRouter.claim('room:file');
            heartbeatRouter.start();

            // Long enough offline that the lease lapsed and someone else took it.
            redis.now.value = 10_000;
            await redis.set('dobby:doc:room:file:owner', 'other-node|', { PX: 30_000 });
            await vi.advanceTimersByTimeAsync(1100);

            // Continuing to renew would eventually extend a stranger's lease.
            expect(heartbeatRouter.held()).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('hands every lease back on close', async () => {
        await router.claim('room-a:file');
        await router.claim('room-b:file');

        await router.close();

        expect(await router.ownerOf('room-a:file')).toBeNull();
        expect(await router.ownerOf('room-b:file')).toBeNull();
    });
});
