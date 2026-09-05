/**
 * The metrics endpoint.
 *
 * Two things are being checked, and the first matters more. `/metrics` is an
 * inventory of the instance — how many rooms exist, who is connected, how large
 * the documents are — so the access rules around it are a security boundary and
 * are tested as one. Only then does it matter that the numbers are right.
 *
 * The gauge assertions drive real sockets rather than calling the collectors
 * directly: a gauge is only useful if it reflects what the server is actually
 * doing, and a collector tested in isolation would pass while wired to nothing.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import {
    startTestServer,
    createUser,
    createRoom,
    addMember,
    connectSocket,
    joinRoom,
    closeAllSockets,
} from '../helpers/server.js';

/** Parse one sample out of the exposition format, ignoring its labels. */
function sampleValue(body, name) {
    const line = body
        .split('\n')
        .find((row) => row.startsWith(`${name}{`) || row.startsWith(`${name} `));
    return line ? Number(line.slice(line.lastIndexOf(' ') + 1)) : null;
}

describe('metrics', () => {
    let server;
    let owner;
    let guest;
    let room;

    beforeAll(async () => {
        server = await startTestServer();
        owner = await createUser(server);
        guest = await createUser(server);
        room = await createRoom(owner);
        await addMember(owner, room, guest);
    });

    afterEach(() => closeAllSockets());

    afterAll(async () => {
        await server.stop();
    });

    describe('access', () => {
        it('serves supertest, which connects over loopback', async () => {
            const response = await server.api().get('/metrics').expect(200);
            expect(response.headers['content-type']).toContain('text/plain');
        });

        it('needs no user token — a scraper is not a user', async () => {
            // The alternative would be a long-lived account password sitting in
            // a Prometheus config, which is worse than the thing it protects.
            await server.api().get('/metrics').expect(200);
        });

        it('is mounted outside /api, so it carries its own guard rather than the API\'s', async () => {
            // 401 rather than 404 because `/api` is blanket-authenticated; the
            // point is that no exposition comes back from that path, so the
            // guard in routes/metrics.js is the only way in.
            const response = await server.api().get('/api/metrics');
            expect(response.status).toBe(401);
            expect(response.text).not.toContain('dobby_active_rooms');
        });
    });

    describe('exposition', () => {
        it('labels every sample with the node id, so a cluster can be summed', async () => {
            const { text } = await server.api().get('/metrics').expect(200);
            expect(text).toMatch(/node="[^"]+"/);
        });

        it('includes process metrics, which is how document growth is watched', async () => {
            const { text } = await server.api().get('/metrics').expect(200);
            expect(text).toContain('dobby_process_resident_memory_bytes');
        });

        it('declares the Phase 4 gauges even before anything has happened', async () => {
            const { text } = await server.api().get('/metrics').expect(200);
            for (const name of [
                'dobby_active_rooms',
                'dobby_connected_sockets',
                'dobby_live_terminals',
                'dobby_yjs_documents_open',
                'dobby_yjs_document_bytes',
                'dobby_document_lease_conflicts_total',
            ]) {
                expect(text).toContain(name);
            }
        });
    });

    describe('gauges follow the server', () => {
        it('counts connected sockets and active rooms', async () => {
            const before = await server.api().get('/metrics').expect(200);
            const baselineSockets = sampleValue(before.text, 'dobby_connected_sockets');
            const baselineRooms = sampleValue(before.text, 'dobby_active_rooms');

            const socket = await connectSocket(server, owner);
            await joinRoom(socket, room.id);

            const during = await server.api().get('/metrics').expect(200);
            expect(sampleValue(during.text, 'dobby_connected_sockets')).toBe(baselineSockets + 1);
            // The socket's own id-named room must not be counted as a room.
            expect(sampleValue(during.text, 'dobby_active_rooms')).toBe(baselineRooms + 1);

            socket.disconnect();
            await new Promise((resolve) => setTimeout(resolve, 200));

            const after = await server.api().get('/metrics').expect(200);
            expect(sampleValue(after.text, 'dobby_connected_sockets')).toBe(baselineSockets);
        });

        it('counts socket events by outcome', async () => {
            const socket = await connectSocket(server, guest);
            await joinRoom(socket, room.id);

            const { text } = await server.api().get('/metrics').expect(200);
            expect(text).toContain('dobby_socket_events_total{event="join room",outcome="ok"');
        });

        it('records a rejected event separately from a successful one', async () => {
            const outsider = await createUser(server);
            const socket = await connectSocket(server, outsider);

            socket.emit('send_message', { roomId: room.id, message: 'hello' });
            await new Promise((resolve) => setTimeout(resolve, 200));

            const { text } = await server.api().get('/metrics').expect(200);
            // A membership rejection and a malformed payload look identical in a
            // single error count; they are different incidents.
            expect(text).toContain('outcome="denied"');
        });

        it('records a malformed payload as invalid rather than as an error', async () => {
            const socket = await connectSocket(server, owner);
            socket.emit('join room', { roomId: 12345 });
            await new Promise((resolve) => setTimeout(resolve, 200));

            const { text } = await server.api().get('/metrics').expect(200);
            expect(text).toContain('outcome="invalid"');
        });

        it('times REST requests by matched route, not by URL', async () => {
            await owner.get(`/api/rooms/${room.id}`).expect(200);

            const { text } = await server.api().get('/metrics').expect(200);
            expect(text).toContain('dobby_http_request_duration_seconds_count');
            // One time series per room id would take the metrics backend down.
            expect(text).not.toContain(room.id);
        });
    });
});
