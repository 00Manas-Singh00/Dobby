/**
 * Document snapshots.
 *
 * The subtle part is restore. Yjs updates are additive, so "put the document
 * back" cannot be expressed by re-applying an old update — that is a no-op
 * against a document that already contains those operations. Restore has to be
 * a fresh edit, and the tests below pin exactly that: applying a snapshot the
 * document has already moved past really does change the text, and a
 * concurrent editor's characters survive it.
 *
 * Yjs is required rather than imported here for the same reason the service
 * does it: y-socket.io and y-leveldb are CommonJS, and two module instances of
 * Yjs fail each other's identity checks.
 */

import { createRequire } from 'module';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import db from '../../db.js';
import { register } from '../../services/authService.js';
import { createRoom } from '../../services/roomService.js';
import {
    captureSnapshot,
    listSnapshots,
    readSnapshotText,
    restoreSnapshot,
    startSnapshotSweep,
    pruneSnapshots,
    deleteSnapshotsFor,
    SNAPSHOTS_PER_DOCUMENT,
    SnapshotError,
    TEXT_KEY,
} from '../../services/snapshotService.js';

const Y = createRequire(import.meta.url)('yjs');

let room;
let counter = 0;

/** A document holding `text`, named the way the file tree names them. */
function docWith(text) {
    const doc = new Y.Doc();
    doc.getText(TEXT_KEY).insert(0, text);
    return doc;
}

beforeEach(async () => {
    counter += 1;
    const { user } = await register({
        email: `snap${counter}-${Date.now()}@example.com`,
        username: `snap${counter}`,
        password: 'correct horse battery staple',
    });
    room = await createRoom(user.id, 'Snapshots');
});

afterEach(() => {
    vi.useRealTimers();
});

describe('captureSnapshot', () => {
    it('stores the document state and reports its size', async () => {
        const snapshot = await captureSnapshot(room.id, `${room.id}:a`, docWith('hello'));

        expect(snapshot).toMatchObject({ roomId: room.id, docName: `${room.id}:a` });
        expect(snapshot.size).toBeGreaterThan(0);
    });

    it('skips a document that has not changed since its last snapshot', async () => {
        const doc = docWith('stable');
        const docName = `${room.id}:b`;

        expect(await captureSnapshot(room.id, docName, doc)).not.toBeNull();
        // An idle room is the common case; re-encoding it every pass would
        // write a duplicate blob every interval, forever.
        expect(await captureSnapshot(room.id, docName, doc)).toBeNull();
    });

    it('captures again once the document has moved on', async () => {
        const doc = docWith('one');
        const docName = `${room.id}:c`;

        await captureSnapshot(room.id, docName, doc);
        doc.getText(TEXT_KEY).insert(3, ' two');

        expect(await captureSnapshot(room.id, docName, doc)).not.toBeNull();
        expect(await listSnapshots(room.id, docName)).toHaveLength(2);
    });

    it('keeps only the configured number per document, newest first', async () => {
        const doc = docWith('');
        const docName = `${room.id}:d`;

        for (let i = 0; i < SNAPSHOTS_PER_DOCUMENT + 5; i += 1) {
            doc.getText(TEXT_KEY).insert(0, `${i} `);
            await captureSnapshot(room.id, docName, doc);
        }

        const snapshots = await listSnapshots(room.id, docName);

        expect(snapshots).toHaveLength(SNAPSHOTS_PER_DOCUMENT);
        expect(new Date(snapshots[0].createdAt).getTime()).toBeGreaterThanOrEqual(
            new Date(snapshots.at(-1).createdAt).getTime()
        );
    });

    it('trims only the document being written to', async () => {
        const keep = docWith('keep me');
        await captureSnapshot(room.id, `${room.id}:keep`, keep);

        const churn = docWith('');
        for (let i = 0; i < SNAPSHOTS_PER_DOCUMENT + 3; i += 1) {
            churn.getText(TEXT_KEY).insert(0, `${i} `);
            await captureSnapshot(room.id, `${room.id}:churn`, churn);
        }

        expect(await listSnapshots(room.id, `${room.id}:keep`)).toHaveLength(1);
    });
});

describe('readSnapshotText', () => {
    it('reads the text back without needing the original document', async () => {
        const snapshot = await captureSnapshot(room.id, `${room.id}:e`, docWith('recoverable'));

        expect((await readSnapshotText(room.id, snapshot.id)).text).toBe('recoverable');
    });

    it('404s for a snapshot belonging to another room', async () => {
        const snapshot = await captureSnapshot(room.id, `${room.id}:f`, docWith('mine'));
        const { user } = await register({
            email: `other-${Date.now()}@example.com`,
            username: 'other',
            password: 'correct horse battery staple',
        });
        const otherRoom = await createRoom(user.id, 'Other');

        await expect(readSnapshotText(otherRoom.id, snapshot.id)).rejects.toThrow(expect.objectContaining({ status: 404 }));
    });

    it('rejects an unknown snapshot id', async () => {
        await expect(readSnapshotText(room.id, 'nope')).rejects.toThrow(SnapshotError);
    });
});

describe('restoreSnapshot', () => {
    it('rewrites a document that has moved past the snapshot', async () => {
        const doc = docWith('version one');
        const docName = `${room.id}:g`;
        const snapshot = await captureSnapshot(room.id, docName, doc);

        doc.getText(TEXT_KEY).delete(0, doc.getText(TEXT_KEY).length);
        doc.getText(TEXT_KEY).insert(0, 'version two, quite different');

        const result = await restoreSnapshot(room.id, snapshot.id, doc);

        // Re-applying the snapshot as a Yjs update would have done nothing
        // here: the document already contains those operations, plus later ones.
        expect(result.changed).toBe(true);
        expect(doc.getText(TEXT_KEY).toString()).toBe('version one');
    });

    it('reports no change when the document already matches', async () => {
        const doc = docWith('unchanged');
        const snapshot = await captureSnapshot(room.id, `${room.id}:h`, doc);

        expect((await restoreSnapshot(room.id, snapshot.id, doc)).changed).toBe(false);
    });

    it('lands as a single transaction, not a visible delete-then-retype', async () => {
        const doc = docWith('before');
        const snapshot = await captureSnapshot(room.id, `${room.id}:i`, doc);
        doc.getText(TEXT_KEY).insert(6, ' and after');

        // Collaborators receive one update per transaction. Two would render as
        // the document briefly emptying, which is alarming to watch.
        const updates = [];
        doc.on('update', (update, origin) => updates.push(origin));

        await restoreSnapshot(room.id, snapshot.id, doc);

        expect(updates).toEqual(['snapshot-restore']);
    });

    it('merges with a concurrent edit rather than discarding it', async () => {
        const docName = `${room.id}:j`;
        const alice = docWith('shared line');
        const snapshot = await captureSnapshot(room.id, docName, alice);

        // Bob is a second replica that has already seen the same history.
        const bob = new Y.Doc();
        Y.applyUpdate(bob, Y.encodeStateAsUpdate(alice));

        alice.getText(TEXT_KEY).insert(11, ' — alice edits');
        bob.getText(TEXT_KEY).insert(0, 'BOB: ');

        // Alice restores while Bob's edit is still in flight.
        await restoreSnapshot(room.id, snapshot.id, alice);

        Y.applyUpdate(bob, Y.encodeStateAsUpdate(alice));
        Y.applyUpdate(alice, Y.encodeStateAsUpdate(bob));

        // The restore is an ordinary edit, so it converges — and Bob's
        // characters are still there rather than overwritten.
        expect(alice.getText(TEXT_KEY).toString()).toBe(bob.getText(TEXT_KEY).toString());
        expect(alice.getText(TEXT_KEY).toString()).toContain('BOB: ');
    });

    it('does not immediately re-snapshot the state it just restored', async () => {
        const doc = docWith('original');
        const docName = `${room.id}:k`;
        const snapshot = await captureSnapshot(room.id, docName, doc);
        doc.getText(TEXT_KEY).insert(8, ' plus more');
        await captureSnapshot(room.id, docName, doc);

        await restoreSnapshot(room.id, snapshot.id, doc);

        expect(await captureSnapshot(room.id, docName, doc)).toBeNull();
    });
});

describe('startSnapshotSweep', () => {
    it('captures every open document on each pass', async () => {
        vi.useFakeTimers();
        const open = new Map([
            [`${room.id}:one`, docWith('first')],
            [`${room.id}:two`, docWith('second')],
        ]);

        const stop = startSnapshotSweep(() => open);
        // The async variant, because a pass now awaits its writes: advancing
        // synchronously would fire the timer and assert before the rows exist.
        await vi.advanceTimersByTimeAsync(
            Number(process.env.SNAPSHOT_INTERVAL_MS || 5 * 60 * 1000)
        );
        stop();

        expect(await listSnapshots(room.id, `${room.id}:one`)).toHaveLength(1);
        expect(await listSnapshots(room.id, `${room.id}:two`)).toHaveLength(1);
    });

    it('stops once the returned function is called', async () => {
        vi.useFakeTimers();
        const doc = docWith('x');
        const stop = startSnapshotSweep(() => new Map([[`${room.id}:stopme`, doc]]));
        stop();

        doc.getText(TEXT_KEY).insert(0, 'more ');
        await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

        expect(await listSnapshots(room.id, `${room.id}:stopme`)).toHaveLength(0);
    });

    it('survives a failing pass without tearing down the timer', async () => {
        vi.useFakeTimers();
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

        const stop = startSnapshotSweep(() => {
            throw new Error('persistence unavailable');
        });

        // Nobody awaits this timer, and a pass is async now, so an escaping
        // error would be an unhandled rejection that takes the process with it
        // rather than a throw anyone could catch. It has to be reported and
        // swallowed inside the pass.
        await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
        expect(logged).toHaveBeenCalled();
        stop();
    });
});

describe('pruning', () => {
    it('drops snapshots whose document is gone', async () => {
        await captureSnapshot(room.id, `${room.id}:alive`, docWith('a'));
        await captureSnapshot(room.id, `${room.id}:dead`, docWith('b'));

        // The predicate keeps only this test's live document, so the sweep
        // also collects the leftovers of every case above — the count is not
        // the assertion, the two documents' fates are.
        await pruneSnapshots((name) => name === `${room.id}:alive`);

        expect(await listSnapshots(room.id, `${room.id}:dead`)).toHaveLength(0);
        expect(await listSnapshots(room.id, `${room.id}:alive`)).toHaveLength(1);
    });

    it('forgets a document outright when its file is deleted', async () => {
        const docName = `${room.id}:deleted`;
        await captureSnapshot(room.id, docName, docWith('gone soon'));

        expect(await deleteSnapshotsFor(docName)).toBe(1);
        expect(await listSnapshots(room.id, docName)).toHaveLength(0);
    });

    it('goes with the room when the room is deleted', async () => {
        await captureSnapshot(room.id, `${room.id}:cascade`, docWith('bye'));

        await db.run('DELETE FROM rooms WHERE id = ?', [room.id]);

        expect(
            await db.count('SELECT COUNT(*) AS n FROM document_snapshots WHERE room_id = ?', [
                room.id,
            ])
        ).toBe(0);
    });
});
