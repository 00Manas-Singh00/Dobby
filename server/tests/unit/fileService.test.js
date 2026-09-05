/**
 * The room file tree.
 *
 * The behaviour worth testing here is the set of invariants that keep the tree
 * a tree: names are unique among siblings, a folder cannot end up inside
 * itself, names are single path segments, and deleting a folder reports every
 * document that has to be dropped with it. Everything else is CRUD.
 */

import { randomUUID } from 'crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import db from '../../db.js';
import { register } from '../../services/authService.js';
import { createRoom } from '../../services/roomService.js';
import {
    createFile,
    updateFile,
    deleteFile,
    getFile,
    getTree,
    listFiles,
    pathOf,
    countFiles,
    descendantIds,
    languageForName,
    documentNameFor,
    seedRoomFiles,
    DEFAULT_FILE_NAME,
    MAX_FILES_PER_ROOM,
    FileError,
} from '../../services/fileService.js';

let room;
let counter = 0;

beforeEach(async () => {
    counter += 1;
    const { user } = await register({
        email: `files${counter}-${Date.now()}@example.com`,
        username: `files${counter}`,
        password: 'correct horse battery staple',
    });
    room = await createRoom(user.id, 'Files');
});

describe('a new room', () => {
    it('opens with one file so the explorer is never empty', async () => {
        const files = await listFiles(room.id);

        expect(files).toHaveLength(1);
        expect(files[0].name).toBe(DEFAULT_FILE_NAME);
        expect(files[0].type).toBe('file');
        expect(files[0].parentId).toBeNull();
    });

    it('is not re-seeded once it has files', async () => {
        expect(await seedRoomFiles(room.id)).toBeNull();
        expect(await countFiles(room.id)).toBe(1);
    });
});

describe('createFile', () => {
    it('infers the editor language from the extension', async () => {
        expect((await createFile(room.id, { name: 'app.py' })).language).toBe('python');
        expect((await createFile(room.id, { name: 'notes.md' })).language).toBe('markdown');
        // An unknown extension is plaintext rather than an error: the room's
        // language selector, not the filename, decides what gets executed.
        expect((await createFile(room.id, { name: 'data.zzz' })).language).toBe('plaintext');
    });

    it('gives a folder no language at all', async () => {
        expect((await createFile(room.id, { name: 'src', type: 'folder' })).language).toBeNull();
    });

    it('refuses a duplicate name among siblings, case-insensitively', async () => {
        await createFile(room.id, { name: 'README.md' });

        await expect(createFile(room.id, { name: 'readme.md' })).rejects.toThrow(FileError);
    });

    it('allows the same name in two different folders', async () => {
        const src = await createFile(room.id, { name: 'src', type: 'folder' });
        const test = await createFile(room.id, { name: 'test', type: 'folder' });

        await createFile(room.id, { name: 'index.js', parentId: src.id });

        await expect(createFile(room.id, { name: 'index.js', parentId: test.id })).resolves.toBeDefined();
    });

    it('rejects a name that is really a path', async () => {
        // parent_id is the only expression of hierarchy; a name carrying a
        // separator would be a second, contradictory one.
        await expect(createFile(room.id, { name: '../escape.js' })).rejects.toThrow(/separator/);
        await expect(createFile(room.id, { name: 'src/index.js' })).rejects.toThrow(/separator/);
        await expect(createFile(room.id, { name: 'a\\b.js' })).rejects.toThrow(/separator/);
    });

    it('rejects an empty, whitespace-only, or reserved name', async () => {
        await expect(createFile(room.id, { name: '   ' })).rejects.toThrow(FileError);
        await expect(createFile(room.id, { name: '..' })).rejects.toThrow(/reserved/);
    });

    it('accepts the ordinary punctuation real filenames use', async () => {
        await expect(createFile(room.id, { name: 'my-file.test.js' })).resolves.toBeDefined();
        await expect(createFile(room.id, { name: 'Notes and drafts.md' })).resolves.toBeDefined();
    });

    it('refuses to nest a file inside another file', async () => {
        const file = await createFile(room.id, { name: 'a.js' });

        await expect(createFile(room.id, { name: 'b.js', parentId: file.id })).rejects.toThrow(/cannot contain/);
    });

    it('refuses a parent from another room', async () => {
        const otherRoomFile = (await listFiles(room.id))[0];
        // Ids are scoped by room on every lookup, so an id from elsewhere is
        // indistinguishable from one that does not exist.
        await expect(createFile('00000000-0000-4000-8000-000000000000', {
                name: 'x.js',
                parentId: otherRoomFile.id,
            })).rejects.toThrow(/No such file/);
    });

    it('caps how many files a room can hold', async () => {
        // Filled by direct insert rather than through createFile: the cap is
        // what is under test, and the service would refuse the last one for the
        // right reason before the fixture was even in place. Written as a plain
        // loop because the generate-a-series spellings differ per engine.
        const now = new Date().toISOString();
        for (let i = 0; i < MAX_FILES_PER_ROOM; i += 1) {
            await db.run(
                `INSERT INTO room_files (id, room_id, parent_id, name, type, created_at, updated_at)
                 VALUES (?, ?, NULL, ?, 'file', ?, ?)`,
                [randomUUID(), room.id, `filler${i}`, now, now]
            );
        }

        await expect(createFile(room.id, { name: 'one-too-many.js' })).rejects.toThrow(
            /cannot hold more/
        );
    });
});

describe('getTree', () => {
    it('nests children under their folder and leaves files flat', async () => {
        const src = await createFile(room.id, { name: 'src', type: 'folder' });
        await createFile(room.id, { name: 'index.js', parentId: src.id });

        const tree = await getTree(room.id);
        const folder = tree.find((node) => node.id === src.id);

        expect(folder.children.map((child) => child.name)).toEqual(['index.js']);
        expect(tree.find((node) => node.name === DEFAULT_FILE_NAME).children).toBeUndefined();
    });

    it('puts folders before files', async () => {
        await createFile(room.id, { name: 'zzz', type: 'folder' });

        expect((await getTree(room.id))[0].type).toBe('folder');
    });
});

describe('pathOf', () => {
    it('joins the ancestry into a displayable path', async () => {
        const src = await createFile(room.id, { name: 'src', type: 'folder' });
        const util = await createFile(room.id, { name: 'util', type: 'folder', parentId: src.id });
        const file = await createFile(room.id, { name: 'format.js', parentId: util.id });

        expect(await pathOf(room.id, file.id)).toBe('src/util/format.js');
    });
});

describe('updateFile', () => {
    it('renames and re-infers the language', async () => {
        const file = await createFile(room.id, { name: 'script.js' });

        expect((await updateFile(room.id, file.id, { name: 'script.py' })).language).toBe('python');
    });

    it('does not move a node when only a name is given', async () => {
        const src = await createFile(room.id, { name: 'src', type: 'folder' });
        const file = await createFile(room.id, { name: 'a.js', parentId: src.id });

        // An absent parentId means "leave it where it is" — treating it as null
        // would silently move every rename to the root.
        expect((await updateFile(room.id, file.id, { name: 'b.js' })).parentId).toBe(src.id);
    });

    it('moves a node to the root when parentId is explicitly null', async () => {
        const src = await createFile(room.id, { name: 'src', type: 'folder' });
        const file = await createFile(room.id, { name: 'a.js', parentId: src.id });

        expect((await updateFile(room.id, file.id, { parentId: null })).parentId).toBeNull();
    });

    it('refuses a move that would put a folder inside itself', async () => {
        const outer = await createFile(room.id, { name: 'outer', type: 'folder' });
        const inner = await createFile(room.id, { name: 'inner', type: 'folder', parentId: outer.id });

        // The subtree would still exist but nothing would reach it from a root.
        await expect(updateFile(room.id, outer.id, { parentId: inner.id })).rejects.toThrow(/inside itself/);
        await expect(updateFile(room.id, outer.id, { parentId: outer.id })).rejects.toThrow(/itself/);
    });

    it('refuses a rename that collides with a sibling', async () => {
        await createFile(room.id, { name: 'taken.js' });
        const file = await createFile(room.id, { name: 'free.js' });

        await expect(updateFile(room.id, file.id, { name: 'taken.js' })).rejects.toThrow(FileError);
    });

    it('allows a no-op rename back to the same name', async () => {
        const file = await createFile(room.id, { name: 'same.js' });

        await expect(updateFile(room.id, file.id, { name: 'same.js' })).resolves.toBeDefined();
    });

    it('refuses a move that would collide in the destination folder', async () => {
        const src = await createFile(room.id, { name: 'src', type: 'folder' });
        await createFile(room.id, { name: 'a.js', parentId: src.id });
        const loose = await createFile(room.id, { name: 'a.js' });

        await expect(updateFile(room.id, loose.id, { parentId: src.id })).rejects.toThrow(FileError);
    });
});

describe('deleteFile', () => {
    it('reports the whole subtree, so every document can be dropped with it', async () => {
        const src = await createFile(room.id, { name: 'src', type: 'folder' });
        const util = await createFile(room.id, { name: 'util', type: 'folder', parentId: src.id });
        const deep = await createFile(room.id, { name: 'deep.js', parentId: util.id });

        const { removed } = await deleteFile(room.id, src.id);

        // The caller uses this list to clear LevelDB state; a missed id would
        // be an orphaned document until the retention sweep noticed.
        expect(new Set(removed)).toEqual(new Set([src.id, util.id, deep.id]));
        expect(await getFile(room.id, deep.id)).toBeNull();
    });

    it('leaves siblings alone', async () => {
        const keep = await createFile(room.id, { name: 'keep.js' });
        const drop = await createFile(room.id, { name: 'drop.js' });

        await deleteFile(room.id, drop.id);

        expect(await getFile(room.id, keep.id)).not.toBeNull();
    });

    it('404s for an id that is not in this room', async () => {
        await expect(deleteFile(room.id, 'not-an-id')).rejects.toThrow(expect.objectContaining({ status: 404 }));
    });
});

describe('descendantIds', () => {
    it('excludes the node itself', async () => {
        const folder = await createFile(room.id, { name: 'f', type: 'folder' });
        const child = await createFile(room.id, { name: 'c.js', parentId: folder.id });

        expect(await descendantIds(room.id, folder.id)).toEqual([child.id]);
    });

    it('is empty for a leaf', async () => {
        expect(await descendantIds(room.id, (await listFiles(room.id))[0].id)).toEqual([]);
    });
});

describe('naming conventions shared with Yjs', () => {
    it('builds the document name the editor and the explorer both use', async () => {
        // If this drifts, the explorer and the editor address different
        // documents and a file silently opens empty.
        expect(documentNameFor('room-1', 'file-1')).toBe('room-1:file-1');
    });

    it('maps a bare name with no extension to plaintext', async () => {
        expect(languageForName('Makefile')).toBe('plaintext');
    });
});
