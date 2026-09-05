# 04 — Security Model

**Project:** Dobby
**Status:** Honest assessment, updated after Phase 1. Dobby now authenticates;
read §1 for what that does and does not cover.

---

## 1. The headline

**Every entry point requires an authenticated account.** The REST API, the main
Socket.IO connection, and the Yjs document namespaces all reject a caller with
no valid access token. The only unauthenticated endpoint is `/health`, which
reports liveness and nothing else.

**A room belongs to its creator.** Membership, not knowledge of the room id, is
the predicate every capability is gated on — editing, chat, the whiteboard, the
video call, and the terminal. A second person gets in only by redeeming a
single-use invite the owner minted for them. Security-by-UUID is retired: the
room id is now a lookup key, and leaking it grants nothing.

What this does not cover: Dobby has no email verification, no password reset, no
MFA, and no audit log. Account recovery is a manual database operation. Those are
real gaps for a production identity system, and they are not on the Phase 1 list.

## 2. Identity and sessions

Accounts are email plus a bcrypt-hashed password (cost 12, configurable). A
successful login returns two tokens:

| Token | Lifetime | Storage | Purpose |
|---|---|---|---|
| Access | 15 min | `localStorage`, sent as `Authorization: Bearer` and in the socket handshake | Verified statelessly on every call |
| Refresh | 30 days | `localStorage`; **hashed** server-side | Exchanged for a new pair; revocable |

Three properties are worth calling out:

**The server refuses to start without `JWT_SECRET`** (32+ characters). A default
signing key would mean every deployment that forgot to set one shares forgeable
tokens.

**Refresh tokens rotate and are single-use.** Presenting one revokes it and
issues a new pair. Replaying a consumed token fails rather than silently opening
a second session.

**Access tokens are re-checked against the database, not just verified.** A
signed token for a deleted account is rejected, so removing a user takes effect
before their token would otherwise expire.

Tokens live in `localStorage`, which means any script running on the page can
read them. That is the standard trade-off for a token-based SPA, and it is
acceptable here because Dobby renders no user content as HTML (§6). Moving to
`HttpOnly` cookies would need CSRF protection in exchange.

## 3. Authorization

`isMember(roomId, userId)` is the single predicate. It is consulted in four
places, and the reason there are four is that they are genuinely different
transports:

1. **REST** — `requireAuth` then a membership check per `:roomId` route. The
   file and history routes mount *inside* that check rather than beside it, so
   they inherit it and cannot be reached by a non-member — and cannot forget to
   re-implement it.
2. **Socket handshake** — `socketAuth` rejects the connection outright.
3. **Socket events** — every in-room handler re-checks membership on each event,
   because membership can be revoked while a socket is connected.
4. **Yjs namespaces** — document traffic rides its own dynamic namespaces
   (`/yjs|<roomId>:<fileId>`) which do **not** pass through the main connection
   middleware. Without a separate check there, an authenticated user could open
   any room's document by naming it. The room is taken from the namespace the
   client actually connected to, never from the handshake payload. Relatedly,
   `y-socket.io`'s BroadcastChannel sync is disabled client-side: it syncs
   same-origin contexts without reaching the server, which would be a second
   sync path with no authorization on it. See [03](./03-realtime-sync.md) §3.1c.

Two smaller decisions:

**A non-member gets 404, not 403,** on room routes. Distinguishing "no such
room" from "not your room" would let a caller enumerate which rooms exist.

**Invites are single-use and expire in 24 hours**, are issued only by the owner,
and are refused once the room is at its two-member capacity.

**Within a room, there is no per-file ownership.** Both members can create,
rename, and delete anything in the tree. That is deliberate — a pairing session
is two people working on one workspace, and a permission split would be
ceremony without a threat it defends against, given both parties were
deliberately invited.

## 4. The terminal

The terminal is still the sharpest edge in the product, but it is now sandboxed
rather than merely confined.

**Disabled by default.** `ENABLE_TERMINAL` must be explicitly set to `true`.

**Containerized.** With the default `TERMINAL_ISOLATION=docker`, each session is
a `docker run` whose PTY node-pty owns — so `vim`, colors, and interactive
prompts still work — with:

- `--cpus 0.5`, `--memory 256m`, `--memory-swap` equal to memory (without which
  the container swaps instead of being capped), `--pids-limit 128`;
- `--network none`, so a shell cannot scan the internal network or exfiltrate
  what it reads;
- `--cap-drop=ALL`, `--security-opt no-new-privileges`, `--user 1000:1000`,
  `--read-only`, with writable space limited to a `noexec` tmpfs at `/tmp` and
  the per-session workspace bind-mounted at `/workspace`.

**It fails closed.** If Docker is unreachable, terminal creation errors. It does
not fall back to a host shell — that would turn a missing daemon into an
unsandboxed shell for anyone in the room.

**`TERMINAL_ISOLATION=host` remains available** and is the pre-Phase-1
behaviour: a real shell on the server host, confined to a scratch directory
under `TERMINAL_WORKSPACE_ROOT` with an allowlisted environment (`PATH`, `LANG`,
`LC_ALL`, `TZ`, `TERM`) rather than an inherited `process.env`. It is **not a
sandbox** — the shell can still read whatever the server user can read. It is
for local development on a machine you own, and the server logs a warning at
startup when it is selected.

**Session identity comes from the server.** The session key is
`roomId:userId` using the authenticated user id, never a client-supplied value,
so a client cannot attach to another user's shell by naming it. Containers are
force-removed on teardown, because one that outlives its session keeps holding
its CPU and memory reservation.

**What the container still does not do:** there is no seccomp profile beyond
Docker's default, no user namespace remapping, and the writable-layer cap is
only enforced on `overlay2` with pquota. A container escape is a container
escape.

## 5. Code execution

`POST /api/execute` proxies to the public **Piston** API, which runs the code in
its own isolated environment with compile and run timeouts of 10 seconds each.
Requests are capped at 100,000 characters, and `stdin` and `filename` are
type- and shape-checked.

The endpoint now **requires authentication and is rate-limited to 20 executions
per minute per user**, which closes the open-proxy gap. The remaining trade-off
is unchanged: user code leaves our infrastructure — do not paste secrets into
the editor and press Run — and availability depends on a third party.

## 6. Input handling

Every client-supplied payload is validated before it is acted on or relayed.

| Surface | Handling |
|---|---|
| REST bodies | Capped at 500kb by `express.json`; each route validated by a zod schema |
| `POST /api/execute` | 100k-char cap on `code` and `stdin`; `filename` restricted to a simple name |
| Socket payloads | Every event validated by a zod schema; failures return `socket:error` to the sender and are not broadcast |
| Chat messages | 4,000-char cap; **author and timestamp assigned by the server** from the authenticated socket, so nobody can post as their partner |
| File names | One path segment, 120 chars: separators, control characters, and `.`/`..` are rejected, so `parent_id` stays the only expression of hierarchy and a name cannot express a traversal |
| File tree size | `MAX_FILES_PER_ROOM` (200) and `MAX_TREE_DEPTH` (12), which also bound the recursive subtree walks |
| Whiteboard strokes | No longer a relayed event — strokes are Yjs updates, bounded by the frame ceiling below and gated by the namespace check |
| WebRTC signals | 128kb cap, and both ends must be in the same room — signals used to be relayed to any socket id the sender named |
| Terminal input | 8kb per event |
| Socket frames | 1MB ceiling via `maxHttpBufferSize` |
| Yjs updates | Handled by `y-socket.io`; no application-level validation, but the namespace is membership-gated |

Rendering is safer than it looks: chat messages render as React text nodes, not
`dangerouslySetInnerHTML`, so stored XSS via chat is not currently possible. That
is a property of the current components, not an enforced invariant.

## 7. Rate limiting

| Surface | Limit |
|---|---|
| `/api/auth/*` | 10 attempts per 15 minutes — slow enough to make online password guessing impractical |
| `/api/execute` | 20 per minute |
| Everything else under `/api` | 300 per minute |
| Socket events | Per-socket token buckets, sized per event (chat 2/s, `terminal:input` 200/s, `terminal:create` 1 per 10s) |
| Yjs namespaces | Not covered by the buckets: bounded by `maxHttpBufferSize` and by the membership check on the namespace |

Express limiters do not apply to Socket.IO — once the connection is upgraded,
events bypass the HTTP stack entirely — which is why the socket buckets exist
separately. Limits key on the authenticated user id where there is one, falling
back to a normalized client IP.

The two halves scale differently, and only one of them needed moving.

**REST limits are per user, and a user's requests can land on any replica**, so
in-process counters would multiply every published quota by the replica count —
20 executions a minute becomes 60 on three nodes, which is not a limit. These
use a shared Redis store when `REDIS_URL` is set.

**Socket limits are per socket, and a socket lives on exactly one node for its
whole life.** A per-socket bucket is therefore already cluster-correct: there is
no second process holding a second bucket for the same connection, because there
is no second connection. It stays in process memory deliberately — moving it to
Redis would add a network round trip to every keystroke of terminal input to
defend a property it already has.

## 8. CORS

`ALLOWED_ORIGINS` is a comma-separated allowlist of exact origins, defaulting to
`http://localhost:5173`, and applies to both Express and Socket.IO. A
disallowed origin is denied by withholding the CORS headers rather than by
throwing, so the browser blocks the request cleanly instead of the server
returning a 500 with a stack trace.

Note what CORS does and does not buy: it constrains **browsers**. It does not
stop a script, a curl invocation, or anything else that simply omits the
`Origin` header. It is a defense against a malicious web page acting through a
victim's browser, not an access control — that is what §2 and §3 are for.

## 8.1 The metrics endpoint

`/metrics` is a second unauthenticated-looking surface and is deliberately not
one. It reports active rooms, connected sockets, live PTYs, and document sizes —
an inventory of who is using the instance and how much — so unlike `/health` it
is guarded: a bearer token when `METRICS_TOKEN` is set, and **loopback callers
only** when it is not. The default is closed to the network rather than open,
because a fail-open default would publish that inventory from the first
deployment that forgot a variable.

The token is compared in constant time and is not a user account. A scraper has
no account, and giving it one would mean a long-lived password sitting in a
Prometheus config.

`deploy/nginx.conf` returns 404 for `/metrics` rather than proxying it, which is
mostly a correctness measure — a balanced scrape returns one replica's numbers
at random — but it also means the endpoint is not exposed publicly by the
reference configuration.

## 8.2 The Yjs routing hint

Clustered deployments have the client append `?doc=<roomId>:<fileId>` to its Yjs
connection so a load balancer can hash on it. It is worth being explicit that
**this is a hint and carries no authority**: the server takes both the room it
authorizes against and the document it takes a lease on from the namespace the
client actually connected to, never from the query string. A client that lies
about `doc` misroutes itself and gains nothing — it is refused by the membership
check exactly as before, and by the lease if it lands on the wrong node.

The lease is checked *after* membership, deliberately. Taking a lease for a
request that was going to be rejected anyway would let a non-member evict a
document from the node legitimately serving it — a denial of service dressed up
as routing.

## 9. Data at rest

| Store | Contents | Encryption | Retention |
|---|---|---|---|
| The relational store — SQLite in `server/.data/`, or Postgres | Accounts, rooms, memberships, invites, **file tree, chat transcripts, document snapshots** | None | Rooms deleted after 90 days idle; everything room-scoped cascades with them |
| LevelDB (`server/.yjs-persistence/`) | Yjs document state — file contents and whiteboard strokes | None | Deleted with their room, or with their file |
| Browser IndexedDB | A local replica of each document the user has opened | None | Until the browser's site data is cleared |
| Memory | Language selection, terminal scrollback | — | 30 min after a room empties |

Two of those rows are new with Phase 3 and change the exposure. **Chat and the
whiteboard are now on disk**: what used to evaporate when a room emptied now
persists until the room is deleted, so a stolen `.data` directory yields
transcripts as well as account records. And **the client keeps a copy of every
document it has opened in IndexedDB**, which is what makes offline editing work
— a shared or unattended browser retains room content after sign-out, since
clearing tokens does not clear the object stores.

Document content used to accumulate on disk forever with no delete path. There
is now a policy and two mechanisms:

- **Deleting a room deletes its documents.** Live documents are destroyed first
  (which closes open connections), then cleared from LevelDB — the reverse order
  would let a still-connected client re-persist what was just cleared.
- **An hourly sweep** deletes rooms untouched for `ROOM_RETENTION_MS` (90 days
  by default) along with their documents, collects documents whose room no
  longer exists, and prunes expired invites and refresh tokens.

Passwords are bcrypt-hashed and refresh tokens are SHA-256 hashed, so a database
read yields no usable credential. Everything else is plaintext, on either engine.
Both local directories are gitignored.

Running Postgres moves that data off the host and onto a server with its own
access control, its own network exposure, and its own backups — which is a
different security posture rather than a strictly better one. `DATABASE_SSL=true`
is the switch for a connection the host cannot otherwise verify; the credentials
live in `DATABASE_URL`, so it belongs in the same place as `JWT_SECRET` and not
in a compose file.

## 10. Deployment checklist

- [x] **Authentication.** Present. Set `JWT_SECRET` to a unique random value —
      the server will not start otherwise.
- [ ] Set `ALLOWED_ORIGINS` to your real front-end origin. Do not leave the default.
- [ ] Leave `ENABLE_TERMINAL=false` unless you need it; if you enable it, leave
      `TERMINAL_ISOLATION=docker` and confirm the daemon is reachable.
- [ ] Never set `TERMINAL_ISOLATION=host` on a shared or public host.
- [ ] Set `TERMINAL_WORKSPACE_ROOT` to a dedicated volume you are willing to lose.
- [ ] Set `TRUST_PROXY` if you are behind a load balancer, or rate limits will
      treat every user as one client.
- [ ] Back up the store — `server/.data/` on SQLite, the database itself on
      Postgres. It holds every account and room, and losing it is unrecoverable;
      there is no password reset.
- [ ] If you set `REDIS_URL`, treat Redis as a **database**: it holds document
      content. Persistence on, `maxmemory-policy noeviction`, and on a private
      network — it is unauthenticated by default and holds everything anyone has
      typed.
- [ ] Set `METRICS_TOKEN` if anything other than a loopback sidecar needs to
      scrape `/metrics`, and do not expose the endpoint through your load
      balancer.
- [ ] If you set `DATABASE_URL`, keep Postgres on a private network, give Dobby
      its own role rather than a superuser, and set `DATABASE_SSL=true` when the
      connection crosses anything you do not control. The URL carries the
      password: treat it like `JWT_SECRET`.
- [ ] Confirm both routing rules are in place if you run more than one replica —
      `hash $arg_doc consistent` for documents and `hash $affinity_key
      consistent` for connections — and alert on
      `dobby_document_lease_conflicts_total`, which is flat at zero when routing
      is correct.
- [ ] Terminate TLS in front of the app. Access tokens travel in headers and
      WebRTC requires a secure context anyway.
- [ ] Confirm `server/.env` and `client/.env` are untracked.

## 11. Threat model summary

| Threat | Status |
|---|---|
| Anonymous caller reaches any endpoint | **Mitigated** — auth required everywhere except `/health` |
| Stranger with a leaked room URL joins | **Mitigated** — membership required, not knowledge of the id |
| Attacker enumerates which rooms exist | Mitigated — non-members get 404 |
| Invite link replayed by a third party | Mitigated — single use, 24h expiry, capacity-checked |
| Stolen refresh token replayed | Mitigated — rotation invalidates the presented token |
| Token used after account deletion | Mitigated — tokens re-checked against the database |
| Authenticated user opens another room's document | **Mitigated** — Yjs namespaces membership-gated |
| User posts chat as their partner | Mitigated — author assigned server-side |
| WebRTC signals pushed at arbitrary sockets | Mitigated — both ends must share a room |
| Client hijacks another user's terminal session | Mitigated — server-derived session identity |
| Terminal user reads server secrets or the host filesystem | **Mitigated** in docker mode — container, `--cap-drop=ALL`, no network. **Not mitigated** in host mode |
| Terminal escapes the container | **Not mitigated** — no seccomp profile beyond Docker's default, no userns remap |
| `/api/execute` abused as an open proxy | **Mitigated** — auth plus 20/min per user |
| Denial of service by resource exhaustion | **Partly mitigated** — rate limits, payload caps, and container CPU/memory/pid limits. No global quota per account |
| Password guessing | **Partly mitigated** — bcrypt cost 12, 10 attempts per 15 min. No MFA, no lockout |
| Token theft via XSS | **Not mitigated** — tokens in `localStorage`; no user content is rendered as HTML today, but that is not enforced |
| Account takeover via email | **N/A** — no email flows exist, so no reset to hijack. Also means no recovery |
| Compromise of the database — the SQLite file, or the Postgres server | **Not mitigated** — unencrypted at rest; credentials are hashed, everything else (including chat transcripts and the file tree) is not |
| `DATABASE_URL` leaking through a log or an error | **Partly mitigated** — the startup line prints host, port, and database name only, never the whole URL. Nothing else logs it |
| A file name used to escape its room or reach the host filesystem | Mitigated — names are one path segment, hierarchy is `parent_id`, and no file row ever becomes a filesystem path: content lives in LevelDB keyed by uuid |
| One room's file or snapshot read from another | Mitigated — every lookup is scoped by `room_id`, so an id from elsewhere is indistinguishable from one that does not exist |
| Room content left in a shared browser after sign-out | **Not mitigated** — the IndexedDB replica that makes offline editing possible survives clearing the session |
