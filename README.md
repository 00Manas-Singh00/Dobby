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
> verification, no password reset, no MFA — and there are no tests. Read
> [docs/04-security-model.md](./docs/04-security-model.md) and work through the
> deployment checklist in §10 before putting it anywhere public.

---

## What works

| | |
|---|---|
| **Collaborative editor** | Monaco with Yjs CRDT sync, live remote cursors, one document per open file |
| **Code execution** | ~40 languages via the Piston API, with stdin — nothing runs on the Dobby host |
| **Terminal** | A real PTY through `node-pty` + xterm.js, sandboxed in a per-session container. **Off by default** — see below |
| **Whiteboard** | Shared canvas over Socket.IO |
| **Video & audio** | WebRTC peer-to-peer via `simple-peer`; the server only signals |
| **Chat** | With history replayed to a user who joins mid-session |
| **Presence** | Room roster plus in-editor cursor awareness |
| **Accounts & rooms** | Email/password sign-in; rooms have an owner and are shared by single-use invite link |

Rooms hold **two participants** by design — Dobby is a pairing tool
([ADR-006](./docs/07-adrs.md#adr-006)).

## Known gaps

- The file explorer is a **hardcoded mock**; files can be edited but not created,
  renamed, or deleted.
- Chat and whiteboard content live in server memory and do not survive a restart.
  A late joiner sees an empty canvas.
- Single node only — Socket.IO rooms, chat, and the rate limiters are in-process.
- Identity is minimal: no email verification, password reset, MFA, or audit log.
  Account recovery is a manual database operation.

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
# Server — unit and integration, ~180 tests in a few seconds
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
an in-memory CRDT. `VERBOSE_TESTS=1` restores the server's logging, which is
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
| `DATABASE_PATH` | `./.data/dobby.db` | SQLite: accounts, rooms, memberships, invites |
| `ENABLE_TERMINAL` | `false` | Master switch for PTY sessions |
| `TERMINAL_ISOLATION` | `docker` | `docker` (sandboxed) or `host` (unsandboxed, dev only) |
| `TERMINAL_WORKSPACE_ROOT` | `<tmpdir>/dobby-workspaces` | Per-session shell working directories |

The full list, with commentary, is in
[`server/.env.example`](./server/.env.example).

`server/.data/` holds every account and room, and there is no password reset —
back it up.

Client (`client/.env`): `VITE_API_BASE_URL` and `VITE_SOCKET_URL`, both
defaulting to `http://localhost:5001`.

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
                                 ├──► /api/auth, /api/rooms ──► SQLite
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
server/
  index.js                  rooms, chat, whiteboard, WebRTC signaling, terminal events
  db.js                     SQLite schema: users, rooms, memberships, invites
  middleware/               auth, payload schemas, rate limits
  terminalManager.js        PTY lifecycle, container sandboxing
  services/authService.js   accounts, password hashing, token issue/rotate
  services/roomService.js   ownership, membership, invites
  services/yjsService.js    Yjs transport, persistence, document authorization
  services/retentionService.js  scheduled expiry of rooms, documents, tokens
  services/pistonService.js remote execution client
  routes/                   /api/auth, /api/rooms, /api/execute
  tests/unit/               services, schemas, limits — externals stubbed
  tests/integration/        a real server driven over real sockets
client/e2e/                 Playwright: two browsers, one file, converging
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

Start with 01 and 02. If you are reviewing the engineering rather than using the
product, 03 and 07 are where the reasoning lives.
