
== node-ts (http://localhost:4101)
  read run 1/3: 16910 req/s p99=7.0ms err=0.00%
  read run 2/3: 14503 req/s p99=8.2ms err=0.00%
  read run 3/3: 15969 req/s p99=7.5ms err=0.00%
  list run 1/3: 6960 req/s p99=12.8ms err=0.00%
  list run 2/3: 6875 req/s p99=11.8ms err=0.00%
  list run 3/3: 6551 req/s p99=13.2ms err=0.00%
  mixed run 1/3: 13714 req/s p99=7.5ms err=0.00%
  mixed run 2/3: 13430 req/s p99=8.0ms err=0.00%
  mixed run 3/3: 13623 req/s p99=7.8ms err=0.00%
  contention run 1/3: 10737 req/s p99=8.6ms err=0.00% lost=0
  contention run 2/3: 10914 req/s p99=8.3ms err=0.00% lost=0
  contention run 3/3: 11009 req/s p99=8.3ms err=0.00% lost=0
  authz-under-load run 1/3: 15068 req/s p99=7.6ms err=0.00% leaks=0
  authz-under-load run 2/3: 15852 req/s p99=7.3ms err=0.00% leaks=0
  authz-under-load run 3/3: 15726 req/s p99=7.6ms err=0.00% leaks=0
  write run 1/3: 10952 req/s p99=8.5ms err=0.00%
  write run 2/3: 10599 req/s p99=9.1ms err=0.00%
  write run 3/3: 11069 req/s p99=8.5ms err=0.00%
# Team Notes benchmark

Generated 2026-10-26T22:24:34.775Z | runs=3 duration=4s concurrency=32 contention-workers=32 | node v26.12.1

## Composite score

Formula: mean of 5 throughput KPIs (req/s for read/list/write/mixed, successful writes/s for contention; each = 100 * value / best backend) and 5 latency KPIs (p99 ms of the same scenarios; each = 100 * best backend / value). Gates: any lost update, any leak, or error rate > 1% in any scenario zeroes the score.

| backend | score | raw (pre-gate) | gate failures |
|---|---|---|---|
| node-ts | **100.0** | 100.0 | none |

## Matrix (mean ± stddev, CV% over 3 runs)

| scenario | KPI | node-ts |
|---|---|---|
| read | req/s | 15794 ± 990 (6%) |
| read | p50 ms | 1.60 ± 0.09 (5%) |
| read | p95 ms | 5.72 ± 0.21 (4%) |
| read | p99 ms | 7.58 ± 0.50 (7%) |
| read | err % | 0.00 ± 0.00 (0%) |
| list | req/s | 6795 ± 176 (3%) |
| list | p50 ms | 4.00 ± 0.14 (4%) |
| list | p95 ms | 8.78 ± 0.35 (4%) |
| list | p99 ms | 12.61 ± 0.57 (5%) |
| list | err % | 0.00 ± 0.00 (0%) |
| mixed | req/s | 13589 ± 118 (1%) |
| mixed | p50 ms | 1.90 ± 0.02 (1%) |
| mixed | p95 ms | 6.19 ± 0.07 (1%) |
| mixed | p99 ms | 7.78 ± 0.19 (3%) |
| mixed | err % | 0.00 ± 0.00 (0%) |
| mixed | conflict % | 9.4 ± 0.1 (1%) |
| contention | req/s | 10887 ± 113 (1%) |
| contention | p50 ms | 2.42 ± 0.01 (0%) |
| contention | p95 ms | 6.83 ± 0.09 (1%) |
| contention | p99 ms | 8.42 ± 0.16 (2%) |
| contention | err % | 0.00 ± 0.00 (0%) |
| contention | ok writes/s | 355 ± 6 (2%) |
| contention | conflict % | 93.5 ± 0.0 (0%) |
| contention | LOST UPDATES | 0 ± 0 (0%) |
| authz-under-load | req/s | 15549 ± 344 (2%) |
| authz-under-load | p50 ms | 1.65 ± 0.04 (3%) |
| authz-under-load | p95 ms | 6.05 ± 0.11 (2%) |
| authz-under-load | p99 ms | 7.50 ± 0.17 (2%) |
| authz-under-load | err % | 0.00 ± 0.00 (0%) |
| authz-under-load | LEAKS | 0 ± 0 (0%) |
| write | req/s | 10873 ± 200 (2%) |
| write | p50 ms | 2.41 ± 0.03 (1%) |
| write | p95 ms | 7.20 ± 0.09 (1%) |
| write | p99 ms | 8.72 ± 0.29 (3%) |
| write | err % | 0.00 ± 0.00 (0%) |

