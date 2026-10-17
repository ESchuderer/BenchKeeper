---
name: following-dev-workflow
description: "Sets the development workflow for any repository change: picks the task tier (quick, standard, full, research) and its steps: GitHub issue, branch, tests first, OpenSpec spec, review before push, draft pull request. Use before the first edit in a repository, before creating or editing a GitHub issue, before research with two or more independent items, before pushing, and before opening or merging a pull request."
when_to_use: "Fix, add, change, refactor, rename, update, upgrade or remove anything in a repository; compare or evaluate several tools or options; push, open a PR, or merge."
---

# Following the dev workflow

Skills from agent-skills (addyosmani) drive each phase. OpenSpec owns the spec files when the repository has `openspec/`. These rules take precedence over a skill's own triggers, such as a skill asking for a spec or a review on every change. Ponytail `full` applies during the build phases unless the user selects another level.

## Task tiers

State the tier in one line (`Tier: quick`) before the first edit or subagent. A question answered without either needs no tier line. The user's explicit tier wins. A `Default tier:` line in `AGENTS.md` applies when the request does not clearly match another tier. Several requests in one prompt: tier each. On a shared branch the highest tier applies. Follow-ups on an open pull request keep its tier unless the work grows.

Risky means a change to authentication, permissions, secrets or input validation, to production data, deploy or production configuration, or an irreversible action. For a risky change, name the full tier and ask. The answer decides, but a risky change always gets the pre-push review.

When the work grows (more than one behavior, several files not counting generated ones such as lockfiles, code not yet read, an uncertain approach, or a risky change), move to the tier it now fits, say so, and run that tier's skipped steps (issue, spec, plan) before the next edit. Work beyond one session: split it into issues first, each with its own tier.

- Quick (the diff fits in one sentence): branch, edit, verify, commit, draft pull request. No issue, spec, plan, test first or pre-push review. Ponytail's self-check for new non-trivial logic still applies.
- Standard (one behavior, or a refactor that keeps behavior; approach clear): issue, branch, failing test first where a test suite exists (refactor: the suite passes before and after with tests unchanged), build, verify, review before push, draft pull request. No spec or OpenSpec change. The plan is a few lines in the reply.
- Full (several behaviors, new capability, uncertain approach, or a risky change): every phase below (Phases).
- Context: quick, suggest `/clear` after the pull request; standard and full, suggest `/compact` after the plan (keeping the tier, issue, branch, files and checks) and `/clear` after the pull request.
- Research (question, comparison, evaluation or spike without a repository change): no branch or edits. Scratch files outside the repository are allowed. Edits asked for afterwards get their own tier. One fact: answer directly. Two or more independent items: one subagent per item in parallel (Claude Code: `model: "sonnet"`, `effort: "high"`; Codex: `explorer` subagents). Each prompt states the objective, output format and sources to use. Where claims rest on benchmarks, it adds the evidence bar: independent versus vendor-run results; version, harness, model and effort, task count, runs per arm, deltas and p-values; advertised claims next to measured ones; unverified items labeled. Merge the results into one answer with sources.

## Change types

Default tier and the check before reporting done, in addition to Verify below. Run the checks the repository has. Never run commands that change shared or production systems as a check: no `terraform apply`, `kubectl apply`, `helm upgrade`, or migrations against shared or production databases.

| Change | Tier | Check before done |
|---|---|---|
| Docs, typo | quick | docs build, link check |
| Config value | quick; full (risky) for production, deploy or security config | tests, schema or lint |
| Log line | quick. Standard when it logs request or user data | no secrets or personal data logged |
| Tests only | quick | new tests pass. No production code in the diff |
| Dependency patch or minor | quick | full test suite, package audit |
| UI tweak | quick | browser check. Screenshot baselines updated only for intended changes |
| UI behavior in an existing flow | standard. Full for a new page or flow | end-to-end and accessibility tests |
| Bug, known cause | standard | failing reproducer test first |
| Bug, unknown cause | standard. Move up once the cause shows more | investigate first (`debugging-and-error-recovery`) with a reproducer test on the branch |
| Refactor | standard within one module. Full across modules | suite passes before and after, tests unchanged |
| Dependency major or security advisory (route by advisory, not version; not risky unless it changes auth or secrets handling) | standard | changelog read, full suite, package audit |
| CI workflow | standard. Full (risky) for deploy steps | `actionlint` |
| Metrics, alerts | standard | no secrets or personal data |
| Feature | full | tests, types, lint, build |
| Infrastructure as code | full | Terraform/OpenTofu `fmt -check`, `validate`, `plan`; Ansible `ansible-lint`, `--check --diff`; Kubernetes `kubeconform`, `kubectl diff`; Helm `helm lint`, `helm template` |
| Schema migration | full | expand and contract. Migrate a throwaway database |
| Production data fix | full | dry run on a copy. The user runs it |
| Auth, permissions, secrets, input validation | full | `security-and-hardening` while building, `security-review` before push (Claude Code), tests for denied paths |
| Performance | full | benchmark before and after on the same machine |

## Issues, branches and pull requests

- Default flow in a GitHub repository: issue, branch, commits, pull request (`git-workflow-and-versioning`). The quick tier skips the issue. Pushing feature branches and opening pull requests need no extra confirmation. Creating or editing a GitHub issue needs confirmation: present the plan (title, goal, acceptance criteria, tasks) first and create it only after the user approves. Merging, pushing to the default branch and skipping the flow need the user's instruction.
- Before the first file edit, check the current branch. On the default branch (`gh repo view --json defaultBranchRef`), create `<type>/<issue>-<slug>` (for example `fix/42-null-config`), or `<type>/<slug>` when the change has no issue. On another branch or worktree, keep it.
- Commits: atomic, message `<type>: <summary>` (Conventional Commits).
- Pull requests: open as draft (`gh pr create --draft`), body contains `Closes #<issue>` when an issue exists and lists the key decisions when the change made any (structure, storage, deployment, rejected options). Mark ready (`gh pr ready`) after checks pass. Review comments and failing checks: new commits on the same branch, no force push or rebase unless the user asks.
- No GitHub remote or `gh auth status` fails: local branch only, skip issue and pull request, run the review below before reporting done (standard, full), say so in one line.
- Before `git push` or opening a pull request that contains code or risky changes, review the commits being pushed for correctness bugs (Claude Code: `code-review`, otherwise `code-review-and-quality`), giving the reviewer the diff, the code it touches and the plan or spec summary. For a risky change, also run `security-review` (Claude Code). If either finds issues, report them and wait for the user before pushing. Skip when only docs change or the tier is quick, unless the change is risky.
- OpenSpec (repository has `openspec/`, full tier): after the issue step, create the branch, then write the OpenSpec change there (`openspec-propose`, change name `<issue>-<slug>` or `<slug>`, issue linked in `proposal.md`). Commit it with the code. Run `openspec-archive-change` on the branch before the pull request is merged, never on the default branch.

## Phases

- Understand: `AGENTS.md`, the issue if one is given (`gh issue view <n>`), and the code the change touches, before any edit.
- Track (standard, full): without an issue, present the plan and create one after approval (above). If the user declines, continue without one. Then branch (above).
- Conditional skills: load one when the task matches its description, in any phase (for example `interview-me`, `debugging-and-error-recovery`, `security-and-hardening`). The tiers, the phases, OpenSpec, and the issue and pull request flow here take precedence.
- Non-interactive runs (headless, CI): a skill's approval gate or a phase boundary is not a stop. State the assumption in one line and continue to the next phase.
- Specify (full): `spec-driven-development`. With `openspec/`: write the result as an OpenSpec change (`openspec-propose`), not a separate spec file. Without it: plan mode. Record, where they apply, the decisions an agent does not take on its own: deployment target, data storage, module boundaries, core types and interfaces. Ask the user where the request leaves one open (non-interactive runs: state the assumption). Write a skeleton first (folders, interfaces or signatures, a short note per module on its boundary) only when the user asks for it or the repository has no structure yet.
- Plan (full): `planning-and-task-breakdown`. With OpenSpec the tasks live in the change's `tasks.md`.
- Build: `incremental-implementation`, tests first where the repository has a test suite (`test-driven-development`; standard, full). With OpenSpec through `openspec-apply-change`. Assess simplicity within `code-review-and-quality`. Use `code-simplification` where needed within scope. When the work drifts materially from the plan or spec (a different design or scope), or a result cannot be explained against them, discard the worktree or local branch created for this task and not yet pushed, add the cause to the plan, and restart in a fresh context (a new subagent, or ask the user to start a new session), instead of patching. A pushed branch is deleted only after the user's confirmation.
- Verify: the project's own build, types, lint and tests before reporting done, not repeated re-reading of finished work; UI changes in a browser (Playwright MCP) in addition to tests the project's test command runs for the UI logic, never instead of them. Before done: a new project or app has a README (setup, run, test, configuration), and a change to setup or behavior updates it. Browser and build output (`.playwright-mcp/`, `test-results/`, screenshots) is git-ignored or deleted. Report failures as they are. Show the evidence (command and result).
- Review and ship: code review before push (above); push the branch and open a draft pull request (above); wait for checks (`gh pr checks --watch`, `ci-cd-and-automation`), report failures as they are, mark ready when they pass; `openspec-archive-change` on the branch (above). Merge only on the user's instruction.
- Maintain: after a milestone or a large merge, suggest that the user runs `/maintaining-repos` (Codex: `$maintaining-repos`).

## Opt-in for hard tasks

Only when the user explicitly asks for them.

- Best-of-N: run the same task in 2 or 3 worktrees in parallel, pick the result by its tests first and then by review, and continue with the chosen one. The others are discarded.
- Mutation testing on the changed files, where the repository has a mutation testing tool (for example Stryker or mutmut): report the surviving mutants and add tests for the behavior they reveal.
