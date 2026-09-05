/**
 * db.js
 * Embedded SQLite store for identity and room ownership.
 *
 * Chosen for the same reasons as LevelDB for Yjs documents: zero operational
 * surface, one file on disk, synchronous API that needs no connection pooling.
 * Everything that must survive a restart and inform an authorization decision
 * lives here. Chat history, whiteboard strokes, and terminal state remain
 * in-process memory (see docs/06-roadmap.md, Phase 3).
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.resolve(process.env.DATABASE_PATH || './.data/dobby.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// WAL lets readers proceed during a write; foreign keys are off by default in
// SQLite and the membership cascade depends on them.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        username      TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_members (
        room_id   TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role      TEXT NOT NULL CHECK (role IN ('owner', 'guest')),
        joined_at TEXT NOT NULL,
        PRIMARY KEY (room_id, user_id)
    );

    -- Single-use, expiring tokens. A room is joinable only by presenting one of
    -- these or by already being a member; the room id itself grants nothing.
    CREATE TABLE IF NOT EXISTS room_invites (
        token      TEXT PRIMARY KEY,
        room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at    TEXT,
        used_by    TEXT REFERENCES users(id) ON DELETE SET NULL
    );

    -- Refresh tokens are stored hashed so a database read does not yield a
    -- usable credential.
    CREATE TABLE IF NOT EXISTS refresh_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_room_invites_room ON room_invites(room_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
`);

console.log(`✓ SQLite store ready at ${DB_PATH}`);

export default db;
