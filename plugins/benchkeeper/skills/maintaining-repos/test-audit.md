# Test audit

Question per module: which deliberate break of the code do its tests catch? A mutation tester answers it by changing the code one place at a time and running the tests; a change no test fails on is a survivor.

## Bounds

A mutant can loop or allocate without end: one run of a 49-line module was killed by the operating system's memory guard after using several GB of swap. Set all of these before the first run:

- One module per run, chosen by the user or by logic that has its own tests. The whole tree takes hours (0.6 to 0.75 s per mutant at concurrency 4, 3 to 5 mutants per line).
- Concurrency 4, never the default (all cores but one).
- A memory cap on the container or process group, and `NODE_OPTIONS=--max-old-space-size=256` for Node test processes.
- A per-mutant timeout (`timeoutMS` 6000 in the command runner).
- A copy of the repository in a scratch folder, not the work tree: the run rewrites files. The tests must pass there first; if a test reads files outside the folder, copy them beside it. Never widen the scope to get a red initial run green.

## Run (JavaScript and TypeScript, Node test runner)

`node --test` has no Stryker plugin; the command runner runs the chosen test files once per mutant. Config in the scratch folder:

```json
{ "testRunner": "command", "commandRunner": { "command": "NODE_OPTIONS=--max-old-space-size=256 node --test <test files that exercise the module>" },
  "mutate": ["<module>"], "coverageAnalysis": "off", "concurrency": 4, "timeoutMS": 6000,
  "reporters": ["json", "clear-text"], "disableTypeChecks": true }
```

Choose the test files by behavior: those that import the module and those that reach it through another module or a CLI command (search the importers of the module, then their tests). A missing test shows as a survivor that an existing test catches. Run the chosen command unmutated first; it must pass.

`stryker run <config>` with `@stryker-mutator/core@10.0.0` ([tools.md](tools.md)). Other stacks: their tool from the table, with the same bounds. Record per module: mutants, killed, survived, score, minutes.

## Classify survivors

Read the survivors line by line, most populated lines first, and put each in one class:

- **equivalent**: the change cannot alter behavior (a bound that an equal-length check already covers, a comparison on unique keys). Skip.
- **unreachable**: a branch no input reaches. Dead code, a cleanup finding.
- **message**: only an error text changed. Low value; skip unless the text is the contract.
- **gap**: behavior a test should pin (a boundary, a header, a regex variant). Propose one test per gap.

A survivor that leaves a check comparing two empty values is a gap in the check itself.

## Tests that protect nothing

Candidates: a duplicate of another test, a snapshot of incidental markup, an assertion that copies a constant from the code, a test with no assertion. A test is removed only when the mutation result of every audited module it exercises is unchanged without it (remove it in the scratch copy, rerun those modules, compare killed counts; a module not audited keeps the test) and the reason is recorded; or together with the code it covers. A test that kills a mutant no other test kills stays.

Done when every survivor of the chosen modules has a class and every removal candidate has its rerun result.
