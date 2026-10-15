You are reviewing one static web app that an AI coding agent built from a product brief. You only read; never modify files.

Inputs in the current directory:
- `brief.md`: the product brief the agent received, with the drawing rules and the 25 cartridge records.
- `app/`: the app's source as delivered: code, tests, build and CI configuration, README, docs, ADRs and specs; dependencies, agent tooling and process files removed.
- `screenshots/`: full-page screenshots of the app in Chromium: `list.jpg` (start page); `detail-<key>.jpg` for 308_win (rimless bottleneck), 300_win_mag (belted), 9_3_x_74_r (rimmed, shallow shoulder), 9_mm_luger (straight, tapered), 22_long_rifle (heeled rimfire) and 44_rem_mag (rimmed straight, semi-wadcutter); `print-308_win.jpg` (308 Win. detail view under print media at A4 width). A missing screenshot means the page could not be reached by the automated check.
- `reference/`: OpenBallistics drawings of 308_win, 300_win_mag, 9_mm_luger and 22_long_rifle, for comparing outline and proportions. They label symbols without values, have no section view, and may draw details the brief does not ask for (boat tails, crimps, cannelures). Where they differ from the brief's rules, the brief's rules win.

Read the brief, all source files, every screenshot and every reference drawing before rating. Judge the app as a product owner and a senior reviewer would before publishing it to reloaders, gunsmiths and engineers.

Rate each criterion from 1 (unacceptable) to 5 (excellent), with concrete evidence (file and line, or screenshot name):
1. requirements: every requirement in the brief is met as written, each drawing rule included (list each unmet or partly met one).
2. correctness: the drawing geometry follows the rules and the record's values for each family shown (rim type, chamfer, groove, belt, body, shoulder and α, neck, bullet nose and seating, heeled bullet, section walls and primer pocket); proportions are true to scale against the values and the reference drawings; dimension values match the data; values, units, angles and tolerances are shown as the brief specifies; the printed detail view fits one A4 page.
3. security: data rendered without HTML injection (no unescaped `innerHTML` built from data), no external requests, no `eval` or equivalent.
4. code_quality: structure, readability, naming, error handling, size fit for the task (no needless abstraction, no missing structure).
5. tests: the agent's own tests are meaningful and cover the brief's requirements, the drawing rules included (1 if there are none).
6. ux_design: from the screenshots: fitness for a technical audience: information density and hierarchy, legibility of the drawing and its labels (no overlaps), the title block, the tables, the print layout, light and dark.
7. accessibility: a text alternative for the drawing, table headers, labels, semantics, keyboard use, focus, contrast (from code and screenshots).
8. simplicity: dependencies and amount of code fit the problem.
9. maintainability: could a developer who has never seen this app pick it up again later without problems? From the repository alone: run and setup instructions, regression tests that cover the behavior, a build and CI pipeline, a release or versioning approach, documentation of decisions and behavior (README, docs, specs, ADRs), pinned dependencies and runtime versions, and no undocumented manual steps.

Then give `overall` from 1 to 10 (would you publish it as is), the three main strengths, the three main issues in order of severity, and a two-sentence verdict.

Be strict and consistent: the same evidence must lead to the same score. Do not reward length or comments. Base every statement on the files, screenshots and reference drawings; do not guess about code you did not read.
