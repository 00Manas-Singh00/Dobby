# 03 — Real-Time Sync

**Project:** Dobby
**Scope:** how collaborative editing actually works, and where the seams are.

---

## 1. The problem, briefly

Two people typing in one buffer over a network cannot be handled by sending the
document back and forth. If A sends the whole file while B is mid-word, B's
keystrokes vanish and B's cursor jumps. Sending diffs by character index is no
better: an index is not a stable identity, so "insert at 5" means different
things on two replicas that have diverged by a single character.

The fix is to give every character a **stable, globally unique identity** and
express edits relative to those identities rather than to positions. Do that,
and concurrent operations commute — order of arrival stops mattering, and every
replica converges on the same result without a central arbiter. That is a CRDT.

Dobby's first implementation did the naive thing (`update code` broadcasting the
full buffer, last write wins) and exhibited exactly the predicted symptoms. It
was replaced with Yjs.

## 2. Why Yjs rather than a hand-rolled CRDT

Writing a correct sequence CRDT is a research-adjacent exercise: the algorithm
is publishable, the edge cases (concurrent inserts at a shared anchor,
insert-after-a-concurrently-deleted-anchor, interleaving of concurrent
multi-character runs) are subtle, and the only credible proof of correctness is
millions of randomized convergence tests.

Dobby's differentiator is not the CRDT. It is the integrated pairing workspace —
editor plus terminal plus execution plus video in one room. Spending the
project's engineering budget re-deriving YATA would trade the thing that makes
Dobby interesting for a worse version of a solved problem. Yjs is battle-tested,
has a first-class Monaco binding and a Socket.IO provider, and gives us
awareness and persistence for free. Recorded as [ADR-001](./07-adrs.md#adr-001).

The cost of this decision is honest and worth stating: we inherit a dependency
whose internals we do not control, and the deep understanding of sequence-CRDT
mechanics lives in Yjs's codebase rather than ours.

## 3. How it is wired

```
Monaco model
     ▲  ▼        y-monaco MonacoBinding
   Y.Text  ("monaco" key inside the Y.Doc)
     ▲  ▼
   Y.Doc  ──── y-socket.io SocketIOProvider ────► server YSocketIO ──► LevelDB
     ▲  ▼               │                              ▲
     │                  │                    membership check on the namespace
  IndexeddbPersistence  │
  (local replica)  awareness (cursors, names, colors) — ephemeral, never stored
```

All of this is set up in
[`client/src/hooks/useYjsEditor.js`](../client/src/hooks/useYjsEditor.js). Its
sibling
[`useYjsWhiteboard.js`](../client/src/hooks/useYjsWhiteboard.js) does the same
for the board's `Y.Array`. Those two hooks are the only places in the client
that touch Yjs directly.

### 3.1 One document per file

The provider's room name is **`${roomId}:${fileId}`**, not `roomId`. This
matters: `EditorWorkspace` mounts one `CodeEditor` per open tab, so a
room-scoped name would give every tab the same `Y.Text` and every file would
show identical content. Room-plus-file scoping also means LevelDB persists each
file separately, and awareness naturally scopes cursors to the file the other
person is actually looking at.

The `fileId` is now a real thing: a row in `room_files`. The file tree and the
document store agree on this name and nothing else connects them — the tree
knows what a file is called, the CRDT knows what is in it, and
`documentNameFor(roomId, fileId)` is the one place the convention is written
down. Deleting a file is therefore two deletes, and they happen in that order
(row, then document) so a failure leaves an orphaned document for the retention
sweep rather than a file in the tree whose contents have been erased.

The whiteboard uses the same scheme with a reserved id:
**`${roomId}:__whiteboard__`**. It is not a row in the tree, so it cannot
collide with a real file and does not appear in the explorer.

### 3.1b Document namespaces are authorized separately

This is the non-obvious part of the wiring. `y-socket.io` does not share the
main Socket.IO connection: it opens a **dynamic namespace** per document, named
`/yjs|<roomId>:<fileId>`. Namespace connections do not pass through the server's
main connection middleware, so the handshake authentication on `io.use(...)`
does not apply to them. Left alone, an authenticated user could open any room's
document simply by naming its namespace — the id is all the addressing there is.

`yjsService` therefore registers its own middleware on the parent namespace
after `initialize()`. Socket.IO copies a parent namespace's middleware onto each
child as the child is created, which is what makes one registration cover
documents that do not exist yet. The check verifies the access token — the
provider passes it as `auth: { token }` — and then confirms room membership,
taking the room id from `socket.nsp.name`, **not** from the handshake payload. A
client that supplied its own room could otherwise present one it belongs to
while opening a document from another.

### 3.1c The BroadcastChannel path is disabled

`y-socket.io` will, by default, also sync provider instances to each other over
a `BroadcastChannel` keyed on `${url}/${roomName}`. That channel reaches every
browsing context on the same origin **without touching the server**, and so
without passing the membership check in 3.1b — it is a second sync path that no
authorization applies to.

`useYjsEditor` passes `disableBc: true`. The feature is an optimization for one
user with several tabs open; in a two-person room it saves nothing worth having
an unauthorized sync path for, and the server relays between tabs perfectly well.

This is worth knowing if you ever test convergence with two providers in one
process: leave BroadcastChannel on and they will converge through it, which
looks like the server working when it is not.

### 3.2 The editor instance must be state, not a ref

`useYjsEditor` keys its effect on the Monaco instance. Monaco delivers that
instance through an `onMount` callback, and the obvious thing — stashing it in a
ref — **does not work**: a ref assignment triggers no re-render, so the effect
never re-runs and the binding never attaches. Sync then appears to work only
when some unrelated state change happens to re-render the component.

`Editor.jsx` therefore mirrors the instance into `useState`. If you refactor
this, keep that property.

### 3.3 What Yjs gives us for free

- **Convergence** under concurrent editing, with no lost characters.
- **Cursor presence** via the awareness protocol — remote carets and selections
  track correctly as surrounding text shifts, because they are anchored to
  stable ids rather than offsets.
- **Reconnect merge.** A client that drops and returns exchanges state vectors
  with the server and receives exactly the updates it missed. Socket.IO handles
  the reconnect itself, with backoff.
- **Durability** through `y-leveldb`; a server restart does not lose document
  content.

### 3.4 Offline editing

`useYjsEditor` attaches an `IndexeddbPersistence` to the document **before** the
network provider, and the order is the point. IndexedDB loads the last known
state into the `Y.Doc` immediately, so the editor has content before the socket
connects; the server's state then *merges into* that rather than replacing it.
Edits made while disconnected are written locally as they happen, so a closed
tab — or a closed laptop lid — no longer loses them. They are still in the
document on the next open, and they merge on reconnect exactly like any other
concurrent edit, because to Yjs that is all they are.

The store is keyed `dobby:${roomId}:${fileId}`, matching the provider, for the
same reason the provider is keyed that way: a shared key would restore one
file's contents into another.

Teardown calls `destroy()`, never `clearData()`. Clearing on unmount would throw
away precisely the offline edits the store exists to keep.

## 4. What is *not* CRDT-synced

The editor buffer and the whiteboard are. What remains on plain Socket.IO
broadcast, and the consequences:

| Channel | Mechanism | Consequence |
|---|---|---|
| Chat | A database table, replayed on join | Survives a restart. Capped at 100 messages per room. Ordering is the server's arrival order, not a merge. |
| File tree | Database rows; `files:changed` notifies, the client refetches | Two people renaming the same file at once: the second request fails on the uniqueness check rather than merging. |
| Language selection | Last-write-wins per room | Two simultaneous changes: one silently wins. Harmless. |
| Terminal | Byte stream to a shared PTY | Not merged at all — both users type into one shell. |

The whiteboard used to head this table as the most visible gap — the one
collaborative surface where a late joiner lost history. It is now a `Y.Array` of
stroke segments in the room's `__whiteboard__` document, which bought replay,
persistence, and offline drawing without a line of new protocol.

Two details of that model are worth stating. **A clear is
`array.delete(0, length)`**, not a separate message: a stroke drawn concurrently
with a clear either survives or does not, consistently on both sides, whereas a
"clear" event racing a "draw" event leaves the two peers disagreeing. And **the
local user's strokes are not drawn directly** — they are appended to the array
and painted by the observer, so there is exactly one code path putting ink on
the canvas and the local and remote renderings cannot drift apart.

The canvas is a *rendering* of the array rather than the record itself, which is
what makes a resize correct: the element's backing buffer is cleared by a
resize, and the board is repainted from the array instead of being copied
pixel-for-pixel.

## 4b. Document history

`document_snapshots` holds point-in-time copies of a document's state, taken by
a timer that skips anything whose state vector has not changed. Restore is the
part that repays attention.

**Applying an old update does not restore anything.** Yjs updates are additive:
the operations in a past state are already present in the document that grew out
of it, so re-applying them is a no-op. A restore has to be expressed as a *new*
edit — the difference between what the document says now and what the snapshot
said — and `restoreSnapshot` does exactly that, inside a single transaction so
collaborators see one change rather than a delete followed by a visible retype.

The consequence is a good one: a restore is an ordinary concurrent edit. A
partner typing through one does not lose their characters, both sides converge,
and the restored text reaches every open editor through the binding it already
has, with no reload and no special client-side path.

## 5. Known limitations

**Whiteboard strokes are absolute pixel coordinates.** Two people at very
different window sizes see the same strokes positioned differently. Fixing this
needs a coordinate space of its own — normalized or virtual-canvas — not a bug
fix, and it is out of scope for Phase 3.

**Snapshot history is coarse.** Snapshots are taken on an interval and capped
per document, so history is a handful of recent states rather than a navigable
timeline, and there is no diff between two of them — the panel previews one
version's text but does not compare.

**Unbounded document growth is unmeasured.** `gcEnabled: true` lets Yjs collect
tombstones, but nothing tracks per-document memory or the LevelDB directory's
size over a long-lived room.

**One node per document.** `YSocketIO` holds a document in the process serving
it, and that is a property of the design rather than an oversight — a `Y.Doc` is
state, not a message, so it cannot be replicated by broadcasting it harder. A
clustered deployment therefore routes rather than replicates: the client appends
`?doc=<roomId>:<fileId>` so the load balancer can hash on it, and the server
takes a Redis lease on the document before serving it, refusing a connection
that reaches the wrong replica with `DOCUMENT_MOVED` rather than quietly handing
out a second copy. Document content moves to Redis at the same time, because
LevelDB's exclusive directory lock means the state would otherwise be stranded
on the first node that opened it.

The consequence worth internalizing: **a routing mistake costs a reconnect, not
your partner's work.** That is the entire reason the lease exists on top of the
hashing — the hashing is what usually works, and the lease is what makes it safe
when it does not. See [ADR-014](./07-adrs.md#adr-014),
[ADR-015](./07-adrs.md#adr-015), and [02 §6.1](./02-architecture.md).

**A document with no persistence backend is never released.** `y-socket.io`
destroys a document when its last connection closes only if persistence is
configured. With `YJS_PERSISTENCE_DIR=''` — the test and development setting —
every document a process has opened stays in memory for the life of that
process. Measured, with numbers, in
[09 §5](./09-load-test.md#5-a-leak-the-metrics-found).
