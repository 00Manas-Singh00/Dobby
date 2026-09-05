/**
 * loadtest/run.js
 * A load generator for Dobby, and the source of the numbers in
 * docs/09-load-test.md.
 *
 * ## What it measures, and why that
 *
 * Requests per second is the wrong headline for this application. Dobby's
 * workload is not a stream of independent requests — it is a small number of
 * long-lived connections exchanging tiny, latency-sensitive messages, and the
 * thing a user notices is **how long after I type does my partner see it**. So
 * the primary metric is one-way propagation latency through the real path: a
 * Yjs update leaves one socket, the server applies it to the document, and it
 * arrives at the other socket in the same room.
 *
 * Chat round-trip is measured alongside it because it goes through the other
 * half of the server — the validated, rate-limited, database-writing handler path
 * — and the two degrade for different reasons.
 *
 * ## Shape of the load
 *
 * One *pair* is what the product is: two users, one room, one shared document,
 * both connected. Both type. That is deliberately not a benchmark-friendly
 * shape — a single writer with many readers would produce prettier numbers and
 * would not resemble a pairing session.
 *
 * Pairs ramp in over `--ramp` seconds rather than all at once, because a
 * thundering herd measures connection establishment rather than steady state,
 * and steady state is the question.
 *
 * ## Honesty
 *
 * Every measurement here is taken from the client side, on the load generator's
 * clock, with both ends of each pair in one process — so there is no clock skew,
 * and a one-way latency is genuinely one-way. What it does *not* separate is the
 * driver's own scheduling delay from the server's: at high pair counts this
 * process is itself busy, and the numbers include that. The report prints the
 * driver's event-loop lag next to the latencies so that contribution is visible
 * rather than hidden, and a run is only worth publishing while that lag is small
 * relative to the latency being reported.
 */

import { createRequire } from 'module';
import { io as ioClient } from 'socket.io-client';
import { setTimeout as sleep } from 'timers/promises';
import { writeFileSync } from 'fs';
import { performance } from 'perf_hooks';

const require = createRequire(import.meta.url);
const Y = require('yjs');

// ─── Arguments ───────────────────────────────────────────────────────────────

const DEFAULTS = {
    url: 'http://127.0.0.1:5001',
    pairs: 25,
    duration: 60,
    ramp: 10,
    keystrokes: 4,
    chatEvery: 10,
    metricsToken: '',
    json: '',
};

function parseArgs(argv) {
    const args = { ...DEFAULTS };

    for (let i = 2; i < argv.length; i += 2) {
        const key = argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        if (!(key in args)) throw new Error(`Unknown flag: ${argv[i]}`);
        args[key] = typeof DEFAULTS[key] === 'number' ? Number(argv[i + 1]) : argv[i + 1];
    }
    return args;
}

// ─── Statistics ──────────────────────────────────────────────────────────────

/**
 * Percentiles from the full sample rather than a streaming estimate.
 *
 * A run holds tens of thousands of numbers, which is nothing to keep in memory,
 * and an exact p99 that can be recomputed from the raw data is worth more than
 * an approximate one nobody can check.
 */
function summarize(values) {
    if (values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

    return {
        count: sorted.length,
        min: +sorted[0].toFixed(1),
        p50: +at(50).toFixed(1),
        p95: +at(95).toFixed(1),
        p99: +at(99).toFixed(1),
        max: +sorted[sorted.length - 1].toFixed(1),
        mean: +(sorted.reduce((sum, n) => sum + n, 0) / sorted.length).toFixed(1),
    };
}

/**
 * Event-loop lag on the *driver*, sampled every 100ms.
 *
 * Without this the report cannot distinguish a slow server from an overloaded
 * load generator, and those two have opposite remedies.
 */
function trackDriverLag() {
    const samples = [];
    let last = performance.now();
    const timer = setInterval(() => {
        const now = performance.now();
        samples.push(now - last - 100);
        last = now;
    }, 100);
    timer.unref();

    return {
        stop() {
            clearInterval(timer);
            return summarize(samples.filter((n) => n >= 0));
        },
    };
}

// ─── REST helpers ────────────────────────────────────────────────────────────

async function api(url, path, { method = 'GET', body, token } = {}) {
    const response = await fetch(`${url}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
        throw new Error(`${method} ${path} -> ${response.status} ${await response.text()}`);
    }
    return response.json();
}

let userCounter = 0;

function registerUser(url) {
    userCounter += 1;
    return api(url, '/api/auth/register', {
        method: 'POST',
        body: {
            email: `load-${process.pid}-${userCounter}@example.com`,
            username: `load${process.pid}x${userCounter}`,
            password: 'correct horse battery staple',
        },
    });
}

/** Two accounts, a room, and a redeemed invite: one pair's worth of setup. */
async function provisionPair(url) {
    const owner = await registerUser(url);
    const guest = await registerUser(url);

    const { room } = await api(url, '/api/rooms', {
        method: 'POST',
        body: { name: `load-${userCounter}` },
        token: owner.accessToken,
    });

    const { invite } = await api(url, `/api/rooms/${room.id}/invites`, {
        method: 'POST',
        body: {},
        token: owner.accessToken,
    });

    await api(url, '/api/rooms/join', {
        method: 'POST',
        body: { token: invite.token },
        token: guest.accessToken,
    });

    return { owner, guest, room };
}

// ─── Socket helpers ──────────────────────────────────────────────────────────

const open = new Set();

function connect(url, token, extra = {}) {
    const socket = ioClient(url, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
        ...extra,
    });
    open.add(socket);

    return new Promise((resolve, reject) => {
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
    });
}

/** The `?doc=` hint is the same one the browser sends; see yjsProvider.js. */
function connectDocument(url, token, docName) {
    return connect(`${url}/yjs|${docName}`, token, { query: { doc: docName } });
}

// ─── One pair ────────────────────────────────────────────────────────────────

/**
 * A pair types at each other for the duration of the run.
 *
 * Latency is carried in the payload rather than matched by sequence number: the
 * typist inserts a marker containing its send timestamp, and the reader finds
 * that marker in the bytes of the update it receives. That survives Yjs
 * coalescing several edits into one update, which sequence matching would not.
 */
async function runPair(config, results, index) {
    const { url, keystrokes, chatEvery } = config;
    const { owner, guest, room } = await provisionPair(url);

    const docName = `${room.id}:load-file`;

    const [ownerSocket, guestSocket, ownerDoc, guestDoc] = await Promise.all([
        connect(url, owner.accessToken),
        connect(url, guest.accessToken),
        connectDocument(url, owner.accessToken, docName),
        connectDocument(url, guest.accessToken, docName),
    ]);

    await Promise.all(
        [ownerSocket, guestSocket].map(
            (socket) =>
                new Promise((resolve) => {
                    socket.once('updating client list', resolve);
                    socket.emit('join room', { roomId: room.id });
                })
        )
    );

    // Each side keeps a real Y.Doc, so the updates on the wire are the shape the
    // editor actually produces — incremental, small, and dependent on the
    // document's history rather than synthetic blobs of a fixed size.
    const localDocs = [new Y.Doc(), new Y.Doc()];

    /**
     * Count an update only on the socket that did *not* send it.
     *
     * y-socket.io broadcasts an update to the whole namespace, sender included,
     * so a naive listener sees every edit twice — and the sender's own echo is a
     * round trip to itself, not the propagation delay to a partner. Counting it
     * would double the sample size with numbers that mean something else. Each
     * side therefore tags its markers (`A` or `B`) and each listener ignores its
     * own tag.
     */
    const observe = (socket, ownTag) => {
        socket.on('sync-update', (update) => {
            const text = Buffer.from(update).toString('latin1');
            const match = text.match(/#([AB])(\d+\.\d+)#/);
            if (!match) results.unmatchedUpdates += 1;
            else if (match[1] !== ownTag) {
                results.editLatency.push(performance.now() - Number(match[2]));
            }
        });
    };
    observe(ownerDoc, 'A');
    observe(guestDoc, 'B');

    guestSocket.on('receive_message', (message) => {
        const sentAt = Number(String(message.message).split('|')[1]);
        if (Number.isFinite(sentAt)) results.chatLatency.push(performance.now() - sentAt);
    });

    let stopped = false;
    const typists = [
        { doc: localDocs[0], socket: ownerDoc, tag: 'A' },
        { doc: localDocs[1], socket: guestDoc, tag: 'B' },
    ];

    const typeLoop = (async () => {
        // Offset each pair's phase so every pair does not fire on the same tick;
        // a synchronized load measures the scheduler, not the server.
        await sleep((index * 37) % 1000);

        while (!stopped) {
            for (const { doc, socket, tag } of typists) {
                const before = Y.encodeStateVector(doc);
                // The marker is a tag plus the send timestamp, delimited so it
                // can be found in the encoded update without decoding the CRDT.
                doc.getText('monaco').insert(0, `#${tag}${performance.now().toFixed(3)}#`);
                socket.emit('sync-update', Y.encodeStateAsUpdate(doc, before));
                results.editsSent += 1;
            }
            await sleep(1000 / keystrokes);
        }
    })();

    const chatLoop = (async () => {
        while (!stopped) {
            await sleep(chatEvery * 1000);
            if (stopped) break;
            ownerSocket.emit('send_message', {
                roomId: room.id,
                message: `load|${performance.now()}`,
            });
            results.chatSent += 1;
        }
    })();

    return {
        async stop() {
            stopped = true;
            await Promise.allSettled([typeLoop, chatLoop]);
            for (const socket of [ownerSocket, guestSocket, ownerDoc, guestDoc]) {
                socket.disconnect();
                open.delete(socket);
            }
        },
    };
}

// ─── Server-side numbers ─────────────────────────────────────────────────────

/**
 * Read the server's own gauges.
 *
 * The load generator's view and the server's view of the same run should agree
 * on how many sockets and rooms exist. Where they do not, one of them is wrong
 * and the run should not be published — which is the main reason this is here
 * rather than only in a dashboard.
 */
async function scrapeMetrics(url, token) {
    try {
        const response = await fetch(`${url}/metrics`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) return { error: `HTTP ${response.status}` };

        const text = await response.text();
        const value = (name) => {
            const line = text
                .split('\n')
                .find((row) => row.startsWith(`${name}{`) || row.startsWith(`${name} `));
            return line ? Number(line.slice(line.lastIndexOf(' ') + 1)) : null;
        };

        return {
            activeRooms: value('dobby_active_rooms'),
            connectedSockets: value('dobby_connected_sockets'),
            documentsOpen: value('dobby_yjs_documents_open'),
            documentBytes: value('dobby_yjs_document_bytes'),
            residentMemoryBytes: value('dobby_process_resident_memory_bytes'),
            cpuSecondsTotal: value('dobby_process_cpu_seconds_total'),
            eventLoopLagP99: value('dobby_nodejs_eventloop_lag_p99_seconds'),
            leaseConflicts: value('dobby_document_lease_conflicts_total'),
        };
    } catch (error) {
        return { error: error.message };
    }
}

// ─── Driver ──────────────────────────────────────────────────────────────────

async function main() {
    const config = parseArgs(process.argv);
    console.log(`Dobby load test -> ${config.url}`);
    console.log(
        `  ${config.pairs} pairs · ${config.duration}s steady state · ` +
            `${config.ramp}s ramp · ${config.keystrokes} edits/s per typist\n`
    );

    const results = {
        editLatency: [],
        chatLatency: [],
        editsSent: 0,
        chatSent: 0,
        unmatchedUpdates: 0,
        setupFailures: 0,
    };

    const before = await scrapeMetrics(config.url, config.metricsToken);
    const lag = trackDriverLag();
    const pairs = [];

    // Ramp: pairs arrive spread over `ramp` seconds. A failure is counted rather
    // than fatal, because a partial run at a known size is still a data point —
    // the count is itself a result, marking where the server stopped accepting.
    const gap = (config.ramp * 1000) / Math.max(1, config.pairs);
    for (let i = 0; i < config.pairs; i += 1) {
        try {
            pairs.push(await runPair(config, results, i));
        } catch (error) {
            results.setupFailures += 1;
            console.error(`  pair ${i} failed: ${error.message}`);
        }
        await sleep(gap);
    }
    console.log(`  ${pairs.length}/${config.pairs} pairs live; holding ${config.duration}s\n`);

    // Measurement starts here, not during the ramp: the ramp includes
    // registration, room creation, and connection setup, none of which a user in
    // a steady session is waiting on.
    results.editLatency.length = 0;
    results.chatLatency.length = 0;
    results.editsSent = 0;
    results.chatSent = 0;

    const startedAt = performance.now();
    await sleep(config.duration * 1000);
    const elapsedSeconds = (performance.now() - startedAt) / 1000;

    const during = await scrapeMetrics(config.url, config.metricsToken);
    const driverLag = lag.stop();

    await Promise.allSettled(pairs.map((pair) => pair.stop()));
    for (const socket of open) socket.disconnect();

    const report = {
        config,
        pairsLive: pairs.length,
        elapsedSeconds: +elapsedSeconds.toFixed(1),
        editLatencyMs: summarize(results.editLatency),
        chatLatencyMs: summarize(results.chatLatency),
        editsPerSecond: +(results.editsSent / elapsedSeconds).toFixed(1),
        editsSent: results.editsSent,
        editsObserved: results.editLatency.length,
        unmatchedUpdates: results.unmatchedUpdates,
        chatSent: results.chatSent,
        chatObserved: results.chatLatency.length,
        setupFailures: results.setupFailures,
        driverEventLoopLagMs: driverLag,
        server: { before, during },
    };

    print(report);

    if (config.json) {
        writeFileSync(config.json, JSON.stringify(report, null, 2));
        console.log(`\nRaw report written to ${config.json}`);
    }

    // Disconnected sockets can keep the loop alive briefly.
    setTimeout(() => process.exit(0), 500).unref();
}

function print(report) {
    const row = (label, stats) =>
        stats
            ? `  ${label.padEnd(20)} p50 ${String(stats.p50).padStart(7)}  ` +
              `p95 ${String(stats.p95).padStart(7)}  p99 ${String(stats.p99).padStart(7)}  ` +
              `max ${String(stats.max).padStart(8)}   (n=${stats.count})`
            : `  ${label.padEnd(20)} no samples`;

    console.log('-- Latency (ms) ------------------------------------------------');
    console.log(row('editor propagation', report.editLatencyMs));
    console.log(row('chat round trip', report.chatLatencyMs));
    console.log(row('driver loop lag', report.driverEventLoopLagMs));

    console.log('\n-- Throughput --------------------------------------------------');
    console.log(`  pairs live           ${report.pairsLive}`);
    console.log(`  edits sent           ${report.editsSent} (${report.editsPerSecond}/s)`);
    console.log(`  edits observed       ${report.editsObserved}`);
    console.log(`  chat sent / observed ${report.chatSent} / ${report.chatObserved}`);
    console.log(`  setup failures       ${report.setupFailures}`);

    const server = report.server.during;
    console.log('\n-- Server (from /metrics) --------------------------------------');
    if (server.error) {
        console.log(`  unavailable: ${server.error}`);
        return;
    }
    const mib = (bytes) => (bytes / 1024 / 1024).toFixed(1);
    console.log(`  active rooms         ${server.activeRooms}`);
    console.log(`  connected sockets    ${server.connectedSockets}`);
    console.log(`  documents open       ${server.documentsOpen}`);
    console.log(`  document bytes       ${server.documentBytes} (${mib(server.documentBytes)} MiB)`);
    console.log(`  resident memory      ${mib(server.residentMemoryBytes)} MiB`);
    console.log(
        `  cpu seconds          ${(
            server.cpuSecondsTotal - (report.server.before.cpuSecondsTotal ?? 0)
        ).toFixed(1)} over the run`
    );
    console.log(`  event loop lag p99   ${(server.eventLoopLagP99 * 1000).toFixed(1)} ms`);
    console.log(`  lease conflicts      ${server.leaseConflicts}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
