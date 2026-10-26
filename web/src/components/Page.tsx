import {
  ActionIcon, Alert, Anchor, Badge, Box, Button, Card, Code, Container, Group, List, MantineProvider,
  Paper, SimpleGrid, Stack, Text, ThemeIcon, Timeline, Title, VisuallyHidden, createTheme,
} from '@mantine/core';
import {
  IconAlertTriangle, IconArrowDown, IconArrowRight, IconCheck, IconContainer, IconCopy, IconFeather, IconFileText,
  IconListCheck, IconRoute, IconSchool,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { sdlcSvg } from '../lib/sdlc';
import facts from '../data/facts.json';
import SiteHeader from './SiteHeader';

const theme = createTheme({
  primaryColor: 'teal',
  primaryShade: { light: 9, dark: 9 },
  components: { Anchor: { defaultProps: { underline: 'always' } } },
  fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
  headings: { fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif', fontWeight: '800' },
  defaultRadius: 'md',
});

const REPO = 'https://github.com/ESchuderer/BenchKeeper';
const SETUP = `${REPO}/blob/main/docs/setup.md`;
// Backticks in facts.json become inline code, the same text the README renders.
const md = (t: string) => t.split('`').map((part, i) => (i % 2 ? <Code key={i}>{part}</Code> : part));

function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <Box component="section" id={id} className="band" py={{ base: 56, md: 80 }}>
      <Container size="lg">
        <Stack gap="xs" maw={720} mb={40}>
          <Title order={2} fz={{ base: 28, md: 36 }}>{title}</Title>
          {intro && <Text c="dimmed" size="lg">{intro}</Text>}
        </Stack>
        {children}
      </Container>
    </Box>
  );
}

function Part({ icon, title, href, scope, children }: { icon: ReactNode; title: ReactNode; href?: string; scope: string; children: ReactNode }) {
  return (
    <Card withBorder padding="lg">
      <Group gap="sm" wrap="nowrap">
        <ThemeIcon variant="light" size={38}>{icon}</ThemeIcon>
        {href ? <Anchor href={href} fw={700} underline="hover">{title}</Anchor> : <Text fw={700}>{title}</Text>}
      </Group>
      <Text size="xs" fw={700} tt="uppercase" c="dimmed" mt="md">{scope}</Text>
      <Text size="sm" mt={6}>{children}</Text>
    </Card>
  );
}

const phaseColor = Object.fromEntries(facts.sdlc.phases.map((p) => [p.key, p.color]));
const half = Math.ceil(facts.sdlc.steps.length / 2);

function StepList({ from, className }: { from: number; className?: string }) {
  return (
    <Timeline active={facts.sdlc.steps.length} bulletSize={30} lineWidth={2} className={className}>
      {facts.sdlc.steps.slice(from, from + half).map((st, i) => (
        <Timeline.Item key={st.name} id={`step-${from + i + 1}`} color={phaseColor[st.phase]} bullet={<Text size="xs" fw={700}>{from + i + 1}</Text>}
          title={<Group gap="xs"><Text fw={700}>{st.name}</Text>{st.human && <Badge size="xs" variant="outline" className="decide">human in the loop</Badge>}</Group>}>
          <Text size="sm" c="dimmed">{md(from + i === 0 ? `${st.text} ${facts.sdlc.requirements}` : st.text)}</Text>
        </Timeline.Item>
      ))}
    </Timeline>
  );
}

const repoSteps: [string, string, string][] = [
  ['Project setup, in each repository root', 'npx benchkeeper@6.21.0 project apply --agents claude,codex', '--agents names the agents the repository uses. Where commands run and the default tier, library packs with --pack, and .benchkeeper/state.json. It stays on this machine: CLAUDE.local.md, AGENTS.override.md and the skills, all in .git/info/exclude. --share commits it to the repository instead. project plan shows the changes first.'],
  ['Stack skills and the dev container, as a recorded session', "npx benchkeeper@6.21.0 record -- claude '/benchkeeper:setting-up-projects'", "Codex: the same with codex '$benchkeeper:setting-up-projects'. With the matt-pocock pack, also /mattpocock-skills:setup-matt-pocock-skills. Commit the result."],
  ['Update later', 'npx benchkeeper@6.21.0 apply', 'With the version of the newest release. The plan lists what changed, including the plugin. Projects: npx benchkeeper@6.21.0 update-all, or Fix everything in the browser, updates each local setup in place; a shared one, or a setup still committed from before, gets a pull request.'],
  ['Track sessions', 'npx benchkeeper@6.21.0 board', 'Writes a static page, board.html in the BenchKeeper config folder, from the Claude Code and Codex transcripts on this machine: per session the tier, the setup installed at the time, skills used, the last test run, cost, time and pull request state. The Sessions view in the browser app shows the same board.'],
];

function CmdRow({ cmd, note }: { cmd: string; note: ReactNode }) {
  return (
    <Stack gap={6}>
      <Group gap={6} wrap="nowrap">
        <Code block className="cmd">{cmd}</Code>
        <ActionIcon variant="default" size={36} data-copy={cmd} aria-label={`Copy command: ${cmd}`}>
          <IconCopy size={16} className="i-copy" /><IconCheck size={16} className="i-done" />
        </ActionIcon>
      </Group>
      <Text size="sm" c="dimmed">{note}</Text>
    </Stack>
  );
}

const reasons: [string, string][] = [
  ['Quality', 'in BenchKeeper\'s mistreevous brownfield run only ECC scored measurably above plain Claude Code; Matt Pocock\'s skills, Ponytail and BenchKeeper stayed within the round-to-round spread (medians 84.1 to 90.1, Sonnet 5.5, k = 3).'],
  ['Time', 'it depends on the version: setup-v4.0 with Matt Pocock\'s skills took a median 13.1 minutes against 22.7 for plain Claude Code, setup-v5.0 took 24.9. setup-v6.0 is not measured yet.'],
  ['Cost', 'Ponytail alone cost 0.58 times plain Claude Code in the mistreevous run (k = 3); external results range from 10% less to 55% more.'],
  ['Skills by level', 'the full flow runs only for full-tier work. Small changes load one targeted skill.'],
  ['One install', 'one machine setup covers every repository. Each repository adds only its tracker, docs and stack.'],
];

const host = ['Rules and the plugins: BenchKeeper, Ponytail, optionally Matt Pocock\'s skills', 'Git and gh: branches, commits, pull requests', 'Dev Containers CLI and Docker or Podman', 'The agent, with --env host-agent'];
const container = ['The agent (default), started with devcontainer exec', 'Project toolchain at pinned versions', 'Installs, builds, lint, tests', 'Playwright browser', 'Non-root user, project mount only'];

function Side({ label, color, items }: { label: string; color: string; items: string[] }) {
  return (
    <Paper withBorder p="lg" radius="lg" style={{ borderColor: `var(--mantine-color-${color}-6)`, borderWidth: 2 }}>
      <Badge variant="outline" className={color === 'orange' ? 'decide' : undefined} mb="md">{label}</Badge>
      <List size="sm" spacing={8}>{items.map((t) => <List.Item key={t}>{t}</List.Item>)}</List>
    </Paper>
  );
}

export default function Page({ base, updated, commit }: { base: string; updated?: string; commit?: string }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <a className="skip" href="#main">Skip to content</a>
      <SiteHeader base={base} home />

      <main id="main" tabIndex={-1}>
        <Box className="hero" py={{ base: 64, md: 112 }}>
          <Container size="lg">
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing={48} style={{ alignItems: 'center' }}>
              <Stack gap="lg">
                <Badge variant="light" size="lg">Setup for Claude Code and Codex</Badge>
                <Title order={1} fz={{ base: 44, md: 68 }} lh={1.02}><span className="grad">BenchKeeper</span></Title>
                <Text size="xl" maw={560}>
                  Short rules, a workflow skill that sizes each change, and Ponytail for Claude Code and Codex, installed by an app that shows each change first and can undo the run.
                  Each repository adds its dev container, AGENTS.md and stack skills.
                </Text>
                <Group mt="sm">
                  <Button component="a" href="#start" size="md">Set up your machine</Button>
                  <Button component="a" href="#sdlc" size="md" variant="default">See the workflow</Button>
                </Group>
              </Stack>
              <Box ta="center">
                <img src={`${base}/logo.svg`} alt="BenchKeeper logo: a brain inside a gear, circled by a loop of arrows" className="logo" width={300} height={300} style={{ width: 'min(300px, 64vw)', height: 'auto' }} />
              </Box>
            </SimpleGrid>
          </Container>
        </Box>

        <Section id="sdlc" title="One loop, sized to the change" intro="The workflow skill sorts each task into a software change, a docs pass or research, and gives a software change a tier: how much process it gets. Quick: branch, build, verify, ship. Full: spec, tickets, tests first, review. Several tasks on one branch run their long checks and reviews once at the end. A skill that matches the task loads in any tier, and each change type adds its own check.">
          <div className="ring-wrap">
            <div dangerouslySetInnerHTML={{ __html: sdlcSvg }} />
            <div className="ring-tip" role="tooltip" hidden></div>
          </div>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={40} verticalSpacing="xl" mt={40}>
            <StepList from={0} className="steps-first" />
            <StepList from={half} />
          </SimpleGrid>
        </Section>

        <Section id="parts" title="What gets installed">
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
            <Part icon={<IconFileText size={20} />} title={<Code fz="sm">rules/global.md</Code>} href={`${REPO}/blob/main/plugins/benchkeeper/rules/global.md`} scope="Global, every session, full level">
              Secrets kept out, writing without filler, sources for claims. The repository rules (ask before assuming, checks never weakened, load the workflow skill) are in <Code>rules/project.md</Code>, part of each project's block.
            </Part>
            <Part icon={<IconListCheck size={20} />} title={<Code fz="sm">workflow</Code>} href={`${REPO}/blob/main/plugins/benchkeeper/skills/workflow/SKILL.md`} scope="Global, before repository work">
              The task kind and tier, the playbooks for software changes, docs passes and research, the check per change type, batch mode with long checks at the end.
            </Part>
            <Part icon={<IconSchool size={20} />} title="Matt Pocock's skills" href="https://github.com/mattpocock/skills" scope="Optional, his plugin, global in both agents">
              Grilling, spec and tickets, TDD, bug diagnosis, code review, pull request text. They read the issue tracker and domain docs in <Code>docs/agents/</Code>.
            </Part>
            <Part icon={<IconFeather size={20} />} title="Ponytail" href="https://github.com/DietrichGebert/ponytail" scope="Global, level full">
              The smallest complete change: reuse before new code, no unrequested options, a test for new logic, <Code>shortcut:</Code> comments for known limits.
            </Part>
            <Part icon={<IconRoute size={20} />} title="The app and the setup skills" href={`${REPO}/tree/main/app`} scope="On request">
              <Code>npx benchkeeper@6.21.0</Code> sets up the machine and each repository, shows every change first and records each run for undo. Its Dashboard reports drift, Fix everything applies the global plan and updates every project, and the Sessions board tracks tier, cost and outcome per session. <Code>/benchkeeper:setting-up-projects</Code> adds stack skills and the dev container, <Code>/benchkeeper:maintaining-repos</Code> runs a maintenance pass, <Code>/benchkeeper:orchestrating-projects</Code> coordinates workers on labeled issues across projects.
            </Part>
            <Part icon={<IconContainer size={20} />} title="Devcontainer and Playwright" href="https://code.visualstudio.com/docs/devcontainers/devcontainer-cli" scope="Per repository">
              Installs, builds, tests and the browser run in the container as a non-root user. Domain skills come from the <Anchor href={`${REPO}/blob/main/plugins/benchkeeper/library/README.md`}>BenchKeeper library</Anchor>, stack skills from <Anchor href="https://github.com/vercel-labs/skills">find-skills</Anchor>, at most two per technology.
            </Part>
          </SimpleGrid>
        </Section>

        <Section id="levels" title="Three sizes" intro="Start with the plugin and add what you need. Each level contains the one before.">
          <SimpleGrid cols={{ base: 1, md: 3 }}>
            {facts.levels.map((l) => (
              <Paper key={l.name} withBorder p="lg" radius="lg">
                <Title order={3} fz="lg">{l.name}</Title>
                <Text size="sm" mt="xs">{md(l.contains)}</Text>
                <Text size="sm" c="dimmed" mt="xs">Writes: {md(l.writes)}.</Text>
                <Code block mt="sm" className="cmd">{l.command}</Code>
              </Paper>
            ))}
          </SimpleGrid>
        </Section>

        <Section id="frameworks" title="Frameworks you already use" intro={facts.frameworks.rule}>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {facts.frameworks.items.map((f) => (
              <Paper key={f.name} withBorder p="lg" radius="lg">
                <Group gap="xs"><Title order={3} fz="lg"><Anchor href={f.url}>{f.name}</Anchor></Title><Badge variant="outline">{f.role}</Badge></Group>
                <Text size="sm" mt="xs">Installs {md(f.installs)}. <Anchor href={`${REPO}/blob/main/${f.evaluation}`}>Evaluation</Anchor></Text>
              </Paper>
            ))}
          </SimpleGrid>
        </Section>

        <Section id="start" title="Quick start" intro={<>{facts.quickstart.needs} <Anchor href={`${SETUP}#prerequisites`}>Full list of tools.</Anchor> {facts.quickstart.choose} <Anchor href={`${base}/app/`}>The app, view by view, with screenshots.</Anchor></>}>
          <Stack gap="lg" maw={760}>
            <div className="qs">
              <div role="tablist" aria-label="Install path" className="qs-tabs" hidden>
                {facts.quickstart.paths.map((p, i) => (
                  <button key={p.name} type="button" role="tab" id={`qs-tab-${i}`} aria-controls={`qs-panel-${i}`} aria-selected={i === 0} tabIndex={i === 0 ? 0 : -1}>{p.name}</button>
                ))}
              </div>
              {facts.quickstart.paths.map((p, i) => (
                <div key={p.name} id={`qs-panel-${i}`} className="qs-panel">
                  <Title order={3} fz="lg" mb="sm" className="qs-h">{p.name}</Title>
                  <Stack gap="md">
                    {p.steps.map((st) => <CmdRow key={st.command} cmd={st.command} note={md(st.text)} />)}
                  </Stack>
                </div>
              ))}
            </div>
            <Text size="sm">{facts.quickstart.next} {md(facts.quickstart.changes)}</Text>
            <Group gap="md">
              {facts.quickstart.links.map((l) => <Anchor key={l.anchor} href={l.anchor === 'levels' ? `#${l.anchor}` : `${SETUP}#${l.anchor}`} size="sm">{l.label}</Anchor>)}
            </Group>
            <VisuallyHidden aria-live="polite" data-copy-status></VisuallyHidden>
          </Stack>
        </Section>

        <Section id="repos" title="Each repository, updates and sessions">
          <Stack gap="lg" maw={760}>
            {repoSteps.map(([title, cmd, note], k) => (
              <Group key={title} gap="md" wrap="nowrap" align="flex-start">
                <ThemeIcon variant="light" radius="xl" size={30}><Text size="sm" fw={700}>{k + 1}</Text></ThemeIcon>
                <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
                  <Text fw={700}>{title}</Text>
                  <CmdRow cmd={cmd} note={note} />
                </Stack>
              </Group>
            ))}
          </Stack>
        </Section>

        <Section id="selected" title="Why this stack">
          <List spacing="sm" maw={760}>
            {reasons.map(([k, v]) => <List.Item key={k}><Text span fw={700}>{k}:</Text> {v}</List.Item>)}
          </List>
          <Text size="sm" mt="lg">For details, check the full data: <Anchor href={`${REPO}/blob/main/EVALUATIONS.md`}>evaluations</Anchor>, <Anchor href={`${base}/bench/`}>benchmark pages</Anchor>.</Text>
        </Section>

        <Section id="where" title="Where things run" intro="By default the agent runs inside the repository's dev container, together with the project commands. With --env host-agent it stays on the host and sends project commands through devcontainer exec.">
          <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
            <Side label="Host, one per machine" color="teal" items={host} />
            <Stack align="center" justify="center" gap={6}>
              <ThemeIcon variant="light" size={44} radius="xl" visibleFrom="md"><IconArrowRight size={22} /></ThemeIcon>
              <ThemeIcon variant="light" size={44} radius="xl" hiddenFrom="md"><IconArrowDown size={22} /></ThemeIcon>
              <Text ff="monospace" size="sm" c="dimmed">devcontainer exec</Text>
            </Stack>
            <Side label="Devcontainer, one per repository" color="orange" items={container} />
          </SimpleGrid>
          <Alert mt="xl" variant="default" role="note" icon={<IconAlertTriangle size={20} />} title="Isolation">
            In the default container environment the agent sees the project mount instead of your home folder, but a container shares the host kernel and is not a security boundary. With --env host-agent, project apply --sandbox turns on Claude Code's sandbox. For a separate kernel, use a Docker Sandboxes microVM (--env sandbox, untested) or a VM.
          </Alert>
        </Section>
      </main>

      <Box component="footer" className="band" py="xl">
        <Container size="lg">
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              BenchKeeper, MIT License
              {updated && commit && <>, updated {updated} (<Anchor href={`${REPO}/commit/${commit}`} size="sm">{commit.slice(0, 7)}</Anchor>)</>}
            </Text>
            <Anchor href={REPO} size="sm">github.com/ESchuderer/BenchKeeper</Anchor>
          </Group>
        </Container>
      </Box>
    </MantineProvider>
  );
}
