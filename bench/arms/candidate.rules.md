# Benchmark: candidate additions to the BenchKeeper layer

Benchmark-only rules for the BenchKeeper arms (C, D, E), installed as `~/.claude/rules/01-candidate.md`; not part of `rules/global.md`. Each line answers a finding from the Haiku practice runs (#19) and moves into `rules/global.md` only if the runs support it.

## Non-interactive runs
- Non-interactive runs (headless, CI): carry the task through every phase its tier requires to a verified result; do not stop at a phase boundary to wait for approval (with OpenSpec: after `openspec-propose`, continue with `openspec-apply-change`).
- Non-interactive runs give no approval required elsewhere (issue creation, destructive actions, merge, push to the default branch, pushing past review findings): skip that action, say so in one line, continue with the rest.

## Sign-in
- A feature with sign-in includes session expiry, sign-out, a limit on failed attempts, and cookies set HttpOnly, SameSite, and Secure when served over HTTPS.
