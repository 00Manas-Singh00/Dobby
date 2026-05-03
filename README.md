# Dobby - Cloud Based IDE for Pair Programming

A real-time collaborative coding environment built with React and Socket.IO, enabling multiple users to code together with integrated video conferencing, whiteboarding, and terminal access.

## Project Overview

Dobby is a comprehensive collaborative coding platform that enables multiple users to work together simultaneously on code, video calls, whiteboarding, and chat. It's designed for pair programming workflows with full terminal access and peer-to-peer video streaming.

---

## Frontend Architecture (Client)

### Technology Stack

- **React 19.2** - Functional components with hooks
- **Vite** - Modern build tool and dev server (ES modules)
- **React Router 7.13** - SPA routing with two main routes:
  - `/` (Home page - join/create rooms)
  - `/room/:roomId` (Collaborative workspace)
- **Tailwind CSS 4** - Utility-first CSS with custom HSL color variables
- **Socket.IO Client 4.8.3** - Real-time bidirectional communication

### UI Component Libraries

- **Radix UI** - Headless, accessible components (Avatar, Dialog, Label, Popover, Select, Tabs, Scroll Area)
- **Lucide React** - 560+ icon library
- **shadcn/ui** - Custom-built components (Button, Card, Input, Select, Tabs, Textarea)
- **React Resizable Panels 4.4.2** - Draggable, resizable panel layouts
- **next-themes** - Dark/light mode support

### Key Dependencies

- **@monaco-editor/react 4.7** - VSCode-like code editor with syntax highlighting (JavaScript, Python, Java, C++, HTML, CSS, TypeScript, JSON)
- **simple-peer 9.11.1** - WebRTC P2P video streaming library
- **@xterm/xterm 6.0** - Terminal emulator
- **react-hot-toast** - Toast notifications
- **sonner 2.0** - Modern toast library
- **uuid 13** - Unique room ID generation
- **class-variance-authority** - Type-safe CSS class management
- **clsx** - Conditional className utilities

### Project Structure

### State Management

- **React Context API** (no Redux):
  - `SocketContext` - Provides socket instance to entire app
  - `WorkspaceContext` - Manages editor files, terminal height, sidebar width, video position (all persisted to localStorage)

### Real-time Communication Flow

**Socket Events (Client → Server):**
- `join room` - Enter collaborative space
- `update code` - Broadcast code changes
- `update language` - Broadcast language changes
- `syncing the code` - Request latest code state
- `send_message` - Chat message
- `draw` - Whiteboard drawing event
- `clear canvas` - Whiteboard clear
- `join video` - Initialize video stream
- `sending signal` - WebRTC offer/answer
- `returning signal` - WebRTC answer
- `terminal:*` - Terminal I/O events

---

## Backend Architecture (Server)

### Technology Stack

- **Node.js** with CommonJS modules
- **Express 5.2.1** - HTTP server framework with CORS
- **Socket.IO 4.8.3** - Real-time WebSocket communication
- **node-pty 1.2.0-beta.8** - Pseudo-terminal creation and management
- **UUID 13** - Unique ID generation
- **Nodemon 3.1** - Dev auto-restart tool

### Core Features

#### 1. Room Management

- In-memory maps for state:
  - `socketID_to_Users_Map` - Map socket IDs to usernames
  - `roomID_to_Code_Map` - Store code state per room
- **Room capacity**: Maximum 2 users per room (validated on join)
- User list broadcasting on state changes

#### 2. Code Synchronization

- Stores current code and language per room
- When new user joins, latest code/language is emitted to them
- Real-time code diffs propagated to other users
- Sync status indicators shown in UI

#### 3. Terminal Management

Via `terminalManager.js`:

- **PTY (Pseudo-Terminal) Spawning** using `node-pty`:
  - Spawns shell process (/bin/bash on macOS/Linux, powershell.exe on Windows)
  - Runs in user's home directory with inherited environment
  - Default size: 80×30 columns/rows
- **Terminal Operations:**
  - `createTerminal()` - Spawn new PTY per socket
  - `writeToTerminal()` - Send input to PTY
  - `resizeTerminal()` - Handle window resize events
  - `destroyTerminal()` - Clean up on disconnect
- **Lifecycle Management:**
  - Terminal output streamed to client via `terminal:output`
  - Exit signals (`terminal:exit`) on process termination
  - Graceful cleanup on SIGINT/process exit

#### 4. Video Streaming (WebRTC)

- Socket acts as signaling server for peer connections
- Manages SDP offers/answers between peers
- simple-peer library handles ICE candidates and media streams

#### 5. Whiteboard

- Canvas drawing events relayed to other users
- Clear canvas broadcast

#### 6. Chat

- Messages with metadata (timestamp, username, UUID)
- Broadcast to entire room

### Socket.IO Architecture
io.on('connection')
├── join room # Capacity check (2 max), emit to room
├── update code # Real-time sync
├── send_message # Chat
├── drawing events # Whiteboard
├── video events # WebRTC signaling
├── terminal:* # PTY I/O
└── disconnect/cleanup # Cleanup


---

## Data Flow Example: Code Collaboration

1. **User A** types code → `handleCodeChange()` → `socket.emit("update code", {roomId, code})`
2. **Server** receives → stores in `roomID_to_Code_Map[roomId].code`
3. **Server** broadcasts → `socket.to(roomId).emit("on code change", {code})`
4. **User B** receives → `socket.on("on code change")` → `setCode(code)` → Monaco editor re-renders
5. **New User C joins** → Server emits stored code → User C syncs instantly

---

## UI/UX Features

- **Responsive Layout** - Resizable panels with draggable dividers
- **Tab System** - Multiple files open simultaneously in editor
- **Floating Video Player** - PiP video overlay while using other tools
- **Status Indicators** - Sync confirmation badges, user presence, room status
- **Local Storage Persistence** - Panel widths, terminal height, video position remembered
- **Toast Notifications** - User join/leave, copy confirmations, errors (Sonner)
- **Dark Theme** - Slate color palette with gradient accents
- **Recent Rooms** - Quick access to previously visited collaborative spaces

---

## Technical Highlights

1. **P2P Video** - Uses WebRTC via simple-peer; socket only for signaling
2. **Terminal Integration** - Full shell access via PTY—users can run commands directly
3. **Scalability Limitations** - In-memory state means lost on server restart; max 2 users enforced
4. **Real-time Sync** - Sub-100ms latency via Socket.IO (WebSocket with fallbacks)
5. **Build Optimization** - Vite provides instant HMR during dev, tree-shaking in production
6. **Accessibility** - Built on Radix UI (ARIA-compliant components)

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
