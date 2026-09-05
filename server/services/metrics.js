/**
 * services/metrics.js
 * Visibility into a running instance.
 *
 * Before this there was `console.log` and nothing else: no way to answer how
 * many rooms are live, whether documents are growing without bound, how long an
 * execution actually takes, or how often a client is being rate-limited. Those
 * are the questions the load test needs answered too, so the load test reads
 * these same numbers rather than inventing its own.
 *
 * Two shapes of metric, and the distinction matters for how they are written:
 *
 *  - **Counters and histograms** are recorded at the moment something happens
 *    (`observeExecution`, `recordSocketEvent`). They are cumulative, so a
 *    restart resets them and the dashboard must use `rate()`.
 *  - **Gauges** are sampled on scrape, from collector callbacks the server
 *    registers. Sampling rather than incrementing removes a whole class of bug:
 *    a gauge maintained by hand drifts the first time a decrement is missed on
 *    an error path, and drifted gauges are worse than no gauges.
 *
 * Every value is per-process. In a cluster each replica exposes its own
 * `/metrics` and Prometheus sums them, which is why the labels carry `node`.
 */

import client from 'prom-client';
import { NODE_ID } from './cluster.js';
import { dialect as dbDialect } from '../db.js';

export const registry = new client.Registry();

registry.setDefaultLabels({ node: NODE_ID });

// Event-loop lag, heap, GC, handles. The Yjs documents live in this heap, so
// process memory is a real signal about document growth rather than noise.
client.collectDefaultMetrics({ register: registry, prefix: 'dobby_' });

/**
 * Gauge collectors, registered by a running server and removed when it closes.
 * A `Set` of provider objects rather than one, because a test process can hold
 * two servers, and a metric that reported only the first would be misleading in
 * exactly the situation Phase 4 is about.
 */
const providers = new Set();

/**
 * @param {object} provider
 * @param {() => number} [provider.activeRooms]
 * @param {() => number} [provider.connectedSockets]
 * @param {() => number} [provider.liveTerminals]
 * @param {() => {count: number, bytes: number}} [provider.documents]
 * @returns {() => void} removes the provider
 */
export function registerCollectors(provider) {
    providers.add(provider);
    return () => providers.delete(provider);
}

/** Sum one provider field across every registered server, skipping failures. */
function total(field, fallback = 0) {
    let sum = fallback;
    for (const provider of providers) {
        const fn = provider[field];
        if (typeof fn !== 'function') continue;
        try {
            sum += fn() ?? 0;
        } catch (error) {
            // A collector that throws must not take the scrape down with it —
            // an unreachable /metrics is how monitoring gets turned off.
            console.error(`[Metrics] Collector "${field}" failed:`, error.message);
        }
    }
    return sum;
}

// "Which engine is this replica actually talking to?" is the first question
// when a cluster misbehaves, and reading it back from the process beats
// trusting the environment file you think it has. It goes here rather than on
// `/health`, which is deliberately anonymous and deliberately says nothing
// about the instance beyond liveness; `/metrics` is the guarded surface.
new client.Gauge({
    name: 'dobby_store_info',
    help: 'Always 1. The `engine` label is the relational store this node is using.',
    labelNames: ['engine'],
    registers: [registry],
    collect() {
        this.labels(dbDialect).set(1);
    },
});

const gauge = (name, help, field) =>
    new client.Gauge({
        name,
        help,
        registers: [registry],
        collect() {
            this.set(total(field));
        },
    });

gauge('dobby_active_rooms', 'Rooms with at least one connected socket on this node.', 'activeRooms');
gauge('dobby_connected_sockets', 'Authenticated sockets on the main namespace of this node.', 'connectedSockets');
gauge('dobby_live_terminals', 'PTY sessions alive on this node.', 'liveTerminals');

new client.Gauge({
    name: 'dobby_yjs_documents_open',
    help: 'Yjs documents held in memory by this node.',
    registers: [registry],
    collect() {
        let count = 0;
        for (const provider of providers) {
            try {
                count += provider.documents?.().count ?? 0;
            } catch (error) {
                console.error('[Metrics] Document collector failed:', error.message);
            }
        }
        this.set(count);
    },
});

new client.Gauge({
    name: 'dobby_yjs_document_bytes',
    help: 'Encoded size of every open Yjs document on this node. The unbounded-growth signal.',
    registers: [registry],
    collect() {
        let bytes = 0;
        for (const provider of providers) {
            try {
                bytes += provider.documents?.().bytes ?? 0;
            } catch (error) {
                console.error('[Metrics] Document collector failed:', error.message);
            }
        }
        this.set(bytes);
    },
});

/**
 * Execution latency. Bucketed wide because the interesting failure is Piston
 * being slow rather than Dobby being slow, and that shows up in seconds.
 */
export const executionDuration = new client.Histogram({
    name: 'dobby_execution_duration_seconds',
    help: 'Wall-clock time of a /api/execute call, from request to response.',
    labelNames: ['language', 'outcome'],
    buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 20],
    registers: [registry],
});

/** Socket throughput, and the reason anything was dropped. */
export const socketEvents = new client.Counter({
    name: 'dobby_socket_events_total',
    help: 'Socket events by event name and outcome (ok, rate_limited, invalid, denied, failed).',
    labelNames: ['event', 'outcome'],
    registers: [registry],
});

export const httpRequests = new client.Histogram({
    name: 'dobby_http_request_duration_seconds',
    help: 'REST request latency by method, route, and status class.',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry],
});

/**
 * Misroutes. In a correctly configured cluster this stays flat at zero, which
 * makes any increase a specific and actionable alert: the balancer is not
 * hashing on `doc`, or it is mid-rescale.
 */
export const documentLeaseConflicts = new client.Counter({
    name: 'dobby_document_lease_conflicts_total',
    help: 'Yjs connections refused because another node holds the document lease.',
    registers: [registry],
});

export const snapshotsTaken = new client.Counter({
    name: 'dobby_snapshots_total',
    help: 'Document snapshots written, by outcome (captured, skipped_unchanged, skipped_too_large).',
    labelNames: ['outcome'],
    registers: [registry],
});

/** Record one execution. `outcome` is `ok`, `rejected`, or `error`. */
export function observeExecution(language, outcome, seconds) {
    executionDuration.labels(language || 'unknown', outcome).observe(seconds);
}

/** Record one socket event's disposition. */
export function recordSocketEvent(event, outcome) {
    socketEvents.labels(event, outcome).inc();
}

/** The current exposition text. */
export function collectMetrics() {
    return registry.metrics();
}
