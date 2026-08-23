# 02 — Architecture

**Project:** Dobby
**Companion docs:** [Real-time sync](./03-realtime-sync.md) · [Security](./04-security-model.md) · [API & protocol](./05-api-and-protocol.md)

---

## 1. Shape of the system

Dobby is a **single-node client-server application** with one significant twist:
code content does not flow through the application's own message handlers. It is
owned end to end by Yjs, which rides on the same Socket.IO connection as
everything else.

```
                    ┌────────────────────────────────────────────┐
                    │                  Browser                    │
                    │                                             │
                    │  Monaco ◄─ y-monaco ─► Y.Doc  (per file)    │
                    │  xterm.js                │                  │
                    │  Canvas (whiteboard)     │                  │
                    │  <video> ◄── simple-peer/WebRTC ─── peer    │
                    │                          │                  │
                    └──────────┬───────────────┼──────────────────┘
                               │               │
                  Socket.IO events        y-socket.io
                  (rooms, chat, draw,     (CRDT updates
                   WebRTC signals,         + awareness)
                   terminal I/O)                │
                               │               │
                    ┌──────────▼───────────────▼──────────────────┐
                    │        Node.js  (Express 5 + Socket.IO)      │
                    │                                              │
                    │  index.js         — room/chat/draw/signal    │
                    │  terminalManager  — node-pty sessions        │
                    │  yjsService       — YSocketIO                │
                    │  routes/execution — Piston proxy             │
                    └──────┬──────────────────────┬────────────────┘
                           │                      │
                  ┌────────▼────────┐   ┌─────────▼──────────┐
                  │  LevelDB        │   │  Piston API        │
                  │ .yjs-persistence│   │ (emkc.org, remote) │
                  │  — doc state    │   │  — sandboxed runs  │
                  └─────────────────┘   └────────────────────┘
```

Everything except the Yjs document state and the Piston call is **in-process
memory** and is lost on restart.

## 2. Two sync mechanisms, deliberately

This is the single most important thing to understand about the codebase.

**Yjs owns code content.** The editor buffer is a `Y.Text` inside a `Y.Doc`,
synced by `y-socket.io` and bound to Monaco by `y-monaco`. The application code
never sees a keystroke, never stores a document, and never resolves a conflict.
Cursor presence rides Yjs's awareness protocol.

**Socket.IO owns everything else.** Room membership, chat messages, whiteboard
strokes, WebRTC signaling, language selection, and terminal I/O are ordinary
Socket.IO events handled in [`server/index.js`](../server/index.js).

An earlier iteration synced code over Socket.IO too, with a
`update code` → `on code change` broadcast and a last-write-wins
`roomID_to_Code_Map`. That path lost characters and made cursors jump under
concurrent typing; it has been removed. If you see references to it in old
commits or comments, they are stale.

## 3. Server components

### 3.1 `index.js` — connection and room lifecycle
Owns four in-memory maps: username by socket, per-room language state, per-room
chat history, and terminal session bindings. Enforces the two-user room cap.
Schedules TTL cleanup for room state (30 min after empty) and idle terminals
(15 min after the last viewer detaches).

### 3.2 `services/yjsService.js` — CRDT transport
A thin wrapper that attaches `YSocketIO` to the existing Socket.IO server with
LevelDB persistence at `./.yjs-persistence` and garbage collection enabled. It
is ~15 lines because Yjs does the work; see [03](./03-realtime-sync.md).

### 3.3 `terminalManager.js` — PTY sessions
A singleton keyed by `roomId:username`. Spawns a shell into a per-session
scratch directory with a scrubbed environment, and is disabled unless
`ENABLE_TERMINAL=true`. Sessions outlive a socket disconnect so a page refresh
reattaches rather than restarts. See [04](./04-security-model.md) for the
constraints and why they exist.

### 3.4 `services/pistonService.js` + `routes/execution.js` — execution
Proxies `POST /api/execute` to the public Piston API, caching the runtime list
after first fetch. Code never executes on the Dobby host. Compile and run
timeouts are 10s each; request bodies are capped at 100k characters.

## 4. Client components

`WorkspaceShell` is the room. It joins the Socket.IO room, tracks the roster,
and renders a sidebar plus one of four modules — editor, video, whiteboard,
chat — into `WorkspaceContainer`. All four stay mounted; the container toggles
visibility, so a video call keeps running while you're on the whiteboard, and
the whiteboard canvas isn't destroyed when you switch to chat.

`WorkspaceContext` holds layout state and the open-file list, persisting panel
dimensions and the active module to `localStorage`.

`EditorWorkspace` mounts **one `CodeEditor` per open file**, showing only the
active one. Each of those instances runs its own `useYjsEditor`, which means one
`Y.Doc` and one provider per open tab.

## 5. Identity

There isn't any. A "user" is a username string typed on the home page, carried
in router state, mirrored into `sessionStorage` so a refresh doesn't lose it,
and recorded server-side against the socket id on `join room`. It is not
verified, not unique, and not durable. Every authorization decision that would
normally consult identity currently consults room membership instead.

## 6. Deployment

The client is a static Vite build. The server is a single Node process that must
have a writable directory for `.yjs-persistence`, and — if the terminal is
enabled — for the terminal workspace root.

**The server cannot currently be run with more than one replica.** Room
membership, chat, whiteboard relay, terminal sessions, and Socket.IO rooms are
all in-process. Two replicas behind a load balancer would place paired users in
different rooms. Fixing this needs a Socket.IO Redis adapter and a shared store;
see [06 Roadmap](./06-roadmap.md).

## 7. Technology choices

| Layer | Choice | Why |
|---|---|---|
| Editor | Monaco | The VS Code editor; familiar to the target user, has a mature Yjs binding |
| Collaboration | Yjs + y-socket.io + y-monaco | Production-grade CRDT; see [ADR-001](./07-adrs.md#adr-001) |
| Doc persistence | LevelDB via `y-leveldb` | Embedded, zero-ops, and the natively supported Yjs backend |
| Transport | Socket.IO | One connection carries Yjs, signaling, and app events; automatic reconnect |
| Server | Express 5 | Small REST surface; the real work is on the socket |
| Terminal | node-pty + xterm.js | A real PTY is the only way `vim`, colors, and interactive prompts work |
| Video | simple-peer (WebRTC) | P2P keeps media off the server; fine for a 2-person mesh |
| Execution | Piston (remote) | Sandboxing is somebody else's problem; see [ADR-004](./07-adrs.md#adr-004) |
| UI | React 19, Tailwind 4, Radix | Standard; Radix supplies accessible primitives |
