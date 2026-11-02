import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import data from '../pages/_generated/data.json';
import { useAnchor } from './Page';
import SitePage from './SitePage';

export type Shot = { width: number; height: number };

// The CLI prefix of each view's commands; the release rewrites the version.
const V = 'npx benchkeeper@6.25.0';

// One section per view of the app; view is its route in the sidebar of app/ui/App.jsx. The screenshots are saved by app/scripts/screenshots.mjs.
export const VIEWS: { id: string; view: string; title: string; shot: string; alt: string; text: string[]; cli: string[] }[] = [
  {
    id: 'start', view: 'dashboard', title: 'Starting screen', shot: 'start',
    alt: 'The Dashboard as the app opens: the number of items that need attention with where they are, the Fix everything button and the Set up menu, the number of doctor findings by level, then the bar of item states and the list of scopes.',
    text: [
      'The app opens on the Dashboard. The first panel counts the items of the global setup and the projects that need attention, with a link to each place, names the projects that cannot be read, and holds the Fix everything button and the Set up menu (Set up everything, Set up global only, Set up projects). The doctor findings follow with their count by level; the count opens the Doctor section.',
      'The setup flow, the install level and what the next level adds, the BenchKeeper plugin per agent, the installed skills and packs (global and per project), pack coverage, the catalog by pack as a sorted bar list and the global setup by part and agent are folded under More about the setup. A cell of the global setup by part and agent opens that agent\'s plan.',
      'The sidebar groups the views: Overview (Dashboard, History), Projects (Projects), Catalog (Skills, Packs), Analysis (Sessions, Runs, Insights, Evals), Agent configuration (Global setup, Agent settings, Rules, Extensions, Accounts), Machine (Automations, Preferences), and Advanced while Editors is on. The view, a project\'s page and its tab are part of the URL, so a reload and Back keep them.',
    ],
    cli: [`${V}`, `${V} projects status`],
  },
  {
    id: 'onerun', view: 'dashboard', title: 'One-run setup', shot: 'onerun',
    alt: 'The One-run setup drawer: the Global setup checkbox, the install level, the projects to set up with their state, and the Start button.',
    text: [
      'Set up everything prepares the global setup at the chosen level and each project you pick without questions in between, then shows all changes on one page. Nothing is written until you apply. The Set up menu and the command palette open it.',
      'A project with a shared setup is left to Update all, which commits it on a local branch for you to push. So are a project whose setup is still committed and a folder without a repository; the checklist holds the other projects.',
      'Projects without a setup can start from agent suggestions: one start form and one consent for all of them, read-only sessions one at a time. One progress bar has a line per item: waiting, running, ready, failed with the reason, or cancelled.',
      'The review page has a section for the global plan and one per project, a checkbox per section and per change, and each diff behind a button. A project\'s answers (agents, environment, packs, tier) are editable in place and build its plan again. One apply job then shows progress per section and links each run in History for undo.',
      'A failed suggestion or plan shows its reason and leaves the rest; a failed section leaves the others. Cancel during preparation stops the running suggestion session and keeps what is ready for review; during the apply it stops after the change that runs.',
    ],
    cli: [`${V} apply --level full`, `${V} projects apply <dir>`],
  },
  {
    id: 'dashboard', view: 'dashboard', title: 'Dashboard health', shot: 'dashboard',
    alt: 'The Dashboard scrolled to Health: one bar of item states with the total above it and the numbers as links below it, the global setup and each project with its own state bar, then the three worst doctor findings, one line each, and the recent runs.',
    text: [
      'Health counts the items of the global setup and of each registered project as current, modified, outdated, missing, removed, foreign or untracked (a skill folder in a project that BenchKeeper did not install), as one bar with the numbers as text; each number links to what it counts. Where shows the same states per scope, with the packs of each project. Recent runs lists the last 6.',
      'Coverage, folded below, counts the projects that chose each pack, per agent; skills that exist for one agent only are marked, and packs no project chose are one line of links. Every figure links to the Global setup, Projects or Catalog view it counts, which opens filtered by pack and agent.',
    ],
    cli: [`${V} dashboard`],
  },
  {
    id: 'fix', view: 'dashboard', title: 'Fix everything', shot: 'fix',
    alt: 'The Fix everything drawer on step 1, Global setup: the rules file marked modified with its diff, then the plugin and marketplace installs as commands, one checkbox each.',
    text: [
      'Four steps: the global setup, the projects that are behind or have pending changes (none checked at first), the doctor findings the setup cannot fix, and a summary of what Apply does. Each change is a checkbox with its diff or command line.',
      'Removals of items you installed yourself stay off until you check them. Skill installs run first in a scratch folder, so the plan lists the files they would write.',
      'Apply runs the global plan, then Update all for each checked project; Stop after this project skips the rest. A global setup that fails or is cancelled leaves the projects unless you start them anyway. The doctor runs again at the end, and the drawer stays open over other views until the run is over.',
    ],
    cli: [`${V} plan`, `${V} apply`],
  },
  {
    id: 'projects', view: 'projects', title: 'Projects and pack switching', shot: 'projects',
    alt: 'The Installs tab of the project shop, outdated with one finding: its packs as switches, the pack in use or suggested first, then the others, one row each with its scope, its state, what it is for and a Details button for what turning it on copies.',
    text: [
      'Each registered project is a card with its health, setup, packs and sessions of the last 30 days. A project is behind when its setup version differs from the one of the app.',
      'Projects show as cards (the default) or a table; the browser keeps the choice. Above them stand the totals of the projects shown (projects, in sync, need attention, sessions in the last 7 days) and one health bar.',
      'A card shows name and folder (cut at its start), a health dot (in sync, outdated, modified, folder not found, not set up) with the count of doctor findings, the setup in one line (agents, default tier, workflow owner) with its packs, and sessions per day as a bar graph with a text alternative. The graph covers all agents and the repository\'s worktrees, with the total and its change against the previous 30 days, the cost with the count of sessions without one, and the last session with its tier. The buttons: Details, Open board (the Sessions view), Set up or Apply (the project\'s plan), Update and Remove setup.',
      'A table row shows name and tree state, path (cut at its start) and branch, one setup status (current, behind or not set up, and local or shared), the skills each session of a chosen agent loads (the project\'s own with its global and plugin skills) and the pending changes.',
      'Add offers another worktree of a registered repository instead of adding it, and flags a folder inside a project; Scan lists the projects below a parent folder to add. Choose folder opens the system dialog (osascript on macOS, zenity, then kdialog on Linux); with none of them, on Windows, on Linux without a display, or after a cancel, type the path.',
      'The list has New from preset (starts a new folder from a saved preset, shows the plan, registers the folder and then recommends skills to turn off and packs to add, none chosen), search, filter chips (needs attention, no setup, folder not found, each pack and agent in use; every chip on must hold), a sort (name, health, last change), Edit name and notes, Relocate for a folder that moved, Remove from list and Remove BenchKeeper setup (every file listed first; a local setup is a run with undo in History, a shared one a commit on a local branch), and Update all with progress per project and, per committed branch, the command that pushes it.',
      'A missing folder shows Folder not found with Relocate and Remove. The same four actions, plus Update and Set up, work on several selected projects at once with one confirmation naming the count; their bar shows only with a selection.',
      'The name or Details opens the project\'s page: name, health dot and folder, Change setup, and a More menu with Open folder (the file manager), Edit name and notes, Relocate and the two removals. Its tabs: Overview (the card\'s facts, its items by state, the project doctor), Installs, Sessions (the board with only its sessions), Rules and settings (its instruction files and its project and local settings files) and History (its runs).',
      'A page link looks like #/projects/<dir, encoded>/sessions. An older #/projects?path=<dir> link opens the Installs tab, and a folder that is not registered shows a link back to Projects.',
      'The Installs tab of a project has one switch each for packs, the workflow owner, skills and agent files. It lists the packs in use or suggested first as rows, then the others as a two-column grid with scope and state under Details, each with when to pick it; Copy packs from project takes another project\'s packs, and the preview lists the skills a pack takes along or removes. A switch shows a scope hint (only this project or also global, or a scope an agent fixes, with its reason), the state on disk, and a summary in plain words with impact, default and current value.',
      'The switches build the plan below them, which alone changes the project, with its diff, and History undoes it. A read-only block shows what the global setup makes active here (global packs the project does not select, the BenchKeeper plugin, global skills) with a link to Global setup. A project without a setup shows Set up.',
      'Skill states lists each skill of the project with its state, the commit installed and, after Check for updates, the source\'s newest, with a filter by state. A switch deactivates and activates a skill; Update, Reset and Remove each open the plan with the diff, then apply and undo. Untracked folders get Adopt for library skills and are left alone otherwise.',
    ],
    cli: [`${V} projects list`, `${V} packs enable <id> --project <dir>`, `${V} projects create <dir> --preset <id>`],
  },
  {
    id: 'skills', view: 'skills', title: 'Skills', shot: 'skills',
    alt: 'The Skills page of the Catalog: search, the filters for pack, agent and install state, New skill, then the library skills, each with a checkbox for the pack, badges for the library packs that name it and the number of projects that have it.',
    text: [
      'The Catalog has two pages. Skills lists the library skills and your own with filters, the library packs that name each skill as badges, and the number of projects that have each. The detail of the one you open shows its source, pin and eval results. The pack builder makes own packs from them and warns about overlapping descriptions.',
      'New skill adds a skill of your own, marked "yours" in the list, with Edit and Remove on its row and its detail. Each opens its SKILL.md text in a dialog and ends in a plan with a diff. A project or own pack picks it like a library skill and gets a copy.',
      'The state of each skill in a project (current, outdated, modified, removed or disabled), with an Active switch and Update, Reset and Remove, is on the project\'s Installs tab.',
    ],
    cli: [`${V} skills list --library`, `${V} skills new <name>`, `${V} skills update <name> --project <dir>`],
  },
  {
    id: 'packs', view: 'packs', title: 'Packs', shot: 'packs',
    alt: 'The Packs page of the Catalog: the plugin packs on top, then the library and own packs as cards, each with its skills, whether it is an own pack, the projects that use it, Export, and Remove for an own pack.',
    text: [
      'Packs lists the library packs and your own with the projects that use them, and exports, imports and removes own packs. Import asks before it replaces an own pack; Remove is off while a project uses the pack. A pack is defined once and switched on per project, on the project\'s Installs tab.',
    ],
    cli: [`${V} packs list`, `${V} packs enable <id> --project <dir>`],
  },
  {
    id: 'setup', view: 'projects', title: 'Project setup', shot: 'setup',
    alt: 'The Set up project drawer on its last step: the choice between a setup on this machine and one in the repository on a branch, then the files it writes, CLAUDE.local.md and .benchkeeper/state.json, as diffs.',
    text: [
      'Five steps: agents with where the setup lives, the environment where the agent runs (the dev container by default), packs and skills with suggestions from the project\'s files, the default tier, and a review. The review shows every file as a diff before anything is written.',
      'The setup stays on this machine by default, in files Git ignores. The other choice commits it on a local branch, one commit, which you push. Change setup reopens the steps from the state file.',
      'Several projects are set up one after the other. Prefill all with an agent, on the first project of a batch, runs one suggestion session per project after one consent, one at a time with a state per project (waiting, running, ready, failed, cancelled). Each project\'s steps then start from its suggestion and are still reviewed and applied one by one; a reload loses suggestions not yet used. Suggest with an agent runs one read-only session in the project after a question and fills the steps from its answer.',
      'Steps only you can start (the setup skill session, a pack\'s own setup) show in the review step, the result step and the project doctor as a Start in a terminal block: agent, project folder and the full benchkeeper sessions record --project <dir> -- <agent> \'<prompt>\' line with Copy. The recorded run shows in History with its exit code and changed files. Check again reads the project doctor again; its warning is gone once the files the step writes exist.',
    ],
    cli: [`${V} projects plan <dir>`, `${V} projects apply <dir>`],
  },
  {
    id: 'sessions', view: 'sessions', title: 'Sessions board', shot: 'sessions',
    alt: 'The Sessions view with the board in a frame: the project choice closed as a chip in one line with the filters for agent, tier, pattern, setup and period, then tiles for sessions, agent time, cost, tokens and tests passed.',
    text: [
      'The board reads the Claude Code and Codex transcripts on the machine when it opens and on Rescan: per session the tier, the pattern (single, loop, group or Orca worker), the setup installed at the time, skills used, last test run, cost (Claude Code as recorded, Codex estimated from tokens and OpenAI API prices, unpriced models left out), time and pull request links.',
      'The view scans when it opens, with progress, and on Rescan. Four figures lead; the others fold under More figures. The per-day chart shows all series of a day on hover, tap or with the arrow keys, and a click on a project in the rail filters the whole page.',
      'The filters stand in a column left of the figures, the project choice first as one chip that opens the list; at phone width one Filters button opens the column. The project list puts registered repositories first, one entry per repository with its worktrees folded in, and has a search. Comparison charts by tier, pattern and setup show how many sessions each bar rests on and mark the ones under 20. Each chart has its table behind a button.',
      'Ponytail\'s ledger, when present, adds its figures and ledger-only rows. When Ponytail\'s own board page (board.html next to its ledgers) exists, Open Ponytail\'s board opens it.',
    ],
    cli: [`${V} sessions board`],
  },
  {
    id: 'runs', view: 'runs', title: 'Runs', shot: 'runs',
    alt: 'The Runs view: the orchestrated runs table with run, task, worktree, branch, sessions, cost and tokens, the last setup change of each registered project, one line saying the multi-agent IDE is not installed, and the folded command.',
    text: [
      'Orchestrated runs and their tasks in the registered projects and their worktrees, one row per run and per task with worktree, branch, sessions, tokens and cost (Claude Code as recorded, Codex estimated from tokens and OpenAI API prices, unpriced models left out), each project\'s last setup change from the ledger, and the runs of the multi-agent IDE (Orca) when it is installed, with task counts per state.',
      'The view reads when it opens and on Refresh, with no timer: for Orca one run-list call and one task-list call per run, at most 20 runs. The rows hold ids, states and counts, never a prompt, spec, title or worker output.',
    ],
    cli: [`${V} sessions list`, `${V} sessions list --run <id>`],
  },
  {
    id: 'insights', view: 'insights', title: 'Insights', shot: 'insights',
    alt: 'The Insights view: the number of findings by level with the one to do first, what was checked, the folded adviser narrative, then the findings grouped by level and area: errors as cards with their evidence, fix and the Dismiss and Snooze 7 days buttons, warnings and info as one-line rows with their fix button and a More menu that holds Dismiss and Snooze 7 days.',
    text: [
      'Findings of the setup and the sessions: doctor findings, agent settings, versions behind, installed skills no session used and friction in one project. A line counts them by level with a Do first link to the most severe, then what was checked. They are grouped by level (Errors, Warnings, Info; Info folded) and inside a level by area (Setup, Agent settings, Updates, Skills, Sessions), most severe first.',
      'An error is a card with its evidence and fix and the Dismiss and Snooze 7 days buttons. A warning or info finding is one line with its fix button and a More menu that holds Dismiss and Snooze 7 days; its title opens the evidence and the fix hint. A doctor finding the setup can fix has the Dashboard\'s action, which opens its plan with the diff and undo or the view that fixes it. A skill proposal\'s Plan opens that project\'s plan for those skills, with its diff, apply and undo. The others show their fix text.',
      'The session signals need 20 Claude Code sessions of the last 90 days and report nothing below that. Dismiss hides a finding until its evidence changes (the failed sessions of a project, the unused skills, a doctor finding\'s details; not the counts), Snooze 7 days until that date or a change. Dismissed and snoozed (n) lists them with Show again.',
      'The adviser narrative is optional: one agent session on your login summarizes the findings and suggests an order. It runs only on a click, after a consent text shown once, with the exact input and its size in characters shown beside the button. The text is marked as model text and shows its cost as the agent recorded it (Claude Code API-equivalent USD, Codex tokens). On the command line, --yes starts it; without --yes the command shows a cached narrative, or the input it would send, and starts nothing.',
    ],
    cli: [`${V} insights --json`, `${V} insights --json --narrative --agent claude --yes`],
  },
  {
    id: 'evals', view: 'evals', title: 'Evals', shot: 'evals',
    alt: 'The Evals view: the agent and model picker, the table of eval targets with cases, miss and false trigger rates, the Run evals form with the agents to use and the Plan evals button, and the folded How evals work section.',
    text: [
      'An eval case is a short task that a real agent session gets in a throwaway folder; the result records whether the skill loaded. Miss counts the tasks that needed the skill when it did not load, false trigger the tasks that did not need it when it loaded. Lower is better for both.',
      'Per agent and model (the newest by default), each target shows its latest rates, worst first, and, when you pick it, its rates over time. Plan lists the targets changed since their last result and the sessions they start; nothing runs before Start, which shows progress per session. Cancel stops the running session; finished targets keep their results. Evals use your agent subscription and never run in CI.',
    ],
    cli: [`${V} evals plan`, `${V} evals run`, `${V} evals results`],
  },
  {
    id: 'global', view: 'agents', title: 'Global setup', shot: 'global',
    alt: 'The Global setup view: the installed agents with version, rules file, skills folder, tested and a chip for each feature that is not available, the agents that are not installed folded into one line, then the items installed globally, one group each with its count and how many need attention, a box on each item that needs attention, and the Plan button counting the ticked items.',
    text: [
      'The machine-wide setup per agent: each installed agent with its version, rules file and skills folder, whether BenchKeeper is tested with it and what it does not support, the agents that are not installed folded below, then the items installed globally with their state; a group with items that need attention starts open.',
      'The items are grouped by part (plugins and packs, skills, rules, settings, machine tools, other), each with its count, the items that need attention, its items behind Show items and a link to the view that edits it (Extensions, Rules, Agent settings). Links lead to Accounts and to Projects, whose Installs tab holds the per-project controls.',
      'Each item that needs attention has a box (a removal starts unticked); Plan N items shows the changes for the ticked ones, each with a diff, before anything is written, and a tick after that drops the open plan. Apply shows each change as it runs, with the command output, then the run report in place of the plan; Cancel skips the changes not started yet. Removing the setup is an undo of its runs in History; the app does not install or remove agents.',
    ],
    cli: [`${V} plan --agents claude,codex`, `${V} apply --agents claude,codex`],
  },
  {
    id: 'rules', view: 'rules', title: 'Rules', shot: 'rules',
    alt: 'The Rules view: a summary strip with the tokens Claude Code loads at the start of a session against the limit, its largest source and the checks, then the Claude Code tab with the context budget per source and the auto memory per project with its number of notes, size, last change and whether MEMORY.md is within the load limit.',
    text: [
      'A strip at the top shows, per agent, the tokens that load at the start of every session against the limit, counted as four bytes per token, the largest source and the checks. Below it, Claude Code and Codex each have a tab with the instruction files they load, globally or for a registered project, in load order, with scope, owner (BenchKeeper, project or yours), size and whether each loads (on, only for matching files, off, or replaced by a Codex override), and the context budget per source.',
      'A project shows its own folder only: Claude Code also loads the CLAUDE.md files of folders above it, which the view does not list. For a file of yours, Doctor lists its rules check findings except a missing @import; drift from the setup is reported only for the files the full level writes its rules into, ~/.claude/rules/00-global.md and ~/.codex/AGENTS.md, whoever wrote them.',
      'The context budget adds rule files, @ imports, skill descriptions and auto memory (the first 200 lines or 25 KB of MEMORY.md), names the largest source and warns above 10,000 tokens, BenchKeeper\'s own limit; Codex notes its 32 KiB cap.',
      'Claude Code\'s auto memory shows per project (all of them in the global view) in numbers only: topic notes, total size, last change and whether MEMORY.md is over what loads. The notes stay unread, and where auto memory is off the row says so.',
      'A file\'s text opens read-only in a drawer on this machine only. Edit there, for your files and the project\'s, counts tokens and lines and re-runs the checks while you type; Save is a plan with the diff, a backup in the run and undo in History.',
      'A file that is not BenchKeeper\'s has a switch; nothing here deletes it. A switch is a plan with a diff, and History undoes it. Codex files that ship with a repository, or a global Codex file for one project, have no switch: Codex has no setting for it.',
    ],
    cli: [`${V} rules list`, `${V} rules check`, `${V} rules disable <file>`],
  },
  {
    id: 'extensions', view: 'extensions', title: 'Extensions', shot: 'extensions',
    alt: 'The Extensions view for the global files: per agent one row per MCP server, hook, subagent, command or output style with its name, chips for kind, runs code, scope, owner and transport, what it runs, the file it comes from and a Remove link to the Doctor, and an empty state for an agent without extensions.',
    text: [
      'What each agent loads or runs besides rules and skills, globally or for a registered project: MCP servers, hooks, subagents, commands and output styles, with scope, owner and the file each comes from. Runs code marks hooks with a command, stdio servers and commands that run a shell line. A global server or hook links to the removal offer of the global plan (full level).',
      'The view reads the agents\' files only and has no switch: no agent starts and nothing is written. Environment values and headers never appear; secrets in command lines are masked when their name or shape is a known one, so a secret in another form can still show.',
    ],
    cli: [`${V} extensions list --agent claude`, `${V} extensions list --project <dir>`],
  },
  {
    id: 'settings', view: 'agent-settings', title: 'Agent settings', shot: 'settings',
    alt: 'The Agent settings view for Claude Code: hardening advice folded into one line, the count of settings that differ from the suggestion, the settings search and filters, and a table of the differing settings with their current, default and suggested values, a Differs from suggested marker and the Use suggested and Keep mine buttons.',
    text: [
      'The agents\' own settings, apart from Preferences (the app\'s own). Per agent (Claude Code, Codex) and layer (the user file, or the project or local file of a registered project), the basic list groups the settings by topic, one row each: the key, one sentence, the value in the layer, the layer in effect, the default and BenchKeeper\'s suggestion. Managed settings show read-only.',
      'Settings that differ from the suggestion come first, matching ones are folded unless a search or Changed from default narrows the list, and Details opens what a setting does and why it is suggested. A value the global plan offers unselected is labelled BenchKeeper recommendation; unset keys get suggested values with their reason and source.',
      'A line counts the settings in the chosen file that differ from their suggestion, and each such key has a Differs from suggested marker. Use suggested opens the change plan; Keep mine lists the setting under Decided and silences it here and in Doctor until Show again. The search has the switches Changed from default and Differs from suggested, which filter the basic list and Advanced.',
      'Notes are titled by kind: Conflicting settings (one setting disables another), Hardening (advice against a default), Ignored setting and Note. Each names the default, what it risks, what the fix changes and the source, with Dismiss, I accept this; a Dismissed (n) line shows them again. Conflicting settings are shown in full; hardening advice folds into one line, Hardening advice (n), with the keys it names.',
      'The less noise switches apply as one plan. For Codex, Trusted projects lists each folder of the user file with its trust and whether it still exists; Remove marks one that no longer exists for removal. Advanced lists every key of the pinned schemas, the environment entries and keys outside the app\'s list, which edits keep.',
      'Every change is a plan with a diff: Review shows it, Apply writes it through the same runner, and History undoes it.',
    ],
    cli: [`${V} settings list --agent claude`, `${V} settings set <key> <value>`],
  },
  {
    id: 'accounts', view: 'accounts', title: 'Accounts', shot: 'accounts',
    alt: 'The Accounts view: one card per account with its agent, address and plan, whether it is signed in and which one new sessions use, the 5-hour and 7-day usage windows as bars with the percent left and the reset time, and the buttons to add a Claude Code or Codex account.',
    text: [
      'Add Claude Code account and Add Codex account open a private browser window to sign in; the account is named after the signed-in address. Each card shows whether the account is signed in and what is left of its usage windows.',
      'Accounts are listed per agent, on the host or in a dev container, each with Check, a default switch, Sign in and Remove; Add account is a plan with a diff and undo. Sign in is the guided flow of accounts login: the steps (account, private window, code if the browser shows one, check), the link and the agent\'s own lines, with a field for the code.',
      'Check also shows the usage left in the 5-hour and 7-day window (or why it is unknown, or the command that starts tracking it) and the usage notices. A Usage limits section shows the minimum headroom per account, the auto-pick setting and the provider\'s terms caveat; accounts limits changes the values.',
      'Use for new sessions makes an account the default in one click, and Track usage sets up tracking for a Claude Code host account in one click; both are runs with an undo in History. The list keeps names and folders, never a credential.',
      'The view states the container risk (a hijacked session can read the credentials in the volume) and that nothing switches accounts mid-session.',
    ],
    cli: [`${V} accounts list`, `${V} accounts login <name>`],
  },
  {
    id: 'automations', view: 'automations', title: 'Automations', shot: 'automations',
    alt: 'The Automations view without the runner: one panel with the single setup step and a Check again button, a Show templates button for the templates table, then the CLI commands.',
    text: [
      'A template is one scheduled agent run: a schedule, a precheck that skips the run when there is nothing to do, and the prompt. The generic templates come with the app; your own go in automations/ of the config folder.',
      'Install creates the automation on the runner, disabled and report only, in a registered project. Update sets it back to the template, Remove deletes it with its run history. Undo of a removal restores the local record only: the runner keeps no copy, so install it again to create a new automation. Each is a plan with a diff and an undo in History, and the table shows whether the runner\'s copy still matches the template.',
    ],
    cli: [`${V} automations list`, `${V} automations install <id> --project <dir>`, `${V} automations status`],
  },
  {
    id: 'preferences', view: 'settings', title: 'Preferences', shot: 'preferences',
    alt: 'The Preferences view on its Views tab, beside the tabs Sessions history and Advanced: Views and their cost with the terminal tier strip switch and the status line select of the tracked account work, then the keyboard shortcuts.',
    text: [
      'Export profile writes the agents, packs, own packs and registered projects with their answers as one file, without file contents, environment values or tokens; Import profile shows the changes it would make on this machine first.',
      'The Views tab holds the terminal tier strip, the sessions board, Sessions and Runs with what each costs and runs while on, the keyboard shortcuts and the switch for the / key that opens the command palette; Sessions history, how long the sessions cache keeps summaries; Advanced, the profile, the Editors switch (off by default), the files the app keeps in its config folder and, last, Clear the sessions cache.',
      'Each account that accounts track set up has a status line select: usage windows and Ponytail level, one of them, or nothing. It changes that account\'s settings.json as a plan with undo.',
      'Editors adds the Advanced group with Orchestrator policy; while it is off, the view and its route do not exist. Orchestrator policy shows docs/agents/orchestration.json of a registered project as JSON text, checked while you type against orchestration.schema.json in the schemas folder of the plugin, each error with its rule and path. Review shows the plan with its diff, Apply writes through the runner, and History undoes it.',
      'Ctrl+K (macOS: Cmd+K) or / opens the command palette: views, projects, skills, the last 20 runs, plan global setup, run doctor, toggle theme. Ctrl+1 to Ctrl+9 (macOS: Cmd) open the first nine views in sidebar order: Dashboard, History, Projects, Skills, Packs, Sessions, Runs, Insights, Evals. Ctrl+J (macOS: Cmd+J) switches between light and dark theme. Where the browser handles one of these keys itself, the sidebar, the palette and the header buttons do the same.',
    ],
    cli: [`${V} profile export <file>`, `${V} profile import <file>`, `${V} sessions cache show`, `${V} accounts track <name>`],
  },
  {
    id: 'history', view: 'history', title: 'History and undo', shot: 'history',
    alt: 'The History view: a list of runs, and the report of the global setup run with the number of changes done and, per step, the changed file with its line counts, a Show file diff button and an Undo step button.',
    text: [
      'Every apply, update and undo is a run, listed by day. The report counts the changes by status with the changed lines and lists each change with the file it changed, its command and output, or a recorded session\'s files. Show file diff opens the diff with line numbers, unified or split; created and deleted files show unified.',
      'Undo run restores every file of the run; Undo step restores one. Replaced and removed files are kept for it.',
    ],
    cli: [`${V} history`, `${V} undo <run>`],
  },
  {
    id: 'doctor', view: 'dashboard', title: 'Doctor', shot: 'doctor',
    alt: 'The Doctor table: a level (error, warning or info), the problem, and a fix column that holds a Plan fix button or the step to do by hand.',
    text: [
      'The doctor checks the setup against what is installed: rules that differ from the setup, missing plugins and skills, a missing container engine, environment variables that turn features off. On Linux it counts dev containers whose folder was removed, which containers reconcile stops and removes. Each finding has a level: error, warning or info.',
      'The Dashboard shows the three worst findings, errors first, one line each with its action, and a link to all of them in Insights. The full table with every fix is folded below them; the doctor count in the header opens it. Dismiss on a finding that is an opinion hides it; Dismissed (n) lists the dismissed findings and declined changes with Show again.',
      'A finding the setup can fix has a button that opens its plan (Plan fix, Review removal or Plan project), and a settings finding has Open settings, which opens Agent settings with its documentation link. The others carry the step to do by hand, with a link to the source a fix names. Each run id a finding names links to History.',
    ],
    cli: [`${V} doctor`, `${V} containers reconcile --dry-run`, `${V} containers reconcile`],
  },
];

function View({ v, shots }: { v: (typeof VIEWS)[number]; shots: Record<string, Shot> }) {
  const app = useBaseUrl('/app/');
  return (
    <section id={useAnchor(v.id)} data-view={v.view} aria-labelledby={`${v.id}-h`} className="bk-stack">
      <h2 id={`${v.id}-h`} className="bk-h2-sm">{v.title}</h2>
      <div className="bk-stack bk-narrow">
        {v.text.map((t) => <p key={t}>{t}</p>)}
        <pre className="bk-code" tabIndex={0} role="group" aria-label={`${v.title} on the command line`}>{v.cli.join('\n')}</pre>
      </div>
      {(['light', 'dark'] as const).map((scheme) => (
        <img key={scheme} className={`shot shot-${scheme}`} src={`${app}${v.shot}-${scheme}.webp`} alt={v.alt}
          width={shots[`${v.shot}-${scheme}`].width} height={shots[`${v.shot}-${scheme}`].height} loading="lazy" />
      ))}
    </section>
  );
}

export default function AppPage() {
  const shots = data.shots as Record<string, Shot>;
  return (
    <SitePage title="The app, BenchKeeper" description="What the BenchKeeper app shows, view by view, with the matching CLI command and screenshots of example data.">
      <div className="bk-stack bk-gap-56">
        <div className="bk-stack bk-narrow">
          <h1 className="bk-title">The app</h1>
          <p className="bk-lead">
            <code>npx benchkeeper@6.25.0</code> opens the app in your browser: set up the machine and each repository, see what drifted, undo a run.
            The same steps run on the command line, see the CLI tab of the <Link to="/#start">quick start</Link>.
          </p>
          <p className="bk-dimmed">All screenshots show example data: a demo home folder with the projects shop and blog. They come from no real machine.</p>
        </div>
        {VIEWS.map((v) => <View key={v.id} v={v} shots={shots} />)}
      </div>
    </SitePage>
  );
}
