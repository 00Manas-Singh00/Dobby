/**
 * tests/helpers/db.js
 * Truncating the store between tests, on either engine.
 *
 * This used to be one `DELETE FROM …; DELETE FROM …;` string per test file,
 * written in SQLite's dialect and repeated with a slightly different table list
 * each time. Postgres rejects several of those statements in one call through a
 * parameterised query, and a test file that forgot a table would leave rows
 * behind for the next one — so the order lives with the schema now.
 */

import db from '../../db.js';
import { TABLES_IN_DEPENDENCY_ORDER } from '../../db/schema.js';

/** Empty every table, children before parents so the foreign keys hold. */
export async function resetDatabase() {
    await db.ready();
    for (const table of TABLES_IN_DEPENDENCY_ORDER) {
        await db.run(`DELETE FROM ${table}`);
    }
}
