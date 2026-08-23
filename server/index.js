import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

// Internal services & routes
import terminalManager, { TERMINAL_ENABLED } from './terminalManager.js';
import executionRouter from './routes/execution.js';
import { setupYjs } from './services/yjsService.js';

const app = express();

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
    methods: ['GET', 'POST'],
};

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors(corsOptions));
app.use(express.json({ limit: '500kb' }));

// ─── REST API Routes ───────────────────────────────────────────────────────────
app.use('/api', executionRouter);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ─── HTTP + Socket.IO Server ───────────────────────────────────────────────────
const server = http.createServer(app);

const io = new Server(server, { cors: corsOptions });

// Setup Yjs service
setupYjs(io);

const PORT = process.env.PORT || 5001;

// ─── In-Memory Room State ──────────────────────────────────────────────────────
// Owns: username mapping, language state per room
// Code content is owned by Yjs documents (yjsService)
const socketID_to_Users_Map = {};
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
    const socketList = await io.in(roomId).allSockets();
    const users = [];
    socketList.forEach((id) => {
        if (socketID_to_Users_Map[id]) {
            users.push(socketID_to_Users_Map[id].username);
        }
    });
    return users;
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

// ─── Socket.IO Event Handlers ──────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    // ── Room Management ──────────────────────────────────────────────────────
    socket.on('join room', async ({ roomId, username }) => {
        console.log(`[Room] ${username} attempting to join ${roomId}`);
        cancelRoomStateCleanup(roomId);

        const room = io.sockets.adapter.rooms.get(roomId);
        const currentSize = room ? room.size : 0;

        if (currentSize >= 2) {
            socket.emit('room full', {
                message: 'Room is full. Maximum 2 users allowed per room.',
            });
            return;
        }

        socketID_to_Users_Map[socket.id] = { username };
        socket.join(roomId);

        const userslist = await getUsersInRoom(roomId);
        socket.in(roomId).emit('new member joined', { username });
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

        console.log(`[Room] ${username} joined ${roomId} (${currentSize + 1}/2)`);
    });

    // Clients emit this when navigating away without dropping the connection
    // (e.g. moving between rooms). Without it the socket stays a member of the
    // old room and keeps receiving its broadcasts.
    socket.on('leave room', async ({ roomId }) => {
        if (!roomId || !socket.rooms.has(roomId)) return;

        const username = socketID_to_Users_Map[socket.id]?.username;
        const sessionKey = socketID_to_TerminalSession_Map[socket.id];
        if (sessionKey) {
            detachTerminalSocket(sessionKey, socket.id);
            delete socketID_to_TerminalSession_Map[socket.id];
        }

        socket.leave(roomId);
        socket.to(roomId).emit('member left', { username });

        const userslist = await getUsersInRoom(roomId);
        io.in(roomId).emit('updating client list', { userslist });
        scheduleRoomStateCleanup(roomId);

        console.log(`[Room] ${username} left ${roomId}`);
    });

    // ── Language Sync (still socket-based; Yjs owns code content) ───────────
    socket.on('update language', ({ roomId, languageUsed }) => {
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
    socket.on('send_message', ({ message, roomId, username }) => {
        const messageId = uuidv4();
        const chatMessage = {
            message,
            messageId,
            user: username,
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
    socket.on('draw', ({ roomId, data }) => {
        socket.to(roomId).emit('on draw', { data });
    });

    socket.on('clear canvas', ({ roomId }) => {
        socket.to(roomId).emit('clear canvas');
    });

    // ── WebRTC Video Signaling ───────────────────────────────────────────────
    socket.on('join video', ({ roomId }) => {
        const room = io.sockets.adapter.rooms.get(roomId);
        const users = room ? Array.from(room).filter((id) => id !== socket.id) : [];
        socket.emit('all users video', users);
    });

    socket.on('sending signal', (payload) => {
        io.to(payload.userToSignal).emit('user joined video', {
            signal: payload.signal,
            callerID: payload.callerID,
        });
    });

    socket.on('returning signal', (payload) => {
        io.to(payload.callerID).emit('receiving returned signal', {
            signal: payload.signal,
            id: socket.id,
        });
    });

    // ── Terminal ─────────────────────────────────────────────────────────────
    socket.on('terminal:create', ({ roomId }) => {
        if (!TERMINAL_ENABLED) {
            socket.emit('terminal:error', {
                message: 'Terminal is disabled on this server.',
            });
            return;
        }

        // A terminal is a real shell on this host. Only grant one to a socket
        // that has actually joined the room, and key the session on the
        // server's record of the username — never on a client-supplied value.
        if (!roomId || !socket.rooms.has(roomId)) {
            socket.emit('terminal:error', {
                message: 'Join the room before opening a terminal.',
            });
            return;
        }

        const registeredUsername = socketID_to_Users_Map[socket.id]?.username;
        if (!registeredUsername) {
            socket.emit('terminal:error', { message: 'Unknown user.' });
            return;
        }

        const safeUsername = registeredUsername.toString().trim().toLowerCase();
        const sessionKey = `${roomId}:${safeUsername}`;
        const previousSessionKey = socketID_to_TerminalSession_Map[socket.id];
        if (previousSessionKey && previousSessionKey !== sessionKey) {
            detachTerminalSocket(previousSessionKey, socket.id);
        }
        socketID_to_TerminalSession_Map[socket.id] = sessionKey;

        console.log(`[Terminal] Attach/create for session ${sessionKey} (socket ${socket.id})`);

        const existingTerminal = terminalManager.getTerminal(sessionKey);
        let ptyProcess = existingTerminal;
        if (!ptyProcess) {
            ptyProcess = terminalManager.createTerminal(sessionKey);
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

        socket.emit('terminal:ready', { message: 'Terminal ready', reattached: Boolean(existingTerminal) });
    });

    socket.on('terminal:input', ({ data }) => {
        const sessionKey = socketID_to_TerminalSession_Map[socket.id];
        if (sessionKey) {
            terminalManager.writeToTerminal(sessionKey, data);
        }
    });

    socket.on('terminal:resize', ({ cols, rows }) => {
        const sessionKey = socketID_to_TerminalSession_Map[socket.id];
        if (sessionKey) {
            terminalManager.resizeTerminal(sessionKey, cols, rows);
        }
    });

    // ── Disconnect / Cleanup ─────────────────────────────────────────────────
    socket.on('disconnecting', () => {
        const rooms = [...socket.rooms];
        rooms.forEach((roomId) => {
            if (roomId === socket.id) return; // Skip personal room
            socket.in(roomId).emit('member left', {
                username: socketID_to_Users_Map[socket.id]?.username,
            });
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
        delete socketID_to_Users_Map[socket.id];
    });
});

// ─── Start Server ──────────────────────────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`✓ Dobby server running on port ${PORT}`);
    console.log(`  REST API: http://localhost:${PORT}/api`);
    console.log(`  Health:   http://localhost:${PORT}/health`);
});
