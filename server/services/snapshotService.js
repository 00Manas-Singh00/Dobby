/**
 * services/snapshotService.js
 * Point-in-time history for Yjs documents.
 *
 * The document store holds the *current* state of a document and nothing else,
 * so until now there was no answer to "put it back the way it was an hour ago".
 * This module adds one: a periodic pass encodes each open document's state as
 * an update and stores it in the relational store, and a restore path rewrites
 * a document to match one of those.
 *
 * Two design points worth stating.
 *
 * **Why a timer rather than a hook on every update.** Snapshotting per update
 * would write a blob per keystroke. The pass instead runs on an interval and
 * skips any document whose state vector is unchanged since its last snapshot,
 * so an idle room costs one comparison and no writes.
 *
 * **Why restore rewrites the text instead of applying the old update.** Yjs
 * updates are additive: applying a past state to a document that already
 * contains it is a no-op, because the operations are already there. Restoring
 * has to be expressed as a *new* edit — the difference between what the
 * document says now and what the snapshot said — which is what
 * `restoreSnapshot` does inside a single transaction. That keeps restore an
 * ordinary concurrent edit: a partner typing during one does not lose their
 * characters, and the restore converges like anything else.
 */

import { createRequire } from 'module';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { snapshotsTaken } from './metrics.js';

// See the note in yjsService.js: Yjs must come from the same (CommonJS) module
// instance that y-socket.io uses, or the documents handed to this module are
// built by a different copy of the library than the one encoding them.
const Y = createRequire(import.meta.url)('yjs');

/** The Y.Text key the Monaco binding uses. Shared with the client. */
export const TEXT_KEY = 'monaco';

const SNAPSHOT_INTERVAL_MS = Number(process.env.SNAPSHOT_INTERVAL_MS || 5 * 60 * 1000);

/** Snapshots kept per document; older ones are dropped as new ones are taken. */
export const SNAPSHOTS_PER_DOCUMENT = Number(process.env.SNAPSHOTS_PER_DOCUMENT || 20);

/** A document larger than this is not snapshotted — history is not a backup. */
const MAX_SNAPSHOT_BYTES = Number(process.env.MAX_SNAPSHOT_BYTES || 1_000_000);

// Last snapshotted state vector per document, so an unchanged document is
// skipped. In-process only: after a restart the first pass snapshots
// everything open, which is the conservative direction to be wrong in.
const lastStateVectors = new Map();

export class SnapshotError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

const publicSnapshot = (row) => ({
    id: row.id,
    roomId: row.room_id,
    docName: row.doc_name,
    size: row.size,
    createdAt: row.created_at,
});

const sameBytes = (a, b) => Boolean(a) && Boolean(b) && Buffer.compare(a, b) === 0;

/**
 * Store one snapshot of `doc`, unless it is unchanged or too large.
 *
 * @returns {object|null} the stored snapshot, or null when it was skipped
 */
export async function captureSnapshot(roomId, docName, doc) {
    const stateVector = Buffer.from(Y.encodeStateVector(doc));
    if (sameBytes(lastStateVectors.get(docName), stateVector)) {
        snapshotsTaken.labels('skipped_unchanged').inc();
        return null;
    }

    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    if (state.length > MAX_SNAPSHOT_BYTES) {
        console.warn(`[Snapshots] ${docName} is ${state.length} bytes — too large to snapshot`);
        snapshotsTaken.labels('skipped_too_large').inc();
        lastStateVectors.set(docName, stateVector);
        return null;
    }

    const row = {
        id: uuidv4(),
        room_id: roomId,
        doc_name: docName,
        state,
        size: state.length,
        created_at: new Date().toISOString(),
    };

    await db.tx(async (t) => {
        await t.run(
            `INSERT INTO document_snapshots (id, room_id, doc_name, state, size, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [row.id, row.room_id, row.doc_name, row.state, row.size, row.created_at]
        );

        await t.run(
            `DELETE FROM document_snapshots
              WHERE doc_name = ?
                AND id NOT IN (
                    SELECT id FROM document_snapshots
                     WHERE doc_name = ?
                     ORDER BY created_at DESC, seq DESC
                     LIMIT ?
                )`,
            [docName, docName, SNAPSHOTS_PER_DOCUMENT]
        );
    });

    lastStateVectors.set(docName, stateVector);
    snapshotsTaken.labels('captured').inc();
    return publicSnapshot(row);
}

/** Snapshots for one document, newest first. Metadata only — never the blob. */
export async function listSnapshots(roomId, docName) {
    const rows = await db.all(
        `SELECT id, room_id, doc_name, size, created_at
           FROM document_snapshots
          WHERE room_id = ? AND doc_name = ?
          ORDER BY created_at DESC, seq DESC`,
        [roomId, docName]
    );
    return rows.map(publicSnapshot);
}

async function requireSnapshot(roomId, snapshotId) {
    const row = await db.get('SELECT * FROM document_snapshots WHERE room_id = ? AND id = ?', [
        roomId,
        snapshotId,
    ]);
    if (!row) throw new SnapshotError('No such snapshot.', 404);
    return row;
}

/** The text a snapshot holds, without touching any live document. */
export async function readSnapshotText(roomId, snapshotId) {
    const row = await requireSnapshot(roomId, snapshotId);
    const scratch = new Y.Doc();
    try {
        Y.applyUpdate(scratch, new Uint8Array(row.state));
        return { snapshot: publicSnapshot(row), text: scratch.getText(TEXT_KEY).toString() };
    } finally {
        scratch.destroy();
    }
}

/**
 * Rewrite `doc` to the content the snapshot holds.
 *
 * The whole rewrite is one Yjs transaction, so collaborators see a single
 * change rather than a delete followed by a visible retype.
 *
 * @returns {{ snapshot: object, changed: boolean }}
 */
export async function restoreSnapshot(roomId, snapshotId, doc) {
    const { snapshot, text } = await readSnapshotText(roomId, snapshotId);
    const target = doc.getText(TEXT_KEY);

    if (target.toString() === text) return { snapshot, changed: false };

    doc.transact(() => {
        target.delete(0, target.length);
        target.insert(0, text);
    }, 'snapshot-restore');

    // The restored content is now the document's current state; snapshotting it
    // again on the next pass would just duplicate the row we restored from.
    lastStateVectors.set(snapshot.docName, Buffer.from(Y.encodeStateVector(doc)));

    return { snapshot, changed: true };
}

/**
 * Start the periodic capture pass.
 *
 * @param {() => Iterable<[string, import('yjs').Doc]>} openDocuments
 *   Live documents, name → doc. Passed in rather than imported so this module
 *   does not depend on yjsService and can be tested with a plain Map.
 * @returns {() => void} stop function
 */
export function startSnapshotSweep(openDocuments) {
    const capture = async () => {
        try {
            for (const [docName, doc] of openDocuments()) {
                const [roomId] = docName.split(':');
                if (!roomId) continue;
                await captureSnapshot(roomId, docName, doc);
            }
        } catch (error) {
            console.error('[Snapshots] Capture pass failed:', error);
        }
    };

    const interval = setInterval(capture, SNAPSHOT_INTERVAL_MS);
    interval.unref?.();

    console.log(
        `✓ Document snapshots every ${Math.round(SNAPSHOT_INTERVAL_MS / 60000)}m ` +
        `(keeping ${SNAPSHOTS_PER_DOCUMENT} per document)`
    );

    return () => clearInterval(interval);
}

/** Drop snapshots for documents that no longer exist. Used by the sweep. */
export async function pruneSnapshots(docNameExists) {
    const rows = await db.all('SELECT DISTINCT doc_name FROM document_snapshots');
    const names = rows.map((row) => row.doc_name);

    let removed = 0;
    for (const name of names) {
        if (await docNameExists(name)) continue;
        const result = await db.run('DELETE FROM document_snapshots WHERE doc_name = ?', [name]);
        removed += result.changes;
        lastStateVectors.delete(name);
    }

    return removed;
}

/** Forget a document's snapshots outright — used when its file is deleted. */
export async function deleteSnapshotsFor(docName) {
    lastStateVectors.delete(docName);
    const result = await db.run('DELETE FROM document_snapshots WHERE doc_name = ?', [docName]);
    return result.changes;
}
