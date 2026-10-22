import { Anchor, Badge, Button, Checkbox, Code, Group, Loader, Progress, Stack, Table, Text, Title } from '@mantine/core';
import { IconPlayerPlay } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { Dot, Note, STATE_COLOR, href, icon } from './shell.jsx';

// Loads a GET endpoint; reload() fetches it again and keeps the data meanwhile, another path drops it. A request for
// an older path or load is aborted; no path clears it.
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: !!path, path });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) { setState({ data: null, error: null, loading: false, path }); return undefined; }
    const ac = new AbortController();
    setState((s) => (s.path === path ? { ...s, loading: true } : { data: null, error: null, loading: true, path }));
    api(path, undefined, { signal: ac.signal }).then((data) => !ac.signal.aborted && setState({ data, error: null, loading: false, path }), (e) => !ac.signal.aborted && setState({ data: null, error: e.message, loading: false, path }));
    return () => ac.abort();
  }, [path, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  // Until the effect runs for a new path, the old path's data must not show under it.
  return { ...(state.path === path ? state : { data: null, error: null, loading: true }), reload };
}

export function Loading({ state, label, children }) {
  if (state.error) return <Note color="red" title={`${label} failed`}>{state.error}</Note>;
  // No data yet also covers the first render after the path changes, before the effect marks it loading.
  if (state.data == null) return <Group gap="xs"><Loader size="sm" /><Text size="sm">Loading {label}</Text></Group>;
  return children(state.data);
}

export const Cli = ({ children }) => (
  <Stack gap={4}>
    <Text size="sm" fw={600}>CLI</Text>
    <Code block tabIndex={0}>{children}</Code>
  </Stack>
);

export const Section = ({ title, children, id }) => (
  <Stack gap="sm" component="section" aria-label={title} id={id}>
    <Title order={2} size="h3">{title}</Title>
    {children}
  </Stack>
);

export const StateBadge = ({ state }) => (state ? <Badge variant="default" style={{ flexShrink: 0 }} leftSection={<Dot color={STATE_COLOR[state] ?? 'gray'} />}>{state}</Badge> : null);

// A plan from the server: one checkbox per change (removals off by default), its diff or command, then apply.
export function Plan({ plan, onDone }) {
  const [select, setSelect] = useState(() => plan.changes.filter((c) => c.selected && !c.error).map((c) => c.id));
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!plan.changes.length) return <Text>Nothing to change.</Text>;
  // Changes of one unit go together: toggling one toggles all of them.
  const unitOf = (c) => (c.unit ? plan.changes.filter((x) => x.unit === c.unit).map((x) => x.id) : [c.id]);
  const toggle = (c) => setSelect((s) => (s.includes(c.id) ? s.filter((x) => !unitOf(c).includes(x)) : [...new Set([...s, ...unitOf(c)])]));
  const run = async () => {
    setBusy(true);
    try { setJob(await api('/api/apply', { planId: plan.planId, select })); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  if (job) return <RunProgress job={job.job} total={job.total} onDone={onDone} />;
  return (
    <Stack gap="sm">
      {error && <Note color="red" title="Apply failed">{error}</Note>}
      {plan.changes.map((c) => (
        <Stack key={c.id} gap={4}>
          <Group gap="xs" wrap="nowrap" align="flex-start">
            <Checkbox checked={select.includes(c.id)} disabled={!!c.error || unitOf(c).some((id) => plan.changes.find((x) => x.id === id).error)} onChange={() => toggle(c)}
              label={c.destructive ? `Remove: ${c.title}` : c.title} description={unitOf(c).length > 1 ? `Goes with ${unitOf(c).length - 1} other change${unitOf(c).length > 2 ? 's' : ''} of this list` : undefined} />
            <StateBadge state={c.state} />
          </Group>
          {c.error && <Text size="sm" c="red">{c.kind === 'command' ? 'Not applied' : 'Cannot merge'}: {c.error}</Text>}
          {c.kind === 'command' ? <Code block tabIndex={0}>{`$ ${c.argv.join(' ')}`}</Code> : c.diff ? <Code block tabIndex={0}>{c.diff}</Code> : null}
        </Stack>
      ))}
      <Group><Button leftSection={icon(IconPlayerPlay)} onClick={run} loading={busy} disabled={!select.length}>Apply {select.length} changes</Button></Group>
    </Stack>
  );
}

const STATUS_COLOR = { done: 'teal', failed: 'red', skipped: 'gray', running: 'blue', waiting: 'gray', manual: 'yellow' };
export const StatusBadge = ({ status }) => <Badge variant="default" leftSection={<Dot color={STATUS_COLOR[status] ?? 'gray'} />}>{status}</Badge>;

// A started job (apply or eval), polled until it is done. A failed poll is retried; only a lost job (404) or ten
// misses in a row end the view, the job itself goes on.
export function useJob(job, onDone) {
  const [state, setState] = useState(null);
  useEffect(() => {
    let live = true, timer, misses = 0;
    const poll = async () => {
      try {
        const s = await api(`/api/job?id=${job}`);
        if (!live) return;
        misses = 0;
        setState(s);
        if (s.done) { onDone?.(s); return; }
      } catch (e) {
        if (!live) return;
        if (e.status === 404 || ++misses >= 10) {
          const error = `${e.message}: see History`;
          setState((x) => ({ ...x, done: true, error }));
          onDone?.({ done: true, error });
          return;
        }
      }
      timer = setTimeout(poll, 400);
    };
    poll();
    return () => { live = false; clearTimeout(timer); };
  }, [job]);
  return state;
}

// A started apply: each change with its status, the running command's output, then the run.
export function RunProgress({ job, total, onDone }) {
  const state = useJob(job, (s) => onDone?.(s.run));
  const entries = state?.run?.entries ?? [];
  // Each change is journaled as running before it starts.
  const finished = entries.filter((e) => e.status && e.status !== 'running').length;
  const running = !state?.done && entries.find((e) => e.status === 'running');
  const waiting = state?.done ? 0 : Math.max(total - entries.length, 0);
  return (
    <Stack gap="sm" component="section" aria-label="Apply progress">
      <Progress value={total ? (finished / total) * 100 : 100} aria-label="Changes done" color={state?.run?.status === 'failed' || entries.some((e) => e.status === 'failed') ? 'red' : 'teal'} />
      <Text role="status">
        {state?.done ? <>Run <Code>{state.run?.id ?? job}</Code>: {state.error ?? state.run?.status} ({finished} of {total} changes). <Anchor href={href('history', { run: state.run?.id })}>Open in History</Anchor></>
          : running ? `${finished} of ${total} done. Running: ${running.title}` : `${finished} of ${total} done`}
      </Text>
      {state?.error && <Note color="red" title="Apply failed">{state.error}</Note>}
      <Table aria-label="Changes">
        <Table.Thead><Table.Tr><Table.Th>Status</Table.Th><Table.Th>Change</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {entries.map((e) => {
            const status = e.status ?? (state?.done ? 'failed' : 'running'), out = state?.output?.[e.id];
            return (
              <Table.Tr key={e.id}>
                <Table.Td><StatusBadge status={status} /></Table.Td>
                <Table.Td>
                  {e.title}{e.error || e.reason ? `: ${e.error ?? e.reason}` : ''}
                  {e.argv && <Code block tabIndex={0} mt={4}>{`$ ${e.argv.join(' ')}${out ? `\n${out.trimEnd()}` : ''}`}</Code>}
                </Table.Td>
              </Table.Tr>
            );
          })}
          {waiting > 0 && <Table.Tr><Table.Td><StatusBadge status="waiting" /></Table.Td><Table.Td>{waiting} more</Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
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
              <Table.Td>{e.title}{e.error || e.reason ? `: ${e.error ?? e.reason}` : ''}{e.diff && <Code block tabIndex={0} mt={4}>{e.diff}</Code>}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
