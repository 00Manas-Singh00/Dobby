/**
 * The REST surface end to end: register, refresh, create a room, invite,
 * redeem, leave.
 *
 * The unit tests cover the services; this covers the wiring around them — the
 * status codes, the validation middleware, and the fact that each route sits
 * behind the gate it is supposed to.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer, createUser, createRoom } from '../helpers/server.js';

let server;

beforeAll(async () => {
    server = await startTestServer();
});

afterAll(async () => {
    await server.stop();
});

const credentials = (n) => ({
    email: `rest${n}-${Date.now()}@example.com`,
    username: `rest${n}`,
    password: 'correct horse battery staple',
});

describe('health', () => {
    it('is the one endpoint reachable anonymously', async () => {
        const { body } = await server.api().get('/health').expect(200);
        expect(body.status).toBe('ok');
        // It reveals nothing about the instance beyond liveness.
        expect(Object.keys(body).sort()).toEqual(['status', 'time']);
    });
});

describe('POST /api/auth/register', () => {
    it('creates an account and returns a usable session', async () => {
        const account = credentials('a');
        const { body } = await server.api().post('/api/auth/register').send(account).expect(200);

        expect(body.user).toMatchObject({ username: account.username, email: account.email.toLowerCase() });
        await server.api().get('/api/auth/me').set('Authorization', `Bearer ${body.accessToken}`).expect(200);
    });

    it('rejects a short password with a message naming the field', async () => {
        const { body } = await server
            .api()
            .post('/api/auth/register')
            .send({ ...credentials('b'), password: 'short' })
            .expect(400);

        expect(body.error).toMatch(/password/i);
    });

    it('rejects a duplicate email with 409', async () => {
        const account = credentials('c');
        await server.api().post('/api/auth/register').send(account).expect(200);
        await server.api().post('/api/auth/register').send(account).expect(409);
    });
});

describe('POST /api/auth/login and /refresh', () => {
    it('logs in and refreshes, rotating the refresh token', async () => {
        const account = credentials('d');
        await server.api().post('/api/auth/register').send(account).expect(200);

        const { body: session } = await server
            .api()
            .post('/api/auth/login')
            .send({ email: account.email, password: account.password })
            .expect(200);

        const { body: refreshed } = await server
            .api()
            .post('/api/auth/refresh')
            .send({ refreshToken: session.refreshToken })
            .expect(200);

        expect(refreshed.refreshToken).not.toBe(session.refreshToken);
        // Replaying the spent token must not yield a second session.
        await server.api().post('/api/auth/refresh').send({ refreshToken: session.refreshToken }).expect(401);
    });

    it('answers 401 for a wrong password', async () => {
        const account = credentials('e');
        await server.api().post('/api/auth/register').send(account).expect(200);
        await server
            .api()
            .post('/api/auth/login')
            .send({ email: account.email, password: 'not the password' })
            .expect(401);
    });
});

describe('POST /api/auth/logout', () => {
    it('revokes the presented refresh token', async () => {
        const user = await createUser(server);

        await server.api().post('/api/auth/logout').send({ refreshToken: user.refreshToken }).expect(200);
        await server.api().post('/api/auth/refresh').send({ refreshToken: user.refreshToken }).expect(401);
    });

    it('logout-all requires a token and ends every session', async () => {
        const user = await createUser(server);
        await server.api().post('/api/auth/logout-all').expect(401);

        await user.post('/api/auth/logout-all').send().expect(200);
        await server.api().post('/api/auth/refresh').send({ refreshToken: user.refreshToken }).expect(401);
    });
});

describe('the invite flow', () => {
    it('carries a guest from invited to member', async () => {
        const owner = await createUser(server);
        const guest = await createUser(server);
        const room = await createRoom(owner, 'Interview');

        // Before: the room id alone gets the guest nothing.
        await guest.get(`/api/rooms/${room.id}`).expect(404);

        const { body: minted } = await owner.post(`/api/rooms/${room.id}/invites`).send().expect(200);
        await guest.post('/api/rooms/join').send({ token: minted.invite.token }).expect(200);

        const { body: seen } = await guest.get(`/api/rooms/${room.id}`).expect(200);
        expect(seen.members.map((m) => m.id).sort()).toEqual([owner.user.id, guest.user.id].sort());
        expect(seen.members.find((m) => m.id === guest.user.id).role).toBe('guest');
    });

    it('refuses a second redemption of the same token', async () => {
        const owner = await createUser(server);
        const guest = await createUser(server);
        const stranger = await createUser(server);
        const room = await createRoom(owner);

        const { body } = await owner.post(`/api/rooms/${room.id}/invites`).send().expect(200);
        await guest.post('/api/rooms/join').send({ token: body.invite.token }).expect(200);
        await stranger.post('/api/rooms/join').send({ token: body.invite.token }).expect(410);
    });

    it('refuses an unknown token with 404', async () => {
        const guest = await createUser(server);
        await guest.post('/api/rooms/join').send({ token: 'never-issued' }).expect(404);
    });

    it('lets a guest remove themselves, losing access', async () => {
        const owner = await createUser(server);
        const guest = await createUser(server);
        const room = await createRoom(owner);

        const { body } = await owner.post(`/api/rooms/${room.id}/invites`).send().expect(200);
        await guest.post('/api/rooms/join').send({ token: body.invite.token }).expect(200);

        await guest.delete(`/api/rooms/${room.id}/members/${guest.user.id}`).expect(200);
        await guest.get(`/api/rooms/${room.id}`).expect(404);
    });

    it('lets the owner revoke a pending invite before it is used', async () => {
        const owner = await createUser(server);
        const guest = await createUser(server);
        const room = await createRoom(owner);

        const { body } = await owner.post(`/api/rooms/${room.id}/invites`).send().expect(200);
        await owner.delete(`/api/rooms/${room.id}/invites/${body.invite.token}`).expect(200);
        await guest.post('/api/rooms/join').send({ token: body.invite.token }).expect(404);
    });
});

describe('POST /api/execute', () => {
    it('validates its input before reaching Piston', async () => {
        const user = await createUser(server);

        await user.post('/api/execute').send({ code: 'print(1)' }).expect(400);
        await user.post('/api/execute').send({ language: 'python' }).expect(400);
        await user.post('/api/execute').send({ language: 'python', code: 'a'.repeat(100_001) }).expect(400);
        await user
            .post('/api/execute')
            .send({ language: 'python', code: '1', filename: '../../etc/passwd' })
            .expect(400);
    });
});
