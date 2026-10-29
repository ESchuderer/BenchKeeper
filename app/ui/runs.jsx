import { Button, Code, Group, List, Stack, Switch, Table, Text } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { useState } from 'react';
import { api } from './api.js';
import { Cli, Plan, Section } from './parts.jsx';
import { Loading, Note, icon, useApi } from './shell.jsx';

const money = (x) => (x == null ? 'not recorded' : `$${x.toFixed(2)}`);
const Scroll = ({ label, children }) => (
  <Table.ScrollContainer minWidth={560} scrollAreaProps={{ viewportProps: { tabIndex: 0, role: 'region', 'aria-label': `${label}, scrollable` } }}>
    <Table aria-label={label}>{children}</Table>
  </Table.ScrollContainer>
);

// Runs and tasks, read when the view opens and on Refresh; no timer. The rows hold ids, states and counts, never a prompt or worker output.
export function Runs() {
  const runs = useApi('/api/runs');
  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <Text maw={720}>Orchestrated runs and tasks in the registered projects and their worktrees, with cost and tokens, each project's last setup change, and the runs of the multi-agent IDE when it is installed. Read when the view opens and on Refresh; nothing runs while it is closed.</Text>
        <Button leftSection={icon(IconRefresh)} variant="default" loading={runs.loading} onClick={runs.reload}>Refresh</Button>
      </Group>
      <Loading state={runs} label="runs">{(d) => (
        <Stack gap="lg">
          <Section title="Orchestrated runs">
            <Text size="sm">From the sessions read {d.scanned.slice(0, 16).replace('T', ' ')} UTC in the registered projects and their worktrees. Codex records tokens, not cost.</Text>
            {d.runs.length ? (
              <Scroll label="Orchestrated runs and tasks">
                <Table.Thead><Table.Tr><Table.Th>Run</Table.Th><Table.Th>Task</Table.Th><Table.Th>Worktree</Table.Th><Table.Th>Branch</Table.Th><Table.Th>Sessions</Table.Th><Table.Th>Cost</Table.Th><Table.Th>Tokens</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {d.runs.flatMap((x) => [{ ...x, task: 'all tasks', total: true }, ...x.tasks].map((t) => (
                    <Table.Tr key={`${x.run}-${t.total ? '' : t.task}`}>
                      <Table.Td>{x.run ?? 'not recorded'}</Table.Td>
                      <Table.Td>{t.task ?? 'not recorded'}</Table.Td>
                      <Table.Td>{t.worktree ? <Code>{t.worktree}</Code> : '-'}</Table.Td>
                      <Table.Td>{t.branch ?? '-'}</Table.Td>
                      <Table.Td>{t.sessions}</Table.Td>
                      <Table.Td>{money(t.costUSD)}</Table.Td>
                      <Table.Td>{t.tokens}</Table.Td>
                    </Table.Tr>
                  )))}
                </Table.Tbody>
              </Scroll>
            ) : <Text size="sm">No orchestrated sessions in a registered project.</Text>}
          </Section>
          <Section title="Last setup change">
            {d.setup.length ? (
              <List spacing={4} size="sm">
                {d.setup.map((p) => <List.Item key={p.project}><Code>{p.project}</Code>: {p.lastChange ? `${p.lastChange.kind} ${p.lastChange.status}, ${p.lastChange.time.slice(0, 16).replace('T', ' ')} UTC` : 'none'}</List.Item>)}
              </List>
            ) : <Text size="sm">No project is registered.</Text>}
          </Section>
          <Section title={d.ide.name}>
            {d.ide.runs === null ? <Text size="sm">Not installed, or its run list could not be read.</Text> : !d.ide.runs.length ? <Text size="sm">No runs.</Text> : (
              <Scroll label={`${d.ide.name} runs`}>
                <Table.Thead><Table.Tr><Table.Th>Run</Table.Th><Table.Th>Updated</Table.Th><Table.Th>Tasks</Table.Th><Table.Th>States</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {d.ide.runs.map((r) => (
                    <Table.Tr key={r.id}>
                      <Table.Td><Code>{r.id}</Code></Table.Td>
                      <Table.Td>{r.updated ?? '-'}</Table.Td>
                      <Table.Td>{r.tasks ?? 'not read'}</Table.Td>
                      <Table.Td>{Object.entries(r.states).map(([s, n]) => `${n} ${s}`).join(', ') || '-'}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Scroll>
            )}
          </Section>
        </Stack>
      )}</Loading>
      <Cli>benchkeeper sessions list --run &lt;id&gt;</Cli>
    </Stack>
  );
}

// Preferences: each surface with its default and what it costs while on; the tier strip is the one that runs without being opened.
export function Surfaces() {
  const band = useApi('/api/tier-band');
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const ask = async (on) => {
    setError(null); setPlan(null);
    try { setPlan(await api('/api/settings-plan', { agent: 'claude', layer: 'user', edits: { [band.data.key]: on } })); } catch (e) { setError(e.message); }
  };
  return (
    <Section title="Views and their cost">
      <List spacing={4} size="sm" maw={720}>
        <List.Item>Terminal tier strip: off by default. While on, a Claude Code hook runs each time the prompt is drawn, runs <Code>git branch --show-current</Code> after each answer step, and reads each command and edit of the main loop.</List.Item>
        <List.Item>Sessions board: written by each sessions scan (opening Sessions or Runs) and by <Code>benchkeeper sessions board</Code>; no server, nothing runs between.</List.Item>
        <List.Item>Sessions view: reads the sessions cache and only the transcripts changed since the last scan.</List.Item>
        <List.Item>Runs view: read when you open it or press Refresh, no timer. It reuses the last sessions scan or scans like Sessions; with the multi-agent IDE installed, it asks for its run list and the tasks of each run (at most 21 calls).</List.Item>
      </List>
      <Loading state={band} label="tier strip setting">{(b) => (
        <Switch label="Terminal tier strip" description="The plugin option in your Claude Code user settings, applied as a plan you can undo." checked={b.on} onChange={(e) => ask(e.currentTarget.checked)} />
      )}</Loading>
      {error && <Note color="red" title="Not planned">{error}</Note>}
      {plan && <Plan key={plan.planId} plan={plan} scope="global" onDone={band.reload} />}
    </Section>
  );
}
