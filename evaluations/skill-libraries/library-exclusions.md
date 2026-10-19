# Library exclusions

Category: skill libraries, Checked 2026-10-18, Decision: Not in the library

## Decision

Not listed after review (2026-10-18): Vercel `web-design-guidelines` and `writing-guidelines` (fetch their rules from a branch URL on every run), skills that download code at run time (Remotion, HyperFrames, `dxf`, `m5-onboard`), non-commercial or missing licenses, PRD and spec skills (Matt Pocock's `to-spec`), Anthropic `explore-data` and `data-visualization` (science set), and product-named skills the stack search finds (Terraform, PostGIS, Home Assistant, MapLibre).

Removed 2026-10-19 (setup-v5.1): Trail of Bits `dimensional-analysis`. Its `SKILL.md` runs agent prompt files from the source repository's `plugins/dimensional-analysis/agents/`, which the skills CLI does not copy, so the installed skill cannot run its pipeline. Found in the OpenReloading workspace setup.

[All evaluations](../../EVALUATIONS.md)
