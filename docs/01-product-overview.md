# 01 — Product Overview

**Project:** Dobby — a cloud-based IDE for pair programming
**Status:** v0.9, authenticated (Phase 1 complete)

---

## 1. What Dobby is

Dobby is a browser-based workspace where two people write, run, and talk through
code together in real time. One person opens a room, shares the URL, and the
other lands in the same editor, the same terminal, the same whiteboard, and a
video call — without installing anything.

The product bet is **integration, not any single feature**. A collaborative
editor exists elsewhere; a browser terminal exists elsewhere; a video call
certainly exists elsewhere. Dobby's value is that a pairing session never
requires leaving the tab.

## 2. Who it's for

**The interview pair.** An interviewer and a candidate need a shared editor, a
way to actually run the code, and a face-to-face channel. Setup time is the
enemy; a room URL is the entire onboarding.

**The teaching pair.** A mentor walking someone through a bug wants to point at
things — hence the whiteboard — and to watch them type rather than take over.

**The stuck colleague.** Two teammates debugging together for twenty minutes,
who would otherwise screen-share and dictate keystrokes.

Dobby caps rooms at **two participants** by design. The video mesh, the shared
terminal session model, and the presence UI are all built for pairs. This is a
product decision, not a temporary limit — see [ADR-006](./07-adrs.md#adr-006).

## 3. Feature status

| Feature | State | Notes |
|---|---|---|
| Collaborative code editor | **Working** | Monaco + Yjs CRDT, per-file documents, live cursors |
| Multi-file tabs & explorer | **Partial** | Tabs and editing work; the file tree is a hardcoded mock |
| Code execution | **Working** | Piston API, ~40 languages, stdin supported |
| Integrated terminal | **Working, off by default** | Real PTY; gated behind `ENABLE_TERMINAL` — see [04](./04-security-model.md) |
| Chat | **Working** | In-memory history, last 100 messages replayed on join |
| Whiteboard | **Working** | Canvas strokes relayed over Socket.IO; not persisted |
| Video / audio call | **Working** | WebRTC P2P via simple-peer, Socket.IO signaling |
| Presence / user list | **Working** | Room roster plus Yjs awareness cursors |
| Layout persistence | **Working** | Panel sizes, active module, editor view state in localStorage |
| **Authentication** | **Absent** | Anyone with a room URL is in the room |
| **Authorization / roles** | **Absent** | No viewer/editor distinction |
| **Persistent rooms** | **Partial** | Editor content survives restarts via LevelDB; chat and whiteboard do not |
| **Tests** | **Absent** | No unit, integration, or E2E tests exist |

## 4. What Dobby explicitly is not

- **Not a hosted dev environment.** The terminal is a convenience for running
  scratch commands, not a container platform. There is no per-user isolation
  beyond a scratch directory.
- **Not multi-tenant.** No accounts, no ownership, no billing, no quotas.
- **Not a group tool.** Two people per room.
- **Not offline-capable.** Yjs makes this achievable, but no IndexedDB
  persistence is wired up, so a disconnected client loses unsent edits.

## 5. Known product-level gaps

These are the things that would block calling Dobby v1, in rough priority order:

1. **The file explorer is a mock.** [`FileExplorer.jsx`](../client/src/components/workspace/FileExplorer.jsx)
   renders a hardcoded tree; opening a file creates a placeholder buffer rather
   than reading anything real. Users can edit and share files, but not create,
   rename, or delete them.
2. **Chat and whiteboard aren't durable.** Both live in server memory and are
   cleared 30 minutes after a room empties. A refresh mid-session is fine; a
   server restart is not.
3. **Single-node only.** Socket.IO rooms, chat, and the rate limiters are all
   in-process, so the server cannot be scaled horizontally.
4. **Identity is minimal.** Accounts exist, but there is no email verification,
   password reset, or MFA. Account recovery is a manual database operation.

## 6. Success criteria

Dobby is doing its job when two people can:

- open a shared invite link and be editing the same file within five seconds;
- type in the same file simultaneously without losing characters or having
  cursors jump;
- run the code and see the same output;
- and hold a conversation about it — over video, chat, or the whiteboard —
  without opening another application.

The first three hold today. The fourth holds for the length of a session but not
across a restart.
