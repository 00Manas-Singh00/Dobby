/**
 * The Socket.IO room lifecycle, driven through a real server and real clients.
 *
 * These go through the actual socket rather than calling handlers directly,
 * because everything Phase 1 added — the handshake check, the rate limiter, the
 * schema, the membership guard — lives in the wiring. A test that called the
 * handler would not see any of it.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
    startTestServer,
    createUser,
    createRoom,
    addMember,
    connectSocket,
    expectSocketRejected,
    once,
    neverArrives,
    joinRoom,
    closeAllSockets,
} from '../helpers/server.js';
import { removeMember } from '../../services/roomService.js';

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

describe('handshake', () => {
    it('refuses a socket with no token', async () => {
        const error = await expectSocketRejected(server, undefined);
        expect(error.message).toMatch(/authentication required/i);
    });

    it('refuses a socket with a garbage token', async () => {
        const error = await expectSocketRejected(server, 'not.a.jwt');
        expect(error.message).toMatch(/invalid or expired/i);
    });

    it('accepts a socket with a valid access token', async () => {
        const user = await createUser(server);
        const socket = await connectSocket(server, user);
        expect(socket.connected).toBe(true);
    });
});

describe('join room', () => {
    let owner;
    let room;

    beforeEach(async () => {
        owner = await createUser(server);
        room = await createRoom(owner);
    });

    it('admits a member and announces the client list', async () => {
        const socket = await connectSocket(server, owner);
        const list = await joinRoom(socket, room.id);

        expect(list.userslist).toEqual([owner.user.username]);
    });

    it('denies a non-member who knows the room id', async () => {
        const stranger = await createUser(server);
        const socket = await connectSocket(server, stranger);

        const denied = once(socket, 'room denied');
        socket.emit('join room', { roomId: room.id });

        expect((await denied).message).toMatch(/do not have access/i);
    });

    it('admits a guest once they have redeemed an invite', async () => {
        const guest = await createUser(server);
        const socket = await connectSocket(server, guest);

        const denied = once(socket, 'room denied');
        socket.emit('join room', { roomId: room.id });
        await denied;

        await addMember(owner, room, guest);

        const list = await joinRoom(socket, room.id);
        expect(list.userslist).toContain(guest.user.username);
    });

    it('rejects a malformed room id before any lookup', async () => {
        const socket = await connectSocket(server, owner);

        const error = once(socket, 'socket:error');
        socket.emit('join room', { roomId: 'not-a-uuid' });

        expect(await error).toMatchObject({ event: 'join room', message: expect.stringMatching(/roomId/) });
    });

    it('tells the existing occupant that somebody joined', async () => {
        const guest = await createUser(server);
        await addMember(owner, room, guest);

        const ownerSocket = await connectSocket(server, owner);
        await joinRoom(ownerSocket, room.id);

        const announced = once(ownerSocket, 'new member joined');
        const guestSocket = await connectSocket(server, guest);
        guestSocket.emit('join room', { roomId: room.id });

        expect((await announced).username).toBe(guest.user.username);
    });
});

describe('the two-user cap', () => {
    it('turns away a third live connection', async () => {
        const owner = await createUser(server);
        const guest = await createUser(server);
        const room = await createRoom(owner);
        await addMember(owner, room, guest);

        const first = await connectSocket(server, owner);
        await joinRoom(first, room.id);
        const second = await connectSocket(server, guest);
        await joinRoom(second, room.id);

        // A third socket, from a member, is still a third live connection.
        const third = await connectSocket(server, owner);
        const full = once(third, 'room full');
        third.emit('join room', { roomId: room.id });

        expect((await full).message).toMatch(/full/i);
    });

    it('lets a member who is already in the room re-emit join without being refused', async () => {
        const owner = await createUser(server);
        const guest = await createUser(server);
        const room = await createRoom(owner);
        await addMember(owner, room, guest);

        const ownerSocket = await connectSocket(server, owner);
        await joinRoom(ownerSocket, room.id);
        const guestSocket = await connectSocket(server, guest);
        await joinRoom(guestSocket, room.id);

        // The room is at capacity, but this socket is already one of the two —
        // capacity counts live connections, and it must not lock itself out.
        const rejoined = joinRoom(ownerSocket, room.id);
        await expect(rejoined).resolves.toBeDefined();
    });

    it('frees the seat when a socket disconnects', async () => {
        const owner = await createUser(server);
        const guest = await createUser(server);
        const room = await createRoom(owner);
        await addMember(owner, room, guest);

        const first = await connectSocket(server, owner);
        await joinRoom(first, room.id);
        const second = await connectSocket(server, guest);
        await joinRoom(second, room.id);

        second.disconnect();
        await once(first, 'member left');

        const replacement = await connectSocket(server, guest);
        await expect(joinRoom(replacement, room.id)).resolves.toBeDefined();
    });
});

describe('leave room', () => {
    it('stops the leaver receiving the room\'s broadcasts', async () => {
        const owner = await createUser(server);
        const guest = await createUser(server);
        const room = await createRoom(owner);
        await addMember(owner, room, guest);

        const ownerSocket = await connectSocket(server, owner);
        await joinRoom(ownerSocket, room.id);
        const guestSocket = await connectSocket(server, guest);
        await joinRoom(guestSocket, room.id);

        const left = once(ownerSocket, 'member left');
        guestSocket.emit('leave room', { roomId: room.id });
        expect((await left).username).toBe(guest.user.username);

        // Without the leave handler the socket stays subscribed and keeps
        // receiving the old room's traffic while the user is elsewhere.
        const silence = neverArrives(guestSocket, 'receive_message');
        ownerSocket.emit('send_message', { roomId: room.id, message: 'still here?' });
        await silence;
    });

    it('is a no-op for a room the socket never joined', async () => {
        const owner = await createUser(server);
        const room = await createRoom(owner);
        const socket = await connectSocket(server, owner);

        const silence = neverArrives(socket, 'socket:error');
        socket.emit('leave room', { roomId: room.id });
        await silence;
    });
});

describe('membership revoked mid-session', () => {
    it('stops a removed member from acting on the room', async () => {
        const owner = await createUser(server);
        const guest = await createUser(server);
        const room = await createRoom(owner);
        await addMember(owner, room, guest);

        const ownerSocket = await connectSocket(server, owner);
        await joinRoom(ownerSocket, room.id);
        const guestSocket = await connectSocket(server, guest);
        await joinRoom(guestSocket, room.id);

        await removeMember(room.id, guest.user.id, owner.user.id);

        // The socket is still connected and still in the Socket.IO room; the
        // guard re-checks the database on every event for exactly this case.
        const error = once(guestSocket, 'socket:error');
        const silence = neverArrives(ownerSocket, 'receive_message');
        guestSocket.emit('send_message', { roomId: room.id, message: 'let me back in' });

        expect(await error).toMatchObject({ event: 'membership' });
        await silence;
    });
});

describe('chat', () => {
    let owner;
    let guest;
    let room;
    let ownerSocket;
    let guestSocket;

    beforeEach(async () => {
        owner = await createUser(server);
        guest = await createUser(server);
        room = await createRoom(owner);
        await addMember(owner, room, guest);

        ownerSocket = await connectSocket(server, owner);
        await joinRoom(ownerSocket, room.id);
        guestSocket = await connectSocket(server, guest);
        await joinRoom(guestSocket, room.id);
    });

    it('delivers a message to both participants, including the sender', async () => {
        const toOwner = once(ownerSocket, 'receive_message');
        const toGuest = once(guestSocket, 'receive_message');
        ownerSocket.emit('send_message', { roomId: room.id, message: 'hello' });

        expect(await toOwner).toMatchObject({ message: 'hello', user: owner.user.username });
        expect(await toGuest).toMatchObject({ message: 'hello', user: owner.user.username });
    });

    it('attributes the message to the authenticated sender, ignoring a claimed author', async () => {
        const received = once(guestSocket, 'receive_message');
        ownerSocket.emit('send_message', {
            roomId: room.id,
            message: 'not from me',
            user: guest.user.username,
            userId: guest.user.id,
        });

        // Authorship moved server-side precisely so nobody can post as their
        // partner.
        const message = await received;
        expect(message.user).toBe(owner.user.username);
        expect(message.userId).toBe(owner.user.id);
    });

    it('replays history to a late joiner', async () => {
        const delivered = once(guestSocket, 'receive_message');
        ownerSocket.emit('send_message', { roomId: room.id, message: 'said before you arrived' });
        await delivered;

        // Free the seat first — capacity counts live connections, so a third
        // socket would be turned away before it ever saw the history.
        guestSocket.disconnect();
        await once(ownerSocket, 'member left');

        const rejoiner = await connectSocket(server, guest);
        const history = once(rejoiner, 'chat history');
        rejoiner.emit('join room', { roomId: room.id });

        expect((await history).messages).toEqual([
            expect.objectContaining({ message: 'said before you arrived', user: owner.user.username }),
        ]);
    });

    it('gives a new room an empty history rather than another room\'s', async () => {
        const delivered = once(guestSocket, 'receive_message');
        ownerSocket.emit('send_message', { roomId: room.id, message: 'private' });
        await delivered;

        const otherRoom = await createRoom(owner, 'Other');
        // A different room, so the cap on the first one does not apply.
        const socket = await connectSocket(server, owner);
        const history = once(socket, 'chat history');
        socket.emit('join room', { roomId: otherRoom.id });

        expect((await history).messages).toEqual([]);
    });

    it('rejects an over-length message without relaying it', async () => {
        const error = once(ownerSocket, 'socket:error');
        const silence = neverArrives(guestSocket, 'receive_message');
        ownerSocket.emit('send_message', { roomId: room.id, message: 'a'.repeat(5000) });

        expect(await error).toMatchObject({ event: 'send_message' });
        await silence;
    });

    it('rejects an empty message', async () => {
        const error = once(ownerSocket, 'socket:error');
        ownerSocket.emit('send_message', { roomId: room.id, message: '   ' });
        expect(await error).toMatchObject({ event: 'send_message' });
    });
});

describe('language sync', () => {
    it('broadcasts a change to the peer and replays it to a late joiner', async () => {
        const owner = await createUser(server);
        const guest = await createUser(server);
        const room = await createRoom(owner);
        await addMember(owner, room, guest);

        const ownerSocket = await connectSocket(server, owner);
        await joinRoom(ownerSocket, room.id);
        const guestSocket = await connectSocket(server, guest);
        await joinRoom(guestSocket, room.id);

        const changed = once(guestSocket, 'on language change');
        ownerSocket.emit('update language', { roomId: room.id, languageUsed: 'python' });
        expect(await changed).toEqual({ languageUsed: 'python' });

        guestSocket.disconnect();
        await once(ownerSocket, 'member left');

        const late = await connectSocket(server, guest);
        const replayed = once(late, 'on language change');
        late.emit('join room', { roomId: room.id });
        expect(await replayed).toEqual({ languageUsed: 'python' });
    });
});

describe('whiteboard', () => {
    // Strokes moved onto Yjs (`<roomId>:__whiteboard__`), which is what gives a
    // late joiner the history the relay never stored. The relay is gone, and
    // this asserts that rather than leaving a dead second sync path in place:
    // if `draw` were still handled, the two paths would double every stroke.
    it('no longer relays strokes over Socket.IO', async () => {
        const owner = await createUser(server);
        const guest = await createUser(server);
        const room = await createRoom(owner);
        await addMember(owner, room, guest);

        const ownerSocket = await connectSocket(server, owner);
        await joinRoom(ownerSocket, room.id);
        const guestSocket = await connectSocket(server, guest);
        await joinRoom(guestSocket, room.id);

        const silence = neverArrives(guestSocket, 'on draw');
        ownerSocket.emit('draw', {
            roomId: room.id,
            data: { prevPos: { x: 0, y: 0 }, currPos: { x: 10, y: 10 } },
        });

        await silence;
    });
});
