import { Anchor, Code, Container, Stack, Text, Title } from '@mantine/core';
import { BenchShell } from './BenchShell';

export type Shot = { width: number; height: number };

// The CLI prefix of each view's commands; the release rewrites the version.
const V = 'npx benchkeeper@6.25.0';

// One section per view of the app. The screenshots are saved by app/scripts/screenshots.mjs.
export const VIEWS: { id: string; title: string; shot: string; alt: string; text: string[]; cli: string[] }[] = [
  {
    id: 'start', title: 'Starting screen', shot: 'start',
    alt: 'The Dashboard as the app opens: the one-run setup buttons, the Fix everything button, the setup flow of four boxes with their states, the install level, the BenchKeeper plugin and the installed skills and packs per scope.',
    text: [
      'The app opens on the Dashboard. The setup flow counts the agents detected, the global items that need attention, the registered projects that are behind and the doctor findings. Each box opens the view that fixes it.',
      'Below it: the install level, the BenchKeeper plugin version per agent and the skills and packs per scope.',
    ],
    cli: [`${V}`, `${V} projects status`],
  },
  {
    id: 'onerun', title: 'One-run setup', shot: 'onerun',
    alt: 'The One-run setup drawer: the Global setup checkbox, the install level, the projects to set up with their state, and the Start button.',
    text: [
      'Set up everything prepares the global setup at the chosen level and each project you pick without questions in between, then shows all changes on one page. Nothing is written until you apply.',
      'A project with a shared setup is left to Update all, which opens its pull request.',
    ],
    cli: [`${V} apply --level full`, `${V} projects apply <dir>`],
  },
  {
    id: 'dashboard', title: 'Dashboard health', shot: 'dashboard',
    alt: 'The Dashboard scrolled to Health: one stacked bar of item states with the numbers as links beneath it, then the pack coverage matrix per agent and the skills per pack as a sorted bar list.',
    text: [
      'Health counts the items of the global setup and of each registered project as current, modified, outdated, missing, removed, foreign or untracked, as one bar with the numbers as text. Coverage counts the projects that chose each pack, per agent, and marks skills that exist for one agent only. Every figure links to the view it counts.',
    ],
    cli: [`${V} dashboard`],
  },
  {
    id: 'fix', title: 'Fix everything', shot: 'fix',
    alt: 'The Fix everything drawer on step 1, Global setup: the rules file marked modified with its diff, then the plugin and marketplace installs as commands, one checkbox each.',
    text: [
      'Four steps: the global setup, the projects that are behind, the doctor findings the setup cannot fix, and a summary of what Apply does. Each change is a checkbox with its diff or command line.',
      'Removals of items you installed yourself stay off until you check them. Skill installs run first in a scratch folder, so the plan lists the files they would write.',
    ],
    cli: [`${V} plan`, `${V} apply`],
  },
  {
    id: 'projects', title: 'Projects and pack switching', shot: 'projects',
    alt: 'The Installs tab of the project shop, outdated with one finding: its packs as switches, the pack in use or suggested first, then the others, each with its scope, its state, what it is for and what turning it on copies.',
    text: [
      'Each registered project is a card with its health, setup, packs and sessions of the last 30 days. A project is behind when its setup version differs from the one of the app.',
      'The Installs tab of a project lists the packs in use or suggested first, then the others, each with a switch and what it is for. A switch is a plan with a diff, and History undoes it.',
    ],
    cli: [`${V} projects list`, `${V} packs enable <id> --project <dir>`],
  },
  {
    id: 'skills', title: 'Skill management', shot: 'skills',
    alt: 'The Catalog view scrolled to Skill states: per project and skill its state, installed and current source, an Active switch and the Update, Reset and Remove buttons, then the packs table.',
    text: [
      'Skill states lists each skill of each registered project as current, outdated, modified, removed or disabled, with an Active switch and Update, Reset and Remove. A skill that comes from a pack goes by switching the pack off.',
      'The Catalog above it lists the library skills with the number of projects that use each, and builds own packs from them.',
    ],
    cli: [`${V} skills list --project <dir>`, `${V} skills update <name> --project <dir>`],
  },
  {
    id: 'setup', title: 'Project setup', shot: 'setup',
    alt: 'The Set up project drawer on its last step: the choice between a setup on this machine and one in the repository as a pull request, then the files it writes, CLAUDE.local.md and .benchkeeper/state.json, as diffs.',
    text: [
      'Five steps: agents, where the agent runs, skills, default tier and a review. The review shows every file as a diff before anything is written.',
      'The setup stays on this machine by default, in files Git ignores. The other choice commits it on a branch and opens a pull request.',
    ],
    cli: [`${V} projects plan <dir>`, `${V} projects apply <dir>`],
  },
  {
    id: 'sessions', title: 'Sessions board', shot: 'sessions',
    alt: 'The Sessions view with the board in a frame: filters for agent, tier, pattern, setup and period, the project list open with its search, then tiles for sessions, agent time, cost, tokens, tests passed and merged pull requests.',
    text: [
      'The board reads the Claude Code and Codex transcripts on the machine when it opens and on Rescan: per session the tier, the pattern (single, loop, group or Orca worker), the setup installed at the time, skills used, last test run, cost, time and pull request state.',
      'The project list puts registered repositories first, one entry per repository with its worktrees folded in, and has a search. Comparison charts by tier, pattern and setup show how many sessions each bar rests on and mark the ones under 20. Each chart has its table behind a button.',
    ],
    cli: [`${V} sessions board`],
  },
  {
    id: 'rules', title: 'Rules', shot: 'rules',
    alt: 'The Rules view: the Claude Code context budget in tokens per source, then the instruction files in load order with owner, size, state and a switch for a file that is not BenchKeeper\'s.',
    text: [
      'The instruction files Claude Code and Codex load, in load order, with owner (BenchKeeper, project or yours), size and whether each loads. The context budget sums the tokens that load at the start of every session, counted as four bytes per token.',
      'A file that is not BenchKeeper\'s has a switch; nothing here deletes it. A switch is a plan with a diff, and History undoes it.',
    ],
    cli: [`${V} rules list`, `${V} rules disable <file>`],
  },
  {
    id: 'settings', title: 'Agent settings', shot: 'settings',
    alt: 'The Agent settings view for Claude Code: the settings file of each layer and whether it exists, warnings for settings that weaken the setup with their sources, and the settings search.',
    text: [
      'The agents\' own settings, per agent and layer, with the file of each layer and whether it exists. Warnings name settings that conflict with the setup, each with its source.',
      'Every change is a plan with a diff, and History undoes it.',
    ],
    cli: [`${V} settings list --agent claude`, `${V} settings set <key> <value>`],
  },
  {
    id: 'accounts', title: 'Accounts', shot: 'accounts',
    alt: 'The Accounts view: one card per account with its agent, address and plan, whether it is signed in and which one new sessions use, the 5-hour and 7-day usage windows as bars with the percent left and the reset time, and the buttons to add a Claude Code or Codex account.',
    text: [
      'Add Claude Code account and Add Codex account open a private browser window to sign in; the account is named after the signed-in address. Each card shows whether the account is signed in and what is left of its usage windows.',
      'Use for new sessions makes an account the default in one click. The list keeps names and folders, never a credential.',
    ],
    cli: [`${V} accounts list`, `${V} accounts login <name>`],
  },
  {
    id: 'history', title: 'History and undo', shot: 'history',
    alt: 'The History view: a list of runs, and the report of the global setup run with the number of changes done and a diff per changed file, unified or split, each with an Undo step button.',
    text: [
      'Every apply, update and undo is a run. The report lists each change with its diff, shown unified or split.',
      'Undo run restores every file of the run; Undo step restores one. Replaced and removed files are kept for it.',
    ],
    cli: [`${V} history`, `${V} undo <run>`],
  },
  {
    id: 'doctor', title: 'Doctor', shot: 'doctor',
    alt: 'The Doctor table: a level (error or warning), the problem, and a fix column that holds a Plan fix button or the step to do by hand.',
    text: [
      'The doctor checks the setup against what is installed: rules that differ from the setup, missing plugins and skills, a missing container engine, environment variables that turn features off.',
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
          <Container key={v.id} component="section" id={v.id} aria-labelledby={`${v.id}-h`} size="xl" p={0} w="100%">
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
