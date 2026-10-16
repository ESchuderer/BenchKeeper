# Tasks

## 1. Preparation (this change)

- [x] 1.1 Prompt sets `bench/triggers/<collection>.json` for the 122 model-invocable skills, with `bench/scripts/triggers.test.mjs`
- [x] 1.2 Image `bench/image/triggers.Containerfile` and harness `bench/scripts/trigger-eval.sh` with the usage gate
- [x] 1.3 Summary `bench/scripts/trigger-summary.mjs` with a test
- [x] 1.4 Smoke test `bench/scripts/trigger-eval.smoke.sh` with a fake `claude`
- [x] 1.5 Protocol entry in `bench/PROTOCOL.md`; sizing and order in the proposal

## 2. Runs (owner)

- [ ] 2.1 Pilot check, per collection: one query that names the skill, run by hand in an eval container after the hiding step (stream-json): the Skill call names the injected command, not the hidden skill (the init event also lists hidden skills, so it cannot show this)
- [ ] 2.2 Pilot: Ponytail on Haiku 5.5, effort high; compare the gate readings with the sizing estimate
- [ ] 2.3 Remaining collections in the order of the proposal; Sonnet 5.5 after the owner sees the Haiku costs
- [ ] 2.4 Results report with the summary tables, the raw outputs moved under `bench/results/<date>-triggers/round-1/`
