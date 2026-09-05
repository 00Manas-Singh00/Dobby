/**
 * Two replicas, one room.
 *
 * This is the test Phase 4 exists for, and it is the only one in the suite that
 * cannot be written against a single server: every property here is one that a
 * single process gets right for free and two processes can get wrong.
 *
 * It needs a real Redis. Faking it would be self-defeating — the failures being
 * guarded against live in the adapter's wire format, in `SET NX PX` semantics,
 * and in whether `allSockets()` actually consults the adapter — so with no
 * `REDIS_URL` the whole file skips rather than pretending to pass. CI provides
 * one; see `.github/workflows/ci.yml`.
 *
 * Both replicas share this process's SQLite database, which is what a single
 * host would do anyway (ADR-010), so identity and membership are common and the
 * only variable under test is the cluster wiring.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createRequire } from 'module';
import {
    startReplica,
    stopAllReplicas,
    connectTo,
    connectDocument,
    closeReplicaSockets,
} from '../helpers/replica.js';
import { createUser, createRoom, addMember, once } from '../helpers/server.js';

// The same Yjs instance the server uses. An ESM `import` here would be a second
// copy of the module, and Yjs warns about exactly that — see the note in
// services/yjsService.js.
const require = createRequire(import.meta.url);
const Y = require('yjs');

const describeCluster = process.env.REDIS_URL ? describe : describe.skip;

describeCluster('two replicas sharing one Redis', () => {
    let nodeA;
    let nodeB;
    let owner;
    let guest;
    let room;

    beforeAll(async () => {
        [nodeA, nodeB] = await Promise.all([
            startReplica('test-node-a'),
            startReplica('test-node-b'),
        ]);

        // Accounts and rooms go through node A; both replicas read the same
        // SQLite file, so membership is shared without any cluster machinery.
        owner = await createUser(nodeA);
        guest = await createUser(nodeA);
        room = await createRoom(owner);
        await addMember(owner, room, guest);
    }, 40_000);

    afterEach(() => closeReplicaSockets());

    afterAll(async () => {
        await stopAllReplicas();
    });

    describe('room membership spans both nodes', () => {
        it('delivers a chat message across replicas', async () => {
            const a = await connectTo(nodeA, owner);
            const b = await connectTo(nodeB, guest);

            a.emit('join room', { roomId: room.id });
            await once(a, 'updating client list');
            b.emit('join room', { roomId: room.id });
            await once(b, 'updating client list');

            const received = once(b, 'receive_message');
            a.emit('send_message', { roomId: room.id, message: 'across the cluster' });

            // Without the Redis adapter this simply never arrives — the two
            // people would each be alone in their own copy of the room.
            expect((await received).message).toBe('across the cluster');
        });

        it('shows both people in the client list, whichever node they are on', async () => {
            const a = await connectTo(nodeA, owner);
            a.emit('join room', { roomId: room.id });
            await once(a, 'updating client list');

            const b = await connectTo(nodeB, guest);
            const listOnA = once(a, 'updating client list');
            b.emit('join room', { roomId: room.id });

            expect((await listOnA).userslist.sort()).toEqual(
                [owner.user.username, guest.user.username].sort()
            );
        });

        it('propagates a language change to the other node', async () => {
            const a = await connectTo(nodeA, owner);
            const b = await connectTo(nodeB, guest);
            a.emit('join room', { roomId: room.id });
            await once(a, 'updating client list');
            b.emit('join room', { roomId: room.id });
            await once(b, 'updating client list');

            const changed = once(b, 'on language change');
            a.emit('update language', { roomId: room.id, languageUsed: 'python' });

            expect((await changed).languageUsed).toBe('python');
        });

        it('replays the shared language to a joiner on the other node', async () => {
            const a = await connectTo(nodeA, owner);
            a.emit('join room', { roomId: room.id });
            await once(a, 'updating client list');
            a.emit('update language', { roomId: room.id, languageUsed: 'rust' });
            await new Promise((resolve) => setTimeout(resolve, 200));

            const b = await connectTo(nodeB, guest);
            const replayed = once(b, 'on language change');
            b.emit('join room', { roomId: room.id });

            // The language lived in a per-process object through Phase 3, so
            // this is the case that used to depend on which node you landed on.
            expect((await replayed).languageUsed).toBe('rust');
        });

        it('enforces the two-connection cap across the cluster, not per node', async () => {
            // A room holds two *members* (ADR-006) and the database enforces
            // that, so the third connection has to come from someone already in
            // the room — a second tab. The cap counts live connections, and
            // that count is the thing that used to be per-process.
            const a = await connectTo(nodeA, owner);
            a.emit('join room', { roomId: room.id });
            await once(a, 'updating client list');

            const b = await connectTo(nodeB, guest);
            b.emit('join room', { roomId: room.id });
            await once(b, 'updating client list');

            const secondTab = await connectTo(nodeB, owner);
            const refused = once(secondTab, 'room full');
            secondTab.emit('join room', { roomId: room.id });

            // Counting `adapter.rooms` locally would have let this through:
            // node B can see only one of the two existing connections.
            await expect(refused).resolves.toBeTruthy();
        });
    });

    describe('documents are owned by exactly one node', () => {
        it('serves a document from the node that claimed it', async () => {
            const first = await connectDocument(nodeA, owner, `${room.id}:owned`);
            expect(first.ok).toBe(true);
        });

        it('lets the second person join the same document on the owning node', async () => {
            const first = await connectDocument(nodeA, owner, `${room.id}:together`);
            expect(first.ok).toBe(true);

            const second = await connectDocument(nodeA, guest, `${room.id}:together`);
            expect(second.ok).toBe(true);
        });

        it('refuses the same document on the other node, naming the owner', async () => {
            const first = await connectDocument(nodeA, owner, `${room.id}:contested`);
            expect(first.ok).toBe(true);

            const misrouted = await connectDocument(nodeB, guest, `${room.id}:contested`);

            // This is the whole point. Accepting here would give the two people
            // separate copies of one file and lose whichever of them stopped
            // typing first.
            expect(misrouted.ok).toBe(false);
            expect(misrouted.error.data?.code).toBe('DOCUMENT_MOVED');
            expect(misrouted.error.data?.owner?.nodeId).toBe('test-node-a');
        });

        it('lets the other node take the document once the first releases it', async () => {
            const first = await connectDocument(nodeA, owner, `${room.id}:handoff`);
            expect(first.ok).toBe(true);

            first.socket.disconnect();
            await new Promise((resolve) => setTimeout(resolve, 500));

            const second = await connectDocument(nodeB, guest, `${room.id}:handoff`);
            expect(second.ok).toBe(true);
        });

        it('still refuses a non-member before any lease is involved', async () => {
            const outsider = await createUser(nodeA);
            const refused = await connectDocument(nodeB, outsider, `${room.id}:private`);

            expect(refused.ok).toBe(false);
            // Authorization first: a stranger must not be able to take the lease
            // on a document and evict the node legitimately serving it.
            expect(refused.error.data?.code).not.toBe('DOCUMENT_MOVED');
        });

        it('counts a misroute so a broken balancer is visible', async () => {
            const first = await connectDocument(nodeA, owner, `${room.id}:counted`);
            expect(first.ok).toBe(true);
            await connectDocument(nodeB, guest, `${room.id}:counted`);

            const { text } = await nodeB.api().get('/metrics').expect(200);
            const line = text
                .split('\n')
                .find((row) => row.startsWith('dobby_document_lease_conflicts_total{'));

            expect(Number(line.slice(line.lastIndexOf(' ') + 1))).toBeGreaterThan(0);
        });
    });

    describe('document content is shared storage, not one node\'s disk', () => {
        it('gives the other node the content the first one wrote', async () => {
            const name = `${room.id}:shared-state`;

            const first = await connectDocument(nodeA, owner, name);
            expect(first.ok).toBe(true);

            const doc = new Y.Doc();
            doc.getText('monaco').insert(0, 'written on node A');
            // `sync-update` is the client-to-server edit channel; node A applies
            // it to its live document, which writes through to Redis.
            first.socket.emit('sync-update', Y.encodeStateAsUpdate(doc));
            await new Promise((resolve) => setTimeout(resolve, 400));

            first.socket.disconnect();
            await new Promise((resolve) => setTimeout(resolve, 600));

            // Node B now claims the released document and must load it from
            // Redis. With LevelDB the state would still be on node A's disk and
            // this would come back empty — which is exactly why the persistence
            // backend had to change for cluster mode.
            const second = await connectDocument(nodeB, guest, name);
            expect(second.ok).toBe(true);

            // y-socket.io pushes the document's state to a joining client
            // unprompted, so there is nothing to ask for — the arrival of this
            // update *is* the assertion that node B found the content.
            const state = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('no sync-update')), 5000);
                second.socket.on('sync-update', (update) => {
                    clearTimeout(timer);
                    resolve(update);
                });
            });

            const loaded = new Y.Doc();
            Y.applyUpdate(loaded, new Uint8Array(state));
            expect(loaded.getText('monaco').toString()).toBe('written on node A');
        });
    });
});
