/**
 * services/fileService.js
 * Client-side wrapper over the room file API.
 *
 * The explorer used to render a hardcoded tree; this is what it talks to now.
 * Note what is *not* here: file content. A file's bytes are a Yjs document
 * named `<roomId>:<fileId>`, opened by `useYjsEditor` — these calls only ever
 * move structure around.
 */

import { getJson, postJson, patchJson, deleteJson } from '@/services/apiClient';

const base = (roomId) => `/api/rooms/${roomId}/files`;

/** The room's tree, as an array of root nodes with nested `children`. */
export const listFiles = async (roomId) => (await getJson(base(roomId))).files;

export const createFile = async (roomId, { name, type = 'file', parentId = null }) =>
    (await postJson(base(roomId), { name, type, parentId })).file;

/**
 * Rename and/or move. Passing no `parentId` key leaves the node where it is —
 * sending `null` is what moves it to the root, so the two cases are distinct.
 */
export const updateFile = async (roomId, fileId, updates) =>
    (await patchJson(`${base(roomId)}/${fileId}`, updates)).file;

/** Deletes the node and everything under it; resolves with the removed ids. */
export const deleteFile = async (roomId, fileId) =>
    (await deleteJson(`${base(roomId)}/${fileId}`)).removed;

// ─── Document history ────────────────────────────────────────────────────────

export const listSnapshots = async (roomId, fileId) =>
    (await getJson(`${base(roomId)}/${fileId}/snapshots`)).snapshots;

/** Snapshot now. Resolves with `{ snapshot, unchanged }`. */
export const captureSnapshot = (roomId, fileId) =>
    postJson(`${base(roomId)}/${fileId}/snapshots`);

export const readSnapshot = (roomId, fileId, snapshotId) =>
    getJson(`${base(roomId)}/${fileId}/snapshots/${snapshotId}`);

/**
 * Rewrite the document to a snapshot's content.
 *
 * The change arrives in the editor through the normal Yjs update path, not in
 * this response — the server edits the live document, and every open editor
 * including this one receives it as an ordinary remote edit.
 */
export const restoreSnapshot = (roomId, fileId, snapshotId) =>
    postJson(`${base(roomId)}/${fileId}/snapshots/${snapshotId}/restore`);

// ─── Helpers shared by the explorer and the tabs ─────────────────────────────

/** Depth-first walk of a tree, yielding every node. */
export function* walkTree(nodes) {
    for (const node of nodes ?? []) {
        yield node;
        if (node.children) yield* walkTree(node.children);
    }
}

/** The first file (not folder) in the tree, or null. Used to pick an open tab. */
export function firstFile(nodes) {
    for (const node of walkTree(nodes)) {
        if (node.type === 'file') return node;
    }
    return null;
}

/** `src/util/format.js` for a node, given the tree it came from. */
export function pathOf(nodes, fileId) {
    const parents = new Map();
    const byId = new Map();

    for (const node of walkTree(nodes)) {
        byId.set(node.id, node);
        for (const child of node.children ?? []) parents.set(child.id, node.id);
    }

    const segments = [];
    let current = byId.get(fileId);
    while (current) {
        segments.unshift(current.name);
        current = byId.get(parents.get(current.id));
    }

    return segments.join('/');
}
