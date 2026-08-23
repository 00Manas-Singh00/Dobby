# Dobby — a cloud-based IDE for pair programming

Two people, one URL, one workspace. Dobby puts a collaborative editor, a real
terminal, code execution, a whiteboard, and a video call in a single browser tab,
so a pairing session never requires leaving it.

Editing is conflict-free — both people can type in the same file at the same
time, see each other's cursors, and never lose a character — because the editor
buffer is a CRDT ([Yjs](https://yjs.dev)) rather than a broadcast of the file's
contents.

> **Not production-ready.** Dobby has **no authentication**: anyone with a room
> URL has full access to that room. Run it locally or on a trusted network. Read
> [docs/04-security-model.md](./docs/04-security-model.md) before deploying
> anything anywhere.

---

## What works

| | |
|---|---|
| **Collaborative editor** | Monaco with Yjs CRDT sync, live remote cursors, one document per open file |
| **Code execution** | ~40 languages via the Piston API, with stdin — nothing runs on the Dobby host |
| **Terminal** | A real PTY through `node-pty` + xterm.js. **Off by default** — see below |
| **Whiteboard** | Shared canvas over Socket.IO |
| **Video & audio** | WebRTC peer-to-peer via `simple-peer`; the server only signals |
| **Chat** | With history replayed to a user who joins mid-session |
| **Presence** | Room roster plus in-editor cursor awareness |

Rooms hold **two participants** by design — Dobby is a pairing tool
([ADR-006](./docs/07-adrs.md#adr-006)).

## Known gaps

- No authentication or authorization.
- The file explorer is a **hardcoded mock**; files can be edited but not created,
  renamed, or deleted.
- Chat and whiteboard content live in server memory and do not survive a restart.
  A late joiner sees an empty canvas.
- No tests and no CI.
- Single node only — all room state is in-process.

Full picture and ordering in [docs/06-roadmap.md](./docs/06-roadmap.md).

---

## Getting started

**Prerequisites:** Node.js 18+.

```bash
# Server
cd server
npm install
cp .env.example .env        # then edit it — see the table below
npm run dev                 # http://localhost:5001

# Client, in a second terminal
cd client
npm install
npm run dev                 # http://localhost:5173
```

Open the client, enter a username, create a room, and share the URL with a
second browser (or an incognito window) to pair with yourself.

### Configuration

Server (`server/.env`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5001` | HTTP and Socket.IO port |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated exact origins. **Set this for any real deployment.** |
| `ENABLE_TERMINAL` | `false` | Master switch for PTY sessions |
| `TERMINAL_WORKSPACE_ROOT` | `<tmpdir>/dobby-workspaces` | Per-session shell working directories |

Client (`client/.env`): `VITE_API_BASE_URL` and `VITE_SOCKET_URL`, both
defaulting to `http://localhost:5001`.

### Enabling the terminal

Set `ENABLE_TERMINAL=true`. Understand first what you are turning on: a shell
running as the server user, available to anyone in the room, on a system with no
authentication. Sessions are confined to a scratch directory and run with a
scrubbed environment, but they are **not sandboxed** —
[ADR-005](./docs/07-adrs.md#adr-005) is explicit about the difference. Enable it
on your own machine or on a disposable host, not on anything you care about.

---

## Architecture at a glance

```
Browser                              Node.js server
────────────────────────             ──────────────────────────────
Monaco ──y-monaco── Y.Doc ─┐    ┌──► YSocketIO ──► LevelDB
xterm.js                    ├─Socket.IO─┤
Canvas, chat, roster       ─┘    ├──► terminalManager ──► node-pty
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
    contexts/               socket + workspace layout state
server/
  index.js                  rooms, chat, whiteboard, WebRTC signaling, terminal events
  terminalManager.js        PTY lifecycle
  services/yjsService.js    Yjs transport + persistence
  services/pistonService.js remote execution client
  routes/execution.js       /api/execute, /api/runtimes
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
