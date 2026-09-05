/**
 * db/schema.js
 * One schema, rendered for either engine.
 *
 * Phase 5 replaced SQLite-only storage with a choice between SQLite and
 * Postgres (docs/07-adrs.md#adr-017), and the obvious way to do that — a
 * `schema.sqlite.sql` beside a `schema.postgres.sql` — is the way the two
 * quietly drift apart. There is one definition here instead, with the handful
 * of genuinely dialect-specific spellings pulled out into `TYPES`.
 *
 * Everything else is written in the intersection of the two dialects: `?`
 * placeholders (rewritten to `$n` by the Postgres driver), ISO-8601 strings
 * rather than a native timestamp type, `COALESCE` rather than `IFNULL`, and
 * `lower(name)` rather than `COLLATE NOCASE`.
 */

const TYPES = {
    sqlite: {
        // SQLite's rowid alias. AUTOINCREMENT additionally forbids reuse of a
        // deleted row's number, which is what makes `seq` a total order over
        // inserts rather than merely unique among live rows.
        seq: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        blob: 'BLOB',
    },
    postgres: {
        seq: 'BIGSERIAL PRIMARY KEY',
        blob: 'BYTEA',
    },
};

/** Tables and indexes for `dialect`, as an array of statements. */
export function schemaStatements(dialect) {
    const T = TYPES[dialect];
    if (!T) throw new Error(`Unknown database dialect: ${dialect}`);

    return [
        `CREATE TABLE IF NOT EXISTS users (
            id            TEXT PRIMARY KEY,
            email         TEXT NOT NULL UNIQUE,
            username      TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at    TEXT NOT NULL
        )`,

        `CREATE TABLE IF NOT EXISTS rooms (
            id             TEXT PRIMARY KEY,
            name           TEXT NOT NULL,
            owner_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at     TEXT NOT NULL,
            last_active_at TEXT NOT NULL
        )`,

        `CREATE TABLE IF NOT EXISTS room_members (
            room_id   TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
            user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role      TEXT NOT NULL CHECK (role IN ('owner', 'guest')),
            joined_at TEXT NOT NULL,
            PRIMARY KEY (room_id, user_id)
        )`,

        // Single-use, expiring tokens. A room is joinable only by presenting one
        // of these or by already being a member; the room id itself grants
        // nothing.
        `CREATE TABLE IF NOT EXISTS room_invites (
            token      TEXT PRIMARY KEY,
            room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
            created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            used_at    TEXT,
            used_by    TEXT REFERENCES users(id) ON DELETE SET NULL
        )`,

        // Refresh tokens are stored hashed so a database read does not yield a
        // usable credential.
        `CREATE TABLE IF NOT EXISTS refresh_tokens (
            token_hash TEXT PRIMARY KEY,
            user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            revoked_at TEXT
        )`,

        // The room's file tree. Metadata only: the *content* of a file is a Yjs
        // document named <roomId>:<fileId>, so nothing here is written on a
        // keystroke. A folder is a row with no content document; the tree is an
        // adjacency list, with NULL parent_id meaning root.
        `CREATE TABLE IF NOT EXISTS room_files (
            id         TEXT PRIMARY KEY,
            room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
            parent_id  TEXT REFERENCES room_files(id) ON DELETE CASCADE,
            name       TEXT NOT NULL,
            type       TEXT NOT NULL CHECK (type IN ('file', 'folder')),
            language   TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )`,

        // Chat used to live in a process-memory array and died with the process.
        // `seq` exists because ordering by `created_at` alone is ambiguous
        // within a millisecond, and the tiebreak used to be SQLite's `rowid` —
        // which Postgres does not have.
        `CREATE TABLE IF NOT EXISTS chat_messages (
            seq        ${T.seq},
            id         TEXT NOT NULL UNIQUE,
            room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
            user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
            username   TEXT NOT NULL,
            message    TEXT NOT NULL,
            created_at TEXT NOT NULL
        )`,

        // Point-in-time Yjs state, so a document has a history to restore from.
        // The document store holds only the current state.
        `CREATE TABLE IF NOT EXISTS document_snapshots (
            seq        ${T.seq},
            id         TEXT NOT NULL UNIQUE,
            room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
            doc_name   TEXT NOT NULL,
            state      ${T.blob} NOT NULL,
            size       INTEGER NOT NULL,
            created_at TEXT NOT NULL
        )`,

        `CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_room_files_room ON room_files(room_id)`,
        `CREATE INDEX IF NOT EXISTS idx_room_files_parent ON room_files(parent_id)`,

        // Both engines treat NULLs as distinct in a UNIQUE constraint, so a
        // plain UNIQUE(room_id, parent_id, name) would allow duplicate names at
        // the root; COALESCE collapses root into a single comparable key. The
        // `lower()` is what the duplicate-name check in fileService has always
        // used — the index now enforces the same rule the code checks.
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_room_files_unique_name
            ON room_files(room_id, COALESCE(parent_id, ''), lower(name))`,

        `CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id, created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_document_snapshots_doc
            ON document_snapshots(room_id, doc_name, created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_room_invites_room ON room_invites(room_id)`,
        `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id)`,
    ];
}

/** Every table, in an order that respects the foreign keys. Used by tests. */
export const TABLES_IN_DEPENDENCY_ORDER = [
    'document_snapshots',
    'chat_messages',
    'room_files',
    'refresh_tokens',
    'room_invites',
    'room_members',
    'rooms',
    'users',
];
