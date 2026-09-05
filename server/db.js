/**
 * db.js
 * The relational store for identity, rooms, memberships, invites, the file
 * tree, chat, and document history — behind one interface, over either engine.
 *
 * **SQLite by default. Postgres when `DATABASE_URL` is set.** That single
 * switch is the whole of Phase 5's storage change, and it mirrors the shape
 * `REDIS_URL` already had: unset, the server is the single node it always was;
 * set, it can share its store with replicas on other hosts. SQLite is
 * single-writer, so replicas had to share one file over a volume — which works
 * on one host and nowhere else (docs/07-adrs.md#adr-017).
 *
 * **Why this interface is async even on SQLite.** better-sqlite3 is
 * synchronous, and that was a stated advantage of choosing it
 * (docs/07-adrs.md#adr-010): no async plumbing through socket handlers where
 * an authorization check runs on every event. Postgres is a network round trip
 * and cannot be anything but async, and keeping two interfaces — sync for one
 * engine, async for the other — would mean every caller had two shapes to get
 * right. One async interface, taken everywhere, is the cost of the choice.
 *
 * **Portable SQL is the caller's job.** Statements use `?` placeholders (the
 * Postgres driver rewrites them), ISO-8601 strings rather than a timestamp
 * type, `COALESCE` rather than `IFNULL`, `lower(x)` rather than `COLLATE
 * NOCASE`, and an explicit `seq` column rather than SQLite's `rowid`.
 */

import { createSqliteDriver } from './db/sqlite.js';
import { createPostgresDriver } from './db/postgres.js';

const DATABASE_URL = process.env.DATABASE_URL || '';

/** Which engine this process is talking to. Reported at startup and on /health. */
export const dialect = DATABASE_URL ? 'postgres' : 'sqlite';

const driver =
    dialect === 'postgres'
        ? createPostgresDriver({
              connectionString: DATABASE_URL,
              // Tests give each process its own namespace, the way each used to
              // get its own SQLite file.
              schema: process.env.DATABASE_SCHEMA || '',
              ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
          })
        : createSqliteDriver({ databasePath: process.env.DATABASE_PATH || './.data/dobby.db' });

// Connecting and creating tables is deferred rather than done on import, so a
// module that merely imports this one does not open a socket. Every query
// awaits it, so no caller has to remember to; `ready()` exists so startup can
// await it explicitly and fail before serving anything.
let initialization = null;

export function ready() {
    if (!initialization) {
        initialization = driver
            .init()
            .then((description) => {
                console.log(`✓ Store ready — ${description}`);
                return driver;
            })
            .catch((error) => {
                // Reset so a retry is possible; a server that starts with no
                // store would answer every request with a 500 anyway.
                initialization = null;
                throw new Error(`Database is unavailable: ${error.message}`);
            });
    }
    return initialization;
}

/** First matching row, or null. */
export async function get(sql, params = []) {
    return (await ready()).get(sql, params);
}

/** Every matching row. */
export async function all(sql, params = []) {
    return (await ready()).all(sql, params);
}

/** Execute a statement; resolves to `{ changes }`. */
export async function run(sql, params = []) {
    return (await ready()).run(sql, params);
}

/**
 * Run `fn` inside a transaction, passing it a `{ get, all, run }` that is
 * bound to it. Statements issued through the module-level functions instead
 * would run outside the transaction on Postgres, where a transaction is a
 * property of a connection rather than of the process.
 */
export async function tx(fn) {
    return (await ready()).tx(fn);
}

/**
 * A `COUNT(*) AS n` as a number.
 *
 * Postgres returns a bigint as a string rather than lose precision above 2^53,
 * so `row.n` is `'2'` on one engine and `2` on the other. Every counting query
 * goes through here so that difference is handled once.
 */
export async function count(sql, params = []) {
    const row = await get(sql, params);
    return Number(row?.n ?? 0);
}

/** Multi-statement DDL/DML. For migrations and for test fixtures. */
export async function exec(sql) {
    return (await ready()).exec(sql);
}

export async function close() {
    if (!initialization) return;
    const active = initialization;
    initialization = null;
    // A pending initialization that is about to fail has nothing to close, and
    // a shutdown path is the wrong place to re-raise a startup error.
    const driverOrNull = await active.catch(() => null);
    await driverOrNull?.close();
}

export default { dialect, ready, get, all, run, tx, count, exec, close };
