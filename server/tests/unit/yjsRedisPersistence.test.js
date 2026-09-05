/**
 * Shared document storage.
 *
 * The reason this exists rather than a shared LevelDB directory is that LevelDB
 * cannot be shared, so the property under test is the one that replaces it: a
 * document written by one node is readable, in full, by another — including
 * after the update list has been compacted underneath it.
 *
 * A fake client stands in for Redis, implementing the list and set commands
 * this module uses plus `multi()`. Yjs itself is real: the point of these tests
 * is what happens to CRDT state, and a fake Yjs would be testing nothing.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createRedisDocumentPersistence } from '../../services/yjsRedisPersistence.js';

// The same instance the service uses. Two copies of Yjs fail each other's
// identity-based constructor checks — the reason yjsService requires rather
// than imports it.
const require = createRequire(import.meta.url);
const Y = require('yjs');

function fakeRedis() {
    const lists = new Map();
    const sets = new Map();

    const api = {
        lists,
        async lRange(key) {
            return [...(lists.get(key) ?? [])];
        },
        async sMembers(key) {
            return [...(sets.get(key) ?? [])];
        },
        multi() {
            const queued = [];
            const chain = {
                del(key) {
                    queued.push(() => {
                        lists.delete(key);
                        return 1;
                    });
                    return chain;
                },
                rPush(key, value) {
                    queued.push(() => {
                        if (!lists.has(key)) lists.set(key, []);
                        lists.get(key).push(value);
                        return lists.get(key).length;
                    });
                    return chain;
                },
                sAdd(key, value) {
                    queued.push(() => {
                        if (!sets.has(key)) sets.set(key, new Set());
                        sets.get(key).add(value);
                        return 1;
                    });
                    return chain;
                },
                sRem(key, value) {
                    queued.push(() => sets.get(key)?.delete(value) ?? 0);
                    return chain;
                },
                async exec() {
                    return queued.map((run) => run());
                },
            };
            return chain;
        },
    };
    return api;
}

/** A document with `text` written into its `monaco` Y.Text, as the editor does. */
function docWithText(text) {
    const doc = new Y.Doc();
    doc.getText('monaco').insert(0, text);
    return doc;
}

describe('yjsRedisPersistence', () => {
    let redis;
    let persistence;

    beforeEach(() => {
        redis = fakeRedis();
        persistence = createRedisDocumentPersistence(redis, Y);
    });

    it('returns an empty document for a name nothing has been stored under', async () => {
        const doc = await persistence.provider.getYDoc('room:missing');
        expect(doc.getText('monaco').toString()).toBe('');
    });

    it('round-trips a document', async () => {
        const source = docWithText('hello');
        await persistence.provider.storeUpdate('room:file', Y.encodeStateAsUpdate(source));

        const loaded = await persistence.provider.getYDoc('room:file');
        expect(loaded.getText('monaco').toString()).toBe('hello');
    });

    it('merges updates written separately, in either order', async () => {
        const a = new Y.Doc();
        const b = new Y.Doc();
        a.getText('monaco').insert(0, 'left');
        // Concurrent, not sequential: neither document has seen the other, which
        // is exactly the case two replicas produce.
        b.getText('monaco').insert(0, 'right');

        await persistence.provider.storeUpdate('room:file', Y.encodeStateAsUpdate(b));
        await persistence.provider.storeUpdate('room:file', Y.encodeStateAsUpdate(a));

        const loaded = await persistence.provider.getYDoc('room:file');
        const text = loaded.getText('monaco').toString();
        expect(text).toContain('left');
        expect(text).toContain('right');
    });

    it('records document names so retention can enumerate them', async () => {
        await persistence.provider.storeUpdate('room-a:file', Y.encodeStateAsUpdate(new Y.Doc()));
        await persistence.provider.storeUpdate('room-b:file', Y.encodeStateAsUpdate(new Y.Doc()));

        expect((await persistence.provider.getAllDocNames()).sort()).toEqual([
            'room-a:file',
            'room-b:file',
        ]);
    });

    it('forgets a cleared document entirely', async () => {
        await persistence.provider.storeUpdate('room:file', Y.encodeStateAsUpdate(docWithText('x')));
        await persistence.provider.clearDocument('room:file');

        expect(await persistence.provider.getAllDocNames()).toEqual([]);
        const loaded = await persistence.provider.getYDoc('room:file');
        expect(loaded.getText('monaco').toString()).toBe('');
    });

    it('compacts a long history into one update without losing any of it', async () => {
        const doc = new Y.Doc();
        const text = doc.getText('monaco');

        // Each keystroke is its own update, which is what makes an append-only
        // list grow without bound. Past the threshold it must collapse.
        doc.on('update', (update) => persistence.provider.storeUpdate('room:file', update));
        for (let i = 0; i < 250; i += 1) text.insert(text.length, 'a');
        // storeUpdate is async; let the queued writes drain.
        await new Promise((resolve) => setImmediate(resolve));

        const stored = redis.lists.get('dobby:ydoc:room:file:updates');
        expect(stored.length).toBeLessThan(250);

        const loaded = await persistence.provider.getYDoc('room:file');
        expect(loaded.getText('monaco').toString()).toBe('a'.repeat(250));
    });

    it('binds a live document so later edits are written through', async () => {
        const doc = new Y.Doc();
        await persistence.bindState('room:file', doc);

        doc.getText('monaco').insert(0, 'typed');
        await new Promise((resolve) => setImmediate(resolve));

        const loaded = await persistence.provider.getYDoc('room:file');
        expect(loaded.getText('monaco').toString()).toBe('typed');
    });

    it('merges stored state into a document that already has content', async () => {
        await persistence.provider.storeUpdate(
            'room:file',
            Y.encodeStateAsUpdate(docWithText('from-redis'))
        );

        // The node opening the document has an unsaved local state — the case
        // that decides whether a handoff is a merge or an overwrite.
        const doc = docWithText('local');
        await persistence.bindState('room:file', doc);

        const text = doc.getText('monaco').toString();
        expect(text).toContain('from-redis');
        expect(text).toContain('local');
    });

    it('compacts on close rather than writing the whole document again', async () => {
        const doc = new Y.Doc();
        await persistence.bindState('room:file', doc);
        doc.getText('monaco').insert(0, 'session');
        await new Promise((resolve) => setImmediate(resolve));

        await persistence.writeState('room:file', doc);

        expect(redis.lists.get('dobby:ydoc:room:file:updates')).toHaveLength(1);
        const loaded = await persistence.provider.getYDoc('room:file');
        expect(loaded.getText('monaco').toString()).toBe('session');
    });
});
