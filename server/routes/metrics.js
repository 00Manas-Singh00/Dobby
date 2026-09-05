/**
 * routes/metrics.js
 * Prometheus scrape endpoint.
 *
 * `/health` is deliberately open and says nothing but "alive". `/metrics` says
 * how many rooms exist, how many people are connected, and how large the
 * documents are — an inventory of the instance — so it is not open.
 *
 * It is guarded without being part of the user identity system, because a
 * scraper is not a user: it has no account, and giving it one would mean a
 * long-lived password in a Prometheus config. Two ways in, in order:
 *
 *  1. `METRICS_TOKEN` set — a bearer token, compared in constant time.
 *  2. `METRICS_TOKEN` unset — loopback callers only, which is the sidecar and
 *     the `curl` an operator runs over an SSH tunnel.
 *
 * The default is therefore closed to the network rather than open, and the
 * error says which of the two is missing so a misconfigured scraper is a
 * two-minute fix rather than a mystery 403.
 */

import express from 'express';
import { timingSafeEqual } from 'crypto';
import { collectMetrics, registry } from '../services/metrics.js';

const router = express.Router();

const METRICS_TOKEN = process.env.METRICS_TOKEN || '';

/** Constant-time compare that tolerates unequal lengths without leaking them. */
function tokenMatches(presented) {
    const a = Buffer.from(presented);
    const b = Buffer.from(METRICS_TOKEN);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

const isLoopback = (req) => {
    const ip = req.ip || '';
    // Express reports IPv4-mapped IPv6 for a v4 client on a dual-stack socket.
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
};

router.get('/metrics', async (req, res) => {
    if (METRICS_TOKEN) {
        const presented = (req.headers.authorization || '').replace(/^Bearer /, '');
        if (!presented || !tokenMatches(presented)) {
            return res.status(401).json({ error: 'Invalid or missing metrics token.' });
        }
    } else if (!isLoopback(req)) {
        return res.status(403).json({
            error: 'Metrics are restricted to loopback. Set METRICS_TOKEN to scrape remotely.',
        });
    }

    try {
        res.set('Content-Type', registry.contentType);
        return res.send(await collectMetrics());
    } catch (error) {
        console.error('[Metrics] Collection failed:', error.message);
        return res.status(500).json({ error: 'Metrics collection failed.' });
    }
});

export default router;
