# Benchmark: non-interactive runs

Benchmark-only addition for the BenchKeeper arms (C, D, E); not part of `rules/global.md`.

- Non-interactive runs (headless, CI): carry the task through every phase its tier requires to a verified result; do not stop at a phase boundary to wait for approval (with OpenSpec: after `openspec-propose`, continue with `openspec-apply-change`).
- Non-interactive runs give no approval required elsewhere (issue creation, destructive actions, merge, push to the default branch, pushing past review findings): skip that action, say so in one line, continue with the rest.
