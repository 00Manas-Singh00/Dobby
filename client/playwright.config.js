import { defineConfig, devices } from '@playwright/test';

const CLIENT_PORT = 5273; // deliberately not 5173, so a dev server can stay up
const SERVER_PORT = 5401;

export const CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}`;
export const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;

export default defineConfig({
    testDir: './e2e',
    // Two browser contexts talking to one room is the whole point of these
    // tests; running files in parallel would have them competing for the
    // two-person cap on shared state.
    fullyParallel: false,
    workers: 1,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
    timeout: 90_000,
    expect: { timeout: 15_000 },

    use: {
        baseURL: CLIENT_URL,
        trace: 'retain-on-failure',
        video: 'retain-on-failure',
    },

    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

    // Both halves of the stack, started by the test run itself so CI needs no
    // orchestration beyond `npx playwright test`.
    webServer: [
        {
            command: 'npm start',
            cwd: '../server',
            port: SERVER_PORT,
            reuseExistingServer: !process.env.CI,
            stdout: 'pipe',
            stderr: 'pipe',
            env: {
                PORT: String(SERVER_PORT),
                // A fixed test secret: these instances hold nothing real, and a
                // random one per run would invalidate tokens across restarts.
                JWT_SECRET: 'e2e-secret-that-is-long-enough-to-pass-the-32-char-check',
                DATABASE_PATH: './.e2e/dobby.db',
                YJS_PERSISTENCE_DIR: './.e2e/yjs',
                ALLOWED_ORIGINS: CLIENT_URL,
                BCRYPT_ROUNDS: '4',
                ENABLE_TERMINAL: 'false',
                AUTH_RATE_LIMIT: '10000',
                API_RATE_LIMIT: '10000',
            },
        },
        {
            // A production build served statically, not the dev server: Vite
            // compiles Monaco on first request in dev, which cost ~45s on every
            // page open and made the whole suite time out. Binding is explicit
            // because Vite's default `localhost` resolves to ::1 on some
            // machines while Playwright probes 127.0.0.1.
            command:
                `npm run build && npx vite preview --host 127.0.0.1 --port ${CLIENT_PORT} --strictPort`,
            port: CLIENT_PORT,
            // The build itself takes most of this budget.
            timeout: 240_000,
            reuseExistingServer: !process.env.CI,
            stdout: 'pipe',
            stderr: 'pipe',
            env: { VITE_API_BASE_URL: SERVER_URL, VITE_SOCKET_URL: SERVER_URL },
        },
    ],
});
