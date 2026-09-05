/**
 * The Phase 5 migration of an existing SQLite file.
 *
 * This is the only code in the store that runs against data somebody already
 * has, and it rebuilds two tables to do its job. Getting it wrong loses a
 * room's chat transcript or its document history — silently, at startup, on the
 * one path nobody watches.
 *
 * The driver is exercised directly rather than through `db.js`, because that
 * module picks its engine from the environment once at import and this test is
 * specifically about the other engine's absence.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { createSqliteDriver } from '../../db/sqlite.js';

let dir;
let file;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dobby-migrate-'));
    file = path.join(dir, 'dobby.db');
});

afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
});

/** The schema as it stood before Phase 5, with one room and one user in it. */
function writePrePhase5Database() {
    const db = new Database(file);
    db.pragma('foreign_keys = ON');
    db.exec(`
        CREATE TABLE users (
            id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, username TEXT NOT NULL,
            password_hash TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE rooms (
            id TEXT PRIMARY KEY, name TEXT NOT NULL,
            owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL, last_active_at TEXT NOT NULL
        );
        CREATE TABLE room_files (
            id TEXT PRIMARY KEY,
            room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
            parent_id TEXT REFERENCES room_files(id) ON DELETE CASCADE,
            name TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('file', 'folder')),
            language TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        -- No seq column, and id is the primary key: the shape this migration
        -- exists to change.
        CREATE TABLE chat_messages (
            id TEXT PRIMARY KEY,
            room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
            user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
            username TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE document_snapshots (
            id TEXT PRIMARY KEY,
            room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
            doc_name TEXT NOT NULL, state BLOB NOT NULL, size INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX idx_chat_messages_room ON chat_messages(room_id, created_at);
        -- Case-sensitive, which is the other half of what changed.
        CREATE UNIQUE INDEX idx_room_files_unique_name
            ON room_files(room_id, IFNULL(parent_id, ''), name);

        INSERT INTO users VALUES ('u1', 'ada@example.com', 'ada', 'hash', '2026-01-01T00:00:00.000Z');
        INSERT INTO rooms VALUES ('r1', 'Room', 'u1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    `);

    // Three messages sharing one timestamp, so the only thing that can preserve
    // their order through the rebuild is the rowid the migration reads.
    const insert = db.prepare(
        'INSERT INTO chat_messages (id, room_id, user_id, username, message, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const [id, text] of [['m1', 'first'], ['m2', 'second'], ['m3', 'third']]) {
        insert.run(id, 'r1', 'u1', 'ada', text, '2026-01-01T00:00:00.000Z');
    }

    db.prepare(
        'INSERT INTO document_snapshots (id, room_id, doc_name, state, size, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('s1', 'r1', 'r1:f1', Buffer.from([1, 2, 3]), 3, '2026-01-01T00:00:00.000Z');

    db.close();
}

describe('migrating a pre-Phase-5 database', () => {
    it('adds seq without losing a row, and keeps the order the rowids implied', async () => {
        writePrePhase5Database();

        const driver = createSqliteDriver({ databasePath: file });
        await driver.init();

        const messages = await driver.all(
            'SELECT id, message, seq FROM chat_messages ORDER BY seq'
        );
        expect(messages.map((row) => row.message)).toEqual(['first', 'second', 'third']);
        expect(messages.map((row) => row.seq)).toEqual([1, 2, 3]);

        await driver.close();
    });

    it('carries the snapshot blob across byte for byte', async () => {
        writePrePhase5Database();

        const driver = createSqliteDriver({ databasePath: file });
        await driver.init();

        const snapshot = await driver.get('SELECT * FROM document_snapshots');
        expect(Buffer.from(snapshot.state)).toEqual(Buffer.from([1, 2, 3]));
        expect(snapshot.size).toBe(3);

        await driver.close();
    });

    it('rebuilds the file-name index so case no longer creates a duplicate', async () => {
        writePrePhase5Database();

        const driver = createSqliteDriver({ databasePath: file });
        await driver.init();

        const now = '2026-01-01T00:00:00.000Z';
        await driver.run(
            `INSERT INTO room_files (id, room_id, parent_id, name, type, language, created_at, updated_at)
             VALUES ('f1', 'r1', NULL, 'README.md', 'file', 'markdown', ?, ?)`,
            [now, now]
        );

        // The old index compared names exactly, so this pair coexisted in the
        // table even though createFile refused to produce it.
        await expect(
            driver.run(
                `INSERT INTO room_files (id, room_id, parent_id, name, type, language, created_at, updated_at)
                 VALUES ('f2', 'r1', NULL, 'readme.md', 'file', 'markdown', ?, ?)`,
                [now, now]
            )
        ).rejects.toThrow(/UNIQUE/i);

        await driver.close();
    });

    it('is a no-op the second time, and on a database created fresh', async () => {
        writePrePhase5Database();

        const first = createSqliteDriver({ databasePath: file });
        await first.init();
        await first.close();

        const logged = vi.spyOn(console, 'log').mockImplementation(() => {});
        const second = createSqliteDriver({ databasePath: file });
        await second.init();

        expect(logged.mock.calls.flat().join(' ')).not.toMatch(/Migrated/);
        expect(await second.all('SELECT id FROM chat_messages')).toHaveLength(3);

        await second.close();
    });
});
