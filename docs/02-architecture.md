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
                    │  middleware/auth  — JWT on REST + handshake  │
                    │  authService      — accounts, tokens         │
                    │  roomService      — ownership, invites       │
                    │  terminalManager  — node-pty in a container  │
                    │  yjsService       — YSocketIO + doc auth     │
                    │  retentionService — scheduled expiry         │
                    │  routes/execution — Piston proxy             │
                    └───┬──────────┬──────────┬──────────┬─────────┘
                        │          │          │          │
              ┌─────────▼──┐ ┌─────▼──────┐ ┌─▼────────┐ ┌▼──────────────┐
              │ SQLite     │ │ LevelDB    │ │ Docker   │ │ Piston API    │
              │ .data/     │ │.yjs-persis-│ │ per-     │ │ (emkc.org,    │
              │ — users    │ │ tence      │ │ session  │ │  remote)      │
              │ — rooms    │ │ — doc      │ │ shells   │ │ — sandboxed   │
              │ — invites  │ │   state    │ │          │ │   runs        │
              └────────────┘ └────────────┘ └──────────┘ └───────────────┘
```

Everything except the two on-disk stores and the Piston call is **in-process
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
Authenticates every socket in the handshake, then registers each event through
one `on()` helper that applies the rate limiter, the payload schema, and the
room membership check. Registering handlers this way is what keeps any one of
the three from being forgotten on a new event.

Owns three in-memory maps: per-room language state, per-room chat history, and
terminal session bindings. The identity map is gone — the verified user lives on
`socket.data`. Enforces the two-user cap on *live connections*, so a member
opening a second tab does not lock their partner out. Schedules TTL cleanup for
room state (30 min after empty) and idle terminals (15 min after the last viewer
detaches).

### 3.1b `db.js`, `authService`, `roomService` — identity and ownership
SQLite via `better-sqlite3`, chosen for the same reasons as LevelDB: embedded,
zero-ops, one file on disk. Holds users, rooms, memberships, invites, and hashed
refresh tokens. `isMember(roomId, userId)` is the single predicate every
capability in the product is gated on.

### 3.2 `services/yjsService.js` — CRDT transport, document authorization, retention
Attaches `YSocketIO` to the existing Socket.IO server with LevelDB persistence
and garbage collection enabled. Yjs itself needs almost no code.

The module is larger than that because it owns two things nothing else can.
First, **authorization for document namespaces**: Yjs rides its own dynamic
namespaces (`/yjs|<roomId>:<fileId>`) which do *not* pass through the main
Socket.IO connection middleware, so a separate check is registered on the parent
namespace — Socket.IO copies parent middleware onto each child as it is created,
which is what makes this work for documents that do not exist yet. The room is
read from the namespace the client actually connected to, never from the
handshake payload. Second, the **delete path** for document state, since this is
the one thing Dobby persists to disk.

### 3.2b `services/retentionService.js` — scheduled expiry
One hourly pass: rooms idle past `ROOM_RETENTION_MS` are deleted with their
documents, orphaned documents are collected, and expired invites and spent
refresh tokens are pruned. Documents are always deleted before the room row, so
a crash mid-sweep leaves a retry rather than an orphan.

### 3.3 `terminalManager.js` — PTY sessions
A singleton keyed by `roomId:userId`, disabled unless `ENABLE_TERMINAL=true`.
By default the PTY is a `docker run` process rather than a shell — node-pty still
owns a real TTY, so `vim`, colors, and interactive prompts work, but the shell
itself is inside a container with CPU, memory, pid, and network limits. If Docker
is unreachable it fails closed rather than falling back to a host shell. Sessions
outlive a socket disconnect so a page refresh reattaches rather than restarts.
See [04](./04-security-model.md) for the full set of constraints and why they
exist.

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

`AuthContext` holds the signed-in account and wraps `SocketProvider`, because
the handshake carries the access token — the session has to exist before a
connection is opened. Token storage and refresh live in `apiClient` rather than
the context, so every caller sends credentials without having to remember to;
concurrent 401s share one in-flight refresh so they don't rotate each other's
tokens.

`WorkspaceContext` holds layout state and the open-file list, persisting panel
dimensions and the active module to `localStorage`.

`EditorWorkspace` mounts **one `CodeEditor` per open file**, showing only the
active one. Each of those instances runs its own `useYjsEditor`, which means one
`Y.Doc` and one provider per open tab.

## 5. Identity

A user is an account: unique email, bcrypt-hashed password, durable id. The
server issues a short-lived JWT access token and a rotating refresh token, and
verifies the access token on every REST call and every socket handshake —
including the Yjs namespaces, which are a separate transport and needed their own
gate.

Every username the UI shows for the local user comes from the account, and every
server-side authorization decision consults `isMember(roomId, userId)`. The
client cannot supply an identity anywhere: chat authorship, terminal session
keys, and WebRTC signal routing are all derived from the socket's verified user.

This replaces the previous model, in which a "user" was a username string typed
on the home page and carried in router state — unverified, non-unique, and not
durable.

## 6. Deployment

The client is a static Vite build. The server is a single Node process that must
have `JWT_SECRET` set (it refuses to start otherwise), a writable directory for
`.data` and `.yjs-persistence`, a reachable Docker daemon if the terminal is
enabled, and a writable terminal workspace root.

`server/.data/` holds every account and room. There is no password reset, so
losing it is unrecoverable — back it up.

**The server cannot currently be run with more than one replica.** Socket.IO
rooms, chat, whiteboard relay, terminal sessions, and the rate limiters are all
in-process. Two replicas behind a load balancer would place paired users in
different rooms and give each replica its own copy of every quota. Accounts and
room ownership are the exception — those are in SQLite and would survive the
move, though SQLite itself would need replacing. Fixing this needs a Socket.IO
Redis adapter and a shared store; see [06 Roadmap](./06-roadmap.md).

## 7. Tests

Three layers, in `server/tests/` and `client/e2e/`, run by CI on every push.

**Unit tests** (Vitest, `server/tests/unit/`) cover the services with real
logic: token issue/rotate/revoke, invite redemption, the sandbox arguments the
terminal passes to `docker run`, Piston runtime resolution, the payload
schemas, the socket token bucket, and the retention sweep. `node-pty`,
`child_process`, and `fetch` are stubbed — these assert on what the code
decides, not on whether Docker or emkc.org is reachable.

**Integration tests** (`server/tests/integration/`) start a real server on an
ephemeral port and drive it with real Socket.IO clients and supertest. They go
through the socket rather than calling handlers directly on purpose: the
handshake check, the rate limiter, the schema, and the membership guard all
live in the `on()` wrapper described in §3.1, so a test that called the handler
would see none of them. Several assert an *absence* — that a message never
reaches a socket that should not have it — which is the only way to test a
relay boundary.

**End-to-end** (`client/e2e/`, Playwright) opens two browser contexts on one
room and asserts they converge. Accounts, rooms, and invites are created over
the REST API and the session is seeded into `localStorage`, so an unrelated
change to the sign-in form cannot fail the convergence test. Playwright starts
both halves of the stack itself, serving a production build rather than the dev
server — Vite compiles Monaco on first request in dev, which cost about 45
seconds per page open.

Two constraints this placed on the source:

- **`index.js` exports `createDobbyServer()`** and only calls `listen` when run
  directly. It previously bound a port and started the retention sweep at
  import, so nothing in it could be loaded by a test at all. The per-room state
  maps moved inside the factory, so two servers in one process cannot see each
  other's rooms.
- **`YJS_PERSISTENCE_DIR=''` runs the CRDT in memory.** LevelDB takes an
  exclusive lock on its directory, so tests could not otherwise share a
  workspace or run alongside a dev server.

## 8. Technology choices

| Layer | Choice | Why |
|---|---|---|
| Editor | Monaco | The VS Code editor; familiar to the target user, has a mature Yjs binding |
| Collaboration | Yjs + y-socket.io + y-monaco | Production-grade CRDT; see [ADR-001](./07-adrs.md#adr-001) |
| Doc persistence | LevelDB via `y-leveldb` | Embedded, zero-ops, and the natively supported Yjs backend |
| Identity store | SQLite via `better-sqlite3` | Embedded and zero-ops like LevelDB; synchronous API needs no pooling |
| Auth | bcrypt + JWT | No third-party dependency; tokens verify statelessly, refresh tokens stay revocable |
| Validation | zod | One schema per event, shared by the REST and socket paths |
| Transport | Socket.IO | One connection carries Yjs, signaling, and app events; automatic reconnect |
| Server | Express 5 | Small REST surface; the real work is on the socket |
| Terminal | node-pty + xterm.js + Docker | A real PTY is the only way `vim`, colors, and interactive prompts work; the container is what makes it safe to offer |
| Video | simple-peer (WebRTC) | P2P keeps media off the server; fine for a 2-person mesh |
| Execution | Piston (remote) | Sandboxing is somebody else's problem; see [ADR-004](./07-adrs.md#adr-004) |
| UI | React 19, Tailwind 4, Radix | Standard; Radix supplies accessible primitives |
| Tests | Vitest + supertest | Same ESM and config story as the app; no transpile step |
| End-to-end | Playwright | Two independent browser contexts is the requirement, and it starts the stack itself |
