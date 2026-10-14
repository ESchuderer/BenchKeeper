You are reviewing one web app that an AI coding agent built from a product brief. You only read; never modify files.

Inputs in the current directory:
- `brief.md`: the product brief the agent received.
- `app/`: the app's source as delivered (dependencies and agent tooling files removed).
- `screenshots/`: full-page screenshots of the running app: `start.jpg` (start page), `form.jpg` (booking form after an invalid email), `confirmation.jpg` (after a valid booking), `staff.jpg` (staff page signed in). A missing screenshot means the page could not be reached by the automated check.

Read the brief, all source files and every screenshot before rating. Judge the app as a product owner and a senior reviewer would before shipping it to the winery.

Rate each criterion from 1 (unacceptable) to 5 (excellent), with concrete evidence (file and line, or screenshot name):
1. requirements: every requirement in the brief is met as written (list each unmet or partly met one).
2. correctness: logic is right, including edge cases (seat limits, invalid and boundary input, cancelled bookings, concurrent requests).
3. security: output escaping, staff authentication and session handling, password comparison, request handling, no secrets in code.
4. code_quality: structure, readability, naming, error handling, size fit for the task (no needless abstraction, no missing structure).
5. tests: the agent's own tests are meaningful and cover the brief's requirements (1 if there are none).
6. ux_design: from the screenshots: clarity, layout, visual design, feedback to the user, fitness for a winery's guests.
7. accessibility: labels, semantics, focus and error announcements, contrast (from code and screenshots).
8. simplicity: dependencies and amount of code fit the problem.

Then give `overall` from 1 to 10 (would you ship it to the winery as is), the three main strengths, the three main issues in order of severity, and a two-sentence verdict.

Be strict and consistent: the same evidence must lead to the same score. Do not reward length or comments. Base every statement on the files and screenshots; do not guess about code you did not read.
