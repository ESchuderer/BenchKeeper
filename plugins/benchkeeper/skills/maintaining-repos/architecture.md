# Architecture

Read only. Each finding names modules and files, with the tool output or search behind it.

1. **Graph.** Cycles and orphans with `dependency-cruiser` ([tools.md](tools.md)); other stacks: the language's own module listing. A cycle that only crosses function-level imports still counts: list its path.
2. **Depth.** Per module: lines, exports, importers. A module whose exports each forward one call into one other module, at most about 5 lines with a single import, is a forwarding layer. A module with many exports and one importer is a candidate to merge into that importer. Judge depth against the interface the callers need (`mattpocock-skills:codebase-design` when installed).
3. **One source of truth.** The same fact (a constant, a list of names, a format) defined in two places: search a distinctive literal. Report both places and the one that should own it.
4. **Documented against actual.** Compare each structure statement in `GLOSSARY.md`, ADRs, `AGENTS.md` and `README.md` (layers, folders, module names) with the graph: a documented module that does not exist, an existing module no document names. Without `GLOSSARY.md` and ADRs, the graph and the structure lines of `AGENTS.md` are the only reference; report the undocumented structure as one finding and offer `mattpocock-skills:domain-modeling` to record it, do not write the documents in this pass.
5. **Deepening.** Moves that change interfaces are the user's call: suggest `/mattpocock-skills:improve-codebase-architecture`, do not start it.

Done when every module is in the graph, each cycle has its path, and each forwarding or duplicated-fact finding has its files.
