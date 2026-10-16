# Permission rule probe

2026-10-16, Claude Code 2.1.301, `claude -p` with `claude-haiku-5-5`, `--permission-mode dontAsk` (an ask rule refuses the call), the ask rules of `skills/global-setup/SKILL.md` part 11 plus an allow rule `Bash(git *)`, in a throwaway repository with a local bare remote. `refused` means the call was listed in `permission_denials`.

Result: 32 of 32 as expected.

| Expected | Got | Command |
|---|---|---|
| refused | refused | `git push --force origin fix/x` |
| refused | refused | `git push origin fix/x --force-with-lease` |
| refused | refused | `git push -f origin fix/x` |
| refused | refused | `git -C <repo> push --force origin fix/x` |
| refused | refused | `git push origin +fix/x` |
| refused | refused | `git push --mirror origin` |
| refused | refused | `git push origin --delete fix/x` |
| refused | refused | `git push origin :fix/x` |
| refused | refused | `git push --prune origin` |
| refused | refused | `git push origin main` |
| refused | refused | `git push -u origin main` |
| refused | refused | `git push origin HEAD:main` |
| refused | refused | `git push origin HEAD:refs/heads/main` |
| refused | refused | `git reset --hard HEAD` |
| refused | refused | `git clean -fd` |
| refused | refused | `git rebase main` |
| refused | refused | `git branch -D old` |
| refused | refused | `git branch --delete --force old` |
| refused | refused | `git commit --no-verify --allow-empty -m probe` |
| refused | refused | `git commit -n --allow-empty -m probe` |
| refused | refused | `git -c core.hooksPath=/dev/null commit --allow-empty -m probe` |
| run | run | `git push origin fix/x` |
| run | run | `git push -u origin fix/x` |
| run | run | `git branch fix-docs` |
| run | run | `git commit --allow-empty -m "chore: clean up docs"` |
| run | run | `git commit --allow-empty -m "fix: push docs to main branch"` |
| run | run | `git commit --allow-empty -m "push to remote + tests"` |
| run | run | `git config pull.rebase false` |
| run | run | `git log --grep=commit -n 5` |
| run | run | `git grep -n -e verify` |
| run | run | `git commit --amend --no-edit` |
| run | run | `git status` |

An earlier run with a rule ending in `:*` let `git push origin :fix/x` through: a trailing `:*` is the old trailing-wildcard form ([permissions](https://code.claude.com/docs/en/permissions)), so the rule now ends in `:**`.
