/**
 * db/postgres.js
 * The networked engine: several hosts, one store.
 *
 * This is what Phase 5 is for. SQLite is single-writer and replicas therefore
 * had to share a file, which works on one host and not across hosts
 * (docs/07-adrs.md#adr-017). Setting `DATABASE_URL` swaps this driver in and
 * nothing above db.js changes.
 *
 * Three adaptations, all of them confined to this file:
 *
 * 1. **Placeholders.** The rest of the codebase writes `?`, which SQLite takes
 *    literally and Postgres does not, so `?` is rewritten to `$1, $2, …` here.
 * 2. **Schema creation races.** Every replica runs `CREATE TABLE IF NOT
 *    EXISTS` at startup, and concurrent DDL on the same table in Postgres
 *    deadlocks or errors rather than politely no-opping. An advisory lock makes
 *    exactly one replica do it.
 * 3. **Counts are bigints.** `COUNT(*)` comes back as a string to avoid losing
 *    precision. Callers already pass it through `Number()`; see db.js.
 */

import pg from 'pg';
import { schemaStatements } from './schema.js';

// Timestamps are ISO-8601 strings in this schema, not native timestamps, so
// nothing here needs a type parser. Bigints stay strings deliberately — see
// the note above.

/** `?` → `$n`. The schema contains no string literal holding a question mark. */
export function toPositional(sql) {
    let n = 0;
    return sql.replace(/\?/g, () => `$${(n += 1)}`);
}

/** `host:port/database`, with the credentials left out of the log line. */
function describe(connectionString) {
    try {
        const url = new URL(connectionString);
        return `${url.hostname}:${url.port || 5432}${url.pathname}`;
    } catch {
        return 'the configured server';
    }
}

/**
 * The key two replicas contend on when creating tables.
 *
 * Scoped to the schema rather than global: two deployments sharing a server —
 * and, more to the point, the test run, where every worker process creates its
 * own schema — have nothing to serialize on each other for, and a single global
 * key turns independent startups into a queue.
 */
function schemaLockKey(schema) {
    let hash = 0x0d0bb1e5;
    for (const char of `${schema || 'public'}`) {
        hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
    }
    return hash;
}

export function createPostgresDriver({ connectionString, schema, ssl }) {
    const pool = new pg.Pool({
        connectionString,
        ssl,
        max: Number(process.env.PG_POOL_MAX || 10),
        idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30_000),
        connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10_000),
        // Every connection in the pool resolves unqualified names the same way.
        // Tests use this to give each test process its own namespace in one
        // database, the way each used to get its own SQLite file.
        ...(schema ? { options: `-c search_path=${schema}` } : {}),
    });

    // A pooled client can fail while idle — a database restart, a proxy timing
    // it out. Without a listener that surfaces as an unhandled error event and
    // takes the process down.
    pool.on('error', (error) => console.error('[DB] Idle client error:', error.message));

    const bind = (runner) => ({
        async get(sql, params = []) {
            const { rows } = await runner.query(toPositional(sql), params);
            return rows[0] ?? null;
        },
        async all(sql, params = []) {
            const { rows } = await runner.query(toPositional(sql), params);
            return rows;
        },
        async run(sql, params = []) {
            const result = await runner.query(toPositional(sql), params);
            return { changes: result.rowCount ?? 0 };
        },
    });

    async function tx(fn) {
        // A transaction must run on one connection, so it checks a client out
        // of the pool rather than going through it.
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const value = await fn(bind(client));
            await client.query('COMMIT');
            return value;
        } catch (error) {
            try { await client.query('ROLLBACK'); } catch { /* already unwound */ }
            throw error;
        } finally {
            client.release();
        }
    }

    async function init() {
        const client = await pool.connect();
        try {
            if (schema) await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
            // Session-scoped, so it is released even if this process dies
            // holding it. Replicas that lose the race wait here and then find
            // every table already present.
            const lockKey = schemaLockKey(schema);
            await client.query('SELECT pg_advisory_lock($1)', [lockKey]);
            try {
                for (const sql of schemaStatements('postgres')) await client.query(sql);
            } finally {
                await client.query('SELECT pg_advisory_unlock($1)', [lockKey]);
            }
        } finally {
            client.release();
        }

        // From the URL rather than from `pool.options`, which does not fill in
        // host/port/database when the pool was built from a connection string.
        // Never the whole URL: it carries the password.
        return `Postgres at ${describe(connectionString)}${schema ? ` (schema ${schema})` : ''}`;
    }

    return {
        dialect: 'postgres',
        ...bind(pool),
        tx,
        init,
        async exec(sql) { await pool.query(sql); },
        async close() { await pool.end(); },
    };
}
