# Proposal

Issue: [#24](https://github.com/ESchuderer/BenchKeeper/issues/24)

## Why

Every change runs the full SDLC (issue, spec, plan, tests, review, draft PR), so small changes take as long as features, and research has no defined flow. The 2026-10-14 evaluations found no independent quality gain from larger workflow bundles (ECC, Superpowers) and a measured token and time cost for them; Anthropic's best practices skip planning for small diffs.

## What Changes

- `rules/global.md`: task tiers (quick, standard, full, research) chosen per request, stated in one line, overridable by the user, escalated when scope grows; the SDLC phases apply per tier.
- Research tier: one subagent per item with a shared evidence bar; Claude Code research workers on Sonnet.
- Project default tier in `AGENTS.md`; `project-setup` step 5 asks for it with the spec tool.
- The `using-agent-skills` router line is replaced by description-based skill loading.
- `EVALUATIONS.md`, site and README: new evaluations, tiers, and exclusions.

## Capabilities

### New Capabilities

- `task-routing`: how the global rules assign a request to a tier and which steps each tier runs.

### Modified Capabilities

None.

## Impact

`rules/global.md` (symlinked into `~/.claude/rules`, copied to `~/.codex/AGENTS.md` by `/global-setup`), `skills/project-setup/SKILL.md`, `EVALUATIONS.md`, `web/src/data/facts.json`, `web/src/components/Page.tsx`, `README.md` (generated).
