import { Anchor, Badge, Checkbox, Group, Paper, Stack, Text } from '@mantine/core';

// What one install writes, as the list and the plan name it.
const WRITES = { plugin: 'a Claude Code plugin enabled for this project only', agents: 'agent files in the project, fetched at a pinned commit' };

function Evidence({ f }) {
  return (
    <Stack gap={2}>
      <Text size="xs">{f.verdict} {f.hooks} Installs {WRITES[f.kind]}.{f.limits ? ` ${f.limits}` : ''}</Text>
      <Text size="xs"><Anchor href={f.evaluation} target="_blank" rel="noreferrer" underline="always">Evaluation</Anchor>, {f.license}, {f.pin}</Text>
    </Stack>
  );
}

// Frameworks of a project: none by default, at most one workflow owner. No owner checked keeps BenchKeeper's workflow skill.
// a: { frameworks }; set(key)(value) edits an answer.
export function FrameworkChoice({ rows, a, set }) {
  const owner = rows.find((f) => f.role === 'owner' && a.frameworks.includes(f.id));
  return (
    <Stack gap="md" mt="md" component="section" aria-label="Frameworks">
      <Text size="sm">A framework replaces how work is planned and run in this project. Nothing is installed unless you choose it here.</Text>
      <Checkbox.Group label="Workflow owner (at most one)" value={a.frameworks} onChange={set('frameworks')}>
        <Stack gap="xs" mt="xs">
          {rows.map((f) => {
            const on = a.frameworks.includes(f.id);
            const blocked = !on && f.role === 'owner' && owner;
            return (
              <Paper key={f.id} withBorder p="xs">
                <Checkbox value={f.id} disabled={!!blocked} label={<Group gap="xs"><Text fw={600} size="sm">{f.title}</Text>{f.role === 'owner' && <Badge variant="default" size="sm">replaces the workflow</Badge>}</Group>}
                  description={<Stack gap={2}>
                    {blocked && <Text size="xs">Off while {owner.title} owns the workflow: a project has at most one owner.</Text>}
                    {on && f.gives && <Text size="xs">{f.gives}</Text>}
                    <Evidence f={f} />
                  </Stack>} />
              </Paper>
            );
          })}
        </Stack>
      </Checkbox.Group>
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
