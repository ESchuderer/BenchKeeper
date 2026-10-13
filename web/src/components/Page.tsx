import {
  ActionIcon, Alert, Anchor, Badge, Box, Button, Card, Code, Container, Group, List, MantineProvider,
  Paper, Progress, SimpleGrid, Stack, Table, Text, ThemeIcon, Timeline, Title, createTheme,
} from '@mantine/core';
import {
  IconArrowDown, IconArrowRight, IconBook, IconBox, IconBrandGithub, IconBrowser, IconCircleCheck,
  IconCircleX, IconContainer, IconFeather, IconFileDescription, IconFileText, IconListCheck, IconMoon,
  IconPackage, IconRoute, IconLayoutKanban, IconServer, IconStack2, IconTerminal2, IconSearch, IconShieldHalf, IconSun, IconTopologyStar3, IconArrowsMinimize,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import sdlc from '../assets/sdlc.svg?raw';

const theme = createTheme({
  primaryColor: 'teal',
  fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  headings: { fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontWeight: '800' },
  defaultRadius: 'md',
});

const REPO = 'https://github.com/ESchuderer/BenchKeeper';
const DESCRIPTION =
  "BenchKeeper keeps your AI coding agents' workbench in order: Claude Code or Codex runs its skills to install and check rules, skills and tools at pinned versions, machine-wide and per repository.";

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

function FeatureCard({ icon, title, scope, gives, children }: { icon: ReactNode; title: ReactNode; scope: string; gives?: string; children: ReactNode }) {
  return (
    <Card withBorder padding="lg" className="lift">
      <Group gap="sm" wrap="nowrap">
        <ThemeIcon variant="light" size={38} radius="md">{icon}</ThemeIcon>
        <Text fw={700}>{title}</Text>
      </Group>
      <Text size="xs" fw={700} tt="uppercase" c="dimmed" mt="md">{scope}</Text>
      <Text size="sm" mt={6}>{children}</Text>
      {gives && (
        <Text size="sm" mt="auto" pt="md"><Text span fw={700} c="teal">What you get </Text>{gives}</Text>
      )}
    </Card>
  );
}

function ToolCard({ icon, name, href, platforms, points, when }: { icon: ReactNode; name: string; href: string; platforms: string; points: ReactNode[]; when: string }) {
  return (
    <Card withBorder padding="lg" className="lift">
      <Group gap="sm" wrap="nowrap"><ThemeIcon variant="light" size={38}>{icon}</ThemeIcon><Anchor href={href} fw={700}>{name}</Anchor></Group>
      <Badge variant="outline" color="gray" mt="sm" w="fit-content">{platforms}</Badge>
      <List size="sm" mt="md" spacing={6}>{points.map((t, k) => <List.Item key={k}>{t}</List.Item>)}</List>
      <Text size="sm" mt="auto" pt="md"><Text span fw={700}>Choose it when</Text> {when}</Text>
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

const steps: [string, ReactNode][] = [
  ['Understand', <>Read <Code>AGENTS.md</Code>, the issue and the code the change touches before any edit.</>],
  ['Track', 'No issue yet: the agent presents title, goal, acceptance criteria and tasks, and creates the issue after approval.'],
  ['Branch', <><Code>{'<type>/<issue>-<slug>'}</Code>, never work on the default branch without being told to.</>],
  ['Specify', <><Code>spec-driven-development</Code>, written as an OpenSpec change or a Spec Kit feature spec when the repository has one.</>],
  ['Plan', <><Code>planning-and-task-breakdown</Code> into small tasks with acceptance criteria.</>],
  ['Build', <><Code>incremental-implementation</Code>, tests first where a test suite exists, Ponytail <Code>full</Code> for the smallest complete change.</>],
  ['Verify', 'Build, types, lint and tests inside the devcontainer; UI changes in a browser through Playwright MCP.'],
  ['Review', <>Correctness review of the commits before <Code>git push</Code>; findings stop the push until you decide.</>],
  ['Ship', <>Draft pull request with <Code>Closes #n</Code>, wait for checks, mark ready. Merge only on your instruction.</>],
  ['Maintain', <>About every 10 merged changes: <Code>ponytail-audit</Code>, <Code>ponytail-debt</Code>, dependency audit, docs drift, repository hygiene.</>],
];

function StepList({ from }: { from: number }) {
  return (
    <Timeline active={10} bulletSize={30} lineWidth={2}>
      {steps.slice(from, from + 5).map(([t, d], i) => (
        <Timeline.Item key={t} bullet={<Text size="xs" fw={700}>{from + i + 1}</Text>} title={<Text fw={700}>{t}</Text>}>
          <Text size="sm" c="dimmed">{d}</Text>
        </Timeline.Item>
      ))}
    </Timeline>
  );
}

const prereqs: [string, string, string][] = [
  ['Claude Code', 'https://code.claude.com/docs/en/setup', 'agent (one or both)'],
  ['Codex CLI', 'https://developers.openai.com/codex/cli', 'agent (one or both)'],
  ['Git', 'https://git-scm.com/downloads', 'clone, branches, commits'],
  ['GitHub CLI', 'https://cli.github.com/', 'issues and pull requests (optional, local branches without it)'],
  ['Node.js and npm', 'https://nodejs.org/en/download', 'global CLIs, prefix ~/.local'],
  ['uv', 'https://docs.astral.sh/uv/getting-started/installation/', 'Spec Kit'],
  ['jq', 'https://jqlang.org/download/', 'setup scripts'],
  ['curl', 'https://curl.se/download.html', 'setup scripts'],
  ['Docker Engine', 'https://docs.docker.com/engine/install/', 'devcontainers'],
  ['VS Code', 'https://code.visualstudio.com/download', 'optional, attach to the devcontainer'],
  ['Orca', 'https://onorca.dev', 'optional, parallel agents'],
];

const listTop = { root: { paddingInlineStart: 0 }, itemWrapper: { alignItems: 'flex-start' }, itemIcon: { marginTop: 1 } };

const ponytail: [string, number][] = [['Lines of code', 53], ['Output tokens', 45], ['Time', 41], ['Cost', 26]];

export default function Page({ base }: { base: string }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Box component="header" className="header">
        <Container size="lg" h={60}>
          <Group h="100%" justify="space-between" wrap="nowrap">
            <Anchor href="#top" underline="never" c="var(--mantine-color-text)">
              <Group gap={10} wrap="nowrap">
                <img src={`${base}/logo.svg`} alt="" width={28} height={28} className="logo" />
                <Text fw={800} size="lg">BenchKeeper</Text>
              </Group>
            </Anchor>
            <Group gap="lg" visibleFrom="md">
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

      <main id="top">
        <Box className="hero" py={{ base: 64, md: 112 }}>
          <Container size="lg">
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing={48} style={{ alignItems: 'center' }}>
              <Stack gap="lg">
                <Badge variant="light" size="lg" w="fit-content">Claude Code and Codex</Badge>
                <Title order={1} fz={{ base: 44, md: 68 }} lh={1.02} style={{ letterSpacing: '-0.03em' }}>
                  <Text inherit component="span" variant="gradient" gradient={{ from: 'teal.5', to: 'cyan.6', deg: 90 }}>BenchKeeper</Text>
                </Title>
                <Text size="xl" maw={560}>{DESCRIPTION}</Text>
                <Group mt="sm">
                  <Button component="a" href="#prereq" size="md">Get started</Button>
                  <Button component="a" href="#sdlc" size="md" variant="default">See the SDLC</Button>
                </Group>
              </Stack>
              <Box ta="center">
                <img src={`${base}/logo.svg`} alt="BenchKeeper logo: a brain inside a gear, circled by a loop of arrows" className="logo" style={{ width: 'min(300px, 64vw)' }} />
              </Box>
            </SimpleGrid>
          </Container>
        </Box>

        <Section id="what" title="What it is" intro="A Git repository with one rules file and two skills. The skills install, check and clean the tools each agent uses. Claude Code and Codex are independently optional: setup detects installed agents and configures only the ones you select.">
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
            <FeatureCard icon={<IconFileText size={20} />} title={<Code fz="sm">rules/global.md</Code>} scope="Global, both agents">
              How agents work in every repository: ask instead of assuming, sources for claims, issue to pull request flow, SDLC phases, safety, devcontainer use.
            </FeatureCard>
            <FeatureCard icon={<IconPackage size={20} />} title={<Code fz="sm">/global-setup</Code>} scope="Once per machine">
              Checks 11 parts plus one optional part without changing anything, then shows one plan: installs, changes, removals and version bumps. Applies only what you approve.
            </FeatureCard>
            <FeatureCard icon={<IconRoute size={20} />} title={<Code fz="sm">/project-setup</Code>} scope="Once per repository">
              Devcontainer, <Code>AGENTS.md</Code>, stack skills, language servers, spec tool, codegraph, dead config. Shows one plan first and applies only what you approve.
            </FeatureCard>
          </SimpleGrid>
        </Section>

        <Section id="sdlc" title="One loop for every change" intro="The global rules route each change through the same ten steps. agent-skills supplies the skill for each phase, Ponytail keeps the implementation small, and OpenSpec or Spec Kit holds the spec files when the repository uses one.">
          <div dangerouslySetInnerHTML={{ __html: sdlc }} />
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={40} mt={40}>
            <StepList from={0} />
            <StepList from={5} />
          </SimpleGrid>
        </Section>

        <Section id="where" title="Where things run" intro="The agent and its configuration stay on the host. Project commands run in the repository's standard devcontainer, which mounts only the project.">
          <Box className="split">
            <Paper withBorder p="lg" radius="lg" style={{ borderColor: 'var(--mantine-color-teal-6)', borderWidth: 2 }}>
              <Group gap="xs" mb="md"><Badge variant="light">Host</Badge><Text fw={700}>one per machine</Text></Group>
              <Stack gap={8}>
                {['Claude Code or Codex, sign-in and permissions', 'Global rules and skills: agent-skills, Ponytail, global-setup, project-setup', 'RTK, Context7 MCP, OpenSpec and Spec Kit CLIs', 'Git and gh: branches, commits, pull requests', 'Dev Containers CLI and Docker'].map((t) => (
                  <Paper key={t} bg="var(--mantine-color-default-hover)" px="sm" py={8}><Text size="sm">{t}</Text></Paper>
                ))}
              </Stack>
            </Paper>
            <Stack align="center" justify="center" gap={6}>
              <ThemeIcon variant="light" size={44} radius="xl" visibleFrom="md"><IconArrowRight size={22} /></ThemeIcon>
              <ThemeIcon variant="light" size={44} radius="xl" hiddenFrom="md"><IconArrowDown size={22} /></ThemeIcon>
              <Code>devcontainer exec</Code>
            </Stack>
            <Paper withBorder p="lg" radius="lg" style={{ borderColor: 'var(--mantine-color-orange-6)', borderWidth: 2 }}>
              <Group gap="xs" mb="md"><Badge variant="light" color="orange">Devcontainer</Badge><Text fw={700}>one per repository</Text></Group>
              <Stack gap={8}>
                {['Project toolchain at pinned versions', 'Installs, builds, lint, tests', 'codegraph index and MCP server', 'Playwright browser, language servers', 'Non-root user, project mount only, no host home, no engine socket, no credential forwarding'].map((t) => (
                  <Paper key={t} bg="var(--mantine-color-default-hover)" px="sm" py={8}><Text size="sm">{t}</Text></Paper>
                ))}
              </Stack>
            </Paper>
          </Box>
          <Alert mt="xl" variant="default" icon={<IconShieldHalf size={20} />} title="Not full isolation">
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
            <FeatureCard icon={<IconListCheck size={20} />} title={<Anchor href="https://github.com/addyosmani/agent-skills">agent-skills</Anchor>} scope="Global, both agents"
              gives="The agent follows the same engineering steps every time: spec before code, tests first, review before merge.">
              Skills for spec, planning, TDD, debugging, code review, security, performance and shipping; the agent loads the one that fits each phase.
            </FeatureCard>
            <FeatureCard icon={<IconFeather size={20} />} title={<Anchor href="https://github.com/DietrichGebert/ponytail">Ponytail</Anchor>} scope="Global, both agents"
              gives="Less code to review and maintain. Its benchmark: 53% fewer lines, 26% lower cost.">
              Rules for the smallest complete change: reuse before new code, no unrequested options, a test for non-trivial logic, <Code>shortcut:</Code> comments for known limits, plus audit and debt reports.
            </FeatureCard>
            <FeatureCard icon={<IconFileDescription size={20} />} title={<><Anchor href="https://github.com/Fission-AI/OpenSpec">OpenSpec</Anchor> or <Anchor href="https://github.com/github/spec-kit">Spec Kit</Anchor></>} scope="CLI global, chosen per repository"
              gives="Requirements live in the repository and are reviewed in the same pull request as the code; the next session reads them instead of guessing.">
              OpenSpec: one change folder per change (proposal, spec deltas, tasks), merged into living specs on archive. Spec Kit: one folder per feature (spec, plan, tasks) plus a constitution.
            </FeatureCard>
            <FeatureCard icon={<IconTopologyStar3 size={20} />} title={<Anchor href="https://github.com/colbymchenry/codegraph">codegraph</Anchor>} scope="Per repository, in the container"
              gives="Callers and change impact in one query instead of many file searches. Its benchmark: 88% fewer tool calls, 62% fewer tokens.">
              Indexes the repository into a local graph of symbols, calls and imports, updated as files change, and answers queries over MCP.
            </FeatureCard>
            <FeatureCard icon={<IconArrowsMinimize size={20} />} title={<Anchor href="https://github.com/rtk-ai/rtk">RTK</Anchor>} scope="Global, both agents"
              gives="Less context spent on noise. Its figure: 60 to 90% fewer tokens on common dev commands.">
              Hooks shell commands and condenses their output (test runners, builds, linters, git) before the agent reads it.
            </FeatureCard>
            <FeatureCard icon={<IconBook size={20} />} title={<Anchor href="https://github.com/upstash/context7">Context7 MCP</Anchor>} scope="Global, both agents"
              gives="Code follows the documented API of the version you use, not what the model remembers.">
              Returns current, version-specific library and framework documentation on request.
            </FeatureCard>
            <FeatureCard icon={<IconBrowser size={20} />} title={<Anchor href="https://github.com/microsoft/playwright-mcp">Playwright MCP</Anchor>} scope="Per repository, browser in the container"
              gives="UI changes are checked in a real browser before the agent reports them done.">
              Browser control over MCP: open pages, click, fill forms, read console and network, take screenshots.
            </FeatureCard>
            <FeatureCard icon={<IconContainer size={20} />} title={<Anchor href="https://code.visualstudio.com/docs/devcontainers/devcontainer-cli">Dev Containers</Anchor>} scope="CLI on host, config per repository"
              gives="The same toolchain on every machine and client; installs, builds and tests run as a non-root user and do not touch the host.">
              A standard <Code>devcontainer.json</Code> per repository, shared by the CLI, VS Code and Orca terminals; project commands run through <Code>devcontainer exec</Code>.
            </FeatureCard>
            <FeatureCard icon={<IconSearch size={20} />} title="Stack skills and LSP" scope="Per repository"
              gives="Framework-specific knowledge where agent-skills is generic, and diagnostics after each edit.">
              <Anchor href="https://github.com/vercel-labs/skills">find-skills</Anchor> picks at most two vetted skills per technology; language server plugins connect to servers inside the container.
            </FeatureCard>
          </SimpleGrid>
        </Section>

        <Section id="quality" title="How it raises quality" intro={<>Each item is a rule the agents load in every session. Source: <Anchor href={`${REPO}/blob/main/rules/global.md`}>rules/global.md</Anchor>.</>}>
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <Card withBorder padding="lg"><List spacing="md" styles={listTop}>
              <Check ok title="Ask, do not assume.">Ambiguous requests stop for precise questions instead of a guess.</Check>
              <Check ok title="Spec before code.">Non-trivial changes get a written spec and a task list.</Check>
              <Check ok title="Tests first">where the repository has a test suite; non-trivial logic leaves a test.</Check>
              <Check ok title="Checks are never weakened.">No skipped tests, loosened assertions, disabled lint rules or --no-verify unless you ask.</Check>
            </List></Card>
            <Card withBorder padding="lg"><List spacing="md" styles={listTop}>
              <Check ok title="Review before push.">A correctness review runs on the commits; findings wait for your decision.</Check>
              <Check ok title="Sources and confidence.">External claims carry an official URL; uncertain topics state a confidence level.</Check>
              <Check ok title="Reproducible tools.">Exact versions for every install and container image.</Check>
              <Check ok title="Scheduled cleanup.">The Maintain pass finds dead code, stale shortcuts, vulnerable dependencies and docs drift.</Check>
            </List></Card>
          </SimpleGrid>
        </Section>

        <Section id="cost" title="How it reduces cost" intro="Fewer tokens per task come from three components. The figures are each project's published benchmark, not measurements of your repositories.">
          <SimpleGrid cols={{ base: 1, md: 3 }}>
            <Card withBorder padding="lg">
              <Group gap="sm"><ThemeIcon variant="light" size={34}><IconFeather size={18} /></ThemeIcon><Text fw={700}>Ponytail</Text></Group>
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
              <Group gap="sm"><ThemeIcon variant="light" size={34}><IconTopologyStar3 size={18} /></ThemeIcon><Text fw={700}>codegraph</Text></Group>
              <Text size="sm" c="dimmed" mt="sm">Average across 7 repositories, median of 4 runs.</Text>
              <SimpleGrid cols={2} mt="md" spacing="xs">
                <Stat value="88%" label="fewer tool calls" />
                <Stat value="62%" label="fewer tokens" />
                <Stat value="44%" label="cheaper" />
                <Stat value="53%" label="faster" />
              </SimpleGrid>
              <Text size="xs" c="dimmed" mt="md">Token reduction ranges from 41% (Django) to 84% (Excalidraw). Responses leave about 80% more retrieval context resident at session end. Source: <Anchor href="https://github.com/colbymchenry/codegraph">codegraph README</Anchor>.</Text>
            </Card>
            <Card withBorder padding="lg">
              <Group gap="sm"><ThemeIcon variant="light" size={34}><IconArrowsMinimize size={18} /></ThemeIcon><Text fw={700}>RTK</Text></Group>
              <Text size="sm" c="dimmed" mt="sm">Reduction of command output the agent reads.</Text>
              <SimpleGrid cols={2} mt="md" spacing="xs">
                <Stat value="60-90%" label="fewer tokens on common dev commands" />
                <Stat value="~90%" label="test runners (pytest, cargo, Go)" />
                <Stat value="~80%" label="cargo build, ruff check" />
                <Stat value="~85%" label="golangci-lint" />
              </SimpleGrid>
              <Text size="xs" c="dimmed" mt="md">Output reduction, not total bill. Source: <Anchor href="https://github.com/rtk-ai/rtk">RTK README</Anchor>.</Text>
            </Card>
          </SimpleGrid>
          <Card withBorder padding="lg" mt="md">
            <Text fw={700}>Cost the setup avoids</Text>
            <List size="sm" mt="xs" spacing={4}>
              <List.Item>Optional parts are skipped where they do not apply: no spec tool for config and docs repositories, no codegraph below about 50 source files.</List.Item>
              <List.Item>Telemetry is off for Codex, RTK, OpenSpec and codegraph; Claude Code error reporting and feedback surveys are off.</List.Item>
              <List.Item>A new machine is rebuilt from one repository with <Code>/global-setup</Code>; a fresh clone restores its skills with <Code>/project-setup</Code>.</List.Item>
            </List>
          </Card>
        </Section>

        <Section id="not" title="What it is not">
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <Card withBorder padding="lg"><List spacing="md" styles={listTop}>
              <Check ok={false} title="Not an agent.">It configures Claude Code and Codex; it does not replace them and does not install their CLIs.</Check>
              <Check ok={false} title="Not a sandbox for the agent.">The devcontainer scopes project commands and mounts; the agent stays a host process under its client permissions.</Check>
              <Check ok={false} title="Not a hosted service.">BenchKeeper is files in a Git repository; it runs no server and has no account.</Check>
            </List></Card>
            <Card withBorder padding="lg"><List spacing="md" styles={listTop}>
              <Check ok={false} title="Not a build system or framework.">Your project keeps its own toolchain.</Check>
              <Check ok={false} title="Not auto-updating.">Versions change only when /global-setup proposes a bump and you accept it.</Check>
              <Check ok={false} title="Not autonomous on your machine or repository.">Setup applies only the plan you approve and confirms destructive items again; merges and pushes to the default branch need your instruction.</Check>
            </List></Card>
          </SimpleGrid>
        </Section>

        <Section id="tools" title="Recommended tools" intro="Optional, not installed by BenchKeeper. Each one works with the agents and rules set up here.">
          <Text fw={700} mb="xs">Parallel agents: pick one</Text>
          <Text size="sm" c="dimmed" mb="md" maw={760}>Orca, Nimbalyst and cmux all manage several agent sessions side by side. Running more than one duplicates that layer: each would track its own sessions and worktrees for the same repositories.</Text>
          <SimpleGrid cols={{ base: 1, md: 3 }}>
            <ToolCard icon={<IconStack2 size={20} />} name="Orca" href="https://github.com/stablyai/orca" platforms="macOS, Windows, Linux"
              points={['One git worktree per agent; the same prompt across several agents to compare results', 'Terminal splits, SSH remote worktrees, mobile companion app', <><Code>/global-setup</Code> offers its <Code>orca-cli</Code> and <Code>orchestration</Code> skills, only after asking</>]}
              when="you want terminal-centered parallel agents with worktrees, remote machines or mobile access." />
            <ToolCard icon={<IconLayoutKanban size={20} />} name="Nimbalyst" href="https://github.com/Nimbalyst/nimbalyst" platforms="macOS, Windows, Linux"
              points={['Parallel sessions on a kanban board, one-click worktree per session', 'Every agent edit arrives as a diff you approve or reject', 'Visual editors (Markdown, CSV, mockups, diagrams), task tracking, iOS app']}
              when="you want to review each change visually and work on docs, mockups and tasks next to the agents." />
            <ToolCard icon={<IconTerminal2 size={20} />} name="cmux" href="https://github.com/manaflow-ai/cmux" platforms="macOS only"
              points={['Ghostty-based terminal with vertical tabs', 'Notifications when an agent needs input; sidebar with branch, PR status and ports', 'Browser pane inside the terminal']}
              when="you are on macOS and want a terminal-first workflow without a separate app layer." />
          </SimpleGrid>
          <Text fw={700} mt={40} mb="xs">Unattended or isolated runs</Text>
          <Card withBorder padding="lg">
            <Group gap="sm" wrap="nowrap"><ThemeIcon variant="light" color="orange" size={38}><IconServer size={20} /></ThemeIcon><Anchor href="https://github.com/OpenHands/OpenHands" fw={700}>OpenHands</Anchor><Badge variant="outline" color="gray">self-hosted, web UI</Badge></Group>
            <Text size="sm" c="dimmed" mt="sm">A different role from the three above: an agent server that runs work without you at the terminal.</Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }} mt="md" spacing="md">
              <List size="sm" spacing={4}>
                <List.Item>Each conversation can run in its own Docker container (<Code>OH_CONVERSATION_RUNTIME=docker</Code>), one of the isolation options BenchKeeper does not provide</List.Item>
                <List.Item>Runs its own agent or hosts Claude Code, Codex and Gemini CLI; works with any LLM</List.Item>
              </List>
              <List size="sm" spacing={4}>
                <List.Item>Automations on a schedule or on webhook events (GitHub, Slack, Linear), for example splitting GitHub issues into tasks</List.Item>
                <List.Item>Without a sandbox, the local agent has full access to your filesystem</List.Item>
                <List.Item>Unverified: whether agents inside its containers load the BenchKeeper rules and skills, which live on the host</List.Item>
              </List>
            </SimpleGrid>
          </Card>
        </Section>

        <Section id="prereq" title="Before you start" intro="BenchKeeper does not install these. Use each official page.">
          <Table.ScrollContainer minWidth={300}>
            <Table withTableBorder striped highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
              <Table.Thead><Table.Tr><Table.Th>Tool</Table.Th><Table.Th>Needed for</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {prereqs.map(([n, u, f]) => (
                  <Table.Tr key={n}><Table.Td><Anchor href={u}>{n}</Anchor></Table.Td><Table.Td>{f}</Table.Td></Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          <Group mt="lg">
            <Button component="a" href={`${REPO}#setup-steps`} leftSection={<IconBox size={18} />}>Setup steps</Button>
          </Group>
        </Section>

        <Section id="files" title="Files it touches">
          <Table.ScrollContainer minWidth={300}>
            <Table withTableBorder verticalSpacing="sm" horizontalSpacing="md">
              <Table.Thead><Table.Tr><Table.Th>Scope</Table.Th><Table.Th>Files</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                <Table.Tr><Table.Td>Machine</Table.Td><Table.Td><Code>~/.claude/rules/00-global.md</Code> (symlink), <Code>~/.codex/AGENTS.md</Code> (copy), <Code>~/.claude/skills/</Code>, <Code>~/.agents/skills/</Code>, agent plugins and settings</Table.Td></Table.Tr>
                <Table.Tr><Table.Td>Repository, committed</Table.Td><Table.Td><Code>.devcontainer/</Code>, <Code>AGENTS.md</Code>, <Code>CLAUDE.md</Code>, <Code>.agents/skills/</Code>, <Code>.claude/skills/</Code>, <Code>skills-lock.json</Code>, <Code>openspec/</Code> or <Code>.specify/</Code> and <Code>specs/</Code>, <Code>.mcp.json</Code>, <Code>.codex/config.toml</Code></Table.Td></Table.Tr>
                <Table.Tr><Table.Td>Repository, not committed</Table.Td><Table.Td><Code>.codegraph/</Code></Table.Td></Table.Tr>
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Section>
      </main>

      <Box component="footer" className="band" py="xl">
        <Container size="lg">
          <Group justify="space-between">
            <Text size="sm" c="dimmed">BenchKeeper, MIT License</Text>
            <Anchor href={REPO} size="sm">github.com/ESchuderer/BenchKeeper</Anchor>
          </Group>
        </Container>
      </Box>
    </MantineProvider>
  );
}
