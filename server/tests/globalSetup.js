/**
 * tests/globalSetup.js
 * Cleans up after a Postgres run.
 *
 * Each test process creates its own schema (see tests/setup.js) so that files
 * running in parallel forks cannot see each other's rows — the same isolation a
 * throwaway SQLite file gives for free. Nothing in a worker can drop it
 * afterwards: dropping needs a query, and a worker's exit hook cannot await
 * one. This runs once in the main process when the whole run is over, which is
 * the only place that can.
 *
 * It drops by prefix rather than by name so that schemas leaked by an
 * interrupted earlier run are collected too.
 */

const SCHEMA_PREFIX = 'dobby_test_';

export default function setup() {
    return async function teardown() {
        if (!process.env.DATABASE_URL) return;

        const { default: pg } = await import('pg');
        const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
        await client.connect();
        try {
            const { rows } = await client.query(
                'SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE $1',
                [`${SCHEMA_PREFIX}%`]
            );
            for (const { schema_name: name } of rows) {
                await client.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
            }
        } finally {
            await client.end();
        }
    };
}
