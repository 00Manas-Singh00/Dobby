# 06 — Roadmap

**Project:** Dobby
**Status:** v0.9. The pairing loop works end to end. Phases 1 and 2 are
complete: the deployment is no longer the vulnerability, and changes are no
longer verified by hand. Phase 3 is next.

---

## Where things stand

The core product is real. Two people can open a room, edit the same file with
live cursors and no lost characters, run the code, use a terminal, draw, chat,
and see each other. That is the whole demo, and it works.

Phase 1 closed the security gap: there are accounts, rooms have owners, the
terminal runs in a container, and nothing but `/health` is reachable
anonymously. Phase 2 closed the verification gap: 181 server tests, a
two-browser convergence test, and CI on every push. What is still missing is a
real file system, durability beyond the editor buffer, and a second server
instance. Roughly:

| Area | State |
|---|---|
| Collaborative editing | Done |
| Execution, chat, whiteboard, video, terminal | Done |
| Auth & authorization | **Done** |
| Terminal sandboxing | **Done** (per-session container) |
| Retention & delete paths | **Done** |
| Real file system | **Not started** (explorer is a mock) |
| Durability beyond the editor | **Partial** |
| Horizontal scale | **Not started** |
| Tests & CI | **Done** |
| Observability | **Not started** |

---

## Phase 1 — Make it safe to deploy ✅

**Goal:** Dobby can be put on a public URL without the deployment itself being
the vulnerability.

- [x] **Authentication.** Email/password accounts with bcrypt hashing, a 15-minute
      JWT access token, and a rotating refresh token stored hashed. The socket
      handshake verifies the token before any handler runs, so an unauthenticated
      socket never reaches `join room`.
- [x] **Room ownership.** Rooms are created server-side with an owner, and
      joining requires redeeming a single-use, 24-hour invite. Security-by-UUID
      is retired — the room id is a lookup key, not a capability. Non-members get
      404 rather than 403 so rooms cannot be enumerated.
- [x] **Rate limiting.** `/api/execute` is authenticated and capped at 20/min per
      user; auth endpoints at 10 per 15 min; every socket event has a per-socket
      token bucket, because Express limiters do not apply once the connection is
      upgraded.
- [x] **Validated chat and whiteboard payloads.** Every socket event is checked
      against a zod schema with a size cap, and a failure returns `socket:error`
      to the sender instead of being relayed. Chat authorship moved server-side.
- [x] **Containerized the terminal.** Sessions run in a per-session container
      with `--cpus 0.5`, `--memory 256m`, `--pids-limit 128`, `--network none`,
      `--cap-drop=ALL`, and a read-only root. It fails closed: no Docker means no
      terminal, not a host shell.
- [x] **A retention policy.** Deleting a room deletes its documents, and an
      hourly sweep collects rooms idle for 90 days, orphaned documents, expired
      invites, and spent refresh tokens.

Two things surfaced along the way and were fixed as part of this work: **Yjs
document namespaces bypass the main connection middleware** and needed their own
membership gate, and **WebRTC signals were relayed to any socket id the sender
named**, which is now scoped to the room.

**Done when:** ~~a deployed instance requires a login, the terminal runs in a
container, and no endpoint is usable by an anonymous caller.~~ Met.

**Deliberately not in scope**, and still missing from the identity system: email
verification, password reset, MFA, and an audit log. Account recovery is a manual
database operation today.

---

## Phase 2 — Establish a safety net ✅

**Goal:** changes stop being verified by hand. This is deliberately early — it
is the phase that makes every later phase cheaper, and Phase 1 just added a lot
of security-critical logic that is currently verified only by hand.

- [x] **Unit tests** (Vitest) for the parts with real logic: token
      issue/rotate/revoke, invite redemption with its expiry and capacity rules,
      terminal session binding and sandbox arguments, retention and TTL cleanup,
      Piston runtime resolution and language mapping, the payload schemas, and
      the socket token bucket.
- [x] **Integration tests** over the Socket.IO surface: join/leave lifecycle,
      the two-user cap, chat replay, terminal membership rejection, and the
      authorization boundaries added in Phase 1 — a non-member reaching a room,
      a document namespace, or another user's terminal session. These drive a
      real server on an ephemeral port with real clients, because the handshake
      check, the rate limiter, the schema, and the membership guard all live in
      the wiring rather than in the handlers.
- [x] **A two-context Playwright test** for the thing most likely to silently
      break: two browsers typing into one file and converging, in both
      directions, concurrently, and for a late joiner. Verified non-vacuous by
      severing the `MonacoBinding` and confirming it fails.
- [x] **CI on every push** — lint, build, test, in three jobs.
- [x] **Cleared the standing lint errors**: 31 down to 0.

**Done when:** ~~CI is green and required, and the convergence E2E test runs on
every pull request.~~ Met.

Two things had to change in the source to make any of this possible.
`index.js` bound a port and started the retention sweep at import, so nothing
in it could be loaded by a test; it now exports `createDobbyServer()` and only
listens when run directly. And `yjsService` always opened a LevelDB directory,
which takes an exclusive lock — an empty `YJS_PERSISTENCE_DIR` now runs the
CRDT in memory.

Two smaller things surfaced along the way and were fixed: the client's
`no-unused-vars` was configured to ignore every capitalized name, which hid
genuinely dead imports behind the workaround for ESLint not understanding JSX
(the JSX-awareness rule is now on, and the pattern is limited to what it is
for); and `SocketContext` created its socket inside an effect and set it into
state, so every sign-in rendered twice with a null socket in between.

**Deliberately not in scope:** component-level tests for the React tree, a test
for the WebRTC media path (the signalling is covered; the media is P2P and
needs real devices), and load testing, which belongs with Phase 4's metrics.
Two `react-hooks/exhaustive-deps` warnings remain, both on mount-once effects
whose dependency arrays are deliberate; CI reports them without failing.

---

## Phase 3 — Make it a real workspace ← next

**Goal:** close the gap between what the UI promises and what the backend does.

- [ ] **A real file system.** `FileExplorer.jsx` renders a hardcoded tree and
      opening a file creates a placeholder buffer. Back it with per-room
      storage and support create, rename, delete, and folders. This is the
      largest single credibility gap in the product.
- [ ] **Persist chat and whiteboard.** Move both out of process memory — SQLite
      is now available for exactly this. The
      whiteboard should replay its history to a late joiner instead of showing a
      blank canvas — modelling strokes as a `Y.Array` in the room's document
      would reuse the sync machinery already present.
- [ ] **Offline editing.** Add `y-indexeddb` to the client. This is a small
      change with a large payoff: edits made while disconnected survive a
      closed tab and merge on return. Highest value per unit of work on this
      list.
- [ ] **Document history.** Periodic Yjs snapshots plus a restore path.
- [ ] **Run output beside the editor per file**, rather than one shared
      execution panel for the whole workspace.

**Done when:** a user can manage files, a late joiner sees the whiteboard's
history, and closing a laptop lid mid-edit loses nothing.

---

## Phase 4 — Scale beyond one process

**Goal:** more than one server instance, and some idea of how the system behaves
under load.

- [ ] **Socket.IO Redis adapter**, so two replicas share room membership.
- [ ] **Move room, chat, and language state out of process memory.**
- [ ] **Decide what a multi-node Yjs deployment looks like** — either sticky
      routing per document, or a shared-backend provider. `YSocketIO` holds
      documents in the serving process today, so this needs a real design pass,
      not a config change.
- [ ] **Metrics** — active rooms, connected sockets, live PTYs, execution
      latency, Yjs document sizes. There is currently no visibility into a
      running instance beyond `console.log`.
- [ ] **A load test** with published methodology and numbers.

**Done when:** two replicas behind a load balancer serve one room correctly, and
there is a dashboard showing it.

---

## Beyond v1

- **Rooms larger than two.** The cap is deliberate ([ADR-006](./07-adrs.md#adr-006)),
  and lifting it means an SFU for video and a rethink of the shared terminal.
- **Self-hosted execution** to replace the dependency on public Piston.
- **AI assistance** — explain, fix, review. Comments and a `@google/generative-ai`
  dependency for this were removed as unimplemented; it should return as a
  designed feature or not at all.
- **Session recording and playback** for interview review.

---

## Ordering rationale

Security first because the terminal made an unauthenticated public deployment
genuinely dangerous, and because auth was a precondition for ownership,
persistence, and quotas — that ordering held up: room ownership, per-user
quotas, and the retention policy all fell out of having identity. Tests second
because they are cheapest to add while the codebase is small, they make Phase 3
survivable, and Phase 1 added authorization logic whose failure mode is silent.
That ordering held up too: the integration tests found no new
authorization holes, which is itself the result worth having, and the
refactors they forced — a server that can be constructed without being started,
persistence that can be turned off — are the same ones Phase 4 needs.
Feature completeness third. Scale last — a single node comfortably serves
two-person rooms, so distributing the system before anyone is using it would be
premature. Note that the Phase 1 rate limiters and room state are in-process,
which is one more thing Phase 4 has to move to a shared store.
