# Docker bench raw values (mean of 3 runs, 4s, 1 CPU / 512 MB per container)

| backend | read rps | list rps | write rps | mixed rps | contention ok-writes/s | read p99 ms | write p99 ms | score |
|---|---|---|---|---|---|---|---|---|
| rust | 9393 | 3985 | 10655 | 7108 | 224 | 12.38 | 10.79 | 100.0 |
| node-ts | 6785 | 3327 | 2876 | 4754 | 103 | 16.74 | 44.35 | 57.5 |
| deno | 7541 | 2161 | 1774 | 4278 | 86 | 15.06 | 670.89 | 45.6 |
| python | 1241 | 424 | 1722 | 940 | 38 | 68.52 | 37.66 | 18.2 |
| php | 586 | 639 | 333 | 1107 | 33 | 240.65 | 251.48 | 12.6 |
