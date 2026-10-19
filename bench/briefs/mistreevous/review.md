You are reviewing the work an AI coding agent did in an existing repository, mistreevous (a TypeScript library that builds behaviour trees from MDSL or JSON definitions and steps them for an agent), over three steps, each in a new session. You only read; never modify files.

Inputs in the current directory:
- `steps/1.md`, `steps/2.md`, `steps/3.md`: the task text the agent received in each step. Step 1: `snapshot()` and `restore()` of a tree's execution state. Step 2: restore rejects snapshots of another definition and invalid input; actions with a pending promise. Step 3: two bug reports (no `onNodeStateChange` calls during restore; snapshots independent of the tree).
- `diff/step<k>.patch`: what the agent changed in step k, against the state before the step (the baseline repository before step 1). `diff/all.patch`: all changes against the baseline. Paths are prefixed with the snapshot name (`base`, `1`, `2`, `3`). Files that git ignores, dependencies and agent process files are left out. The build output in `dist/` is generated: do not review it. A missing patch means the step was not reached.
- `diff/commits.txt`: the commits after the baseline, newest first.
- `app/`: the repository after the last step, for context: read the code a change touches or should have reused.

Review only the task's own parts. The baseline code and tests are not the agent's work: judge them only where a step asked to change them or where the agent's change interacts with them. Read every step text and every patch in full, and the files in `app/src/` that the changes touch or call, before rating.

Rate each criterion from 1 (unacceptable) to 5 (excellent), with concrete evidence (patch or file and line):
1. s1_requirements: the step 1 feature meets every requirement of `steps/1.md` as written (list each unmet or partly met one).
2. s1_correctness: snapshot and restore are correct for every node type and state the library has (composites, decorators, leaves, guards and aborts, `lotto`, random counts and durations, both time modes of `wait`, finished trees), including edge cases the step names.
3. s2_validation: step 2 as asked: definition matching (MDSL and equivalent JSON accepted, other definitions rejected with the stated message), invalid input rejected, the tree unchanged after a rejected restore, pending promises restored as not started and documented.
4. s3_fixes: both step 3 reports are fixed at their cause, each with a regression test, without unrelated changes.
5. design: each node type owns the state it saves; the public interface is small and typed (the snapshot type exported); the change follows the repository's structure, naming and style, reuses what exists and touches no more than it needs.
6. tests: the tests added are meaningful, cover the requirements and the edge cases, follow the repository's test setup (mocha, chai, sinon in `test/`), and no existing test was removed, skipped or weakened (1 if there are none).
7. docs: the README documents the API with a correct example and the limitation from step 2; the Version History table and the package version follow the repository's convention.
8. process: the commits in `diff/commits.txt` are focused and their messages describe them; the work stays within what the steps asked (no unrequested features, no new dependencies).

Then give `overall` from 1 to 10 (would you merge this work as is), the three main strengths, the three main issues in order of severity, `unmet_requirements` across all steps, and a two-sentence verdict.

Be strict and consistent: the same evidence must lead to the same score. Do not reward length or comments. Base every statement on the step texts, patches and files; do not guess about code you did not read.
