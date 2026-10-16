You are reviewing the work an AI coding agent did in an existing repository, OpenBallistics (cartridge data in `data/`, shared TypeScript libraries in `lib/`, a Svelte website in `site/`), over three steps, each in a new session. You only read; never modify files.

Inputs in the current directory:
- `steps/1.md`, `steps/2.md`, `steps/3.md`: the task text the agent received in each step. Step 1: repository setup (CI and Pages workflows, README, versioning and release strategy, changelog, dependency updates, commit convention). Step 2: a feature, the compare view of two cartridges. Step 3: a reviewer comment with one bug and one style point to fix.
- `diff/step<k>.patch`: what the agent changed in step k, against the state before the step (the baseline repository before step 1). `diff/all.patch`: all changes against the baseline. Paths are prefixed with the snapshot name (`base`, `1`, `2`, `3`). Files that git ignores, dependencies and agent process files are left out. A missing patch means the step was not reached.
- `diff/commits.txt`: the commits after the baseline, newest first.
- `app/`: the repository after the last step, for context: read the code a change touches or should have reused.

Review only the task's own parts. The baseline code, data and tests are not the agent's work: judge them only where a step asked to change them or where the agent's change interacts with them. Read every step text and every patch in full, and the files in `app/` that the changes touch, call or duplicate, before rating.

Rate each criterion from 1 (unacceptable) to 5 (excellent), with concrete evidence (patch or file and line):
1. s1_ci: the step 1 workflows run the repository's real checks (scripts that exist in its `package.json` files) on pull requests; Pages deploys only from `main` or tags; actions pinned to full commit SHAs; least `permissions:`; no secrets beyond `GITHUB_TOKEN`; no `pull_request_target`; nothing step 1 forbade was run or published.
2. s1_readme: the README covers install, develop, test, build, data contribution and license for a new contributor, and every command it shows exists.
3. s1_release: one consistent versioning and release strategy: where the version is kept, how a release is made, the changelog and its stated format, dependency updates; the commit convention is stated and the commits in `diff/commits.txt` follow it.
4. s2_requirements: the step 2 feature meets every requirement of `steps/2.md` as written (list each unmet or partly met one).
5. s2_correctness: the compare view's values, differences, units and overlaid profiles are correct for the data, including edge cases the step names.
6. s2_fit: the feature reuses the repository's existing modules (for example `lib/shapes2d`, `lib/render2d`, `lib/core` and the site's components) instead of duplicating them, follows the repository's structure, naming and style, and touches no more than it needs.
7. s2_tests: the tests added for the feature are meaningful, cover its requirements and follow the repository's test setup (1 if there are none).
8. s3_fixes: both points of the step 3 comment are fixed as asked, without regressions or unrelated changes.
9. cross_step: steps 2 and 3 follow what step 1 set up: a changelog entry and a version change according to the stated strategy, commits in the stated convention, and the workflows' checks would pass.

Then give `overall` from 1 to 10 (would you merge this work as is), the three main strengths, the three main issues in order of severity, `unmet_requirements` across all steps, and a two-sentence verdict.

Be strict and consistent: the same evidence must lead to the same score. Do not reward length or comments. Base every statement on the step texts, patches and files; do not guess about code you did not read.
