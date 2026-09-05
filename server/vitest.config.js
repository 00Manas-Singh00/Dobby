import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        // setup.js sets JWT_SECRET and the store paths. It has to run before any
        // import, because authService reads JWT_SECRET at module scope and
        // throws when it is missing.
        setupFiles: ['./tests/setup.js'],
        // Runs once in the main process, after every worker is done. Its only
        // job is dropping the per-process Postgres schemas the workers create;
        // it is a no-op on SQLite.
        globalSetup: ['./tests/globalSetup.js'],
        // Each test file gets its own process. The services hold module-level
        // singletons — the SQLite handle, the YSocketIO instance — and sharing
        // those across files would let one file's rooms leak into another's.
        pool: 'forks',
        // On SQLite every store call returns within the same tick, so twenty
        // parallel forks cost nothing. Against Postgres each one is a round
        // trip, and at full fork concurrency the socket tests — which assert
        // that an event arrives, or does not arrive, inside a fixed window —
        // start losing to scheduling rather than to a real defect. Capping the
        // workers there is cheaper and more honest than widening every timeout
        // until the flakiness hides.
        poolOptions: {
            forks: { singleFork: false, ...(process.env.DATABASE_URL ? { maxForks: 4 } : {}) },
        },
        include: ['tests/**/*.test.js'],
        testTimeout: 15_000,
        hookTimeout: 20_000,
    },
});
