# Benchmark scenarios

Comparison matrix of the arms in `bench/PROTOCOL.md`. Every arm gets the same brief, hidden tests, scorer, app review, timeout and follow-up rule. Images are built by `bench/image/Containerfile` and `bench/image/install-arm.sh`, and each trial runs in its own container with only its arm's components.

## Claude Code arms (Claude Code 2.1.299, subscription)

| Arm | Skill framework | Ponytail | BenchKeeper layer | Spec tool | Workflow owner |
|---|---|---|---|---|---|
| A | none | no | no | none | the model |
| B | none | yes | no | none | the model, Ponytail's coding rules |
| F | agent-skills 0.6.13 (plugin) | no | no | none | agent-skills |
| G | Superpowers v7.0.0 (plugin) | no | no | none | Superpowers |
| H | ECC v2.2.3 `minimal` | no | no | none | ECC (its rules, agents, skills) |
| I | agent-skills | no | no | OpenSpec 1.14.1 | agent-skills, OpenSpec available |
| J | Superpowers | no | no | OpenSpec | Superpowers, OpenSpec available |
| K | ECC | no | no | OpenSpec | ECC, OpenSpec available |
| L | agent-skills | yes | yes | none | BenchKeeper rules, phases mapped to agent-skills |
| M | Superpowers | yes | yes | none | BenchKeeper rules, phases mapped to Superpowers |
| N | ECC | yes | yes | none | BenchKeeper rules, phases mapped to ECC |
| C | agent-skills | yes | yes | OpenSpec | BenchKeeper today: agent-skills phases, OpenSpec specs |
| D | Superpowers | yes | yes | OpenSpec | Superpowers phases, OpenSpec specs |
| E | ECC | yes | yes | OpenSpec | ECC phases, OpenSpec specs |
| O | none | yes | no | OpenSpec | OpenSpec |
| P | none | yes | no | Spec Kit v1.2.0 | Spec Kit |
| V | Matt Pocock's skills v1.3.1 (plugin) | no | no | none | Matt Pocock's skills |
| W | Matt Pocock's skills | no | no | OpenSpec | Matt Pocock's skills, OpenSpec available |
| X | Matt Pocock's skills | yes | yes | none | BenchKeeper rules, phases mapped to Matt Pocock's skills |
| Y | Matt Pocock's skills | yes | yes | OpenSpec | Matt Pocock's skills phases, OpenSpec specs |
| AB | none | no | no | OpenSpec | OpenSpec |
| AC | none | no | no | Spec Kit | Spec Kit |
| AD | Matt Pocock's skills | yes | v3 | none | BenchKeeper rules and `following-dev-workflow` (setup-v2.9), phases mapped to Matt Pocock's skills |
| AE | Matt Pocock's skills | yes | v3 | OpenSpec | as AD, OpenSpec owns spec and plan, Matt Pocock's execution skills |

BenchKeeper layer: rules (agent-skills: `bench/arms/bk-rules.md`, the pinned copy of `rules/global.md` at `7e17860`; Superpowers, ECC, Matt Pocock's skills: `bench/arms/superpowers.rules.md`, `ecc.rules.md`, `mattpocock.rules.md`), candidate rules, Ponytail v5.2.0 `full`, find-skills, BenchKeeper skills, Playwright MCP 0.0.83 with Chromium, and the project `/project-setup` leaves. Layer v3 (AD, AE): the rules and `following-dev-workflow` of setup-v2.9 (`bench/arms/bk-v3*`) instead of the pinned rules, candidate rules and old setup skills.

## OpenCode arms (OpenCode 1.19.0, Anthropic API key)

Excluded from new runs since protocol 1.16 (owner decision 2026-10-17). The recorded OpenCode results stay in `bench/results` and the reports.

| Arm | Scenario ID | Installed | Workflow owner |
|---|---|---|---|
| Q | `opencode-openspec-targeted-skills` | OpenSpec 1.14.1 for OpenCode (profile with verify: propose, explore, apply, verify, archive); project skills `test-driven-development`, `security-and-hardening`, `code-review-and-quality`, `debugging-and-error-recovery` (agent-skills 0.6.13, commit `aeac41d`, with `references/`) and `vercel-react-best-practices` (vercel-labs/agent-skills commit `063bee9`) | OpenSpec: specification, planning, tasks, verification; the skills inside tasks |
| R | `opencode-superpowers` | Superpowers v7.0.0 (commit `bb92a77`) as the official OpenCode plugin from a local directory. No OpenSpec, no other skills | Superpowers: brainstorming, plans, subagent execution, TDD, verification, review |
| S | `opencode-openspec-superpowers` | oso, `@moyaspace/openspec-superpowers-opencode` 1.1.1 (MIT, gitHead `a67cf5b`): `oso init` (OpenSpec bridge schema `superpowers-bridge-opencode`, 13 `/opsx-*` commands, `AGENTS.md`, worktree isolation); its required Superpowers v6.1.1 through OpenCode's plugin manager; OpenSpec 1.14.1 | OpenSpec owns the artifact graph and task checkboxes; Superpowers owns brainstorming, `writing-plans` and apply (subagent-driven development, TDD, review) in `.worktrees/<name>` |
| T | `opencode-addy` | all 25 agent-skills 0.6.13 skills in `.opencode/skills/` with `references/`, and the project `AGENTS.md` template from `docs/opencode-setup.md`. No OpenSpec, no Superpowers | agent-skills (define, plan, build, verify, review, ship), invoked through the `skill` tool as the template directs |
| U | `opencode-addy-openspec` | OpenSpec 1.14.1 for OpenCode (profile with verify); agent-skills 0.6.13 without `spec-driven-development`, `planning-and-task-breakdown`, `incremental-implementation`, `idea-refine`, `interview-me`, `using-agent-skills`; project `AGENTS.md` `bench/arms/opencode-addy-openspec.AGENTS.md` | OpenSpec: requirements, specs, design, tasks; agent-skills for architecture, implementation, testing, debugging, security, review |
| Z | none | Matt Pocock's skills v1.3.1 (the 27 plugin skills) in `.opencode/skills/` | Matt Pocock's skills |
| AA | none | as Z, plus OpenSpec 1.14.1 for OpenCode | Matt Pocock's skills, OpenSpec available |

Excluded: MerrillLi/openspec-superpowers (owner decision 2026-10-14). Its README loads the npm name `openspec-superpowers`, which belongs to an unrelated maintainer. It has no tags and no license file (`package.json` says MIT). Latest commit `88033a7`.

### Isolation and settings (OpenCode)

- Each OpenCode image has no Claude Code credentials. The Claude Code CLI binary is present in every image but unused and not signed in.
- Every turn runs with `OPENCODE_DISABLE_CLAUDE_CODE=1` (no `CLAUDE.md`, `~/.claude` or `.claude/skills`), `OPENCODE_DISABLE_EXTERNAL_SKILLS=1` (no `.agents/skills`), `OPENCODE_DISABLE_AUTOUPDATE=1`, `OPENCODE_DISABLE_LSP_DOWNLOAD=1` and `OPENCODE_DISABLE_MODELS_FETCH=1` (model catalog fetched once at image build).
- Run: `opencode run --model anthropic/<model> --variant <effort> --format json --auto`. Follow-ups with `--continue`. The model and effort are the same as the Claude Code arms of the run.
- Audit: `opencode debug skill` and `opencode debug config` before the first turn (required and forbidden skills and the plugin per arm, `bench/scripts/opencode.mjs`).
- Cost and tokens: every session of the trial is exported (`opencode export`), subagent sessions found through the task calls that started them (runs before 2026-10-15 08:00 exported only the main session). OpenCode computes cost from its catalog prices (API prices).

### Differences from the Claude Code arms (known limitations)

- Runtime: OpenCode's agent loop, tools and system prompt differ from Claude Code's. OpenCode arms are compared with each other and, with that caveat, with the Claude Code arms.
- Credentials: API key instead of the subscription, because OpenCode cannot use Claude subscriptions (OpenCode v1.3.0 removed it after "anthropic legal requests", and Anthropic restricts subscription OAuth to its own apps).
- Superpowers version: oso (S) pins Superpowers v6.1.1, R uses v7.0.0.
- agent-skills on OpenCode has no session bootstrap and no slash commands. Skill use depends on the model following `AGENTS.md`.
- oso's workflow uses `/opsx-*` commands, which a headless run cannot type. The agent follows them only through `AGENTS.md`.

## Briefs

Each brief has its section in `bench/PROTOCOL.md`. All briefs run through the same arms and images.

- `winery-react`: server app with React (bookings, staff sign-in). Hidden tests F1 to F6.
- `winery-iterative`: `winery-react` plus four change requests as follow-up turns.
- `cartridges`: static app (25 C.I.P. cartridges, 2D drawings, print view, works from `file://`). Hidden tests C1 to C6.
- `openballistics`: brownfield, three steps in separate sessions on a clone of OpenBallistics.
- `skill-*`: seven targeted tasks, one per phase, for the per-skill ratings.

## Failure classes

A trial is reported in exactly one class:
- installation failure: the image does not build, or the delivery audit fails (wrong or missing components);
- execution failure: the agent run errors, times out, or stops on a usage limit, overload or authentication error (infrastructure error: rerun once, then excluded);
- task-quality failure: the run finishes and the scorer reports missing features, a build or start failure, accessibility or Lighthouse findings.

## Future dimensions (not part of this benchmark)

- Context7: MCP-based retrieval of current library and framework documentation. It could be evaluated as an add-on across the relevant scenarios, holding everything else equal.
- RTK: tool-output and token optimization. It could be evaluated the same way, for its effect on tokens, cost and quality.

Neither is installed, configured or enabled in any arm.
