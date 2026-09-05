/**
 * services/fileService.js
 * The room's file tree.
 *
 * The explorer used to render a hardcoded tree, and opening a "file" produced a
 * placeholder buffer that belonged to nothing. This module is the backing store
 * that closes that gap.
 *
 * The split that matters: **this table holds structure, Yjs holds content.** A
 * file row is an id, a name, and a parent; its bytes live in the Yjs document
 * named `<roomId>:<fileId>`, which is exactly the naming the editor already
 * used. Nothing here is written on a keystroke — only on create, rename, move,
 * and delete — so the CRDT stays the single writer for content and this table
 * never becomes a second, conflicting copy of it.
 *
 * Deleting a file therefore has two halves: the row here, and the Yjs document.
 * The caller does the second (see routes/files.js), for the same reason room
 * deletion does: yjsService owns the document lifecycle.
 */

import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';

export class FileError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

/** Per-room ceiling. A pairing room is not a file host. */
export const MAX_FILES_PER_ROOM = Number(process.env.MAX_FILES_PER_ROOM || 200);

/** How deep the tree may nest. Bounds the recursive path/descendant walks. */
export const MAX_TREE_DEPTH = Number(process.env.MAX_TREE_DEPTH || 12);

// Names are a single path segment, never a path. Rejecting the separator here
// is what keeps `parent_id` the only expression of hierarchy — a name of
// "../secrets" would otherwise be a second, contradictory one.
// eslint-disable-next-line no-control-regex -- excluding control characters is the point
const NAME_PATTERN = /^[^/\\<>:"|?*\x00-\x1f]+$/;

const RESERVED_NAMES = new Set(['.', '..']);

/**
 * Extension → Monaco language id. Only a hint for the editor; the room's
 * language selector still wins for execution, so an unknown extension is
 * `plaintext` rather than an error.
 */
const LANGUAGE_BY_EXTENSION = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
    cs: 'csharp', php: 'php', swift: 'swift', kt: 'kotlin', scala: 'scala',
    sh: 'shell', bash: 'shell', zsh: 'shell',
    sql: 'sql', html: 'html', htm: 'html', css: 'css', scss: 'scss',
    json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini',
    md: 'markdown', markdown: 'markdown', txt: 'plaintext', xml: 'xml',
};

export function languageForName(name) {
    const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    return LANGUAGE_BY_EXTENSION[extension] || 'plaintext';
}

const publicFile = (row) => ({
    id: row.id,
    roomId: row.room_id,
    parentId: row.parent_id,
    name: row.name,
    type: row.type,
    language: row.language,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

function assertValidName(name) {
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new FileError('A name is required.');
    if (trimmed.length > 120) throw new FileError('That name is too long.');
    if (RESERVED_NAMES.has(trimmed)) throw new FileError('That name is reserved.');
    if (!NAME_PATTERN.test(trimmed)) {
        throw new FileError('A name cannot contain a path separator or a control character.');
    }
    return trimmed;
}

/** The row, or null. Scoped by room so an id from another room never resolves. */
export async function getFile(roomId, fileId) {
    const row = await db.get('SELECT * FROM room_files WHERE room_id = ? AND id = ?', [
        roomId,
        fileId,
    ]);
    return row ? publicFile(row) : null;
}

async function requireFile(roomId, fileId) {
    const file = await getFile(roomId, fileId);
    if (!file) throw new FileError('No such file.', 404);
    return file;
}

/** Every row in the room, flat, in the order the UI wants to render them. */
export async function listFiles(roomId) {
    // `type = 'file'` sorts folders first in both engines — false before true in
    // Postgres, 0 before 1 in SQLite. `lower(name)` replaces COLLATE NOCASE,
    // which Postgres does not have.
    const rows = await db.all(
        `SELECT * FROM room_files
          WHERE room_id = ?
          ORDER BY (type = 'file'), lower(name)`,
        [roomId]
    );
    return rows.map(publicFile);
}

/**
 * The flat rows assembled into a nested tree of root nodes.
 *
 * Built from one query rather than a recursive walk: the client needs the whole
 * tree on open anyway, and a per-node query would be one round trip per folder.
 */
export async function getTree(roomId) {
    const rows = await listFiles(roomId);
    const byId = new Map(rows.map((row) => [row.id, { ...row, children: row.type === 'folder' ? [] : undefined }]));
    const roots = [];

    for (const node of byId.values()) {
        const parent = node.parentId ? byId.get(node.parentId) : null;
        if (parent?.children) parent.children.push(node);
        else roots.push(node);
    }

    return roots;
}

/** `src/util/format.js` — for display and for the execution panel's title. */
export async function pathOf(roomId, fileId) {
    const segments = [];
    let current = await getFile(roomId, fileId);

    for (let depth = 0; current && depth <= MAX_TREE_DEPTH; depth += 1) {
        segments.unshift(current.name);
        current = current.parentId ? await getFile(roomId, current.parentId) : null;
    }

    return segments.join('/');
}

async function depthOf(roomId, parentId) {
    let depth = 0;
    let current = parentId ? await getFile(roomId, parentId) : null;

    while (current && depth <= MAX_TREE_DEPTH) {
        depth += 1;
        current = current.parentId ? await getFile(roomId, current.parentId) : null;
    }

    return depth;
}

async function assertParent(roomId, parentId) {
    if (!parentId) return null;
    const parent = await requireFile(roomId, parentId);
    if (parent.type !== 'folder') throw new FileError('A file cannot contain other files.');
    if ((await depthOf(roomId, parentId)) >= MAX_TREE_DEPTH) {
        throw new FileError(`Folders cannot nest more than ${MAX_TREE_DEPTH} deep.`);
    }
    return parent;
}

async function assertNameFree(roomId, parentId, name, exceptId = null) {
    const clash = await db.get(
        `SELECT id FROM room_files
          WHERE room_id = ? AND COALESCE(parent_id, '') = ? AND lower(name) = lower(?)`,
        [roomId, parentId || '', name]
    );

    if (clash && clash.id !== exceptId) {
        throw new FileError('Something with that name is already here.', 409);
    }
}

export function countFiles(roomId) {
    return db.count('SELECT COUNT(*) AS n FROM room_files WHERE room_id = ?', [roomId]);
}

/**
 * Create a file or folder.
 *
 * No content is written: the Yjs document for a new file simply does not exist
 * until someone opens it, at which point the provider creates it empty. That is
 * the same path a file takes after a server restart, so there is only one.
 */
export async function createFile(roomId, { name, type = 'file', parentId = null }) {
    if (type !== 'file' && type !== 'folder') throw new FileError('Unknown file type.');
    if ((await countFiles(roomId)) >= MAX_FILES_PER_ROOM) {
        throw new FileError(`A room cannot hold more than ${MAX_FILES_PER_ROOM} files.`, 409);
    }

    const cleanName = assertValidName(name);
    await assertParent(roomId, parentId);
    await assertNameFree(roomId, parentId, cleanName);

    const now = new Date().toISOString();
    const row = {
        id: uuidv4(),
        room_id: roomId,
        parent_id: parentId || null,
        name: cleanName,
        type,
        language: type === 'file' ? languageForName(cleanName) : null,
        created_at: now,
        updated_at: now,
    };

    await db.run(
        `INSERT INTO room_files (id, room_id, parent_id, name, type, language, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            row.id,
            row.room_id,
            row.parent_id,
            row.name,
            row.type,
            row.language,
            row.created_at,
            row.updated_at,
        ]
    );

    return publicFile(row);
}

/**
 * Rename and/or move. `updates.parentId` is only honoured when the key is
 * present, so a rename does not silently move the node to the root.
 */
export async function updateFile(roomId, fileId, updates = {}) {
    const file = await requireFile(roomId, fileId);

    const movingParent = Object.prototype.hasOwnProperty.call(updates, 'parentId');
    const nextParentId = movingParent ? updates.parentId || null : file.parentId;
    const nextName = updates.name === undefined ? file.name : assertValidName(updates.name);

    if (movingParent && nextParentId !== file.parentId) {
        if (nextParentId === file.id) throw new FileError('A folder cannot contain itself.');
        // Moving a folder under its own descendant would detach that whole
        // subtree from the root — it would still exist, reachable by nothing.
        if (
            file.type === 'folder' &&
            (await descendantIds(roomId, file.id)).includes(nextParentId)
        ) {
            throw new FileError('A folder cannot be moved inside itself.');
        }
        await assertParent(roomId, nextParentId);
    }

    await assertNameFree(roomId, nextParentId, nextName, file.id);

    const now = new Date().toISOString();
    await db.run(
        `UPDATE room_files
            SET name = ?, parent_id = ?, language = ?, updated_at = ?
          WHERE room_id = ? AND id = ?`,
        [
            nextName,
            nextParentId,
            file.type === 'file' ? languageForName(nextName) : null,
            now,
            roomId,
            fileId,
        ]
    );

    return requireFile(roomId, fileId);
}

/** Ids of everything beneath `fileId`, breadth-first. Excludes `fileId` itself. */
export async function descendantIds(roomId, fileId) {
    const collected = [];
    let frontier = [fileId];

    for (let depth = 0; frontier.length && depth <= MAX_TREE_DEPTH; depth += 1) {
        const placeholders = frontier.map(() => '?').join(',');
        const rows = await db.all(
            `SELECT id FROM room_files WHERE room_id = ? AND parent_id IN (${placeholders})`,
            [roomId, ...frontier]
        );
        const children = rows.map((row) => row.id);

        collected.push(...children);
        frontier = children;
    }

    return collected;
}

/**
 * Delete a node and everything under it.
 *
 * Returns the ids removed so the caller can drop the matching Yjs documents and
 * tell connected clients which tabs to close. The cascade is done here rather
 * than left to the foreign key because the caller needs that list — a cascade
 * deletes the rows silently and their documents would be orphaned until the
 * retention sweep noticed.
 */
export async function deleteFile(roomId, fileId) {
    const file = await requireFile(roomId, fileId);
    const removed = [file.id, ...(await descendantIds(roomId, file.id))];

    await db.run('DELETE FROM room_files WHERE room_id = ? AND id = ?', [roomId, fileId]);

    return { removed, file };
}

/**
 * The starter file a new room opens with.
 *
 * A room with an empty explorer is indistinguishable from a broken one, and the
 * first thing anyone does in a pairing session is start typing — so there is
 * always somewhere to type.
 */
export const DEFAULT_FILE_NAME = 'main.js';

export async function seedRoomFiles(roomId) {
    if ((await countFiles(roomId)) > 0) return null;
    return createFile(roomId, { name: DEFAULT_FILE_NAME, type: 'file' });
}

/** Yjs document name for a file. The one place this convention is written down. */
export const documentNameFor = (roomId, fileId) => `${roomId}:${fileId}`;
