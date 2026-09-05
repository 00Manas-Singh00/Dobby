# Dobby — a cloud-based IDE for pair programming

Two people, one URL, one workspace. Dobby puts a collaborative editor, a real
terminal, code execution, a whiteboard, and a video call in a single browser tab,
so a pairing session never requires leaving it.

Editing is conflict-free — both people can type in the same file at the same
time, see each other's cursors, and never lose a character — because the editor
buffer is a CRDT ([Yjs](https://yjs.dev)) rather than a broadcast of the file's
contents.

> **Read before deploying.** Dobby authenticates every entry point and rooms
> belong to their owner, but the identity system is minimal — no email
> verification, no password reset, no MFA. Read
> [docs/04-security-model.md](./docs/04-security-model.md) and work through the
> deployment checklist in §10 before putting it anywhere public.

---

## What works

| | |
|---|---|
| **Collaborative editor** | Monaco with Yjs CRDT sync, live remote cursors, one document per open file |
| **Code execution** | ~40 languages via the Piston API, with stdin — nothing runs on the Dobby host |
| **Terminal** | A real PTY through `node-pty` + xterm.js, sandboxed in a per-session container. **Off by default** — see below |
| **Files** | A real per-room tree — create, rename, move, delete, folders — with changes appearing live in the other person's explorer |
| **Document history** | Periodic snapshots per file, with preview and one-click restore |
| **Offline editing** | Edits made while disconnected are kept locally and merge when the connection returns |
| **Whiteboard** | Shared canvas backed by a CRDT, so a late joiner sees the whole board |
| **Video & audio** | WebRTC peer-to-peer via `simple-peer`; the server only signals |
| **Chat** | Persisted history, replayed to a user who joins mid-session |
| **Presence** | Room roster plus in-editor cursor awareness |
| **Accounts & rooms** | Email/password sign-in; rooms have an owner and are shared by single-use invite link |

Rooms hold **two participants** by design — Dobby is a pairing tool
([ADR-006](./docs/07-adrs.md#adr-006)).

## Known gaps

- **Two-host performance is unmeasured.** Replicas can now be on separate hosts
  and are tested for correctness there, but the published numbers are all from a
  single machine — see [docs/09 §7](./docs/09-load-test.md#7-what-this-does-not-cover).
- **No migration path from an existing SQLite file into Postgres.** Switching
  engines today means starting with an empty database.
- Terminal sessions are pinned to the node that created them — a PTY is a live
  process, not data — so a cluster needs sticky sessions on the main namespace.
- Identity is minimal: no email verification, password reset, MFA, or audit log.
  Account recovery is a manual database operation.
- Whiteboard strokes use absolute pixel coordinates, so two people at very
  different window sizes see the board positioned differently.
- No file upload or download, and no diff between two snapshots.

Full picture and ordering in [docs/06-roadmap.md](./docs/06-roadmap.md).

---

## Getting started

**Prerequisites:** Node.js 18+. Docker only if you want the terminal.

```bash
# Server
cd server
npm install
cp .env.example .env        # then edit it — see the table below

# JWT_SECRET is required; the server refuses to start without one.
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

npm run dev                 # http://localhost:5001

# Client, in a second terminal
cd client
npm install
npm run dev                 # http://localhost:5173
```

Open the client, create an account, and create a room. To pair with yourself,
use the share button to copy an invite link, then open it in an incognito window
and sign in as a second account. Invite links are single-use and expire after 24
hours.

### Running the tests

```bash
# Server — unit and integration, 327 tests in a few seconds
cd server
npm test

# Client — lint and build
cd client
npm run lint
npm run build

# End-to-end — two browsers editing one file and converging.
# Playwright starts the API and a production build of the client itself.
npx playwright install chromium   # first run only
npm run test:e2e
```

The tests need no configuration: they use a throwaway SQLite file per run and
an in-memory CRDT. Set `DATABASE_URL` and the same suite runs against Postgres
instead, each test process in its own schema — which is what CI does, so every
test runs twice, once per engine. The one exception is the cluster suite, which starts two real
replicas against a real Redis and **skips itself when `REDIS_URL` is unset** —
faking Redis there would defeat the purpose, since the failures it guards
against live in the adapter's wire format. To run it locally:

```bash
redis-server --port 6399 --daemonize yes
REDIS_URL=redis://127.0.0.1:6399 npm test
```

To run everything against Postgres instead — the second half of what CI does:

```bash
createdb dobby_test
DATABASE_URL=postgres://localhost/dobby_test npm test
```

Each test process takes its own schema and they are dropped when the run ends,
so the two engines need no separate configuration and no cleanup.

`VERBOSE_TESTS=1` restores the server's logging, which is
suppressed by default so a full run stays readable. CI runs all three on every
push — see [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) — and what
each layer covers is in
[docs/02-architecture.md §7](./docs/02-architecture.md).

### Configuration

Server (`server/.env`):

| Variable | Default | Purpose |
|---|---|---|
| `JWT_SECRET` | — | **Required**, 32+ characters. The server will not start without it |
| `PORT` | `5001` | HTTP and Socket.IO port |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated exact origins. **Set this for any real deployment.** |
| `DATABASE_URL` | — | Unset: SQLite. Set: Postgres, and `DATABASE_PATH` is ignored. **Fails closed** — an unreachable database stops startup. This is the switch that lets replicas run on different hosts |
| `DATABASE_PATH` | `./.data/dobby.db` | SQLite file: accounts, rooms, memberships, invites, files, chat, snapshots. Ignored when `DATABASE_URL` is set |
| `ENABLE_TERMINAL` | `false` | Master switch for PTY sessions |
| `TERMINAL_ISOLATION` | `docker` | `docker` (sandboxed) or `host` (unsandboxed, dev only) |
| `TERMINAL_WORKSPACE_ROOT` | `<tmpdir>/dobby-workspaces` | Per-session shell working directories |
| `REDIS_URL` | — | Unset: single node. Set: join a cluster. **Fails closed** — an unreachable Redis stops startup rather than producing an isolated replica |
| `METRICS_TOKEN` | — | Bearer token for `/metrics`. Unset means loopback callers only, which is closed to the network rather than open |
| `NODE_ID` | random per start | This process's identity in the cluster. A pod name, a task id |

The full list, with commentary, is in
[`server/.env.example`](./server/.env.example).

On SQLite, `server/.data/` holds every account and room; on Postgres, that is the
database. Either way there is no password reset — back it up.

Client (`client/.env`): `VITE_API_BASE_URL` and `VITE_SOCKET_URL`, both
defaulting to `http://localhost:5001`.

### Running more than one replica

Two switches, one for each half of the problem. **`REDIS_URL`** puts the
*application* on several processes: Socket.IO rooms span replicas through the
Redis adapter, the REST quotas share one set of counters, and Yjs documents move
to Redis. **`DATABASE_URL`** puts those processes on several *hosts*: SQLite is
single-writer, so replicas sharing one file must share a machine, and Postgres
is what removes that ([ADR-017](./docs/07-adrs.md#adr-017)). Unset either one
and that half is the single-node one it always was.

The part that needed a design rather than a config change is Yjs. A `Y.Doc` is
*state held in one process*, not a message, so replicating it by broadcasting
harder does not work — two replicas serving one document each keep their own
copy and the last writer wins whatever the other person typed. Instead, exactly
one node serves a document at a time: the client appends
`?doc=<roomId>:<fileId>` so a load balancer can hash on it, and the server takes
a Redis lease before serving, refusing with `DOCUMENT_MOVED` if another node
holds it. **A routing mistake therefore costs a reconnect, not your partner's
work** — the hashing is what usually works, and the lease is what makes it safe
when it does not. [ADR-014](./docs/07-adrs.md#adr-014) and
[ADR-015](./docs/07-adrs.md#adr-015) have the reasoning; `deploy/nginx.conf` and
`deploy/docker-compose.cluster.yml` are a working configuration.

```bash
docker compose -f deploy/docker-compose.cluster.yml up --build
curl localhost:8080/health
```

Redis is a **database** here, not a cache: it holds document content, so run it
with persistence on and `maxmemory-policy noeviction`. Postgres holds everything
else — accounts, rooms, memberships, invites, the file tree, chat, and snapshots
— so a full backup is both of them. Documents deliberately did *not* follow
identity into Postgres ([ADR-018](./docs/07-adrs.md#adr-018)): a Yjs update is an
append on the keystroke path, and Redis is where that is one operation with no
read.

A Socket.IO connection also has to keep reaching the same replica — the
long-polling transport spreads one connection over several requests, and a
terminal session is a live PTY in one process. The client sends a stable
`?client=<id>` for the balancer to hash on, because `ip_hash` pins every user
behind one address to one replica and unpins them when that address changes.
Like `?doc=`, it is a routing hint and not a credential.

### Observability

`/metrics` exposes Prometheus counters and gauges — active rooms, connected
sockets, live PTYs, Yjs document sizes, execution latency, socket events by
outcome, and document lease conflicts. Gauges are sampled on scrape rather than
incremented by hand, so they cannot drift. `deploy/grafana-dashboard.json` is a
dashboard for them; [docs/08](./docs/08-observability.md) is the catalogue, the
queries, and the alerts worth having.

Measured behaviour is in [docs/09](./docs/09-load-test.md). The short version:
**one node holds 200 concurrent pairs — 400 users, 1,600 edits/s — at a 3.6 ms
median and a 13.8 ms p95, losing no updates.** CPU is the binding constraint and
is linear at roughly 0.8 ms per edit.

### Enabling the terminal

Set `ENABLE_TERMINAL=true` and make sure a Docker daemon is reachable. Each
session then runs `/bin/sh` inside a throwaway container limited to half a CPU,
256MB, 128 processes, and no network, with all capabilities dropped and a
read-only root; only the per-session workspace is writable. If Docker is not
available, terminal creation fails — it does **not** fall back to a host shell.

`TERMINAL_ISOLATION=host` restores the old behaviour: a real shell on the server
host, confined to a scratch directory with a scrubbed environment but **not
sandboxed** ([ADR-005](./docs/07-adrs.md#adr-005) is explicit about the
difference). Use it on your own machine, never on a shared or public host.

---

## Architecture at a glance

```
Browser                              Node.js server
────────────────────────             ──────────────────────────────
Monaco ──y-monaco── Y.Doc ─┐    ┌──► YSocketIO ──► LevelDB
xterm.js                    ├─Socket.IO─┤    (both membership-gated)
Canvas, chat, roster       ─┘    ├──► terminalManager ──► Docker ──► node-pty
                                 ├──► /api/auth, /api/rooms ──► SQLite/Postgres
                                 └──► /api/execute ──► Piston (remote)
<video> ◄──── WebRTC, peer-to-peer ────► <video>
```

The load-bearing detail: **Yjs owns the code buffer end to end.** Application
code never handles a keystroke, stores a document, or resolves a conflict.
Everything else — rooms, chat, whiteboard, WebRTC signaling, terminal I/O — is
ordinary Socket.IO events. [docs/03](./docs/03-realtime-sync.md) explains why,
and where the seams are.

## Project layout

```
client/          React 19 + Vite + Tailwind 4
  src/
    components/workspace/   the room: shell, sidebar, editor, terminal, panels
    hooks/useYjsEditor.js   the only place that touches Yjs
    contexts/               auth + socket + workspace layout state
    services/apiClient.js   token storage, bearer headers, silent refresh
    services/clientId.js    a stable id for the balancer to pin a connection by
server/
  index.js                  rooms, chat, whiteboard, WebRTC signaling, terminal events
  db.js                     one store interface; SQLite or Postgres, by DATABASE_URL
  db/schema.js              the schema, rendered for either engine
  middleware/               auth, payload schemas, rate limits
  terminalManager.js        PTY lifecycle, container sandboxing
  services/authService.js   accounts, password hashing, token issue/rotate
  services/roomService.js   ownership, membership, invites
  services/yjsService.js    Yjs transport, persistence, document authorization
  services/retentionService.js  scheduled expiry of rooms, documents, tokens
  services/pistonService.js remote execution client
  routes/                   /api/auth, /api/rooms, /api/execute
  services/cluster.js       the one place that knows if this is one node or several
  services/documentRouter.js which replica may serve a given Yjs document
  services/yjsRedisPersistence.js shared document storage, for when it is several
  services/roomStateStore.js the room's language, in memory or in Redis
  services/metrics.js       Prometheus counters and sampled gauges
  loadtest/run.js           the load generator behind docs/09
  tests/unit/               services, schemas, limits — externals stubbed
  tests/integration/        a real server driven over real sockets
client/e2e/                 Playwright: two browsers, one file, converging
deploy/                     nginx, compose, Dockerfile, Grafana dashboard
docs/                       the documents below
```

## Documentation

| # | Document | Purpose |
|---|---|---|
| 01 | [Product Overview](./docs/01-product-overview.md) | What Dobby is, who for, honest feature status |
| 02 | [Architecture](./docs/02-architecture.md) | Components, data flow, the two sync mechanisms |
| 03 | [Real-Time Sync](./docs/03-realtime-sync.md) | How collaborative editing works and what isn't CRDT-synced |
| 04 | [Security Model](./docs/04-security-model.md) | Threat model, terminal controls, deployment checklist |
| 05 | [API & Protocol](./docs/05-api-and-protocol.md) | Every REST endpoint and Socket.IO event |
| 06 | [Roadmap](./docs/06-roadmap.md) | What's missing, in priority order |
| 07 | [ADRs](./docs/07-adrs.md) | Decisions and the alternatives rejected |
| 08 | [Observability](./docs/08-observability.md) | Every metric, what it answers, and the queries and alerts worth having |
| 09 | [Load test](./docs/09-load-test.md) | Methodology and measured numbers — what one node actually holds |

Start with 01 and 02. If you are reviewing the engineering rather than using the
product, 03 and 07 are where the reasoning lives, and 09 is where the claims get
checked against measurements.
