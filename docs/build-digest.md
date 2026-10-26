# Build digest

This is an append-only log, with one entry per gate and per significant commit. `builddigest` is the sha256 (shortened) of `git ls-tree -r HEAD`, following `SpecDLC-Research/specs/verdict-runner.md`. Mechanical fields come from `scripts/digest.sh`. The decision lines are written by hand.

The session started at 2026-10-26T15:11 CDT, with a 180-minute budget, so the deadline is about 18:11 CDT.

