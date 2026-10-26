# scientific-agent-skills

[Repository](https://github.com/K-Dense-AI/scientific-agent-skills), Category: skill libraries, Checked 2026-10-14 and 2026-10-24, Decision: Not global, per project

## Advertised

- 177 science skills, 100+ databases.
- Vendor paper without a task-level evaluation ([arXiv 2609.00065](https://arxiv.org/abs/2609.00065)).
- Domain science (biology, chemistry, medicine). Many skills install Python packages and need API keys.

## Quality bar check (issue 151, 2026-10-24)

Source [K-Dense-AI/scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills) at `a1043ef544e3a100c28e70a736b6cf32554d0677` (2026-10-12). The evaluation above covers the repository, not each skill; per-skill evidence is recorded here.

Grading used (the same for every source; the bar is in [library quality bar](library-quality-bar.md)): pass, borderline (soft problems only, or a reading of the bar that the owner decides) or fail (a hard limit broken). Overall is the worst point.

| Skill | 1 Runs as installed | 2 License | 3 Authoring | 4 Earns its place | 5 Maintained | Overall |
|---|---|---|---|---|---|---|
| `scientific-critical-thinking` | fail | pass | borderline | borderline | pass | fail |
| `experimental-design` | pass | pass | borderline | pass | pass | borderline |
| `hypothesis-generation` | pass | pass | borderline | pass | pass | borderline |
| `statistical-analysis` | borderline | pass | borderline | borderline | pass | borderline |
| `statistical-power` | pass | pass | pass | borderline | pass | borderline |
| `uncertainty-and-units` | pass | pass | borderline | pass | pass | borderline |
| `exploratory-data-analysis` | pass | pass | borderline | pass | pass | borderline |
| `scientific-visualization` | pass | pass | borderline | pass | pass | borderline |
| `literature-review` | borderline | pass | borderline | pass | pass | borderline |
| `paper-lookup` | pass | pass | borderline | borderline | pass | borderline |
| `citation-management` | borderline | pass | borderline | borderline | pass | borderline |
| `database-lookup` | pass | pass | pass | pass | pass | pass |
| `markitdown` | pass | pass | borderline | borderline | pass | borderline |
| `scientific-writing` | pass | pass | borderline | borderline | pass | borderline |
| `peer-review` | pass | pass | borderline | pass | pass | borderline |
| `venue-templates` | borderline | borderline | borderline | borderline | pass | borderline |
| `sympy` | borderline | borderline | borderline | pass | pass | borderline |
| `pymoo` | borderline | borderline | borderline | pass | pass | borderline |
| `cantera` | pass | pass | pass | pass | pass | pass |

Measured at the pin:

| Skill | Description characters | `SKILL.md` lines | License | Effect evidence |
|---|---|---|---|---|
| `scientific-critical-thinking` | 336 | 235 | root `LICENSE.md` MIT, frontmatter `license:` MIT | none |
| `experimental-design` | 1014 | 286 | root `LICENSE.md` MIT, frontmatter `license:` MIT | none; community bug fixed (#279, #280) |
| `hypothesis-generation` | 342 | 290 | root `LICENSE.md` MIT, frontmatter `license:` MIT | none |
| `statistical-analysis` | 552 | 453 | root `LICENSE.md` MIT, frontmatter `license:` MIT | none |
| `statistical-power` | 893 | 225 | root `LICENSE.md` MIT, frontmatter `license:` MIT | none |
| `uncertainty-and-units` | 847 | 415 | root `LICENSE.md` MIT, frontmatter `license:` MIT | none; open PR #350 |
| `exploratory-data-analysis` | 375 | 311 | root `LICENSE.md` MIT, frontmatter `license:` MIT | none |
| `scientific-visualization` | 279 | 307 | root `LICENSE.md` MIT, frontmatter `license:` MIT | none |
| `literature-review` | 422 | 229 | root `LICENSE.md` MIT, frontmatter `license:` MIT | none; skills.sh scans Fail/Warn |
| `paper-lookup` | 800 | 316 | root `LICENSE.md` MIT, frontmatter `license:` MIT | none; skills.sh Gen Fail, Snyk Warn |
| `citation-management` | 368 | 359 | root `LICENSE.md` MIT, frontmatter `license:` MIT | none; many open bug reports (#317, #318, #319, #323, #348) |
| `database-lookup` | 274 | 399 | root `LICENSE.md` MIT, frontmatter `license:` MIT | none |
| `markitdown` | 287 | 284 | root `LICENSE.md` MIT, frontmatter `license:` MIT | none; open PR #322 (install commands) |
| `scientific-writing` | 357 | 381 | root `LICENSE.md` MIT, frontmatter `license:` MIT | none |
| `peer-review` | 364 | 317 | root `LICENSE.md` MIT, frontmatter `license:` MIT | none |
| `venue-templates` | 309 | 297 | frontmatter MIT, six Elsevier LPPL 1.3 files | none; PR #165 merged |
| `sympy` | 294 | 408 | frontmatter license is a URL to SymPy's license | none; open PR #307 (dead links) |
| `pymoo` | 239 | 309 | frontmatter Apache-2.0 | none |
| `cantera` | 321 | 139 | root `LICENSE.md` MIT, frontmatter `license:` MIT | none; 224 installs, first seen 2026-09-30 |

Findings (every fail and borderline with file and line or URL):

- `scientific-critical-thinking`: fail.
  - Point 1, fail: `SKILL.md:66-72` tells the agent to run `python skills/scientific-schematics/scripts/generate_schematic.py` from the repository root: a sibling skill that is not in this folder or the library, and it needs `OPENROUTER_API_KEY` and sends prompts to OpenRouter (`:78`). The section is optional, the script path is the preferred one. Owner call: fail or borderline.
  - Point 3, borderline: No "use when" clause in the description (`:3`); `:142` "ROBINS-I V2 November 2025 draft" ages.
  - Point 4, borderline: The description (`:3`) lists "experimental design validity" and "statistical interpretation", the same subjects as `experimental-design` and `statistical-analysis` (`SKILL.md:3` of both); it hands peer review writing to `peer-review`. Distinct core: judging claims, bias, GRADE.
- `experimental-design`: borderline.
  - Point 3, borderline: Description is 1,014 of 1,024 characters; `SKILL.md:46` "pyDOE3 was archived in May 2026" ages.
  - Other: Installs exact-pinned (`SKILL.md:43`).
- `hypothesis-generation`: borderline.
  - Point 3, borderline: `SKILL.md:200` ("current SPIRIT 2025 ... CONSORT 2025") and `:273` ("the 2026-10-01 refresh") age.
- `statistical-analysis`: borderline.
  - Point 1, borderline: `SKILL.md:37` installs `pandas matplotlib seaborn` unpinned beside pinned `pingouin`, `scipy`, `statsmodels`.
  - Point 3, borderline: 454 lines (400 to 500 band); `:33` "reviewed 2026-10-01".
  - Point 4, borderline: Description (`:3`) lists "power analysis" and sample sizes, the trigger of `statistical-power` (`skills/statistical-power/SKILL.md:3`); only the second points to the first. Also `validate-data` lists the same statistical traps (`validate-data/SKILL.md:248-257`).
- `statistical-power`: borderline.
  - Point 4, borderline: Shares "how many subjects do I need" with `statistical-analysis` (`skills/statistical-analysis/SKILL.md:3`); no pack lists it (K-Dense Core set only).
  - Other: `SKILL.md:73` uses a repo-layout script path (`skills/statistical-power/scripts/`), the script is inside the folder.
- `uncertainty-and-units`: borderline.
  - Point 3, borderline: 416 lines; `:38, 40, 41, 382` dated "Verified 2026-10-01" lines; dead link (404) at `:388` (NIST TN 1297).
  - Other: Installs exact-pinned (`SKILL.md:49`). Script paths in `:154-297` use the repository layout.
- `exploratory-data-analysis`: borderline.
  - Point 3, borderline: No "use when" clause in the description (`:3`); 13 dated lines (`:39, 46-52, 55`); dead link (404) at `:289` (FDA E9(R1)).
- `scientific-visualization`: borderline.
  - Point 3, borderline: `SKILL.md:183` "reviewed 2026-10-01", `:237` "2026-07-23 snapshot".
- `literature-review`: borderline.
  - Point 1, borderline: Unpinned `brew install pandoc`, `apt-get install pandoc`, `brew install --cask mactex`, `apt-get install texlive-xetex` (`SKILL.md:191-196`); `scripts/generate_schematic.py:54-84` reads `.env` files up the parent directories; optional `parallel-cli` needs `PARALLEL_API_KEY` (`:178-180`). skills.sh Gen Agent Trust Hub Fail (2026-10-02) cited `curl | bash` for parallel.ai, removed by a92663a (2026-10-01), absent at the pin.
  - Point 3, borderline: `:206` "The 2026-09-30 refresh"; `:135` names `pubmed-database`, which is in neither the folder nor the library.
- `paper-lookup`: borderline.
  - Point 3, borderline: `:19` "reviewed 2026-09-30", `:267` "OA Web Service retired August 2026".
  - Point 4, borderline: "find papers on X", "look up this DOI" (`:3`) triggers together with `citation-management` and `literature-review` (`skills/citation-management/SKILL.md:3`, `skills/literature-review/SKILL.md:3`); neither points back.
  - Other: No installs; stdlib scripts; API endpoint docs bundled in `references/`.
- `citation-management`: borderline.
  - Point 1, borderline: Unpinned `uv pip install requests` (`SKILL.md:298`) and `scholarly` (`:308`, scrapes Google Scholar, "blocked often" `:77`); `allowed-tools` includes WebSearch and WebFetch (`:4`) and phase 2.5 (`:98`) needs web enrichment.
  - Point 3, borderline: `:165` "reviewed against official documentation on 2026-09-30".
  - Point 4, borderline: Same OpenAlex and PubMed search as `paper-lookup` and the "find papers" trigger; hands off to `literature-review` (`:223-226`), not to `paper-lookup`.
- `database-lookup`: pass.
  - Other: 399 lines, 83 reference files one level deep; some reference URLs return 403 or 429 to curl (bot blocking, unverified).
- `markitdown`: borderline.
  - Point 3, borderline: No "use when" clause in the description (`:3`); `:18` "0.1.8, released September 21, 2026".
  - Point 4, borderline: "Read PDF or Office files" overlaps `pdf`, `docx`, `pptx`, `xlsx` (removed from the library; Claude Code ships them through `anthropic-skills`). The distinct part is Markdown for LLM input.
  - Other: Installs pinned (`SKILL.md:45, 51, 214`).
- `scientific-writing`: borderline.
  - Point 3, borderline: Dated text at `:69, 103, 119, 208, 304` ("CONSORT 2025", "ICMJE's January 2026", "COPE ... 21 July 2026").
  - Point 4, borderline: The description (`:3`) lists "submission preparation", which `venue-templates` also covers (`skills/venue-templates/SKILL.md:3`). Distinct from `peer-review` (author side against reviewer side) and from the marketing copy skills.
- `peer-review`: borderline.
  - Point 3, borderline: No "use when" clause in the description (`:3`); `:296` "reviewed 2026-10-01".
- `venue-templates`: borderline.
  - Point 1, borderline: `compat` (`SKILL.md:5`) needs network to verify venue instructions; the workflow tells the agent to download official templates and style files (`:97, 159, 164`, NeurIPS `.sty`).
  - Point 2, borderline: Frontmatter says MIT (`:4`) but six files in `assets/journals/` (`elsarticle-*.tex`, `.bst`) carry "Copyright 2007-2026 Elsevier Ltd" under LPPL 1.3 (for example `assets/journals/elsarticle-template-num.tex:2-10`).
  - Point 3, borderline: No "use when" clause (`:3`); 11 dated lines (`:64, 82-88, 131, 161, 164, 204, 240, 274`: ICML 2026, NeurIPS 2026, "Checked: 2026-10-01").
  - Point 4, borderline: "Adapting academic writing to a venue" and submission checks (`:3`) overlap `scientific-writing`'s "submission preparation" (`skills/scientific-writing/SKILL.md:3`). Distinct core: LaTeX templates and venue rules.
- `sympy`: borderline.
  - Point 1, borderline: `SKILL.md:33` installs `numpy scipy matplotlib` unpinned (sympy pinned at `:30`).
  - Point 2, borderline: Frontmatter `license:` is `https://github.com/sympy/sympy/blob/master/LICENSE` (`:4`), SymPy's own license; `library.json` says MIT, root is MIT.
  - Point 3, borderline: 409 lines; `:23` "Python 3.13.3 (2026-10-01)"; dead link (404) at `:391` (`sympy/tree/master/examples`).
  - Other: skills.sh Gen Agent Trust Hub Warn (documents `parse_expr` eval, pickle, autowrap in `references/code-generation-printing.md`).
- `pymoo`: borderline.
  - Point 1, borderline: Unpinned optional installs `optuna` (`references/algorithms.md:79`) and `dill` (`references/lifecycle.md:59`).
  - Point 2, borderline: Frontmatter `license: Apache-2.0 license` (`:4`) differs from `library.json` and the root (MIT); it names pymoo's own license.
  - Point 3, borderline: No "use when" clause (`:3`); `:18` "reviewed 2026-10-01".
  - Other: The issue and PR search for pymoo and cantera was cut off by the GitHub API rate limit: no per-skill issue evidence.
- `cantera`: pass.
  - Other: `uv run --with cantera==3.2.0 --with numpy==2.5.3` pinned (`SKILL.md:54`); mechanism bundled; no dated statements; script paths `:55-56` use the repository layout. Thin usage history.

Source notes:

- Point 5: not archived; 1 commit on `main` since the pin (a security scan report update, 2026-10-19), 0 in the 19 folders; each folder last changed 2026-10-01.
- License location: no license file in any of the 19 folders. Each `SKILL.md` has a frontmatter `license:` (MIT for 16; `sympy` points to SymPy's license URL, `pymoo` says Apache-2.0, `venue-templates` says MIT but bundles six Elsevier LPPL 1.3 files). The root `LICENSE.md` is MIT (Copyright (c) 2025 K-Dense Inc.), so the MIT text and copyright notice do not ship with an install.
- Time-sensitive text is pervasive: dated "verified" and "reviewed" stamps, release dates and 2026 venue names. 16 of 19 skills are borderline on point 3 for that, for 400 or more lines, or for a missing "use when" clause; only `statistical-power`, `database-lookup` and `cantera` pass it.
- 18 of 19 `SKILL.md` files (not `cantera`) end with a "Citing Scientific Agent Skills" section that tells the agent to add the repository's own paper (arXiv 2609.00065) to the user's references and to fetch it when online (for example `skills/scientific-writing/SKILL.md:362-380`). Not counted against point 1; counting it as a fetch from a live page would move 11 point-1 passes to borderline.
- skills.sh scans (2026-10-24): all three pass for 14 skills; `literature-review` and `paper-lookup` Gen Agent Trust Hub Fail (2026-10-02), `literature-review`, `paper-lookup`, `citation-management`, `venue-templates` Snyk Warn, `sympy` Gen Warn. Install counts: 224 (`cantera`) to 2.4K. Pages: skills.sh, `k-dense-ai/scientific-agent-skills/<skill name>`.
- Open third-party defects after the pin: #260 (dead endpoints, broken install commands and stale compatibility floors across 14 skills), #317, #318, #319, #323, #348 (`citation-management`), #322 (`markitdown`), #325 (`paper-lookup`), #349, #350. Prior fixed defect: #279 (`experimental-design` dropped a treatment arm for fractional allocation ratios), fixed in #280. The repository's security scan report is maintainer evidence.
- Link check (116 URLs from the 19 `SKILL.md` files): three 404s (`sympy:391`, `uncertainty-and-units:388`, `exploratory-data-analysis:289`, all reference lists); 14 more answered 403, 429 or 405 (bot blocking, unverified).

Removal: `scientific-critical-thinking` was removed on the owner's decision in [issue 151](https://github.com/ESchuderer/BenchKeeper/issues/151) and is in [library exclusions](library-exclusions.md); the borderline skills stay.

## Decision

Not global, per project: the BenchKeeper library (`plugins/benchkeeper/library/README.md`, setup-v5.0) lists a core, literature, writing and modelling set without paid API keys. `setting-up-projects` proposes them for science repositories, and its search vets other single skills.

[All evaluations](../../EVALUATIONS.md)
