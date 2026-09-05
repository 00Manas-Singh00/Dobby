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
                  (rooms, chat, files,    (code + whiteboard
                   WebRTC signals,         CRDT updates,
                   terminal I/O)           + awareness)
                               │               │
                    ┌──────────▼───────────────▼──────────────────┐
                    │        Node.js  (Express 5 + Socket.IO)      │
                    │                                              │
                    │  index.js         — room/language/signal    │
                    │  middleware/auth  — JWT on REST + handshake  │
                    │  authService      — accounts, tokens         │
                    │  roomService      — ownership, invites       │
                    │  fileService      — the room's file tree     │
                    │  chatService      — persisted transcript     │
                    │  snapshotService  — document history         │
                    │  terminalManager  — node-pty in a container  │
                    │  yjsService       — YSocketIO + doc auth     │
                    │  retentionService — scheduled expiry         │
                    │  routes/execution — Piston proxy             │
                    └───┬──────────┬──────────┬──────────┬─────────┘
                        │          │          │          │
              ┌─────────▼──┐ ┌─────▼──────┐ ┌─▼────────┐ ┌▼──────────────┐
              │ SQLite or  │ │ LevelDB    │ │ Docker   │ │ Piston API    │
              │ Postgres   │ │.yjs-persis-│ │ per-     │ │ (emkc.org,    │
              │ — users    │ │ tence      │ │ session  │ │  remote)      │
              │ — rooms    │ │ — file     │ │ shells   │ │ — sandboxed   │
              │ — invites  │ │   content  │ │          │ │   runs        │
              │ — files    │ │ — white-   │ │          │ │               │
              │ — chat     │ │   board    │ │          │ │               │
              │ — snapshots│ │            │ │          │ │               │
              └────────────┘ └────────────┘ └──────────┘ └───────────────┘
```

The division between the two stores is the thing to hold onto: **the relational
store holds structure and identity, the document store holds content.** A file's
name and place in the tree are a row; its bytes are a Yjs document. Nothing is
written relationally on a keystroke, and the CRDT is never a second copy of
something the database also knows.

Which engine sits behind each is a deployment choice, not an architectural one.
The relational store is SQLite by default and Postgres when `DATABASE_URL` is
set ([ADR-017](./07-adrs.md#adr-017)); the document store is LevelDB by default
and Redis when `REDIS_URL` is set ([ADR-015](./07-adrs.md#adr-015)). Nothing
above `db.js` and `yjsService.js` knows the difference.

What remains **in-process memory**, and is lost on restart, is now only the
per-room language selection, the terminal session bindings, and the rate limiter
buckets.

## 2. Two sync mechanisms, deliberately

This is the single most important thing to understand about the codebase.

**Yjs owns everything two people edit at once.** The editor buffer is a `Y.Text`
inside a `Y.Doc`, synced by `y-socket.io` and bound to Monaco by `y-monaco`. The
whiteboard is a `Y.Array` of strokes in a second document per room. In both
cases the application code never sees a keystroke or a stroke, never stores the
content, and never resolves a conflict. Cursor presence rides Yjs's awareness
protocol.

**Socket.IO owns everything else.** Room membership, chat messages, file-tree
notifications, WebRTC signaling, language selection, and terminal I/O are
ordinary Socket.IO events handled in
[`server/index.js`](../server/index.js).

Two earlier iterations put content on the second path and both were removed for
the same reason. Code was once synced with an `update code` → `on code change`
broadcast over a last-write-wins `roomID_to_Code_Map`, which lost characters and
made cursors jump under concurrent typing. Whiteboard strokes were once relayed
as `draw` events and stored nowhere, so a late joiner got a blank canvas. If you
see references to either in old commits or comments, they are stale.

## 3. Server components

### 3.1 `index.js` — connection and room lifecycle
Authenticates every socket in the handshake, then registers each event through
one `on()` helper that applies the rate limiter, the payload schema, and the
room membership check. Registering handlers this way is what keeps any one of
the three from being forgotten on a new event.

Owns two in-memory maps now: per-room language state and terminal session
bindings. The identity map is gone — the verified user lives on `socket.data` —
and chat history moved into the database. Enforces the two-user cap on *live
connections*, so a member opening a second tab does not lock their partner out.
Schedules TTL cleanup for room state (30 min after empty) and idle terminals
(15 min after the last viewer detaches).

It also puts the Socket.IO server on the Express app as `app.set('io', io)`.
That is how `routes/files.js` broadcasts a tree change to the room without
importing a module-level singleton — which matters because the tests construct
two servers in one process, and a shared singleton would have their broadcasts
cross.

### 3.1b `db.js`, `authService`, `roomService` — identity and ownership
One store interface over two engines: SQLite via `better-sqlite3` by default,
Postgres via `pg` when `DATABASE_URL` is set. Holds users, rooms, memberships,
invites, hashed refresh tokens, the file tree, chat history, and document
snapshots. `isMember(roomId, userId)` is the single predicate every capability in
the product is gated on.

`db.js` exposes `get`, `all`, `run`, `tx`, and `count`, and is **async on both
engines** even though better-sqlite3 is synchronous. Two interfaces would mean
every caller had two shapes to get right; one is the price of the choice, and it
is why every service, route handler, and socket guard in this document awaits
its store calls ([ADR-017](./07-adrs.md#adr-017)). The SQL is written in the
intersection of the two dialects — `?` placeholders, ISO-8601 strings, `COALESCE`,
`lower(x)`, an explicit `seq` column — and `db/schema.js` renders one schema for
both.

### 3.1c `services/fileService.js` + `routes/files.js` — the file tree
An adjacency list in `room_files`: each row is a file or a folder with a name
and a parent, and `NULL` parent means the root. Names are validated as a single
path segment — a separator is rejected — so `parent_id` stays the only
expression of hierarchy rather than competing with a name like `../secrets`.
Uniqueness among siblings is a unique index on
`(room_id, COALESCE(parent_id, ''), lower(name))`: both engines treat NULLs as
distinct in a UNIQUE constraint, so a plain one would allow duplicate names at
the root, and `lower()` is what makes the index enforce the case-insensitive rule
the service was already checking.

Deleting a folder collects its subtree here rather than leaving it to the
foreign-key cascade, because the caller needs the list of ids: each one has a
Yjs document and a set of snapshots to drop, and a cascade would delete the rows
silently and orphan both.

### 3.1d `services/chatService.js` — the transcript
`chat_messages`, capped per room. The cap is enforced by deleting rows inside
the same transaction as the insert, so history can never briefly exceed it and a
crash cannot leave the trim undone. The author is taken from the caller's
verified user object rather than a username string, which is how the Phase 1
property that a client cannot post as their partner survives the move to
storage.

### 3.1e `services/snapshotService.js` — document history
A timer encodes each open document into a `document_snapshots` row, skipping any
whose state vector is unchanged since its last snapshot — so an idle room costs
one comparison and no writes.

Restore is the non-obvious half. Yjs updates are additive: applying an old state
to a document that already contains it is a no-op, because the operations are
already there. Restoring therefore has to be a *new* edit — the difference
between what the document says now and what the snapshot said — applied in one
transaction. That keeps it an ordinary concurrent edit, so a partner typing
during a restore does not lose their characters and both sides converge.

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

### 3.2c A note on importing Yjs on the server
`yjsService` and `snapshotService` obtain Yjs with `createRequire(...)('yjs')`
rather than `import * as Y from 'yjs'`. This is deliberate and load-bearing:
y-socket.io and y-leveldb are CommonJS and pull Yjs in through `require`, and an
ESM import of the same package is a *second module instance*. Yjs's constructor
checks are identity-based, so two copies fail each other's `instanceof` — and a
live y-socket.io document handed to an ESM-imported `Y.encodeStateAsUpdate`
would be built by a different library than the one encoding it. Sharing their
instance is the only way the snapshot and restore paths can touch a live
document at all.

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

`WorkspaceContext` holds layout state and the file tree, persisting panel
dimensions, the active module, and the set of open tabs to `localStorage`.

`EditorWorkspace` mounts **one `CodeEditor` per open file**, showing only the
active one. Each of those instances runs its own `useYjsEditor`, which means one
`Y.Doc` and one provider per open tab. Execution state is keyed by file id for
the same reason: a single shared result panel showed you one file's output under
another file's name.

`WorkspaceContext` also owns the file tree. Open tabs are stored as **ids, not
file objects** — the tree is the single record of what a file is called and
where it sits, so a tab carrying its own copy of the name would go stale the
moment the other person renamed it. Tabs are resolved against the tree on every
render, which is also why a file deleted by the other person simply stops being
a tab.

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

`server/.data/` holds every account, room, file tree, transcript, and document
snapshot. There is no password reset, so losing it is unrecoverable — back it
up, together with `.yjs-persistence`, which holds the file *contents* those
trees point at. The two are only useful together.

### 6.1 Running more than one replica

**`REDIS_URL` is the single switch.** Unset, the server behaves exactly as it
did through Phase 3: one process, in-memory room state, documents in LevelDB.
Set, the same code paths reach a shared store instead, and the process joins a
cluster.

It fails **closed**: if `REDIS_URL` is set and Redis is unreachable, the server
refuses to start. A replica that thinks it is alone is the failure this whole
mechanism exists to prevent, and it would present as "my partner's edits
sometimes don't arrive" rather than as an outage.

What changes when it is set:

| Concern | Single node | Clustered |
|---|---|---|
| Socket.IO rooms | in-process adapter | Redis adapter — a room spans replicas |
| Room language state | object + expiry timers | Redis hash with a TTL |
| REST rate limits | in-process counters | shared Redis counters |
| Socket rate limits | per-socket token buckets | **unchanged** — see below |
| Yjs document content | LevelDB directory | Redis ([ADR-015](./07-adrs.md#adr-015)) |
| Which node serves a document | the only one | the one holding its lease ([ADR-014](./07-adrs.md#adr-014)) |
| Terminal sessions | in-process PTYs | **unchanged** — see below |

Two things deliberately did not move.

**Socket rate limits** are keyed per socket, and a socket lives on exactly one
node for its whole life. A per-socket bucket is therefore already
cluster-correct: there is no second process holding a second bucket for the same
connection. Moving it to Redis would add a network round trip to every keystroke
of terminal input to defend a property it already has.

**Terminal sessions** are references to a live PTY and its event subscriptions —
objects, not data — and are reachable only from the process holding the process.
The map is correct exactly where it is. What a cluster needs instead is for a
reconnecting client to land back on the same node, which is what the sticky
rule in `deploy/nginx.conf` provides.

**Yjs needed a real design pass rather than a config change**, and got two ADRs.
The short version: a `Y.Doc` is *state held in one process*, not a message, so
the Redis adapter does not help — two replicas serving one document each keep
their own copy and each persist it. Instead, exactly one node serves a document
at a time. The client appends `?doc=<roomId>:<fileId>` to its Yjs connection so
the balancer can hash on it, and the server takes a Redis lease on the document
before serving it, refusing with `DOCUMENT_MOVED` if another node holds it. The
lease is what makes a routing mistake loud and recoverable instead of silent and
destructive. Content moves to Redis at the same time, because LevelDB's
exclusive directory lock means a document could otherwise never move between
nodes at all.

**Where the replicas can live.** They used to have to share a host: SQLite
([ADR-010](./07-adrs.md#adr-010)) is single-writer, so replicas shared one file
over a volume, which works on one machine and nowhere else. `DATABASE_URL`
replaces that file with Postgres ([ADR-017](./07-adrs.md#adr-017)) and the
constraint goes away. Documents stayed in Redis rather than following identity
([ADR-018](./07-adrs.md#adr-018)) — a Yjs update is an append on the keystroke
path, and that is the operation Redis does in one round trip with no read.

Sticky routing is what remains, and there are two kinds. A *document* is hashed
on `?doc=`, above. A *connection* is hashed on `?client=` — a stable id the
browser keeps — because the long-polling transport spreads one connection over
several requests and a terminal session is a live PTY in one process. `ip_hash`
would do the second job portably and does it wrong behind a CDN, where many
users share an address.

`deploy/nginx.conf` and `deploy/docker-compose.cluster.yml` are a working
reference for all of the above. Measured behaviour is in
[09 Load test](./09-load-test.md).

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

**Cluster tests** (`server/tests/integration/cluster.test.js`) start two real
replicas as *child processes* against a real Redis, and skip entirely when
`REDIS_URL` is unset. Child processes rather than two factory calls, because
`yjsService` holds its `YSocketIO` in a module-level variable and a node id is
derived once per process — in production a process *is* a node, so two servers
in one process would share a document registry and answer to one identity,
making the split-brain the test exists to detect impossible to reproduce. The
file asserts the four things one process gets right for free: a chat message
crossing replicas, the language replaying to a joiner on the other node, the
two-person cap counting cluster-wide, and a document being refused on the node
that does not own it.

**End-to-end** (`client/e2e/`, Playwright) opens two browser contexts on one
room and asserts they converge — for the editor in `convergence.spec.js`, and
for the file tree, the whiteboard, and document history in `workspace.spec.js`.
The second file exists because those three fail in ways only a second browser
sees: a file created in one explorer has to appear in the other's, and the old
whiteboard looked perfect to the person drawing on it.

Accounts, rooms, and invites are created over
the REST API and the session is seeded into `localStorage`, so an unrelated
change to the sign-in form cannot fail the convergence test. Playwright starts
both halves of the stack itself, serving a production build rather than the dev
server — Vite compiles Monaco on first request in dev, which cost about 45
seconds per page open.

One selector rule matters throughout: the helpers target
`.monaco-editor:visible`, not `.first()`. `EditorWorkspace` mounts one editor
per open tab and hides the inactive ones, so `.first()` stopped being the editor
on screen the moment a room could hold two open files.

Two constraints this placed on the source:

- **`index.js` exports `createDobbyServer()`** and only calls `listen` when run
  directly. It previously bound a port and started the retention sweep at
  import, so nothing in it could be loaded by a test at all. The per-room state
  maps moved inside the factory, so two servers in one process cannot see each
  other's rooms — and for the same reason the file router reaches Socket.IO
  through `app.get('io')` rather than importing it. It became `async` in Phase 4:
  the Redis connection has to be established before the first socket is served,
  and awaiting construction is the simplest way to make the window where it is
  not impossible to exist.
- **`YJS_PERSISTENCE_DIR=''` runs the CRDT in memory.** LevelDB takes an
  exclusive lock on its directory, so tests could not otherwise share a
  workspace or run alongside a dev server.

## 8. Technology choices

| Layer | Choice | Why |
|---|---|---|
| Editor | Monaco | The VS Code editor; familiar to the target user, has a mature Yjs binding |
| Collaboration | Yjs + y-socket.io + y-monaco | Production-grade CRDT; see [ADR-001](./07-adrs.md#adr-001) |
| Doc persistence | LevelDB via `y-leveldb`, or Redis when clustered | Embedded and zero-ops for one node; LevelDB's exclusive lock makes it unusable for several ([ADR-015](./07-adrs.md#adr-015)) |
| Cluster fan-out | `@socket.io/redis-adapter` | Makes a Socket.IO room span replicas; does nothing for Yjs, which is state rather than messages |
| Metrics | `prom-client` | One exporter, no collector to run; gauges sampled on scrape so they cannot drift ([ADR-016](./07-adrs.md#adr-016)) |
| Offline editing | `y-indexeddb` | The document's local replica in the browser; edits made while disconnected survive a closed tab and merge on return |
| Identity store | SQLite via `better-sqlite3`, or Postgres via `pg` when clustered across hosts | Embedded and zero-ops for one host; SQLite's single writer is what makes several hosts impossible ([ADR-017](./07-adrs.md#adr-017)) |
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
