import { Alert, Badge, Button, Checkbox, Code, Group, Loader, Stack, Table, Text, Title } from '@mantine/core';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

// Loads a GET endpoint; reload() fetches it again.
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const reload = useCallback(() => {
    if (!path) return;
    setState((s) => ({ ...s, loading: true }));
    api(path).then((data) => setState({ data, error: null, loading: false }), (e) => setState({ data: null, error: e.message, loading: false }));
  }, [path]);
  useEffect(reload, [reload]);
  return { ...state, reload };
}

export function Loading({ state, label, children }) {
  if (state.error) return <Alert color="red" title={`${label} failed`}>{state.error}</Alert>;
  if (state.loading && !state.data) return <Group gap="xs"><Loader size="sm" /><Text size="sm">Loading {label}</Text></Group>;
  return children(state.data);
}

export const Cli = ({ children }) => (
  <Stack gap={4}>
    <Text size="sm" fw={600}>CLI</Text>
    <Code block>{children}</Code>
  </Stack>
);

export const Section = ({ title, children }) => (
  <Stack gap="sm" component="section" aria-label={title}>
    <Title order={2} size="h3">{title}</Title>
    {children}
  </Stack>
);

export const StateBadge = ({ state }) => (state ? <Badge variant="default">{state}</Badge> : null);

// A plan from the server: one checkbox per change (removals off by default), its diff or command, then apply.
export function Plan({ plan, onDone }) {
  const [select, setSelect] = useState(() => plan.changes.filter((c) => c.selected && !c.error).map((c) => c.id));
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!plan.changes.length) return <Text>Nothing to change.</Text>;
  const toggle = (id) => setSelect((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const run = async () => {
    setBusy(true);
    try { setResult(await api('/api/apply', { planId: plan.planId, select })); onDone?.(); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  if (result) return <RunEntries run={result} />;
  return (
    <Stack gap="sm">
      {error && <Alert color="red" title="Apply failed">{error}</Alert>}
      {plan.changes.map((c) => (
        <Stack key={c.id} gap={4}>
          <Group gap="xs" wrap="nowrap" align="flex-start">
            <Checkbox checked={select.includes(c.id)} disabled={!!c.error} onChange={() => toggle(c.id)} label={c.destructive ? `Remove: ${c.title}` : c.title} />
            <StateBadge state={c.state} />
          </Group>
          {c.error && <Text size="sm" c="red">Cannot merge: {c.error}</Text>}
          {c.kind === 'command' ? <Code block>{`$ ${c.argv.join(' ')}`}</Code> : c.diff ? <Code block>{c.diff}</Code> : null}
        </Stack>
      ))}
      <Group><Button onClick={run} loading={busy} disabled={!select.length}>Apply {select.length} changes</Button></Group>
    </Stack>
  );
}

export function RunEntries({ run }) {
  return (
    <Stack gap="xs">
      <Text>Run <Code>{run.id}</Code>: {run.status}</Text>
      <Table>
        <Table.Thead><Table.Tr><Table.Th>Status</Table.Th><Table.Th>Change</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {run.entries.map((e, i) => (
            <Table.Tr key={i}>
              <Table.Td>{e.status}</Table.Td>
              <Table.Td>{e.title}{e.error || e.reason ? `: ${e.error ?? e.reason}` : ''}{e.diff && <Code block mt={4}>{e.diff}</Code>}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
