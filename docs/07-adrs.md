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

**Status.** Accepted; revisit alongside the file-system work.

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

**Status.** Accepted for single-node. Reopen with Phase 4, together with
[ADR-007](#adr-007).

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
