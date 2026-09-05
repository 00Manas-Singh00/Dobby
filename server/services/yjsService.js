/**
 * services/yjsService.js
 * Manages Yjs document state per room using y-socket.io.
 * Provides conflict-free, real-time collaborative editing via CRDT.
 *
 * Beyond transport, this module owns two things the rest of the server relies
 * on:
 *  1. Authorization for document namespaces. Yjs rides its own dynamic
 *     namespaces (`/yjs|<roomId>:<fileId>`), which do NOT pass through the main
 *     Socket.IO connection middleware. Without the check below, an
 *     authenticated user could open any room's document by naming it.
 *  2. Retention. Document state is the one thing Dobby persists to disk, so the
 *     delete path and the expiry sweep live here.
 */

import { createRequire } from 'module';
import { isMember } from './roomService.js';
import { verifyAccessToken } from './authService.js';

const require = createRequire(import.meta.url);
const { YSocketIO } = require('y-socket.io/dist/server');

// LevelDB takes an exclusive lock on its directory, so two servers in one
// process cannot share it. Setting YJS_PERSISTENCE_DIR to an empty string runs
// the CRDT entirely in memory, which is what the integration tests want.
const PERSISTENCE_DIR =
    process.env.YJS_PERSISTENCE_DIR === ''
        ? null
        : process.env.YJS_PERSISTENCE_DIR || './.yjs-persistence';

let ysocketio = null;

/**
 * Document names are `<roomId>:<fileId>`. The room id is the part that carries
 * authorization; the file id only scopes the document within it.
 */
function roomIdFromDocName(docName) {
    const [roomId] = docName.split(':');
    return roomId || null;
}

/** Namespace names are `/yjs|<docName>`. */
function docNameFromNamespace(namespaceName) {
    return namespaceName.replace(/^\/yjs\|/, '');
}

/**
 * Set up the Yjs provider on the existing Socket.IO server.
 *
 * @param {import('socket.io').Server} io - The Socket.IO server instance
 */
export function setupYjs(io) {
    ysocketio = new YSocketIO(io, {
        ...(PERSISTENCE_DIR ? { levelPersistenceDir: PERSISTENCE_DIR } : {}),
        gcEnabled: true,
    });
    ysocketio.initialize();

    // Registered after initialize() so it runs alongside y-socket.io's own
    // handshake hook. Middleware added to a parent (dynamic) namespace is
    // copied onto each child namespace as it is created, so this applies to
    // every document namespace including ones that do not exist yet.
    ysocketio.nsp.use((socket, next) => {
        const token =
            socket.handshake.auth?.token ||
            (socket.handshake.headers?.authorization || '').replace(/^Bearer /, '');

        if (!token) return next(new Error('Authentication required.'));

        let user;
        try {
            user = verifyAccessToken(token);
        } catch (error) {
            return next(new Error(error.message));
        }

        // The room is taken from the namespace the client actually connected
        // to, never from the handshake payload — otherwise a client could
        // present a room it belongs to while opening a document from another.
        const roomId = roomIdFromDocName(docNameFromNamespace(socket.nsp.name));
        if (!roomId) return next(new Error('Malformed document name.'));

        if (!isMember(roomId, user.id)) {
            console.warn(
                `[Yjs] Rejected ${user.username} (${user.id}) for document in room ${roomId}`
            );
            return next(new Error('Not a member of this room.'));
        }

        socket.data.user = user;
        return next();
    });

    console.log(
        PERSISTENCE_DIR
            ? '✓ Yjs CRDT service initialized with LevelDB persistence (membership-gated)'
            : '✓ Yjs CRDT service initialized in memory, no persistence (membership-gated)'
    );
}

/** The underlying `LeveldbPersistence`, or null when persistence is disabled. */
function persistenceProvider() {
    return ysocketio?.persistence?.provider ?? null;
}

/**
 * Delete every stored document belonging to a room, and disconnect anyone
 * currently editing them. Called when a room is deleted and by the retention
 * sweep.
 *
 * @param {string} roomId
 * @returns {Promise<number>} number of documents removed
 */
export async function deleteRoomDocuments(roomId) {
    if (!ysocketio) return 0;

    // Destroy live documents first. Destroying (rather than deleting from the
    // map) is what closes the open connections; otherwise a connected client
    // would immediately re-persist the state we just cleared.
    for (const [name, doc] of [...ysocketio.documents.entries()]) {
        if (roomIdFromDocName(name) === roomId) {
            try {
                await doc.destroy();
            } catch (error) {
                console.error(`[Yjs] Failed to destroy document ${name}:`, error.message);
            }
        }
    }

    const provider = persistenceProvider();
    if (!provider) return 0;

    const names = await provider.getAllDocNames();
    const owned = names.filter((name) => roomIdFromDocName(name) === roomId);

    for (const name of owned) {
        await provider.clearDocument(name);
    }

    if (owned.length > 0) {
        console.log(`[Yjs] Cleared ${owned.length} document(s) for room ${roomId}`);
    }
    return owned.length;
}

/**
 * Drop documents whose room no longer exists in SQLite.
 *
 * Document state previously accumulated on disk forever with no delete path.
 * This is the backstop for rooms deleted while the process was down, and for
 * documents orphaned by a partial delete.
 *
 * @param {(roomId: string) => boolean} roomExists
 * @returns {Promise<number>}
 */
export async function pruneOrphanedDocuments(roomExists) {
    const provider = persistenceProvider();
    if (!provider) return 0;

    const names = await provider.getAllDocNames();
    let removed = 0;

    for (const name of names) {
        const roomId = roomIdFromDocName(name);
        if (!roomId || roomExists(roomId)) continue;
        // Never clear a document that is currently open — its room row may be
        // mid-creation, and the live doc would rewrite the state anyway.
        if (ysocketio?.documents.has(name)) continue;

        await provider.clearDocument(name);
        removed += 1;
    }

    if (removed > 0) console.log(`[Yjs] Retention sweep cleared ${removed} orphaned document(s)`);
    return removed;
}

/** Names of every persisted document. Exposed for diagnostics and tests. */
export async function listDocumentNames() {
    const provider = persistenceProvider();
    return provider ? provider.getAllDocNames() : [];
}
