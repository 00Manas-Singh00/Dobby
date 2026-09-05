/**
 * tests/setup.js
 * Environment for the test process, applied before any module is imported.
 *
 * This has to be a setup file rather than a helper: authService reads
 * JWT_SECRET at module scope and throws without it, and db.js resolves and
 * opens its SQLite file on import. Both happen before the first line of a test
 * body runs.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

// One scratch directory per test process, so files running in parallel forks
// never share a database.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dobby-test-'));

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-pass-the-32-char-check';
process.env.DATABASE_PATH = path.join(tmpRoot, 'dobby.db');
// Empty, not unset: yjsService reads this exact value as "run in memory".
process.env.YJS_PERSISTENCE_DIR = '';
process.env.TERMINAL_WORKSPACE_ROOT = path.join(tmpRoot, 'workspaces');

// bcrypt at 12 rounds costs ~250ms per hash. The tests exercise the hashing
// path, not its cost factor.
process.env.BCRYPT_ROUNDS = '4';

// Limits are asserted explicitly where they matter; a low default would make
// unrelated tests flaky as they accumulate requests.
process.env.AUTH_RATE_LIMIT = '10000';
process.env.API_RATE_LIMIT = '10000';
process.env.EXECUTE_RATE_LIMIT = '10000';

process.on('exit', () => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// The server narrates room joins, socket connections, and retention passes.
// Useful when debugging one test, unreadable across a whole run — so it is off
// unless asked for.
if (!process.env.VERBOSE_TESTS) {
    console.log = () => {};
    console.warn = () => {};
}
