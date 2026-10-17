import {
  ActionIcon, Alert, Anchor, Badge, Box, Button, Card, Code, Container, Group, List, MantineProvider,
  Paper, Progress, SimpleGrid, Stack, Table, Text, ThemeIcon, Timeline, Title, createTheme,
} from '@mantine/core';
import {
  IconArrowDown, IconArrowRight, IconBrowser, IconCircleCheck,
  IconCircleX, IconContainer, IconFeather, IconFileText, IconListCheck, IconPackage, IconRoute, IconLayoutKanban, IconServer, IconStack2, IconTerminal2, IconSearch, IconAlertTriangle, IconTestPipe, IconShieldLock, IconGauge, IconAccessible, IconCopy, IconCheck, IconTool,
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
const toolIcons: Record<string, ReactNode> = { stack: <IconStack2 size={20} />, kanban: <IconLayoutKanban size={20} />, terminal: <IconTerminal2 size={20} /> };


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

function FeatureCard({ icon, title, href, scope, gives, children }: { icon: ReactNode; title: ReactNode; href?: string; scope: string; gives?: string; children: ReactNode }) {
  return (
    <Card withBorder padding="lg" className={href ? 'lift linked' : 'lift'}>
      <Group gap="sm" wrap="nowrap">
        <ThemeIcon variant="light" size={38} radius="md">{icon}</ThemeIcon>
        {href ? <Anchor href={href} fw={700} className="stretched" underline="hover">{title}</Anchor> : <Text fw={700}>{title}</Text>}
      </Group>
      <Text size="xs" fw={700} tt="uppercase" c="dimmed" mt="md">{scope}</Text>
      <Text size="sm" mt={6}>{children}</Text>
      {gives && (
        <Text size="sm" mt="auto" pt="md"><Text span fw={700} c="teal">What you get </Text>{gives}</Text>
      )}
    </Card>
  );
}

function ToolCard({ icon, name, href, platforms, points, when }: { icon: ReactNode; name: string; href: string; platforms: string; points: string[]; when: string }) {
  return (
    <Card withBorder padding="lg" className="lift linked">
      <Group gap="sm" wrap="nowrap"><ThemeIcon variant="light" size={38}>{icon}</ThemeIcon><Anchor href={href} fw={700} className="stretched" underline="hover">{name}</Anchor></Group>
      <Badge variant="outline" color="gray" mt="sm" w="fit-content">{platforms}</Badge>
      <List size="sm" mt="md" spacing={6}>{points.map((t, k) => <List.Item key={k}>{md(t[0].toUpperCase() + t.slice(1))}</List.Item>)}</List>
      <Text size="sm" mt="auto" pt="md"><Text span fw={700}>Choose it when</Text> {when}.</Text>
    </Card>
  );
}

function Check({ ok, title, children }: { ok: boolean; title: string; children: ReactNode }) {
  return (
    <List.Item icon={<ThemeIcon variant="light" color={ok ? 'teal' : 'orange'} size={26} radius="xl">{ok ? <IconCircleCheck size={16} /> : <IconCircleX size={16} />}</ThemeIcon>}>
      <Text span fw={700}>{title}</Text> <Text span c="dimmed">{children}</Text>
    </List.Item>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <Paper bg="var(--mantine-color-default-hover)" p="md" radius="md">
      <Text fz={28} fw={800} lh={1.1} style={{ whiteSpace: 'nowrap' }}>{value}</Text>
      <Text size="xs" c="dimmed" mt={4}>{label}</Text>
    </Paper>
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


const checks: [ReactNode, string, ReactNode][] = [
  [<IconTestPipe size={18} />, 'Tests', <>The existing tests for the touched code first, then <Code>tdd</Code> at the agreed seams.</>],
  [<IconShieldLock size={18} />, 'Security', <>Auth, permissions, secrets and input validation: <Code>/security-review</Code> and tests for denied paths. Secrets are never printed or committed. Maintain audits dependencies.</>],
  [<IconGauge size={18} />, 'Performance', <>A benchmark before and after on the same machine. <Code>ponytail-audit</Code> flags slow paths and what breaks under load.</>],
  [<IconAccessible size={18} />, 'UI and accessibility', <>End-to-end and accessibility tests, plus a browser check through Playwright MCP.</>],
];

const quickstart: [string, string, string][] = [
  ['Clone BenchKeeper and open it in your agent', 'git clone https://github.com/ESchuderer/BenchKeeper.git && cd BenchKeeper && claude', 'Codex: run codex instead of claude.'],
  ['Machine setup', '/setting-up-machine', 'Codex: $setting-up-machine. Pick your agents, review the plan, approve. Installs the rules, Matt Pocock\'s skills, Ponytail and the workflow and setup skills.'],
  ['Restart the agents', '', 'New sessions load the global rules and skills.'],
  ['Project setup, in each repository root', '/setting-up-projects', 'Codex: $setting-up-projects. Devcontainer, AGENTS.md, stack skills, default tier. It asks for the next step partway through.'],
  ['Matt Pocock setup, when project setup asks for it', '/mattpocock-skills:setup-matt-pocock-skills', 'Codex: $setup-matt-pocock-skills. Issue tracker, triage labels, domain docs in docs/agents/. Then project setup finishes. Commit the result.'],
  ['Update later', 'git -C BenchKeeper pull', 'Then /setting-up-machine again. Matt Pocock\'s skills and Ponytail update through their marketplaces.'],
];

const listTop = { root: { paddingInlineStart: 0 }, itemWrapper: { alignItems: 'flex-start' }, itemIcon: { marginTop: 1 } };

const ponytail: [string, number][] = [['Lines of code', 53], ['Output tokens', 45], ['Time', 41], ['Cost', 26]];

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
                <Badge variant="light" size="lg" w="fit-content" h="auto" py={4} styles={{ label: { whiteSpace: 'normal' } }}>Setup for Claude Code and Codex</Badge>
                <Title order={1} fz={{ base: 44, md: 68 }} lh={1.02} style={{ letterSpacing: '-0.03em' }}>
                  <span className="grad">BenchKeeper</span>
                </Title>
                <Text size="xl" maw={560}>{facts.description}</Text>
                <Text size="lg" maw={560}><Text span fw={700}>Built on <Anchor href={facts.core.url}>{facts.core.name}</Anchor> by {facts.core.by}:</Text> {facts.core.role}.</Text>
                <Group mt="sm">
                  <Button component="a" href="#start" size="md">Get started</Button>
                  <Button component="a" href="#sdlc" size="md" variant="default">See the SDLC</Button>
                </Group>
              </Stack>
              <Box ta="center">
                <img src={`${base}/logo.svg`} alt="BenchKeeper logo: a brain inside a gear, circled by a loop of arrows" className="logo" width={300} height={300} style={{ width: 'min(300px, 64vw)', height: 'auto' }} />
              </Box>
            </SimpleGrid>
          </Container>
        </Box>

        <Section id="what" title="What it is" intro={<>Claude Code and Codex are each optional. Setup configures only the agents you select. To change a choice, edit <Code>rules/global.md</Code> or the setup skills and rerun <Code>/setting-up-machine</Code>. After a change to <Code>following-dev-workflow</Code>, rerun <Code>/setting-up-projects</Code> in each repository.</>}>
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
            <FeatureCard icon={<IconFileText size={20} />} title={<Code fz="sm">rules/global.md</Code>} scope="Global, both agents">
              Applies in every session: when to load the workflow skill, ask instead of assuming, brevity, structure, sources for claims, punctuation, scope, devcontainer use, safety, context.
            </FeatureCard>
            <FeatureCard icon={<IconPackage size={20} />} title={<Code fz="sm">/setting-up-machine</Code>} scope="Once per machine">
              Checks 8 parts plus one optional part (rules, Matt Pocock's skills, Ponytail, workflow and setup skills, settings, devcontainer tooling) without changing anything, then shows one plan: installs, changes, removals, version bumps.
            </FeatureCard>
            <FeatureCard icon={<IconRoute size={20} />} title={<Code fz="sm">/setting-up-projects</Code>} scope="Once per repository">
              Devcontainer, <Code>AGENTS.md</Code>, stack skills, Matt Pocock's repository setup (issue tracker, domain docs), the default tier, dead config, with one plan first. On a fresh clone it restores the skills.
            </FeatureCard>
            <FeatureCard icon={<IconListCheck size={20} />} title={<Code fz="sm">following-dev-workflow</Code>} scope="Global, both agents">
              Task tier and its steps: issue, branch, tests first, spec, review before push, draft pull request. Loaded before repository work.
            </FeatureCard>
            <FeatureCard icon={<IconTool size={20} />} title={<Code fz="sm">/maintaining-repos</Code>} scope="On request, per repository">
              The Maintain pass: dead code, shortcut debt, dependency audit, docs drift, unused skills. Findings become new requests.
            </FeatureCard>
          </SimpleGrid>
        </Section>

        <Section id="sdlc" title="One loop, sized to the change" intro="The following-dev-workflow skill sizes each request by tier and change type. The tier sets the required steps. Quick: branch, build, verify, ship. Standard: no spec, a plan of a few lines. Full: all six steps. Targeted skills, such as tdd or a stack skill, load in any tier when they match the task. Research with several items: parallel subagents, no edits. Each change type adds its own check, such as terraform plan for infrastructure or a reproducer test for a bug.">
          <div className="ring-wrap">
            <div dangerouslySetInnerHTML={{ __html: sdlcSvg }} />
            <div className="ring-tip" role="tooltip" hidden></div>
          </div>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={40} verticalSpacing="xl" mt={40}>
            <StepList from={0} className="steps-first" />
            <StepList from={half} />
          </SimpleGrid>
          <Text fw={700} mt={48} mb="xs">Checks built into the loop</Text>
          <Text size="sm" c="dimmed" mb="md" maw={760}>Each change type in the following-dev-workflow skill adds its check before the change is reported done.</Text>
          <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="lg">
            {checks.map(([icon, title, text]) => (
              <Stack key={title as string} gap={6}>
                <Group gap="xs" wrap="nowrap"><ThemeIcon variant="light" size={30} radius="md">{icon}</ThemeIcon><Text fw={700}>{title}</Text></Group>
                <Text size="sm">{text}</Text>
              </Stack>
            ))}
          </SimpleGrid>
        </Section>

        <Section id="where" title="Where things run" intro="The agent and its configuration stay on the host. Project commands run in the repository's standard devcontainer, which mounts only the project.">
          <Box className="split">
            <Paper withBorder p="lg" radius="lg" style={{ borderColor: 'var(--mantine-color-teal-6)', borderWidth: 2 }}>
              <Group gap="xs" mb="md"><Badge variant="outline">Host</Badge><Text fw={700}>one per machine</Text></Group>
              <Stack gap={10} className="host-list">
                {['Claude Code or Codex, sign-in and permissions', 'Global rules, Matt Pocock\'s skills, Ponytail, the workflow and setup skills, settings', 'Git and gh: branches, commits, pull requests', 'Dev Containers CLI and Docker'].map((t) => (
                  <Group key={t} gap="sm" wrap="nowrap" align="flex-start"><span className="dot" /><Text size="sm">{t}</Text></Group>
                ))}
              </Stack>
            </Paper>
            <Stack align="center" justify="center" gap={6}>
              <ThemeIcon variant="light" size={44} radius="xl" visibleFrom="md"><IconArrowRight size={22} /></ThemeIcon>
              <ThemeIcon variant="light" size={44} radius="xl" hiddenFrom="md"><IconArrowDown size={22} /></ThemeIcon>
              <Text ff="monospace" size="sm" c="dimmed">devcontainer exec</Text>
            </Stack>
            <Paper withBorder p="lg" radius="lg" style={{ borderColor: 'var(--mantine-color-orange-6)', borderWidth: 2 }}>
              <Group gap="xs" mb="md"><Badge variant="outline" className="decide">Devcontainer</Badge><Text fw={700}>one per repository</Text></Group>
              <Stack gap={10} className="ctr-list">
                {['Project toolchain at pinned versions', 'Installs, builds, lint, tests', 'Playwright browser', 'Non-root user, project mount only, no host home, no engine socket, no credential forwarding'].map((t) => (
                  <Group key={t} gap="sm" wrap="nowrap" align="flex-start"><span className="dot" /><Text size="sm">{t}</Text></Group>
                ))}
              </Stack>
            </Paper>
          </Box>
          <Alert mt="xl" variant="light" color="yellow" className="warn" icon={<IconAlertTriangle size={20} />} title="Not full isolation">
            <Text size="sm">The agent runs on the host with its client permissions. The devcontainer only scopes project commands. Options for stronger isolation, not part of BenchKeeper:</Text>
            <List size="sm" mt="xs" spacing={4}>
              <List.Item><b>Shared VM</b>: agents and all projects in one VM, which protects the host, not projects from each other.</List.Item>
              <List.Item><b>VM per project</b>: projects isolated from each other.</List.Item>
              <List.Item><b>VM per branch or worktree</b>: parallel agent runs isolated from each other, one VM per run.</List.Item>
              <List.Item><b>MicroVMs</b> (<Anchor href="https://firecracker-microvm.github.io/">Firecracker</Anchor>, <Anchor href="https://katacontainers.io/">Kata Containers</Anchor>): lightweight VMs per project or task.</List.Item>
              <List.Item><b>Rootless engine</b> (<Anchor href="https://docs.docker.com/engine/security/rootless/">rootless Docker</Anchor>, <Anchor href="https://podman.io/">Podman</Anchor>): container root is not host root. The agent still runs on the host.</List.Item>
            </List>
          </Alert>
        </Section>

        <Section id="parts" title="What each part gives you" intro="Each is a separate upstream project, configured for the selected agents.">
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
            <FeatureCard icon={<IconListCheck size={20} />} title="Matt Pocock's skills" href="https://github.com/mattpocock/skills" scope="His install: Claude Code global plugin, Codex per repository"
              gives="Steps per task tier: open questions settled before code for full changes, tests first, a review against standards and the spec.">
              Skills for grilling, domain docs, spec and tickets, TDD, bug diagnosis, code review, pull requests and session handoff. Per repository they read the issue tracker and domain docs from <Code>docs/agents/</Code>.
            </FeatureCard>
            <FeatureCard icon={<IconFeather size={20} />} title="Ponytail" href="https://github.com/DietrichGebert/ponytail" scope="Global, both agents"
              gives="Fewer lines of code in every source that measured them. Cost varies by setup.">
              Rules for the smallest complete change: reuse before new code, no unrequested options, a test for non-trivial logic, <Code>shortcut:</Code> comments for known limits, plus audit and debt reports.
            </FeatureCard>
            <FeatureCard icon={<IconBrowser size={20} />} title="Playwright MCP" href="https://github.com/microsoft/playwright-mcp" scope="Per repository, browser in the container"
              gives="A browser the agent controls from the container.">
              Browser control over MCP: open pages, click, fill forms, read console and network, take screenshots.
            </FeatureCard>
            <FeatureCard icon={<IconContainer size={20} />} title="Dev Containers" href="https://code.visualstudio.com/docs/devcontainers/devcontainer-cli" scope="CLI on host, config per repository"
              gives="One toolchain definition per repository for every machine and client. Installs, builds and tests run as a non-root user in the container, not on the host.">
              A standard <Code>devcontainer.json</Code> per repository, shared by the CLI, VS Code and Orca terminals. Project commands run through <Code>devcontainer exec</Code>.
            </FeatureCard>
            <FeatureCard icon={<IconSearch size={20} />} title="Stack skills" scope="Per repository"
              gives="Framework-specific knowledge where Matt Pocock's skills are generic.">
              <Anchor href="https://github.com/vercel-labs/skills">find-skills</Anchor> picks at most two vetted skills per technology.
            </FeatureCard>
          </SimpleGrid>
        </Section>

        <Section id="selected" title="How this stack was selected">
          <List spacing="sm" maw={760} styles={listTop}>
            <List.Item><Text span fw={700}>Quality:</Text> on par with the best setups tested.</List.Item>
            <List.Item><Text span fw={700}>Time:</Text> less time per task with the BenchKeeper workflow.</List.Item>
            <List.Item><Text span fw={700}>Cost:</Text> lower with Ponytail.</List.Item>
            <List.Item><Text span fw={700}>Skills by level:</Text> small composable skills. The big flow runs only for big work, small tiers load targeted skills.</List.Item>
            <List.Item><Text span fw={700}>Same setup everywhere:</Text> one machine install covers every repository. Each repository adds only its tracker, docs and stack.</List.Item>
          </List>
          <Text size="sm" mt="lg">For details, check the full data: <Anchor href={`${REPO}/blob/main/EVALUATIONS.md`}>EVALUATIONS.md</Anchor>, <Anchor href={`${base}/bench/`}>benchmark pages</Anchor>.</Text>
        </Section>

        <Section id="quality" title="Rules in every session" intro={<>From <Anchor href={`${REPO}/blob/main/rules/global.md`}>rules/global.md</Anchor>. Spec, tests and review are SDLC steps above.</>}>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing={48}>
            <List spacing="lg" styles={listTop}>
              <Check ok title="Ask, do not assume.">Ambiguous requests stop for precise questions.</Check>
              <Check ok title="Scope.">Only what the task needs: no unrequested refactors, reformatting or extra files.</Check>
            </List>
            <List spacing="lg" styles={listTop}>
              <Check ok title="Checks are never weakened.">No skipped tests, loosened assertions, disabled lint rules or --no-verify unless you ask.</Check>
              <Check ok title="Sources and confidence.">External claims carry an official URL. Uncertain topics state a confidence level.</Check>
            </List>
          </SimpleGrid>
        </Section>

        <Section id="cost" title="Cost and quality" intro={<>Ponytail: fewer lines of code in every measurement. Cost -10.3% in JetBrains' test (card below), +0.7% to +55% in four other independent tests (different injection methods and models). BenchKeeper's own cost measurements are in the benchmark reports. Curated skills raised the pass rate by 16.6 points on <Anchor href="https://arxiv.org/abs/2602.12670">SkillsBench</Anchor>. Fewer rounds of fixes from the checks and the spec: not measured. Components evaluated, included or not: <Anchor href={`${REPO}/blob/main/EVALUATIONS.md`}>EVALUATIONS.md</Anchor>.</>}>
          <SimpleGrid cols={{ base: 1, md: 3 }}>
            <Card withBorder padding="lg">
              <Group gap="sm"><ThemeIcon variant="light" size={34}><IconGauge size={18} /></ThemeIcon><Text fw={700}>BenchKeeper, own benchmark</Text></Group>
              <Text size="sm" c="dimmed" mt="sm">Each setup runs as its own arm on the same greenfield and brownfield briefs. Scores, time per task and app reviews per arm are on the benchmark pages.</Text>
              <Text size="xs" c="dimmed" mt="md">Results: <Anchor href={`${base}/bench/`}>benchmark pages</Anchor>, <Anchor href={`${REPO}/tree/main/bench/results`}>reports</Anchor>.</Text>
            </Card>
            <Card withBorder padding="lg">
              <Group gap="sm"><ThemeIcon variant="light" size={34}><IconFeather size={18} /></ThemeIcon><Text fw={700}>Ponytail, vendor benchmark</Text></Group>
              <Text size="sm" c="dimmed" mt="sm">Reduction against no skill. 39 tasks, 5 runs each, Claude Code on Opus 5.5.</Text>
              <Stack gap="sm" mt="md">
                {ponytail.map(([k, v]) => (
                  <div key={k}>
                    <Group justify="space-between" mb={4}><Text size="sm">{k}</Text><Text size="sm" fw={700}>-{v}%</Text></Group>
                    <Progress value={v} size="md" radius="xl" aria-label={`${k}: ${v}% lower`} />
                  </div>
                ))}
              </Stack>
              <SimpleGrid cols={2} mt="md" spacing="xs">
                <Stat value="97%" label="hidden checks passed (no skill: 96%)" />
                <Stat value="98%" label="risky logic ships with a test (no skill: 68%)" />
              </SimpleGrid>
              <Text size="xs" c="dimmed" mt="md">Source: <Anchor href="https://github.com/DietrichGebert/ponytail/blob/main/benchmarks/README.md">Ponytail benchmarks</Anchor>, 2026-10-07.</Text>
            </Card>
            <Card withBorder padding="lg">
              <Group gap="sm"><ThemeIcon variant="light" size={34}><IconFeather size={18} /></ThemeIcon><Text fw={700}>Ponytail, independent</Text></Group>
              <Text size="sm" c="dimmed" mt="sm">JetBrains, 80 paired SkillsBench tasks, Claude Code on Sonnet 5, medium effort, ponytail v4.8.4.</Text>
              <SimpleGrid cols={2} mt="md" spacing="xs">
                <Stat value="-10.3%" label="cost (p=0.004)" />
                <Stat value="-15%" label="lines of code (median, p=0.088)" />
                <Stat value="-11%" label="time" />
                <Stat value="65 of 80" label="tasks with identical score" />
              </SimpleGrid>
              <Text size="xs" c="dimmed" mt="md">Code fell 31% on large builds and about 0% where the baseline wrote little. Source: <Anchor href="https://blog.jetbrains.com/ai/2026/07/ponytail-skill-claude-tested/">JetBrains AI blog</Anchor>.</Text>
            </Card>
          </SimpleGrid>
        </Section>

        <Section id="not" title="What it is not">
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing={48}>
            <List spacing="lg" styles={listTop}>
              <Check ok={false} title="Not an agent.">It configures Claude Code and Codex and does not install their CLIs.</Check>
              <Check ok={false} title="Not a sandbox.">The agent stays a host process under its client permissions.</Check>
              <Check ok={false} title="Not a hosted service.">Files in a Git repository, no server, no account.</Check>
            </List>
            <List spacing="lg" styles={listTop}>
              <Check ok={false} title="Not a build system or framework.">Your project keeps its own toolchain.</Check>
              <Check ok={false} title="Not auto-updating.">CLI and MCP versions change only when /setting-up-machine proposes a bump and you accept it. Workflow plugin tags change only when /setting-up-projects proposes a bump.</Check>
              <Check ok={false} title="Not autonomous.">Setup applies only the plan you approve and confirms destructive items again. Merges and pushes to the default branch need your instruction.</Check>
            </List>
          </SimpleGrid>
        </Section>

        <Section id="prereq" title="Before you start" intro="Not installed by BenchKeeper.">
          <Table.ScrollContainer minWidth={300} type="native">
            <Table withTableBorder striped highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
              <Table.Thead><Table.Tr><Table.Th>Tool</Table.Th><Table.Th>Needed for</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {facts.prerequisites.map((r) => (
                  <Table.Tr key={r.name}><Table.Td><Anchor href={r.url}>{r.name}</Anchor></Table.Td><Table.Td>{md(r.for)}</Table.Td></Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Section>

        <Section id="start" title="Quick start" intro="Needs the tools in Before you start. Steps that change your machine or repository show their plan first.">
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
            <span className="sr" aria-live="polite" data-copy-status></span>
          </Stack>
        </Section>

        <Section id="tools" title="Recommended tools" intro="Optional, not installed by BenchKeeper.">
          <Text fw={700} mb="xs">Parallel agents: pick one</Text>
          <Text size="sm" c="dimmed" mb="md" maw={760}>Orca, Nimbalyst and cmux each manage several agent sessions side by side. Running two duplicates the sessions and worktrees they track for the same repositories.</Text>
          <SimpleGrid cols={{ base: 1, md: 3 }}>
            {facts.parallelTools.map((t) => (
              <ToolCard key={t.name} icon={toolIcons[t.icon]} name={t.name} href={t.url} platforms={t.platforms} points={t.points} when={t.when} />
            ))}
          </SimpleGrid>
          <Text fw={700} mt={40} mb="xs">Unattended or isolated runs</Text>
          <Card withBorder padding="lg" className="lift linked">
            <Group gap="sm" wrap="nowrap"><ThemeIcon variant="light" color="orange" size={38}><IconServer size={20} /></ThemeIcon><Anchor href="https://github.com/OpenHands/OpenHands" fw={700} className="stretched" underline="hover">OpenHands</Anchor><Badge variant="outline" color="gray">self-hosted, web UI</Badge></Group>
            <Text size="sm" c="dimmed" mt="sm">{facts.openhands.summary}</Text>
            <List size="sm" mt="md" spacing={6}>
              {facts.openhands.points.map((t) => <List.Item key={t}>{md(t)}</List.Item>)}
            </List>
          </Card>
        </Section>

        <Section id="files" title="Files it touches">
          <Table.ScrollContainer minWidth={300} type="native">
            <Table withTableBorder verticalSpacing="sm" horizontalSpacing="md">
              <Table.Thead><Table.Tr><Table.Th>Scope</Table.Th><Table.Th>Files</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                <Table.Tr><Table.Td>Machine</Table.Td><Table.Td><Code>~/.claude/rules/00-global.md</Code> (symlink), <Code>~/.codex/AGENTS.md</Code> (copy), <Code>~/.claude/skills/</Code> and <Code>~/.agents/skills/</Code> (setup skills, find-skills), settings</Table.Td></Table.Tr>
                <Table.Tr><Table.Td>Repository, committed</Table.Td><Table.Td><Code>.devcontainer/</Code>, <Code>AGENTS.md</Code>, <Code>CLAUDE.md</Code>, <Code>.agents/skills/</Code>, <Code>.claude/skills/</Code> (following-dev-workflow, stack skills), <Code>.claude/settings.json</Code> (plugins), <Code>skills-lock.json</Code>, <Code>docs/agents/</Code>, <Code>.mcp.json</Code>, <Code>.codex/config.toml</Code></Table.Td></Table.Tr>
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
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
