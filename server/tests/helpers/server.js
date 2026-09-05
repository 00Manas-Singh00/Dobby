/**
 * tests/helpers/server.js
 * Boots a real Dobby server on an ephemeral port and hands back authenticated
 * clients for it.
 *
 * The integration tests deliberately drive the actual Socket.IO surface rather
 * than calling handlers directly: the things Phase 1 added — the handshake
 * check, the rate limiter, the schema, the membership guard — all live in the
 * wiring, and a test that bypasses the wiring would not see them.
 */

import { io as ioClient } from 'socket.io-client';
import request from 'supertest';
import { createDobbyServer } from '../../index.js';

/** Start a server listening on a port the OS picks. */
export async function startTestServer(options = {}) {
    // `cluster: false` unless a test asks otherwise: an ambient REDIS_URL in the
    // developer's shell must not silently change what the suite is testing.
    const instance = await createDobbyServer({ retention: false, cluster: false, ...options });

    await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
    const { port } = instance.server.address();

    return {
        ...instance,
        port,
        url: `http://127.0.0.1:${port}`,
        api: () => request(instance.app),
        async stop() {
            await instance.close();
            await new Promise((resolve) => instance.server.close(resolve));
        },
    };
}

let userCounter = 0;

/** Register a fresh account and return its session plus a request helper. */
export async function createUser(server, overrides = {}) {
    userCounter += 1;
    const credentials = {
        email: `user${userCounter}-${Date.now()}@example.com`,
        username: `user${userCounter}`,
        password: 'correct horse battery staple',
        ...overrides,
    };

    const response = await server.api().post('/api/auth/register').send(credentials).expect(200);

    return {
        ...response.body, // { user, accessToken, refreshToken }
        credentials,
        /** A supertest chain with this user's bearer token already attached. */
        get: (path) => server.api().get(path).set('Authorization', `Bearer ${response.body.accessToken}`),
        post: (path) => server.api().post(path).set('Authorization', `Bearer ${response.body.accessToken}`),
        patch: (path) => server.api().patch(path).set('Authorization', `Bearer ${response.body.accessToken}`),
        delete: (path) => server.api().delete(path).set('Authorization', `Bearer ${response.body.accessToken}`),
    };
}

/** Create a room owned by `owner`. */
export async function createRoom(owner, name = 'Test room') {
    const response = await owner.post('/api/rooms').send({ name }).expect(200);
    return response.body.room;
}

/** Invite `guest` into `room` and redeem it, so they become a member. */
export async function addMember(owner, room, guest) {
    const { body } = await owner.post(`/api/rooms/${room.id}/invites`).send().expect(200);
    await guest.post('/api/rooms/join').send({ token: body.invite.token }).expect(200);
    return body.invite;
}

const openSockets = new Set();

/**
 * Connect a Socket.IO client with `user`'s access token, resolving once the
 * handshake completes. Rejects if the server refuses the connection, so an
 * auth failure surfaces as a failed assertion rather than a timeout.
 */
export function connectSocket(server, user, options = {}) {
    const socket = ioClient(server.url, {
        auth: { token: user.accessToken },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
        ...options,
    });
    openSockets.add(socket);

    return new Promise((resolve, reject) => {
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', (error) => reject(error));
    });
}

/** Connect expecting rejection; resolves with the handshake error. */
export function expectSocketRejected(server, token) {
    const socket = ioClient(server.url, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
    });
    openSockets.add(socket);

    return new Promise((resolve, reject) => {
        socket.once('connect_error', (error) => resolve(error));
        socket.once('connect', () => reject(new Error('Expected the handshake to be rejected.')));
    });
}

/** Resolve with the next `event` payload, or reject after `timeoutMs`. */
export function once(socket, event, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`Timed out waiting for "${event}"`)),
            timeoutMs
        );
        socket.once(event, (payload) => {
            clearTimeout(timer);
            resolve(payload);
        });
    });
}

/**
 * Assert that `event` does NOT arrive within `windowMs`.
 *
 * Used for the authorization tests, where the failure being guarded against is
 * a message reaching someone it should not — an absence, which only a wait can
 * establish.
 */
export function neverArrives(socket, event, windowMs = 400) {
    return new Promise((resolve, reject) => {
        const handler = (payload) => {
            clearTimeout(timer);
            reject(new Error(`Unexpectedly received "${event}": ${JSON.stringify(payload)}`));
        };
        const timer = setTimeout(() => {
            socket.off(event, handler);
            resolve();
        }, windowMs);
        socket.on(event, handler);
    });
}

/** Join a room and wait for the client list that confirms it. */
export async function joinRoom(socket, roomId) {
    const joined = once(socket, 'updating client list');
    socket.emit('join room', { roomId });
    return joined;
}

/** Disconnect every socket opened through this helper. */
export function closeAllSockets() {
    for (const socket of openSockets) socket.disconnect();
    openSockets.clear();
}
