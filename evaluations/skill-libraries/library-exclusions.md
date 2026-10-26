# Library exclusions

Category: skill libraries, Checked 2026-10-18 to 2026-10-25, Decision: Not in the library

## Decision

Not listed after review (2026-10-18): Vercel `web-design-guidelines` and `writing-guidelines` (fetch their rules from a branch URL on every run), skills that download code at run time (Remotion, HyperFrames, `dxf`, `m5-onboard`), non-commercial or missing licenses, PRD and spec skills (Matt Pocock's `to-spec`), Anthropic `explore-data` and `data-visualization` (science set), and product-named skills the stack search finds (Terraform, PostGIS, Home Assistant, MapLibre).

Removed 2026-10-25 (setup-v6.10, [issue 151](https://github.com/ESchuderer/BenchKeeper/issues/151), owner decision: follow the [quality bar](library-quality-bar.md) as written): the seven library skills that failed it. A skill can come back when upstream removes the cause.

- `docx`, `pdf`, `pptx`, `xlsx` (anthropics/skills, point 2 license): the `LICENSE.txt` in each folder is all rights reserved and bars copies outside the Anthropic services, derivative works and distribution (`LICENSE.txt:16-21`), which a project copy breaks. `pdf` also fails point 3: `SKILL.md:11, 307, 311-314` link `REFERENCE.md` and `FORMS.md`, the folder has `reference.md` and `forms.md` ([anthropics/skills#375](https://github.com/anthropics/skills/issues/375)). Claude Code still has all four through the claude.ai skills `anthropic-skills`. Upstream on the license: [anthropics/skills#741](https://github.com/anthropics/skills/issues/741).
- `scientific-critical-thinking` (K-Dense-AI/scientific-agent-skills, point 1): `SKILL.md:66-72` runs `skills/scientific-schematics/scripts/generate_schematic.py`, a sibling skill that is not installed and needs `OPENROUTER_API_KEY`. No upstream issue found.
- `fp-check` (trailofbits/skills, point 1): the deep path delegates to the agents `data-flow-analyzer`, `exploitability-verifier` and `poc-builder` (`skills/fp-check/SKILL.md:82`, `references/deep-verification.md:58, 64-70`), which live in `plugins/fp-check/agents/` and are not copied by the skills CLI. The standard path works. No upstream issue about the agents found.
- `tdd-workflow` (affaan-m/ECC, points 1 and 3): step 0 runs `node scripts/setup-package-manager.js --detect` (`SKILL.md:95`), a script of the ECC plugin outside the folder, and the file has 583 lines. Upstream: [ECC#3530](https://github.com/affaan-m/ECC/issues/3530), [ECC#3545](https://github.com/affaan-m/ECC/issues/3545).

Removed 2026-10-19 (setup-v5.1): Trail of Bits `dimensional-analysis`. Its `SKILL.md` runs agent prompt files from the source repository's `plugins/dimensional-analysis/agents/`, which the skills CLI does not copy, so the installed skill cannot run its pipeline. Found in the OpenReloading workspace setup.

Not listed 2026-10-22: SupportPages `wtfm` (end-user help articles with rendered screenshots). It downloads Chromium and CDN stylesheets at run time, updates itself daily without a pinned version, adds a hook on every tool call, sends telemetry by default, starts agents with permission checks disabled, and its skills depend on an engine folder the skills CLI does not copy (one `SKILL.md` has 1421 lines). Vendor project, no independent evidence.

[All evaluations](../../EVALUATIONS.md)
