import { Badge, Button, Code, Group, Paper, Select, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconPlayerPlay, IconPlug } from '@tabler/icons-react';
import { useState } from 'react';
import { Cli, Section } from './parts.jsx';
import { Loading, Note, href, icon, useApi } from './shell.jsx';

const GLOBAL = 'global';
// Owner and transport chips carry free text (a plugin id, a type): they wrap inside the row instead of widening it.
const WRAP = { root: { maxWidth: '100%', height: 'auto' }, label: { whiteSpace: 'normal', overflowWrap: 'anywhere' } };
const KINDS = { mcp: 'MCP server', hook: 'Hook', subagent: 'Subagent', command: 'Command', style: 'Output style' };

// One row per extension: name, state chips, what it runs and the file; an agent without any gets an empty state.
function Rows({ agent, chosen }) {
  if (!agent.rows.length) return (
    <Paper withBorder p="md">
      <Group gap="md" wrap="nowrap">
        <ThemeIcon variant="light" color="gray" size="xl" radius="xl">{icon(IconPlug, 22)}</ThemeIcon>
        <Stack gap={2}>
          <Text fw={600}>Nothing found.</Text>
          <Text size="sm">{agent.name} loads no MCP server, hook, subagent, command or output style from {chosen ? 'this project' : 'the global files'}.</Text>
        </Stack>
      </Group>
    </Paper>
  );
  return (
    <Stack component="ul" gap="xs" aria-label={`${agent.name} extensions`} m={0} p={0} style={{ listStyle: 'none' }}>
      {agent.rows.map((r) => (
        <Paper component="li" withBorder p="sm" key={`${r.kind}|${r.scope}|${r.plugin ?? ''}|${r.shown}|${r.name}|${r.matcher ?? ''}|${r.detail}`}>
          <Group justify="space-between" gap="xs">
            <Stack gap={4} style={{ flex: '1 1 320px', minWidth: 0 }}>
              <Group gap={6}>
                <Code style={{ overflowWrap: 'anywhere' }}>{r.name}</Code>
                {r.matcher && <Text size="sm">matcher <Code>{r.matcher}</Code></Text>}
                <Badge variant="default" miw="max-content">{KINDS[r.kind]}</Badge>
                {r.runsCode && <Badge variant="default" miw="max-content" leftSection={icon(IconPlayerPlay, 12)}>runs code</Badge>}
                <Badge variant="default" miw="max-content">scope {r.scope}</Badge>
                <Badge variant="default" styles={WRAP}>owner {r.owner}{r.plugin ? ` (${r.plugin})` : ''}</Badge>
                {r.transport && <Badge variant="default" styles={WRAP}>{r.kind === 'mcp' ? 'transport' : 'type'} {r.transport}{r.state && r.state !== 'on' ? `, ${r.state}` : r.kind === 'mcp' ? ', on' : ''}</Badge>}
              </Group>
              <Group gap="md">
                {r.detail && <Code style={{ overflowWrap: 'anywhere' }}>{r.detail}</Code>}
                <Text size="sm" style={{ overflowWrap: 'anywhere' }}>File <Code>{r.shown}</Code></Text>
              </Group>
            </Stack>
            {r.removal && (
              <Group gap="xs">
                <Text size="xs">The global plan offers removal (full level)</Text>
                <Button component="a" href={href('agents', { plan: '1' })} size="compact-sm" variant="default" aria-label={`Remove ${r.name}`}>Remove</Button>
              </Group>
            )}
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}

// What each agent loads or runs besides rules and skills, globally or for a registered project. Read-only.
export function Extensions({ overview, params }) {
  const projects = overview.data?.projects ?? [];
  const [dir, setDir] = useState(params.get('path') ?? GLOBAL);
  const chosen = dir === GLOBAL ? undefined : dir;
  const state = useApi(`/api/extensions${chosen ? `?${new URLSearchParams({ dir: chosen })}` : ''}`);
  return (
    <Stack gap="lg">
      <Note>Read from the agents' files; no agent is started and nothing here changes a file. "Runs code" marks what executes a command on this machine.</Note>
      <Select label="Show" data={[{ value: GLOBAL, label: 'Global files' }, ...projects.map((p) => ({ value: p.path, label: p.name ? `${p.name} (${p.path})` : p.path }))]} value={dir} onChange={(v) => setDir(v ?? GLOBAL)} allowDeselect={false} comboboxProps={{ withinPortal: false }} maw={560} />
      <Loading state={state} label="extensions">
        {(data) => (
          <Stack gap="xl">
            {data.agents.map((a) => (
              <Stack key={a.id} gap="md">
                <Title order={2} size="h3">{a.name}</Title>
                {a.problems.map((p) => <Note key={p.path} color="yellow"><Code>{p.shown}</Code> {p.message}.</Note>)}
                <Section title={`${a.name} extensions${chosen ? ' for this project' : ''}`}><Rows agent={a} chosen={chosen} /></Section>
              </Stack>
            ))}
          </Stack>
        )}
      </Loading>
      {/* Reference, not status: folded until opened. */}
      <details>
        <summary><Text component="span" fw={600}>Command</Text></summary>
        <Stack mt="md"><Cli>{'benchkeeper extensions list [--agent claude|codex] [--project <dir>] [--json]'}</Cli></Stack>
      </details>
    </Stack>
  );
}
