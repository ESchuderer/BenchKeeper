import { Anchor, Badge, Checkbox, Group, Paper, Radio, Stack, Text } from '@mantine/core';

const REPO = 'https://github.com/ESchuderer/BenchKeeper/blob/main/';

// What one framework install writes, as the list and the plan name it.
const WRITES = { pack: 'single skills in the project (skills CLI, no plugin, no hooks)', plugin: 'a Claude Code plugin enabled for this project only', agents: 'agent files in the project, fetched at a pinned commit' };

function Evidence({ f }) {
  return (
    <Stack gap={2}>
      <Text size="xs">{f.verdict} {f.hooks} Installs {WRITES[f.kind]}.{f.gives ? ` ${f.gives}` : ''}{f.limits ? ` ${f.limits}` : ''}</Text>
      <Text size="xs"><Anchor href={`${REPO}${f.evaluation}`} target="_blank" rel="noreferrer" underline="always">Evaluation</Anchor>, {f.license}, {f.pin}</Text>
    </Stack>
  );
}

// Frameworks of a project: none by default. At most one owner of the workflow (a radio), parts beside it (checkboxes).
// Pack frameworks switch a pack; the others switch the framework and, for agency-agents, pick agent files.
// a: { packs, frameworks, agentFiles }; set(key)(value) edits an answer.
export function FrameworkChoice({ rows, a, set }) {
  const on = (f) => (f.kind === 'pack' ? a.packs.includes(f.pack) : a.frameworks.includes(f.id));
  const owners = rows.filter((f) => f.role === 'owner'), parts = rows.filter((f) => f.role === 'parts');
  const toggle = (f, v) => {
    if (f.kind === 'pack') set('packs')(v ? [...a.packs, f.pack] : a.packs.filter((p) => p !== f.pack));
    else {
      set('frameworks')(v ? [...a.frameworks, f.id] : a.frameworks.filter((x) => x !== f.id));
      if (!v) set('agentFiles')(a.agentFiles.filter((p) => !f.files.some((x) => x.path === p)));
    }
  };
  const owner = owners.find(on)?.id ?? '';
  return (
    <Stack gap="md" mt="md" component="section" aria-label="Frameworks">
      <Text size="sm">Frameworks add their own skills or agents to this project. Nothing is installed unless you choose it here.</Text>
      <Radio.Group label="Workflow owner (at most one)" value={owner}
        onChange={(v) => set('frameworks')([...a.frameworks.filter((x) => !owners.some((f) => f.id === x)), ...(v ? [v] : [])])}>
        <Stack gap="xs" mt="xs">
          <Radio value="" label="BenchKeeper's workflow skill" description="The default: picks the tier and runs the playbook." />
          {owners.map((f) => (
            <Paper key={f.id} withBorder p="xs"><Radio value={f.id} label={<Group gap="xs"><Text fw={600} size="sm">{f.title}</Text><Badge variant="default" size="sm">replaces the workflow</Badge></Group>} description={<Evidence f={f} />} /></Paper>
          ))}
        </Stack>
      </Radio.Group>
      <Stack gap="xs" role="group" aria-label="Parts beside it">
        <Text size="sm" fw={500}>Parts beside it</Text>
        {parts.map((f) => (
          <Paper key={f.id} withBorder p="xs">
            <Checkbox checked={on(f)} onChange={(e) => toggle(f, e.currentTarget.checked)} label={<Text fw={600} size="sm">{f.title}</Text>} description={<Evidence f={f} />} />
            {f.files.length > 0 && on(f) && (
              <Checkbox.Group mt="xs" ml="xl" label="Agent files to add" value={a.agentFiles} onChange={set('agentFiles')}>
                <Stack gap={4} mt={4}>{f.files.map((x) => <Checkbox key={x.path} value={x.path} label={x.name} description={x.pickWhen} />)}</Stack>
              </Checkbox.Group>
            )}
          </Paper>
        ))}
      </Stack>
    </Stack>
  );
}
