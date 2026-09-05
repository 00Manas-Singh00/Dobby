/**
 * tests/helpers/replica.js
 * Starts Dobby as a separate process, so a test can have a real second replica.
 *
 * Every replica inherits the test process's environment, so it talks to the
 * same store: one SQLite file when that is what the run is using (which two
 * replicas on one host genuinely share — ADR-010), or the same Postgres schema
 * when `DATABASE_URL` is set, which is the arrangement Phase 5 exists to make
 * possible (ADR-017). Either way this is the deployment being tested rather
 * than a simplification of it. What differs between replicas is only
 * `NODE_ID`.
 */

import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';

const ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'replicaEntry.js');

const running = new Set();

/**
 * Fork one replica and resolve once it is listening.
 *
 * @param {string} nodeId
 * @param {object} [env] extra environment for this replica
 */
export function startReplica(nodeId, env = {}) {
    const child = fork(ENTRY, [], {
        env: {
            ...process.env,
            NODE_ID: nodeId,
            PORT: '0',
            // Documents are shared through Redis in cluster mode; a LevelDB
            // directory here would be a second, per-node copy of the truth and
            // would defeat the handoff this exists to test.
            YJS_PERSISTENCE_DIR: '',
            ...env,
        },
        // `pipe` so the port line can be read; the child's stderr is forwarded
        // so a startup failure is visible rather than a timeout.
        stdio: ['ignore', 'pipe', 'inherit', 'ipc'],
    });
    running.add(child);

    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`Replica ${nodeId} did not start within 15s`)),
            15_000
        );

        let buffered = '';
        child.stdout.on('data', (chunk) => {
            buffered += chunk.toString();
            const match = buffered.match(/READY (\d+)/);
            if (!match) return;

            clearTimeout(timer);
            const url = `http://127.0.0.1:${match[1]}`;
            resolve({
                nodeId,
                url,
                child,
                api: () => request(url),
                async stop() {
                    await stopReplica(child);
                },
            });
        });

        child.once('exit', (code) => {
            clearTimeout(timer);
            reject(new Error(`Replica ${nodeId} exited with code ${code} before listening`));
        });
    });
}

function stopReplica(child) {
    if (!running.has(child)) return Promise.resolve();
    running.delete(child);

    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            resolve();
        }, 5000);

        child.once('exit', () => {
            clearTimeout(timer);
            resolve();
        });
        child.send('shutdown');
    });
}

/** Stop every replica this helper started. */
export async function stopAllReplicas() {
    await Promise.all([...running].map(stopReplica));
}

const sockets = new Set();

/** Connect to a replica's main namespace with `user`'s token. */
export function connectTo(replica, user, options = {}) {
    const socket = ioClient(replica.url, {
        auth: { token: user.accessToken },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
        ...options,
    });
    sockets.add(socket);

    return new Promise((resolve, reject) => {
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
    });
}

/**
 * Connect to a document namespace the way `SocketIOProvider` does, including
 * the `?doc=` routing hint.
 *
 * Resolves with `{ ok }` either way rather than rejecting, because a refusal is
 * the expected outcome in half these tests and its payload is the assertion.
 */
export function connectDocument(replica, user, docName) {
    const socket = ioClient(`${replica.url}/yjs|${docName}`, {
        auth: { token: user.accessToken },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
        query: { doc: docName },
    });
    sockets.add(socket);

    return new Promise((resolve) => {
        socket.once('connect', () => resolve({ ok: true, socket }));
        socket.once('connect_error', (error) => resolve({ ok: false, error, socket }));
    });
}

/** Disconnect every socket opened through this helper. */
export function closeReplicaSockets() {
    for (const socket of sockets) socket.disconnect();
    sockets.clear();
}
