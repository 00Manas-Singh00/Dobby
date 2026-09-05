# 07 — Architecture Decision Records

**Project:** Dobby

Each record: **Context → Decision → Consequences → Alternatives rejected → Status.**

---

## ADR-001 — Use Yjs rather than a hand-written CRDT
<a id="adr-001"></a>

**Context.** Collaborative editing needs conflict resolution. The naive approach
Dobby shipped first — broadcast the whole buffer, last write wins — lost
characters and made cursors jump the moment two people typed at once. The real
options were a hand-built sequence CRDT, operational transformation, or an
existing CRDT library.

**Decision.** Use **Yjs**, with `y-socket.io` for transport, `y-monaco` for the
editor binding, and `y-leveldb` for persistence.

**Consequences.**
- (+) Convergence, cursor awareness, reconnect merge, and durable state arrive
  together and work, for roughly fifty lines of integration code.
- (+) The Monaco and Socket.IO bindings are first-party, so Yjs rides the
  connection Dobby already has.
- (+) Engineering budget stays on the differentiator — the integrated pairing
  workspace — rather than on re-deriving a solved algorithm.
- (−) A dependency whose internals we do not control sits on the critical path.
- (−) Deep understanding of sequence-CRDT mechanics lives in Yjs's codebase, not
  ours. If a convergence bug ever surfaces, we are reading someone else's code.
- (−) Yjs's data model shapes ours: reusing the sync machinery for the
  whiteboard means expressing strokes as Yjs types.

**Alternatives rejected.**
- *A hand-written RGA or YATA implementation.* Intellectually the most
  interesting option and the one that best demonstrates distributed-systems
  depth. Rejected because correctness demands property-tested convergence over
  millions of randomized operations before it can be trusted in a product, and
  that budget is better spent on the terminal, execution, and video integration
  that actually distinguish Dobby. This is a genuine trade-off, not a
  no-brainer: a project whose thesis *was* the CRDT should decide the opposite way.
- *Operational transformation.* Needs a correct transform function per operation
  pair and a central ordering authority. More work than Yjs and less capable.
- *Automerge.* Comparable guarantees, but no mature Monaco binding and heavier
  for a text-centric workload.

**Status.** Accepted.

---

## ADR-002 — One Yjs document per file, not per room
<a id="adr-002"></a>

**Context.** `EditorWorkspace` mounts a `CodeEditor` for every open tab. The
first implementation gave every instance a provider named after the room and a
`Y.Text` named `monaco`, so all tabs shared one buffer — every file displayed
identical content.

**Decision.** Scope the Yjs room name to **`${roomId}:${fileId}`**.

**Consequences.**
- (+) Tabs hold distinct documents, which is the only correct behavior.
- (+) LevelDB persists each file independently.
- (+) Awareness scopes to the file, so a remote cursor only appears to someone
  looking at the same file — the behavior users expect from an IDE.
- (−) One provider and one `Y.Doc` per open tab, so N tabs mean N sync channels.
  Acceptable for a handful of files; would need pooling for a large project.
- (−) File identity is now load-bearing. Real file management (Phase 3) must
  keep ids stable across renames or documents will be orphaned.

**Alternatives rejected.**
- *One `Y.Doc` per room with a `Y.Map` of files.* Fewer connections and a
  natural home for room-wide state, and it is probably the right destination
  once a real file system exists. Rejected for now because it needs a subdocument
  or sub-binding layer that `y-monaco` does not provide directly.

**Status.** Accepted; revisited by [ADR-012](#adr-012), which built the file
system on top of this naming rather than replacing it. The `(−)` about file
identity is resolved: `room_files.id` is a uuid that never changes, so a rename
touches only the row and the document keeps its name.

---

## ADR-003 — Socket.IO as the single transport
<a id="adr-003"></a>

**Context.** Dobby carries CRDT updates, presence, chat, whiteboard strokes,
WebRTC signaling, and terminal I/O. These could use separate channels.

**Decision.** One Socket.IO connection carries everything, with Yjs multiplexed
onto it by `y-socket.io`.

**Consequences.**
- (+) One connection to establish, authenticate, and reconnect. Reconnect
  backoff and transport fallback come from Socket.IO.
- (+) Room semantics are built in and shared by every feature.
- (−) Everything shares a failure domain: the socket dropping takes out all
  collaboration at once.
- (−) A high-volume terminal stream competes with editor updates on the same
  connection. Not observed as a problem at two users; would need attention at scale.

**Alternatives rejected.**
- *Raw `ws` with a hand-rolled protocol.* Lighter, but reconnection, fallback,
  and rooms would all have to be rebuilt.
- *A separate WebSocket for Yjs (`y-websocket`).* Isolates editor traffic, but
  doubles the connections to authenticate and keep alive.

**Status.** Accepted.

---

## ADR-004 — Remote sandboxed execution via Piston
<a id="adr-004"></a>

**Context.** The Run button executes arbitrary user code. Running that on the
application host is the classic way to hand strangers a shell.

**Decision.** Proxy execution to the public **Piston** API.

**Consequences.**
- (+) Untrusted code never runs on Dobby infrastructure.
- (+) ~40 languages, with sandboxing and timeouts maintained by someone else.
- (−) User code leaves our infrastructure — a real privacy consideration worth
  surfacing in the UI.
- (−) An availability dependency on a free public service, with its rate limits.
- (−) No control over the runtime: no custom packages, no persistent files
  between runs.

**Alternatives rejected.**
- *Local Docker-per-execution.* Full control, no third party, but it makes
  container orchestration and resource limiting a core concern of the project.
- *Executing in the existing PTY.* Trivially unsafe and conflates two features
  with different threat models.

**Status.** Accepted. Self-hosting Piston is the natural upgrade if the
dependency becomes a problem.

---

## ADR-005 — The terminal is opt-in and confined, not sandboxed
<a id="adr-005"></a>

**Context.** The integrated terminal spawns a real shell via `node-pty`. On a
system with no authentication, that is remote code execution offered to anyone
holding a room URL. It originally ran with `cwd` at the server user's `$HOME`
and inherited the full `process.env`.

**Decision.** Keep the terminal — it is a genuine differentiator — but gate it
behind `ENABLE_TERMINAL` (default **false**), require verified room membership,
derive the session identity from server-side records rather than the client's
message, confine each session to a scratch directory under
`TERMINAL_WORKSPACE_ROOT`, and pass only an allowlisted environment.

**Consequences.**
- (+) The feature cannot be reached by accident, by a stale client, or by a
  socket that never joined the room.
- (+) A terminal user can no longer read the server's environment (which carries
  its configuration and any credentials) or its home directory.
- (+) A client cannot attach to another user's shell by claiming their username.
- (−) The terminal is off by default, so the flagship feature needs a
  deliberate configuration step to demo.
- (−) **This is confinement, not isolation.** The process can still read what
  the server user can read, open sockets, and burn CPU and disk. Anyone reading
  this should not mistake these controls for a sandbox.

**Alternatives rejected.**
- *Remove the terminal.* Safest, but it is a large part of why Dobby is more
  than a shared editor.
- *Per-room containers now.* The correct end state, recorded in
  [06 Roadmap](./06-roadmap.md) Phase 1. Deferred because it introduces
  container orchestration before authentication exists — and without auth, a
  sandboxed terminal is still an unauthenticated one.
- *A command allowlist.* Trivially bypassed by any shell, and it would break the
  interactive use (`vim`, REPLs) that justifies a PTY.

**Status.** **Superseded by [ADR-011](#adr-011)**, which replaces confinement
with a per-session container. The membership gate, server-derived session
identity, and `ENABLE_TERMINAL` switch from this decision all still stand; only
the "not sandboxed" position is superseded.

---

## ADR-006 — Two participants per room
<a id="adr-006"></a>

**Context.** `join room` rejects a third socket. This could be a limitation or a
product decision.

**Decision.** Treat it as a **product decision**. Dobby is a pairing tool.

**Consequences.**
- (+) A full WebRTC mesh is trivially correct at two peers; no SFU needed.
- (+) One shared terminal session per user is comprehensible. With five people
  in one shell it would not be.
- (+) Presence UI stays simple — no avatar overflow, no participant management.
- (−) Excludes mob programming and classroom use outright.
- (−) The cap is enforced in one place in `index.js` with no override, so even a
  three-person demo is impossible without a code change.

**Alternatives rejected.**
- *Unbounded rooms.* Video degrades quadratically without an SFU, and a shared
  PTY becomes unusable.
- *A configurable cap.* Sounds harmless, but the value only means anything if
  video and the terminal are designed for the larger number — otherwise it
  exposes broken states.

**Status.** Accepted. Revisiting means committing to an SFU and per-user terminals.

---

## ADR-007 — LevelDB for document persistence
<a id="adr-007"></a>

**Context.** Yjs documents need to survive restarts. `y-leveldb`, `y-redis`, and
custom database backends all exist.

**Decision.** `y-leveldb`, writing to `server/.yjs-persistence`.

**Consequences.**
- (+) Zero operational surface — no service to run, no schema, no migration.
- (+) The natively supported path; `YSocketIO` takes a
  `levelPersistenceDir` option directly.
- (−) Embedded, so it binds document state to one process and one filesystem.
  This is a concrete blocker for horizontal scale, not a theoretical one.
- (−) No query surface: listing rooms or reporting per-document size means
  walking the store.
- (−) Grows without bound. There is no retention policy and no delete path.

**Alternatives rejected.**
- *In-memory only.* Loses every document on restart.
- *`y-redis` or Postgres.* Either would decouple state from the process and is
  the right answer once scale matters — deferred as premature for a single node.

**Status.** Accepted for single-node. Reopen with [06 Roadmap](./06-roadmap.md) Phase 4.

---

## ADR-008 — Modules stay mounted; visibility is toggled
<a id="adr-008"></a>

**Context.** The workspace switches between editor, video, whiteboard, and chat.
Unmounting the inactive one is the conventional React approach.

**Decision.** Mount all four permanently and have `WorkspaceContainer` toggle
visibility with CSS.

**Consequences.**
- (+) A video call survives switching to the whiteboard — unmounting would tear
  down the peer connection and the media stream.
- (+) Canvas contents and terminal scrollback survive module switches, neither of
  which is persisted anywhere and both of which would otherwise be destroyed.
- (+) Switching modules is instant; no remount cost.
- (−) Every module's effects and subscriptions run for the whole session, so all
  four are always consuming resources.
- (−) Hidden Monaco instances need `automaticLayout` to size correctly when
  revealed, and a hidden canvas has no usable dimensions until shown.

**Alternatives rejected.**
- *Conditional rendering.* Simpler and more idiomatic, but it drops the video
  call and the whiteboard on every switch — a visible product regression.
- *Portal the video out and unmount the rest.* Fixes the worst case, still loses
  canvas and terminal state.

**Status.** Accepted.

---

## ADR-009 — Email/password accounts with JWT, not OAuth
<a id="adr-009"></a>

**Context.** Phase 1 needed identity before anything else could be gated on it.
The realistic options were a third-party provider (GitHub OAuth is the obvious
fit for a developer tool) or self-contained accounts.

**Decision.** Email and password, bcrypt-hashed at cost 12, with a 15-minute JWT
access token and a 30-day rotating refresh token stored hashed in SQLite.

**Consequences.**
- (+) No third-party registration, client secret, or callback route, so the auth
  path can be exercised end to end in development and in tests — which matters
  because Phase 2 has to test exactly this.
- (+) Access tokens verify statelessly, which is what makes it cheap to check
  them on every socket handshake and every Yjs namespace connection.
- (+) Refresh tokens stay revocable, so a session can be ended server-side —
  the property a pure-JWT scheme gives up.
- (−) Dobby now stores passwords, which is a liability OAuth avoids entirely.
- (−) No email verification, password reset, or MFA. Account recovery is a
  manual database operation. This is the largest known gap in the identity
  system and it is deliberate scope, not an oversight.
- (−) Tokens live in `localStorage` and are therefore readable by any script on
  the page. Acceptable while no user content is rendered as HTML; `HttpOnly`
  cookies would trade this for CSRF handling.

**Alternatives rejected.**
- *GitHub OAuth.* Better security properties and a natural fit for the audience,
  but it cannot be run without real credentials, which would leave the auth path
  untestable at exactly the moment tests are the next phase. A good later
  addition alongside passwords rather than instead of them.
- *Sessions in a cookie with server-side storage.* Simpler to reason about, but
  every socket and Yjs namespace connection would need a store lookup, and the
  cross-origin client/server split makes cookies awkward.

**Status.** Accepted. Adding OAuth as a second provider is compatible with this.

---

## ADR-010 — SQLite for identity, alongside LevelDB for documents
<a id="adr-010"></a>

**Context.** Accounts, rooms, memberships, and invites need durable, queryable,
relational storage. Dobby already had LevelDB, but a key-value store is a poor
fit for "which rooms is this user a member of".

**Decision.** SQLite via `better-sqlite3`, in `server/.data/`, holding users,
rooms, memberships, invites, and hashed refresh tokens. Yjs document state stays
in LevelDB.

**Consequences.**
- (+) Zero operational surface, matching the reason LevelDB was chosen
  ([ADR-007](#adr-007)): no service to run, one file to back up.
- (+) The synchronous API needs no connection pooling and no async plumbing
  through the socket handlers, where authorization checks happen on every event.
- (+) Foreign keys and transactions make "a room and its owner membership appear
  together" enforceable rather than conventional.
- (−) Two stores with different shapes and different delete paths, which is why
  room deletion has to coordinate across both — and why the retention sweep
  deletes documents before the room row, so a crash leaves a retry rather than
  an orphan.
- (−) Single-writer, so this is one more thing Phase 4 has to replace.
- (−) A native module, so the server no longer installs cleanly on a host
  without build tools.

**Alternatives rejected.**
- *Postgres.* Production-shaped, and needed eventually for Phase 4. Rejected for
  now because it adds a service dependency to local development before anything
  requires it.
- *Reuse LevelDB.* Would avoid a second store, but membership queries would
  become manual index maintenance — precisely the work a relational engine does
  correctly.

**Status.** Superseded in scope by [ADR-017](#adr-017), which makes Postgres an
option chosen by `DATABASE_URL`. This decision stands unchanged as the reasoning
for the default: with that variable unset, everything here is still what runs.

---

## ADR-011 — The terminal runs in a container, and fails closed
<a id="adr-011"></a>

**Context.** [ADR-005](#adr-005) recorded confinement — a scratch `cwd` and an
allowlisted environment — as an interim position, and said to supersede it once
containers landed. With authentication in place, the objection that "a sandboxed
terminal is still an unauthenticated one" no longer applies.

**Decision.** Each session's PTY is a `docker run` process rather than a shell:
`--cpus 0.5`, `--memory 256m` with a matching `--memory-swap`, `--pids-limit
128`, `--network none`, `--cap-drop=ALL`, `--security-opt no-new-privileges`,
`--user 1000:1000`, `--read-only`, with a `noexec` tmpfs at `/tmp` and the
per-session workspace bind-mounted at `/workspace`. If Docker is unreachable,
terminal creation **fails**.

**Consequences.**
- (+) node-pty still owns a real TTY, so `vim`, colors, and interactive prompts
  work exactly as before — the property that justified a PTY in the first place.
- (+) A `while true` loop or a fork bomb now costs half a CPU and 128 processes
  rather than the host.
- (+) `--network none` means a shell cannot scan the internal network or
  exfiltrate what it reads, which is the control that most changes the threat
  model.
- (−) Docker becomes a deployment dependency for the terminal.
- (−) Container startup adds latency to opening a terminal that spawning a shell
  did not have.
- (−) Still not a hard boundary: no seccomp profile beyond Docker's default and
  no user-namespace remapping, so a container escape is a container escape.

**Alternatives rejected.**
- *Silently fall back to a host shell when Docker is missing.* Rejected firmly:
  that turns an infrastructure problem into an unsandboxed shell handed to
  whoever is in the room. Failing closed makes the degraded state visible.
  `TERMINAL_ISOLATION=host` remains available as an explicit, logged choice for
  local development.
- *gVisor or Firecracker.* Stronger isolation, but a much heavier operational
  dependency than a project at this stage can justify.
- *One container per room rather than per session.* Simpler lifecycle, but the
  two occupants would share a filesystem and a process table, and terminal
  sessions are already keyed per user so that a refresh reattaches.

**Status.** Accepted. Supersedes the sandboxing position of [ADR-005](#adr-005).


## ADR-012 — The file tree is SQLite structure over Yjs content

**Status:** Accepted · Phase 3

**Context.** The explorer rendered a hardcoded tree and opening a "file" made a
placeholder buffer, so files could be edited and shared but not created,
renamed, or deleted. Backing it with something real raises an immediate
question: where do a file's *bytes* live? The obvious answer — a `content`
column, written as people type — is wrong for a product whose entire editing
model is a CRDT, because it would make SQLite a second, conflicting record of
something Yjs already owns, and every keystroke a write.

**Decision.** Split the two. A `room_files` row holds **structure only** — id,
name, type, parent — and a file's content is the Yjs document
`<roomId>:<fileId>`, which is exactly the naming [ADR-002](#adr-002) already
used. `documentNameFor(roomId, fileId)` is the single place the convention is
written down.

Hierarchy is an adjacency list with `NULL` parent meaning root, and names are
validated as a **single path segment**: separators, control characters, and
`.`/`..` are rejected.

**Consequences.**
- (+) Nothing is written to SQLite on a keystroke. Create, rename, move, and
  delete are the only writes, and they are rare.
- (+) The CRDT keeps sole ownership of content, so there is no path by which the
  two stores can disagree about what a file contains.
- (+) A rename is a row update. The document name is built from the id, which
  never changes, so content cannot be orphaned by renaming — the open `(−)` on
  ADR-002.
- (+) Rejecting separators keeps `parent_id` the *only* expression of hierarchy.
  A name like `../secrets` would otherwise be a second, contradictory one, and
  the two would eventually disagree.
- (−) Deleting is two operations in two stores. They are ordered row-then-content
  so a failure leaves an orphaned document for the retention sweep, rather than a
  file in the tree whose contents have been erased — but the window exists.
- (−) Uniqueness among siblings needs an expression index on
  `(room_id, IFNULL(parent_id, ''), name)`, because SQLite treats NULLs as
  distinct and a plain constraint would permit duplicate names at the root.
- (−) The tree is not a CRDT. Two people renaming one file simultaneously means
  the second request fails rather than merging.

**Alternatives rejected.**
- *Content in a SQLite column.* A second writer for something Yjs owns, and a
  write per keystroke. This is the failure mode the project already removed once,
  as the `roomID_to_Code_Map` last-write-wins path.
- *A real filesystem directory per room.* Would make names into paths and revive
  every traversal question, and there is no reason for content to be a file on
  disk when it is already a CRDT document.
- *The tree itself as a `Y.Map` in a room document.* Genuinely attractive: moves
  and renames would merge. Rejected because authorization, the uniqueness
  constraint, and the retention cascade all already live in SQL, and
  re-implementing them over a CRDT is a large amount of work to make a rare
  conflict slightly nicer.

---

## ADR-013 — Whiteboard strokes are a Y.Array, not a relayed event

**Status:** Accepted · Phase 3 · Supersedes the whiteboard transport in
[ADR-003](#adr-003)

**Context.** Strokes were `draw` events broadcast to the room and stored
nowhere. The consequences were exactly proportional to that: a person joining
mid-session saw a blank canvas, a refresh lost the board, and a clear was a
separate message that could race a stroke. The failure was also invisible to the
person drawing — their own canvas looked perfect.

**Decision.** Model the board as a `Y.Array` of stroke segments inside a second
document per room, `<roomId>:__whiteboard__`, and delete the socket relay along
with its schemas and rate-limit buckets.

**Consequences.**
- (+) Replay to a late joiner, persistence across restarts, and offline drawing
  all arrive for free — they are properties of the sync machinery the editor
  already uses, not new protocol.
- (+) A clear becomes `delete(0, length)` on the array, which **converges**. A
  stroke drawn concurrently with a clear either survives or does not,
  consistently on both sides; a "clear" event racing a "draw" event leaves the
  two peers disagreeing.
- (+) One code path puts ink on the canvas. The local user's strokes are
  appended and painted by the observer like anyone else's, so the local and
  remote renderings cannot drift.
- (+) The canvas becomes a *rendering* of the array rather than the record, which
  is what makes a resize correct — repaint from the array instead of copying
  pixels.
- (−) A board is now unbounded and persisted: a long session accumulates
  segments in LevelDB with only Yjs's own GC to contain it. There is no stroke
  count cap.
- (−) The whiteboard no longer passes through the socket payload validator. It is
  bounded by `maxHttpBufferSize` and the namespace membership check instead,
  which is a weaker statement about shape.
- (−) Two documents per room instead of one plus N files. Minor, but the
  `__whiteboard__` id is now reserved and a file can never be given that name.

**Alternatives rejected.**
- *Keep the relay and persist strokes to SQLite alongside it.* Two sync paths for
  one surface, and the merge semantics of a clear would still be undefined. The
  project already removed one such path for code.
- *A `Y.Map` keyed by stroke id.* No ordering, and stroke order matters for
  overlapping ink.
- *Store a canvas bitmap.* Cheap to replay, impossible to merge — two people
  drawing at once would overwrite each other's images wholesale.

---

## ADR-014 — Documents are routed to one node, not replicated
<a id="adr-014"></a>

**Context.** Phase 4 needs more than one replica. The Socket.IO Redis adapter
makes that straightforward for most of the surface: chat, the client list, file
tree notifications, and WebRTC signalling are all *messages*, and the adapter
relays them between replicas so a room can span nodes.

Yjs is not like that. `YSocketIO` holds a live `Y.Doc` in the process serving it
and writes it to that process's persistence. If two replicas each serve the same
document, each applies only the updates its own clients sent, each persists its
own state, and the two diverge — the last writer wins whatever the other person
typed. This is not a delivery problem, so relaying harder does not fix it. A
document is **state**, and state has to live in one place or be merged
deliberately.

**Decision.** Exactly one node serves a document at a time, enforced in two
layers.

1. *Routing.* The client appends `?doc=<roomId>:<fileId>` to its Yjs connection
   URL, and the load balancer hashes on it (`hash $arg_doc consistent`). Every
   client of one document therefore lands on one replica without the proxy
   parsing Socket.IO frames. The parameter is a **hint only** — authorization
   and ownership are both taken from the namespace the client actually connected
   to, so a forged value misroutes the liar and grants nothing.
2. *Enforcement.* Before serving a document, a node takes a lease on it in Redis
   (`SET <doc> <nodeId> NX PX 30000`), renewed every 10 seconds. A node that
   finds the lease held elsewhere refuses the handshake with `DOCUMENT_MOVED`
   and names the owner; the client retries with backoff.

**Consequences.**
- (+) Divergence becomes impossible rather than unlikely. A misconfigured
  balancer produces a visible, retried connection error instead of two people
  silently losing each other's work — and the damage from the silent version
  outlives the misconfiguration, while the loud one does not.
- (+) The failure is diagnosable from the browser console and alertable from the
  server: `dobby_document_lease_conflicts_total` is flat at zero in a correct
  deployment, so any sustained increase names the problem precisely.
- (+) A crashed node's documents are recoverable after one lease TTL rather than
  needing an operator, because the lease expires rather than being held.
- (+) The single-writer guarantee is reused: it is what makes update compaction
  in [ADR-015](#adr-015) safe without a second lock.
- (−) A document is unavailable for up to one lease TTL after its owner dies
  ungracefully. A clean shutdown releases immediately, so this is the crash case
  only.
- (−) Two mechanisms have to agree. The balancer's hash and the lease are
  independent, and the lease is what makes disagreement safe rather than what
  prevents it.
- (−) Documents are not load-balanced by size or activity. A hot document is one
  node's problem, and consistent hashing does not know that.
- (−) The client needs retry logic it did not need before, because Socket.IO
  does not retry a middleware rejection on its own.

**Alternatives rejected.**
- *Sticky sessions only, with no lease.* One configuration mistake, one rescale,
  or one stale upstream list produces silent divergence. The whole point is that
  a routing rule is not a correctness guarantee.
- *A shared-backend provider (`y-redis`) with every node serving every
  document.* This is the architecturally cleaner answer and probably the
  long-term one. Rejected for now because it replaces `y-socket.io` outright —
  a new client provider, a new server, and a rewrite of the membership gate that
  Phase 1 built — which is a larger change than Phase 4 needs to make.
- *Hash on the room instead of the document.* Simpler for the balancer, and
  keeps a room's files together. Rejected because the room id is not in the URL
  either, so it saves nothing, and it makes one room's files unable to spread
  across nodes for no benefit at two users per room.
- *A dedicated document service.* Correct at a much larger scale; premature at
  this one, and it would need the same lease anyway.

**Status.** Accepted. Reopen if a single document ever outgrows one node, which
is when the `y-redis` answer starts paying for itself.

---

## ADR-015 — Yjs documents live in Redis when clustered, LevelDB when not
<a id="adr-015"></a>

**Context.** [ADR-007](#adr-007) chose `y-leveldb` and named its one real cost:
LevelDB is embedded and takes an exclusive lock on its directory, so document
state is bound to one process and one filesystem. That cost came due in Phase 4.
Pointing two replicas at one directory does not work — the second cannot open it
— so [ADR-014](#adr-014)'s lease on its own would pin every document to whichever
node opened it first, permanently, and a node's death would take its documents
with it.

**Decision.** Keep LevelDB for single-node deployments. When `REDIS_URL` is set,
store documents in Redis instead: an append-only list of updates per document,
merged into one entry once it passes a threshold, with the document names in a
set so retention can still enumerate them.

**Consequences.**
- (+) A document can actually move. Releasing a lease and re-claiming it on
  another node loads the same state, which is what makes a rescale or a node
  failure survivable rather than merely detectable.
- (+) Appending needs no read. Yjs updates are commutative and idempotent, so a
  write is one `RPUSH` and a load is "apply everything in any order".
- (+) Compaction needs no lock. The lease already makes the owning node the only
  writer, so read-merge-replace — normally a race — is safe here. The two
  mechanisms pay for each other.
- (+) Setting `.persistence` also makes `y-socket.io` destroy a document when its
  last connection closes. With no persistence configured it holds every document
  in memory forever, which on a long-lived replica is a leak.
- (−) Redis is now a database, not a cache. It must be run with persistence on
  and `maxmemory-policy noeviction`; an eviction is data loss.
- (−) Updates are base64-encoded, costing about a third in size, because the
  client is shared with the adapter and the state store and is in text mode.
- (−) Two storage backends to keep working, and the tests have to cover both.
- (−) A document's history between compactions is a list whose length depends on
  typing speed. The threshold is a tuning knob with no obviously right value.

**Alternatives rejected.**
- *A shared filesystem (NFS/EFS) with LevelDB.* Does not work at all — the
  exclusive lock is the whole problem, not a performance concern.
- *Postgres for documents.* Would consolidate stores and is where SQLite is
  heading anyway ([ADR-010](#adr-010)). Rejected because Redis was already being
  added for the adapter, and adding one dependency is cheaper than two.
- *`y-redis`.* The purpose-built answer, and rejected for the same reason as in
  [ADR-014](#adr-014): it replaces the transport rather than the storage.
- *Snapshot handoff — flush to SQLite on release, load on claim.* Reuses an
  existing store, but SQLite is single-writer and shared over a volume, so it
  moves the bottleneck rather than removing it.

**Status.** Accepted. The question it left open — whether documents should
follow identity into Postgres — was decided in [ADR-018](#adr-018): they do not.

---

## ADR-016 — Metrics are sampled on scrape, and `/metrics` is not public
<a id="adr-016"></a>

**Context.** Before Phase 4 the only visibility into a running instance was
`console.log`. There was no way to answer how many rooms were live, whether
documents were growing without bound, how long an execution really took, or how
often a client was being rate-limited — and the load test needed all four.

**Decision.** Prometheus via `prom-client`, on a `/metrics` endpoint separate
from `/health`. Counters and histograms are recorded where the event happens;
**gauges are sampled from collector callbacks at scrape time** rather than
incremented and decremented by hand. The endpoint requires a bearer token when
`METRICS_TOKEN` is set, and otherwise accepts loopback callers only.

**Consequences.**
- (+) A sampled gauge cannot drift. A hand-maintained counter goes wrong the
  first time a decrement is missed on an error path — a terminal killed by its
  memory cap, a socket dropped mid-handler — and a gauge that lies is worse than
  no gauge, because it is believed.
- (+) Socket events are counted by *outcome* (`ok`, `rate_limited`, `invalid`,
  `denied`, `failed`). A client hitting its quota, a malformed payload, and a
  revoked membership are three different incidents that a single error count
  makes indistinguishable.
- (+) The default is closed to the network. Metrics are an inventory of the
  instance, and a fail-open default would publish it from the first deployment
  that forgot a variable.
- (+) `/health` stayed a bare liveness check. Adding the node id to it was
  tempting for debugging a balancer and was rejected: it is the one anonymous
  endpoint, and it should not become a way to enumerate the fleet.
- (−) `dobby_yjs_document_bytes` encodes every open document on each scrape,
  which is O(document size) work on a timer. Yjs exposes no cheaper size, and
  the alternative is not measuring the growth the roadmap called out as
  unmeasured.
- (−) A scraper is authenticated by a shared secret rather than by an account, so
  the token is one more thing to rotate.
- (−) Every value is per process. In a cluster, Prometheus must scrape each
  replica directly and sum — which is why the node id is a label on every
  sample, and why the reference nginx config refuses to proxy `/metrics`.

**Alternatives rejected.**
- *Requiring a normal user account.* Puts a long-lived password in a Prometheus
  config, and a scraper is not a user.
- *Leaving `/metrics` open like `/health`.* Room counts, socket counts, and
  document sizes are an inventory of who is using the instance and how.
- *OpenTelemetry.* More capable, and the right choice once there is tracing to
  do. A single counter-and-gauge exporter did not justify the collector.
- *Hand-maintained gauges.* Faster to scrape, and wrong within a week.

**Status.** Accepted.

---

## ADR-017 — Postgres for identity, chosen by `DATABASE_URL`
<a id="adr-017"></a>

**Context.** [ADR-010](#adr-010) chose SQLite and named the cost it would come
to: *single-writer, so this is one more thing a later phase has to replace.*
Phase 4 moved the application onto several processes and left storage as the
only thing pinning them together — replicas share one SQLite file over a volume,
which works on one host and cannot work across hosts. `deploy/nginx.conf` can
put a request on any replica; the store decides they must all be on the same
machine.

The awkward part is not the schema. It is that better-sqlite3 is **synchronous**,
and that was an argued advantage in ADR-010: no async plumbing through the socket
handlers, where an authorization check runs on every event. Postgres is a network
round trip and cannot be anything but async.

**Decision.** One store interface, two drivers, selected by a single
environment variable.

- **`DATABASE_URL` unset** — SQLite, as before. Local development needs no
  services, and a single-host deployment keeps a single file to back up.
- **`DATABASE_URL` set** — Postgres. `DATABASE_PATH` is ignored. Startup fails
  if it is unreachable.

`db.js` is the interface: `get`, `all`, `run`, `tx`, `count`. It is **async on
both engines** — one shape for callers to get right rather than two — which
means every service that touches storage became async, and with it the socket
guards, the route handlers, and the two auth middlewares. The dialect-specific
spellings live in `db/postgres.js` and `db/sqlite.js`, and the schema is
generated for both from one definition in `db/schema.js`.

Portability is the caller's obligation: `?` placeholders (rewritten to `$n`),
ISO-8601 strings rather than a timestamp type, `COALESCE` rather than `IFNULL`,
`lower(x)` rather than `COLLATE NOCASE`, and an explicit `seq` column rather
than SQLite's `rowid`.

**Consequences.**
- (+) Replicas can be on different hosts. That was the entire objective, and it
  is the last thing that was preventing it.
- (+) Nothing changes for a single-node deployment or for a contributor. The
  default path is the one that needs no services running.
- (+) **The whole suite runs on both engines in CI**, against a real Postgres
  rather than a stub. A compatibility layer exercised on one engine is a
  compatibility layer nobody has tested, and the failures being guarded against
  — a bigint count compared with `===`, a `rowid` that does not exist — are
  exactly the kind that pass on the engine you developed against.
- (+) `seq` is a real column now, so "which message came first within the same
  millisecond" no longer depends on an implementation detail of one engine.
- (−) Async reached everywhere. Roughly two hundred call sites, and the failure
  mode of a missed `await` is not a crash but a race — one surfaced immediately
  in a test that revoked a membership and then acted on it, which passed on
  SQLite because its driver resolves within the tick.
- (−) Two engines to keep working, and CI takes twice as long on the server job.
- (−) A running Postgres is now the *deployment* prerequisite it was not before,
  even though it is still not a *development* one.
- (−) A pre-Phase-5 SQLite file needs migrating — `db/sqlite.js` rebuilds the two
  tables that gained `seq` — and there is no migration path from an existing
  SQLite file *into* Postgres. Nobody is running this yet, so that is a script
  worth writing when somebody is, not before.

**Alternatives rejected.**
- *Postgres only, dropping SQLite.* Simpler — one engine, no abstraction, no
  portable-SQL rule. Rejected because it makes `git clone && npm install && npm
  test` require a database, and the single-node deployment that ADR-010 was
  right about does not stop being right.
- *An ORM or query builder (Prisma, Knex, Drizzle).* Would supply the dialect
  handling this file now describes by hand. Rejected because the differences
  amounted to about forty lines, and the schema, the indexes, and the two
  keep-the-newest-N deletes are the part of this system worth reading — a
  builder would hide them behind a fluent API.
- *libSQL/Turso, or Postgres-compatible SQLite.* Keeps the synchronous API and
  distributes the store. Rejected as a bet on a much smaller ecosystem for the
  one component whose failure loses accounts.
- *Keeping SQLite and replicating it (Litestream, LiteFS).* Genuinely good for
  read-heavy single-writer workloads. Rejected because Dobby's writes come from
  every replica — a membership change, a chat message, a snapshot — and a
  single-writer topology would need every replica to forward writes to one node,
  which is a database with extra steps.

**Status.** Accepted. Supersedes the "accepted for single-node" scope of
[ADR-010](#adr-010), which stands unchanged as the reasoning for the default.

---

## ADR-018 — Documents stay in Redis; they do not follow identity to Postgres
<a id="adr-018"></a>

**Context.** [ADR-015](#adr-015) put Yjs document content in Redis when
clustered, and closed by saying it would be superseded if documents ever moved to
Postgres alongside identity. [ADR-017](#adr-017) has now moved identity, so the
question is due: consolidate onto one store, or keep two.

**Decision.** Documents stay in Redis. Structure in Postgres, content in Redis,
exactly as [ADR-012](#adr-012) already splits structure from content.

**Consequences.**
- (+) The append stays cheap. A document is a list of Yjs updates and a write is
  one `RPUSH` with no read — that is the operation on the keystroke path, and it
  is the reason this store was chosen. In Postgres it becomes an `INSERT` with a
  transaction, a WAL write, and a fsync per update, on the one path that is
  latency-critical.
- (+) Compaction stays safe for free. Read-merge-replace is normally a race; the
  document lease already makes the owning node the only writer, so it is not one
  here. That argument does not change with the store, but neither does it
  improve.
- (+) Redis is already required for a cluster — the adapter and the leases need
  it — so keeping documents there adds no dependency. Moving them to Postgres
  would not remove one.
- (−) Two stores in a clustered deployment, with two backup stories and two
  failure modes, which is precisely what consolidating would have fixed.
- (−) [ADR-015](#adr-015)'s costs all stand: Redis must be run as a database
  with `noeviction`, and updates are base64 in a text-mode client.
- (−) A room's data is now split across three places when you count LevelDB's
  absence: Postgres rows, Redis lists, and nothing else — so a full export is a
  join across two systems rather than a file copy.

**Alternatives rejected.**
- *Documents in Postgres, one row per update.* The consolidation this ADR is
  deciding against. Rejected on the write path: an fsync per keystroke-batch, on
  the operation the product is fastest at today (docs/09 measures 0.8 ms of CPU
  per edit end to end), to remove an operational dependency that a cluster needs
  regardless.
- *Documents in Postgres as one `bytea` blob per document, rewritten on
  compaction.* Cheaper writes than a row per update, but every write becomes
  read-modify-write of the whole document, which is the pattern Yjs's additive
  updates exist to avoid.
- *Postgres `LISTEN/NOTIFY` to replace the Redis adapter as well, consolidating
  everything.* The only version of this that actually removes a dependency.
  Rejected because it replaces a purpose-built, tested Socket.IO adapter with a
  hand-rolled one, and because `NOTIFY` payloads are capped at 8000 bytes —
  which a Yjs update can exceed.

**Status.** Accepted. Supersedes the closing note of [ADR-015](#adr-015): that
decision stands rather than being collapsed.
