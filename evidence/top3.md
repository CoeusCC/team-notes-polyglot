# Top 3 head-to-head: rust, node-ts, deno

Run 2026-10-26 (CDT), single machine. Selection: conformance 97/97 and 0 red-team violations, ranked by the Docker composite (rust 100, node-ts 57.5, deno 45.6; `evidence/bench.docker.md`). Correctness, tests, mutation and footprint were measured fresh in this run. Performance rows are copied, not re-run.

| Metric | rust | node-ts | deno |
|---|---|---|---|
| **Correctness** | | | |
| Conformance `--strict` | 97/97, 40 AC passed, 0 refuted | 97/97, 40 AC passed, 0 refuted | 97/97, 40 AC passed, 0 refuted |
| Red-team seed 1 (1500 ops, 2818 reqs) | 0 violations | 0 violations | 0 violations |
| Red-team seed 2 (1500 ops, 2794 reqs) | 0 violations | 0 violations | 0 violations |
| **Test strength** | | | |
| Unit tests (pass/fail) | 12 / 0 (inline `#[cfg(test)]` in domain.rs and store.rs) | 45 / 0 (6 files) | 8 / 0 (`app_test.ts`) |
| Mutation score, domain module only (Uncle Bob mutator, `--no-coverage`) | 23/23 killed = 100% (`src/domain.rs`, test cmd `cargo test`) | 42/43 = 97.7% (`src/domain/*`, reused, see below) | 62/62 killed = 100% (`domain.ts`, test cmd `deno test ...`) |
| Deliberate-fault check (`scripts/falsify.sh`) | not measured (script is node-ts only) | 5/5 faults CAUGHT | not measured (script is node-ts only) |
| **Performance (Docker, 1 CPU / 512 MB, mean of 3 runs x 4 s; copied)** | | | |
| Composite score | 100.0 | 57.5 | 45.6 |
| read req/s (p99 ms) | 9393 ± 1293 (12.38) | 6785 ± 1242 (16.74) | 7541 ± 620 (15.06) |
| list req/s (p99 ms) | 3985 ± 359 (19.39) | 3327 ± 395 (31.84) | 2161 ± 57 (48.20) |
| write req/s (p99 ms) | 10655 ± 1270 (10.79) | 2876 ± 546 (44.35) | 1774 ± 801 (670.89) |
| mixed req/s (p99 ms) | 7108 ± 914 (15.94) | 4754 ± 527 (21.56) | 4278 ± 145 (36.64) |
| contention ok-writes/s (p99 ms) | 224 ± 41 (19.60) | 103 ± 31 (42.62) | 86 ± 6 (50.41) |
| authz-under-load req/s (p99 ms) | 11443 ± 2754 (12.63) | 5528 ± 1495 (23.29) | 4240 ± 2192 (19.01) |
| Lost updates / leaks / error rate | 0 / 0 / 0% | 0 / 0 / 0% | 0 / 0 / 0% |
| **Footprint** | | | |
| Source lines, excl. tests (`wc -l`) | 785 (domain 214, http 334, store 220, main 17) | 584 (http 247, store 157, domain 174, server 6) | 493 (domain 113, http 226, store 141, main 13) |
| Runtime dependencies | 10 direct crates (99 packages in Cargo.lock incl. the project) | 0 (Node built-ins: `node:sqlite`, `node:http`, `node:crypto`, `node:fs`) | 0 (`node:sqlite`, `node:crypto`; `jsr:@std/assert` is test-only) |
| Docker image size (`docker images`, disk usage) | 120 MB (content 30.2 MB) | 382 MB (content 90.9 MB) | 268 MB (content 75.2 MB) |
| Cold start, `docker run` to first `/health` 200 (one measurement) | 361 ms | 361 ms | 303 ms |

## What each is best at (facts only)

- **rust**: highest throughput and lowest p99 in every scenario (e.g. write 10655 req/s vs 2876 and 1774; contention 224 ok-writes/s vs 103 and 86). Smallest image (120 MB). Mutation 100% on a 23-mutant domain. Most source lines (785) and the only one with third-party runtime crates.
- **node-ts**: zero runtime dependencies. Most unit tests (45) and the only one with the deliberate-fault check (5/5 caught). Second on composite. Better p99 than deno on list, write, mixed and contention. 1 surviving mutant (`validation.ts:61`, `||` to `&&`), which conformance does catch.
- **deno**: fewest source lines (493), zero runtime dependencies, fastest cold start in the single measurement (303 ms), 62/62 mutants killed with only 8 unit tests (the `domain.ts` mutants are denser, 62 sites). Highest read throughput of the two JS runtimes (7541 vs 6785 req/s, within the run-to-run stddev). Weakest write tail: write p99 670.89 ± 862.83 ms (CV 129%).

All three: 97/97 conformance, 0 red-team violations on two seeds, 0 lost updates and 0 leaks under load.

## Caveats

- Cold start is one measurement each; differences of ~60 ms are within the noise of the 10 ms curl poll plus `docker run` overhead. It was run with `--cpus 1 --memory 512m --tmpfs /data -e DB_PATH=/data/notes.db`, matching `bench/docker-compose.yml`. Other containers were running on the host during the measurements.
- Conformance and red-team ran with the three backends in parallel (different ports) on one machine.
- Mutation scores are not comparable across backends: different mutant counts and different rule sets per language, each on the domain module only. The mutator documents Clojure, Java, Go, TypeScript, Rust and Python and does not list Deno, but it handled `domain.ts` as TypeScript with `deno test` as the test command. `--no-coverage`, `--max-workers 2`.
- node-ts mutation result was reused from `evidence/redteam.mutation.md` (43 mutants). The last domain file edit (`validation.ts`, 16:03) is older than that report (16:05), so it was not re-run.
- Rust unit tests live in the same files as the code; source LOC for rust excludes the `#[cfg(test)]` modules (counted up to the first `cfg(test)`).
- Rust mutation: the `domain.rs` unit tests cover parsing only; `http.rs` and `store.rs` were not mutated. Likewise for the other two.
- Docker image sizes are the "DISK USAGE" column of `docker images`.

## How measured

```
# correctness: per backend, fresh server per run, PID file, killed by PID (scripts in the scratchpad: top3/corr.sh)
cd backends/node-ts && PORT=3310 node src/server.ts            # node-ts (3311/3312 for seeds)
PORT=3320 DB_PATH=:memory: backends/deno/run.sh                 # deno   (3321/3322)
PORT=3330 DB_PATH=:memory: backends/rust/run.sh                 # rust   (3331/3332)
BASE_URL=http://127.0.0.1:<port> node conformance/run.mjs --strict
node redteam/invariants.mjs --target <b>=http://127.0.0.1:<port> --seed 1 --ops 1500   # and --seed 2
# logs: evidence/top3.{node-ts,deno,rust}.log

# unit tests
cd backends/node-ts && npm test ; cd backends/deno && deno task test ; cd backends/rust && cargo test

# mutation (on scratch copies under the scratchpad, nothing written into backends/)
<scratchpad>/ub/mutator/mutator --no-coverage --max-workers 2 --test-command "cargo test" src/domain.rs        # in copy of backends/rust
<scratchpad>/ub/mutator/mutator --no-coverage --max-workers 2 --test-command "deno test --allow-net --allow-read --allow-write --allow-env" domain.ts   # in copy of backends/deno
# logs: evidence/top3.rust.mutation.log, evidence/top3.deno.mutation.log; node-ts: evidence/redteam.mutation.node-ts.log

# fault check
scripts/falsify.sh        # log: evidence/top3.node-ts.falsify.log

# performance: copied from evidence/bench.docker.md and evidence/bench.docker.raw.md (not re-run)

# footprint
wc -l <src files, excluding tests>
docker images                                                    # bench-rust, bench-node-ts, bench-deno
docker run -d --rm --cpus 1 --memory 512m -p 127.0.0.1:<port>:3000 -e PORT=3000 -e DB_PATH=/data/notes.db --tmpfs /data bench-<b>
#   then poll curl http://127.0.0.1:<port>/health every ~10 ms until 200; log: evidence/top3.coldstart.log
```

Note: `cargo test` and `run.sh` for rust build into the existing `backends/rust/target/` (already present before this run); no source files were edited.
