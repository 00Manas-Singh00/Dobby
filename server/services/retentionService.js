/**
 * services/retentionService.js
 * Scheduled expiry for everything Dobby keeps on disk.
 *
 * Previously nothing here expired: Yjs documents accumulated indefinitely with
 * no delete path, and refresh tokens and invites were never collected. The policy is deliberately simple and stated in one place so it
 * can be documented and changed as one number.
 */

import db from '../db.js';
import { listStaleRooms, pruneInvites, deleteRoom } from './roomService.js';
import { pruneRefreshTokens } from './authService.js';
import { deleteRoomDocuments, pruneOrphanedDocuments, listDocumentNames } from './yjsService.js';
import { pruneSnapshots } from './snapshotService.js';

/** A room untouched for this long is deleted along with its documents. */
export const ROOM_RETENTION_MS = Number(
    process.env.ROOM_RETENTION_MS || 90 * 24 * 60 * 60 * 1000
);

const SWEEP_INTERVAL_MS = Number(process.env.RETENTION_SWEEP_INTERVAL_MS || 60 * 60 * 1000);

const roomExists = async (roomId) =>
    Boolean(await db.get('SELECT 1 AS ok FROM rooms WHERE id = ?', [roomId]));

/**
 * Run one retention pass. Exported separately from the scheduler so it can be
 * triggered manually and tested without waiting an hour.
 */
export async function runRetentionSweep() {
    const summary = { rooms: 0, documents: 0, snapshots: 0, invites: 0, refreshTokens: 0 };

    try {
        for (const room of await listStaleRooms(ROOM_RETENTION_MS)) {
            // Documents first: if the sweep dies between the two steps, the room
            // row survives and the next pass retries. The reverse order would
            // orphan the documents.
            summary.documents += await deleteRoomDocuments(room.id);
            await deleteRoom(room.id, room.ownerId);
            summary.rooms += 1;
        }

        summary.documents += await pruneOrphanedDocuments(roomExists);

        // Snapshots outlive their document only if something went wrong — a
        // room deleted while the process was down, or a failed file delete. The
        // room_id foreign key covers the room case; this covers the file case,
        // where the room still exists but the document does not.
        const liveDocuments = new Set(await listDocumentNames());
        summary.snapshots = await pruneSnapshots(
            async (docName) =>
                liveDocuments.has(docName) || (await roomExists(docName.split(':')[0]))
        );

        summary.invites = await pruneInvites();
        summary.refreshTokens = await pruneRefreshTokens();
    } catch (error) {
        console.error('[Retention] Sweep failed:', error);
    }

    const touched = Object.values(summary).some((n) => n > 0);
    if (touched) {
        console.log(
            `[Retention] Removed ${summary.rooms} room(s), ${summary.documents} document(s), ` +
            `${summary.snapshots} snapshot(s), ${summary.invites} invite(s), ` +
            `${summary.refreshTokens} refresh token(s)`
        );
    }
    return summary;
}

/**
 * Start the periodic sweep. Returns a stop function.
 * The first pass runs shortly after boot so a restart also collects anything
 * that expired while the process was down.
 */
export function startRetentionSweep() {
    const initial = setTimeout(() => {
        runRetentionSweep();
    }, 10_000);

    const interval = setInterval(() => {
        runRetentionSweep();
    }, SWEEP_INTERVAL_MS);

    // Neither timer should hold the event loop open on shutdown.
    initial.unref?.();
    interval.unref?.();

    console.log(
        `✓ Retention sweep every ${Math.round(SWEEP_INTERVAL_MS / 60000)}m ` +
        `(rooms expire after ${Math.round(ROOM_RETENTION_MS / 86400000)} days idle)`
    );

    return () => {
        clearTimeout(initial);
        clearInterval(interval);
    };
}
