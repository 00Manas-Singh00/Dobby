/**
 * routes/files.js
 * The file tree and per-document history for one room.
 *
 * Mounted under `/api/rooms/:roomId`, behind that router's membership gate, so
 * nothing here re-checks authorization — `req.room` is already a room the
 * caller belongs to.
 *
 * Mutations are broadcast to the room over Socket.IO as they happen. Without
 * that, the two people in a room would each hold a stale tree until they
 * reloaded, and creating a file would look like it had failed to the person who
 * did not create it. The broadcast is a notification, not a sync protocol: it
 * carries the change and the client refetches, which keeps the file table the
 * single source of truth for structure.
 */

import express from 'express';
import {
    getTree,
    getFile,
    pathOf,
    createFile,
    updateFile,
    deleteFile,
    documentNameFor,
    FileError,
} from '../services/fileService.js';
import {
    listSnapshots,
    readSnapshotText,
    restoreSnapshot,
    captureSnapshot,
    deleteSnapshotsFor,
    SnapshotError,
} from '../services/snapshotService.js';
import { withDocument, deleteDocument } from '../services/yjsService.js';
import { validateBody, createFileSchema, updateFileSchema } from '../middleware/validate.js';

// mergeParams so :roomId from the parent router is visible here.
const router = express.Router({ mergeParams: true });

function fail(res, error, context) {
    if (error instanceof FileError || error instanceof SnapshotError) {
        return res.status(error.status).json({ error: error.message });
    }
    console.error(`[Files] ${context} failed:`, error);
    return res.status(500).json({ error: 'Request failed.' });
}

/** Tell everyone in the room that the tree moved under them. */
function broadcast(req, payload) {
    req.app.get('io')?.in(req.room.id).emit('files:changed', payload);
}

/** GET /api/rooms/:roomId/files → the whole tree. */
router.get('/', async (req, res) => {
    try {
        return res.json({ files: await getTree(req.room.id) });
    } catch (error) {
        return fail(res, error, 'list');
    }
});

/** POST /api/rooms/:roomId/files → create a file or folder. */
router.post('/', validateBody(createFileSchema), async (req, res) => {
    try {
        const file = await createFile(req.room.id, req.body);
        broadcast(req, { action: 'created', file });
        return res.json({ file });
    } catch (error) {
        return fail(res, error, 'create');
    }
});

/** PATCH /api/rooms/:roomId/files/:fileId → rename and/or move. */
router.patch('/:fileId', validateBody(updateFileSchema), async (req, res) => {
    try {
        const file = await updateFile(req.room.id, req.params.fileId, req.body);
        broadcast(req, { action: 'updated', file });
        return res.json({ file });
    } catch (error) {
        return fail(res, error, 'update');
    }
});

/**
 * DELETE /api/rooms/:roomId/files/:fileId → remove it and everything under it.
 *
 * The row goes first and the documents follow: a failure after the row is gone
 * leaves orphaned document state that the retention sweep collects, whereas the
 * reverse order would leave a file in the tree whose content had been erased.
 */
router.delete('/:fileId', async (req, res) => {
    try {
        const { removed } = await deleteFile(req.room.id, req.params.fileId);

        for (const id of removed) {
            const docName = documentNameFor(req.room.id, id);
            await deleteSnapshotsFor(docName);
            await deleteDocument(docName).catch((error) =>
                console.error(`[Files] Failed to drop document ${docName}:`, error.message)
            );
        }

        broadcast(req, { action: 'deleted', fileIds: removed });
        return res.json({ removed });
    } catch (error) {
        return fail(res, error, 'delete');
    }
});

/** GET /api/rooms/:roomId/files/:fileId/snapshots → history, newest first. */
router.get('/:fileId/snapshots', async (req, res) => {
    try {
        const file = await getFile(req.room.id, req.params.fileId);
        if (!file) return res.status(404).json({ error: 'No such file.' });

        return res.json({
            path: await pathOf(req.room.id, file.id),
            snapshots: await listSnapshots(req.room.id, documentNameFor(req.room.id, file.id)),
        });
    } catch (error) {
        return fail(res, error, 'list snapshots');
    }
});

/**
 * POST /api/rooms/:roomId/files/:fileId/snapshots → snapshot it now.
 *
 * The periodic sweep is the normal path; this exists so a user can mark a known
 * good state before a risky edit rather than hoping the timer fires first.
 */
router.post('/:fileId/snapshots', async (req, res) => {
    try {
        const file = await getFile(req.room.id, req.params.fileId);
        if (!file) return res.status(404).json({ error: 'No such file.' });

        const docName = documentNameFor(req.room.id, file.id);
        const snapshot = await withDocument(docName, (doc) =>
            captureSnapshot(req.room.id, docName, doc)
        );

        // null means the document is byte-for-byte what the last snapshot held.
        return res.json({ snapshot, unchanged: snapshot === null });
    } catch (error) {
        return fail(res, error, 'capture snapshot');
    }
});

/** GET …/snapshots/:snapshotId → the text it holds, for a preview or a diff. */
router.get('/:fileId/snapshots/:snapshotId', async (req, res) => {
    try {
        return res.json(await readSnapshotText(req.room.id, req.params.snapshotId));
    } catch (error) {
        return fail(res, error, 'read snapshot');
    }
});

/**
 * POST …/snapshots/:snapshotId/restore → rewrite the document to that state.
 *
 * Snapshot the document first, so the state being replaced is itself
 * recoverable — an undo for the restore.
 */
router.post('/:fileId/snapshots/:snapshotId/restore', async (req, res) => {
    try {
        const file = await getFile(req.room.id, req.params.fileId);
        if (!file) return res.status(404).json({ error: 'No such file.' });

        const docName = documentNameFor(req.room.id, file.id);
        const result = await withDocument(docName, async (doc) => {
            await captureSnapshot(req.room.id, docName, doc);
            return restoreSnapshot(req.room.id, req.params.snapshotId, doc);
        });

        broadcast(req, { action: 'restored', file, snapshotId: req.params.snapshotId });
        return res.json(result);
    } catch (error) {
        return fail(res, error, 'restore snapshot');
    }
});

export default router;
