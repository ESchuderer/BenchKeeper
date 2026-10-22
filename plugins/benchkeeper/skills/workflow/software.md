# Software change

## Flow

| Tier | Steps |
|---|---|
| quick | branch, edit, verify, commit, draft pull request |
| standard | issue, branch, run the existing tests of the touched code, test first at the seams named in the plan (refactor: the suite passes before and after with tests unchanged), verify, review, draft pull request |
| full | [full-tier.md](full-tier.md) |

- **Issue**: title, goal, acceptance criteria, tasks. Creating or editing one needs the user's approval of that plan; declined, continue without. Orca and other runners pick work up from the issue, so its tasks stay current.
- **Branch**: on the default branch, create `<type>/<issue>-<slug>` (or `<type>/<slug>`) before the first edit.
- **Commits**: Conventional Commits, `Refs #<issue>` in the footer.
- **Review before pushing** standard, full or risky work: Claude Code `/code-review` with no target, risky changes also `/security-review`. Codex, or no `origin`: a correctness pass and, for risky changes, a security pass by subagents over authentication, permissions, secrets and input handling. Docs-only changes skip this unless risky.
- **Pull request**: `gh pr create --draft`, body with `Closes #<issue>` and the key decisions (structure, storage, deployment, rejected options). After pushing, `gh pr checks --watch`, then `gh pr ready` when they pass. Review comments and failing checks: new commits on the same branch.
- No GitHub remote or `gh auth status` fails: local branch only, review before reporting done, say so in one line.

## Matt Pocock's skills, when installed

`mattpocock-skills:<name>`. Marked U: only the user starts them, so suggest and wait. Without them, do the step directly.

| Skill | When |
|---|---|
| `tdd` | new logic or a bug fix, standard and full |
| `diagnosing-bugs` | a bug with an unknown cause |
| `codebase-design` | a refactor across modules or a changed interface |
| `prototype` | a design question that needs running code |
| `domain-modeling` | new terms or decisions worth a glossary entry or ADR |
| `code-review` | spec check of a branch against its issue (reads the tracker doc in `docs/agents/`) |
| `pr` | the pull request body |
| `to-spec`, `to-tickets` (U) | full work spanning several sessions |

## Change types

Sets the tier when the user named none, and the check before done. Never run a check that changes shared or production systems (`terraform apply`, `kubectl apply`, `helm upgrade`, migrations against shared databases).

| Change | Tier | Check before done |
|---|---|---|
| Docs, typo | quick | docs build, link check |
| Config value | quick, full for production, deploy or security config | tests, schema or lint |
| Tests only, log line | quick (standard when it logs user data) | |
| Dependency patch or minor | quick | full suite, package audit |
| UI tweak | quick | browser check, screenshot baselines updated only for intended changes |
| UI behavior in an existing flow | standard, full for a new page or flow | end-to-end and accessibility tests |
| Bug | standard | known cause: a failing test first. Unknown: `diagnosing-bugs` |
| Refactor | standard in one module, full across modules or with a changed interface | suite unchanged and passing |
| Dependency major or security advisory | standard | changelog read, full suite, package audit |
| CI workflow | standard, full for deploy steps | `actionlint` |
| Feature, performance | full | performance: benchmark before and after on the same machine |
| Infrastructure as code | full | `fmt -check`, `validate`, `plan`; `ansible-lint --check --diff`; `kubeconform`, `kubectl diff`; `helm lint`, `helm template` |
| Schema migration | full | expand and contract, migrate a throwaway database |
| Production data fix | full | dry run on a copy, the user runs it |
| Auth, permissions, secrets, input validation | full | tests for denied paths |

## Verify

The project's own build, types, lint and tests, run where `AGENTS.md` says. UI changes also in a browser (Playwright MCP) next to the UI tests. Browser and build output (`.playwright-mcp/`, `test-results/`, screenshots) is git-ignored or deleted.
