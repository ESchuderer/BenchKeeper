import {
  ActionIcon, Alert, Anchor, Badge, Box, Button, Card, Code, Container, Group, List, MantineProvider,
  Paper, Progress, SimpleGrid, Stack, Table, Text, ThemeIcon, Timeline, Title, createTheme,
} from '@mantine/core';
import {
  IconArrowDown, IconArrowRight, IconBrandGithub, IconBrowser, IconCircleCheck,
  IconCircleX, IconContainer, IconFeather, IconFileDescription, IconFileText, IconListCheck, IconMoon,
  IconPackage, IconRoute, IconLayoutKanban, IconServer, IconStack2, IconTerminal2, IconSearch, IconAlertTriangle, IconTestPipe, IconShieldLock, IconGauge, IconAccessible, IconCopy, IconCheck, IconSun,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { sdlcSvg } from '../lib/sdlc';
import facts from '../data/facts.json';

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

function StepList({ from, className }: { from: number; className?: string }) {
  return (
    <Timeline active={10} bulletSize={30} lineWidth={2} className={className}>
      {facts.sdlc.steps.slice(from, from + 5).map((st, i) => (
        <Timeline.Item key={st.name} id={`step-${from + i + 1}`} color={phaseColor[st.phase]} bullet={<Text size="xs" fw={700}>{from + i + 1}</Text>}
          title={<Group gap="xs"><Text fw={700}>{st.name}</Text>{st.human && <Badge size="xs" variant="outline" className="decide">human in the loop</Badge>}</Group>}>
          <Text size="sm" c="dimmed">{md(from + i === 0 ? `${st.text} ${facts.sdlc.requirements}` : st.text)}</Text>
        </Timeline.Item>
      ))}
    </Timeline>
  );
}


const checks: [ReactNode, string, ReactNode][] = [
  [<IconTestPipe size={18} />, 'Tests', <>Tests first where a suite exists; Verify runs build, types, lint and tests; checks are never weakened.</>],
  [<IconShieldLock size={18} />, 'Security', <><Code>security-and-hardening</Code> for input, auth, data and dependencies; secrets are never printed or committed; Maintain audits dependencies.</>],
  [<IconGauge size={18} />, 'Performance', <><Code>performance-optimization</Code> when performance requirements exist; <Code>ponytail-audit</Code> flags slow paths and what breaks under load.</>],
  [<IconAccessible size={18} />, 'UI and accessibility', <>UI changes are checked in a real browser through Playwright MCP; <Code>frontend-ui-engineering</Code> covers WCAG when building interfaces.</>],
];

const quickstart: [string, string, string][] = [
  ['Clone BenchKeeper and open it in your agent', 'git clone https://github.com/ESchuderer/BenchKeeper.git && cd BenchKeeper && claude', 'Codex: run codex instead of claude.'],
  ['Set up the machine', '/global-setup', 'Codex: $global-setup. Pick your agents, review the plan, approve.'],
  ['Restart the agents', '', 'Codex: run /hooks and trust the plugin hooks.'],
  ['Set up each repository', '/project-setup', 'Codex: $project-setup. Run it in the repository root, then commit the result.'],
];

const listTop = { root: { paddingInlineStart: 0 }, itemWrapper: { alignItems: 'flex-start' }, itemIcon: { marginTop: 1 } };

const ponytail: [string, number][] = [['Lines of code', 53], ['Output tokens', 45], ['Time', 41], ['Cost', 26]];

export default function Page({ base, updated, commit }: { base: string; updated?: string; commit?: string }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <a className="skip" href="#main">Skip to content</a>
      <Box component="header" className="header">
        <Container size="lg" h={60}>
          <Group h="100%" justify="space-between" wrap="nowrap">
            <Anchor href="#main" underline="never" c="var(--mantine-color-text)">
              <Group gap={10} wrap="nowrap">
                <img src={`${base}/logo.svg`} alt="" width={28} height={28} className="logo" />
                <Text fw={800} size="lg">BenchKeeper</Text>
              </Group>
            </Anchor>
            <Group component="nav" aria-label="Sections" gap="lg" visibleFrom="md">
              {[['what', 'What it is'], ['sdlc', 'SDLC'], ['parts', 'Parts'], ['quality', 'Quality'], ['cost', 'Cost'], ['not', 'What it is not'], ['tools', 'Tools'], ['prereq', 'Setup']].map(([id, l]) => (
                <Anchor key={id} href={`#${id}`} c="dimmed" size="sm" underline="never">{l}</Anchor>
              ))}
            </Group>
            <Group gap="xs" wrap="nowrap">
              <Button component="a" href={REPO} variant="default" size="xs" leftSection={<IconBrandGithub size={16} />} visibleFrom="sm">GitHub</Button>
              <ActionIcon component="a" href={REPO} variant="default" size={30} aria-label="GitHub" hiddenFrom="sm"><IconBrandGithub size={16} /></ActionIcon>
              <ActionIcon data-theme-toggle variant="default" size={30} aria-label="Toggle light and dark theme">
                <IconMoon size={16} className="icon-moon" />
                <IconSun size={16} className="icon-sun" />
              </ActionIcon>
            </Group>
          </Group>
        </Container>
      </Box>

      <main id="main" tabIndex={-1}>
        <Box className="hero" py={{ base: 64, md: 112 }}>
          <Container size="lg">
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing={48} style={{ alignItems: 'center' }}>
              <Stack gap="lg">
                <Badge variant="light" size="lg" w="fit-content" h="auto" py={4} styles={{ label: { whiteSpace: 'normal' } }}>Opinionated setup for Claude Code and Codex</Badge>
                <Title order={1} fz={{ base: 44, md: 68 }} lh={1.02} style={{ letterSpacing: '-0.03em' }}>
                  <span className="grad">BenchKeeper</span>
                </Title>
                <Text size="xl" maw={560}>{facts.description}</Text>
                <Group mt="sm">
                  <Button component="a" href="#prereq" size="md">Get started</Button>
                  <Button component="a" href="#sdlc" size="md" variant="default">See the SDLC</Button>
                </Group>
              </Stack>
              <Box ta="center">
                <img src={`${base}/logo.svg`} alt="BenchKeeper logo: a brain inside a gear, circled by a loop of arrows" className="logo" width={300} height={300} style={{ width: 'min(300px, 64vw)', height: 'auto' }} />
              </Box>
            </SimpleGrid>
          </Container>
        </Box>

        <Section id="what" title="What it is" intro={<>A Git repository with one rules file and four skills. The setup skills install, check and clean the tools each agent uses; the workflow skill holds the SDLC. Claude Code and Codex are independently optional: setup detects installed agents and configures only the ones you select.<br /><br />It is opinionated: one SDLC sized to each change, one tool per job, exact versions everywhere. To change a choice, edit <Code>rules/global.md</Code> or the skills and rerun <Code>/global-setup</Code>.</>}>
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
            <FeatureCard icon={<IconFileText size={20} />} title={<Code fz="sm">rules/global.md</Code>} scope="Global, both agents">
              What applies in every session: ask instead of assuming, sources for claims, scope, safety, devcontainer use, and when to load the SDLC skill.
            </FeatureCard>
            <FeatureCard icon={<IconPackage size={20} />} title={<Code fz="sm">/global-setup</Code>} scope="Once per machine">
              Checks 10 parts plus one optional part without changing anything, then shows one plan: installs, changes, removals and version bumps. Applies only what you approve.
            </FeatureCard>
            <FeatureCard icon={<IconRoute size={20} />} title={<Code fz="sm">/project-setup</Code>} scope="Once per repository">
              Devcontainer, <Code>AGENTS.md</Code>, stack skills, spec tool, dead config. Shows one plan first and applies only what you approve.
            </FeatureCard>
            <FeatureCard icon={<IconListCheck size={20} />} title={<Code fz="sm">sdlc</Code>} scope="Before repository work, both agents">
              Task tier and its steps: issue, branch, tests first, spec, review before push, draft pull request. Loaded on demand, so it costs context only when used.
            </FeatureCard>
            <FeatureCard icon={<IconShieldLock size={20} />} title={<Code fz="sm">Permission rules</Code>} scope="Global, Claude Code">
              Ask before pushes to main, skipping git hooks, branch deletion, rebases, history rewrites, force pushes and hard resets: what the auto-mode classifier does not already block, plus a backup for the most destructive. Native rules, no hooks.
            </FeatureCard>
          </SimpleGrid>
        </Section>

        <Section id="sdlc" title="One loop, sized to the change" intro="A full agentic SDLC (issue, spec, plan, tests first, review) fits features and risky changes, not every change. The sdlc skill sizes each request by tier and change type first, so small changes spend fewer tokens and less time; that saving is not measured yet. Quick changes skip the issue, spec, plan and pre-push review; standard changes skip the spec and keep the plan to a few lines; full changes run all ten steps; research with several items fans out to parallel subagents without edits. Each change type adds its own check before done, such as terraform plan for infrastructure or a reproducer test for a bug. agent-skills supplies the skill for each phase, Ponytail keeps the implementation small, and OpenSpec holds the spec files when the repository uses one.">
          <div className="ring-wrap">
            <div dangerouslySetInnerHTML={{ __html: sdlcSvg }} />
            <div className="ring-tip" role="tooltip" hidden></div>
          </div>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={40} verticalSpacing="xl" mt={40}>
            <StepList from={0} className="steps-first" />
            <StepList from={5} />
          </SimpleGrid>
          <Text fw={700} mt={48} mb="xs">Checks built into the loop</Text>
          <Text size="sm" c="dimmed" mb="md" maw={760}>The matching agent-skills skill loads by its description in any phase where a change needs it.</Text>
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
                {['Claude Code or Codex, sign-in and permissions', 'Global rules and skills: agent-skills, Ponytail, global-setup, project-setup', 'OpenSpec CLI', 'Git and gh: branches, commits, pull requests', 'Dev Containers CLI and Docker'].map((t) => (
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
            <Text size="sm">The agent runs on the host with its client permissions; the devcontainer only scopes project commands. Options for stronger isolation, not part of BenchKeeper:</Text>
            <List size="sm" mt="xs" spacing={4}>
              <List.Item><b>Shared VM</b>: agents and all projects in one VM; protects the host, not projects from each other.</List.Item>
              <List.Item><b>VM per project</b>: projects isolated from each other.</List.Item>
              <List.Item><b>VM per branch or worktree</b>: parallel agent runs isolated from each other; one VM per run.</List.Item>
              <List.Item><b>MicroVMs</b> (<Anchor href="https://firecracker-microvm.github.io/">Firecracker</Anchor>, <Anchor href="https://katacontainers.io/">Kata Containers</Anchor>): lightweight VMs per project or task.</List.Item>
              <List.Item><b>Rootless engine</b> (<Anchor href="https://docs.docker.com/engine/security/rootless/">rootless Docker</Anchor>, <Anchor href="https://podman.io/">Podman</Anchor>): container root is not host root; the agent still runs on the host.</List.Item>
            </List>
          </Alert>
        </Section>

        <Section id="parts" title="What each part gives you" intro="Each component is a separate upstream project. BenchKeeper pins it to an exact version, configures it for the selected agents, and ties it into the rules and the SDLC loop.">
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
            <FeatureCard icon={<IconListCheck size={20} />} title="agent-skills" href="https://github.com/addyosmani/agent-skills" scope="Global, both agents"
              gives="The agent follows engineering steps sized to the change: spec before code for full changes, tests first, review before merge.">
              Skills for spec, planning, TDD, debugging, code review, security, performance and shipping; the agent loads the one that fits each phase.
            </FeatureCard>
            <FeatureCard icon={<IconFeather size={20} />} title="Ponytail" href="https://github.com/DietrichGebert/ponytail" scope="Global, both agents"
              gives="Less code to review and maintain. Its benchmark: 53% fewer lines, 26% lower cost. JetBrains measured 15% fewer lines, 10% lower cost.">
              Rules for the smallest complete change: reuse before new code, no unrequested options, a test for non-trivial logic, <Code>shortcut:</Code> comments for known limits, plus audit and debt reports.
            </FeatureCard>
            <FeatureCard icon={<IconFileDescription size={20} />} title="OpenSpec" href="https://github.com/Fission-AI/OpenSpec" scope="CLI global, wired per repository"
              gives="Requirements live in the repository and are reviewed in the same pull request as the code; the next session reads them instead of guessing.">
              One change folder per change (proposal, spec deltas, tasks), merged into living specs on archive.
            </FeatureCard>
            <FeatureCard icon={<IconBrowser size={20} />} title="Playwright MCP" href="https://github.com/microsoft/playwright-mcp" scope="Per repository, browser in the container"
              gives="UI changes are checked in a real browser before the agent reports them done.">
              Browser control over MCP: open pages, click, fill forms, read console and network, take screenshots.
            </FeatureCard>
            <FeatureCard icon={<IconContainer size={20} />} title="Dev Containers" href="https://code.visualstudio.com/docs/devcontainers/devcontainer-cli" scope="CLI on host, config per repository"
              gives="The same toolchain on every machine and client; installs, builds and tests run as a non-root user and do not touch the host.">
              A standard <Code>devcontainer.json</Code> per repository, shared by the CLI, VS Code and Orca terminals; project commands run through <Code>devcontainer exec</Code>.
            </FeatureCard>
            <FeatureCard icon={<IconSearch size={20} />} title="Stack skills" scope="Per repository"
              gives="Framework-specific knowledge where agent-skills is generic.">
              <Anchor href="https://github.com/vercel-labs/skills">find-skills</Anchor> picks at most two vetted skills per technology.
            </FeatureCard>
          </SimpleGrid>
        </Section>

        <Section id="quality" title="How it raises quality" intro={<>Each item is a rule from <Anchor href={`${REPO}/blob/main/rules/global.md`}>rules/global.md</Anchor> (every session), the <Anchor href={`${REPO}/blob/main/skills/sdlc/SKILL.md`}>sdlc skill</Anchor> (before repository work) or the <Anchor href={`${REPO}/blob/main/skills/global-setup/SKILL.md`}>permission rules</Anchor>.</>}>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing={48}>
            <List spacing="lg" styles={listTop}>
              <Check ok title="Ask, do not assume.">Ambiguous requests stop for precise questions instead of a guess.</Check>
              <Check ok title="Spec before code.">Non-trivial changes get a written spec and a task list.</Check>
              <Check ok title="Tests first">where the repository has a test suite; non-trivial logic leaves a test.</Check>
              <Check ok title="Checks are never weakened.">No skipped tests, loosened assertions, disabled lint rules or --no-verify unless you ask; Claude Code asks before --no-verify.</Check>
            </List>
            <List spacing="lg" styles={listTop}>
              <Check ok title="Review before push.">A correctness review runs on the commits; findings wait for your decision.</Check>
              <Check ok title="Sources and confidence.">External claims carry an official URL; uncertain topics state a confidence level.</Check>
              <Check ok title="Reproducible tools.">Exact versions for every install and container image.</Check>
              <Check ok title="Cleanup on request.">The Maintain pass (/maintain) finds dead code, stale shortcuts, vulnerable dependencies, docs drift and unused skills.</Check>
            </List>
          </SimpleGrid>
        </Section>

        <Section id="cost" title="Cost and quality" intro={<>Ponytail has several independent measurements: fewer lines of code in all of them, cost -10.3% in JetBrains' test and between +0.7% and +53% in other setups (different injection methods and models); BenchKeeper's own paired test is planned. The checks before done and the spec in the repository aim at fewer rounds of fixes; that is not measured. Vendor figures are not measurements of your repositories. Every component evaluated, what is in and what is not: <Anchor href={`${REPO}/blob/main/EVALUATIONS.md`}>EVALUATIONS.md</Anchor>.</>}>
          <SimpleGrid cols={{ base: 1, md: 2 }}>
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
          <SimpleGrid cols={{ base: 1, md: 2 }} mt="md">
            <Card withBorder padding="lg">
              <Group gap="sm"><ThemeIcon variant="light" size={34}><IconListCheck size={18} /></ThemeIcon><Text fw={700}>Fewer rounds, unmeasured</Text></Group>
              <List size="sm" mt="sm" spacing={6}>
                <List.Item>Build, types, lint and tests run before the agent reports done; UI changes are checked in a browser.</List.Item>
                <List.Item>Commits are reviewed for correctness bugs before push.</List.Item>
                <List.Item>Spec and tasks live in the repository; the next session reads them instead of asking again.</List.Item>
                <List.Item>Curated skills raised pass rate by 16.6 points on <Anchor href="https://arxiv.org/abs/2602.12670">SkillsBench</Anchor>; not measured for agent-skills.</List.Item>
              </List>
            </Card>
            <Card withBorder padding="lg">
              <Group gap="sm"><ThemeIcon variant="light" size={34}><IconContainer size={18} /></ThemeIcon><Text fw={700}>Reproducible</Text></Group>
              <List size="sm" mt="sm" spacing={6}>
                <List.Item>Every install command pins an exact version.</List.Item>
                <List.Item>Project commands run in the same devcontainer from Claude Code, Codex, VS Code and Orca.</List.Item>
                <List.Item>One repository rebuilds a machine with <Code>/global-setup</Code>; a fresh clone restores its skills with <Code>/project-setup</Code>.</List.Item>
              </List>
            </Card>
          </SimpleGrid>
        </Section>

        <Section id="not" title="What it is not">
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing={48}>
            <List spacing="lg" styles={listTop}>
              <Check ok={false} title="Not an agent.">It configures Claude Code and Codex; it does not replace them and does not install their CLIs.</Check>
              <Check ok={false} title="Not a sandbox for the agent.">The devcontainer scopes project commands and mounts; the agent stays a host process under its client permissions.</Check>
              <Check ok={false} title="Not a hosted service.">BenchKeeper is files in a Git repository; it runs no server and has no account.</Check>
            </List>
            <List spacing="lg" styles={listTop}>
              <Check ok={false} title="Not a build system or framework.">Your project keeps its own toolchain.</Check>
              <Check ok={false} title="Not auto-updating.">Versions change only when /global-setup proposes a bump and you accept it.</Check>
              <Check ok={false} title="Not autonomous on your machine or repository.">Setup applies only the plan you approve and confirms destructive items again; merges and pushes to the default branch need your instruction.</Check>
            </List>
          </SimpleGrid>
        </Section>

        <Section id="tools" title="Recommended tools" intro="Optional, not installed by BenchKeeper. Each one works with the agents and rules set up here.">
          <Text fw={700} mb="xs">Parallel agents: pick one</Text>
          <Text size="sm" c="dimmed" mb="md" maw={760}>Orca, Nimbalyst and cmux all manage several agent sessions side by side. Running more than one duplicates that layer: each would track its own sessions and worktrees for the same repositories.</Text>
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

        <Section id="prereq" title="Before you start" intro="BenchKeeper does not install these. Use each official page.">
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

        <Section id="start" title="Quick start" intro="After the prerequisites. Each step that changes your machine or repository shows its plan first.">
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

        <Section id="files" title="Files it touches">
          <Table.ScrollContainer minWidth={300} type="native">
            <Table withTableBorder verticalSpacing="sm" horizontalSpacing="md">
              <Table.Thead><Table.Tr><Table.Th>Scope</Table.Th><Table.Th>Files</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                <Table.Tr><Table.Td>Machine</Table.Td><Table.Td><Code>~/.claude/rules/00-global.md</Code> (symlink), <Code>~/.codex/AGENTS.md</Code> (copy), <Code>~/.claude/skills/</Code>, <Code>~/.agents/skills/</Code>, agent plugins and settings</Table.Td></Table.Tr>
                <Table.Tr><Table.Td>Repository, committed</Table.Td><Table.Td><Code>.devcontainer/</Code>, <Code>AGENTS.md</Code>, <Code>CLAUDE.md</Code>, <Code>.agents/skills/</Code>, <Code>.claude/skills/</Code>, <Code>skills-lock.json</Code>, <Code>openspec/</Code>, <Code>.mcp.json</Code>, <Code>.codex/config.toml</Code></Table.Td></Table.Tr>
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
