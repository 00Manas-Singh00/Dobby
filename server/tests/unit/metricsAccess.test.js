/**
 * Who may scrape `/metrics`.
 *
 * The route reads `METRICS_TOKEN` at import, so each case here re-imports the
 * module under a different environment rather than mutating a live one — which
 * is also the honest model of the thing being tested: the guard is chosen once,
 * at startup, and cannot change under a running server.
 *
 * The default deserves its own test. An unset token must mean *closed to the
 * network*, not open: metrics are an inventory of the instance, and a
 * fail-open default would publish it from the first deployment that forgot a
 * variable.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

async function appWithToken(token) {
    vi.resetModules();
    if (token === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = token;

    const { default: metricsRouter } = await import('../../routes/metrics.js');
    const app = express();
    // Trust the forwarded address so a non-loopback client can be simulated;
    // this mirrors a deployment behind a proxy, which is where the loopback
    // rule has to hold.
    app.set('trust proxy', 1);
    app.use(metricsRouter);
    return app;
}

describe('metrics access', () => {
    beforeEach(() => {
        delete process.env.METRICS_TOKEN;
    });

    describe('with no token configured', () => {
        it('serves a loopback caller', async () => {
            const app = await appWithToken(undefined);
            await request(app).get('/metrics').expect(200);
        });

        it('refuses a caller from anywhere else', async () => {
            const app = await appWithToken(undefined);
            const response = await request(app)
                .get('/metrics')
                .set('X-Forwarded-For', '203.0.113.10')
                .expect(403);

            // The message says which of the two ways in is missing, so a
            // misconfigured scraper is a two-minute fix.
            expect(response.body.error).toContain('METRICS_TOKEN');
        });
    });

    describe('with a token configured', () => {
        it('accepts the right bearer token from a remote caller', async () => {
            const app = await appWithToken('scrape-me-please');
            await request(app)
                .get('/metrics')
                .set('X-Forwarded-For', '203.0.113.10')
                .set('Authorization', 'Bearer scrape-me-please')
                .expect(200);
        });

        it('rejects a wrong token', async () => {
            const app = await appWithToken('scrape-me-please');
            await request(app)
                .get('/metrics')
                .set('Authorization', 'Bearer wrong')
                .expect(401);
        });

        it('rejects a token of a different length without leaking that fact', async () => {
            const app = await appWithToken('scrape-me-please');
            const response = await request(app)
                .get('/metrics')
                .set('Authorization', 'Bearer short')
                .expect(401);

            expect(response.body.error).toBe('Invalid or missing metrics token.');
        });

        it('rejects a missing token even from loopback', async () => {
            // Configuring a token narrows access rather than adding a second
            // way in; loopback stops being sufficient on its own.
            const app = await appWithToken('scrape-me-please');
            await request(app).get('/metrics').expect(401);
        });
    });
});
