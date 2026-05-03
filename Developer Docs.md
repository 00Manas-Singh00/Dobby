# Developer Documentation: Dobby

Welcome to the technical documentation for **Dobby**, a real-time collaborative coding platform. This document provides an in-depth look at how the project was built, the technical decisions made, and the overall architecture.

---

## 🚀 The Development Journey

Building Dobby was an exercise in integrating complex real-time technologies into a seamless, performant user experience. The development followed a modular, iterative approach.

### Phase 1: Foundation & Real-time Core
The project started with setting up a robust MERN-inspired stack but centered around **Vite** for the frontend to ensure a modern, fast development cycle. The initial focus was establish a reliable **Socket.IO** connection between the client and a terminal-aware Node.js server.

### Phase 2: Collaborative Editing
The heart of the app is the **Monaco Editor**. We implemented a synchronization layer where every keystroke is broadcasted via Socket.IO. 
- **Efficiency**: Instead of sending the whole file on every change, we focus on optimized state updates.
- **Persistence**: New joiners instantly receive the current "source of truth" from the server's in-memory room state.

### Phase 3: P2P Communication & Interactive Tools
To make it a true "pair programming" tool, we integrated **WebRTC** using `simple-peer`. 
- **Video/Audio**: Peer-to-peer streaming ensures low latency and reduces server load, with the Socket.IO server acting only as a signaling mediator.
- **Whiteboard**: Built on the HTML5 Canvas API, allowing users to brainstorm visually with real-time stroke synchronization.

### Phase 4: The Integrated Terminal
The most technically challenging part was the terminal. We used **node-pty** on the server to spawn real shell processes and **xterm.js** on the frontend to render them. This gives users a "real" environment where they can run compilers, scripts, and shell commands directly from the browser.

---

## 🛠 Technical Deep Dive

### High-Level Architecture
Dobby follows a **Client-Server-Service** model:
- **Client (React 19)**: Handles the UI, local state, and WebRTC media streams.
- **Server (Node.js/Express)**: Manages room state, Socket.IO signaling, and PTY lifecycles.
- **PTY (Pseudo-Terminal)**: Background processes running on the server, piped to the frontend.

### Frontend: State & Context
We opted for high-performance React Contexts rather than heavy state management libraries like Redux:
- **`SocketContext`**: A singleton provider that manages the lifecycle of the WebSocket connection and centralizes event listeners.
- **`WorkspaceContext`**: Manages the multi-tab editor state, panel layouts (via `react-resizable-panels`), and persists user preferences to `localStorage`.

### Backend: Room & Terminal Management
The server maintains a lightweight in-memory state:
```javascript
// Example Server State Structure
const socketID_to_Users_Map = {}; // Tracks active users
const roomID_to_Code_Map = {};    // Stores latest code per room
```
**Terminal Lifecycle**: When a user connects to a room, the `TerminalManager` spawns a PTY process. The output is streamed via `terminal:output` events, and user input is sent back via `terminal:input`.

### Communication Flow (WebRTC Signaling)
1. **Initiation**: User A joins and notifies the room.
2. **Offer**: User B (already in) creates a WebRTC offer and sends it via Socket.IO.
3. **Signal**: Socket.IO relays the offer to User A.
4. **Answer**: User A accepts and sends a WebRTC answer back through the same channel.
5. **P2P**: Once the handshake is complete, video/audio data flows directly between users.

---

## 🧩 Challenges & Solutions

- **OS Specificity**: `node-pty` behaves differently on Windows vs. Unix. We implemented a dynamic shell picker that detects the host environment and spawns the appropriate shell (`bash`, `zsh`, or `powershell`).
- **Layout Persistence**: Using `react-resizable-panels`, we faced issues with panels resetting on reload. Solution: Custom hooks that sync panel dimensions with `localStorage` on every resize event.
- **Concurrency**: Handling multiple users in a single PTY session required careful input sanitization and output buffering to ensure every user sees the same state.

---

## 🗺 Future Roadmap

1. **Persistent Storage**: Transitioning from in-memory maps to a MongoDB/PostgreSQL backend for long-lived rooms.
2. **File System API**: Enabling users to create, delete, and rename files within the workspace sidebar.
3. **Multi-User Scalability**: Expanding the WebRTC mesh to support more than 2 users per room via an SFU (Selective Forwarding Unit) if needed.
4. **Auth Integration**: Adding user profiles and saved projects.

---

*Documented by the Dobby Development Team.*
