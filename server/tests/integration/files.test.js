/**
 * The file API over HTTP.
 *
 * These go through the real router rather than calling fileService directly,
 * because the parts most likely to break are in the wiring: the membership gate
 * is mounted on the parent router, and the Socket.IO broadcast that keeps the
 * other person's explorer current is not in the service at all. Both are tested
 * here for the same reason the Phase 2 socket tests exist.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import {
    startTestServer,
    createUser,
    createRoom,
    addMember,
    connectSocket,
    joinRoom,
    once,
    neverArrives,
    closeAllSockets,
} from '../helpers/server.js';

let server;

beforeAll(async () => {
    server = await startTestServer({ snapshots: false });
});

afterAll(async () => {
    closeAllSockets();
    await server.stop();
});

afterEach(() => {
    closeAllSockets();
});

/** An owner, a guest who is a member, and the room they share. */
async function pairedRoom() {
    const owner = await createUser(server);
    const guest = await createUser(server);
    const room = await createRoom(owner);
    await addMember(owner, room, guest);
    return { owner, guest, room };
}

const filesPath = (room) => `/api/rooms/${room.id}/files`;

describe('GET /api/rooms/:roomId/files', () => {
    it('returns the tree a new room was seeded with', async () => {
        const { owner, room } = await pairedRoom();

        const { body } = await owner.get(filesPath(room)).expect(200);

        expect(body.files).toHaveLength(1);
        expect(body.files[0]).toMatchObject({ name: 'main.js', type: 'file', language: 'javascript' });
    });

    it('is visible to the guest as well as the owner', async () => {
        const { guest, room } = await pairedRoom();

        await guest.get(filesPath(room)).expect(200);
    });

    it('404s for a non-member, without confirming the room exists', async () => {
        const { room } = await pairedRoom();
        const stranger = await createUser(server);

        // Same response as a room id that does not exist — distinguishing them
        // would let a caller enumerate rooms.
        await stranger.get(filesPath(room)).expect(404);
    });

    it('401s without a token', async () => {
        const { room } = await pairedRoom();

        await server.api().get(filesPath(room)).expect(401);
    });
});

describe('POST /api/rooms/:roomId/files', () => {
    it('creates a file and infers its language', async () => {
        const { owner, room } = await pairedRoom();

        const { body } = await owner.post(filesPath(room)).send({ name: 'main.py' }).expect(200);

        expect(body.file).toMatchObject({ name: 'main.py', type: 'file', language: 'python' });
    });

    it('creates a folder and accepts a child inside it', async () => {
        const { owner, room } = await pairedRoom();

        const { body: folder } = await owner
            .post(filesPath(room))
            .send({ name: 'src', type: 'folder' })
            .expect(200);
        const { body: child } = await owner
            .post(filesPath(room))
            .send({ name: 'index.js', parentId: folder.file.id })
            .expect(200);

        expect(child.file.parentId).toBe(folder.file.id);

        const { body: tree } = await owner.get(filesPath(room)).expect(200);
        const src = tree.files.find((node) => node.id === folder.file.id);
        expect(src.children).toHaveLength(1);
    });

    it('lets a guest create files too — a room is shared, not owned per file', async () => {
        const { guest, room } = await pairedRoom();

        await guest.post(filesPath(room)).send({ name: 'guest-notes.md' }).expect(200);
    });

    it('rejects a name carrying a path separator', async () => {
        const { owner, room } = await pairedRoom();

        const { body } = await owner
            .post(filesPath(room))
            .send({ name: '../escape.js' })
            .expect(400);

        expect(body.error).toMatch(/separator/);
    });

    it('answers 409 on a duplicate name', async () => {
        const { owner, room } = await pairedRoom();

        await owner.post(filesPath(room)).send({ name: 'dup.js' }).expect(200);
        await owner.post(filesPath(room)).send({ name: 'dup.js' }).expect(409);
    });

    it('rejects an unknown type', async () => {
        const { owner, room } = await pairedRoom();

        await owner.post(filesPath(room)).send({ name: 'x', type: 'symlink' }).expect(400);
    });

    it('will not accept a parent from another room', async () => {
        const { owner, room } = await pairedRoom();
        const elsewhere = await createRoom(owner, 'Elsewhere');
        const { body: mine } = await owner
            .post(filesPath(elsewhere))
            .send({ name: 'other.js' })
            .expect(200);

        await owner
            .post(filesPath(room))
            .send({ name: 'x.js', parentId: mine.file.id })
            .expect(404);
    });
});

describe('PATCH /api/rooms/:roomId/files/:fileId', () => {
    it('renames a file and updates its language', async () => {
        const { owner, room } = await pairedRoom();
        const { body: created } = await owner.post(filesPath(room)).send({ name: 'a.js' });

        const { body } = await owner
            .patch(`${filesPath(room)}/${created.file.id}`)
            .send({ name: 'a.py' })
            .expect(200);

        expect(body.file).toMatchObject({ name: 'a.py', language: 'python' });
    });

    it('rejects a body that asks for nothing', async () => {
        const { owner, room } = await pairedRoom();
        const { body: created } = await owner.post(filesPath(room)).send({ name: 'b.js' });

        await owner
            .patch(`${filesPath(room)}/${created.file.id}`)
            .send({})
            .expect(400);
    });

    it('404s for a file id from another room', async () => {
        const { owner, room } = await pairedRoom();
        const elsewhere = await createRoom(owner, 'Elsewhere');
        const { body: mine } = await owner.post(filesPath(elsewhere)).send({ name: 'other.js' });

        await owner
            .patch(`${filesPath(room)}/${mine.file.id}`)
            .send({ name: 'renamed.js' })
            .expect(404);
    });
});

describe('DELETE /api/rooms/:roomId/files/:fileId', () => {
    it('removes a folder and reports every id that went with it', async () => {
        const { owner, room } = await pairedRoom();
        const { body: folder } = await owner
            .post(filesPath(room))
            .send({ name: 'src', type: 'folder' });
        const { body: child } = await owner
            .post(filesPath(room))
            .send({ name: 'index.js', parentId: folder.file.id });

        const { body } = await owner
            .delete(`${filesPath(room)}/${folder.file.id}`)
            .expect(200);

        // The client closes the matching tabs from this list, and the server
        // drops the matching documents.
        expect(new Set(body.removed)).toEqual(new Set([folder.file.id, child.file.id]));

        const { body: tree } = await owner.get(filesPath(room));
        expect(tree.files.map((node) => node.id)).not.toContain(folder.file.id);
    });

    it('404s for a file that is not there', async () => {
        const { owner, room } = await pairedRoom();

        await owner.delete(`${filesPath(room)}/missing`).expect(404);
    });
});

describe('broadcasting tree changes', () => {
    it('tells the other person in the room about a new file', async () => {
        const { owner, guest, room } = await pairedRoom();
        const guestSocket = await connectSocket(server, guest);
        await joinRoom(guestSocket, room.id);

        const changed = once(guestSocket, 'files:changed');
        await owner.post(filesPath(room)).send({ name: 'appeared.js' }).expect(200);

        const payload = await changed;
        expect(payload.action).toBe('created');
        expect(payload.file.name).toBe('appeared.js');
    });

    it('names the deleted ids so open tabs can be closed', async () => {
        const { owner, guest, room } = await pairedRoom();
        const { body: created } = await owner.post(filesPath(room)).send({ name: 'doomed.js' });

        const guestSocket = await connectSocket(server, guest);
        await joinRoom(guestSocket, room.id);

        const changed = once(guestSocket, 'files:changed');
        await owner.delete(`${filesPath(room)}/${created.file.id}`).expect(200);

        expect(await changed).toMatchObject({ action: 'deleted', fileIds: [created.file.id] });
    });

    it('does not reach a socket in a different room', async () => {
        const { owner, room } = await pairedRoom();
        const outsider = await createUser(server);
        const otherRoom = await createRoom(outsider, 'Unrelated');

        const outsiderSocket = await connectSocket(server, outsider);
        await joinRoom(outsiderSocket, otherRoom.id);

        // An absence, so only a wait establishes it — same reasoning as the
        // Phase 2 relay-boundary tests.
        const silence = neverArrives(outsiderSocket, 'files:changed');
        await owner.post(filesPath(room)).send({ name: 'private.js' }).expect(200);

        await silence;
    });
});

describe('document history', () => {
    it('starts empty and takes a snapshot on request', async () => {
        const { owner, room } = await pairedRoom();
        const { body: created } = await owner.post(filesPath(room)).send({ name: 'history.js' });
        const path = `${filesPath(room)}/${created.file.id}/snapshots`;

        const { body: before } = await owner.get(path).expect(200);
        expect(before.snapshots).toEqual([]);
        expect(before.path).toBe('history.js');

        const { body: taken } = await owner.post(path).send().expect(200);
        // An untouched file's document is empty, but it is still a state worth
        // being able to return to.
        expect(taken.snapshot).not.toBeNull();

        const { body: after } = await owner.get(path).expect(200);
        expect(after.snapshots).toHaveLength(1);
    });

    it('reports a second identical snapshot as unchanged rather than storing it', async () => {
        const { owner, room } = await pairedRoom();
        const { body: created } = await owner.post(filesPath(room)).send({ name: 'idle.js' });
        const path = `${filesPath(room)}/${created.file.id}/snapshots`;

        await owner.post(path).send().expect(200);
        const { body } = await owner.post(path).send().expect(200);

        expect(body.unchanged).toBe(true);

        const { body: listed } = await owner.get(path).expect(200);
        expect(listed.snapshots).toHaveLength(1);
    });

    it('reads the text a snapshot holds back', async () => {
        const { owner, room } = await pairedRoom();
        const { body: created } = await owner.post(filesPath(room)).send({ name: 'read.js' });
        const path = `${filesPath(room)}/${created.file.id}/snapshots`;

        const { body: taken } = await owner.post(path).send();
        const { body } = await owner.get(`${path}/${taken.snapshot.id}`).expect(200);

        expect(body).toHaveProperty('text');
    });

    it('restores a snapshot and says whether anything changed', async () => {
        const { owner, room } = await pairedRoom();
        const { body: created } = await owner.post(filesPath(room)).send({ name: 'restore.js' });
        const path = `${filesPath(room)}/${created.file.id}/snapshots`;

        const { body: taken } = await owner.post(path).send();
        const { body } = await owner
            .post(`${path}/${taken.snapshot.id}/restore`)
            .send()
            .expect(200);

        // Nothing has been typed since, so the restore is a no-op — but it must
        // report that rather than fail.
        expect(body.changed).toBe(false);
    });

    it('404s on a snapshot id from another room', async () => {
        const { owner, room } = await pairedRoom();
        const elsewhere = await createRoom(owner, 'Elsewhere');
        const { body: theirs } = await owner.post(filesPath(elsewhere)).send({ name: 'theirs.js' });
        const { body: taken } = await owner
            .post(`${filesPath(elsewhere)}/${theirs.file.id}/snapshots`)
            .send();

        const { body: mine } = await owner.post(filesPath(room)).send({ name: 'mine.js' });

        await owner
            .get(`${filesPath(room)}/${mine.file.id}/snapshots/${taken.snapshot.id}`)
            .expect(404);
    });

    it('is not readable by a non-member', async () => {
        const { owner, room } = await pairedRoom();
        const { body: created } = await owner.post(filesPath(room)).send({ name: 'secret.js' });
        const stranger = await createUser(server);

        await stranger
            .get(`${filesPath(room)}/${created.file.id}/snapshots`)
            .expect(404);
    });

    it('drops the history of a file when that file is deleted', async () => {
        const { owner, room } = await pairedRoom();
        const { body: created } = await owner.post(filesPath(room)).send({ name: 'transient.js' });
        const path = `${filesPath(room)}/${created.file.id}/snapshots`;
        await owner.post(path).send().expect(200);

        await owner.delete(`${filesPath(room)}/${created.file.id}`).expect(200);

        // The file is gone, so its history is unreachable — and must not linger
        // in the table waiting for the retention sweep.
        await owner.get(path).expect(404);
    });
});
