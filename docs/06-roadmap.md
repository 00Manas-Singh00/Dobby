# 06 — Roadmap

**Project:** Dobby
**Status:** v0.9. The pairing loop works end to end; the platform underneath it does not yet exist.

---

## Where things stand

The core product is real. Two people can open a room, edit the same file with
live cursors and no lost characters, run the code, use a terminal, draw, chat,
and see each other. That is the whole demo, and it works.

What is missing is everything that turns a working demo into a deployable
service: identity, durability beyond the editor buffer, a second server
instance, and any automated verification at all. Roughly:

| Area | State |
|---|---|
| Collaborative editing | Done |
| Execution, chat, whiteboard, video, terminal | Done |
| Auth & authorization | **Not started** |
| Real file system | **Not started** (explorer is a mock) |
| Durability beyond the editor | **Partial** |
| Horizontal scale | **Not started** |
| Tests & CI | **Not started** |
| Observability | **Not started** |

---

## Phase 1 — Make it safe to deploy

**Goal:** Dobby can be put on a public URL without the deployment itself being
the vulnerability.

- [ ] **Authentication.** Accounts or OAuth, a session token, and a socket
      handshake that verifies it before `join room` is honored. This unblocks
      everything else in this phase and most of Phase 3.
- [ ] **Room ownership.** A room belongs to its creator; joining requires an
      invite or an explicit share. Retire security-by-UUID.
- [ ] **Rate limiting** on `/api/execute` and on socket events — today the
      execute endpoint is an open proxy to Piston.
- [ ] **Validate chat and whiteboard payloads.** Both are relayed verbatim with
      no size cap; add limits and shape checks.
- [ ] **Containerize the terminal.** The current controls — disabled by default,
      membership-gated, scoped `cwd`, scrubbed env — bound the damage but do not
      sandbox the process. A per-room container with CPU, memory, and disk
      limits is the real fix, and the precondition for enabling the terminal on
      a shared host.
- [ ] **A retention policy for `.yjs-persistence`.** Document content currently
      accumulates on disk forever with no delete path.

**Done when:** a deployed instance requires a login, the terminal runs in a
container, and no endpoint is usable by an anonymous caller.

---

## Phase 2 — Establish a safety net

**Goal:** changes stop being verified by hand. This is deliberately early — it
is the phase that makes every later phase cheaper.

- [ ] **Unit tests** for the parts with real logic: terminal session
      binding/detachment, room capacity and TTL cleanup, Piston runtime
      resolution, language mapping.
- [ ] **Integration tests** over the Socket.IO surface: join/leave lifecycle,
      the two-user cap, chat replay, terminal membership rejection.
- [ ] **A two-context Playwright test** for the thing most likely to silently
      break: two browsers typing into one file and converging. The Yjs binding
      has already failed silently once (an editor ref that never re-ran the
      effect); a test would have caught it.
- [ ] **CI on every push** — lint, build, test. `npm test` currently exits 1.
- [ ] **Clear the standing lint errors.** ~30 across the client, mostly unused
      imports and `setState`-in-effect warnings.

**Done when:** CI is green and required, and the convergence E2E test runs on
every pull request.

---

## Phase 3 — Make it a real workspace

**Goal:** close the gap between what the UI promises and what the backend does.

- [ ] **A real file system.** `FileExplorer.jsx` renders a hardcoded tree and
      opening a file creates a placeholder buffer. Back it with per-room
      storage and support create, rename, delete, and folders. This is the
      largest single credibility gap in the product.
- [ ] **Persist chat and whiteboard.** Move both out of process memory. The
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

Security first because the terminal makes an unauthenticated public deployment
genuinely dangerous, and because auth is a precondition for ownership,
persistence, and quotas. Tests second because they are cheapest to add while the
codebase is small and they make Phase 3 survivable. Feature completeness third.
Scale last — a single node comfortably serves two-person rooms, so distributing
the system before anyone is using it would be premature.
