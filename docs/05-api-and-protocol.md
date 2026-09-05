# 05 — API & Protocol

**Project:** Dobby
**Scope:** every REST endpoint and Socket.IO event the server handles or emits.

> Everything below requires authentication except `GET /health` and the three
> `/api/auth` entry points. See [04 Security](./04-security-model.md).

---

## 1. Authentication

Base URL from `VITE_API_BASE_URL` (default `http://localhost:5001`). JSON in and
out. CORS is restricted to `ALLOWED_ORIGINS`.

Authenticated calls carry `Authorization: Bearer <accessToken>`. Sockets carry
the same token in the handshake `auth` object.

A **session** response, returned by register, login, and refresh:

```jsonc
{
  "user": { "id": "uuid", "email": "a@b.com", "username": "alice", "createdAt": "<ISO8601>" },
  "accessToken": "<jwt>",       // 15 minutes
  "refreshToken": "<opaque>"    // 30 days, single use
}
```

| Endpoint | Body | Notes |
|---|---|---|
| `POST /api/auth/register` | `{ email, username, password }` | `username` 2–32 chars, `password` 10–200. `409` if the email is taken |
| `POST /api/auth/login` | `{ email, password }` | `401` on a wrong email or password — the two are indistinguishable, and cost the same time |
| `POST /api/auth/refresh` | `{ refreshToken }` | Rotates: the presented token is revoked. `401` if invalid, expired, or already used |
| `POST /api/auth/logout` | `{ refreshToken }` | Revokes that one session. Always `200` |
| `POST /api/auth/logout-all` | — | Auth required. Revokes every session for the caller |
| `GET /api/auth/me` | — | Auth required. `{ user }`, or `401` |

All six are rate-limited to 10 requests per 15 minutes (`AUTH_RATE_LIMIT`).

The client refreshes transparently: `apiClient` retries a 401 once after
refreshing, and concurrent 401s share a single in-flight refresh so they don't
rotate each other's tokens.

## 2. Rooms

All room routes require authentication. A caller who is not a member of the
named room gets **`404`, not `403`** — distinguishing the two would let someone
enumerate which rooms exist.

| Endpoint | Returns | Notes |
|---|---|---|
| `GET /api/rooms` | `{ rooms: Room[] }` | Rooms the caller owns or was invited to, each with `role` |
| `POST /api/rooms` | `{ room }` | Body `{ name? }`. The caller becomes owner |
| `GET /api/rooms/:roomId` | `{ room, members }` | Members include `id`, `username`, `email`, `role` |
| `POST /api/rooms/:roomId/invites` | `{ invite }` | Owner only. `409` if the room is already full |
| `GET /api/rooms/:roomId/invites` | `{ invites }` | Owner only |
| `DELETE /api/rooms/:roomId/invites/:token` | `{ ok: true }` | Owner only; pending invites only |
| `POST /api/rooms/join` | `{ room, alreadyMember }` | Body `{ token }`. Redeems an invite |
| `DELETE /api/rooms/:roomId/members/:userId` | `{ ok: true }` | Owner removes a guest, or a guest removes themselves |
| `DELETE /api/rooms/:roomId` | `{ ok: true }` | Owner only. **Also deletes the room's Yjs documents** |

```ts
type Room = {
  id: string;            // uuid v4, assigned server-side
  name: string;
  ownerId: string;
  createdAt: string;
  lastActiveAt: string;  // refreshed on every join; drives retention
  role?: 'owner' | 'guest';
};
```

Invites are **single-use**, expire after `INVITE_TTL_MS` (24 hours), and are
refused once the room holds its maximum of two members. Redeeming one you have
already used is idempotent rather than an error, so re-opening a shared link
works. The shareable URL is `/invite/<token>` on the client.

A newly created room is seeded with one file (`main.js`), because an explorer
with nothing in it is indistinguishable from a broken one.

## 2b. Files

Mounted under the room router and behind the same membership gate, so a
non-member gets the same `404` as for the room itself. Both members can create,
rename, move, and delete — a room is shared, not owned per file.

**These endpoints carry structure only. A file's content is the Yjs document
`<roomId>:<fileId>`** (see [03](./03-realtime-sync.md)), so nothing here is
written on a keystroke.

| Endpoint | Body | Returns |
|---|---|---|
| `GET /api/rooms/:roomId/files` | — | `{ files: FileNode[] }` — roots, with folders nesting their `children` |
| `POST /api/rooms/:roomId/files` | `{ name, type?, parentId? }` | `{ file }`. `type` is `file` (default) or `folder`; `parentId` null/absent means the root |
| `PATCH /api/rooms/:roomId/files/:fileId` | `{ name?, parentId? }` | `{ file }` |
| `DELETE /api/rooms/:roomId/files/:fileId` | — | `{ removed: string[] }` — the node and everything under it |

```ts
type FileNode = {
  id: string;              // uuid v4; also the second half of the document name
  roomId: string;
  parentId: string | null; // null = root
  name: string;
  type: 'file' | 'folder';
  language: string | null; // inferred from the extension; null for a folder
  createdAt: string;
  updatedAt: string;
  children?: FileNode[];   // folders only
};
```

`PATCH` distinguishes an **absent** `parentId` from an explicit `null`: absent
means "leave it where it is", `null` means "move it to the root". Treating the
two the same would silently move every rename to the top of the tree.

| Status | Meaning |
|---|---|
| 400 | A name that is empty, over 120 characters, reserved (`.`/`..`), or containing a path separator or control character; an unknown `type`; a `PATCH` body asking for nothing; a folder moved inside itself |
| 404 | No such file *in this room* — including a `parentId` belonging to another room, which is indistinguishable from one that does not exist |
| 409 | A sibling already has that name (case-insensitively), or the room is at `MAX_FILES_PER_ROOM` |

**Names are a single path segment, never a path.** Rejecting the separator is
what keeps `parentId` the only expression of hierarchy — a name of
`../secrets` would otherwise be a second, contradictory one.

Deleting a folder removes its whole subtree, and the response names every id so
the client can close the matching tabs. Server-side each of those ids also loses
its Yjs document and its snapshots. The row goes first and the content follows:
a failure after the row is gone leaves orphaned state for the retention sweep,
whereas the reverse order would leave a file in the tree whose contents had been
erased.

## 2c. Document history

| Endpoint | Returns | Notes |
|---|---|---|
| `GET …/files/:fileId/snapshots` | `{ path, snapshots: Snapshot[] }` | Newest first. Metadata only — never the stored blob |
| `POST …/files/:fileId/snapshots` | `{ snapshot, unchanged }` | Snapshot now. `snapshot` is `null` and `unchanged` true when the document has not moved since the last one |
| `GET …/files/:fileId/snapshots/:id` | `{ snapshot, text }` | The text that snapshot holds, for a preview |
| `POST …/files/:fileId/snapshots/:id/restore` | `{ snapshot, changed }` | Rewrites the document to that state |

```ts
type Snapshot = {
  id: string;
  roomId: string;
  docName: string;   // `<roomId>:<fileId>`
  size: number;      // bytes of encoded Yjs state
  createdAt: string;
};
```

Snapshots are also taken automatically every `SNAPSHOT_INTERVAL_MS` (5 minutes)
for every open document, skipping any whose state vector has not changed;
`SNAPSHOTS_PER_DOCUMENT` (20) are kept and older ones are dropped.

**Restore does not return the new content, and the client does not apply it.**
The server rewrites the live Yjs document, and every open editor — including the
caller's — receives that as an ordinary remote edit through the binding it
already has. That is also why a restore is safe mid-session: it is expressed as
a new edit rather than a replacement, so a partner typing through one keeps
their characters and both sides converge. The document is snapshotted
immediately before being overwritten, so a restore is itself undoable.

## 3. Execution

### `POST /api/execute`
Runs code on the remote Piston service. Nothing executes on the Dobby host.
**Auth required**, and limited to `EXECUTE_RATE_LIMIT` (20) calls per minute per
user — without which this is an open proxy to a service we do not pay for.

```jsonc
// request
{
  "language": "python",     // required — slug or Piston alias
  "code": "print('hi')",    // required — max 100,000 characters
  "stdin": "",              // optional — max 100,000 characters
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
| 400 | Missing/invalid `language`, non-string `code`, over the size cap, bad `filename`, or an unsupported language |
| 401 | No or invalid access token |
| 429 | Rate limit exceeded |
| 502 | Piston unreachable or returned a non-2xx response |

Compile and run timeouts are 10s each, set server-side and not client-tunable.

### `GET /api/runtimes`
The Piston runtime list — `[{ language, version, aliases }]`. Auth required.
Fetched once per server start and cached in memory thereafter. `502` if the
first fetch fails; the cache is cleared on failure so the next call retries.

### `GET /health`
Liveness probe, and the only unauthenticated endpoint.
`200 → { status: "ok", time: "<ISO8601>" }`.

It deliberately reveals nothing else — not the node id, not a version. Adding
the node id was considered for debugging a load balancer from outside and
rejected: this is the one anonymous endpoint, and it should not become a way to
enumerate the fleet.

### `GET /metrics`
Prometheus exposition format. **Not** part of the `/api` surface and not
authenticated as a user — a scraper has no account, and giving it one would put
a long-lived password in a Prometheus config. Two ways in, in order:

1. `METRICS_TOKEN` set → `Authorization: Bearer <token>`, compared in constant
   time. `401` otherwise.
2. `METRICS_TOKEN` unset → loopback callers only. `403` otherwise, with a
   message naming the variable, so a misconfigured scraper is a two-minute fix.

The default is therefore closed to the network rather than open. Every value is
per process; in a cluster, scrape each replica directly and sum. The full metric
catalogue is in [08](./08-observability.md).

---

## 4. Socket.IO protocol

One connection per browser tab carries all of the following **plus** the Yjs
traffic described in [03](./03-realtime-sync.md).

**The handshake is authenticated.** A socket connects with
`io(url, { auth: { token } })`; a missing or invalid token fails the connection
with `connect_error` and no handler ever runs. The verified user is attached
server-side, and **is the only identity the server trusts** — every payload
field below that used to carry a `username` has been removed, because the server
supplies it.

Yjs channels ride separate dynamic namespaces (`/yjs|<roomId>:<fileId>`) which
carry the same token and are independently membership-gated; see
[03](./03-realtime-sync.md).

**Yjs connections carry a `?doc=<roomId>:<fileId>` query parameter.** It is a
routing hint for the load balancer, which cannot see the namespace name because
Socket.IO puts every namespace on the same `/socket.io/` path. It is a hint and
nothing more: authorization and document ownership are both taken from the
namespace the client actually connected to, so a forged value misroutes the
liar and grants nothing.

In a clustered deployment a Yjs handshake can be refused with an error carrying
`data: { code: 'DOCUMENT_MOVED', owner: { nodeId, address } }`, meaning another
replica holds this document's lease. This is a **routing** failure, not an
authorization one, and it is retryable — the client backs off and reconnects.
Socket.IO does not retry a refused handshake on its own, so the client does;
see `client/src/services/yjsProvider.js` and
[ADR-014](./07-adrs.md#adr-014).

### 4.1 Errors and quotas

| Direction | Event | Payload |
|---|---|---|
| S→C | `socket:error` | `{ event, message }` |

Emitted to the sender when a payload fails validation, exceeds a size cap, or
trips a rate limit. The offending event is not broadcast. The client surfaces
these as toasts.

Every event is rate-limited by a per-socket token bucket sized to its expected
traffic — chat at 2/s sustained, `terminal:input` at 200/s, `terminal:create` at
one per 10 seconds. The bucket does not cover the Yjs namespaces, which carry
code and whiteboard strokes; those are bounded by `SOCKET_MAX_PAYLOAD_BYTES` and
by the membership check on the namespace instead.

### 4.2 Room lifecycle

| Direction | Event | Payload | Notes |
|---|---|---|---|
| C→S | `join room` | `{ roomId }` | Requires database membership, not just knowledge of the id |
| S→C | `room denied` | `{ message }` | Caller is not a member |
| S→C | `room full` | `{ message }` | Two sockets already connected |
| S→room | `new member joined` | `{ username }` | To everyone except the joiner |
| S→room | `updating client list` | `{ userslist: string[] }` | To everyone including the joiner |
| S→C | `chat history` | `{ messages: ChatMessage[] }` | Replayed to the joiner only |
| S→C | `on language change` | `{ languageUsed }` | Sent to the joiner if the room has a language set |
| C→S | `leave room` | `{ roomId }` | For navigating away without disconnecting |
| S→room | `member left` | `{ username }` | On `leave room` and on `disconnecting` |

Capacity counts **live connections**, not memberships, so a member opening a
second tab does not lock their partner out. Membership is re-checked on every
in-room event, not only at join, because it can be revoked mid-session.

A socket that disconnects without emitting `leave room` is handled by the
`disconnecting` hook, which emits `member left` for each room and schedules
state cleanup. `leave room` additionally detaches any terminal session and
re-broadcasts the roster — a disconnect doesn't need the roster update because
Socket.IO has already removed the socket.

### 4.3 Language

| Direction | Event | Payload |
|---|---|---|
| C→S | `update language` | `{ roomId, languageUsed }` |
| S→room | `on language change` | `{ languageUsed }` |

Stored per room and last-write-wins. Code content is **not** carried here — that
is Yjs's job.

### 4.4 Chat

| Direction | Event | Payload |
|---|---|---|
| C→S | `send_message` | `{ roomId, message }` — max 4,000 characters |
| S→room | `receive_message` | `ChatMessage` |

```ts
type ChatMessage = {
  messageId: string;   // uuid v4, assigned server-side
  user: string;        // assigned server-side from the authenticated socket
  userId: string;
  message: string;
  timestamp: string;   // ISO8601, assigned server-side
};
```

**The client no longer sends an author.** It used to, which meant anyone could
post as their partner; `user` and `userId` now come from the socket's verified
identity.

`receive_message` goes to the whole room **including the sender** — the sender
renders from the echo rather than optimistically, so both clients display the
server's canonical message id and timestamp. History lives in the
`chat_messages` table, capped at the most recent `CHAT_HISTORY_LIMIT` (default
100) messages per room; the cap is enforced by deleting rows in the same
transaction as the insert, so it survives a restart along with the transcript.

### 4.5 Files

| Direction | Event | Payload |
|---|---|---|
| S→room | `files:changed` | `{ action: 'created' \| 'updated' \| 'restored', file }` or `{ action: 'deleted', fileIds: string[] }` |

Emitted by the REST endpoints in §2b to everyone in the room, including the
caller. It is a **notification, not a sync protocol**: the client refetches the
tree rather than patching its copy, which keeps the database the single record of
structure. A `deleted` payload additionally names the ids so open tabs for those
files can be closed — that is the one thing a refetch cannot convey.

### 4.6 Whiteboard

**There are no whiteboard events.** Strokes are a `Y.Array` in the room's
`<roomId>:__whiteboard__` document and travel the CRDT path described in
[03 §4](./03-realtime-sync.md).

```ts
type Stroke = {
  prevPos:   { x: number; y: number };
  currPos:   { x: number; y: number };
  color?:    string;
  lineWidth?: number;
};
```

The previous `draw` / `on draw` / `clear canvas` relay is gone. It validated and
capped each stroke but stored none of them, so a user joining mid-session saw an
empty canvas and a refresh lost the board. Clearing is `delete(0, length)` on the
array rather than a message, which converges: a stroke drawn concurrently with a
clear either survives or does not, consistently on both sides.

### 4.7 WebRTC signaling

The server is a pure relay here; media never touches it.

| Direction | Event | Payload |
|---|---|---|
| C→S | `join video` | `{ roomId }` |
| S→C | `all users video` | `string[]` — other socket ids in the room |
| C→S | `sending signal` | `{ roomId, userToSignal, callerID, signal }` |
| S→C | `user joined video` | `{ signal, callerID }` |
| C→S | `returning signal` | `{ roomId, callerID, signal }` |
| S→C | `receiving returned signal` | `{ signal, id }` |

Standard offer/answer: the joiner asks who's present, initiates a peer to each,
and the existing member answers. `simple-peer` handles ICE.

**Both events now require `roomId`**, and the server drops the signal unless the
destination socket is in that room. Previously a signal was relayed to any socket
id the sender named. `signal` is capped at `MAX_SIGNAL_PAYLOAD_BYTES` (128kb).

### 4.8 Terminal

Disabled unless `ENABLE_TERMINAL=true`. Sandboxed in a container unless
`TERMINAL_ISOLATION=host`; see [04 Security](./04-security-model.md) §4.

| Direction | Event | Payload | Notes |
|---|---|---|---|
| C→S | `terminal:create` | `{ roomId }` | Attaches to an existing session or spawns one |
| S→C | `terminal:ready` | `{ message, reattached, isolation }` | `reattached: true` if a live PTY was reused |
| S→C | `terminal:error` | `{ message }` | Terminal disabled, or Docker unreachable |
| C→S | `terminal:input` | `{ data }` | Max 8kb; routed by the socket's bound session |
| S→C | `terminal:output` | `{ data }` | Raw PTY bytes |
| C→S | `terminal:resize` | `{ cols, rows }` | 1–1000 each |
| S→C | `terminal:exit` | `{ exitCode, signal }` | Broadcast to every socket bound to the session |

**`terminal:create` deliberately carries no identity.** The session key is
`roomId:<authenticated user id>`; accepting a client-supplied name would let a
client attach to someone else's shell. Membership is checked before a shell is
spawned.

If Docker is required but unreachable, `terminal:error` is returned — the server
does **not** fall back to a host shell.

Sessions are keyed per user, not per socket, so a page refresh reattaches to the
running shell rather than starting a new one. When the last socket detaches, the
PTY is killed after `TERMINAL_INACTIVITY_TTL_MS` (default 15 minutes) unless
something reattaches first, and the container is force-removed.

---

## 5. Server state and its lifetimes

Identity, room ownership, the file tree, chat, and snapshots are in the
relational store — SQLite, or Postgres when `DATABASE_URL` is set; document and
whiteboard content is in LevelDB, or Redis when clustered. Everything in the table below is
in-process and does not survive a restart.

| Structure | Keyed by | Lifetime |
|---|---|---|
| `roomID_to_State_Map` | room id | 30 min after the room empties (`ROOM_STATE_TTL_MS`) |
| `socketID_to_TerminalSession_Map` | socket id | Until disconnect or `leave room` |
| `terminalSessionBindings` | `roomId:userId` | 15 min after the last socket detaches |

`socketID_to_Users_Map` is gone: the authenticated user lives on `socket.data`,
set by the handshake middleware. `roomID_to_ChatHistory_Map` is gone too — the
transcript is a table now, so it survives the room emptying and the process
restarting rather than only a refresh.

Room-state cleanup re-checks that the room is genuinely empty before deleting,
so a user who leaves and returns within the window keeps the room's language
selection.

Durable state expires too. An hourly sweep deletes rooms idle for
`ROOM_RETENTION_MS` (90 days) along with their documents, collects orphaned
documents and snapshots, and prunes expired invites and refresh tokens. Files,
chat, and snapshots need no sweep of their own: they cascade from the room row.

---

## 6. Configuration

Server — see [`server/.env.example`](../server/.env.example) for the full list
with commentary:

| Variable | Default | Purpose |
|---|---|---|
| `JWT_SECRET` | — | **Required**, 32+ chars. The server refuses to start without it |
| `PORT` | `5001` | HTTP/Socket.IO port |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated exact origins |
| `DATABASE_URL` | unset | Postgres for everything below. Unset means SQLite; set means `DATABASE_PATH` is ignored, and an unreachable server stops startup |
| `DATABASE_PATH` | `./.data/dobby.db` | SQLite: accounts, rooms, invites, file tree, chat, snapshots |
| `YJS_PERSISTENCE_DIR` | `./.yjs-persistence` | LevelDB: document and whiteboard content. Empty string runs the CRDT in memory |
| `TRUST_PROXY` | unset | Proxy hops to trust for the client IP |
| `ACCESS_TOKEN_TTL` | `15m` | Access token lifetime |
| `REFRESH_TOKEN_TTL_MS` | `2592000000` | Refresh token lifetime (30 days) |
| `AUTH_RATE_LIMIT` | `10` | Auth attempts per 15 minutes |
| `EXECUTE_RATE_LIMIT` | `20` | Executions per minute per user |
| `API_RATE_LIMIT` | `300` | Other API calls per minute |
| `ENABLE_TERMINAL` | `false` | Master switch for PTY sessions |
| `TERMINAL_ISOLATION` | `docker` | `docker` (sandboxed) or `host` (dev only) |
| `TERMINAL_IMAGE` | `alpine:3.20` | Container image for terminal sessions |
| `TERMINAL_CPU_LIMIT` / `_MEMORY_LIMIT` / `_PIDS_LIMIT` | `0.5` / `256m` / `128` | Container resource ceilings |
| `TERMINAL_NETWORK` | `none` | Container network mode |
| `TERMINAL_WORKSPACE_ROOT` | `<tmpdir>/dobby-workspaces` | Per-session working directories |
| `TERMINAL_INACTIVITY_TTL_MS` | `900000` | Idle PTY reap delay |
| `ROOM_STATE_TTL_MS` | `1800000` | Empty-room state reap delay |
| `CHAT_HISTORY_LIMIT` | `100` | Retained messages per room |
| `MAX_FILES_PER_ROOM` | `200` | Ceiling on tree size |
| `MAX_TREE_DEPTH` | `12` | Ceiling on folder nesting |
| `SNAPSHOT_INTERVAL_MS` | `300000` | How often open documents are snapshotted |
| `SNAPSHOTS_PER_DOCUMENT` | `20` | Snapshots retained per document |
| `MAX_SNAPSHOT_BYTES` | `1000000` | Documents larger than this are not snapshotted |
| `INVITE_TTL_MS` | `86400000` | Invite lifetime (24 hours) |
| `ROOM_RETENTION_MS` | `7776000000` | Idle-room deletion threshold (90 days) |
| `RETENTION_SWEEP_INTERVAL_MS` | `3600000` | How often retention runs |

Client:

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:5001` | REST base and Yjs provider URL |
| `VITE_SOCKET_URL` | `http://localhost:5001` | Socket.IO endpoint |
