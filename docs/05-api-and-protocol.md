# 05 — API & Protocol

**Project:** Dobby
**Scope:** every REST endpoint and Socket.IO event the server handles or emits.

> None of these are authenticated. See [04 Security](./04-security-model.md).

---

## 1. REST API

Base URL from `VITE_API_BASE_URL` (default `http://localhost:5001`). JSON in and
out. CORS is restricted to `ALLOWED_ORIGINS`.

### `GET /health`
Liveness probe. `200 → { status: "ok", time: "<ISO8601>" }`.

### `POST /api/execute`
Runs code on the remote Piston service. Nothing executes on the Dobby host.

```jsonc
// request
{
  "language": "python",     // required — slug or Piston alias
  "code": "print('hi')",    // required — max 100,000 characters
  "stdin": "",              // optional
  "filename": null          // optional; otherwise inferred from the language
}

// 200
{
  "stdout": "hi\n",
  "stderr": "",
  "exitCode": 0,
  "signal": null,
  "compileOutput": null,    // populated for compiled languages
  "time": 412,              // ms, measured server-side around the Piston call
  "language": "python",
  "version": "3.10.0"
}
```

| Status | Meaning |
|---|---|
| 400 | Missing/invalid `language`, missing `code`, code over the size cap, or an unsupported language |
| 502 | Piston unreachable or returned a non-2xx response |

Compile and run timeouts are 10s each, set server-side and not client-tunable.

### `GET /api/runtimes`
The Piston runtime list — `[{ language, version, aliases }]`. Fetched once per
server start and cached in memory thereafter. `502` if the first fetch fails; the
cache is cleared on failure so the next call retries.

---

## 2. Socket.IO protocol

One connection per browser tab carries all of the following **plus** the Yjs
traffic described in [03](./03-realtime-sync.md). Yjs channels are managed by
`y-socket.io` and are not listed here.

### 2.1 Room lifecycle

| Direction | Event | Payload | Notes |
|---|---|---|---|
| C→S | `join room` | `{ roomId, username }` | Rejected if the room already holds 2 sockets |
| S→C | `room full` | `{ message }` | Sent only to the rejected socket |
| S→room | `new member joined` | `{ username }` | To everyone except the joiner |
| S→room | `updating client list` | `{ userslist: string[] }` | To everyone including the joiner |
| S→C | `chat history` | `{ messages: ChatMessage[] }` | Replayed to the joiner only |
| S→C | `on language change` | `{ languageUsed }` | Sent to the joiner if the room has a language set |
| C→S | `leave room` | `{ roomId }` | For navigating away without disconnecting |
| S→room | `member left` | `{ username }` | On `leave room` and on `disconnecting` |

A socket that disconnects without emitting `leave room` is handled by the
`disconnecting` hook, which emits `member left` for each room and schedules
state cleanup. `leave room` additionally detaches any terminal session and
re-broadcasts the roster — a disconnect doesn't need the roster update because
Socket.IO has already removed the socket.

### 2.2 Language

| Direction | Event | Payload |
|---|---|---|
| C→S | `update language` | `{ roomId, languageUsed }` |
| S→room | `on language change` | `{ languageUsed }` |

Stored per room and last-write-wins. Code content is **not** carried here — that
is Yjs's job.

### 2.3 Chat

| Direction | Event | Payload |
|---|---|---|
| C→S | `send_message` | `{ roomId, username, message }` |
| S→room | `receive_message` | `ChatMessage` |

```ts
type ChatMessage = {
  messageId: string;   // uuid v4, assigned server-side
  user: string;
  message: string;
  timestamp: string;   // ISO8601
};
```

`receive_message` goes to the whole room **including the sender** — the sender
renders from the echo rather than optimistically, so both clients display the
server's canonical message id and timestamp. History is capped at the most recent
`CHAT_HISTORY_LIMIT` (default 100) messages and held in memory only.

### 2.4 Whiteboard

| Direction | Event | Payload |
|---|---|---|
| C→S | `draw` | `{ roomId, data }` |
| S→room | `on draw` | `{ data }` |
| C→S | `clear canvas` | `{ roomId }` |
| S→room | `clear canvas` | — |

`data` is an opaque stroke descriptor produced and consumed by
`Whiteboard.jsx`; the server relays it verbatim without inspection. Strokes are
never stored, so a user who joins mid-session sees an empty canvas.

### 2.5 WebRTC signaling

The server is a pure relay here; media never touches it.

| Direction | Event | Payload |
|---|---|---|
| C→S | `join video` | `{ roomId }` |
| S→C | `all users video` | `string[]` — other socket ids in the room |
| C→S | `sending signal` | `{ userToSignal, callerID, signal }` |
| S→C | `user joined video` | `{ signal, callerID }` |
| C→S | `returning signal` | `{ signal, callerID }` |
| S→C | `receiving returned signal` | `{ signal, id }` |

Standard offer/answer: the joiner asks who's present, initiates a peer to each,
and the existing member answers. `simple-peer` handles ICE.

### 2.6 Terminal

Disabled unless `ENABLE_TERMINAL=true`.

| Direction | Event | Payload | Notes |
|---|---|---|---|
| C→S | `terminal:create` | `{ roomId }` | Attaches to an existing session or spawns one |
| S→C | `terminal:ready` | `{ message, reattached }` | `reattached: true` if a live PTY was reused |
| S→C | `terminal:error` | `{ message }` | Terminal disabled, not in the room, or unknown user |
| C→S | `terminal:input` | `{ data }` | Routed by the socket's bound session |
| S→C | `terminal:output` | `{ data }` | Raw PTY bytes |
| C→S | `terminal:resize` | `{ cols, rows }` | |
| S→C | `terminal:exit` | `{ exitCode, signal }` | Broadcast to every socket bound to the session |

**`terminal:create` deliberately takes no `username`.** The session key is
`roomId:<server-recorded username>`; accepting a client-supplied name would let
a client attach to someone else's shell.

Sessions are keyed per user, not per socket, so a page refresh reattaches to the
running shell rather than starting a new one. When the last socket detaches, the
PTY is killed after `TERMINAL_INACTIVITY_TTL_MS` (default 15 minutes) unless
something reattaches first.

---

## 3. Server state and its lifetimes

All in-process; nothing here survives a restart.

| Structure | Keyed by | Lifetime |
|---|---|---|
| `socketID_to_Users_Map` | socket id | Until disconnect |
| `roomID_to_State_Map` | room id | 30 min after the room empties (`ROOM_STATE_TTL_MS`) |
| `roomID_to_ChatHistory_Map` | room id | Same, capped at 100 messages |
| `socketID_to_TerminalSession_Map` | socket id | Until disconnect or `leave room` |
| `terminalSessionBindings` | `roomId:username` | 15 min after the last socket detaches |

Room-state cleanup re-checks that the room is genuinely empty before deleting,
so a user who leaves and returns within the window keeps their chat history.

---

## 4. Configuration

Server — see [`server/.env.example`](../server/.env.example):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5001` | HTTP/Socket.IO port |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated exact origins |
| `ENABLE_TERMINAL` | `false` | Master switch for PTY sessions |
| `TERMINAL_WORKSPACE_ROOT` | `<tmpdir>/dobby-workspaces` | Per-session shell working directories |
| `TERMINAL_INACTIVITY_TTL_MS` | `900000` | Idle PTY reap delay |
| `ROOM_STATE_TTL_MS` | `1800000` | Empty-room state reap delay |
| `CHAT_HISTORY_LIMIT` | `100` | Retained messages per room |

Client:

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:5001` | REST base and Yjs provider URL |
| `VITE_SOCKET_URL` | `http://localhost:5001` | Socket.IO endpoint |
