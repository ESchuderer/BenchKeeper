# Anthropic document skills

[Repository](https://github.com/anthropics/skills), Category: skill libraries, Checked 2026-10-14 and 2026-10-24, Decision: Removed from the library (issue 151, setup-v6.10)

## Advertised

- Skills docx, xlsx, pptx, pdf. No quantitative claim.

## Independent evidence

- [DocOps, arXiv 2607.19865](https://arxiv.org/abs/2607.19865) (210 tasks): Claude Code with Sonnet 4.6 scored 0.519 with skills vs 0.552 without. Claude Code harness average across models: 664.9K vs 590.0K tokens per task. Codex with GPT-5.5 scored 0.671 vs 0.648.

## Quality bar check (issue 151, 2026-10-24)

Source [anthropics/skills](https://github.com/anthropics/skills) at `dbd4588f9e1033efb41dad4bef2f7947c8993d44` (2026-10-09, the tip of `main`).

Grading used (the same for every source; the bar is in [library quality bar](library-quality-bar.md)): pass, borderline (soft problems only, or a reading of the bar that the owner decides) or fail (a hard limit broken). Overall is the worst point.

| Skill | 1 Runs as installed | 2 License | 3 Authoring | 4 Earns its place | 5 Maintained | Overall |
|---|---|---|---|---|---|---|
| `docx` | borderline | fail | pass | borderline | pass | fail |
| `pdf` | borderline | fail | fail | borderline | pass | fail |
| `pptx` | borderline | fail | borderline | borderline | pass | fail |
| `xlsx` | borderline | fail | pass | borderline | pass | fail |

Measured at the pin:

| Skill | Description characters | `SKILL.md` lines | License | Effect evidence |
|---|---|---|---|---|
| `docx` | 835 | 91 | `LICENSE.txt` proprietary in folder | independent: DocOps (Codex +2.4 pp, Claude Code -3.3 pp across the four) |
| `pdf` | 437 | 314 | `LICENSE.txt` proprietary in folder | independent: DocOps (as docx) |
| `pptx` | 732 | 238 | `LICENSE.txt` proprietary in folder | independent: DocOps (as docx) |
| `xlsx` | 948 | 99 | `LICENSE.txt` proprietary in folder | independent: DocOps (as docx) |

Findings (every fail and borderline with file and line or URL):

- `docx`: fail.
  - Point 1, borderline: `SKILL.md:21` `npm install docx`; needs `pandoc` (`:15`), LibreOffice, `pdftoppm`; scripts import `lxml`, `defusedxml` without an install line; `scripts/office/soffice.py:69` compiles a C shim with `gcc` at run time and sets `LD_PRELOAD` (`:33`). All referenced scripts exist.
  - Point 2, fail: `LICENSE.txt` "All rights reserved" (`LICENSE.txt:1`): no copies outside the Services (`:16-17`), no derivative works (`:20`), no distribution or sublicense (`:21`); `SKILL.md:4` says `license: Proprietary.`. The repository has no root license, and its README calls these four "source-available, not open source". `library.json` has no `license` field for them.
  - Point 4, borderline: Partial overlap with library `markitdown` on reading `.docx`. Open defects: anthropics/skills#1770, #2014, #1821, #2018, #2012, #2001, #1938.
- `pdf`: fail.
  - Point 1, borderline: `SKILL.md:235` `pip install pytesseract pdf2image` (unpinned); needs `pypdf`, `pdfplumber`, `reportlab`, `qpdf`, `pdftk`, Tesseract; `pdf-lib` in `reference.md`. Scripts are inside the folder.
  - Point 2, fail: Same `LICENSE.txt` as `docx` (identical file): `:1` "All rights reserved", `:16-17`, `:20`, `:21`.
  - Point 3, fail: `SKILL.md:11, 307, 311-314` tell the agent to read `REFERENCE.md` and `FORMS.md`; the folder has `reference.md` and `forms.md` (git tree at the pin), so the links are dead on case-sensitive filesystems and form filling depends on `forms.md`. `forms.md:4` names `scripts/check_fillable_fields` without `.py`.
  - Point 4, borderline: Partial overlap with library `markitdown` on reading PDF text. Open defects: anthropics/skills#1770, #2000, #1960, #1369, #1025.
- `pptx`: fail.
  - Point 1, borderline: `SKILL.md:31` `npm install pptxgenjs`, `:50` `npm install react-icons react react-dom sharp`, `:238` `markitdown[pptx]`, `Pillow`, `defusedxml`, `lxml`; same `soffice.py` gcc shim (`:69`, `LD_PRELOAD` `:33`).
  - Point 2, fail: Same `LICENSE.txt` as `docx`: `:1`, `:16-17`, `:20`, `:21`.
  - Point 3, borderline: `SKILL.md:135` "Office's post-2023 default" ages.
  - Point 4, borderline: Partial overlap with library `markitdown` (`SKILL.md:15, 173` call `markitdown` itself). Open defects: anthropics/skills#1953, #2011, #2015, #1805, #1809, #1167.
- `xlsx`: fail.
  - Point 1, borderline: `SKILL.md:16, 99` `pip install` of `openpyxl`, `pandas`, `markitdown` (unpinned, "preinstalled" only in Anthropic's sandbox); LibreOffice for `scripts/recalc.py`; same `soffice.py` gcc shim (`:69`).
  - Point 2, fail: Same `LICENSE.txt` as `docx`: `:1`, `:16-17`, `:20`, `:21`.
  - Point 4, borderline: Partial overlap with library `markitdown` (`SKILL.md:13`) and `exploratory-data-analysis` (CSV and TSV profiling). Open defects: anthropics/skills#1770, #2013, #1120, #1971, #584; #1779 (`$B$2` references are rewritten by Claude Code argument substitution).

Source notes:

- Point 5: repository not archived, 0 commits since the pin. Folders last changed before the pin: `docx` and `pptx` and `xlsx` 2026-07-16 (fa0fa64), `pdf` 2026-02-06 (1ed29a0).
- License location: each document skill has a `LICENSE.txt` in its folder (one identical file, md5 f8515c3694eb11622110ca76c7c15d1b). The repository has no root `LICENSE` (the GitHub API reports none) and the README says the document skills are "source-available, not open source" ([README](https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/README.md)). The library's Codex-only listing copied the skills into projects, which `LICENSE.txt:16-21` bars.
- DocOps (arXiv 2607.19865): the numbers in the Independent evidence section above match the paper; the skill version it used is not stated.
- skills.sh (2026-10-24): docx 206.4K installs, pdf 216.2K, pptx 241.6K, xlsx 187.2K; Socket Warn on docx, pptx and xlsx.

Removal: the four were removed on the owner's decision in [issue 151](https://github.com/ESchuderer/BenchKeeper/issues/151) and are in [library exclusions](library-exclusions.md).

## Decision

Removed from the library (setup-v6.10, owner decision on [issue 151](https://github.com/ESchuderer/BenchKeeper/issues/151)): `docx`, `pdf`, `pptx` and `xlsx` fail point 2, their `LICENSE.txt` forbids copies outside the Anthropic services, derivative works and distribution. Claude Code keeps them through the claude.ai skills `anthropic-skills`. Not global, per project: the library lists `frontend-design` and `mcp-builder` for both agents. `doc-coauthoring` is left out: it has no license file.

[All evaluations](../../EVALUATIONS.md)
