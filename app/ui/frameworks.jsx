import { Anchor, Badge, Checkbox, Group, Paper, Radio, Stack, Text } from '@mantine/core';

const REPO = 'https://github.com/ESchuderer/BenchKeeper/blob/main/';

// What one install writes, as the list and the plan name it.
const WRITES = { plugin: 'a Claude Code plugin enabled for this project only', agents: 'agent files in the project, fetched at a pinned commit' };

function Evidence({ f }) {
  return (
    <Stack gap={2}>
      <Text size="xs">{f.verdict} {f.hooks} Installs {WRITES[f.kind]}.{f.gives ? ` ${f.gives}` : ''}{f.limits ? ` ${f.limits}` : ''}</Text>
      <Text size="xs"><Anchor href={`${REPO}${f.evaluation}`} target="_blank" rel="noreferrer" underline="always">Evaluation</Anchor>, {f.license}, {f.pin}</Text>
    </Stack>
  );
}

// Frameworks of a project: none by default, at most one (it owns the workflow).
// a: { frameworks }; set(key)(value) edits an answer.
export function FrameworkChoice({ rows, a, set }) {
  const owner = rows.find((f) => a.frameworks.includes(f.id))?.id ?? '';
  return (
    <Stack gap="md" mt="md" component="section" aria-label="Frameworks">
      <Text size="sm">A framework replaces how work is planned and run in this project. Nothing is installed unless you choose it here.</Text>
      <Radio.Group label="Workflow owner (at most one)" value={owner}
        onChange={(v) => set('frameworks')([...a.frameworks.filter((x) => !rows.some((f) => f.id === x)), ...(v ? [v] : [])])}>
        <Stack gap="xs" mt="xs">
          <Radio value="" label="BenchKeeper's workflow skill" description="The default: picks the tier and runs the playbook." />
          {rows.map((f) => (
            <Paper key={f.id} withBorder p="xs"><Radio value={f.id} label={<Group gap="xs"><Text fw={600} size="sm">{f.title}</Text><Badge variant="default" size="sm">replaces the workflow</Badge></Group>} description={<Evidence f={f} />} /></Paper>
          ))}
        </Stack>
      </Radio.Group>
    </Stack>
  );
}

// Agent-file sources: a pick of files per source, none by default. a: { agentFiles }.
export function AgentFileChoice({ rows, a, set }) {
  return rows.map((f) => (
    <Paper key={f.id} withBorder p="xs" mt="md">
      <Checkbox.Group label={<Text fw={600} size="sm">Agent files from {f.title}</Text>} description={<Evidence f={f} />} value={a.agentFiles} onChange={set('agentFiles')}>
        <Stack gap={4} mt={4}>{f.files.map((x) => <Checkbox key={x.path} value={x.path} label={x.name} description={x.pickWhen} />)}</Stack>
      </Checkbox.Group>
    </Paper>
  ));
}
