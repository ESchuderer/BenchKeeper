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

const quickstart: [string, string, string][] = [
  ['Clone BenchKeeper', 'git clone --depth 1 https://github.com/ESchuderer/BenchKeeper.git', 'setup.sh and the rules come from the clone. The skills install as a plugin.'],
  ['Review the plan', 'sh BenchKeeper/plugins/benchkeeper/setup.sh', 'A dry run: lists each change for the agents on your PATH and changes nothing.'],
  ['Apply', 'sh BenchKeeper/plugins/benchkeeper/setup.sh --apply', 'Asks before each change: rules, the plugins (BenchKeeper, Matt Pocock\'s skills, Ponytail), settings. Then it lists every other global rules file, skill, plugin, marketplace, MCP server and hook, and removes only what you confirm. Files go to a backup that --restore moves back. No root.'],
  ['Restart the agents', '', 'New sessions load the global rules and the plugin skills.'],
  ['Project setup, in each repository root', '/benchkeeper:setting-up-projects', 'Codex: $benchkeeper:setting-up-projects. Devcontainer, AGENTS.md, library and stack skills, default tier. It asks for the next step partway through.'],
  ['Matt Pocock setup, when project setup asks for it', '/mattpocock-skills:setup-matt-pocock-skills', 'Codex: $mattpocock-skills:setup-matt-pocock-skills. Issue tracker, triage labels, domain docs in docs/agents/. Then project setup finishes. Commit the result.'],
  ['Update later', 'claude plugin marketplace update benchkeeper && claude plugin update benchkeeper@benchkeeper', 'Codex upgrades plugins at startup. When a release changes the rules: git -C BenchKeeper pull, then setup.sh --apply again.'],
];

const reasons: [string, string][] = [
  ['Quality', 'on par with the best setups tested.'],
  ['Time', 'less time per task with the BenchKeeper workflow.'],
  ['Cost', 'lower with Ponytail.'],
  ['Skills by level', 'the full flow runs only for full-tier work. Small changes load one targeted skill.'],
  ['One install', 'one machine setup covers every repository. Each repository adds only its tracker, docs and stack.'],
];

const host = ['Claude Code or Codex, sign-in and permissions', 'Rules and the plugins: BenchKeeper, Matt Pocock\'s skills, Ponytail', 'Git and gh: branches, commits, pull requests', 'Dev Containers CLI and Docker'];
const container = ['Project toolchain at pinned versions', 'Installs, builds, lint, tests', 'Playwright browser', 'Non-root user, project mount only'];

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
                  Rules, Matt Pocock's skills, Ponytail and a workflow skill that sizes each change, installed on your machine in one run.
                  Each repository adds its devcontainer, issue tracker and stack.
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

        <Section id="sdlc" title="One loop, sized to the change" intro="following-dev-workflow picks a tier for each change. Quick: branch, build, verify, ship. Full: Matt Pocock's whole flow. A skill that matches the task loads in any tier, and each change type adds its own check.">
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
            <Part icon={<IconFileText size={20} />} title={<Code fz="sm">rules/global.md</Code>} href={`${REPO}/blob/main/plugins/benchkeeper/rules/global.md`} scope="Global, every session">
              Ask before assuming, short answers, sources for claims, only what the task needs, checks never weakened, confirm before destructive steps.
            </Part>
            <Part icon={<IconListCheck size={20} />} title={<Code fz="sm">following-dev-workflow</Code>} href={`${REPO}/blob/main/plugins/benchkeeper/skills/following-dev-workflow/SKILL.md`} scope="Global, before repository work">
              The tier, the required steps and the check per change type: issue, branch, tests, reviews before push, draft pull request.
            </Part>
            <Part icon={<IconSchool size={20} />} title="Matt Pocock's skills" href="https://github.com/mattpocock/skills" scope="His plugin, global in both agents">
              Grilling, spec and tickets, TDD, bug diagnosis, code review, pull request text. They read the issue tracker and domain docs in <Code>docs/agents/</Code>.
            </Part>
            <Part icon={<IconFeather size={20} />} title="Ponytail" href="https://github.com/DietrichGebert/ponytail" scope="Global, level full">
              The smallest complete change: reuse before new code, no unrequested options, a test for new logic, <Code>shortcut:</Code> comments for known limits.
            </Part>
            <Part icon={<IconRoute size={20} />} title="setup.sh and the setup skills" href={`${REPO}/blob/main/plugins/benchkeeper/setup.sh`} scope="On request">
              <Code>setup.sh</Code> sets up the machine, <Code>/benchkeeper:setting-up-projects</Code> each repository, <Code>/benchkeeper:maintaining-repos</Code> runs a maintenance pass. Each shows its plan first and applies only what you approve.
            </Part>
            <Part icon={<IconContainer size={20} />} title="Devcontainer and Playwright" href="https://code.visualstudio.com/docs/devcontainers/devcontainer-cli" scope="Per repository">
              Installs, builds, tests and the browser run in the container as a non-root user. Domain skills come from the <Anchor href={`${REPO}/blob/main/plugins/benchkeeper/library/README.md`}>BenchKeeper library</Anchor>, stack skills from <Anchor href="https://github.com/vercel-labs/skills">find-skills</Anchor>, at most two per technology.
            </Part>
          </SimpleGrid>
        </Section>

        <Section id="start" title="Quick start" intro={<>Needs Claude Code or Codex, Git, jq, npm and Docker (<Anchor href={`${REPO}#prerequisites`}>full list</Anchor>). <Code>setup.sh</Code> installs the Dev Containers CLI. Each setup step shows its plan before it changes anything.</>}>
          <Stack gap="lg" maw={760}>
            {quickstart.map(([title, cmd, note], k) => (
              <Group key={title} gap="md" wrap="nowrap" align="flex-start">
                <ThemeIcon variant="light" radius="xl" size={30}><Text size="sm" fw={700}>{k + 1}</Text></ThemeIcon>
                <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
                  <Text fw={700}>{title}</Text>
                  {cmd && (
                    <Group gap={6} wrap="nowrap">
                      <Code block className="cmd">{cmd}</Code>
                      <ActionIcon variant="default" size={36} data-copy={cmd} aria-label={`Copy command: ${cmd}`}>
                        <IconCopy size={16} className="i-copy" /><IconCheck size={16} className="i-done" />
                      </ActionIcon>
                    </Group>
                  )}
                  <Text size="sm" c="dimmed">{note}</Text>
                </Stack>
              </Group>
            ))}
            <VisuallyHidden aria-live="polite" data-copy-status></VisuallyHidden>
          </Stack>
        </Section>

        <Section id="selected" title="Why this stack">
          <List spacing="sm" maw={760}>
            {reasons.map(([k, v]) => <List.Item key={k}><Text span fw={700}>{k}:</Text> {v}</List.Item>)}
          </List>
          <Text size="sm" mt="lg">For details, check the full data: <Anchor href={`${REPO}/blob/main/EVALUATIONS.md`}>evaluations</Anchor>, <Anchor href={`${base}/bench/`}>benchmark pages</Anchor>.</Text>
        </Section>

        <Section id="where" title="Where things run" intro="The agent and its configuration stay on the host. Project commands run in the repository's devcontainer.">
          <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
            <Side label="Host, one per machine" color="teal" items={host} />
            <Stack align="center" justify="center" gap={6}>
              <ThemeIcon variant="light" size={44} radius="xl" visibleFrom="md"><IconArrowRight size={22} /></ThemeIcon>
              <ThemeIcon variant="light" size={44} radius="xl" hiddenFrom="md"><IconArrowDown size={22} /></ThemeIcon>
              <Text ff="monospace" size="sm" c="dimmed">devcontainer exec</Text>
            </Stack>
            <Side label="Devcontainer, one per repository" color="orange" items={container} />
          </SimpleGrid>
          <Alert mt="xl" variant="default" role="note" icon={<IconAlertTriangle size={20} />} title="Not a sandbox">
            The agent runs on the host with its client permissions. The devcontainer scopes project commands only. For stronger isolation, run the agent in a VM or a microVM.
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
