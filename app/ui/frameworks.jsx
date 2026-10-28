import { Anchor, Checkbox, Paper, Stack, Text } from '@mantine/core';

// What one install writes, as the list and the plan name it.
const WRITES = { agents: 'agent files in the project, fetched at a pinned commit' };

function Evidence({ f }) {
  return (
    <Stack gap={2}>
      <Text size="xs">{f.verdict} {f.hooks} Installs {WRITES[f.kind]}.{f.limits ? ` ${f.limits}` : ''}</Text>
      <Text size="xs"><Anchor href={f.evaluation} target="_blank" rel="noreferrer" underline="always">Evaluation</Anchor>, <Anchor href={f.readme} target="_blank" rel="noreferrer" underline="always">README</Anchor>, {f.license}, {f.pin}</Text>
    </Stack>
  );
}

// Agent-file sources: a pick of files per source, none by default. a: { agentFiles }.
export function AgentFileChoice({ rows, a, set }) {
  return rows.map((f) => (
    <Paper key={f.id} withBorder p="xs" mt="md">
      <Checkbox.Group label={<Text fw={600} size="sm">Agent files from {f.title}</Text>} description={<Evidence f={f} />} value={a.agentFiles} onChange={set('agentFiles')}>
        <Stack gap={4} mt={4}>{f.files.map((x) => <Checkbox key={x.path} value={x.path} label={x.name} description={<>{x.pickWhen} <Anchor href={x.url} target="_blank" rel="noreferrer" underline="always" aria-label={`Source of ${x.name}`}>Source</Anchor></>} />)}</Stack>
      </Checkbox.Group>
    </Paper>
  ));
}
