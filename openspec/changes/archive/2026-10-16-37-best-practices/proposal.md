# Proposal

Issue: [#37](https://github.com/ESchuderer/BenchKeeper/issues/37) (part A: documented best practices; the evidence-based decisions wait for the complete benchmarks)

## Why

`rules/global.md` loads in every Claude Code and Codex session. About 70% of it (issue and PR flow, tiers, the change-type table, SDLC, Maintain) is a workflow manual that most turns do not need. Rules that must hold every time are prose only, and three rules contradict each other. Claude Code's best practices (https://code.claude.com/docs/en/best-practices) say: "CLAUDE.md is loaded every session, so only include things that apply broadly. For domain knowledge or workflows that are only relevant sometimes, use skills instead", "Use hooks for actions that must happen every time with zero exceptions", and "Use `disable-model-invocation: true` for workflows with side effects". The memory docs add: "if two instructions contradict each other, Claude may pick one arbitrarily" (https://code.claude.com/docs/en/memory).

## What Changes

- `rules/global.md`: an always-on core (ask, brevity, structure, sources, confidence, forbidden characters, scope, environment, safety, context, a compaction instruction) and a short pointer that names when to load the workflow skill. The three contradictions are resolved.
- New skill `skills/sdlc/`: tiers, change types, issue, branch and pull request flow, SDLC phases with agent-skills and OpenSpec, the research flow. Loaded by the model before any edit in a repository, before issues, pushes and pull requests, and before research with several items.
- New skill `skills/maintain/`: the Maintain pass, plus `/doctor prompt-audit` and `/skill-doctor`; user-invoked only.
- `skills/global-setup`, `skills/project-setup`, `skills/maintain`: never start on their own (`disable-model-invocation: true` for Claude Code, `agents/openai.yaml` with `allow_implicit_invocation: false` for Codex, https://learn.chatgpt.com/docs/build-skills).
- Permission rules for Claude Code, installed by `global-setup` (native, no hooks, owner decision 2026-10-16), all ask rules: before skipping git hooks, force pushes, branch deletion, pushes to `main` or `master`, hard resets, `git clean`, rebases, history rewrites and pull request merges. Em dashes, emojis and commits on the default branch stay prose rules. Codex keeps all of them as prose.
- `global-setup`: links the new skills, merges the permission rules (existing rules stay, in their order), checks `CLAUDE_CODE_DISABLE_ADVISOR_TOOL`.
- Duplicates removed: the `/clear` suggestion (Claude Code shows it natively), the Ponytail `full` default (its config sets it), restated skill triggers, the host/container split repeated in `global-setup`.
- Versioning: root `CHANGELOG.md`; tags `setup-v1.0` (state before this change) and `setup-v2.0` (after merge).
- README, `web/src/data/facts.json` and the site describe the new layout.

## Not in this change

- Keep, change or drop decisions on skills, OpenSpec, tiers and Ponytail: they wait for #29, #31 and #36.
- `bench/CHANGELOG.md`: added on the benchmark branch after the running benchmarks finish, so their branch does not move under them.
- Applying the new setup to this machine: merging and `/global-setup` are one step, only on the owner's go-ahead (the rules symlink points into the checkout, so a pull switches the core before `sdlc` is linked). The running benchmarks use prebuilt images and are not affected by this branch.
- Benchmark branches: merging `main` into `feat/19` or `feat/31` waits until the runs finish; then `bench/scripts/arm-rules.mjs` (D and E arm rules generated from the old monolithic file) and `bench/image/install-arm.sh` (BK-layer arms need `sdlc`) need updates.
- `permissions.defaultMode`: left unset (auto since Claude Code 2.1.284); an owner decision.

## Capabilities

### Modified Capabilities

- `task-routing`: where the tier rules live and how they are loaded; deterministic guards.

## Impact

`rules/`, `skills/`, `README.md`, `web/`, `CHANGELOG.md`, `AGENTS.md`.
