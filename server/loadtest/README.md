# Load test

`node loadtest/run.js` drives a running Dobby with synthetic pairs and reports
what a user would have felt. Methodology and results are in
[docs/09-load-test.md](../../docs/09-load-test.md); this file is how to run it.

```bash
# Terminal 1 — the server under test
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
DATABASE_PATH=/tmp/dobby-load.db YJS_PERSISTENCE_DIR='' PORT=5001 \
  node index.js

# Terminal 2 — the load
node loadtest/run.js --pairs 50 --duration 60 --url http://127.0.0.1:5001
```

Flags: `--pairs` (concurrent two-person rooms), `--duration` (seconds of steady
state), `--keystrokes` (edits per second per typist), `--ramp` (seconds to bring
every pair up), `--metrics-token`, `--json <path>`.

The load generator and the server share a machine by default, which understates
the server's capacity — the driver's own CPU competes with it. Numbers taken
that way are still useful as a *floor* and for comparing runs, and the doc says
where each figure came from.
