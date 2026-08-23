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
                        │
                   awareness (cursors, names, colors) — ephemeral, never stored
```

All of this is set up in
[`client/src/hooks/useYjsEditor.js`](../client/src/hooks/useYjsEditor.js), which
is the only place in the client that touches Yjs directly.

### 3.1 One document per file

The provider's room name is **`${roomId}:${fileId}`**, not `roomId`. This
matters: `EditorWorkspace` mounts one `CodeEditor` per open tab, so a
room-scoped name would give every tab the same `Y.Text` and every file would
show identical content. Room-plus-file scoping also means LevelDB persists each
file separately, and awareness naturally scopes cursors to the file the other
person is actually looking at.

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

## 4. What is *not* CRDT-synced

Only the editor buffer is. Everything else uses plain Socket.IO broadcast and
carries the consequences:

| Channel | Mechanism | Consequence |
|---|---|---|
| Chat | Server-held array, replayed on join | Survives refresh, not restart. Capped at 100 messages. |
| Whiteboard | Stroke events relayed, never stored | A user joining mid-session sees a blank canvas. |
| Language selection | Last-write-wins per room | Two simultaneous changes: one silently wins. Harmless. |
| Terminal | Byte stream to a shared PTY | Not merged at all — both users type into one shell. |

The whiteboard is the most visible gap: it is the one collaborative surface
where a late joiner loses history.

## 5. Known limitations

**No offline editing.** Yjs supports it via `y-indexeddb`, but Dobby does not
wire it up. A client that edits while disconnected keeps its changes in memory
only — they merge on reconnect if the tab stays open, and are lost if it doesn't.
This is the cheapest significant win available and is the top item in
[06 Roadmap](./06-roadmap.md).

**No document history.** LevelDB stores current state, not navigable snapshots.
There is no "restore to earlier version".

**Unbounded document growth is unmeasured.** `gcEnabled: true` lets Yjs collect
tombstones, but nothing tracks per-document memory or the LevelDB directory's
size over a long-lived room.

**Single node.** `YSocketIO` holds documents in the process that serves them. A
second replica would serve a different copy of the same room. See
[02 §6](./02-architecture.md).
