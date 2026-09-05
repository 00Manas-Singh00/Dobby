/**
 * The authorization boundaries added in Phase 1.
 *
 * Every case here is a non-member trying to reach something: a room over REST,
 * a document namespace, another user's terminal session, or a peer's WebRTC
 * signal. Two of these were live bugs found during Phase 1 — document
 * namespaces bypassed the connection middleware, and signals were relayed to
 * any socket id the sender named — so they are the ones most worth pinning
 * down.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { io as ioClient } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import {
    startTestServer,
    createUser,
    createRoom,
    addMember,
    connectSocket,
    once,
    neverArrives,
    joinRoom,
    closeAllSockets,
} from '../helpers/server.js';

let server;

beforeAll(async () => {
    server = await startTestServer();
});

afterAll(async () => {
    await server.stop();
});

afterEach(() => {
    closeAllSockets();
});

/**
 * Connect to a Yjs document namespace directly, the way a hand-rolled client
 * would. Resolves 'connected' or 'rejected'.
 */
function connectToDocument(token, docName) {
    return new Promise((resolve) => {
        const socket = ioClient(`${server.url}/yjs|${docName}`, {
            auth: { token },
            transports: ['websocket'],
            reconnection: false,
            forceNew: true,
        });
        const finish = (outcome) => {
            socket.disconnect();
            resolve(outcome);
        };
        socket.once('connect', () => finish('connected'));
        socket.once('connect_error', (error) => finish({ rejected: error.message }));
    });
}

describe('REST: rooms', () => {
    it('is unreachable without a token', async () => {
        const anonymous = server.api();
        for (const response of await Promise.all([
            anonymous.get('/api/rooms'),
            anonymous.post('/api/rooms').send({ name: 'x' }),
            anonymous.post('/api/execute').send({ language: 'python', code: '1' }),
        ])) {
            expect(response.status).toBe(401);
        }
    });

    it('answers 404, not 403, for a room the caller is not in', async () => {
        const owner = await createUser(server);
        const stranger = await createUser(server);
        const room = await createRoom(owner);

        // Distinguishing "no such room" from "not your room" would let a caller
        // enumerate which room ids exist.
        const found = await stranger.get(`/api/rooms/${room.id}`).expect(404);
        const missing = await stranger.get('/api/rooms/00000000-0000-0000-0000-000000000000').expect(404);
        expect(found.body).toEqual(missing.body);
    });

    it('lists only the caller\'s own rooms', async () => {
        const owner = await createUser(server);
        const stranger = await createUser(server);
        const room = await createRoom(owner);

        const { body } = await stranger.get('/api/rooms').expect(200);
        expect(body.rooms.map((r) => r.id)).not.toContain(room.id);
    });

    it('lets only the owner mint an invite', async () => {
        const owner = await createUser(server);
        const guest = await createUser(server);
        const room = await createRoom(owner);
        await addMember(owner, room, guest);

        // The guest is a member, so they pass the membership gate — but minting
        // invites is an owner capability, checked separately.
        await guest.post(`/api/rooms/${room.id}/invites`).send().expect(403);
        await guest.get(`/api/rooms/${room.id}/invites`).expect(403);
    });

    it('lets only the owner delete the room', async () => {
        const owner = await createUser(server);
        const guest = await createUser(server);
        const room = await createRoom(owner);
        await addMember(owner, room, guest);

        await guest.delete(`/api/rooms/${room.id}`).expect(403);
        await owner.delete(`/api/rooms/${room.id}`).expect(200);
        await owner.get(`/api/rooms/${room.id}`).expect(404);
    });

    it('rejects a token signed with the wrong secret', async () => {
        const forged = jwt.sign({ sub: 'someone' }, 'a-completely-different-secret-key-here');
        await server.api().get('/api/rooms').set('Authorization', `Bearer ${forged}`).expect(401);
    });

    it('rejects a malformed Authorization header', async () => {
        const user = await createUser(server);
        await server.api().get('/api/rooms').set('Authorization', user.accessToken).expect(401);
        await server.api().get('/api/rooms').set('Authorization', 'Bearer ').expect(401);
    });
});

describe('Yjs document namespaces', () => {
    it('admits a member of the room the document belongs to', async () => {
        const owner = await createUser(server);
        const room = await createRoom(owner);

        expect(await connectToDocument(owner.accessToken, `${room.id}:main.js`)).toBe('connected');
    });

    it('refuses a non-member who names the document directly', async () => {
        const owner = await createUser(server);
        const stranger = await createUser(server);
        const room = await createRoom(owner);

        // Document namespaces are dynamic and do NOT pass through the main
        // connection middleware — this gate is registered separately, and was
        // missing entirely before Phase 1.
        const result = await connectToDocument(stranger.accessToken, `${room.id}:main.js`);
        expect(result).toMatchObject({ rejected: expect.stringMatching(/not a member/i) });
    });

    it('refuses an unauthenticated connection', async () => {
        const owner = await createUser(server);
        const room = await createRoom(owner);

        expect(await connectToDocument(undefined, `${room.id}:main.js`)).toMatchObject({
            rejected: expect.stringMatching(/authentication required/i),
        });
    });

    it('refuses a document name with no room part', async () => {
        const owner = await createUser(server);
        expect(await connectToDocument(owner.accessToken, 'main.js')).toMatchObject({
            rejected: expect.stringMatching(/not a member|malformed/i),
        });
    });

    it('scopes access per room, not per user', async () => {
        const owner = await createUser(server);
        const guest = await createUser(server);
        const mine = await createRoom(owner, 'Mine');
        const shared = await createRoom(owner, 'Shared');
        await addMember(owner, shared, guest);

        // Being in one of the owner's rooms grants nothing in another. The room
        // is read from the namespace actually connected to, never from the
        // handshake payload.
        expect(await connectToDocument(guest.accessToken, `${shared.id}:main.js`)).toBe('connected');
        expect(await connectToDocument(guest.accessToken, `${mine.id}:main.js`)).toMatchObject({
            rejected: expect.stringMatching(/not a member/i),
        });
    });
});

describe('terminal', () => {
    it('refuses a non-member asking for a shell in a room', async () => {
        const owner = await createUser(server);
        const stranger = await createUser(server);
        const room = await createRoom(owner);

        const socket = await connectSocket(server, stranger);
        const error = once(socket, 'socket:error');
        socket.emit('terminal:create', { roomId: room.id });

        // Rejected at the membership guard, before the terminal code decides
        // whether it is even enabled.
        expect(await error).toMatchObject({ event: 'membership' });
    });

    it('refuses a member who has not joined the room on this socket', async () => {
        const owner = await createUser(server);
        const room = await createRoom(owner);

        const socket = await connectSocket(server, owner);
        const error = once(socket, 'socket:error');
        socket.emit('terminal:create', { roomId: room.id });

        expect(await error).toMatchObject({ event: 'membership' });
    });

    it('reports that the terminal is disabled to a member who joined', async () => {
        const owner = await createUser(server);
        const room = await createRoom(owner);

        const socket = await connectSocket(server, owner);
        await joinRoom(socket, room.id);

        // ENABLE_TERMINAL is unset in the test environment, so this is the
        // point past the membership gate — proving the gate let it through.
        const error = once(socket, 'terminal:error');
        socket.emit('terminal:create', { roomId: room.id });
        expect(await error).toMatchObject({ message: expect.stringMatching(/disabled/i) });
    });

    it('ignores input from a socket with no session of its own', async () => {
        const owner = await createUser(server);
        const room = await createRoom(owner);

        const socket = await connectSocket(server, owner);
        await joinRoom(socket, room.id);

        // The session key is derived from the authenticated user id, never a
        // client-supplied value, so there is no name to guess.
        const silence = neverArrives(socket, 'terminal:output');
        socket.emit('terminal:input', { data: 'whoami\n' });
        await silence;
    });
});

describe('WebRTC signalling', () => {
    it('will not relay a signal to a socket outside the room', async () => {
        const owner = await createUser(server);
        const guest = await createUser(server);
        const outsider = await createUser(server);
        const room = await createRoom(owner);
        await addMember(owner, room, guest);

        const ownerSocket = await connectSocket(server, owner);
        await joinRoom(ownerSocket, room.id);
        const outsiderSocket = await connectSocket(server, outsider);

        // Signals used to be relayed to any socket id the sender named, which
        // let an authenticated client push SDP at strangers.
        const silence = neverArrives(outsiderSocket, 'user joined video');
        ownerSocket.emit('sending signal', {
            roomId: room.id,
            userToSignal: outsiderSocket.id,
            callerID: ownerSocket.id,
            signal: { type: 'offer', sdp: 'v=0' },
        });
        await silence;
    });

    it('relays a signal between two sockets in the same room', async () => {
        const owner = await createUser(server);
        const guest = await createUser(server);
        const room = await createRoom(owner);
        await addMember(owner, room, guest);

        const ownerSocket = await connectSocket(server, owner);
        await joinRoom(ownerSocket, room.id);
        const guestSocket = await connectSocket(server, guest);
        await joinRoom(guestSocket, room.id);

        const received = once(guestSocket, 'user joined video');
        ownerSocket.emit('sending signal', {
            roomId: room.id,
            userToSignal: guestSocket.id,
            callerID: ownerSocket.id,
            signal: { type: 'offer', sdp: 'v=0' },
        });

        expect(await received).toMatchObject({ callerID: ownerSocket.id, signal: { type: 'offer' } });
    });

    it('lists only the peers in the caller\'s own room', async () => {
        const owner = await createUser(server);
        const guest = await createUser(server);
        const room = await createRoom(owner);
        const otherRoom = await createRoom(owner, 'Other');
        await addMember(owner, room, guest);

        const ownerSocket = await connectSocket(server, owner);
        await joinRoom(ownerSocket, room.id);
        const guestSocket = await connectSocket(server, guest);
        await joinRoom(guestSocket, room.id);

        const elsewhere = await connectSocket(server, owner);
        await joinRoom(elsewhere, otherRoom.id);

        const peers = once(ownerSocket, 'all users video');
        ownerSocket.emit('join video', { roomId: room.id });

        expect(await peers).toEqual([guestSocket.id]);
    });
});
