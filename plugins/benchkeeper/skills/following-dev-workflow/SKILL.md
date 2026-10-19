---
name: following-dev-workflow
description: "Sets how much process a repository change gets: picks the task tier (quick, standard, full, research), names the Matt Pocock skills each tier requires, and adds the issue, branch, review, check and pull request rules his skills leave open. Use before the first edit in a repository (fix, add, change, refactor, rename, upgrade, remove), before issue or pull request work (push, open, merge), and before research with two or more items (compare, evaluate)."
---

# Following the dev workflow

Matt Pocock's skills do the work of each phase. This skill picks the tier, which decides which of his skills a task requires, and adds the repository rules his skills leave open.

Names: Matt Pocock's skills are `mattpocock-skills:<name>` and BenchKeeper's are `benchkeeper:<name>`, in Claude Code and Codex (plugin namespaces). Call the Skill tool once per named skill. User-invoked skills (marked U) only run when the user starts them (Claude Code: `/mattpocock-skills:<name>`, Codex `$mattpocock-skills:<name>`): suggest them and wait. Matt Pocock's skills missing: ask the user to run BenchKeeper's `setup.sh` (README quick start), and meanwhile work on a branch and run the project's checks.

## Before the first edit

- State the tier in the task line of the rules (`Tier: quick`). The user's explicit tier wins. Otherwise the change type (table below) sets the tier, and changes not listed use the Tiers table. A `Default tier:` line in `AGENTS.md` applies only when neither clearly matches. Several requests in one prompt: tier each. On a shared branch the highest tier applies. Follow-ups on an open pull request keep its tier unless the work grows.
- Standard and full, interactive: explore in plan mode before the first edit. The approved plan is the issue plan. Non-interactive: explore read-only, then write the plan.

## Tiers

| Tier | When | Required | Also loads when its trigger matches |
|---|---|---|---|
| Quick | the diff fits in one sentence | branch, edit, verify, commit, draft pull request | one targeted skill, for example `tdd` for new logic or a stack skill |
| Standard | one behavior, or a refactor that keeps behavior, approach clear | issue, branch, the existing tests covering the touched code, then `tdd` (refactor: the suite passes before and after with tests unchanged), verify, `mattpocock-skills:code-review` against the default branch with the issue as the spec, draft pull request (`pr`). The plan is a few lines in the reply and names the test seams. They then count as agreed (they replace `tdd`'s seam question) | `diagnosing-bugs` for an unknown cause, `codebase-design` for a refactor, stack skills |
| Full | several behaviors, a new capability, an uncertain approach, or a risky change | Matt Pocock's flow in [full-tier.md](full-tier.md) | `prototype` for a question that needs running code, `domain-modeling`, stack skills |
| Research | a question, comparison, evaluation or spike without a repository change | no branch or edits, scratch files outside the repository. Two or more independent items: one subagent per item in parallel (Claude Code: `model: "sonnet"`, `effort: "high"`; Codex: `explorer` subagents), each researching directly without the `research` skill or further agents, then one merged answer with sources | `research` (it writes its notes into the repository: here they go outside it unless the user asks, an override of his skill), `prototype` for a spike |

- `mattpocock-skills:code-review` and his tracker skills read the tracker doc named in the `## Agent skills` block (`docs/agents/`). Missing: ask the user to run `/mattpocock-skills:setup-matt-pocock-skills` (Codex: `$mattpocock-skills:setup-matt-pocock-skills`), or in a non-interactive run say so and leave that review out.
- Risky: a change to authentication, permissions, secrets or input validation, to production data, deploy or production configuration, or an irreversible action. Name the full tier and ask. The answer decides, but the security review in the pull request rules always runs.
- The work grows (more than one behavior, code not yet read, an uncertain approach, or a risky change): say so, move to the tier it fits, and run that tier's skipped steps before the next edit.
- Research prompts on benchmarks add the evidence bar: independent versus vendor-run, version, harness, model and effort, task count, runs per arm, deltas and p-values, advertised claims next to measured ones.
- Non-interactive runs (headless, CI): a skill's approval gate or a phase boundary is not a stop. An issue plan counts as approved: create the issue and say so in one line.
- Sessions: standard, once the plan is in the issue, suggest `/clear` and continue from `gh issue view`. Full: keep grilling, `/to-spec` and `/to-tickets` in one session. Another harness, directory or person picks up the work: post the state and the next step as a comment on the issue or pull request, and suggest `/handoff` (U).

## Change types

The change type sets the tier and the check before reporting done, in addition to Verify. Never run commands that change shared or production systems as a check (`terraform apply`, `kubectl apply`, `helm upgrade`, migrations against shared or production databases).

| Change | Tier | Check before done |
|---|---|---|
| Docs, typo | quick | docs build, link check |
| Config value | quick. Full (risky) for production, deploy or security config | tests, schema or lint |
| Log line | quick. Standard when it logs request or user data | |
| Tests only | quick | |
| Dependency patch or minor | quick | full test suite, package audit |
| UI tweak | quick | browser check, screenshot baselines updated only for intended changes |
| UI behavior in an existing flow | standard. Full for a new page or flow | end-to-end and accessibility tests |
| Bug, known cause | standard | |
| Bug, unknown cause | standard. Move up once the cause shows more | `diagnosing-bugs` |
| Refactor | standard within one module that keeps its interface and its tests. Full across modules, or when the interface changes (`codebase-design` deepening replaces tests) | |
| Dependency major or security advisory (route by the advisory, not the version) | standard | changelog read, full suite, package audit |
| CI workflow | standard. Full (risky) for deploy steps | `actionlint` |
| Metrics, alerts | standard | |
| Feature | full | |
| Infrastructure as code | full | Terraform/OpenTofu `fmt -check`, `validate`, `plan`; Ansible `ansible-lint`, `--check --diff`; Kubernetes `kubeconform`, `kubectl diff`; Helm `helm lint`, `helm template` |
| Schema migration | full | expand and contract, migrate a throwaway database |
| Production data fix | full | dry run on a copy. The user runs it |
| Auth, permissions, secrets, input validation | full | tests for denied paths |
| Performance | full | benchmark before and after on the same machine |

## Issues, branches and pull requests

- Flow in a GitHub repository: issue, branch, commits, pull request. Quick skips the issue. Creating or editing a GitHub issue needs the user's approval of its plan (title, goal, acceptance criteria, tasks). If the user declines, continue without one. Pushing a feature branch and opening a pull request need no approval. Skipping the flow needs the user's instruction.
- On the default branch, create `<type>/<issue>-<slug>`, or `<type>/<slug>` without an issue, before the first edit.
- Commits: `<type>: <summary>` (Conventional Commits), with `Refs #<issue>` in the footer when an issue exists, so `mattpocock-skills:code-review` finds the spec.
- Before pushing code (standard, full) or a risky change: a correctness review of the commits. Claude Code: `/code-review` with no target, not Matt Pocock's review. Codex: a correctness pass that gets the diff, the code it touches and the plan, and reports only gaps that affect correctness or the issue's requirements. Risky changes also get `/security-review` (it compares with the `origin` default branch). Without `origin`, and in Codex: a security pass by a subagent over authentication, permissions, secrets and input handling. Docs-only changes skip this unless risky.
- Pull requests: draft first (`gh pr create --draft`), body from `pr` with `Closes #<issue>` when an issue exists and the key decisions (structure, storage, deployment, rejected options). A one-way door in its merge danger counts as risky. After pushing, wait for the checks (`gh pr checks --watch`) and mark ready (`gh pr ready`) when they pass. Review comments and failing checks: new commits on the same branch.
- No GitHub remote or `gh auth status` fails: local branch only, no issue or pull request, the pre-push review before reporting done (standard, full), say so in one line.

## Verify

Before reporting done: the project's own build, types, lint and tests, each reported with its command and result. UI changes also in a browser (Playwright MCP), next to the UI tests, never instead of them. Browser and build output (`.playwright-mcp/`, `test-results/`, screenshots) is git-ignored or deleted. Report failures as they are.

After a milestone or about every 10 merged pull requests, suggest `/benchkeeper:maintaining-repos`.
