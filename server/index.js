require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

// Internal services & routes
const terminalManager = require('./terminalManager');
const executionRouter = require('./routes/execution');
const aiRouter = require('./routes/ai');
const { setupYjs } = require('./services/yjsService');

const app = express();

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '500kb' }));

// ─── REST API Routes ───────────────────────────────────────────────────────────
app.use('/api', executionRouter);
app.use('/api', aiRouter);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ─── HTTP + Socket.IO Server ───────────────────────────────────────────────────
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});

// Setup Yjs service
setupYjs(io);

const PORT = process.env.PORT || 5001;

// ─── In-Memory Room State ──────────────────────────────────────────────────────
// Owns: username mapping, language state per room
// Code content is owned by Yjs documents (yjsService)
const socketID_to_Users_Map = {};
const roomID_to_State_Map = {}; // { languageUsed: string }

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

// ─── Socket.IO Event Handlers ──────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    // ── Room Management ──────────────────────────────────────────────────────
    socket.on('join room', async ({ roomId, username }) => {
        console.log(`[Room] ${username} attempting to join ${roomId}`);

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

        console.log(`[Room] ${username} joined ${roomId} (${currentSize + 1}/2)`);
    });

    // ── Language Sync (still socket-based; Yjs owns code content) ───────────
    socket.on('update language', ({ roomId, languageUsed }) => {
        if (!roomID_to_State_Map[roomId]) {
            roomID_to_State_Map[roomId] = {};
        }
        roomID_to_State_Map[roomId].languageUsed = languageUsed;
        socket.to(roomId).emit('on language change', { languageUsed });
    });

    // ── Code Sync (socket-based until Phase 3 Yjs migration) ────────────────
    socket.on('update code', ({ roomId, code }) => {
        if (!roomID_to_State_Map[roomId]) {
            roomID_to_State_Map[roomId] = {};
        }
        roomID_to_State_Map[roomId].code = code;
        socket.to(roomId).emit('on code change', { code });
    });

    socket.on('syncing the code', ({ roomId }) => {
        if (roomID_to_State_Map[roomId]?.code !== undefined) {
            socket.emit('on code change', { code: roomID_to_State_Map[roomId].code });
        }
    });

    // ── Chat ─────────────────────────────────────────────────────────────────
    socket.on('send_message', ({ message, roomId, username }) => {
        const messageId = uuidv4();
        io.in(roomId).emit('receive_message', {
            message,
            messageId,
            user: username,
            timestamp: new Date().toISOString(),
        });
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
        console.log(`[Terminal] Creating for socket ${socket.id} in room ${roomId}`);

        const ptyProcess = terminalManager.createTerminal(socket.id);

        ptyProcess.onData((data) => {
            socket.emit('terminal:output', { data });
        });

        ptyProcess.onExit(({ exitCode, signal }) => {
            console.log(`[Terminal] ${socket.id} exited with code ${exitCode}`);
            socket.emit('terminal:exit', { exitCode, signal });
            terminalManager.destroyTerminal(socket.id);
        });

        socket.emit('terminal:ready', { message: 'Terminal ready' });
    });

    socket.on('terminal:input', ({ data }) => {
        terminalManager.writeToTerminal(socket.id, data);
    });

    socket.on('terminal:resize', ({ cols, rows }) => {
        terminalManager.resizeTerminal(socket.id, cols, rows);
    });

    // ── Disconnect / Cleanup ─────────────────────────────────────────────────
    socket.on('disconnecting', () => {
        const rooms = [...socket.rooms];
        rooms.forEach((roomId) => {
            if (roomId === socket.id) return; // Skip personal room
            socket.in(roomId).emit('member left', {
                username: socketID_to_Users_Map[socket.id]?.username,
            });
        });
    });

    socket.on('disconnect', () => {
        console.log(`[Socket] Disconnected: ${socket.id}`);
        terminalManager.destroyTerminal(socket.id);
        delete socketID_to_Users_Map[socket.id];
    });
});

// ─── Start Server ──────────────────────────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`✓ Dobby server running on port ${PORT}`);
    console.log(`  REST API: http://localhost:${PORT}/api`);
    console.log(`  Health:   http://localhost:${PORT}/health`);
});
