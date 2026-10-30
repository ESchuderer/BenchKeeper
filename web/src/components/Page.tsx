import {
  ActionIcon, Alert, Anchor, Badge, Box, Button, Card, Code, Container, Group, List,
  Paper, SimpleGrid, Stack, Text, ThemeIcon, Timeline, Title, VisuallyHidden,
} from '@mantine/core';
import {
  IconAlertTriangle, IconArrowDown, IconArrowRight, IconCheck, IconContainer, IconCopy, IconFeather, IconFileText,
  IconListCheck, IconRoute, IconSchool,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { sdlcSvg } from '../lib/sdlc';
import facts from '../data/facts.json';
import { SiteShell } from './SiteShell';

const REPO = 'https://github.com/ESchuderer/BenchKeeper';
const SETUP = `${REPO}/blob/main/docs/setup.md`;
const PART_ICONS: Record<string, ReactNode> = {
  rules: <IconFileText size={20} />, workflow: <IconListCheck size={20} />, mattpocock: <IconSchool size={20} />,
  ponytail: <IconFeather size={20} />, app: <IconRoute size={20} />, devcontainer: <IconContainer size={20} />,
};
// Backticks in facts.json become inline code and `[label](url)` a link, the same text the README renders.
export const md = (t: string) => t.split(/(`[^`]*`|\[[^\]]+\]\([^)]+\))/).map((part, i) => {
  if (part.startsWith('`')) return <Code key={i}>{part.slice(1, -1)}</Code>;
  const link = /^\[(.+)\]\((.+)\)$/.exec(part);
  return link ? <Anchor key={i} href={link[2]}>{link[1]}</Anchor> : part;
});

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
export const half = Math.ceil(facts.sdlc.steps.length / 2);

export const SDLC_INTRO = 'The workflow skill sorts each task into a software change, a docs pass or research, and gives a software change a tier: how much process it gets. Quick: branch, build, verify, ship. Full: spec, tickets, tests first, review. Several tasks on one branch run their long checks and reviews once at the end. A skill that matches the task loads in any tier, and each change type adds its own check.';

export function StepList({ from, className }: { from: number; className?: string }) {
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
  ['Project setup, in each repository root', 'npx benchkeeper@6.25.0 projects apply --agents claude,codex', '--agents names the agents the repository uses. Where commands run and the default tier, library packs with --pack, and .benchkeeper/state.json. It stays on this machine: CLAUDE.local.md, AGENTS.override.md and the skills, all in .git/info/exclude. --share commits it to the repository instead. projects plan shows the changes first.'],
  ['Stack skills and the dev container, as a recorded session', "npx benchkeeper@6.25.0 sessions record -- claude '/benchkeeper:setting-up-projects'", "Codex: the same with codex '$benchkeeper:setting-up-projects'. With the matt-pocock pack, also /mattpocock-skills:setup-matt-pocock-skills. Commit the result."],
  ['Update later', 'npx benchkeeper@6.25.0 apply', 'With the version of the newest release. The plan lists what changed, including the plugin. Projects: npx benchkeeper@6.25.0 projects update, or Fix everything in the browser, updates each local setup in place; a shared one, or a setup still committed from before, gets a pull request.'],
  ['Track sessions', 'npx benchkeeper@6.25.0 sessions board', 'Writes a static page, board.html in the BenchKeeper config folder, from the Claude Code and Codex transcripts on this machine: per session the tier, the setup installed at the time, skills used, the last test run, cost (Claude Code), time and pull request state. The Sessions view in the browser app shows the same board.'],
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

const host = ['Rules and the plugins: BenchKeeper, optionally Ponytail and Matt Pocock\'s skills', 'Git and gh: branches, commits, pull requests', 'Dev Containers CLI and Docker or Podman', 'The agent, with --env host-agent'];
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
    <SiteShell base={base} home updated={updated} commit={commit}>
        <Box className="hero" py={{ base: 64, md: 112 }}>
          <Container size="lg">
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing={48} style={{ alignItems: 'center' }}>
              <Stack gap="lg">
                <Badge variant="light" size="lg">Setup for Claude Code and Codex</Badge>
                <Title order={1} fz={{ base: 44, md: 68 }} lh={1.02}><span className="grad">BenchKeeper</span></Title>
                <Text size="xl" maw={560}>
                  Short rules and a workflow skill that sizes each change for Claude Code and Codex, installed by an app that shows each change first and can undo the run.
                  Each repository adds its dev container, AGENTS.md and stack skills.
                </Text>
                <Group mt="sm">
                  <Button component="a" href="#start" size="md">Set up your machine</Button>
                  <Button component="a" href="#sdlc" size="md" variant="default">See the workflow</Button>
                  <Button component="a" href={`${base}/overview/`} size="md" variant="default">What it brings</Button>
                </Group>
              </Stack>
              <Box ta="center">
                <img src={`${base}/logo.svg`} alt="BenchKeeper logo: a brain inside a gear, circled by a loop of arrows" className="logo" width={300} height={300} style={{ width: 'min(300px, 64vw)', height: 'auto' }} />
              </Box>
            </SimpleGrid>
          </Container>
        </Box>

        <Section id="sdlc" title="One loop, sized to the change" intro={SDLC_INTRO}>
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
            {facts.parts.map((p) => (
              <Part key={p.id} icon={PART_ICONS[p.id]} title={md(p.title)} href={p.href} scope={p.scope}>{md(p.text)}</Part>
            ))}
          </SimpleGrid>
        </Section>

        <Section id="features" title="Features">
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg" verticalSpacing="lg">
            {facts.overview.parts.map((p) => (
              <Stack key={p.id} gap={4}>
                <Anchor href={`${base}/overview/#${p.id}`} fw={700}>{p.title}</Anchor>
                <Text size="sm" c="dimmed">{md(`${p.text.split('. ')[0]}.`)}</Text>
              </Stack>
            ))}
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
            {facts.stack.reasons.map((r) => <List.Item key={r.name}><Text span fw={700}>{r.name}:</Text> {r.text}</List.Item>)}
          </List>
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
            In the default container environment the agent sees the project mount instead of your home folder, but a container shares the host kernel and is not a security boundary. With --env host-agent, projects apply --sandbox turns on Claude Code's sandbox. For a separate kernel, use a Docker Sandboxes microVM (--env sandbox, untested) or a VM.
          </Alert>
        </Section>
    </SiteShell>
  );
}
