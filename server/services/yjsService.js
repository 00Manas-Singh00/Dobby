/**
 * services/yjsService.js
 * Manages Yjs document state per room using y-socket.io.
 * Provides conflict-free, real-time collaborative editing via CRDT.
 *
 * This replaces the naive `update code` / `on code change` socket pattern
 * with a proper CRDT-based sync that:
 *  1. Handles concurrent edits without conflicts or cursor jumps
 *  2. Provides awareness protocol for cursor presence (who is where)
 *  3. Stores document state in-memory per room (upgradeable to LevelDB/Redis)
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { YSocketIO } = require('y-socket.io/dist/server');

/**
 * Set up the Yjs WebSocket provider on the existing Socket.IO server.
 *
 * @param {import('socket.io').Server} io - The Socket.IO server instance
 */
export function setupYjs(io) {
    const ysocketio = new YSocketIO(io, {
        levelPersistenceDir: './.yjs-persistence',
        gcEnabled: true,
    });
    ysocketio.initialize();

    console.log('✓ Yjs CRDT service initialized with LevelDB persistence');
}
