# 06 — Roadmap

**Project:** Dobby
**Status:** v1.2. The pairing loop works end to end, it is measured, and it is
no longer tied to one machine. Phases 1 through 5 are complete: the deployment is
no longer the vulnerability, changes are no longer verified by hand, the UI no
longer promises more than the backend does, the server is no longer confined to
one process or invisible while it runs, and the store no longer confines those
processes to one host.

---

## Where things stand

The core product is real. Two people can open a room, edit the same file with
live cursors and no lost characters, run the code, use a terminal, draw, chat,
and see each other. That is the whole demo, and it works.

Phase 1 closed the security gap: there are accounts, rooms have owners, the
terminal runs in a container, and nothing but `/health` is reachable
anonymously. Phase 2 closed the verification gap: server tests, a two-browser
convergence test, and CI on every push. Phase 3 closed the credibility gap: the
file explorer is backed by real per-room storage, chat and the whiteboard
survive a restart, edits survive a closed lid, and a file has a history. Phase 4 closed the
scale and visibility gaps: `REDIS_URL` turns one process into a cluster, a
document is served by exactly one replica by design rather than by luck, and
there are metrics, a dashboard, and published numbers for what one node
actually holds. Phase 5 closed the last one that was structural: `DATABASE_URL`
turns the store from a file into a database, so the replicas Phase 4 produced
can finally be on different machines. Roughly:

| Area | State |
|---|---|
| Collaborative editing | Done |
| Execution, chat, whiteboard, video, terminal | Done |
| Auth & authorization | **Done** |
| Terminal sandboxing | **Done** (per-session container) |
| Retention & delete paths | **Done** |
| Real file system | **Done** (per-room tree in the database, content in Yjs) |
| Durability beyond the editor | **Done** (chat and whiteboard persisted; offline editing) |
| Document history | **Done** (periodic snapshots with restore) |
| Horizontal scale | **Done** (Redis adapter, document leases, shared document storage) |
| Tests & CI | **Done** (327 server tests, run twice — once per engine — incl. a two-replica suite; 16 end-to-end) |
| Observability | **Done** (Prometheus metrics, dashboard, load test) |
| Distributed identity store | **Done** (Postgres behind `DATABASE_URL`; SQLite still the default) |
| Replicas on separate hosts | **Done** — and *unmeasured*: correctness is tested, performance needs two machines |

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
One `react-hooks/exhaustive-deps` warning remains, on a mount-once effect whose
dependency array is deliberate; CI reports it without failing. (The second was
in `Whiteboard.jsx` and went away when Phase 3 rewrote it onto Yjs.)

---

## Phase 3 — Make it a real workspace ✅

**Goal:** close the gap between what the UI promises and what the backend does.

- [x] **A real file system.** A `room_files` table holds the tree — files,
      folders, names, parents — and `routes/files.js` exposes create, rename,
      move, and delete over REST. The split that makes this cheap: **the table
      holds structure, Yjs holds content.** A file row is an id and a name; its
      bytes are the Yjs document `<roomId>:<fileId>`, which is the naming the
      editor was already using, so nothing had to be written on a keystroke and
      the CRDT stayed the only writer for content. Mutations are broadcast as
      `files:changed`, so the other person's explorer follows without a reload.
      A new room is seeded with one file, because an empty explorer is
      indistinguishable from a broken one.
- [x] **Persist chat and whiteboard.** Chat moved from
      `roomID_to_ChatHistory_Map` into a `chat_messages` table, with the cap now
      enforced by deleting rows rather than slicing an array — so the trim is
      durable too. The whiteboard became a `Y.Array` in the room's
      `<roomId>:__whiteboard__` document, which is what the roadmap suggested
      and it paid off exactly as expected: replay to a late joiner, persistence,
      and offline drawing all came from the sync machinery already present
      rather than from new protocol. A clear is `delete(0, length)` on that
      array, which converges — a separate "clear" message racing a stroke could
      not.
- [x] **Offline editing.** `y-indexeddb` on both the editor and the whiteboard,
      attached *before* the network provider so the local state loads first and
      the server's merges into it. As predicted, the smallest change on the list
      and among the most valuable: a closed lid mid-edit now loses nothing.
- [x] **Document history.** A timer encodes each open document's state into a
      `document_snapshots` row, skipping any document whose state vector has not
      changed — an idle room costs one comparison and no writes. Restore is the
      part worth reading the code for: Yjs updates are additive, so re-applying
      an old update is a no-op against a document that already contains it.
      Restore is therefore expressed as a *new* edit inside one transaction,
      which means it merges with a partner typing through it rather than
      overwriting them, and both people see it at once.
- [x] **Run output beside the editor per file.** `useCodeExecution` is keyed by
      file id. The shared panel was quietly wrong: running one file and
      switching tabs showed you output you would reasonably read as belonging to
      the file in front of you.

**Done when:** ~~a user can manage files, a late joiner sees the whiteboard's
history, and closing a laptop lid mid-edit loses nothing.~~ Met.

Three things had to change elsewhere to make this work. **Yjs is now `require`d
rather than `import`ed** in the two server modules that touch it: y-socket.io
and y-leveldb are CommonJS and pull in their own copy, and Yjs's constructor
checks are identity-based — an ESM import is a second module instance whose
`instanceof` fails on documents that came from the other one. **The routers
reach Socket.IO through `app.set('io', io)`** rather than an import, so two
servers in one process still cannot see each other's rooms. And the
**end-to-end helpers were scoped to the visible editor**: `EditorWorkspace`
mounts one Monaco instance per open tab and hides the rest, so a `.first()`
selector stopped being the one on screen the moment a room could hold two open
files.

**Deliberately not in scope:** file upload and download, a diff view between
snapshots (the panel previews a version's text but does not compare two), and
drag-and-drop reordering in the explorer — the API supports moving a node, but
the UI exposes it only through rename. Whiteboard strokes are absolute pixel
coordinates, so two people at very different window sizes see the board
positioned differently; that needs a coordinate space of its own, not a bug fix.

---

## Phase 4 — Scale beyond one process ✅

**Goal:** more than one server instance, and some idea of how the system behaves
under load.

- [x] **Socket.IO Redis adapter**, so two replicas share room membership. Gated
      behind a single `REDIS_URL`: unset, nothing in this phase runs and the
      server is byte-for-byte the Phase 3 single node. Set, it **fails closed** —
      an unreachable Redis stops startup rather than producing a replica that
      thinks it is alone, because that failure presents as "my partner's edits
      sometimes don't arrive" rather than as an outage.
- [x] **Moved the remaining process-memory state out.** Only the language
      selection was left after Phase 3, and it is now a Redis hash with a TTL
      armed on release and cleared on join. Two things deliberately stayed:
      socket rate limits are keyed per *socket*, and a socket lives on one node
      for its whole life, so a per-socket bucket is already cluster-correct;
      terminal bindings are references to a live PTY, which is an object rather
      than data and cannot be moved anywhere.
- [x] **Decided what a multi-node Yjs deployment looks like** — and it did need
      the real design pass. Two ADRs came out of it. A `Y.Doc` is *state in one
      process*, not a message, so the adapter does not help; two replicas serving
      one document each keep their own copy and the last writer wins whatever the
      other person typed. The answer is **sticky routing plus enforcement**: the
      client appends `?doc=<roomId>:<fileId>` so a balancer can hash on it
      ([ADR-014](./07-adrs.md#adr-014)), and the server takes a Redis lease
      before serving, refusing with `DOCUMENT_MOVED` if another node holds it.
      Content moved to Redis at the same time ([ADR-015](./07-adrs.md#adr-015)),
      because LevelDB's exclusive directory lock meant a document could otherwise
      never move between nodes at all.
- [x] **Metrics** — active rooms, connected sockets, live PTYs, execution
      latency, Yjs document sizes, socket events by outcome, lease conflicts.
      Gauges are *sampled on scrape* rather than incremented by hand, because a
      hand-maintained gauge goes wrong the first time a decrement is missed on an
      error path and a gauge that lies is worse than none. `/metrics` is guarded
      — token, or loopback only ([ADR-016](./07-adrs.md#adr-016)) — and there is
      a Grafana dashboard in `deploy/`.
- [x] **A load test** with published methodology and numbers:
      [09 Load test](./09-load-test.md). One node holds **200 concurrent pairs
      (400 users, 1,600 edits/s) at p50 3.6 ms and p95 13.8 ms with zero lost
      updates**; CPU is linear at roughly 0.8 ms per edit and is the binding
      constraint. Clustering costs about 12% CPU and roughly triples the p99.

**Done when:** ~~two replicas behind a load balancer serve one room correctly,
and there is a dashboard showing it.~~ Met — `deploy/nginx.conf` and
`deploy/docker-compose.cluster.yml` are the working configuration,
`deploy/grafana-dashboard.json` is the dashboard, and
`server/tests/integration/cluster.test.js` runs two real replicas against a real
Redis in CI.

Three things surfaced along the way and were fixed as part of this work.
**`allSockets()` is not cluster-aware** — the Redis adapter overrides
`fetchSockets` and not `allSockets`, so occupancy computed the old way would
have made the two-person cap a cap of two *per replica*; it presents as
"sometimes a third person gets in", which is the kind of bug that never
reproduces locally. **The heartbeat interval was derived from the module default
rather than from the lease TTL in use**, so a router built with a short lease
would not have renewed fast enough — caught by a unit test, not by a person.
And **shutdown had to become ordered**: documents flush and disconnect (both of
which use Redis) before leases are handed back, before sockets close, before the
connection all three needed goes away.

**Deliberately not in scope:** a real two-replica *performance* run (correctness
is tested, but two replicas on one laptop compete for the cores that are the
binding constraint, so the number would be meaningless), a soak test longer than
sixty seconds, and load-testing the terminal or execution paths — the first is a
different resource profile entirely and the second would be measuring Piston.

---

## Phase 5 — the last single-node dependency ✅

**Goal:** replicas on more than one host.

Phase 4 got the *application* onto several processes, and the honest limit was
storage rather than logic. SQLite ([ADR-010](./07-adrs.md#adr-010)) is
single-writer, so replicas shared one file over a volume — which works on one
host and not across hosts.

- [x] **Postgres for identity, rooms, memberships, invites, files, chat, and
      snapshots.** One migration, not seven, exactly as expected: they were
      already one schema in one file. `DATABASE_URL` is the whole switch —
      unset, SQLite, and a contributor still needs no services to run the tests;
      set, Postgres, and `DATABASE_PATH` is ignored
      ([ADR-017](./07-adrs.md#adr-017)). It **fails closed**, like `REDIS_URL`:
      an unreachable database stops startup rather than producing a replica that
      500s every request while looking healthy.

      The schema was the easy half. The hard half was that better-sqlite3 is
      *synchronous* — an argued advantage in ADR-010, because it kept async
      plumbing out of the socket handlers where an authorization check runs on
      every event — and Postgres cannot be. **`db.js` is therefore async on both
      engines**, one shape rather than two, and that rippled through every
      service, both auth middlewares, every route handler, and the socket
      membership guard. The dialect differences that remain are small and
      confined to two driver files: `?` rewritten to `$n`, `COALESCE` for
      `IFNULL`, `lower(x)` for `COLLATE NOCASE`, `bytea` for `BLOB`, counts that
      come back as strings, and a real `seq` column replacing SQLite's `rowid`.
- [x] **Decided whether documents follow: they do not**
      ([ADR-018](./07-adrs.md#adr-018)). Consolidating would collapse two ADRs
      into one and it would put an `INSERT`, a transaction, and an fsync on the
      keystroke path in exchange for removing a dependency a cluster needs
      anyway. Structure in Postgres, content in Yjs-over-Redis — the same split
      [ADR-012](./07-adrs.md#adr-012) already makes between a file's row and its
      bytes.
- [x] **Session affinity that survives a CDN.** `ip_hash` pins every user behind
      one address to one replica and unpins any of them when their address
      changes, which is wrong behind a CDN, a corporate NAT, or a mobile
      carrier. The client now names itself — a random id in `localStorage`, sent
      as `?client=<id>` — and `deploy/nginx.conf` hashes on that, falling back to
      the address when it is absent. It is a routing key and not a credential:
      the JWT still authenticates, so forging it moves the forger to a different
      replica and grants them nothing.
- [ ] **A real two-host load test** — **not delivered.** Phase 5 removed the
      *reason* it was impossible; it could not remove the *requirement*, which is
      two machines and a network between them. What was measured instead is the
      cost of the store change itself on one machine
      ([09 §6](./09-load-test.md#6-what-postgres-costs)): **editor propagation is
      unchanged** — Yjs never touches the relational store, so the path the
      product is judged by does not care which engine is configured — and **chat
      pays about 1.2 ms at the median**, roughly doubling, which is a loopback
      round trip plus a transaction. A database on another host adds its RTT on
      top of that, and will dominate it.

**Done when:** ~~two replicas on different hosts serve one room correctly.~~ Met
for correctness — `deploy/docker-compose.cluster.yml` now runs Postgres beside
Redis, and `server/tests/integration/cluster.test.js` runs two real replicas
against both — but *not* for performance, which is the open item above and the
largest gap in [09](./09-load-test.md).

The verification is the part worth stating. **The whole server suite runs twice
in CI, once per engine, against a real Postgres** — 327 tests each time. A
compatibility layer exercised on only one engine is a compatibility layer nobody
has tested, and the failures it guards against are exactly the ones that pass on
the engine you developed against: a `COUNT(*)` that is a string on one side and
a number on the other, an ordering that silently depends on `rowid`.

Two things surfaced along the way. **A test had a real race that SQLite was
hiding**: it revoked a membership and immediately acted on the room, without
awaiting the revocation — which passed for as long as the driver resolved within
the tick, and failed the first time a store had latency. That is the failure
mode of this whole phase in miniature: a missing `await` is not a crash, it is a
race. And **`withDocument` ran its callback without awaiting it**, which was
harmless while every caller was synchronous and would have persisted the state a
restore was replacing the moment one was not.

**Deliberately not in scope:** a migration path from an existing SQLite file
into Postgres (nobody is running this yet, so that is a script worth writing when
somebody is), read replicas, connection pooling in front of the pool
(PgBouncer), and any change to how documents are stored — see ADR-018.

## Beyond v1 ← next

The infrastructure phases are done. What is left is product, plus the two
operational debts Phase 5 named rather than paid.

- **A two-host load test** and **a SQLite → Postgres migration script** — the
  two open items from Phase 5, both waiting on somebody actually running this
  rather than on a design.
- **The identity system's missing half**: email verification, password reset,
  MFA, and an audit log. Deliberately out of scope since Phase 1 and still the
  most visible gap for anyone deploying this — account recovery is a manual
  database operation.
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
Feature completeness third. That ordering held up as well: the file tree needed
identity to know who owns what and tests to make a change to the editor's state
model survivable, and both were already there. It also *removed* work from Phase
4 rather than adding it — chat and the whiteboard were two of the in-process
maps that phase would have had to relocate, and they are now in SQLite and Yjs
respectively. Scale last — a single node comfortably serves two-person rooms, so
distributing the system before anyone is using it would be premature. That
ordering held up too, and this time there is a number rather than an assertion
behind it: one node carries 200 concurrent pairs at a 13.8 ms p95, which is far
more than the product has ever needed, so the phase really could have waited
longer. What it produced that was worth having anyway is the *visibility* —
and the first thing the new metrics did was find a document leak that had been
present the whole time ([09 §5](./09-load-test.md#5-a-leak-the-metrics-found)).
Phase 3 also removed work from this phase rather than adding it, exactly as
hoped: chat and the whiteboard were two of the in-process maps Phase 4 would
have had to relocate, and only the language selection was left.

Storage last, and that ordering held up best of all — for a reason worth
recording. Phase 5 is the phase that touched the most files and changed the
least behaviour: every service, every route, and both auth middlewares became
async, and a user cannot tell. It was survivable only because Phase 2's tests
were already there to say so — 327 of them now, run against both engines — and
because Phase 3 and Phase 4 had already pushed everything that could leave the
relational store out of it, so what remained to migrate was one schema rather
than a schema plus four in-process maps. Doing this phase first would have meant
paying its cost on a codebase with no tests and twice as much state in the wrong
place.
