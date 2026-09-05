# 09 — Load test

**Project:** Dobby
**Companion docs:** [Architecture](./02-architecture.md) · [Real-time sync](./03-realtime-sync.md) · [Roadmap](./06-roadmap.md)

Phase 4 asked for "a load test with published methodology and numbers." This is
both. The generator is [`server/loadtest/run.js`](../server/loadtest/run.js);
every figure below is reproducible with the command printed beside it.

---

## 1. What is measured, and why not requests per second

Requests per second is the wrong headline for Dobby. The workload is not a
stream of independent requests — it is a small number of long-lived connections
exchanging tiny, latency-sensitive messages. The number a user can feel is
**how long after I type does my partner see it**.

So the primary metric is **one-way editor propagation latency** measured through
the real path: a Yjs update leaves one socket, the server applies it to the
document, and it arrives at the other socket in the same room. **Chat round trip**
is measured alongside it because it goes through the other half of the server —
the validated, rate-limited, database-writing handler path — and the two degrade
for different reasons. That difference is the whole of §6.

Throughput is reported as a *consequence* of a load level, not as a target. The
question is not how many updates the server can absorb; it is at what
concurrency the latency stops being acceptable.

### The load shape

One **pair** is what the product actually is: two accounts, one room, one shared
document, both connected, **both typing**. That is deliberately not a
benchmark-friendly shape — one writer and many readers would produce much
prettier numbers and would not resemble a pairing session.

- Each typist emits 4 edits per second (a brisk but human typing rate).
- One chat message per pair every 10 seconds.
- Each edit is a real incremental Yjs update from a real `Y.Doc`, so payloads
  grow with document history the way they do in the product rather than being
  fixed-size synthetic blobs.
- Pairs ramp in over a configured window; a thundering herd measures connection
  establishment, and steady state is the question.
- **Measurement starts after the ramp.** Registration, room creation, and
  connection setup are not costs a user in a steady session is paying.

### How latency is attributed honestly

Both ends of each pair live in the load generator's process, so there is no
clock skew and a one-way latency is genuinely one-way. What that does *not*
separate is the driver's own scheduling delay from the server's. So the report
prints the **driver's event-loop lag** next to the latencies, and a run is only
worth publishing while that lag is small relative to the number being reported.

That instrument earned its place immediately. The first 100-pair run reported
p50 3.7 ms but lost 62% of its updates and showed the server holding only 38 of
99 rooms — and a driver-lag maximum of *1,037 seconds*. The load generator, not
the server, had been starved (other work was running on the same laptop). The
run was discarded and repeated on an idle machine, where it passed cleanly with
zero loss. Without the lag sample that first run would have been published as a
server capacity limit, and it was nothing of the kind.

A second cross-check: the report scrapes the server's own `/metrics` and prints
its room and socket counts beside the driver's. When the two disagree about how
many connections exist, one of them is wrong and the run is not publishable.

---

## 2. Environment

Everything below is a **single machine running both the server and the load
generator**, which understates the server's capacity — the driver's CPU competes
with it. Numbers taken this way are a floor and a basis for comparing runs, not
a capacity plan.

| | |
|---|---|
| Host | Apple M1, 8 cores, 8 GB RAM, macOS 26.5.1 |
| Node | v23.9.0 |
| Server | one process, `ENABLE_TERMINAL=false`, auth/API rate limits raised so the driver is not throttled |
| Document storage | in memory (`YJS_PERSISTENCE_DIR=''`) for §3; Redis for §4 |
| Relational store | SQLite for §3–§5; both engines compared in §6 |
| Network | loopback — so these are **compute** numbers, and a real deployment adds its own RTT on top |

```bash
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
DATABASE_PATH=/tmp/dobby-load.db YJS_PERSISTENCE_DIR='' PORT=5099 \
AUTH_RATE_LIMIT=100000 API_RATE_LIMIT=100000 node index.js
```

---

## 3. Single node

```bash
node loadtest/run.js --url http://127.0.0.1:5099 --pairs N --duration 60 --ramp R
```

| Pairs | Sockets | Edits/s | p50 | p95 | p99 | max | Loss | Server CPU (of 60 s) | RSS |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 40 | 79.5 | **1.4 ms** | 2.8 ms | 3.8 ms | 13.3 ms | 0 | 8.4 s (0.14 core) | 100 MiB |
| 50 | 200 | 398.3 | **1.4 ms** | 3.2 ms | 4.3 ms | 38.5 ms | 0 | 36.8 s (0.61 core) | 122 MiB |
| 100 | 400 | 799.7 | **3.7 ms** | 9.6 ms | 12.7 ms | 117.6 ms | 0 | 72.0 s (1.2 cores) | 152 MiB |
| 200 | 800 | 1605.9 | **3.6 ms** | 13.8 ms | 26.0 ms | 481 ms | 0 | 161.4 s (2.7 cores) | 256 MiB |

"Sockets" counts four per pair: two on the main namespace and two on the
document namespace. Loss is edits sent minus edits observed by the partner;
every run above delivered all of them.

### Reading this

**Latency is flat until it isn't, and then only in the tail.** p50 barely moves
between 10 and 200 pairs — 1.4 ms to 3.6 ms — while p99 goes from 3.8 ms to
26 ms and the maximum from 13 ms to 481 ms. That is the signature of a
single-threaded event loop: median work per message is unchanged, but the queue
a message waits behind grows, so the tail stretches while the middle does not.
It also means **an average would have hidden the entire finding**, which is why
none is reported.

**CPU is linear and is the binding constraint.** Roughly 0.8 ms of server CPU
per edit, holding steady from 10 to 200 pairs. At 200 pairs the process is using
2.7 cores' worth of work inside one event loop, which is where the tail latency
comes from and why the next replica — not a bigger machine — is the answer.

**Memory is not the constraint at this scale**, but it is the one to watch: RSS
rises with the number of open documents, and §5 covers a real leak found while
measuring it.

**Where the honest limit is.** Editor propagation stays under ~15 ms at p95 up
to 200 concurrent pairs (400 users). Below 100 pairs the server has ample
headroom. At 200 the tail is visibly stretching and the driver's own p99 lag had
risen to 13.7 ms, so the server's true 200-pair number is *better* than reported
here. **A single node comfortably serves the two-person rooms the product is
designed around**, which is what the roadmap assumed and had never checked.

---

## 4. What clustering costs

The same 100-pair load against one replica with `REDIS_URL` set — so the
Socket.IO Redis adapter is active and documents are stored in Redis rather than
in memory.

| 100 pairs | Edits/s | p50 | p95 | p99 | max | Server CPU | RSS | Documents held |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Single node | 799.7 | 3.7 ms | 9.6 ms | 12.7 ms | 117.6 ms | 72.0 s | 152 MiB | 369 |
| Clustered (1 replica) | 793.5 | 2.4 ms | 7.3 ms | 37.1 ms | 337.2 ms | 80.7 s | 146 MiB | **100** |

**Clustering costs about 12% CPU and roughly triples the p99.** Every edit now
also writes to Redis, and the tail picks up the round trip. The p50 *improving*
is not a real gain — it is within run-to-run noise on a shared machine, and the
right reading of this table is "the median is unaffected, the tail is not".

That is a fair price for the ability to add a second replica, and it is a price
only paid by deployments that opt in: with `REDIS_URL` unset none of this code
runs. It also argues against turning clustering on before it is needed, which
matches the roadmap's ordering.

**The "documents held" column is the more interesting result** — see below.

### After the run

```
$ redis-cli scard dobby:ydoc:names          # documents stored
100
$ redis-cli llen dobby:ydoc:<room>:load-file:updates
1                                            # compacted to a single update
$ redis-cli --scan --pattern 'dobby:doc:*:owner' | wc -l
0                                            # every lease released
$ redis-cli info memory | grep used_memory_human
4.28M                                        # ~44 KiB per document
```

Three things this confirms, each of which was a design claim before it was a
measurement: compaction collapses a 60-second typing history into one stored
update; every document lease is handed back when its last editor disconnects,
rather than lingering to expire; and `dobby_document_lease_conflicts_total`
stayed at **0**, meaning no connection was ever refused for landing on the wrong
node.

---

## 5. A leak the metrics found

Compare the last column of the table in §4: the single-node run ended holding
**369** documents in memory for 100 rooms; the clustered run held exactly
**100**.

The cause is in `y-socket.io`: it destroys a document when its last connection
closes **only if a persistence backend is configured**. With none — which is
what `YJS_PERSISTENCE_DIR=''` produces, and what the test suite uses — every
document a process has ever opened stays in memory for the life of the process.
The single-node figure is 369 rather than 100 because it accumulated documents
across four successive runs and never released one.

This is why `dobby_yjs_documents_open` and `dobby_yjs_document_bytes` exist. The
roadmap listed "unbounded document growth is unmeasured" as a known limitation;
it is now measured, and the first thing the measurement did was find this. Two
practical consequences:

- **Do not run a long-lived deployment with persistence disabled.** It is a
  test and development configuration, and it leaks.
- Configuring persistence — LevelDB or Redis — fixes it as a side effect, which
  is recorded as a `(+)` in [ADR-015](./07-adrs.md#adr-015).

---

## 6. What Postgres costs

Phase 5 moved identity, rooms, the file tree, chat, and snapshots from SQLite to
Postgres when `DATABASE_URL` is set ([ADR-017](./07-adrs.md#adr-017)). SQLite is
an in-process function call and Postgres is a socket round trip, so the question
this section answers is: **on which paths, and how much?**

Same machine, same generator, 25 pairs for 30 seconds, two runs each, with a
local Postgres 16 on loopback:

| | Editor p50 | Editor p95 | Chat p50 | Chat p95 |
|---|---:|---:|---:|---:|
| SQLite | 1.6 / 1.3 ms | 4.8 / 4.8 ms | 1.9 / 1.9 ms | 5.4 / 5.3 ms |
| Postgres | 1.4 / 1.7 ms | 5.2 / 4.7 ms | 3.2 / 3.1 ms | 22.2 / 7.4 ms |

**Editing is unaffected, and that is the result worth having.** Yjs owns the
code buffer end to end and never touches the relational store — the split
[ADR-012](./07-adrs.md#adr-012) made deliberately — so the store the deployment
chooses does not appear on the path the product is judged by. The two editor
columns differ by less than the run-to-run spread.

**Chat pays about 1.2 ms at the median**, roughly doubling, which is what a
loopback round trip plus a transaction costs. The tail is noisier: the 22.2 ms
p95 in the first Postgres run did not reproduce in the second, so treat the
median as the finding and the p95 as "same order, more variable". A real
deployment adds network RTT to the database on top of both figures, and that
term will dominate this one.

What that means in practice: the cost is real, it lands on the handler path
rather than the editor path, and it buys replicas that can be on different
hosts. §7 says what is still unmeasured, and a two-host run is the largest
entry on it.

---

## 7. What this does not cover

Stated plainly, because a load test that implies more coverage than it has is
worse than none.

- **No terminal load.** `ENABLE_TERMINAL=false` throughout. A PTY per session in
  a container is a completely different resource profile — processes and
  containers rather than event-loop time — and would need its own methodology.
- **No execution load.** `/api/execute` proxies to a third-party service; loading
  it would measure Piston and would be rude.
- **No WebRTC media.** Video is peer-to-peer and never touches the server; only
  the signalling path is exercised, and only incidentally.
- **No multi-replica run, and no two-host run.** §4 measures one replica *in
  cluster mode*, which isolates the cost of Redis on the hot path. It does not
  measure a real two-replica deployment behind nginx — that needs a second host
  to be meaningful, since two replicas on one 8-core laptop compete for the
  cores that are the binding constraint. Phase 5 removed the *reason* that run
  was impossible (replicas no longer have to share a filesystem) without
  removing the *requirement*, which is two machines and a network between them.
  It remains the largest gap in this document. The correctness of the
  configuration is covered by `server/tests/integration/cluster.test.js`, which
  runs two real replicas against a real Redis and a real Postgres; its
  performance is unmeasured and should be treated as such.
- **§6 is loopback Postgres.** A database on another host adds its RTT to every
  figure in that table, and on the handler path that term will be larger than
  the one measured here.
- **No sustained soak.** The longest run here is 60 seconds of steady state.
  Memory growth over hours, LevelDB compaction behaviour, and snapshot
  accumulation are unknown.
- **Loopback only.** These are compute numbers. Real network RTT adds to all of
  them.

---

## 8. Reproducing

```bash
# 1. Server
cd server
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
DATABASE_PATH=/tmp/dobby-load.db YJS_PERSISTENCE_DIR='' PORT=5099 \
AUTH_RATE_LIMIT=100000 API_RATE_LIMIT=100000 node index.js

# 2. Load, in another shell
node loadtest/run.js --url http://127.0.0.1:5099 --pairs 50 --duration 60 --ramp 20 \
  --json /tmp/dobby-50.json
```

For §6, start the server against Postgres instead — everything else is the same,
which is the point:

```bash
createdb dobby_load
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
DATABASE_URL=postgres://localhost/dobby_load YJS_PERSISTENCE_DIR='' PORT=5099 \
AUTH_RATE_LIMIT=100000 API_RATE_LIMIT=100000 node index.js
```

`--json` writes the full report including every configuration value, both
`/metrics` scrapes, and the complete latency summary, so a published number can
be traced back to the run that produced it.

Check the driver's event-loop lag before believing any result. If its p99
approaches the propagation latency being reported, the load generator is the
bottleneck and the run says nothing about the server.
