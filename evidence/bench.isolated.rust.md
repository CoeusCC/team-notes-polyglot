
== rust (http://localhost:4106)
  read run 1/3: 19666 req/s p99=6.6ms err=0.00%
  read run 2/3: 19723 req/s p99=6.7ms err=0.00%
  read run 3/3: 19562 req/s p99=6.8ms err=0.00%
  list run 1/3: 8275 req/s p99=7.9ms err=0.00%
  list run 2/3: 7650 req/s p99=8.7ms err=0.00%
  list run 3/3: 7642 req/s p99=10.0ms err=0.00%
  mixed run 1/3: 16610 req/s p99=7.3ms err=0.00%
  mixed run 2/3: 17273 req/s p99=7.1ms err=0.00%
  mixed run 3/3: 16254 req/s p99=7.4ms err=0.00%
  contention run 1/3: 14272 req/s p99=7.2ms err=0.00% lost=0
  contention run 2/3: 14044 req/s p99=7.3ms err=0.00% lost=0
  contention run 3/3: 12729 req/s p99=8.6ms err=0.00% lost=0
  authz-under-load run 1/3: 15001 req/s p99=8.0ms err=0.00% leaks=0
  authz-under-load run 2/3: 17196 req/s p99=7.0ms err=0.00% leaks=0
  authz-under-load run 3/3: 15650 req/s p99=7.5ms err=0.00% leaks=0
  write run 1/3: 12524 req/s p99=8.1ms err=0.00%
  write run 2/3: 12687 req/s p99=8.0ms err=0.00%
  write run 3/3: 12462 req/s p99=8.0ms err=0.00%
# Team Notes benchmark

Generated 2026-10-26T22:23:08.159Z | runs=3 duration=4s concurrency=32 contention-workers=32 | node v26.12.1

## Composite score

Formula: mean of 5 throughput KPIs (req/s for read/list/write/mixed, successful writes/s for contention; each = 100 * value / best backend) and 5 latency KPIs (p99 ms of the same scenarios; each = 100 * best backend / value). Gates: any lost update, any leak, or error rate > 1% in any scenario zeroes the score.

| backend | score | raw (pre-gate) | gate failures |
|---|---|---|---|
| rust | **100.0** | 100.0 | none |

## Matrix (mean ± stddev, CV% over 3 runs)

| scenario | KPI | rust |
|---|---|---|
| read | req/s | 19650 ± 67 (0%) |
| read | p50 ms | 1.29 ± 0.01 (1%) |
| read | p95 ms | 5.27 ± 0.07 (1%) |
| read | p99 ms | 6.71 ± 0.06 (1%) |
| read | err % | 0.00 ± 0.00 (0%) |
| list | req/s | 7856 ± 297 (4%) |
| list | p50 ms | 3.64 ± 0.15 (4%) |
| list | p95 ms | 7.04 ± 0.34 (5%) |
| list | p99 ms | 8.87 ± 0.86 (10%) |
| list | err % | 0.00 ± 0.00 (0%) |
| mixed | req/s | 16712 ± 422 (3%) |
| mixed | p50 ms | 1.52 ± 0.05 (3%) |
| mixed | p95 ms | 5.75 ± 0.12 (2%) |
| mixed | p99 ms | 7.25 ± 0.14 (2%) |
| mixed | err % | 0.00 ± 0.00 (0%) |
| mixed | conflict % | 9.1 ± 0.3 (3%) |
| contention | req/s | 13682 ± 680 (5%) |
| contention | p50 ms | 1.84 ± 0.03 (2%) |
| contention | p95 ms | 6.09 ± 0.16 (3%) |
| contention | p99 ms | 7.71 ± 0.64 (8%) |
| contention | err % | 0.00 ± 0.00 (0%) |
| contention | ok writes/s | 422 ± 19 (5%) |
| contention | conflict % | 93.8 ± 0.0 (0%) |
| contention | LOST UPDATES | 0 ± 0 (0%) |
| authz-under-load | req/s | 15949 ± 921 (6%) |
| authz-under-load | p50 ms | 1.55 ± 0.08 (5%) |
| authz-under-load | p95 ms | 5.89 ± 0.21 (4%) |
| authz-under-load | p99 ms | 7.49 ± 0.41 (5%) |
| authz-under-load | err % | 0.00 ± 0.00 (0%) |
| authz-under-load | LEAKS | 0 ± 0 (0%) |
| write | req/s | 12558 ± 95 (1%) |
| write | p50 ms | 2.10 ± 0.02 (1%) |
| write | p95 ms | 6.71 ± 0.05 (1%) |
| write | p99 ms | 8.02 ± 0.04 (1%) |
| write | err % | 0.00 ± 0.00 (0%) |

