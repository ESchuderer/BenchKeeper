import { Anchor, Code, Container, Stack, Text, Title } from '@mantine/core';
import { SiteShell } from './SiteShell';

export type Shot = { width: number; height: number };

// The CLI prefix of each view's commands; the release rewrites the version.
const V = 'npx benchkeeper@6.25.0';

// One section per view of the app; view is its route in the sidebar of app/ui/App.jsx. The screenshots are saved by app/scripts/screenshots.mjs.
export const VIEWS: { id: string; view: string; title: string; shot: string; alt: string; text: string[]; cli: string[] }[] = [
  {
    id: 'start', view: 'dashboard', title: 'Starting screen', shot: 'start',
    alt: 'The Dashboard as the app opens: the number of items that need attention with where they are, the Fix everything button and the Set up menu, the number of doctor findings by level, then the bar of item states and the list of scopes.',
    text: [
      'The app opens on the Dashboard. The first panel counts the items of the global setup and the projects that need attention, with a link to each place, the Fix everything button and the Set up menu for the one-run setup. The doctor findings follow with their count by level; the count opens the Doctor section.',
      'The setup flow, install level, BenchKeeper plugin, installed skills, pack coverage, catalog by pack and global setup by part are folded under More about the setup.',
    ],
    cli: [`${V}`, `${V} projects status`],
  },
  {
    id: 'onerun', view: 'dashboard', title: 'One-run setup', shot: 'onerun',
    alt: 'The One-run setup drawer: the Global setup checkbox, the install level, the projects to set up with their state, and the Start button.',
    text: [
      'Set up everything prepares the global setup at the chosen level and each project you pick without questions in between, then shows all changes on one page. Nothing is written until you apply.',
      'A project with a shared setup is left to Update all, which commits it on a local branch for you to push.',
    ],
    cli: [`${V} apply --level full`, `${V} projects apply <dir>`],
  },
  {
    id: 'dashboard', view: 'dashboard', title: 'Dashboard health', shot: 'dashboard',
    alt: 'The Dashboard scrolled to Health: one bar of item states with the total above it and the numbers as links below it, the global setup and each project with its own state bar, then the three worst doctor findings, one line each, and the recent runs.',
    text: [
      'Health counts the items of the global setup and of each registered project as current, modified, outdated, missing, removed, foreign or untracked, as one bar with the numbers as text. Where shows the same states per scope, with the packs of each project. Coverage, folded below, counts the projects that chose each pack, per agent. Every figure links to the view it counts.',
    ],
    cli: [`${V} dashboard`],
  },
  {
    id: 'fix', view: 'dashboard', title: 'Fix everything', shot: 'fix',
    alt: 'The Fix everything drawer on step 1, Global setup: the rules file marked modified with its diff, then the plugin and marketplace installs as commands, one checkbox each.',
    text: [
      'Four steps: the global setup, the projects that are behind, the doctor findings the setup cannot fix, and a summary of what Apply does. Each change is a checkbox with its diff or command line.',
      'Removals of items you installed yourself stay off until you check them. Skill installs run first in a scratch folder, so the plan lists the files they would write.',
    ],
    cli: [`${V} plan`, `${V} apply`],
  },
  {
    id: 'projects', view: 'projects', title: 'Projects and pack switching', shot: 'projects',
    alt: 'The Installs tab of the project shop, outdated with one finding: its packs as switches, the pack in use or suggested first, then the others, one row each with its scope, its state, what it is for and a Details button for what turning it on copies.',
    text: [
      'Each registered project is a card with its health, setup, packs and sessions of the last 30 days. A project is behind when its setup version differs from the one of the app.',
      'The Installs tab of a project lists the packs in use or suggested first, then the others, each with a switch and what it is for. A switch is a plan with a diff, and History undoes it.',
      'New from preset starts a new folder from a saved preset, shows the plan, registers the folder and then recommends skills to turn off and packs to add.',
    ],
    cli: [`${V} projects list`, `${V} packs enable <id> --project <dir>`, `${V} projects create <dir> --preset <id>`],
  },
  {
    id: 'skills', view: 'skills', title: 'Skills', shot: 'skills',
    alt: 'The Skills page of the Catalog: search, the filters for pack, agent and install state, New skill, then the library skills, each with a checkbox for the pack, badges for the library packs that name it and the number of projects that have it.',
    text: [
      'The Catalog has two pages. Skills lists the library skills with the number of projects that have each and the source, pin and eval results of the one you open, and builds own packs from them.',
      'New skill adds a skill of your own, marked "yours" in the list, with Edit and Remove on its row and its detail. Each opens a dialog and ends in a plan with a diff. A project or own pack picks it like a library skill and gets a copy.',
      'The state of each skill in a project (current, outdated, modified, removed or disabled), with an Active switch and Update, Reset and Remove, is on the project\'s Installs tab.',
    ],
    cli: [`${V} skills list --library`, `${V} skills new <name>`, `${V} skills update <name> --project <dir>`],
  },
  {
    id: 'packs', view: 'packs', title: 'Packs', shot: 'packs',
    alt: 'The Packs page of the Catalog: the plugin packs on top, then the library and own packs as cards, each with its skills, whether it is an own pack, the projects that use it, Export, and Remove for an own pack.',
    text: [
      'Packs lists the library packs and your own with the projects that use them, and exports, imports and removes own packs. A pack is defined once and switched on per project, on the project\'s Installs tab.',
    ],
    cli: [`${V} packs list`, `${V} packs enable <id> --project <dir>`],
  },
  {
    id: 'setup', view: 'projects', title: 'Project setup', shot: 'setup',
    alt: 'The Set up project drawer on its last step: the choice between a setup on this machine and one in the repository on a branch, then the files it writes, CLAUDE.local.md and .benchkeeper/state.json, as diffs.',
    text: [
      'Five steps: agents, where the agent runs, skills, default tier and a review. The review shows every file as a diff before anything is written.',
      'The setup stays on this machine by default, in files Git ignores. The other choice commits it on a local branch, which you push.',
    ],
    cli: [`${V} projects plan <dir>`, `${V} projects apply <dir>`],
  },
  {
    id: 'sessions', view: 'sessions', title: 'Sessions board', shot: 'sessions',
    alt: 'The Sessions view with the board in a frame: the project choice closed as a chip in one line with the filters for agent, tier, pattern, setup and period, then tiles for sessions, agent time, cost, tokens and tests passed.',
    text: [
      'The board reads the Claude Code and Codex transcripts on the machine when it opens and on Rescan: per session the tier, the pattern (single, loop, group or Orca worker), the setup installed at the time, skills used, last test run, cost (Claude Code as recorded, Codex estimated from tokens and OpenAI API prices, unpriced models left out), time and pull request links.',
      'The project list puts registered repositories first, one entry per repository with its worktrees folded in, and has a search. Comparison charts by tier, pattern and setup show how many sessions each bar rests on and mark the ones under 20. Each chart has its table behind a button.',
    ],
    cli: [`${V} sessions board`],
  },
  {
    id: 'runs', view: 'runs', title: 'Runs', shot: 'runs',
    alt: 'The Runs view: the orchestrated runs table with run, task, worktree, branch, sessions, cost and tokens, the last setup change of each registered project, one line saying the multi-agent IDE is not installed, and the folded command.',
    text: [
      'Orchestrated runs and their tasks in the registered projects and their worktrees, with sessions, tokens and cost (Claude Code as recorded, Codex estimated from tokens and OpenAI API prices, unpriced models left out), each project\'s last setup change, and the runs of the multi-agent IDE when it is installed.',
      'The view reads when it opens and on Refresh, with no timer. The rows hold ids, states and counts, never a prompt or worker output.',
    ],
    cli: [`${V} sessions list`, `${V} sessions list --run <id>`],
  },
  {
    id: 'insights', view: 'insights', title: 'Insights', shot: 'insights',
    alt: 'The Insights view: the number of findings by level with the one to do first, what was checked, the folded adviser narrative, then the findings grouped by level and area: errors as cards with their evidence, fix and the Dismiss and Snooze 7 days buttons, warnings and info as one-line rows with their fix button and a More menu that holds Dismiss and Snooze 7 days.',
    text: [
      'Findings of the setup and the sessions: doctor findings, agent settings, versions behind, installed skills no session used and friction in one project. They are grouped by level (error, warning, info) and area, most severe first, each with its evidence and a fix or a Plan button.',
      'The session signals need 20 Claude Code sessions of the last 90 days and report nothing below that. Dismiss and Snooze 7 days are kept per finding; a finding whose evidence changed comes back.',
      'The adviser narrative is optional: one agent session on your login summarizes the findings and suggests an order. It runs only on a click, with the exact input shown beside the button. On the command line, --yes starts it; without --yes the command shows a cached narrative, or the input it would send, and starts nothing.',
    ],
    cli: [`${V} insights --json`, `${V} insights --json --narrative --agent claude --yes`],
  },
  {
    id: 'evals', view: 'evals', title: 'Evals', shot: 'evals',
    alt: 'The Evals view: the agent and model picker, the table of eval targets with cases, miss and false trigger rates, the Run evals form with the agents to use and the Plan evals button, and the folded How evals work section.',
    text: [
      'An eval case is a short task that a real agent session gets in a throwaway folder; the result records whether the skill loaded. Miss counts the tasks that needed the skill when it did not load, false trigger the tasks that did not need it when it loaded. Lower is better for both.',
      'Each target shows its latest rates and, when you pick it, its rates over time. Plan lists the targets changed since their last result and the sessions they start; nothing runs before Start. Evals use your agent subscription and never run in CI.',
    ],
    cli: [`${V} evals plan`, `${V} evals run`, `${V} evals results`],
  },
  {
    id: 'global', view: 'agents', title: 'Global setup', shot: 'global',
    alt: 'The Global setup view: the installed agents with version, rules file, skills folder, tested and a chip for each feature that is not available, the agents that are not installed folded into one line, then the items installed globally, one group each with its count and how many need attention.',
    text: [
      'The machine-wide setup per agent: each installed agent with its version, rules file and skills folder, whether BenchKeeper is tested with it and what it does not support, the agents that are not installed folded below, then the items installed globally with their state; a group with items that need attention starts open.',
      'Plan setup shows the changes for the agents you check, each with a diff, before anything is written. Removing the setup is an undo of its runs in History; the app does not install or remove agents.',
    ],
    cli: [`${V} plan --agents claude,codex`, `${V} apply --agents claude,codex`],
  },
  {
    id: 'rules', view: 'rules', title: 'Rules', shot: 'rules',
    alt: 'The Rules view: a summary strip with the tokens Claude Code loads at the start of a session against the limit, its largest source and the checks, then the Claude Code tab with the context budget per source and the auto memory per project with its number of notes, size, last change and whether MEMORY.md is within the load limit.',
    text: [
      'A strip at the top shows, per agent, the tokens that load at the start of every session against the limit, counted as four bytes per token, the largest source and the checks. Below it, Claude Code and Codex each have a tab with the instruction files they load, in load order, with owner (BenchKeeper, project or yours), size and whether each loads, and the context budget per source.',
      'Claude Code\'s auto memory shows per project in numbers only: topic notes, total size, last change and whether MEMORY.md is over what loads. The notes stay unread, and where auto memory is off the row says so.',
      'A file that is not BenchKeeper\'s has a switch; nothing here deletes it. A switch is a plan with a diff, and History undoes it.',
    ],
    cli: [`${V} rules list`, `${V} rules check`, `${V} rules disable <file>`],
  },
  {
    id: 'extensions', view: 'extensions', title: 'Extensions', shot: 'extensions',
    alt: 'The Extensions view for the global files: per agent one row per MCP server, hook, subagent, command or output style with its name, chips for kind, runs code, scope, owner and transport, what it runs, the file it comes from and a Remove link to the Doctor, and an empty state for an agent without extensions.',
    text: [
      'What each agent loads or runs besides rules and skills, globally or for a registered project: MCP servers, hooks, subagents, commands and output styles, with scope, owner and the file each comes from. Runs code marks what executes a command on this machine.',
      'The view reads the agents\' files only: no agent starts and nothing is written. Environment values and headers never appear; secrets in command lines are masked when their name or shape is a known one, so a secret in another form can still show.',
    ],
    cli: [`${V} extensions list --agent claude`, `${V} extensions list --project <dir>`],
  },
  {
    id: 'settings', view: 'agent-settings', title: 'Agent settings', shot: 'settings',
    alt: 'The Agent settings view for Claude Code: hardening advice folded into one line, the count of settings that differ from the suggestion, the settings search and filters, and a table of the differing settings with their current, default and suggested values, a Differs from suggested marker and the Use suggested and Keep mine buttons.',
    text: [
      'The agents\' own settings, per agent and layer, one row each: the value in your file, the default and BenchKeeper\'s suggestion. Settings that differ from the suggestion come first, matching ones are folded, and Details opens what a setting does and why it is suggested. Use suggested opens the change plan; Keep mine lists the setting under Decided and silences it here and in Doctor until Show again.',
      'Conflicting settings are shown in full with the default, the risk and what the fix changes; hardening advice folds into one line.',
      'Every change is a plan with a diff, and History undoes it.',
    ],
    cli: [`${V} settings list --agent claude`, `${V} settings set <key> <value>`],
  },
  {
    id: 'accounts', view: 'accounts', title: 'Accounts', shot: 'accounts',
    alt: 'The Accounts view: one card per account with its agent, address and plan, whether it is signed in and which one new sessions use, the 5-hour and 7-day usage windows as bars with the percent left and the reset time, and the buttons to add a Claude Code or Codex account.',
    text: [
      'Add Claude Code account and Add Codex account open a private browser window to sign in; the account is named after the signed-in address. Each card shows whether the account is signed in and what is left of its usage windows.',
      'Use for new sessions makes an account the default in one click. The list keeps names and folders, never a credential.',
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
      'The Views tab holds the terminal tier strip with what each view costs, the keyboard shortcuts and the switch for the / key that opens the command palette; Sessions history, how long the sessions cache keeps summaries; Advanced, the profile, the editors, the files the app keeps in its config folder and, last, Clear the sessions cache.',
      'Each account that accounts track set up has a status line select: usage windows and Ponytail level, one of them, or nothing. It changes that account\'s settings.json as a plan with undo.',
    ],
    cli: [`${V} profile export <file>`, `${V} profile import <file>`, `${V} sessions cache show`, `${V} accounts track <name>`],
  },
  {
    id: 'history', view: 'history', title: 'History and undo', shot: 'history',
    alt: 'The History view: a list of runs, and the report of the global setup run with the number of changes done and, per step, the changed file with its line counts, a Show file diff button and an Undo step button.',
    text: [
      'Every apply, update and undo is a run. The report lists each change with the file it changed; Show file diff opens the diff, unified or split.',
      'Undo run restores every file of the run; Undo step restores one. Replaced and removed files are kept for it.',
    ],
    cli: [`${V} history`, `${V} undo <run>`],
  },
  {
    id: 'doctor', view: 'dashboard', title: 'Doctor', shot: 'doctor',
    alt: 'The Doctor table: a level (error, warning or info), the problem, and a fix column that holds a Plan fix button or the step to do by hand.',
    text: [
      'The doctor checks the setup against what is installed: rules that differ from the setup, missing plugins and skills, a missing container engine, environment variables that turn features off. On Linux it counts dev containers whose folder was removed, which containers reconcile stops and removes. Each finding has a level: error, warning or info.',
      'The Dashboard shows the three worst findings, errors first, one line each with its action, and a link to all of them in Insights. The full table with every fix is folded below them; the doctor count in the header opens it.',
      'A finding the setup can fix has a Plan fix button that opens the plan, a settings finding opens Agent settings with its documentation link. The others carry the step to do by hand.',
    ],
    cli: [`${V} doctor`, `${V} containers reconcile --dry-run`, `${V} containers reconcile`],
  },
];

export default function AppPage({ base, shots }: { base: string; shots: Record<string, Shot> }) {
  return (
    <SiteShell base={base}>
      <Stack gap={56}>
        <Stack gap="xs" maw={720}>
          <Title order={1} fz={{ base: 34, md: 44 }}>The app</Title>
          <Text size="lg">
            <code>npx benchkeeper@6.25.0</code> opens the app in your browser: set up the machine and each repository, see what drifted, undo a run.
            The same steps run on the command line, see the CLI tab of the <Anchor href={`${base}/#start`}>quick start</Anchor>.
          </Text>
          <Text c="dimmed">All screenshots show example data: a demo home folder with the projects shop and blog. They come from no real machine.</Text>
        </Stack>
        {VIEWS.map((v) => (
          <Container key={v.id} component="section" id={v.id} data-view={v.view} aria-labelledby={`${v.id}-h`} size="xl" p={0} w="100%">
            <Stack gap="md">
              <Title order={2} id={`${v.id}-h`} fz={{ base: 24, md: 30 }}>{v.title}</Title>
              <Stack gap="xs" maw={720}>
                {v.text.map((t) => <Text key={t}>{t}</Text>)}
                <Code block tabIndex={0} role="group" aria-label={`${v.title} on the command line`}>{v.cli.join('\n')}</Code>
              </Stack>
              {(['light', 'dark'] as const).map((scheme) => (
                <img key={scheme} className={`shot shot-${scheme}`} src={`${base}/app/${v.shot}-${scheme}.webp`} alt={v.alt}
                  width={shots[`${v.shot}-${scheme}`].width} height={shots[`${v.shot}-${scheme}`].height} loading="lazy" />
              ))}
            </Stack>
          </Container>
        ))}
      </Stack>
    </SiteShell>
  );
}
