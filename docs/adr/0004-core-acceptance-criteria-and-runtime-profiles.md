# ADR-0004: Core acceptance criteria plus runtime profiles

- **Status:** Accepted (Patrick, 2026-10-26; Patrick proposed the idea)
- **Related:** the SpecDLC card field `Set` (core/profile), and ADR-0005

## Context
Rebuilding the service in 4 languages (plus 3 Grok replications) showed two kinds of requirement mixed together in our cards:
1. **Behavior every implementation must have**: status codes, precedence, versioning, visibility.
2. **Technical constraints that only make sense in some environments**: `Connection: close` after a 413 on keep-alive HTTP/1.1, the PHP built-in server's worker count, and SQLite's single-writer model.

Putting the second kind into core cards either over-constrains languages that can't express them, or leaves them unchecked.

## Decision
> In the context of one spec implemented in many languages and runtimes, facing requirements that are true behavior in some places and environment-specific in others, we decided to tag every card **Set: core** (language-neutral, checked by the conformance suite for every backend) or **Set: profile:<name>** (a small technical constraint checked only where the profile applies), and to **tighten, loosen, split or merge core cards** whenever cross-language evidence shows a divergence, and neglected one flat list of cards, to achieve a small, portable core that any new language can be rebuilt against plus explicit, testable invariants for each environment, accepting a second place to look for requirements and some bookkeeping in the runner.

## Consequences
- Profiles so far are `profile:http1-keepalive` (PROFILE-TRANSPORT-1), `profile:php-cli-server` (PROFILE-PHP-1) and `profile:sqlite` (PROFILE-SQLITE-1).
- Divergences found by rebuilds are resolved by changing the core, never by special-casing one backend. ADR-0005 records the first such batch.
- **Next:** the runner reports core and profile verdicts separately, and each backend declares its profiles in `backends/<b>/PROFILES`.
