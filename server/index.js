import { v4 as uuidv4 } from 'uuid';
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
import { startRetentionSweep } from './services/retentionService.js';
import { isMember, touchRoom, ROOM_CAPACITY } from './services/roomService.js';
import { requireAuth, socketAuth } from './middleware/auth.js';
import { apiLimiter, allowSocketEvent } from './middleware/rateLimit.js';
import {
    parsePayload,
    byteSize,
    LIMITS,
    joinRoomSchema,
    leaveRoomSchema,
    updateLanguageSchema,
    sendMessageSchema,
    drawSchema,
    clearCanvasSchema,
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
 * @param {object} [options]
 * @param {boolean} [options.retention=true] run the background retention sweep
 * @returns {{ app: import('express').Express, server: import('http').Server, io: import('socket.io').Server, close: () => Promise<void> }}
 */
export function createDobbyServer({ retention = true } = {}) {
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
        methods: ['GET', 'POST', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    };

    // ─── Middleware ────────────────────────────────────────────────────────────────
    app.use(cors(corsOptions));
    app.use(express.json({ limit: '500kb' }));

    // ─── REST API Routes ───────────────────────────────────────────────────────────
    app.use('/api', apiLimiter);
    app.use('/api/auth', authRouter);
    app.use('/api/rooms', roomsRouter);
    // Execution is authenticated and separately rate-limited inside the router;
    // it used to be an open proxy to Piston.
    app.use('/api', requireAuth, executionRouter);

    // Health check — deliberately the one unauthenticated endpoint, and it reveals
    // nothing about the instance beyond liveness.
    app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

    // ─── HTTP + Socket.IO Server ───────────────────────────────────────────────────
    const server = http.createServer(app);

    const io = new Server(server, {
        cors: corsOptions,
        maxHttpBufferSize: Number(process.env.SOCKET_MAX_PAYLOAD_BYTES || 1_000_000),
    });

    // Setup Yjs service (registers its own membership check on the document
    // namespaces — see services/yjsService.js).
    setupYjs(io);

    // Every socket on the main namespace must present a valid access token before
    // any handler runs.
    io.use(socketAuth);

    // ─── In-Memory Room State ────────────────────────────────────────────────
    // Identity and room ownership live in SQLite (db.js). Code content is owned by
    // Yjs documents (yjsService). What remains here is ephemeral session state:
    // language selection, chat replay, and terminal bindings.
    const roomID_to_State_Map = {}; // { languageUsed: string }
    const roomID_to_ChatHistory_Map = {}; // roomId -> chat message array
    const roomStateCleanupTimers = new Map(); // roomId -> timeout
    const socketID_to_TerminalSession_Map = {};
    const terminalSessionBindings = new Map(); // sessionKey -> { dataSubs: Map<socketId, disposable>, exitSub: disposable|null }
    const terminalSessionCleanupTimers = new Map(); // sessionKey -> timeout
    const TERMINAL_INACTIVITY_TTL_MS = Number(process.env.TERMINAL_INACTIVITY_TTL_MS || 15 * 60 * 1000);
    const CHAT_HISTORY_LIMIT = Number(process.env.CHAT_HISTORY_LIMIT || 100);
    const ROOM_STATE_TTL_MS = Number(process.env.ROOM_STATE_TTL_MS || 30 * 60 * 1000);

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
    async function getUsersInRoom(roomId) {
        const socketList = await io.in(roomId).fetchSockets();
        return socketList
            .map((s) => s.data?.user?.username)
            .filter(Boolean);
    }

    function cancelRoomStateCleanup(roomId) {
        if (!roomStateCleanupTimers.has(roomId)) return;
        clearTimeout(roomStateCleanupTimers.get(roomId));
        roomStateCleanupTimers.delete(roomId);
    }

    function scheduleRoomStateCleanup(roomId) {
        cancelRoomStateCleanup(roomId);
        const timer = setTimeout(async () => {
            const socketsInRoom = await io.in(roomId).allSockets();
            if (socketsInRoom.size > 0) {
                return;
            }

            delete roomID_to_State_Map[roomId];
            delete roomID_to_ChatHistory_Map[roomId];
            roomStateCleanupTimers.delete(roomId);
            console.log(`[Room] Auto-cleaned state for inactive room ${roomId}`);
        }, ROOM_STATE_TTL_MS);

        roomStateCleanupTimers.set(roomId, timer);
    }

    /**
     * Guard for every in-room event. A socket may only act on a room it has
     * actually joined AND is still a member of in the database — membership can be
     * revoked while a socket is connected.
     */
    function assertInRoom(socket, roomId) {
        if (!socket.rooms.has(roomId) || !isMember(roomId, socket.data.user.id)) {
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
            if (!allowSocketEvent(socket, event)) return;

            const payload = parsePayload(socket, event, schema, rawPayload);
            if (!payload) return;

            if (requireRoom && !assertInRoom(socket, payload.roomId)) return;

            try {
                await handler(payload);
            } catch (error) {
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
                if (!isMember(roomId, user.id)) {
                    console.warn(`[Room] ${user.username} denied entry to ${roomId}`);
                    socket.emit('room denied', {
                        message: 'You do not have access to this room. Ask the owner for an invite.',
                    });
                    return;
                }

                cancelRoomStateCleanup(roomId);

                const room = io.sockets.adapter.rooms.get(roomId);
                const currentSize = room ? room.size : 0;

                // Capacity counts live connections, not memberships: the same member
                // opening a second tab should not lock their partner out.
                if (!socket.rooms.has(roomId) && currentSize >= ROOM_CAPACITY) {
                    socket.emit('room full', {
                        message: `Room is full. Maximum ${ROOM_CAPACITY} users allowed per room.`,
                    });
                    return;
                }

                socket.join(roomId);
                touchRoom(roomId);

                const userslist = await getUsersInRoom(roomId);
                socket.in(roomId).emit('new member joined', { username: user.username });
                io.in(roomId).emit('updating client list', { userslist });

                // Send current language state to the new user
                if (roomID_to_State_Map[roomId]) {
                    socket.emit('on language change', {
                        languageUsed: roomID_to_State_Map[roomId].languageUsed,
                    });
                }
                socket.emit('chat history', {
                    messages: roomID_to_ChatHistory_Map[roomId] || [],
                });

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
                scheduleRoomStateCleanup(roomId);

                console.log(`[Room] ${user.username} left ${roomId}`);
            },
            { requireRoom: false }
        );

        // ── Language Sync (still socket-based; Yjs owns code content) ───────────
        on(socket, 'update language', updateLanguageSchema, ({ roomId, languageUsed }) => {
            if (!roomID_to_State_Map[roomId]) {
                roomID_to_State_Map[roomId] = {};
            }
            roomID_to_State_Map[roomId].languageUsed = languageUsed;
            socket.to(roomId).emit('on language change', { languageUsed });
        });

        // NOTE: code content is owned entirely by Yjs (services/yjsService.js).
        // The old `update code` / `on code change` / `syncing the code` broadcast
        // pair was removed — it was last-write-wins and no client used it.

        // ── Chat ─────────────────────────────────────────────────────────────────
        // The author is the server's record of who this socket is; a client-supplied
        // `username` is ignored, so nobody can post as their partner.
        on(socket, 'send_message', sendMessageSchema, ({ message, roomId }) => {
            const chatMessage = {
                message,
                messageId: uuidv4(),
                user: user.username,
                userId: user.id,
                timestamp: new Date().toISOString(),
            };

            if (!roomID_to_ChatHistory_Map[roomId]) {
                roomID_to_ChatHistory_Map[roomId] = [];
            }
            roomID_to_ChatHistory_Map[roomId].push(chatMessage);
            if (roomID_to_ChatHistory_Map[roomId].length > CHAT_HISTORY_LIMIT) {
                roomID_to_ChatHistory_Map[roomId] = roomID_to_ChatHistory_Map[roomId].slice(-CHAT_HISTORY_LIMIT);
            }

            io.in(roomId).emit('receive_message', chatMessage);
        });

        // ── Whiteboard ───────────────────────────────────────────────────────────
        on(socket, 'draw', drawSchema, ({ roomId, data }) => {
            if (byteSize(data) > LIMITS.drawPayload) {
                socket.emit('socket:error', { event: 'draw', message: 'Stroke payload too large.' });
                return;
            }
            socket.to(roomId).emit('on draw', { data });
        });

        on(socket, 'clear canvas', clearCanvasSchema, ({ roomId }) => {
            socket.to(roomId).emit('clear canvas');
        });

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
                scheduleRoomStateCleanup(roomId);
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

    // ─── Background Jobs ─────────────────────────────────────────────────────
    const stopRetention = retention ? startRetentionSweep() : null;

    return {
        app,
        server,
        io,
        /** Release the port, the sweep timer, and every open socket. */
        async close() {
            stopRetention?.();
            for (const timer of roomStateCleanupTimers.values()) clearTimeout(timer);
            roomStateCleanupTimers.clear();
            for (const timer of terminalSessionCleanupTimers.values()) clearTimeout(timer);
            terminalSessionCleanupTimers.clear();
            await new Promise((resolve) => io.close(resolve));
        },
    };
}

/** Start listening. Split from the factory so tests can build one without a port. */
export function startDobbyServer(port = process.env.PORT || 5001) {
    const instance = createDobbyServer();

    instance.server.listen(port, () => {
        console.log(`✓ Dobby server running on port ${port}`);
        console.log(`  REST API: http://localhost:${port}/api`);
        console.log(`  Health:   http://localhost:${port}/health`);
        if (TERMINAL_ENABLED) {
            console.log(`  Terminal: enabled (isolation=${TERMINAL_ISOLATION})`);
            if (TERMINAL_ISOLATION === 'host') {
                console.warn('  ⚠ Terminal isolation is "host" — shells are NOT sandboxed. Development only.');
            }
        } else {
            console.log('  Terminal: disabled');
        }
    });

    return instance;
}

// Only listen when run directly (`node index.js`), never when imported by a test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    startDobbyServer();
}
