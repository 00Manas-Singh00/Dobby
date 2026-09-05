/**
 * db/sqlite.js
 * The embedded engine: zero operational surface, one file on disk.
 *
 * This is still the default, and for a single node it is still the right
 * answer (docs/07-adrs.md#adr-010). What changed in Phase 5 is that it is no
 * longer the *only* answer, so it now sits behind the same async interface as
 * Postgres — see db.js for why the interface is async even here.
 *
 * better-sqlite3 is synchronous, so `get`/`all`/`run` resolve immediately. The
 * one piece of real machinery is `tx`: an `async` transaction body cannot use
 * better-sqlite3's own `db.transaction()` wrapper (it requires a synchronous
 * function), so transactions are issued as explicit BEGIN/COMMIT and serialized
 * behind a promise chain. Without that serialization a second `tx` awaiting
 * inside the first would hit "cannot start a transaction within a transaction",
 * which is a bug that appears only under concurrency.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { schemaStatements } from './schema.js';

export function createSqliteDriver({ databasePath }) {
    const file = path.resolve(databasePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });

    const db = new Database(file);
    // WAL lets readers proceed during a write; foreign keys are off by default
    // in SQLite and the membership cascade depends on them.
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    const statement = (sql) => db.prepare(sql);

    const api = {
        async get(sql, params = []) {
            return statement(sql).get(...params) ?? null;
        },
        async all(sql, params = []) {
            return statement(sql).all(...params);
        },
        async run(sql, params = []) {
            const result = statement(sql).run(...params);
            return { changes: result.changes };
        },
    };

    // Transactions run one at a time. The chain is the queue.
    let queue = Promise.resolve();

    async function tx(fn) {
        const run = queue.then(async () => {
            db.exec('BEGIN');
            try {
                const value = await fn(api);
                db.exec('COMMIT');
                return value;
            } catch (error) {
                // A rollback can itself fail if the connection is already in a
                // bad state; the original error is the one worth reporting.
                try { db.exec('ROLLBACK'); } catch { /* already unwound */ }
                throw error;
            }
        });
        // Keep the queue alive after a failed transaction, and do not let the
        // chain hold an unhandled rejection.
        queue = run.then(() => undefined, () => undefined);
        return run;
    }

    async function init() {
        migrate(db);
        for (const sql of schemaStatements('sqlite')) db.exec(sql);
        return `SQLite at ${file}`;
    }

    return {
        dialect: 'sqlite',
        ...api,
        tx,
        init,
        async exec(sql) { db.exec(sql); },
        async close() { db.close(); },
    };
}

const columns = (db, table) =>
    db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);

const tableExists = (db, table) =>
    Boolean(
        db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
    );

/**
 * Bring a pre-Phase-5 database up to the current schema.
 *
 * Two things changed when the schema had to work on Postgres too: `rowid`
 * ordering became an explicit `seq` column, and the file-name uniqueness index
 * became case-insensitive to match the check the code was already making. Both
 * need existing tables rebuilt rather than altered, because SQLite cannot add a
 * PRIMARY KEY column in place.
 */
function migrate(db) {
    for (const table of ['chat_messages', 'document_snapshots']) {
        if (!tableExists(db, table)) continue;
        if (columns(db, table).includes('seq')) continue;

        const carried = columns(db, table).join(', ');
        // The pragma has to be outside the transaction — SQLite ignores it
        // inside one — and the copy has to be inside it, so a failure halfway
        // leaves the old table rather than half a new one.
        db.exec('PRAGMA foreign_keys = OFF');
        try {
            db.exec('BEGIN');
            db.exec(`ALTER TABLE ${table} RENAME TO ${table}_pre_phase5`);
            // The old table's indexes followed it through the rename and are
            // dropped with it below; init() recreates them by name afterwards.
            for (const sql of schemaStatements('sqlite')) {
                if (sql.includes(`TABLE IF NOT EXISTS ${table} `)) db.exec(sql);
            }
            // rowid was the old tiebreak, so replaying in rowid order is what
            // preserves the ordering the history already had.
            db.exec(
                `INSERT INTO ${table} (${carried})
                 SELECT ${carried} FROM ${table}_pre_phase5 ORDER BY rowid`
            );
            db.exec(`DROP TABLE ${table}_pre_phase5`);
            db.exec('COMMIT');
            console.log(`[DB] Migrated ${table} to the Phase 5 schema`);
        } catch (error) {
            try { db.exec('ROLLBACK'); } catch { /* already unwound */ }
            throw error;
        } finally {
            db.exec('PRAGMA foreign_keys = ON');
        }
    }

    // The old index was on `name`, which allowed "README.md" beside
    // "readme.md" even though createFile rejected the second.
    const index = db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get('idx_room_files_unique_name');
    if (index && !/lower\(/i.test(index.sql || '')) {
        db.exec('DROP INDEX idx_room_files_unique_name');
        console.log('[DB] Rebuilt idx_room_files_unique_name as case-insensitive');
    }
}
