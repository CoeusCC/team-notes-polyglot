# CLAUDE.md

Read and follow `AGENTS.md`, which holds the shared rules for all agents, and `docs/PLAN.md`, which has the tiers, gates and cut order.

- Use the `ub-mode` project skill (`.claude/skills/ub-mode/SKILL.md`) for every code change.
- pstack (`/plugin install pstack@pstack-claude`) is optional locally. The Grok bots run the pstack-heavy flows on GitHub.
- Running a backend: `cd backends/node-ts && npm start`. Conformance: `BASE_URL=http://localhost:3001 node conformance/run.mjs`.
