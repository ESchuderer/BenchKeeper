---
name: following-dev-workflow
description: "Sets how much process a repository change gets: picks the task tier (quick, standard, full, research) and hands each phase to Matt Pocock's skills (grilling, tdd, code-review, pr), adding the issue, branch, review, check and pull request rules his skills leave open. Use before the first edit in a repository, before creating or editing a GitHub issue, before pushing or opening a pull request, and before research with two or more independent items."
when_to_use: "Fix, add, change, refactor, rename, update, upgrade or remove anything in a repository; compare or evaluate several tools or options; push, open a PR, or merge."
---

# Following the dev workflow

Matt Pocock's skills do the work of each phase. This skill picks the tier, which decides how much of his flow a task gets, and adds the repository rules his skills leave open. It takes precedence over a skill's own triggers. User-invoked skills are written `/name` (Claude Code), `$name` in Codex. Matt Pocock's skills are `mattpocock-skills:<name>` in Claude Code and `<name>` in Codex.

## Before the first edit

- Read `AGENTS.md`, the issue if one is given (`gh issue view <n>`), and the code the change touches.
- State the tier in one line (`Tier: quick`) before the first edit, command or subagent. A question answered without either needs no tier line. The user's explicit tier wins. Otherwise the change type (Change types) sets the tier, and changes not listed there use the Tiers table. A `Default tier:` line in `AGENTS.md` applies only when neither clearly matches. Several requests in one prompt: tier each. On a shared branch the highest tier applies. Follow-ups on an open pull request keep its tier unless the work grows.
- Standard and full use Matt Pocock's repository setup (`docs/agents/issue-tracker.md`). Missing: ask the user to run `/setting-up-projects`. Non-interactive runs: state that it is missing and leave out `mattpocock-skills:code-review`.

## Tiers

| Tier | When | Steps |
|---|---|---|
| Quick | the diff fits in one sentence | branch, edit, verify, commit, draft pull request. No issue, plan, test first or review. Ponytail's self-check for new non-trivial logic still applies |
| Standard | one behavior, or a refactor that keeps behavior, approach clear | issue, branch, the existing tests covering the touched code, then `tdd` (refactor: the suite passes before and after with tests unchanged), verify, `mattpocock-skills:code-review` against the default branch with the issue as the spec, draft pull request. The plan is a few lines in the reply and names the test seams, which then count as agreed |
| Full | several behaviors, a new capability, an uncertain approach, or a risky change | read [full-tier.md](full-tier.md) |
| Research | a question, comparison, evaluation or spike without a repository change | no branch or edits, scratch files outside the repository. Edits asked for afterwards get their own tier. One fact: answer directly. Two or more independent items: one subagent per item in parallel (Claude Code: `model: "sonnet"`, `effort: "high"`; Codex: `explorer` subagents), then one merged answer with sources |

- Risky: a change to authentication, permissions, secrets or input validation, to production data, deploy or production configuration, or an irreversible action. Name the full tier and ask. The answer decides, but a risky change always gets the security review before push.
- The work grows (more than one behavior, code not yet read, an uncertain approach, or a risky change): say so, move to the tier it fits, and run that tier's skipped steps before the next edit. Work beyond one session: full tier.
- Research prompts state the objective, output format and sources. Where claims rest on benchmarks, they add the evidence bar: independent versus vendor-run, version, harness, model and effort, task count, runs per arm, deltas and p-values, advertised claims next to measured ones, unverified items labeled.
- Other skills, in any tier when the task matches: `diagnosing-bugs` for a bug with an unknown cause, `prototype` for a design question that needs running code, `codebase-design` where the structure needs it. `research` saves its findings outside the repository unless the user asks for a file in it.
- Non-interactive runs (headless, CI): a skill's approval gate, a question to the user or a phase boundary is not a stop. State the assumption in one line and continue. An issue plan counts as approved: create the issue and say so in one line.
- Standard and full: suggest `/compact` after the plan. Unfinished work at the end of a session: post the state and the next step as a comment on the issue or pull request, and suggest `/handoff` for the next session.

## Change types

The change type sets the tier and the check before reporting done, in addition to Verify. Run the checks the repository has. Never run commands that change shared or production systems as a check (`terraform apply`, `kubectl apply`, `helm upgrade`, migrations against shared or production databases).

| Change | Tier | Check before done |
|---|---|---|
| Docs, typo | quick | docs build, link check |
| Config value | quick. Full (risky) for production, deploy or security config | tests, schema or lint |
| Log line | quick. Standard when it logs request or user data | no secrets or personal data logged |
| Tests only | quick | new tests pass, no production code in the diff |
| Dependency patch or minor | quick | full test suite, package audit |
| UI tweak | quick | browser check, screenshot baselines updated only for intended changes |
| UI behavior in an existing flow | standard. Full for a new page or flow | end-to-end and accessibility tests |
| Bug, known cause | standard | failing reproducer test first |
| Bug, unknown cause | standard. Move up once the cause shows more | `diagnosing-bugs`, reproducer test on the branch |
| Refactor | standard within one module. Full across modules | suite passes before and after, tests unchanged |
| Dependency major or security advisory (route by the advisory, not the version) | standard | changelog read, full suite, package audit |
| CI workflow | standard. Full (risky) for deploy steps | `actionlint` |
| Metrics, alerts | standard | no secrets or personal data |
| Feature | full | tests, types, lint, build |
| Infrastructure as code | full | Terraform/OpenTofu `fmt -check`, `validate`, `plan`; Ansible `ansible-lint`, `--check --diff`; Kubernetes `kubeconform`, `kubectl diff`; Helm `helm lint`, `helm template` |
| Schema migration | full | expand and contract, migrate a throwaway database |
| Production data fix | full | dry run on a copy. The user runs it |
| Auth, permissions, secrets, input validation | full | security review, tests for denied paths |
| Performance | full | benchmark before and after on the same machine |

## Issues, branches and pull requests

- Flow in a GitHub repository: issue, branch, commits, pull request. Quick skips the issue. Creating or editing a GitHub issue needs the user's approval of its plan (title, goal, acceptance criteria, tasks). If the user declines, continue without one. Pushing a feature branch and opening a pull request need no approval. Merging, pushing to the default branch and skipping the flow need the user's instruction.
- Before the first edit, check the branch. On the default branch, create `<type>/<issue>-<slug>`, or `<type>/<slug>` without an issue. On another branch or worktree, keep it.
- Commits: atomic, `<type>: <summary>` (Conventional Commits).
- Before pushing code (standard, full) or a risky change: review the commits for correctness bugs (Claude Code: the built-in `code-review`; Codex: a correctness pass), giving the reviewer the diff, the code it touches and the plan. Risky changes also get a security review (Claude Code: `security-review`; Codex: a pass over authentication, permissions, secrets and input handling). Fix findings within the task's scope. Report the others and wait for the user. Docs-only changes skip this unless risky.
- Pull requests: draft first (`gh pr create --draft`), body from `pr` with `Closes #<issue>` when an issue exists and the key decisions (structure, storage, deployment, rejected options). After pushing, wait for the checks (`gh pr checks --watch`) and mark ready (`gh pr ready`) when they pass. Review comments and failing checks: new commits on the same branch, no force push or rebase unless the user asks.
- No GitHub remote or `gh auth status` fails: local branch only, no issue or pull request, the pre-push review before reporting done (standard, full), say so in one line.

## Verify

Before reporting done: the project's own build, types, lint and tests. UI changes also in a browser (Playwright MCP), next to the UI tests, never instead of them. Browser and build output (`.playwright-mcp/`, `test-results/`, screenshots) is git-ignored or deleted. Report failures as they are, with the command and its result.

After a milestone or about every 10 merged pull requests, suggest `/maintaining-repos`.
