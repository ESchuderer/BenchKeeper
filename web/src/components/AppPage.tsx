import { Anchor, Code, Container, Stack, Text, Title } from '@mantine/core';
import { BenchShell } from './BenchShell';

export type Shot = { width: number; height: number };

// The CLI prefix of each view's commands; the release rewrites the version.
const V = 'npx benchkeeper@6.25.0';

// One section per view of the app; view is its route in the sidebar of app/ui/App.jsx. The screenshots are saved by app/scripts/screenshots.mjs.
export const VIEWS: { id: string; view: string; title: string; shot: string; alt: string; text: string[]; cli: string[] }[] = [
  {
    id: 'start', view: 'dashboard', title: 'Starting screen', shot: 'start',
    alt: 'The Dashboard as the app opens: the one-run setup buttons, the number of items that need attention with where they are and the Fix everything button, the number of doctor findings, then the ring of item states and the list of scopes.',
    text: [
      'The app opens on the Dashboard. The top row counts the items of the global setup and the projects that need attention, with a link to each place and the Fix everything button, and the doctor findings, which open the doctor table.',
      'The setup flow, install level, BenchKeeper plugin, installed skills, pack coverage, catalog by pack and global setup by part are folded under More about the setup.',
    ],
    cli: [`${V}`, `${V} projects status`],
  },
  {
    id: 'onerun', view: 'dashboard', title: 'One-run setup', shot: 'onerun',
    alt: 'The One-run setup drawer: the Global setup checkbox, the install level, the projects to set up with their state, and the Start button.',
    text: [
      'Set up everything prepares the global setup at the chosen level and each project you pick without questions in between, then shows all changes on one page. Nothing is written until you apply.',
      'A project with a shared setup is left to Update all, which opens its pull request.',
    ],
    cli: [`${V} apply --level full`, `${V} projects apply <dir>`],
  },
  {
    id: 'dashboard', view: 'dashboard', title: 'Dashboard health', shot: 'dashboard',
    alt: 'The Dashboard scrolled to Health: a ring of item states with the total in the centre and the numbers as links beside it, the global setup and each project with its own state bar, then the doctor table and the recent runs.',
    text: [
      'Health counts the items of the global setup and of each registered project as current, modified, outdated, missing, removed, foreign or untracked, as one ring with the numbers as text. Where shows the same states per scope, with the packs of each project. Coverage, folded below, counts the projects that chose each pack, per agent. Every figure links to the view it counts.',
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
    alt: 'The Installs tab of the project shop, outdated with one finding: its packs as switches, the pack in use or suggested first, then the others, each with its scope, its state, what it is for and what turning it on copies.',
    text: [
      'Each registered project is a card with its health, setup, packs and sessions of the last 30 days. A project is behind when its setup version differs from the one of the app.',
      'The Installs tab of a project lists the packs in use or suggested first, then the others, each with a switch and what it is for. A switch is a plan with a diff, and History undoes it.',
    ],
    cli: [`${V} projects list`, `${V} packs enable <id> --project <dir>`],
  },
  {
    id: 'skills', view: 'catalog', title: 'Skill management', shot: 'skills',
    alt: 'The Catalog view scrolled to Skill states: per project and skill its state, installed and current source, an Active switch and the Update, Reset and Remove buttons, then the packs table.',
    text: [
      'Skill states lists each skill of each registered project as current, outdated, modified, removed or disabled, with an Active switch and Update, Reset and Remove. A skill that comes from a pack goes by switching the pack off.',
      'The Catalog above it lists the library skills with the number of projects that use each, and builds own packs from them.',
    ],
    cli: [`${V} skills list --project <dir>`, `${V} skills update <name> --project <dir>`],
  },
  {
    id: 'setup', view: 'projects', title: 'Project setup', shot: 'setup',
    alt: 'The Set up project drawer on its last step: the choice between a setup on this machine and one in the repository as a pull request, then the files it writes, CLAUDE.local.md and .benchkeeper/state.json, as diffs.',
    text: [
      'Five steps: agents, where the agent runs, skills, default tier and a review. The review shows every file as a diff before anything is written.',
      'The setup stays on this machine by default, in files Git ignores. The other choice commits it on a branch and opens a pull request.',
    ],
    cli: [`${V} projects plan <dir>`, `${V} projects apply <dir>`],
  },
  {
    id: 'sessions', view: 'sessions', title: 'Sessions board', shot: 'sessions',
    alt: 'The Sessions view with the board in a frame: filters for agent, tier, pattern, setup and period, the project list open with its search, then tiles for sessions, agent time, cost, tokens, tests passed and merged pull requests.',
    text: [
      'The board reads the Claude Code and Codex transcripts on the machine when it opens and on Rescan: per session the tier, the pattern (single, loop, group or Orca worker), the setup installed at the time, skills used, last test run, cost (Claude Code), time and pull request state.',
      'The project list puts registered repositories first, one entry per repository with its worktrees folded in, and has a search. Comparison charts by tier, pattern and setup show how many sessions each bar rests on and mark the ones under 20. Each chart has its table behind a button.',
    ],
    cli: [`${V} sessions board`],
  },
  {
    id: 'runs', view: 'runs', title: 'Runs', shot: 'runs',
    alt: 'The Runs view: the orchestrated runs table with run, task, worktree, branch, sessions, cost and tokens, the last setup change of each registered project, and the section of the multi-agent IDE, here not installed.',
    text: [
      'Orchestrated runs and their tasks in the registered projects and their worktrees, with sessions, cost (Claude Code) and tokens (Codex), each project\'s last setup change, and the runs of the multi-agent IDE when it is installed.',
      'The view reads when it opens and on Refresh, with no timer. The rows hold ids, states and counts, never a prompt or worker output.',
    ],
    cli: [`${V} sessions list`, `${V} sessions list --run <id>`],
  },
  {
    id: 'insights', view: 'insights', title: 'Insights', shot: 'insights',
    alt: 'The Insights view: the number of findings by level with the one to do first, what was checked, the folded adviser narrative, then the findings grouped by level and area, each with its evidence, its fix and the Dismiss and Snooze 7 days buttons.',
    text: [
      'Findings of the setup and the sessions: doctor findings, agent settings, versions behind, installed skills no session used and friction in one project. They are grouped by level (error, warning, info) and area, most severe first, each with its evidence and a fix or a Plan button.',
      'The session signals need 20 Claude Code sessions of the last 90 days and report nothing below that. Dismiss and Snooze 7 days are kept per finding; a finding whose evidence changed comes back.',
      'The adviser narrative is optional: one agent session on your login summarizes the findings and suggests an order. It runs only on a click, with the exact input shown beside the button. On the command line, --yes starts it; without --yes the command shows a cached narrative, or the input it would send, and starts nothing.',
    ],
    cli: [`${V} insights --json`, `${V} insights --json --narrative --agent claude --yes`],
  },
  {
    id: 'evals', view: 'evals', title: 'Evals', shot: 'evals',
    alt: 'The Evals view: what miss and false trigger mean, the agent and model picker, the table of eval targets with cases, miss and false trigger rates, and the Run evals form with the agents to use and the Plan evals button.',
    text: [
      'An eval case is a short task that a real agent session gets in a throwaway folder; the result records whether the skill loaded. Miss counts the tasks that needed the skill when it did not load, false trigger the tasks that did not need it when it loaded. Lower is better for both.',
      'Each target shows its latest rates and, when you pick it, its rates over time. Plan lists the targets changed since their last result and the sessions they start; nothing runs before Start. Evals use your agent subscription and never run in CI.',
    ],
    cli: [`${V} evals plan`, `${V} evals run`, `${V} evals results`],
  },
  {
    id: 'global', view: 'agents', title: 'Global setup', shot: 'global',
    alt: 'The Global setup view: the agents table with version, rules file, skills folder, tested and what is not available, then the items installed globally, one group each with its count and how many need attention.',
    text: [
      'The machine-wide setup per agent: each agent with its version, rules file and skills folder, whether BenchKeeper is tested with it and what it does not support, then the items installed globally with their state.',
      'Plan setup shows the changes for the agents you check, each with a diff, before anything is written. Removing the setup is an undo of its runs in History; the app does not install or remove agents.',
    ],
    cli: [`${V} plan --agents claude,codex`, `${V} apply --agents claude,codex`],
  },
  {
    id: 'rules', view: 'rules', title: 'Rules', shot: 'rules',
    alt: 'The Rules view: the Claude Code context budget in tokens per source, then the instruction files in load order with owner, size, state and a switch for a file that is not BenchKeeper\'s.',
    text: [
      'The instruction files Claude Code and Codex load, in load order, with owner (BenchKeeper, project or yours), size and whether each loads. The context budget sums the tokens that load at the start of every session, counted as four bytes per token.',
      'A file that is not BenchKeeper\'s has a switch; nothing here deletes it. A switch is a plan with a diff, and History undoes it.',
    ],
    cli: [`${V} rules list`, `${V} rules disable <file>`],
  },
  {
    id: 'extensions', view: 'extensions', title: 'Extensions', shot: 'extensions',
    alt: 'The Extensions view for the global files: per agent a table of MCP servers, hooks, subagents, commands and output styles with name, scope, owner, what each is with a runs code mark, and the file it comes from.',
    text: [
      'What each agent loads or runs besides rules and skills, globally or for a registered project: MCP servers, hooks, subagents, commands and output styles, with scope, owner and the file each comes from. Runs code marks what executes a command on this machine.',
      'The view reads the agents\' files only: no agent starts and nothing is written. Environment values and headers never appear; secrets in command lines are masked when their name or shape is a known one, so a secret in another form can still show.',
    ],
    cli: [`${V} extensions list --agent claude`, `${V} extensions list --project <dir>`],
  },
  {
    id: 'settings', view: 'agent-settings', title: 'Agent settings', shot: 'settings',
    alt: 'The Agent settings view for Claude Code: hardening advice folded into one line, the count of settings that differ from the suggestion, the settings search and filters, and the first settings with a Differs from suggested marker and a Use suggested button.',
    text: [
      'The agents\' own settings, per agent and layer. Each setting shows the value in your file, the value in effect when another source wins, and BenchKeeper\'s suggestion with its reason; Use suggested opens the change plan.',
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
    alt: 'The Automations view: what a template is, a note that the runner is not installed, then the templates table with each automation\'s name, id and tier, its schedule, whether it is installed, its last run and an Install button.',
    text: [
      'A template is one scheduled agent run: a schedule, a precheck that skips the run when there is nothing to do, and the prompt. The generic templates come with the app; your own go in automations/ of the config folder.',
      'Install creates the automation on the runner, disabled and report only, in a registered project. Update sets it back to the template, Remove deletes it with its run history. Undo of a removal restores the local record only: the runner keeps no copy, so install it again to create a new automation. Each is a plan with a diff and an undo in History, and the table shows whether the runner\'s copy still matches the template.',
    ],
    cli: [`${V} automations list`, `${V} automations install <id> --project <dir>`, `${V} automations status`],
  },
  {
    id: 'preferences', view: 'settings', title: 'Preferences', shot: 'preferences',
    alt: 'The Preferences view: the Profile section with the Export profile and Import profile buttons and their commands, then the keyboard shortcuts table and the switch for the / key.',
    text: [
      'Export profile writes the agents, packs, own packs and registered projects with their answers as one file, without file contents, environment values or tokens; Import profile shows the changes it would make on this machine first.',
      'The keyboard shortcuts, the switch for the / key that opens the command palette, the terminal tier strip, how long the sessions cache keeps summaries, the Advanced editors and the files the app keeps in its config folder.',
    ],
    cli: [`${V} profile export <file>`, `${V} profile import <file>`, `${V} sessions cache show`],
  },
  {
    id: 'history', view: 'history', title: 'History and undo', shot: 'history',
    alt: 'The History view: a list of runs, and the report of the global setup run with the number of changes done and a diff per changed file, unified or split, each with an Undo step button.',
    text: [
      'Every apply, update and undo is a run. The report lists each change with its diff, shown unified or split.',
      'Undo run restores every file of the run; Undo step restores one. Replaced and removed files are kept for it.',
    ],
    cli: [`${V} history`, `${V} undo <run>`],
  },
  {
    id: 'doctor', view: 'dashboard', title: 'Doctor', shot: 'doctor',
    alt: 'The Doctor table: a level (error, warning or info), the problem, and a fix column that holds a Plan fix button or the step to do by hand.',
    text: [
      'The doctor checks the setup against what is installed: rules that differ from the setup, missing plugins and skills, a missing container engine, environment variables that turn features off. Each finding has a level: error, warning or info.',
      'A finding the setup can fix has a Plan fix button that opens the plan, a settings finding opens Agent settings with its documentation link. The others carry the step to do by hand.',
    ],
    cli: [`${V} doctor`],
  },
];

export default function AppPage({ base, shots }: { base: string; shots: Record<string, Shot> }) {
  return (
    <BenchShell base={base}>
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
                <Code block role="group" aria-label={`${v.title} on the command line`}>{v.cli.join('\n')}</Code>
              </Stack>
              {(['light', 'dark'] as const).map((scheme) => (
                <img key={scheme} className={`shot shot-${scheme}`} src={`${base}/app/${v.shot}-${scheme}.png`} alt={v.alt}
                  width={shots[`${v.shot}-${scheme}`].width} height={shots[`${v.shot}-${scheme}`].height} loading="lazy" />
              ))}
            </Stack>
          </Container>
        ))}
      </Stack>
    </BenchShell>
  );
}
