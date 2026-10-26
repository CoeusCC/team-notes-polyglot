# Red team: invariant fuzzer results

Generated 2026-10-26T21:04:19.363Z. Ops per run: 1500. Seeds: 1, 2.

Invariants: I1 no 5xx; I2 4xx is problem+json with matching status; I3 no cross-team leak; I4 monotonic versions / rejected PATCH leaves state alone; I5 no lost update (incl. 16-way burst); I6 deleted-note semantics; I7 ETag == "<version>"; I8 no unauthenticated 2xx except /health; M = model/oracle agreement (status codes per ADR-0003 precedence).

| backend | seed | requests | I1 chk/viol | I2 chk/viol | I3 chk/viol | I4 chk/viol | I5 chk/viol | I6 chk/viol | I7 chk/viol | I8 chk/viol | M chk/viol | bursts ok/total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| node-ts | 1 | 2818 | 2810/28 | 2810/0 | 732/0 | 346/0 | 40/0 | 251/0 | 416/0 | 464/0 | 1223/0 | 12/12 |
| node-ts | 2 | 2804 | 2788/26 | 2788/0 | 783/0 | 382/0 | 37/0 | 217/0 | 457/0 | 467/0 | 1241/1 | 12/12 |
| deno | 1 | 2818 | 2818/0 | 2818/0 | 734/0 | 346/0 | 40/0 | 251/0 | 416/0 | 467/0 | 1231/0 | 12/12 |
| deno | 2 | 2804 | 2804/0 | 2804/0 | 785/0 | 382/0 | 37/0 | 217/0 | 457/0 | 470/0 | 1257/0 | 12/12 |
| php | 1 | 2818 | 2818/0 | 2818/0 | 734/0 | 346/0 | 40/0 | 251/0 | 415/0 | 467/0 | 1231/0 | 12/12 |
| php | 2 | 2794 | 2794/0 | 2794/0 | 807/0 | 342/0 | 41/0 | 241/0 | 413/0 | 481/0 | 1281/0 | 12/12 |
| python | 1 | 2818 | 2818/0 | 2818/0 | 734/0 | 346/0 | 40/0 | 251/0 | 414/0 | 467/0 | 1231/0 | 12/12 |
| python | 2 | 2794 | 2794/0 | 2794/0 | 807/0 | 342/0 | 41/0 | 241/0 | 412/0 | 481/0 | 1281/0 | 12/12 |
| rust | 1 | 2818 | 2818/0 | 2818/0 | 734/0 | 346/0 | 40/0 | 251/0 | 414/0 | 467/0 | 1231/0 | 12/12 |
| rust | 2 | 2794 | 2794/0 | 2794/0 | 807/0 | 342/0 | 41/0 | 241/0 | 412/0 | 481/0 | 1281/0 | 12/12 |

## Violations: node-ts seed 1

- **I1** at op 0: status 500: {"type":"https://teamnotes.example/problems/internal","title":"Internal Server Error","status":500}
  - request: `alice GET //`
  - sequence touching the note: (none)
  - repro: `node redteam/invariants.mjs --target node-ts=http://127.0.0.1:3201 --seed 1 --ops 1500`
- **I1** at op 0: status 500: 
  - request: `alice HEAD //`
  - sequence touching the note: (none)
  - repro: `node redteam/invariants.mjs --target node-ts=http://127.0.0.1:3201 --seed 1 --ops 1500`

## Violations: node-ts seed 2

- **I1** at op 0: status 500: {"type":"https://teamnotes.example/problems/internal","title":"Internal Server Error","status":500}
  - request: `alice GET //`
  - sequence touching the note: (none)
  - repro: `node redteam/invariants.mjs --target node-ts=http://127.0.0.1:3201 --seed 2 --ops 1500`
- **I1** at op 0: status 500: 
  - request: `alice HEAD //`
  - sequence touching the note: (none)
  - repro: `node redteam/invariants.mjs --target node-ts=http://127.0.0.1:3201 --seed 2 --ops 1500`
- **M** at op 15: untouched title changed
  - request: `alice PATCH /notes/b4f06105-0b5e-49bd-8e93-cb4e51b0bce0 If-Match:"1" body={"body":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb...(466b)`
  - sequence touching the note: `#6 create bob team-red {"title":"\ud800"}` → `#8 restore none note#1 (model deleted=false)` → `#15 patch alice note#1 v1 ifmatch=current:"1" {"body":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`
  - repro: `node redteam/invariants.mjs --target node-ts=http://127.0.0.1:3201 --seed 2 --ops 1500`

