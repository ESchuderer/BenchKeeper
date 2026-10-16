# Skills inventory and usage (#36, steps 1 and 2)

Generated 2026-10-16 with `bench/scripts/skills-inventory.sh` (the SKILL.md files under `~/.claude` and the project template of each arm image, saved as `skills-files-2026-10-16.json`) and `bench/scripts/skills-inventory.mjs` (the skills each framework adds: the arm's init skills minus those of the plain arm A, and for the BenchKeeper layer minus those of agent-skills arm F; phase by `bench/scripts/phases.mjs`; tokens are file bytes divided by 4, an estimate). Usage: the 58 trials in `bench/results/` (React winery brief, Claude Code and OpenCode on Haiku 5.5 and Sonnet 5.5, testing method protocol 1.9, BenchKeeper layer v1); "fired" counts trials in which the agent called the skill through the Skill tool, of the trials whose arm had the skill installed. Correlation only: one brief, one trial per arm and model.

Not counted: subagents (ECC works mainly through its agents, for example `code-reviewer`, `planner`, `security-reviewer`, which the trials record in `workflow.agents`), and commands that are not SKILL.md skills (for example ECC's `orch-build-mvp`, used once).

| Framework | Skills | Tokens (all SKILL.md files) | Fired at least once |
|---|---|---|---|
| agent-skills | 25 | 85815 | 11 |
| Superpowers | 15 | 40680 | 8 |
| ECC | 50 | 103749 | 0 |
| Matt Pocock | 27 | 31884 | 6 |
| Ponytail | 6 | 5108 | 1 |
| OpenSpec | 6 | 23573 | 4 |
| Spec Kit | 10 | 34895 | 6 |
| BenchKeeper layer (with agent-skills) | 10 | 20096 | 1 |

| Framework | Skill | Phase | Tokens | Fired in trials | Description |
|---|---|---|---|---|---|
| agent-skills | `agent-skills:api-and-interface-design` | spec | 3722 | 1 of 12 | Guides stable API and interface design. |
| agent-skills | `agent-skills:browser-testing-with-devtools` | test | 3635 | 0 of 12 | Tests in real browsers via Chrome DevTools MCP. |
| agent-skills | `agent-skills:ci-cd-and-automation` | other | 2833 | 0 of 12 | Automates CI/CD pipeline setup. |
| agent-skills | `agent-skills:code-review-and-quality` | review | 5244 | 3 of 14 | Conducts multi-axis code review. |
| agent-skills | `agent-skills:code-simplification` | other | 3386 | 0 of 12 | Simplifies code for clarity. |
| agent-skills | `agent-skills:constraint-driven-development` | build | 5252 | 0 of 12 | Establishes a project's quality bar as a written contract and stops agents quietly lowering it. |
| agent-skills | `agent-skills:context-engineering` | other | 3872 | 0 of 12 | Optimizes agent context setup. |
| agent-skills | `agent-skills:debugging-and-error-recovery` | other | 2728 | 0 of 14 | Guides systematic root-cause debugging. |
| agent-skills | `agent-skills:deprecation-and-migration` | other | 3161 | 0 of 12 | Manages deprecation and migration. |
| agent-skills | `agent-skills:documentation-and-adrs` | other | 2728 | 0 of 12 | Records decisions and documentation. |
| agent-skills | `agent-skills:doubt-driven-development` | build | 4162 | 0 of 12 | Subjects every non-trivial decision to a fresh-context adversarial review before it stands. |
| agent-skills | `agent-skills:frontend-ui-engineering` | other | 2930 | 5 of 12 | Builds production-quality, accessible, responsive user-facing UIs. |
| agent-skills | `agent-skills:git-workflow-and-versioning` | other | 3535 | 1 of 12 | Structures git workflow practices. |
| agent-skills | `agent-skills:idea-refine` | other | 2313 | 0 of 10 | Refines raw ideas into sharp, actionable concepts through structured divergent and convergent thinking. |
| agent-skills | `agent-skills:incremental-implementation` | build | 2407 | 3 of 10 | Delivers changes incrementally in thin, verifiable slices. |
| agent-skills | `agent-skills:interview-me` | other | 3770 | 0 of 10 | Extracts what the user actually wants instead of what they think they should want. |
| agent-skills | `agent-skills:observability-and-instrumentation` | other | 3487 | 0 of 12 | Instruments code so production behavior is visible and diagnosable. |
| agent-skills | `agent-skills:performance-optimization` | other | 4175 | 0 of 12 | Optimizes application performance across frontend, backend, queries, and databases. |
| agent-skills | `agent-skills:planning-and-task-breakdown` | spec | 2641 | 4 of 10 | Breaks work into ordered tasks. |
| agent-skills | `agent-skills:security-and-hardening` | review | 4390 | 2 of 14 | Hardens code against vulnerabilities. |
| agent-skills | `agent-skills:shipping-and-launch` | other | 2879 | 0 of 12 | Prepares production launches. |
| agent-skills | `agent-skills:source-driven-development` | build | 2510 | 1 of 12 | Grounds every implementation decision in official documentation. |
| agent-skills | `agent-skills:spec-driven-development` | build | 3274 | 4 of 10 | Creates specs before coding. |
| agent-skills | `agent-skills:test-driven-development` | test | 4169 | 14 of 26 | Drives development with tests using the red-green-refactor loop. |
| agent-skills | `agent-skills:using-agent-skills` | other | 2612 | 1 of 10 | Discovers and invokes agent skills. |
| Superpowers | `superpowers:brainstorming` | spec | 2518 | 12 of 12 | You MUST use this before any creative work - creating features, building components, adding functionality, modifying behavior, or plannin... |
| Superpowers | `superpowers:diagnosing-superpowers` | other | 1726 | 0 of 10 | Use when a superpowers session went wrong and your human partner wants to know why, repeated work, ignored plans, stumbles, poor results,... |
| Superpowers | `superpowers:dispatching-parallel-agents` | other | 1520 | 0 of 12 | Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies |
| Superpowers | `superpowers:executing-plans` | build | 5101 | 5 of 12 | Use when executing an implementation plan in the current session as the implementer yourself, your human partner chose inline execution, ... |
| Superpowers | `superpowers:finishing-a-development-branch` | build | 1945 | 1 of 12 | Use when implementation is complete, all tests pass, and you need to decide how to integrate the work |
| Superpowers | `superpowers:receiving-code-review` | review | 1551 | 0 of 12 | Use when receiving code review feedback, before implementing suggestions, especially if feedback seems unclear or technically questionabl... |
| Superpowers | `superpowers:requesting-code-review` | review | 744 | 7 of 12 | Use when completing tasks, implementing major features, or before merging to verify work meets requirements |
| Superpowers | `superpowers:subagent-driven-development` | build | 8144 | 0 of 12 | Use when executing implementation plans with independent tasks in the current session |
| Superpowers | `superpowers:systematic-debugging` | other | 2383 | 0 of 12 | Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes |
| Superpowers | `superpowers:test-driven-development` | test | 2395 | 14 of 26 | Use when implementing any feature or bugfix, before writing implementation code |
| Superpowers | `superpowers:using-git-worktrees` | other | 1703 | 2 of 12 | Use when starting feature work that needs isolation from current workspace or before executing implementation plans - ensures an isolated... |
| Superpowers | `superpowers:using-superpowers` | other | 798 | 0 of 12 | Use when starting any conversation - establishes how to find and use skills, requiring skill invocation before ANY response including cla... |
| Superpowers | `superpowers:verification-before-completion` | verify | 912 | 1 of 12 | Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - requires running verification commands a... |
| Superpowers | `superpowers:writing-plans` | spec | 2584 | 6 of 12 | Use when you have a spec or requirements for a multi-step task, before touching code |
| Superpowers | `superpowers:writing-skills` | other | 6656 | 0 of 12 | Use when creating new skills, editing existing skills, or verifying skills work before deployment |
| ECC | `agent-introspection-debugging` | spec | 1407 | 0 of 8 | Structured self-debugging workflow for AI agent failures using capture, diagnosis, contained recovery, and introspection reports. |
| ECC | `agent-self-evaluation` | other | 1906 | 0 of 8 | Use after completing any non-trivial task. |
| ECC | `agent-sort` | other | 1481 | 0 of 8 | Build an evidence-backed ECC install plan for a specific repo by sorting skills, commands, rules, hooks, and extras into DAILY vs LIBRARY... |
| ECC | `ai-regression-testing` | test | 2915 | 0 of 8 | Regression testing strategies for AI-assisted development. |
| ECC | `architecture-decision-records` | other | 1796 | 0 of 8 | Capture architectural decisions as numbered ADR markdown files in docs/adr/ with context, alternatives considered, consequences, and an i... |
| ECC | `auto-update` | other | n/a | 0 of 8 |  |
| ECC | `browser-qa` | other | 1026 | 0 of 8 | Run automated post-deploy UI verification with a browser automation MCP (claude-in-chrome, Playwright, or Puppeteer): console-error and C... |
| ECC | `ck` | other | 1253 | 0 of 8 | Persistent per-project memory for Claude Code (Context Keeper) driven by deterministic Node.js /ck commands: init, save, resume, info, li... |
| ECC | `click-path-audit` | review | 1994 | 0 of 8 | Trace every user-facing button/touchpoint through its full state change sequence to find bugs where functions individually work but cance... |
| ECC | `code-tour` | other | 2008 | 0 of 8 | Create CodeTour `.tour` files, persona-targeted, step-by-step walkthroughs with real file and line anchors. |
| ECC | `codebase-onboarding` | other | 2059 | 0 of 8 | Analyze an unfamiliar codebase and generate a structured onboarding guide with architecture map, key entry points, conventions, and a sta... |
| ECC | `codehealth-mcp` | other | 1866 | 0 of 8 | Real-time structural Code Health via CodeScene MCP, review before edits, verify score deltas after changes, gate commits and PRs. |
| ECC | `config-gc` | other | 1986 | 0 of 8 | Garbage collection for your Claude Code configuration. |
| ECC | `configure-ecc` | other | 1995 | 0 of 8 | Run the conversational ECC setup wizard inside the current harness: inventory the install, collect scope (user/project/local) and hook mo... |
| ECC | `context-budget` | other | 2011 | 0 of 8 | Audits Claude Code context window consumption across agents, skills, MCP servers, and rules. |
| ECC | `continuous-learning` | other | 1134 | 0 of 8 | [DEPRECATED - use continuous-learning-v2] Legacy v1 stop-hook skill extractor. |
| ECC | `continuous-learning-v2` | other | 3537 | 0 of 8 | Instinct-based learning system that observes sessions via hooks, creates atomic instincts with confidence scoring, and evolves them into ... |
| ECC | `council` | other | 1590 | 0 of 8 | Convene a four-voice council for ambiguous decisions, tradeoffs, and go/no-go calls. |
| ECC | `council-multi-model` | other | 1497 | 0 of 8 | Add one optional external Codex critique after the existing council has produced a decision draft. |
| ECC | `delivery-gate` | other | 1285 | 0 of 8 | Stop hook that blocks Claude from finishing until quality checks pass. |
| ECC | `dev-team` | other | 2080 | 0 of 8 | Simulate a collaborative dev team session where multiple role-based personas (PM, Architect, Developer, QA) respond to the same problem t... |
| ECC | `e2e-testing` | test | 2043 | 0 of 8 | Playwright E2E testing patterns, Page Object Model, configuration, CI/CD integration, artifact management, and flaky test strategies. |
| ECC | `ecc-guide` | other | 1428 | 0 of 8 | Answer questions about ECC by reading the live repo surface, agents, skills, commands, hooks, rules, install profiles, and docs, instead ... |
| ECC | `ecc-recipes` | other | 1613 | 0 of 8 | Map a described workflow to the right ECC command group with run-order and stop condition, or browse all command-group recipe families re... |
| ECC | `error-handling` | other | 2746 | 0 of 8 | Patterns for robust error handling across TypeScript, Python, and Go. |
| ECC | `eval-harness` | other | 2185 | 0 of 8 | Eval-driven development (EDD) framework for AI coding sessions, define capability and regression evals before coding, grade with code-bas... |
| ECC | `git-workflow` | other | 3827 | 0 of 8 | Git workflow patterns including branching strategies, commit conventions, keeping history clean and readable, tidying local commits befor... |
| ECC | `growth-log` | other | 1759 | 0 of 8 | Write growth log entries that extract reusable patterns from completed work, root cause, transferable rule, and a recognizable signal, in... |
| ECC | `hookify-rules` | other | 928 | 0 of 8 | Create and configure hookify rules, markdown files with YAML frontmatter that match bash, file, prompt, or stop events by regex or condit... |
| ECC | `inherit-legacy-style` | other | 2104 | 0 of 8 | Prevent AI style drift on legacy projects by scanning the codebase for implicit conventions, resolving conflicts with the operator one at... |
| ECC | `intent-driven-development` | build | 4300 | 0 of 8 | Turn ambiguous or high-impact product and engineering changes into scoped, verifiable acceptance criteria before or alongside implementat... |
| ECC | `iterative-retrieval` | other | 1697 | 0 of 8 | Pattern for progressively refining context retrieval to solve the subagent context problem. |
| ECC | `living-docs-governance` | other | 2121 | 0 of 8 | Keep a long-lived project's documentation from rotting by assigning existing project docs clear constitution, map, status, and history ro... |
| ECC | `loop-design-check` | spec | 2985 | 0 of 8 | Design a goal-oriented agent loop or review one for failure modes: spinning, Goodhart-gaming the verifier, or running a wrong answer to c... |
| ECC | `plan-canvas` | spec | 2169 | 0 of 8 | Open plans and HTML artifacts in a local browser canvas where the human annotates elements, chats, and approves or requests changes witho... |
| ECC | `plankton-code-quality` | spec | 3224 | 0 of 8 | Write-time code quality enforcement using Plankton, auto-formatting, linting, and Claude-powered fixes on every file edit via hooks. |
| ECC | `product-lens` | other | 843 | 0 of 8 | Validate the why before building through four product diagnostics, a YC-style product diagnostic that produces PRODUCT-BRIEF.md with a go... |
| ECC | `production-audit` | review | 1932 | 0 of 8 | Local-evidence production readiness audit for shipped apps, pre-launch reviews, post-merge checks, and "what breaks in prod?" questions w... |
| ECC | `repo-scan` | other | 1811 | 0 of 8 | Bootstrap pointer that installs the external repo-scan skill from a pinned, reviewable commit. |
| ECC | `rules-distill` | other | 2397 | 0 of 8 | Scan skills to extract cross-cutting principles and distill them into rules, append, revise, or create new rule files. |
| ECC | `santa-method` | other | 3248 | 0 of 8 | Multi-agent adversarial verification: two independent reviewers with the same rubric must both pass before output ships, with a fix-and-r... |
| ECC | `setup-pm` | other | n/a | 0 of 8 |  |
| ECC | `skill-comply` | other | 625 | 0 of 8 | Visualize whether skills, rules, and agent definitions are actually followed, auto-generates scenarios at 3 prompt strictness levels, run... |
| ECC | `skill-scout` | other | 1122 | 0 of 8 | Search existing local, marketplace, GitHub, and web skill sources before creating a new skill. |
| ECC | `skill-stocktake` | other | 1955 | 0 of 8 | Use when auditing Claude skills and commands for quality. |
| ECC | `strategic-compact` | other | 2152 | 0 of 8 | Suggests manual context compaction at logical intervals to preserve context through task phases rather than arbitrary auto-compaction. |
| ECC | `tdd-workflow` | test | 5399 | 0 of 8 | Test-driven development workflow: write a failing test first, watch it fail, implement the smallest change to green, then refactor with 8... |
| ECC | `unified-memory` | other | 1968 | 0 of 8 | Share durable, inspectable context and handoffs between Claude, Codex, Hermes, Cursor, OpenCode, and other agents through the local ECC M... |
| ECC | `verification-loop` | verify | 698 | 0 of 8 | Run a six-phase verification of a Claude Code session's work, build, type check, lint, tests with coverage, security grep, and diff revie... |
| ECC | `windows-desktop-e2e` | other | 7644 | 0 of 8 | E2E testing for Windows native desktop apps (WPF, WinForms, Win32/MFC, Qt) using pywinauto and Windows UI Automation. |
| Matt Pocock | `mattpocock-skills:ask-matt` | other | 3113 | 1 of 12 | Ask which skill or flow fits your situation. |
| Matt Pocock | `mattpocock-skills:code-review` | review | 1647 | 14 of 48 | Review the changes since a fixed point (commit, branch, tag, or merge-base) along two axes: Standards (does the code follow this repo's d... |
| Matt Pocock | `mattpocock-skills:codebase-design` | spec | 1612 | 0 of 12 | Shared vocabulary for designing deep modules. |
| Matt Pocock | `mattpocock-skills:diagnosing-bugs` | other | 2133 | 0 of 12 | Diagnosis loop for hard bugs and performance regressions. |
| Matt Pocock | `mattpocock-skills:domain-modeling` | spec | 837 | 1 of 12 | Build and sharpen a project's domain model. |
| Matt Pocock | `mattpocock-skills:grill-me` | spec | 39 | 0 of 12 | A relentless interview to sharpen a plan or design. |
| Matt Pocock | `mattpocock-skills:grill-with-docs` | spec | 62 | 1 of 12 | A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go. |
| Matt Pocock | `mattpocock-skills:grilling` | spec | 497 | 1 of 12 | Grill the user relentlessly about a plan, decision, or idea. |
| Matt Pocock | `mattpocock-skills:handoff` | other | 224 | 0 of 12 | Compact the current conversation into a handoff document for another agent to pick up. |
| Matt Pocock | `mattpocock-skills:implement` | build | 108 | 0 of 12 | Implement a piece of work based on a spec or set of tickets. |
| Matt Pocock | `mattpocock-skills:implement-spec` | build | 695 | 0 of 12 | Implement the result of /to-spec and /to-tickets in code. |
| Matt Pocock | `mattpocock-skills:improve-codebase-architecture` | other | 1500 | 0 of 12 | Scan a codebase for deepening opportunities, present them as a visual HTML report, then grill through whichever one you pick. |
| Matt Pocock | `mattpocock-skills:pr` | other | 1042 | 0 of 12 | Use when writing a PR body. |
| Matt Pocock | `mattpocock-skills:prototype` | other | 733 | 0 of 12 | Build a throwaway prototype to answer a design question. |
| Matt Pocock | `mattpocock-skills:research` | other | 199 | 0 of 12 | Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. |
| Matt Pocock | `mattpocock-skills:retro` | other | 1092 | 0 of 12 | Conduct a retrospective on a coding session. |
| Matt Pocock | `mattpocock-skills:setup-matt-pocock-skills` | other | 1712 | 0 of 12 | Configure this repo for the engineering skills: set up its issue tracker, triage label vocabulary, and domain doc layout. |
| Matt Pocock | `mattpocock-skills:tdd` | test | 888 | 5 of 12 | Test-driven development. |
| Matt Pocock | `mattpocock-skills:teach` | other | 2377 | 0 of 12 | Teach the user a new skill or concept, within this workspace. |
| Matt Pocock | `mattpocock-skills:to-questionnaire` | other | 726 | 0 of 12 | Turn a decision you can't fully answer into a questionnaire for someone else to fill in. |
| Matt Pocock | `mattpocock-skills:to-spec` | spec | 761 | 0 of 12 | Turn the current conversation into a spec and publish it to the project issue tracker: no interview, just synthesis of what you've alread... |
| Matt Pocock | `mattpocock-skills:to-tickets` | other | 1418 | 0 of 12 | Break a plan, spec, or the current conversation into a set of tracer-bullet tickets, each declaring its blocking edges, published to the ... |
| Matt Pocock | `mattpocock-skills:triage` | other | 1640 | 0 of 12 | Move issues and external PRs through a state machine of triage roles, categorise, verify, grill if needed, and write agent-ready briefs. |
| Matt Pocock | `mattpocock-skills:wait-what` | other | 99 | 0 of 12 | Stop. |
| Matt Pocock | `mattpocock-skills:wayfinder` | other | 2977 | 0 of 12 | Plan a huge chunk of work (more than one agent session can hold) as a shared map of decision tickets on your issue tracker, and resolve t... |
| Matt Pocock | `mattpocock-skills:wizard` | other | 1031 | 0 of 12 | Generate an interactive bash wizard that walks a human through steps only they can perform. |
| Matt Pocock | `mattpocock-skills:writing-for-agents` | other | 2722 | 0 of 12 | Writing documents for agents. |
| Ponytail | `ponytail:ponytail` | other | 817 | 0 of 22 | Lazy senior dev mode for any coding task: the smallest change that fully solves it, and a reply a busy human understands in one read. |
| Ponytail | `ponytail:ponytail-audit` | review | 1313 | 0 of 22 | Quality audit of the whole repo: bugs, security, real load, missing tests, speed, and what to delete. |
| Ponytail | `ponytail:ponytail-debt` | other | 449 | 0 of 22 | Harvest every shortcut: comment into one debt ledger, so deferrals get tracked instead of forgotten. |
| Ponytail | `ponytail:ponytail-gain` | other | 560 | 0 of 22 | Show ponytail measured impact as a scoreboard: less code, less cost, more speed, from the agentic benchmark averages. |
| Ponytail | `ponytail:ponytail-help` | other | 725 | 0 of 22 | Quick reference for ponytail's modes, skills, and commands. |
| Ponytail | `ponytail:ponytail-review` | review | 1244 | 2 of 22 | Quality review of a diff: bugs, security, real load, missing tests, speed, and what to delete. |
| OpenSpec | `openspec-apply-change` | build | 2858 | 10 of 26 | Implement tasks from an OpenSpec change. |
| OpenSpec | `openspec-archive-change` | spec | 4149 | 3 of 26 | Archive a completed OpenSpec change in the experimental workflow. |
| OpenSpec | `openspec-explore` | spec | 5705 | 0 of 26 | Enter OpenSpec explore mode - a thinking partner for exploring ideas, investigating problems, and clarifying requirements in a project th... |
| OpenSpec | `openspec-propose` | spec | 4066 | 10 of 26 | Propose a new OpenSpec change with all artifacts generated in one step. |
| OpenSpec | `openspec-sync-specs` | spec | 3945 | 2 of 26 | Sync delta specs from an OpenSpec change to main specs. |
| OpenSpec | `openspec-update-change` | spec | 2850 | 0 of 20 | Update an OpenSpec change by revising its existing planning artifacts and keeping them coherent with one another. |
| Spec Kit | `speckit-analyze` | spec | 3035 | 2 of 4 | Perform a non-destructive cross-artifact consistency and quality analysis across spec.md, plan.md, and tasks.md after task generation. |
| Spec Kit | `speckit-checklist` | spec | 5690 | 0 of 4 | Generate a custom checklist for the current feature based on user requirements. |
| Spec Kit | `speckit-clarify` | spec | 4953 | 0 of 4 | Identify underspecified areas in the current feature spec by asking up to 5 highly targeted clarification questions and encoding answers ... |
| Spec Kit | `speckit-constitution` | spec | 2659 | 1 of 4 | Create or update the project constitution from interactive or provided principle inputs. |
| Spec Kit | `speckit-converge` | spec | 3377 | 0 of 4 | Assess the current codebase against the feature's spec, plan, and tasks, then append any remaining unbuilt work as new tasks to tasks.md ... |
| Spec Kit | `speckit-implement` | build | 3300 | 1 of 4 | Execute the implementation plan by processing and executing all tasks defined in tasks.md |
| Spec Kit | `speckit-plan` | spec | 2086 | 2 of 4 | Execute the implementation planning workflow using the plan template to generate design artifacts. |
| Spec Kit | `speckit-specify` | spec | 4687 | 1 of 4 | Create or update the feature specification from a natural language feature description. |
| Spec Kit | `speckit-tasks` | spec | 2921 | 1 of 4 | Generate an actionable, dependency-ordered tasks.md for the feature based on available design artifacts. |
| Spec Kit | `speckit-taskstoissues` | spec | 2187 | 0 of 4 | Deprecated: Convert existing tasks into actionable, dependency-ordered GitHub issues for the feature based on available design artifacts. |
| BenchKeeper layer (with agent-skills) | `find-skills` | other | 1368 | 0 of 16 | Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that ... |
| BenchKeeper layer (with agent-skills) | `global-setup` | other | 3549 | 0 of 16 | Check, install, and clean the machine-wide agent setup for Claude Code and Codex: devcontainer tooling, global rules, Ponytail (full), ad... |
| BenchKeeper layer (with agent-skills) | `playwright-best-practices` | other | 6577 | 0 of 16 | Use when writing Playwright tests, fixing flaky tests, debugging failures, implementing Page Object Model, configuring CI/CD, optimizing ... |
| BenchKeeper layer (with agent-skills) | `ponytail:ponytail` | other | 817 | 0 of 22 | Lazy senior dev mode for any coding task: the smallest change that fully solves it, and a reply a busy human understands in one read. |
| BenchKeeper layer (with agent-skills) | `ponytail:ponytail-audit` | review | 1313 | 0 of 22 | Quality audit of the whole repo: bugs, security, real load, missing tests, speed, and what to delete. |
| BenchKeeper layer (with agent-skills) | `ponytail:ponytail-debt` | other | 449 | 0 of 22 | Harvest every shortcut: comment into one debt ledger, so deferrals get tracked instead of forgotten. |
| BenchKeeper layer (with agent-skills) | `ponytail:ponytail-gain` | other | 560 | 0 of 22 | Show ponytail measured impact as a scoreboard: less code, less cost, more speed, from the agentic benchmark averages. |
| BenchKeeper layer (with agent-skills) | `ponytail:ponytail-help` | other | 725 | 0 of 22 | Quick reference for ponytail's modes, skills, and commands. |
| BenchKeeper layer (with agent-skills) | `ponytail:ponytail-review` | review | 1244 | 2 of 22 | Quality review of a diff: bugs, security, real load, missing tests, speed, and what to delete. |
| BenchKeeper layer (with agent-skills) | `project-setup` | other | 3494 | 0 of 16 | Set up or update a repository's development container and agent tooling for Claude Code and Codex: devcontainer configuration, AGENTS.md,... |
