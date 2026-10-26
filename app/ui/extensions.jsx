import { Anchor, Badge, Code, Select, Stack, Table, Text, Title } from '@mantine/core';
import { IconPlayerPlay } from '@tabler/icons-react';
import { useState } from 'react';
import { Cli, Section } from './parts.jsx';
import { Loading, Note, href, icon, useApi } from './shell.jsx';

const GLOBAL = 'global';
const KINDS = { mcp: 'MCP server', hook: 'Hook', subagent: 'Subagent', command: 'Command', style: 'Output style' };

function Rows({ agent }) {
  if (!agent.rows.length) return <Text size="sm">Nothing found.</Text>;
  return (
    <Table.ScrollContainer minWidth={820} scrollAreaProps={{ viewportProps: { tabIndex: 0, role: 'region', 'aria-label': `${agent.name} extensions, scrollable` } }}>
      <Table aria-label={`${agent.name} extensions`} verticalSpacing="sm">
        <Table.Thead><Table.Tr><Table.Th>Kind</Table.Th><Table.Th>Name</Table.Th><Table.Th>Scope</Table.Th><Table.Th>Owner</Table.Th><Table.Th>What it is</Table.Th><Table.Th>File</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {agent.rows.map((r) => (
            <Table.Tr key={`${r.kind}|${r.scope}|${r.plugin ?? ''}|${r.shown}|${r.name}|${r.matcher ?? ''}|${r.detail}`}>
              <Table.Td>{KINDS[r.kind]}</Table.Td>
              <Table.Td><Stack gap={2}><Code style={{ overflowWrap: 'anywhere' }}>{r.name}</Code>{r.matcher && <Text size="sm">matcher <Code>{r.matcher}</Code></Text>}</Stack></Table.Td>
              <Table.Td>{r.scope}</Table.Td>
              <Table.Td><Badge variant="default" miw="max-content">{r.owner}{r.plugin ? ` (${r.plugin})` : ''}</Badge></Table.Td>
              <Table.Td>
                <Stack gap={4} align="flex-start">
                  {r.runsCode && <Badge variant="default" miw="max-content" leftSection={icon(IconPlayerPlay, 12)}>runs code</Badge>}
                  {r.transport && <Text size="sm">{r.kind === 'mcp' ? 'transport' : 'type'} {r.transport}{r.state && r.state !== 'on' ? `, ${r.state}` : r.kind === 'mcp' ? ', on' : ''}</Text>}
                  {r.detail && <Code style={{ overflowWrap: 'anywhere' }}>{r.detail}</Code>}
                </Stack>
              </Table.Td>
              <Table.Td><Stack gap={2}><Code style={{ overflowWrap: 'anywhere' }}>{r.shown}</Code>{r.removal && <Anchor size="sm" href={href('agents', { plan: '1' })}>Review removal in Doctor</Anchor>}</Stack></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
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
                <Section title={`${a.name} extensions${chosen ? ' for this project' : ''}`}><Rows agent={a} /></Section>
              </Stack>
            ))}
          </Stack>
        )}
      </Loading>
      <Cli>{'benchkeeper extensions list [--agent claude|codex] [--project <dir>] [--json]'}</Cli>
    </Stack>
  );
}
