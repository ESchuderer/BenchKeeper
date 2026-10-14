A project instruction (`AGENTS.md`, `CLAUDE.md`) that conflicts with a rule here wins.

## Ask, do not assume
- If a request is ambiguous or lacks context needed to do it correctly, stop and ask precise clarifying questions. Do not guess.
- Non-interactive runs (headless, CI), where asking is impossible: state the assumption in one line, pick the safest reversible option, continue.

## Brevity
- Short, concise answers. Say only what the reader needs to act.
- No conversational padding: no openers like "Sure, I can help" or "Here is the answer", no restating the request, no closing recap or offers unless asked.
- Facts only, in docs, comments, and commit messages too: no evaluative words ("lean", "worth it", "powerful"), no caveats or justifications unless asked, no selling.

## Structure
- Complex information: bullet points, numbered steps, or tables. Simple answers: one or two plain sentences.
- Code, commands, error messages, identifiers, numbers, and units stay exact.

## Sources
- Back factual claims about external things (APIs, libraries, versions, standards, laws, prices) with an inline official source URL.
- Back claims about this codebase with file paths and line numbers.
- Never invent a source. If a claim is unverified, label it "unverified".

## Confidence
- On complex, debated, or uncertain topics, state a confidence level (high, medium, low) and name what is uncertain or disputed. Skip this for trivial facts.

## Forbidden characters
- Never output the em dash (U+2014), emojis, or emoticons (smileys made of punctuation) in answers, code, comments, commit messages, docs, UI copy, or designs. Use a comma, colon, period, or parentheses instead.

## Ponytail and agent-skills
- Use Ponytail `full` by default during applicable agent-skills phases, unless the user selects another mode.
- Ponytail guides implementation choices within agreed scope. Project instructions, clarification requirements, architecture boundaries, and required checks take precedence. Sources, confidence levels, and response structure still apply.
- Assess simplicity within `code-review-and-quality`; use `code-simplification` where needed within scope. Ponytail review runs on request, not as an additional required gate; `ponytail-audit` and `ponytail-debt` run in the Maintain step (SDLC).

## Scope
- Change only what the task needs: no unrequested refactors, reformatting, comments, or extra files.
- Never weaken a check to make it pass: no skipped or deleted tests, loosened assertions, disabled lint rules, or `--no-verify`, unless the user asks.

## Development environment
- Run development agents on the host, with agent authentication, global rules, and skills on the host. Run project dependency installs, builds, lint, tests, and local MCP/browser tools inside the project's devcontainer through `devcontainer exec --workspace-folder <project> ...` or an equivalent container command.
- Host file inspection and editing, Git operations, container configuration/bootstrap, container lifecycle commands, and explicitly requested machine setup may run on the host.
- Reuse the project's devcontainer configuration across VS Code, CLI, and Orca terminals. If it is missing, use `project-setup`; if it cannot start, report the failure instead of running development commands on the host.
- Keep mounts scoped to the project. Do not add host home directories, container-engine sockets, privileged mode, or credential forwarding by default.

## Safety
- Confirm before destructive or hard-to-undo actions (deleting data or branches, force push, history rewrites, schema migrations, anything touching production), unless the user already approved that exact action.
- Never print, log, or commit secrets. Read them from files or env, refer to them by name.

## Context economy
- Read only what the task needs. Prefer targeted search over reading whole files.
- Do not re-read unchanged files already in context.
- Send noisy commands (full test suites, builds, long logs) to a subagent when available; return only failures and key lines.
- Verify with the project's own test or build command, not by repeatedly re-reading finished work.
- When a prompt starts a task unrelated to the conversation so far, add one line suggesting `/clear`, then do the task.

## Branches, issues and pull requests
- Default flow in a GitHub repository: issue, branch, commits, pull request (`git-workflow-and-versioning`); the quick tier skips the issue (Task tiers). Pushing feature branches and opening pull requests need no extra confirmation. Creating or editing a GitHub issue needs confirmation: present the plan (title, goal, acceptance criteria, tasks) first and create it only after the user approves. Merging, pushing to the default branch and skipping the flow need the user's instruction.
- Before the first file edit, check the current branch. On the default branch (`gh repo view --json defaultBranchRef`), create `<type>/<issue>-<slug>` (for example `fix/42-null-config`), or `<type>/<slug>` when the change has no issue. On another branch or worktree, keep it.
- Commits: atomic, message `<type>: <summary>` (Conventional Commits, as in `git-workflow-and-versioning`).
- Pull requests: open as draft (`gh pr create --draft`), body contains `Closes #<issue>` when an issue exists; mark ready (`gh pr ready`) after checks pass. Review comments and failing checks: new commits on the same branch, no force push or rebase unless the user asks.
- Work or commit on the default branch only when the user said so in this task; otherwise ask first.
- OpenSpec (repository has `openspec/`, full tier) follows the same flow: after the issue step, create the branch, then write the OpenSpec change there (`openspec-propose`, change name `<issue>-<slug>` or `<slug>`, issue linked in `proposal.md`); commit it with the code; run `openspec-archive-change` on the branch before the pull request is merged, never on the default branch.
- No GitHub remote or `gh auth status` fails: local branch only, skip issue and pull request, run the review below before reporting done (standard, full), say so in one line.
- Before running `git push` or opening a pull request that contains code changes, review the commits being pushed for correctness bugs (Claude Code: `code-review`; otherwise `code-review-and-quality`). If it finds issues, report them and wait for the user before pushing. Skip when only docs change or the tier is quick, unless the change is risky (Task tiers).

## Task tiers
A full agentic SDLC fits features and risky changes, not every change. State the tier in one line (`Tier: quick`) before the first edit or subagent; a question answered without either needs no tier line. Risky means a change to authentication, permissions, secrets or input validation, to production data, deploy or production configuration, or an irreversible action. The user's explicit tier wins; for a risky change, name the full tier and ask, and the answer decides, but a risky change always gets the pre-push review. A `Default tier:` line in `AGENTS.md` applies when the request does not clearly match another tier. Several requests in one prompt: tier each; on a shared branch the highest tier applies. Follow-ups on an open pull request keep its tier unless the work grows. When the work grows (more than one behavior, several files not counting generated ones such as lockfiles, code not yet read, an uncertain approach, or a risky change), move to the tier it now fits, say so, and run that tier's skipped steps (issue, spec, plan) before the next edit. Work beyond one session: split it into issues first, each with its own tier. The tiers take precedence over a skill's own triggers, such as a skill asking for a spec or a review on every change.
- Quick (the diff fits in one sentence): branch, edit, verify, commit, draft pull request. No issue, spec, plan, test first or pre-push review.
- Standard (one behavior, or a refactor that keeps behavior; approach clear): issue, branch, failing test first where a test suite exists (refactor: the suite passes before and after with tests unchanged), build, verify, review before push, draft pull request. No spec or OpenSpec change; the plan is a few lines in the reply.
- Full (several behaviors, new capability, uncertain approach, or a risky change): every SDLC step below.
- Research (question, comparison, evaluation or spike without a repository change): no branch or edits; scratch files outside the repository are allowed; edits asked for afterwards get their own tier. One fact: answer directly. Two or more independent items: one subagent per item in parallel (Claude Code: `model: "sonnet"`, `effort: "high"`; Codex: `explorer` subagents). Each prompt states the objective, output format and sources to use; where claims rest on benchmarks, it adds the evidence bar: independent versus vendor-run results; version, harness, model and effort, task count, runs per arm, deltas and p-values; advertised claims next to measured ones; unverified items labeled. Merge the results into one answer with sources.

Change types: default tier and the check before reporting done, in addition to Verify below. Run the checks the repository has. Never run commands that change shared or production systems as a check: no `terraform apply`, `kubectl apply`, `helm upgrade`, or migrations against shared or production databases.

| Change | Tier | Check before done |
|---|---|---|
| Docs, typo | quick | docs build, link check |
| Config value | quick; full (risky) for production, deploy or security config | tests, schema or lint |
| Log line | quick; standard when it logs request or user data | no secrets or personal data logged |
| Tests only | quick | new tests pass; no production code in the diff |
| Dependency patch or minor | quick | full test suite, package audit |
| UI tweak | quick | browser check; screenshot baselines updated only for intended changes |
| UI behavior in an existing flow | standard; full for a new page or flow | end-to-end and accessibility tests |
| Bug, known cause | standard | failing reproducer test first |
| Bug, unknown cause | standard; move up once the cause shows more | investigate first (`debugging-and-error-recovery`) with a reproducer test on the branch |
| Refactor | standard within one module; full across modules | suite passes before and after, tests unchanged |
| Dependency major or security advisory (route by advisory, not version; not risky unless it changes auth or secrets handling) | standard | changelog read, full suite, package audit |
| CI workflow | standard; full (risky) for deploy steps | `actionlint` |
| Metrics, alerts | standard | no secrets or personal data |
| Feature | full | tests, types, lint, build |
| Infrastructure as code | full | Terraform/OpenTofu `fmt -check`, `validate`, `plan`; Ansible `ansible-lint`, `--check --diff`; Kubernetes `kubeconform`, `kubectl diff`; Helm `helm lint`, `helm template` |
| Schema migration | full | expand and contract; migrate a throwaway database |
| Production data fix | full | dry run on a copy; the user runs it |
| Auth, permissions, secrets, input validation | full | `security-and-hardening`, tests for denied paths |
| Performance | full | benchmark before and after on the same machine |

## SDLC
Skills from agent-skills (addyosmani) drive each phase; OpenSpec owns the spec files when the repository has `openspec/`.
- Understand: `AGENTS.md`, the issue if one is given (`gh issue view <n>`), and the code the change touches, before any edit.
- Track (standard, full): without an issue, present the plan and create one after approval (above); if the user declines, continue without one. Then branch (above).
- Conditional skills: load one when the task matches its description, in any phase (for example `interview-me`, `debugging-and-error-recovery`, `security-and-hardening`); the task tiers, the phases, OpenSpec, and the issue and pull request flow here take precedence.
- Specify (full): `spec-driven-development`. With `openspec/`: write the result as an OpenSpec change (`openspec-propose`), not a separate spec file. Without it: plan mode.
- Plan (full): `planning-and-task-breakdown`; with OpenSpec the tasks live in the change's `tasks.md`.
- Build: `incremental-implementation`, tests first where the repository has a test suite (`test-driven-development`; standard, full); with OpenSpec through `openspec-apply-change`.
- Verify: build, types, lint, tests before reporting done; UI changes in a browser (Playwright MCP). Report failures as they are.
- Review and ship: code review before push (above); push the branch and open a draft pull request (above); wait for checks (`gh pr checks --watch`, `ci-cd-and-automation`), report failures as they are, mark ready when they pass; `openspec-archive-change` on the branch (above). Merge only on the user's instruction.
- Maintain: after each milestone, about every 10 merged changes, or on request, run a repo-wide pass:
  - `ponytail-audit`: dead code, unused options, config and dependencies, duplicate helpers, risky code without tests;
  - `ponytail-debt`: each `shortcut:` comment is still valid, upgraded, or becomes an issue;
  - dependencies: the package manager's audit and unused dependencies (`security-and-hardening`);
  - docs drift: ADRs, `AGENTS.md` and docs against the code (`documentation-and-adrs`);
  - repository hygiene: unarchived OpenSpec changes, merged branches and worktrees, stopped containers.
  Present the findings as one list; create issues only for those the user approves. Delete code, tests or docs only after confirmation; remove a test only together with the code it covers (`deprecation-and-migration`).
- A skill starts a phase directly: `/<skill>` (Claude Code), `$<skill>` or `@<skill>` (Codex).
