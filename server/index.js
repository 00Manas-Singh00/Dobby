import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
dotenv.config();

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

// Internal services & routes
import terminalManager, { TERMINAL_ENABLED, TERMINAL_ISOLATION } from './terminalManager.js';
import executionRouter from './routes/execution.js';
import authRouter from './routes/auth.js';
import roomsRouter from './routes/rooms.js';
import { setupYjs } from './services/yjsService.js';
import metricsRouter from './routes/metrics.js';
import { startRetentionSweep } from './services/retentionService.js';
import { isMember, touchRoom, ROOM_CAPACITY } from './services/roomService.js';
import { appendMessage, listMessages } from './services/chatService.js';
import { startSnapshotSweep } from './services/snapshotService.js';
import {
    openDocuments,
    documentStats,
    getDocumentRouter,
    closeDocuments,
} from './services/yjsService.js';
import { requireAuth, socketAuth } from './middleware/auth.js';
import { apiLimiter, allowSocketEvent, useSharedRateLimitStore } from './middleware/rateLimit.js';
import { connectCluster, NODE_ID } from './services/cluster.js';
import { ready as dbReady, close as dbClose } from './db.js';
import { createRoomStateStore } from './services/roomStateStore.js';
import { registerCollectors, httpRequests, recordSocketEvent } from './services/metrics.js';
import {
    parsePayload,
    byteSize,
    LIMITS,
    joinRoomSchema,
    leaveRoomSchema,
    updateLanguageSchema,
    sendMessageSchema,
    joinVideoSchema,
    sendingSignalSchema,
    returningSignalSchema,
    terminalCreateSchema,
    terminalInputSchema,
    terminalResizeSchema,
} from './middleware/validate.js';

/**
 * Build a complete Dobby server without starting it.
 *
 * Everything below used to run at module scope, which meant importing this file
 * bound a port and started the retention sweep — so none of it could be tested.
 * The per-room state maps now live per instance rather than per process, so two
 * servers in one test run cannot see each other's rooms.
 *
 * It is `async` as of Phase 4. The Redis connection has to be established
 * *before* the first socket is served — the adapter, the shared rate-limit
 * store, and the Yjs document leases all depend on it, and a connection served
 * in the window before they attach would be served single-node without anyone
 * noticing. Awaiting construction is the simplest way to make that window not
 * exist. With `REDIS_URL` unset there is nothing to await and this resolves
 * immediately.
 *
 * @param {object} [options]
 * @param {boolean} [options.retention=true] run the background retention sweep
 * @param {boolean} [options.snapshots=true] run the periodic document snapshot pass
 * @param {boolean} [options.cluster=true] honour REDIS_URL; false forces single-node
 * @returns {Promise<{ app: import('express').Express, server: import('http').Server, io: import('socket.io').Server, cluster: object, close: () => Promise<void> }>}
 */
export async function createDobbyServer({ retention = true, snapshots = true, cluster = true } = {}) {
    // Connect and create tables before anything is served. Fails closed for the
    // same reason the cluster connection does: a server whose store is
    // unreachable answers every request with a 500, and an orchestrator
    // restarting it is a better outcome than a replica that looks healthy.
    await dbReady();

    // Fails closed: if REDIS_URL is set and Redis is unreachable this throws
    // rather than silently starting an isolated replica.
    const clusterConnection = cluster
        ? await connectCluster()
        : { enabled: false, adapter: null, redis: null, async close() {} };

    const app = express();

    // Rate limiters key on req.ip, which is the proxy's address unless Express is
    // told how many hops to trust. Left unset behind a load balancer, every user
    // would share one bucket.
    if (process.env.TRUST_PROXY) {
        app.set('trust proxy', Number(process.env.TRUST_PROXY));
    }

    // ─── CORS ──────────────────────────────────────────────────────────────────────
    // Wildcard origins are a development convenience only. In any deployed
    // environment ALLOWED_ORIGINS must list the exact front-end origins.
    const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);

    const corsOptions = {
        origin(origin, callback) {
            // Same-origin/non-browser callers send no Origin header.
            if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
            // Deny by withholding the CORS headers rather than throwing — throwing
            // surfaces a 500 with a stack trace instead of a clean browser block.
            console.warn(`[CORS] Rejected origin: ${origin}`);
            return callback(null, false);
        },
        methods: ['GET', 'POST', 'PATCH', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    };

    // ─── Middleware ────────────────────────────────────────────────────────────────
    app.use(cors(corsOptions));
    app.use(express.json({ limit: '500kb' }));

    // Timing is recorded on `finish` rather than around the handler so it covers
    // the response body actually being written, and it labels on the matched
    // route rather than the URL — `/api/rooms/:id` and not one time series per
    // room id, which is how a metrics backend gets taken down by cardinality.
    app.use((req, res, next) => {
        const started = process.hrtime.bigint();
        res.on('finish', () => {
            const seconds = Number(process.hrtime.bigint() - started) / 1e9;
            const route = req.route?.path
                ? `${req.baseUrl || ''}${req.route.path}`
                : req.baseUrl || 'unmatched';
            httpRequests.labels(req.method, route, String(res.statusCode)).observe(seconds);
        });
        next();
    });

    // Quotas are per user, and a user's requests can land on any replica, so the
    // counters have to be shared or every published limit is multiplied by the
    // replica count.
    useSharedRateLimitStore(clusterConnection.redis);

    // ─── REST API Routes ───────────────────────────────────────────────────────────
    app.use('/api', apiLimiter);
    app.use('/api/auth', authRouter);
    app.use('/api/rooms', roomsRouter);
    // Execution is authenticated and separately rate-limited inside the router;
    // it used to be an open proxy to Piston.
    app.use('/api', requireAuth, executionRouter);

    // Health check — deliberately the one unauthenticated endpoint, and it reveals
    // nothing about the instance beyond liveness. It was tempting to add the node
    // id here for debugging a load balancer, but that would make the one
    // anonymous endpoint an inventory of the fleet; the id is a label on every
    // metric instead, behind the guard that page already has.
    app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

    // Guarded separately from /api: a scraper is not a user, and this reveals an
    // inventory of the instance rather than nothing. See routes/metrics.js.
    app.use(metricsRouter);

    // ─── HTTP + Socket.IO Server ───────────────────────────────────────────────────
    const server = http.createServer(app);

    const io = new Server(server, {
        cors: corsOptions,
        maxHttpBufferSize: Number(process.env.SOCKET_MAX_PAYLOAD_BYTES || 1_000_000),
    });

    // The adapter is attached before anything else touches `io`, because every
    // namespace created afterwards — including y-socket.io's dynamic document
    // namespaces — inherits it. Attaching later would leave whatever already
    // existed on the in-memory adapter, which is the kind of split that only
    // shows up under load.
    if (clusterConnection.adapter) io.adapter(clusterConnection.adapter);

    // Routers reach the socket server through the app rather than an import, so
    // one process can hold two servers without their broadcasts crossing. This
    // is what lets a file created over REST reach the other person's explorer.
    app.set('io', io);

    // Setup Yjs service (registers its own membership check on the document
    // namespaces — see services/yjsService.js). In cluster mode it also takes a
    // per-document lease, because a Y.Doc is state in one process and cannot be
    // replicated by broadcasting harder.
    setupYjs(io, { redis: clusterConnection.redis });

    // Every socket on the main namespace must present a valid access token before
    // any handler runs.
    io.use(socketAuth);

    // ─── Room State ──────────────────────────────────────────────────────────
    // Identity, room ownership, the file tree, and chat live in the relational
    // store — SQLite or Postgres, decided by DATABASE_URL (db.js).
    // Code content and whiteboard strokes are owned by Yjs documents
    // (yjsService). What remained here through Phase 3 was the language
    // selection — a plain object plus a `Map` of expiry timers — and the
    // terminal bindings.
    //
    // The language moved into `roomStateStore`, which is a Redis hash in cluster
    // mode and the same object-plus-timers in single-node mode. It had to move:
    // two replicas each holding their own copy meant a language change reached
    // your partner only if the balancer happened to have put you on one node.
    //
    // The terminal bindings deliberately did **not** move, and cannot. They are
    // references to a live PTY and its event subscriptions — objects, not data.
    // A session is reachable only from the process holding the process, so the
    // map is correct exactly where it is; what a cluster needs instead is for a
    // reconnecting client to land back on the same node, which is what the
    // sticky-session rule in deploy/nginx.conf provides.
    const roomState = createRoomStateStore({ redis: clusterConnection.redis });
    const socketID_to_TerminalSession_Map = {};
    const terminalSessionBindings = new Map(); // sessionKey -> { dataSubs: Map<socketId, disposable>, exitSub: disposable|null }
    const terminalSessionCleanupTimers = new Map(); // sessionKey -> timeout
    const TERMINAL_INACTIVITY_TTL_MS = Number(process.env.TERMINAL_INACTIVITY_TTL_MS || 15 * 60 * 1000);

    function detachTerminalSocket(sessionKey, socketId) {
        const binding = terminalSessionBindings.get(sessionKey);
        if (!binding) return;

        const sub = binding.dataSubs.get(socketId);
        if (sub) {
            sub.dispose();
            binding.dataSubs.delete(socketId);
        }

        if (binding.dataSubs.size === 0) {
            if (terminalSessionCleanupTimers.has(sessionKey)) {
                clearTimeout(terminalSessionCleanupTimers.get(sessionKey));
            }

            const timer = setTimeout(() => {
                const latestBinding = terminalSessionBindings.get(sessionKey);
                if (latestBinding && latestBinding.dataSubs.size > 0) {
                    return;
                }

                console.log(`[Terminal] Auto-cleanup inactive session ${sessionKey}`);
                if (latestBinding?.exitSub) {
                    latestBinding.exitSub.dispose();
                }
                terminalSessionBindings.delete(sessionKey);
                terminalSessionCleanupTimers.delete(sessionKey);
                terminalManager.destroyTerminal(sessionKey);
            }, TERMINAL_INACTIVITY_TTL_MS);

            terminalSessionCleanupTimers.set(sessionKey, timer);
        }
    }

    // ─── Helpers ───────────────────────────────────────────────────────────────────
    /**
     * Every socket in a room, across the whole cluster.
     *
     * `fetchSockets()` rather than `allSockets()`, and the difference is not
     * cosmetic: the Redis adapter overrides `fetchSockets` and does *not*
     * override `allSockets`, so `allSockets` silently answers with only the
     * sockets connected to this process. Occupancy computed that way would make
     * the two-person cap a cap of two *per replica*, and the bug would look
     * like "sometimes a third person can get in".
     */
    const socketsInRoom = (roomId) => io.in(roomId).fetchSockets();

    async function getUsersInRoom(roomId) {
        const socketList = await socketsInRoom(roomId);
        return socketList
            .map((s) => s.data?.user?.username)
            .filter(Boolean);
    }

    /**
     * Re-arm the room's expiry, but only once it is genuinely empty everywhere.
     *
     * Cluster-wide, for the reason in `socketsInRoom`: a room that still has
     * someone on another replica is not empty, and expiring its language
     * because this process emptied would be a bug nobody could reproduce
     * locally. Checking here rather than inside the store keeps the store
     * ignorant of Socket.IO, and keeps the "is anyone still here?" question in
     * the one place that can answer it.
     */
    async function releaseRoomState(roomId) {
        const occupants = await socketsInRoom(roomId);
        if (occupants.length > 0) return;
        await roomState.release(roomId);
    }

    /**
     * Guard for every in-room event. A socket may only act on a room it has
     * actually joined AND is still a member of in the database — membership can be
     * revoked while a socket is connected.
     */
    async function assertInRoom(socket, roomId) {
        if (!socket.rooms.has(roomId) || !(await isMember(roomId, socket.data.user.id))) {
            socket.emit('socket:error', {
                event: 'membership',
                message: 'You are not a member of this room.',
            });
            return false;
        }
        return true;
    }

    /**
     * Wrap a handler with the rate limiter, payload validation, and (unless opted
     * out) the room membership check. Registering handlers this way is what keeps
     * any one of the three from being forgotten on a new event.
     */
    function on(socket, event, schema, handler, { requireRoom = true } = {}) {
        socket.on(event, async (rawPayload) => {
            // Each early return is counted with its own reason, so
            // `dobby_socket_events_total` answers *why* traffic was dropped —
            // a client hitting its quota, a malformed payload, and a revoked
            // membership are three different incidents that look identical in a
            // single "errors" number.
            if (!allowSocketEvent(socket, event)) return; // counted by the limiter

            const payload = parsePayload(socket, event, schema, rawPayload);
            if (!payload) {
                recordSocketEvent(event, 'invalid');
                return;
            }

            if (requireRoom && !(await assertInRoom(socket, payload.roomId))) {
                recordSocketEvent(event, 'denied');
                return;
            }

            try {
                await handler(payload);
                recordSocketEvent(event, 'ok');
            } catch (error) {
                recordSocketEvent(event, 'failed');
                console.error(`[Socket] ${event} failed:`, error);
                socket.emit('socket:error', { event, message: 'Something went wrong.' });
            }
        });
    }

    // ─── Socket.IO Event Handlers ──────────────────────────────────────────────────
    io.on('connection', (socket) => {
        const user = socket.data.user;
        console.log(`[Socket] Connected: ${socket.id} (${user.username})`);

        // ── Room Management ──────────────────────────────────────────────────────
        // `join room` cannot use assertInRoom — joining is what makes it true — so
        // it checks database membership directly.
        on(
            socket,
            'join room',
            joinRoomSchema,
            async ({ roomId }) => {
                if (!(await isMember(roomId, user.id))) {
                    console.warn(`[Room] ${user.username} denied entry to ${roomId}`);
                    socket.emit('room denied', {
                        message: 'You do not have access to this room. Ask the owner for an invite.',
                    });
                    return;
                }

                await roomState.retain(roomId);

                // Capacity has to be counted across the cluster, not from this
                // process's room map: with two replicas, `adapter.rooms` holds
                // only the sockets connected here, so a two-person cap would
                // silently become two people per node.
                const occupants = await socketsInRoom(roomId);
                const currentSize = occupants.length;

                // Capacity counts live connections, not memberships: the same member
                // opening a second tab should not lock their partner out.
                if (!socket.rooms.has(roomId) && currentSize >= ROOM_CAPACITY) {
                    socket.emit('room full', {
                        message: `Room is full. Maximum ${ROOM_CAPACITY} users allowed per room.`,
                    });
                    return;
                }

                socket.join(roomId);
                await touchRoom(roomId);

                const userslist = await getUsersInRoom(roomId);
                socket.in(roomId).emit('new member joined', { username: user.username });
                io.in(roomId).emit('updating client list', { userslist });

                // Send current language state to the new user
                const state = await roomState.get(roomId);
                if (state?.languageUsed) {
                    socket.emit('on language change', { languageUsed: state.languageUsed });
                }
                // Read from the store rather than a process-memory array, so the
                // transcript survives a restart and an emptied room, not just a
                // refresh.
                socket.emit('chat history', { messages: await listMessages(roomId) });

                console.log(`[Room] ${user.username} joined ${roomId} (${currentSize + 1}/${ROOM_CAPACITY})`);
            },
            { requireRoom: false }
        );

        // Clients emit this when navigating away without dropping the connection
        // (e.g. moving between rooms). Without it the socket stays a member of the
        // old room and keeps receiving its broadcasts.
        on(
            socket,
            'leave room',
            leaveRoomSchema,
            async ({ roomId }) => {
                if (!socket.rooms.has(roomId)) return;

                const sessionKey = socketID_to_TerminalSession_Map[socket.id];
                if (sessionKey) {
                    detachTerminalSocket(sessionKey, socket.id);
                    delete socketID_to_TerminalSession_Map[socket.id];
                }

                socket.leave(roomId);
                socket.to(roomId).emit('member left', { username: user.username });

                const userslist = await getUsersInRoom(roomId);
                io.in(roomId).emit('updating client list', { userslist });
                await releaseRoomState(roomId);

                console.log(`[Room] ${user.username} left ${roomId}`);
            },
            { requireRoom: false }
        );

        // ── Language Sync (still socket-based; Yjs owns code content) ───────────
        on(socket, 'update language', updateLanguageSchema, async ({ roomId, languageUsed }) => {
            await roomState.setLanguage(roomId, languageUsed);
            socket.to(roomId).emit('on language change', { languageUsed });
        });

        // NOTE: code content is owned entirely by Yjs (services/yjsService.js).
        // The old `update code` / `on code change` / `syncing the code` broadcast
        // pair was removed — it was last-write-wins and no client used it.

        // ── Chat ─────────────────────────────────────────────────────────────────
        // The author is the server's record of who this socket is; a client-supplied
        // `username` is ignored, so nobody can post as their partner.
        on(socket, 'send_message', sendMessageSchema, async ({ message, roomId }) => {
            const chatMessage = await appendMessage(roomId, user, message);
            io.in(roomId).emit('receive_message', chatMessage);
        });

        // ── Whiteboard ───────────────────────────────────────────────────────────
        // There are no whiteboard events here any more. Strokes are a `Y.Array`
        // in the room's `<roomId>:__whiteboard__` document, so they take the
        // same CRDT path as code: replayed in full to a late joiner, persisted
        // to LevelDB, and merged rather than relayed. The old `draw` /
        // `on draw` broadcast stored nothing, which is why a second person
        // arriving mid-session used to find a blank canvas.

        // ── WebRTC Video Signaling ───────────────────────────────────────────────
        on(socket, 'join video', joinVideoSchema, ({ roomId }) => {
            const room = io.sockets.adapter.rooms.get(roomId);
            const users = room ? Array.from(room).filter((id) => id !== socket.id) : [];
            socket.emit('all users video', users);
        });

        // Signals used to be relayed to any socket id named by the sender, which let
        // an authenticated client push SDP at strangers. Both ends must now be in
        // the same room.
        on(socket, 'sending signal', sendingSignalSchema, ({ roomId, userToSignal, signal }) => {
            if (byteSize(signal) > LIMITS.signalPayload) {
                socket.emit('socket:error', { event: 'sending signal', message: 'Signal payload too large.' });
                return;
            }
            if (!io.sockets.adapter.rooms.get(roomId)?.has(userToSignal)) return;

            io.to(userToSignal).emit('user joined video', {
                signal,
                callerID: socket.id,
            });
        });

        on(socket, 'returning signal', returningSignalSchema, ({ roomId, callerID, signal }) => {
            if (byteSize(signal) > LIMITS.signalPayload) {
                socket.emit('socket:error', { event: 'returning signal', message: 'Signal payload too large.' });
                return;
            }
            if (!io.sockets.adapter.rooms.get(roomId)?.has(callerID)) return;

            io.to(callerID).emit('receiving returned signal', {
                signal,
                id: socket.id,
            });
        });

        // ── Terminal ─────────────────────────────────────────────────────────────
        on(socket, 'terminal:create', terminalCreateSchema, ({ roomId }) => {
            if (!TERMINAL_ENABLED) {
                socket.emit('terminal:error', {
                    message: 'Terminal is disabled on this server.',
                });
                return;
            }

            // Membership was already checked by `on`. The session key uses the
            // authenticated user id — never a client-supplied value — so a client
            // cannot attach to another user's shell by naming it.
            const sessionKey = `${roomId}:${user.id}`;
            const previousSessionKey = socketID_to_TerminalSession_Map[socket.id];
            if (previousSessionKey && previousSessionKey !== sessionKey) {
                detachTerminalSocket(previousSessionKey, socket.id);
            }
            socketID_to_TerminalSession_Map[socket.id] = sessionKey;

            console.log(`[Terminal] Attach/create for session ${sessionKey} (socket ${socket.id})`);

            const existingTerminal = terminalManager.getTerminal(sessionKey);
            let ptyProcess = existingTerminal;
            if (!ptyProcess) {
                try {
                    ptyProcess = terminalManager.createTerminal(sessionKey);
                } catch (error) {
                    console.error(`[Terminal] Create failed for ${sessionKey}:`, error.message);
                    delete socketID_to_TerminalSession_Map[socket.id];
                    socket.emit('terminal:error', { message: error.message });
                    return;
                }
            }

            if (!terminalSessionBindings.has(sessionKey)) {
                terminalSessionBindings.set(sessionKey, {
                    dataSubs: new Map(),
                    exitSub: null,
                });
            }
            const binding = terminalSessionBindings.get(sessionKey);
            if (terminalSessionCleanupTimers.has(sessionKey)) {
                clearTimeout(terminalSessionCleanupTimers.get(sessionKey));
                terminalSessionCleanupTimers.delete(sessionKey);
            }

            detachTerminalSocket(sessionKey, socket.id);
            const dataSub = ptyProcess.onData((data) => {
                io.to(socket.id).emit('terminal:output', { data });
            });
            binding.dataSubs.set(socket.id, dataSub);

            if (!binding.exitSub) {
                binding.exitSub = ptyProcess.onExit(({ exitCode, signal }) => {
                    console.log(`[Terminal] ${sessionKey} exited with code ${exitCode}`);
                    const currentBinding = terminalSessionBindings.get(sessionKey);
                    if (currentBinding) {
                        for (const boundSocketId of currentBinding.dataSubs.keys()) {
                            io.to(boundSocketId).emit('terminal:exit', { exitCode, signal });
                        }
                        for (const sub of currentBinding.dataSubs.values()) {
                            sub.dispose();
                        }
                        terminalSessionBindings.delete(sessionKey);
                    }
                    if (terminalSessionCleanupTimers.has(sessionKey)) {
                        clearTimeout(terminalSessionCleanupTimers.get(sessionKey));
                        terminalSessionCleanupTimers.delete(sessionKey);
                    }
                    terminalManager.destroyTerminal(sessionKey);
                });
            }

            socket.emit('terminal:ready', {
                message: 'Terminal ready',
                reattached: Boolean(existingTerminal),
                isolation: TERMINAL_ISOLATION,
            });
        });

        on(
            socket,
            'terminal:input',
            terminalInputSchema,
            ({ data }) => {
                const sessionKey = socketID_to_TerminalSession_Map[socket.id];
                if (sessionKey) {
                    terminalManager.writeToTerminal(sessionKey, data);
                }
            },
            { requireRoom: false }
        );

        on(
            socket,
            'terminal:resize',
            terminalResizeSchema,
            ({ cols, rows }) => {
                const sessionKey = socketID_to_TerminalSession_Map[socket.id];
                if (sessionKey) {
                    terminalManager.resizeTerminal(sessionKey, cols, rows);
                }
            },
            { requireRoom: false }
        );

        // ── Disconnect / Cleanup ─────────────────────────────────────────────────
        socket.on('disconnecting', () => {
            const rooms = [...socket.rooms];
            rooms.forEach((roomId) => {
                if (roomId === socket.id) return; // Skip personal room
                socket.in(roomId).emit('member left', { username: user.username });
                // Deliberately not awaited: `disconnecting` is synchronous, and
                // the emptiness check inside runs on the next tick — by which
                // time this socket has left, which is what makes the count
                // right.
                releaseRoomState(roomId).catch((error) =>
                    console.error('[Room] Expiry re-arm failed:', error.message)
                );
            });
        });

        socket.on('disconnect', () => {
            console.log(`[Socket] Disconnected: ${socket.id}`);
            const sessionKey = socketID_to_TerminalSession_Map[socket.id];
            if (sessionKey) {
                detachTerminalSocket(sessionKey, socket.id);
            }
            delete socketID_to_TerminalSession_Map[socket.id];
        });
    });

    // ─── Metrics Collectors ──────────────────────────────────────────────────
    // Sampled on scrape rather than incremented by hand: a counter maintained
    // across the join, leave, disconnect, and error paths drifts the first time
    // one of them is missed, and a gauge that lies is worse than no gauge.
    const unregisterCollectors = registerCollectors({
        activeRooms: () => {
            let count = 0;
            for (const [name, members] of io.sockets.adapter.rooms) {
                // Socket.IO gives every socket a room named after its own id;
                // those are not rooms in Dobby's sense.
                if (members.size === 1 && io.sockets.sockets.has(name)) continue;
                count += 1;
            }
            return count;
        },
        connectedSockets: () => io.sockets.sockets.size,
        liveTerminals: () => terminalManager.sessionCount(),
        documents: () => documentStats(),
    });

    // ─── Background Jobs ─────────────────────────────────────────────────────
    const stopRetention = retention ? startRetentionSweep() : null;
    // Snapshots read from the live documents rather than from LevelDB, so a
    // document being actively edited is captured mid-session rather than only
    // once everyone has closed it.
    const stopSnapshots = snapshots ? startSnapshotSweep(openDocuments) : null;

    return {
        app,
        server,
        io,
        /** This node's identity, and whether it is part of a cluster. */
        cluster: { enabled: clusterConnection.enabled, nodeId: NODE_ID },

        /** Release the port, the sweep timers, the leases, and every open socket. */
        async close() {
            stopRetention?.();
            stopSnapshots?.();
            unregisterCollectors();
            await roomState.close();
            for (const timer of terminalSessionCleanupTimers.values()) clearTimeout(timer);
            terminalSessionCleanupTimers.clear();
            // Order matters here, and each step depends on the next still
            // being available. Documents flush their final state and disconnect
            // their editors (both of which use Redis); then the leases are
            // handed back, so the replacement replica does not wait out a TTL;
            // then the sockets close; and only then does the connection those
            // three steps needed go away.
            await closeDocuments();
            await getDocumentRouter().close();
            await new Promise((resolve) => io.close(resolve));

            // `io.close()` resolves when the HTTP server is done, but the
            // per-socket disconnect handlers it triggers are async and are still
            // finishing — y-socket.io flushes a document and the adapter
            // publishes the disconnect. Quitting Redis underneath them produced
            // an unhandled `ClientClosedError`. There is no completion signal to
            // await for work we did not start, so this drains a tick's worth of
            // it; anything still outstanding after that is a broadcast nobody is
            // left to receive.
            await new Promise((resolve) => setTimeout(resolve, 100));
            await clusterConnection.close();
        },
    };
}

/** Start listening. Split from the factory so tests can build one without a port. */
export async function startDobbyServer(port = process.env.PORT || 5001) {
    const instance = await createDobbyServer();

    instance.server.listen(port, () => {
        console.log(`✓ Dobby server running on port ${port}`);
        console.log(`  REST API: http://localhost:${port}/api`);
        console.log(`  Health:   http://localhost:${port}/health`);
        console.log(`  Metrics:  http://localhost:${port}/metrics`);
        console.log(
            instance.cluster.enabled
                ? `  Cluster:  enabled (node ${instance.cluster.nodeId})`
                : '  Cluster:  single node'
        );
        if (TERMINAL_ENABLED) {
            console.log(`  Terminal: enabled (isolation=${TERMINAL_ISOLATION})`);
            if (TERMINAL_ISOLATION === 'host') {
                console.warn('  ⚠ Terminal isolation is "host" — shells are NOT sandboxed. Development only.');
            }
        } else {
            console.log('  Terminal: disabled');
        }
    });

    // Shutdown is not just tidiness in a cluster: `close()` hands back this
    // node's document leases, and without it every document it was serving is
    // unavailable to the replacement replica until the lease TTL lapses. Guard
    // against a second signal so an impatient operator's second Ctrl-C exits
    // immediately rather than restarting the teardown.
    let shuttingDown = false;
    const shutdown = async (signal) => {
        if (shuttingDown) process.exit(1);
        shuttingDown = true;
        console.log(`\n[Server] ${signal} — releasing leases and closing connections`);
        try {
            await instance.close();
            await new Promise((resolve) => instance.server.close(resolve));
            // Last, and only on a real process exit rather than in
            // `instance.close()`: the store is a module-level singleton shared
            // by every server built in this process, so closing it with one of
            // them would break the others.
            await dbClose();
        } catch (error) {
            console.error('[Server] Shutdown error:', error.message);
        }
        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    return instance;
}

// Only listen when run directly (`node index.js`), never when imported by a test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    // A rejection here means Redis was configured and is unreachable. Exiting
    // is the correct response: the orchestrator restarts and retries, which is
    // far better than a replica running in silent isolation.
    startDobbyServer().catch((error) => {
        console.error('✗ Dobby failed to start:', error.message);
        process.exit(1);
    });
}
