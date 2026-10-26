# Team Notes benchmark harness

Zero-dependency Node 26 load generator (`bench.mjs`) plus runners for local and Docker modes.

## Run

Local (backends started on ports 4001+, fresh DB each, killed by PID on exit):

    bench/run-local.sh                         # all backends under backends/ (node-ts, or any with run.sh)
    bench/run-local.sh -b node-ts,python --runs 3 --duration 5 --concurrency 32

Docker (each container limited to 1 CPU / 512 MB, host ports 4101+):

    bench/run-docker.sh --runs 2 --duration 3

Enable more backends by uncommenting their service in `docker-compose.yml` once their Dockerfile exists.
Direct: `node bench/bench.mjs --target a=http://127.0.0.1:3001 --target b=... --runs 3 --duration 5 --concurrency 32 --json bench/results/x.json`
(also `--scenarios read,list,...`, `--contention-workers 32`). Output: markdown to stdout and `bench/results/latest.md`, raw JSON to `--json`.

## Scenarios and KPIs

`read` GET /notes/{id} over 50 pre-created notes; `list` GET /teams/team-red/notes; `write` POST notes; `mixed` 80% GET, 20% GET+PATCH (If-Match from ETag; 412 is an expected conflict); `contention` N workers GET then PATCH with If-Match on ONE note; `authz-under-load` carol GETs/PATCHes alice's notes, all must be 404.

Per scenario: throughput (req/s, all HTTP requests incl. the ETag GETs), latency p50/p95/p99 (ms), error rate (unexpected status + network errors / requests).
Extras: `contention`: successful writes/s, conflict rate (412 / PATCH attempts), **lost updates** = |(initial version + number of 200 PATCHes) - final version| (must be 0). `mixed`: conflict rate. `authz-under-load`: **leaks** = non-404 responses (must be 0).

Each scenario runs `--runs` times after a 1 s warmup; matrix cells are mean ± stddev (CV%).

## Score

Composite = mean of 10 sub-scores, each 0-100:
- throughput (read, list, write, mixed req/s; contention successful writes/s): `100 * value / best backend`
- latency (p99 of read, list, write, mixed, contention): `100 * best backend / value`

Gates (pass/fail, zero the score and are printed with the reason): lost updates > 0 in any run, leaks > 0, or error rate > 1% in any scenario, or backend down. With a single backend the score is trivially 100; scores are only meaningful relative to other backends in the same run.

## Caveats

- Single machine. Absolute numbers are not portable; compare backends within one run.
- Local mode: the load generator (one Node process, one core effectively) shares CPU with every server, and backends get different effective CPU (multi-threaded ones can use more cores). Use Docker mode for fair resource limits; even there the load generator and Docker daemon share the host.
- The generator itself can saturate at ~10k+ req/s; very fast backends may be measuring the client.
- SQLite serializes writes, so `write` and `contention` mostly measure write-lock handling and per-request overhead rather than parallelism. Contention is inherently conflict-heavy (~90%+ 412s is normal).
- Latencies are measured client-side (includes fetch overhead). `list` and `write` cost grows as notes accumulate in team-red during a run.
