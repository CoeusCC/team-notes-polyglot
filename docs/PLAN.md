# Plan: Shared Team Notes, spec-first and delivered in gated tiers

## Context
This is the Bluestaq take-home. The task is a backend for a note-taking service shared among small teams, delivered as a runnable REST service with a README and reviewed for clarity, correctness and tradeoffs. We have 180 minutes and submit a public repo on GitHub user **CoeusCC**.

Our angle is spec and acceptance criteria (ACs) as a way to deliver working software quickly and reliably:
- **Spec:** an OpenAPI contract.
- **ACs:** ratified cards in Claim/Forbids/Falsifier form.
- **Conformance suite:** language-neutral and written as data.
- **Evidence:** receipts and digests at every step.

We deliver in **tiers with go/no-go gates**, so a working, demoable service exists before anything more ambitious starts.

Decisions already made:
- **Storage:** SQLite, with one shared `schema.sql`.
- **Auth:** Bearer API tokens, with notes scoped to a team.
- **Features over time:** optimistic concurrency, search, tags, pagination, team and membership endpoints, and soft delete with restore.
- **Languages:** Node/TS first. Then possibly Deno, Python, PHP, C#, Rust and Ruby, decided at Gate 3.

## Architecture: no event sourcing (ADR-0001)
State-based CRUD with a `version` column, exposed as an `ETag` and enforced with `If-Match`. The code is a pure domain core with HTTP and storage adapters around it, so it's cheap to rebuild in another language.

ADR-0001 in `docs/adr/` compares layered CRUD, hexagonal CRUD with optimistic concurrency, and event sourcing with CQRS on CloudEvents. It records the decision as a Y-statement:
> In the context of a team-shared notes service, facing concurrent edits and the need for behavior identical across implementations, we decided for state-based storage with a versioned ETag/If-Match and a domain core behind adapters, and neglected event sourcing/CQRS, to achieve lost-update protection, simple restore semantics, and a small surface one conformance suite can pin down, accepting no full edit history and no event-driven integrations.

The upgrade path is a CloudEvents change feed: an outbox table, written with the official SDKs. It goes under "what I'd do next."

## Running build digest
`docs/build-digest.md` is an append-only log with one entry per gate and per significant commit:
- Wall-clock time and tier/gate
- Commit SHA and `builddigest` (sha256 of `git ls-tree -r HEAD`, as in `SpecDLC-Research/specs/verdict-runner.md`)
- Tests run: unit and conformance pass/fail counts, plus the sha256 of the output
- Which ACs passed and which were refuted
- The go/no-go decision and why, and what we cut

`scripts/digest.sh` produces the mechanical fields. The narrative fields are written by hand. This digest feeds the README, the explainer artifact(s) and the commit history.

## Tiered delivery

### Tier 0: publish the plan to GitHub so the Grok bots can split it into issues (T+0 to T+15, first deliverable)
We favor iteration and cycle time over perfection, to leave time for review and hands-on testing.
- **Repo:** `git init`, then `gh repo create CoeusCC/team-notes-polyglot --public --source . --remote origin` (the name can still change).
- **First commit and push.** It contains:
  - `docs/PLAN.md`: this plan, with the tiers, gates and cut order.
  - `docs/adr/0001-architecture.md`: the Y-statement draft.
  - `spec/acceptance-criteria.md`: a Tier 1 AC outline (draft, not yet ratified).
  - `CLAUDE.md` / `AGENTS.md`: shared repo rules for Claude and the Grok bots.
  - `docs/build-digest.md`: seeded with entry 0.
- **GitHub setup through `gh`:**
  - Turn on Discussions: `gh repo edit --enable-discussions`.
  - Create a Project with a roadmap view: `gh project create --owner CoeusCC --title "Team Notes"`, then link it to the repo. The token currently has only `gist, read:org, repo, workflow` scopes, so **you need to run `! gh auth refresh -s project`** first.
  - Create labels: `tier:0`–`tier:5`, `gate`, `ac:<alias>`, `backend:<lang>`, `proof`.
  - Add an issue template that requires the AC alias, the falsifier, and a definition of done.
  - Open a pinned Discussion, "Plan & gates", for go/no-go calls.
- **Hand-off:** a Grok bot splits `docs/PLAN.md` into issues on the Project board, one issue per AC, task or gate. Grok also runs the pstack-heavy flows. Claude picks up issues and opens small PRs titled `<alias>: …` that close their issue.
- **Cycle time:** `scripts/digest.sh` also records how long each closed issue was open (`gh issue list --state closed --json createdAt,closedAt`) and adds it to the digest. That gives the explainer real numbers for iteration speed.
- **Gate 0:** the plan, the Discussion and the Project are live, and the bot has created the issues.

- **Grok hand-off prompt:** after the push, I commit `docs/handoff/grok-primary-prompt.md` and paste it to you in chat. The draft is in the appendix below.
- **How Claude and Grok talk to each other:**
  - **The catch:** Claude Code can't receive inbound webhooks on its own. It's a local CLI with no public endpoint.
  - **Primary channel, GitHub as the bus:**
    - Grok posts to the pinned Discussion **"Bot bus"**, or fires `repository_dispatch` events of type `grok-to-claude`.
    - Claude watches with a Monitor loop that runs `gh api graphql` (Discussion comments) and `gh api repos/.../events` about every 60 s, and replies in the same thread.
    - Every message is public, durable, and is part of the transcript evidence.
  - **Optional direct webhook, if Grok Bots needs a real HTTP target:**
    - Run a tiny local receiver (`scripts/bot-bus/receiver.mjs`) that checks an HMAC-SHA256 signature using a shared secret in `.env`, which is never committed.
    - It appends each verified message to `.bot-bus/inbox.jsonl`, and the Monitor picks it up.
    - It is exposed through `tailscale funnel <port>`; tailscale is installed and cloudflared isn't, and Grok gets the URL and secret out of band.
    - Outbound messages from Claude go to the webhook URL that Grok supplies, signed the same way.

### Tier 0b: harness
- **Repo (done in Tier 0):** pushed.
- **ub-mode:** fetch `SKILL.md` into `.claude/skills/ub-mode/` and read it first.
- **pstack:** you run `/plugin marketplace add michael-denyer/pstack-claude` and `/plugin install pstack@pstack-claude`.
- **Repo rules in `CLAUDE.md`:**
  - The spec is the source of truth.
  - Every behavior starts as an AC plus a case.
  - Implementers never record their own verdicts.
  - Commits stay small.
  - Every gate gets a digest entry.
- **Skeleton:** `spec/`, `conformance/`, `backends/node-ts/`, `docs/adr/`, `docs/build-digest.md` and `scripts/`.
- **Gate 0:** the repo is pushed, the skill is readable, and `scripts/digest.sh` works.

### Tier 1: MVP, authenticated team notes (T+15 to T+65)
**Spec for this tier**
- **`spec/openapi.yaml`** (OpenAPI 3.1). Errors use RFC 9457 `application/problem+json`.
  - **Endpoints:** `GET /health`, `GET /me`, `GET /teams` (my teams), `POST/GET /teams/{teamId}/notes`, and `GET/PATCH/DELETE /notes/{id}`.
  - **Auth:** a missing or invalid token gets 401.
  - **Access:** a non-member gets 404, which hides whether the note exists.
  - **Validation:** title 1–200 chars, body up to 100k.
- **`spec/schema.sql`:** users (sha256 of the token), teams, memberships and notes. Seed users, teams and dev tokens.
- **`spec/acceptance-criteria.md`:** about 12 cards in the `SpecDLC-Research/ac/` format, with aliases like `NOTES-SEC-AUTHZ-1`. **You ratify them**, which is checkpoint 1 at about T+30.
- **Conformance suite:**
  - `conformance/cases.json` holds data-only HTTP cases, each tagged `falsifies: <alias>`.
  - `conformance/run.mjs` takes `BASE_URL` and validates each response against the OpenAPI spec with ajv.

**Implementation:** `backends/node-ts` has a domain core, `node:sqlite` storage on Node 26 and a minimal HTTP adapter. It is written test-first under ub-mode, with `node:test` unit tests.

**Demo:** `scripts/demo.sh` walks through it with curl: Alice creates a note, Bob on the same team reads it, and Carol on another team gets a 404.

**Gate 1 (go/no-go):** every Tier 1 AC passes, the demo runs from a clean clone, and the README quickstart works. Commit, push and add a digest entry. **This is a submittable state.**

### Tier 2: concurrency and soft delete (T+65 to T+95)
**Spec**
- **ETag and If-Match:** `GET` returns an `ETag`. `PATCH` without `If-Match` gets 428, and a stale version gets 412.
- **Soft delete:** `DELETE` is a soft delete and is idempotent. `POST /notes/{id}/restore` restores a note. Lists hide archived notes unless `?archived=true` is passed.

**ACs and cases:** add about 6 more and ratify them (checkpoint 2).

**Falsification:** we add a `FAULT=` toggle for deliberate defects: lost update, team leak and hard delete. The suite **must go red** on each one. This proves the tests can fail and isn't just ceremony.

**Gate 2:** all ACs pass, every fault is caught, and there's a digest entry. This is a demoable "collaboration-safe" state.

### Tier 3: team management and search (T+95 to T+115)
**Spec**
- **Teams and membership:** `POST /teams`, `GET /teams/{teamId}`, and `PUT/DELETE /teams/{teamId}/members/{userId}`. Only the owner can change membership.
- **Search and paging:** tags (lowercased, at most 10), `?tag=`, `?q=` (case-insensitive substring), and `limit` with an opaque keyset `cursor`.

**Proof:** run the Stryker mutation tests with both the unit tests and the conformance suite, giving an "AC mutation score."

**Gate 3, the strategic decision:** with about 65 minutes left we choose one of two paths (I'll ask you with AskUserQuestion, giving a recommendation):
- **Path A, more features:** for example a CloudEvents change feed, note history, or rate limiting.
- **Path B, prove the AC approach (my expected recommendation):** rebuild the service in new languages and paradigms from only the spec, ACs and cases.
  - **How:** one subagent per backend, each in its own worktree with no access to the reference code.
  - **Order:** Python, PHP and Deno first, then C# (needs `! sudo pacman -S dotnet-sdk`), Rust and Ruby while time allows.
  - **Measure:** the number of conformance failures on each backend's first run, and the time to green. These numbers tell the "minimal disruption, few errors" story.

### Tier 4: the chosen path, with its own gate per backend or feature (T+115 to T+150)
Each backend or feature is either all green and merged, or reverted. Nothing half-done lands.
- **Verdict runner:** `scripts/conform-all.sh` produces `evidence/<backend>.json` and an AC × backend matrix.
- **Adversarial review:** a fresh subagent with only the spec and the code tries to break the contract. Real gaps become new ACs and cases. Then we run `/code-review` and pstack `interrogate`.

### Tier 5: wrap-up (T+150 to T+180), never cut
- **README:**
  - Quickstart and demo.
  - The 2–3 design choices: spec/AC-driven delivery, optimistic concurrency with 404-not-403 authorization, and the no-event-sourcing ADR.
  - Tradeoffs, and what I'd change, add or stop doing.
  - The evidence matrix and a link to the build digest.
- **Explainer HTML artifact(s), built from the build digest and evidence:**
  1. How the service works: the API, the access model and the concurrency flow.
  2. How we proved it: the tiers and gates timeline, AC → case → verdict, falsification and mutation results, and backend first-run error counts.

  Published as private claude.ai Artifacts and linked from the README. A static HTML copy goes in `docs/explainer/`.
- **Transcripts:** copy the session JSONL and `subagents/*.jsonl` from `~/.claude/projects/-home-pszeinert-Projects-bluestaq/` to `docs/transcripts/`, scan for secrets and redact them, then make the final commit and push.

## Appendix: draft prompt for the primary Grok bot
I'll fill in the real repo URL, Discussion URLs and Project URL after the push.

> You are the primary Grok bot on **CoeusCC/team-notes-polyglot**, a 180-minute take-home: a REST backend for a note-taking service shared by small teams. Claude Code (Opus 5.5) is your peer agent working locally; the human owner is Patrick. We optimize for **cycle time and iteration** over perfection—small issues, small PRs, frequent gates—so there is time left for human review and hands-on testing.
>
> **Read first:** `docs/PLAN.md` (tiers, gates, cut order), `AGENTS.md` (repo rules), `docs/adr/0001-architecture.md`, `spec/acceptance-criteria.md`, `docs/build-digest.md`.
>
> **Your tasks, in order:**
> 1. **Set up the bot bus with Claude.** Post a hello on the pinned Discussion "Bot bus" (<URL>), stating your capabilities and how you want to be reached. If you can call an HTTP webhook, reply with your outbound webhook URL. Claude will send you a tunnel URL and an HMAC-SHA256 shared secret out of band, through Patrick. Sign every webhook POST with `X-Signature-256: sha256=<hex>` over the raw body, as JSON: `{from, to, type: "question"|"handoff"|"status"|"gate", ref: "<issue/PR #>", body}`. Never put secrets in the repo, issues or discussions.
> 2. **Split `docs/PLAN.md` into issues** on Project "Team Notes" (<URL>):
>    - One issue per acceptance criterion (AC) card or implementation task, plus one issue per gate.
>    - Use the issue template: the AC alias, the falsifier, and a definition of done.
>    - Labels: `tier:N`, `gate`, `ac:<alias>`, `backend:<lang>`, `proof`.
>    - Set milestones per tier, and set the roadmap start and target dates from the time budget in the plan.
>    - Gate issues are blocked by their tier's issues.
>    - Keep each issue to 30 minutes of work or less. Split anything bigger.
> 3. **Run the pstack workflows** where they help: `poteto-mode` routing, `architect` on the Tier 1 spec, `interrogate` on each PR, and `unslop` on docs. Post your findings as PR reviews or comments in Discussions, not as direct commits to `main`.
> 4. **Coordinate the work.** Claude takes the Tier 1 Node/TS reference issues by default. Claim an issue by assigning it and commenting before you start, so no two agents work on the same thing. Post go/no-go recommendations on the "Plan & gates" Discussion. Patrick makes the final call and ratifies the ACs.
>
> **Rules:**
> - The spec (`spec/openapi.yaml`) and the ratified ACs are the source of truth. If you change behavior, change the AC, the conformance case and the spec first, in the same PR.
> - Never record verdicts or evidence for code you wrote yourself.
> - PR titles look like `<AC alias>: <summary>` and say `Closes #N`. Keep PRs small and green on `node --test` and the conformance run.
> - If you're blocked for more than 5 minutes, post in Bot bus and move to the next unblocked issue.

## Verification at every gate
- `node --test` for the unit tests, and `node conformance/run.mjs` against `BASE_URL`, both green.
- Each `FAULT` toggle turns the suite red (from Tier 2 on).
- A clean clone in the scratchpad, then the README quickstart plus `scripts/demo.sh`.
- `scripts/digest.sh` appends an entry. `git push` succeeds, and `gh repo view CoeusCC/team-notes-polyglot` shows the commit history.
