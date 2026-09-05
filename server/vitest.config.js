import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        // setup.js sets JWT_SECRET and the store paths. It has to run before any
        // import, because authService reads JWT_SECRET at module scope and
        // throws when it is missing.
        setupFiles: ['./tests/setup.js'],
        // Each test file gets its own process. The services hold module-level
        // singletons — the SQLite handle, the YSocketIO instance — and sharing
        // those across files would let one file's rooms leak into another's.
        pool: 'forks',
        poolOptions: { forks: { singleFork: false } },
        include: ['tests/**/*.test.js'],
        testTimeout: 15_000,
        hookTimeout: 20_000,
    },
});
