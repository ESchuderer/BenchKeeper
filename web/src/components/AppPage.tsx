import { Anchor, Container, Stack, Text, Title } from '@mantine/core';
import { BenchShell } from './Bench';

export type Shot = { width: number; height: number };

// One section per view of the app. The screenshots are saved by app/scripts/screenshots.mjs.
export const VIEWS: { id: string; title: string; shot: string; alt: string; text: string[] }[] = [
  {
    id: 'dashboard', title: 'Dashboard', shot: 'dashboard',
    alt: 'The Dashboard scrolled to Health: one stacked bar of item states with the numbers as links beneath it, then the pack coverage matrix per agent and the skills per pack as a sorted bar list.',
    text: [
      'The setup flow counts the agents detected, the global items that need attention, the registered projects that are behind and the doctor findings. Each box opens the view that fixes it.',
      'Health counts the items of the global setup and of each registered project as current, modified, outdated, missing, removed, foreign or untracked, as one bar with the numbers as text. Coverage counts the projects that chose each pack, per agent, and marks skills that exist for one agent only. Every figure links to the view it counts.',
    ],
  },
  {
    id: 'fix', title: 'Fix everything', shot: 'fix',
    alt: 'The Fix everything drawer on step 1, Global setup: the rules file marked modified with its diff, then the plugin and marketplace installs as commands, one checkbox each.',
    text: [
      'Four steps: the global setup, the projects that are behind, the doctor findings the setup cannot fix, and a summary of what Apply does. Each change is a checkbox with its diff or command line.',
      'Removals of items you installed yourself stay off until you check them. Skill installs run first in a scratch folder, so the plan lists the files they would write.',
    ],
  },
  {
    id: 'projects', title: 'Projects', shot: 'projects',
    alt: 'The Projects view: a table of two projects with setup version, skills and pending changes, and the detail of the first with its pack and skill switches and the pending changes as commands and diffs.',
    text: [
      'Each registered project shows its setup version, skills, pending changes and Git state. A project is behind when its setup version differs from the one of the app.',
      'The detail lists the project\'s packs and skills, each with a switch, and the changes an update or a switched pack would write.',
    ],
  },
  {
    id: 'setup', title: 'Project setup', shot: 'setup',
    alt: 'The Set up project drawer on its last step: the choice between a setup on this machine and one in the repository as a pull request, then the files it writes, CLAUDE.local.md and .benchkeeper/state.json, as diffs.',
    text: [
      'Five steps: agents, where the agent runs, skills, default tier and a review. The review shows every file as a diff before anything is written.',
      'The setup stays on this machine by default, in files Git ignores. The other choice commits it on a branch and opens a pull request.',
    ],
  },
  {
    id: 'sessions', title: 'Sessions board', shot: 'sessions',
    alt: 'The Sessions view with the board in a frame: filters for project, agent, tier, pattern, setup and period, tiles for sessions, agent time, cost and tokens, and a chart of cost per day by setup.',
    text: [
      'The board reads the Claude Code and Codex transcripts on the machine: per session the tier, the pattern (single, loop, group or Orca worker), the setup installed at the time, skills used, last test run, cost, time and pull request state.',
      'Filters narrow it by project, agent, tier, pattern, setup and period. Each chart has its table beside it.',
    ],
  },
  {
    id: 'history', title: 'History and undo', shot: 'history',
    alt: 'The History view: a list of two runs, and the report of the global setup run with the number of changes done and a diff per changed file, unified or split, each with an Undo step button.',
    text: [
      'Every apply, update and undo is a run. The report lists each change with its diff, shown unified or split.',
      'Undo run restores every file of the run; Undo step restores one. Replaced and removed files are kept for it.',
    ],
  },
  {
    id: 'doctor', title: 'Doctor', shot: 'doctor',
    alt: 'The Doctor table: a level (error or warning), the problem, and a fix column that holds a Plan fix button or the step to do by hand.',
    text: [
      'The doctor checks the setup against what is installed: rules that differ from the setup, missing plugins and skills, a missing container engine, environment variables that turn features off.',
      'A finding the setup can fix has a Plan fix button that opens the plan. The others carry the command to run by hand.',
    ],
  },
];

export default function AppPage({ base, shots }: { base: string; shots: Record<string, Shot> }) {
  return (
    <BenchShell base={base}>
      <Stack gap={56}>
        <Stack gap="xs" maw={720}>
          <Title order={1} fz={{ base: 34, md: 44 }}>The app</Title>
          <Text size="lg">
            <code>npx benchkeeper@6.19.0</code> opens the app in your browser: set up the machine and each repository, see what drifted, undo a run.
            The same steps run on the command line, see the CLI tab of the <Anchor href={`${base}/#start`}>quick start</Anchor>.
          </Text>
          <Text c="dimmed">All screenshots show example data: a demo home folder with the projects shop and blog. They come from no real machine.</Text>
        </Stack>
        {VIEWS.map((v) => (
          <Container key={v.id} component="section" id={v.id} aria-labelledby={`${v.id}-h`} size="xl" p={0} w="100%">
            <Stack gap="md">
              <Title order={2} id={`${v.id}-h`} fz={{ base: 24, md: 30 }}>{v.title}</Title>
              <Stack gap="xs" maw={720}>{v.text.map((t) => <Text key={t}>{t}</Text>)}</Stack>
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
