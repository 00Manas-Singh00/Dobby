# 01 — Product Overview

**Project:** Dobby — a cloud-based IDE for pair programming
**Status:** v1.0 — Phases 1–3 complete: authenticated, tested, and a real workspace

---

## 1. What Dobby is

Dobby is a browser-based workspace where two people write, run, and talk through
code together in real time. One person opens a room, sends a single-use invite
link, and the other lands in the same files, the same terminal, the same
whiteboard, and a video call — without installing anything.

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
| Multi-file tabs & explorer | **Working** | A real per-room tree: create, rename, move, delete, folders. Changes reach the other person live |
| Offline editing | **Working** | `y-indexeddb`; edits made while disconnected survive a closed tab and merge on return |
| Document history | **Working** | Periodic snapshots per file, with preview and restore |
| Code execution | **Working** | Piston API, ~40 languages, stdin supported. Output is per file |
| Integrated terminal | **Working, off by default** | Real PTY; gated behind `ENABLE_TERMINAL` — see [04](./04-security-model.md) |
| Chat | **Working** | Persisted in the database; last 100 messages replayed on join |
| Whiteboard | **Working** | Strokes are a Yjs `Y.Array` — replayed to a late joiner and persisted |
| Video / audio call | **Working** | WebRTC P2P via simple-peer, Socket.IO signaling |
| Presence / user list | **Working** | Room roster plus Yjs awareness cursors |
| Layout persistence | **Working** | Panel sizes, active module, open tabs, editor view state in localStorage |
| **Authentication** | **Working** | Email/password, bcrypt, JWT access + rotating refresh tokens |
| **Authorization** | **Working** | Rooms have an owner; joining needs a single-use invite. No viewer/editor distinction within a room — see [04 §3](./04-security-model.md) |
| **Persistent rooms** | **Working** | Files, chat, whiteboard, and document history all survive a restart |
| **Tests** | **Working** | 327 server tests, run twice per push — once on SQLite, once on Postgres — including a two-replica suite against a real Redis, plus 16 two-browser end-to-end tests |
| **Horizontal scale** | **Working** | `REDIS_URL` turns one process into a cluster; `DATABASE_URL` lets those replicas be on different hosts. A document is served by exactly one replica by design. Two-host *performance* is untested — see [09 §7](./09-load-test.md#7-what-this-does-not-cover) |
| **Observability** | **Working** | Prometheus metrics, a Grafana dashboard, and published load-test numbers — [08](./08-observability.md), [09](./09-load-test.md) |

## 4. What Dobby explicitly is not

- **Not a hosted dev environment.** The terminal is a convenience for running
  scratch commands, not a container platform. There is no per-user isolation
  beyond a scratch directory.
- **Not multi-tenant.** There are accounts and room ownership, but no billing
  and no per-user quotas beyond the rate limits.
- **Not a group tool.** Two people per room.
- **Not a file host.** The tree is capped at 200 nodes per room and there is no
  upload or download — it is somewhere to write code together, not somewhere to
  keep a project.

## 5. Known product-level gaps

In rough priority order:

1. **Two-host performance is unmeasured.** Replicas can be on separate hosts
   now — the store is Postgres when `DATABASE_URL` is set, and two real replicas
   against a real Postgres are tested for correctness — but every published
   number was taken on one machine, where two replicas compete for the cores
   that are the binding constraint. The capacity of a genuinely distributed
   deployment is unknown; see [09 §7](./09-load-test.md#7-what-this-does-not-cover).
2. **Terminal sessions are pinned to a node.** A PTY is a live process rather
   than data, so it cannot follow a user to another replica; a cluster needs
   sticky sessions on the main namespace.
3. **Identity is minimal.** Accounts exist, but there is no email verification,
   password reset, or MFA. Account recovery is a manual database operation.
4. **Whiteboard strokes are absolute pixel coordinates,** so two people at very
   different window sizes see the board positioned differently.
5. **There is no migration from an existing SQLite file into Postgres.**
   Switching engines today means starting with an empty database.

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

There is now a measured statement behind the first two: one node carries 200
concurrent pairs — 400 users at 1,600 edits per second — with a 3.6 ms median
propagation latency, a 13.8 ms p95, and no lost updates
([09](./09-load-test.md)). The product has never needed a fraction of that.
