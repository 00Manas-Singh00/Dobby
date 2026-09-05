# 08 — Observability

**Project:** Dobby
**Companion docs:** [Architecture](./02-architecture.md) · [Load test](./09-load-test.md) · [ADR-016](./07-adrs.md#adr-016)

Before Phase 4 the only window into a running instance was `console.log`. There
was no way to answer how many rooms were live, whether documents were growing
without bound, how long an execution really took, or how often a client was
being rate-limited — and every one of those turned out to be a question the load
test needed answered.

---

## 1. The endpoint

`GET /metrics` returns Prometheus exposition format.

It is **not** `/health`. `/health` is the one deliberately anonymous endpoint and
says nothing but "alive". `/metrics` is an inventory of the instance — room
counts, socket counts, document sizes — so it is guarded, in one of two ways:

| `METRICS_TOKEN` | Who may scrape |
|---|---|
| set | any caller presenting it as `Authorization: Bearer <token>` |
| unset | **loopback callers only** — a sidecar, or an operator over an SSH tunnel |

The default is closed to the network rather than open. A fail-open default would
publish the inventory from the first deployment that forgot a variable.

Adding the node id to `/health` was considered, for debugging a load balancer
from outside, and rejected: it would turn the one anonymous endpoint into a way
to enumerate the fleet. The node id is a label on every metric instead, behind
the guard that page already has.

**Every value is per process.** In a cluster, Prometheus scrapes each replica
directly and sums — which is why `node` labels every sample, and why
`deploy/nginx.conf` returns 404 for `/metrics` rather than proxying it. A
balanced `/metrics` would return one replica's numbers at random and make every
graph nonsense.

---

## 2. Sampled, not counted

Counters and histograms are recorded where the event happens. **Gauges are
sampled from collector callbacks at scrape time**, and that distinction is the
main design decision here.

A gauge maintained by hand — incremented on join, decremented on leave — is
correct until the first path that misses its decrement. A terminal killed by its
memory cap, a socket dropped inside a handler that threw, a room emptied by a
disconnect during a redeploy: each of those leaves the number permanently one
too high, and it never recovers. A gauge that lies is worse than no gauge,
because it is believed.

So `dobby_active_rooms` asks the adapter, `dobby_live_terminals` asks the
terminal manager for its map size, and `dobby_yjs_documents_open` asks
`YSocketIO`. They cannot drift, because there is nothing to drift from.

The cost is honest and worth stating: `dobby_yjs_document_bytes` encodes every
open document on each scrape, which is O(total document size) work on the scrape
interval. Yjs exposes no cheaper size. The alternative was leaving the growth
the roadmap called out as unmeasured, unmeasured.

---

## 3. What is exported

### Gauges — sampled per scrape

| Metric | Question it answers |
|---|---|
| `dobby_active_rooms` | How many rooms have someone in them on this node |
| `dobby_connected_sockets` | Authenticated sockets on the main namespace |
| `dobby_live_terminals` | PTY sessions alive, so a container leak is visible |
| `dobby_yjs_documents_open` | Documents held in memory |
| `dobby_yjs_document_bytes` | **The unbounded-growth signal.** Encoded size of every open document |
| `dobby_store_info` | Always 1; the `engine` label is `sqlite` or `postgres` |

`dobby_active_rooms` excludes the room Socket.IO names after each socket's own
id; those are not rooms in Dobby's sense.

`dobby_store_info` carries no measurement — it exists so that "which engine is
this replica actually talking to?" has an answer read back from the process
rather than from the environment file you believe it has. It is here rather than
on `/health` deliberately: that endpoint is the one anonymous surface and stays a
bare liveness check ([ADR-016](./07-adrs.md#adr-016)). A cluster mid-migration
where `count(count by (engine) (dobby_store_info)) > 1` is a fleet with two
different databases, which is worth an alert.

### Counters and histograms — recorded at the event

| Metric | Labels | Notes |
|---|---|---|
| `dobby_socket_events_total` | `event`, `outcome` | `outcome` ∈ `ok`, `rate_limited`, `invalid`, `denied`, `failed` |
| `dobby_execution_duration_seconds` | `language`, `outcome` | Whole call including the wait on Piston — that wait *is* what the user experiences |
| `dobby_http_request_duration_seconds` | `method`, `route`, `status` | Labelled on the **matched route**, never the URL |
| `dobby_snapshots_total` | `outcome` | `captured`, `skipped_unchanged`, `skipped_too_large` |
| `dobby_document_lease_conflicts_total` | — | Yjs connections refused because another node owns the document |

Two of these deserve their reasoning stated.

**Socket events are counted by outcome, not just by count.** A client hitting its
quota, a malformed payload, and a revoked membership are three different
incidents with three different responses, and a single "errors" number makes
them indistinguishable. Each early return in the `on()` wrapper records its own
reason.

**HTTP timing labels on `req.route.path`, not `req.url`.** `/api/rooms/:id`
produces one time series; `/api/rooms/<uuid>` would produce one per room, and
unbounded label cardinality is how a metrics backend gets taken down by the thing
meant to observe it.

### Process metrics

`prom-client`'s defaults are exported under the `dobby_` prefix: heap, resident
memory, event-loop lag, GC, file descriptors. These are not filler — the Yjs
documents live in this heap, so `dobby_process_resident_memory_bytes` is a real
second opinion on document growth, and `dobby_nodejs_eventloop_lag_p99_seconds`
is the single best indicator that a node is saturated. [The load
test](./09-load-test.md) reports both.

---

## 4. Queries worth having

```promql
# Editor traffic, by outcome. A rising rate_limited share is a client bug or an
# attack; a rising invalid share is a version skew.
sum by (outcome) (rate(dobby_socket_events_total[5m]))

# Execution p95, which is mostly a measure of Piston rather than of Dobby.
histogram_quantile(0.95,
  sum by (le) (rate(dobby_execution_duration_seconds_bucket[5m])))

# Cluster-wide occupancy: sum across replicas, because each reports its own.
sum(dobby_active_rooms)
sum(dobby_connected_sockets)

# Average bytes per open document. Growth here without a matching rise in
# document count is a single room accumulating history.
sum(dobby_yjs_document_bytes) / sum(dobby_yjs_documents_open)

# Saturation. This is what stretches the latency tail; see 09 §3.
max(dobby_nodejs_eventloop_lag_p99_seconds)
```

## 5. Alerts worth having

```yaml
# A routing failure. In a correct deployment this is flat at zero forever, which
# is what makes any increase precisely actionable: the balancer is not hashing
# on `doc`, or it is mid-rescale. Users see reconnects, not lost work.
- alert: DobbyDocumentMisrouting
  expr: increase(dobby_document_lease_conflicts_total[10m]) > 0
  for: 10m

# Saturation. Past roughly 200 concurrent pairs on one node the tail latency
# stretches badly (09 §3); this fires before users describe it as "laggy".
- alert: DobbyEventLoopSaturated
  expr: max(dobby_nodejs_eventloop_lag_p99_seconds) > 0.25
  for: 5m

# A container leak: sessions alive with nobody connected to them.
- alert: DobbyOrphanedTerminals
  expr: sum(dobby_live_terminals) > 0 and sum(dobby_connected_sockets) == 0
  for: 15m

# Document growth outpacing document count.
- alert: DobbyDocumentGrowth
  expr: sum(dobby_yjs_document_bytes) / sum(dobby_yjs_documents_open) > 5e6
  for: 30m

# A split fleet: replicas disagreeing about which database they are using.
# Normally impossible and permanent when it happens — one replica was restarted
# without DATABASE_URL and is quietly serving a different set of accounts.
- alert: DobbyStoreDisagreement
  expr: count(count by (engine) (dobby_store_info)) > 1
  for: 5m
```

`DobbyDocumentMisrouting` is the one to wire up first. It is the only alert here
that reports a *correctness* risk rather than a performance one, and it is
cheap: the design makes a misroute loud on purpose ([ADR-014](./07-adrs.md#adr-014)),
so this alert is simply reading a signal the server already goes out of its way
to produce.

---

## 6. The dashboard

`deploy/grafana-dashboard.json` imports into Grafana against a Prometheus data
source. Four rows, in the order an incident is actually diagnosed:

1. **Occupancy** — rooms, sockets, terminals, summed across replicas. "Is anyone
   using it, and how many?"
2. **Saturation** — event-loop lag and CPU per replica. "Is a node in trouble,
   and which one?"
3. **Traffic and errors** — socket events by outcome, HTTP latency, execution
   latency. "What is it doing, and what is failing?"
4. **Documents and cluster health** — open documents, total bytes, lease
   conflicts. "Is state growing, and is routing correct?"

Scrape config for a cluster, where each replica is a target in its own right:

```yaml
scrape_configs:
  - job_name: dobby
    scrape_interval: 15s
    authorization:
      type: Bearer
      credentials: <METRICS_TOKEN>
    static_configs:
      - targets: ['dobby-1:5001', 'dobby-2:5001']
```

Do not point this at the load balancer. Every panel that sums across `node`
depends on scraping the replicas individually.
