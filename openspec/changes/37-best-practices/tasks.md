# Tasks

## 1. Versioning

- [x] 1.1 Tag `setup-v1.0` on main before this change; root `CHANGELOG.md`

## 2. Rules and skills

- [x] 2.1 `rules/global.md`: always-on core with the `sdlc` pointer, compaction instruction, contradictions resolved, duplicates removed
- [x] 2.2 `skills/sdlc/SKILL.md` from the workflow sections
- [x] 2.3 `skills/maintain/SKILL.md` (user-invoked) with `/doctor prompt-audit` and `/skill-doctor`
- [x] 2.4 `disable-model-invocation: true` on `global-setup` and `project-setup`

## 3. Permission rules

- [x] 3.1 `global-setup` part 11: ask rules, order-preserving merge, skills links, advisor variable check
- [x] 3.2 Every rule checked at least once through headless Claude Code (`dontAsk`) in a throwaway repository: commands that must be refused and commands that must run

## 4. Docs and checks

- [x] 4.1 README, `facts.json`, site text for the new layout; README sync
- [x] 4.2 Checks in the dev container: link test, README sync, site build and tests
- [ ] 4.3 Pre-push review; draft PR; tag `setup-v2.0` after merge
