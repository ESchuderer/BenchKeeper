import { Anchor, Badge, Button, Checkbox, Code, Group, Loader, Progress, Stack, Table, Text, Title } from '@mantine/core';
import { IconCopy, IconPlayerPlay, IconPlayerStop } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { DiffView, RunPanel } from './run.jsx';
import { Dot, Note, STATE_COLOR, StatusBadge, href, icon } from './shell.jsx';

export const pct = (v) => (v == null ? null : Math.round(v * 100));

export const Cli = ({ children }) => (
  <Stack gap={4}>
    <Text size="sm" fw={600}>CLI</Text>
    <Code block tabIndex={0}>{children}</Code>
  </Stack>
);

// A step only the user can start: the app shows the line for their own terminal and does not run it.
export const StartBlock = ({ start, why }) => (
  <Stack gap={4}>
    <Text size="sm">Start in a terminal: {start.agent} in <Code>{start.dir}</Code>{why ? `, ${why}` : ''}</Text>
    <Group gap="xs" wrap="nowrap" align="flex-start">
      <Code block tabIndex={0} style={{ flex: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{start.command}</Code>
      <Button size="compact-xs" variant="default" leftSection={icon(IconCopy)} aria-label={`Copy the command for ${start.prompt}`} onClick={() => navigator.clipboard?.writeText(start.command).catch(() => {})}>Copy</Button>
    </Group>
  </Stack>
);

export const Section = ({ title, children, id }) => (
  <Stack gap="sm" component="section" aria-label={title} id={id}>
    <Title order={3} size="h3">{title}</Title>
    {children}
  </Stack>
);

export const StateBadge = ({ state }) => (state ? <Badge variant="default" style={{ flexShrink: 0 }} leftSection={<Dot color={STATE_COLOR[state] ?? 'gray'} />}>{state}</Badge> : null);

// Skill installs of a plan, rehearsed on the server in a scratch folder when the user asks (the rehearsal runs third-party
// code): start() begins it, the job state holds results per change id. Leaving the plan stops a rehearsal still running.
// The server runs it in an OS sandbox; where none starts, a result is `unavailable` and anyway() asks for one without.
export function usePrerun(plan) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  // The plan the user asked for: another plan is not asked for, in the same render that shows it.
  const [askedFor, setAskedFor] = useState(null);
  const asked = plan?.planId != null && askedFor?.planId === plan.planId;
  const unconfined = asked && askedFor.unconfined === true;
  const want = plan?.changes.some((c) => c.prerun);
  useEffect(() => {
    setJob(null); setError(null);
  }, [plan?.planId]);
  useEffect(() => {
    if (!want || !asked) return undefined;
    let live = true, id = null;
    setJob(null);
    const cancel = () => id && api('/api/job-cancel', { id }).catch(() => {});
    api('/api/prerun', { planId: plan.planId, ...(unconfined ? { unconfined: true } : {}) }).then((r) => { id = r.job; if (live) setJob(r.job); else cancel(); }, (e) => live && setError(e.message));
    return () => { live = false; cancel(); };
  }, [plan?.planId, want, asked, unconfined]);
  const state = useJob(job);
  return want ? { job, asked, unconfined, start: () => setAskedFor({ planId: plan.planId }), anyway: () => setAskedFor({ planId: plan.planId, unconfined: true }), state: error ? { done: true, error } : state } : null;
}

const WHERE = {
  srt: 'in a sandbox (writes only in a scratch folder, network limited to the registry and GitHub)',
  bwrap: 'in a sandbox that confines writes to a scratch folder',
  'sandbox-exec': 'in a sandbox that confines writes to a scratch folder',
  none: 'in a scratch folder without a sandbox',
};

function Rehearsal({ c, prerun }) {
  const r = prerun.state?.results?.[c.id];
  if (!prerun.asked) return null;
  if (!r) {
    if (!prerun.state?.done) return <Group gap="xs" role="status"><Loader size="xs" /><Text size="sm">Rehearsing in a scratch folder for the files it writes</Text></Group>;
    return <Text size="sm">{prerun.state.cancelled ? 'Preview cancelled.' : `No preview${prerun.state.error ? `: ${prerun.state.error}` : ''}.`}</Text>;
  }
  if (r.unavailable) return <Text size="sm">Preview unavailable: {r.error}.</Text>;
  if (r.error) return <Text size="sm" c="red">Preview failed: {r.error}</Text>;
  if (!r.files.length) return <Text size="sm">Changes no files.</Text>;
  return (
    <Stack gap={4}>
      <Text size="sm">Rehearsed {WHERE[r.sandbox] ?? WHERE.none}, it changes:</Text>
      {r.note && <Text size="sm">Not fully confined: {r.note}.</Text>}
      {r.files.map((f) => <DiffView key={f.path} diff={f.diff} path={f.path} />)}
      {r.more > 0 && <Text size="sm">and {r.more} more files</Text>}
    </Stack>
  );
}

// A change's diff behind a button: a long review page stays short until one is opened.
function Folded({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <Stack gap={4}>
      <Group><Button size="compact-xs" variant="default" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} diff of ${title}`} onClick={() => setOpen(!open)}>{open ? 'Hide diff' : 'Show diff'}</Button></Group>
      {open && children}
    </Stack>
  );
}

// The changes of a plan with their diffs, commands and rehearsed skill installs. With select and setSelect, one
// checkbox per change; changes of one unit go together: toggling one toggles all of them. collapsed: each diff
// (and the files a rehearsal wrote) opens on a button.
export function ChangeList({ plan, select, setSelect, prerun, collapsed = false }) {
  if (!plan.changes.length) return <Text>Nothing to change.</Text>;
  const unitOf = (c) => (c.unit ? plan.changes.filter((x) => x.unit === c.unit).map((x) => x.id) : [c.id]);
  const toggle = (c) => setSelect((s) => (s.includes(c.id) ? s.filter((x) => !unitOf(c).includes(x)) : [...new Set([...s, ...unitOf(c)])]));
  // A unit's changes are listed together under one note, at the place of its first change.
  const units = new Map(), groups = [];
  plan.changes.forEach((c, i) => {
    if (c.unit && units.has(c.unit)) units.get(c.unit).push([c, i]);
    else { const g = [[c, i]]; if (c.unit) units.set(c.unit, g); groups.push(g); }
  });
  const row = ([c, i]) => (
    <Stack key={`${c.id}:${i}`} gap={4}>
      <Group gap="xs" wrap="nowrap" align="flex-start">
        {select ? (
          <Checkbox checked={select.includes(c.id)} disabled={!!c.error || unitOf(c).some((id) => plan.changes.find((x) => x.id === id).error)} onChange={() => toggle(c)}
            label={c.destructive ? `Remove: ${c.title}` : c.title} />
        ) : <Text size="sm" fw={600}>{c.destructive ? `Remove: ${c.title}` : c.title}</Text>}
        <StateBadge state={c.state} />
      </Group>
      {c.error && <Text size="sm" c="red">{c.kind === 'command' ? 'Not applied' : 'Cannot merge'}: {c.error}</Text>}
      {c.kind === 'command' && !c.diff && <Code block tabIndex={0}>{`$ ${c.argv.join(' ')}`}</Code>}
      {(() => {
        const detail = (
          <>
            {(c.kind !== 'command' || c.diff) && (c.diff?.startsWith('copy ') ? <Text size="sm">Copies <Code>{c.diff.slice(5)}</Code></Text> : c.diff ? <DiffView diff={c.diff} path={c.path} /> : null)}
            {c.prerun && prerun && <Rehearsal c={c} prerun={prerun} />}
          </>
        );
        return collapsed && (c.diff || (c.prerun && prerun)) && !c.diff?.startsWith('copy ') ? <Folded title={c.title}>{detail}</Folded> : detail;
      })()}
    </Stack>
  );
  return (
    <Stack gap="sm">
      {prerun && !prerun.asked && (
        <Group gap="xs">
          <Button size="xs" variant="default" onClick={prerun.start}>Preview the files the skill installs write</Button>
          <Text size="sm">Runs the install in a scratch folder: it downloads and runs third-party code.</Text>
        </Group>
      )}
      {prerun?.asked && !prerun.unconfined && Object.values(prerun.state?.results ?? {}).some((r) => r.unavailable) && (
        <Group gap="xs">
          <Button size="xs" variant="default" onClick={prerun.anyway}>Rehearse anyway without a sandbox</Button>
          <Text size="sm">Only HOME and the folder variables point to the scratch folder then; the command can write elsewhere and reach any host.</Text>
        </Group>
      )}
      {prerun && <CancelJob job={prerun.job} state={prerun.state} what="the preview" />}
      {groups.map((g) => (g.length > 1 ? (
        <Stack key={g[0][0].unit} gap="sm" pl="sm" role="group" aria-label={`${g.length} changes that go together`} style={{ borderLeft: '2px solid var(--mantine-color-default-border)' }}>
          <Text size="sm">These {g.length} changes go together.</Text>
          {g.map(row)}
        </Stack>
      ) : row(g[0])))}
    </Stack>
  );
}

// The server runs a removal only with this flag: the user sees each one as a checked "Remove:" item.
export const confirms = (plan, select) => ({ confirmDestructive: plan.changes.some((c) => c.destructive && select?.includes(c.id)) });

export const defaultSelect = (plan) => plan.changes.filter((c) => c.selected && !c.error).map((c) => c.id);

// A plan from the server: its changes (removals off by default), then apply.
export function Plan({ plan, onDone }) {
  const [select, setSelect] = useState(() => defaultSelect(plan));
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(null);
  const prerun = usePrerun(plan);
  if (applied) {
    return (
      <Stack gap="sm">
        <Group justify="flex-end"><Anchor href={href('history', { run: applied.id })}>Open in History</Anchor></Group>
        <RunPanel id={applied.id} output={applied.output} order={3} onChanged={() => onDone?.()} />
      </Stack>
    );
  }
  if (!plan.changes.length) return <Text>Nothing to change.</Text>;
  const run = async () => {
    setBusy(true);
    try { setJob(await api('/api/apply', { planId: plan.planId, select, ...confirms(plan, select) })); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  if (job) return <RunProgress job={job.job} total={job.total} onDone={(run, output) => { if (run) setApplied({ id: run.id, output }); onDone?.(run, output); }} />;
  return (
    <Stack gap="sm">
      {error && <Note color="red" title="Apply failed">{error}</Note>}
      <ChangeList plan={plan} select={select} setSelect={setSelect} prerun={prerun} />
      <Group><Button leftSection={icon(IconPlayerPlay)} onClick={run} loading={busy} disabled={!select.length}>Apply {select.length} changes</Button></Group>
    </Stack>
  );
}


// A started job (apply or eval), polled until it is done. A failed poll is retried; only a lost job (404) or ten
// misses in a row end the view, the job itself goes on.
export function useJob(job, onDone) {
  const [state, setState] = useState(null);
  useEffect(() => {
    // Another job's state must not show under this one.
    setState(null);
    if (!job) return undefined;
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
    poll().catch(console.error);
    return () => { live = false; clearTimeout(timer); };
  }, [job]);
  return state;
}

// Stops a job: an apply after the change that runs, an eval or a suggestion at once.
export function CancelJob({ job, state, what }) {
  const [asked, setAsked] = useState(false);
  if (!state || state.done) return null;
  const cancelling = asked || state.cancelled;
  return (
    <Group>
      <Button size="xs" variant="default" leftSection={icon(IconPlayerStop)} disabled={cancelling}
        onClick={() => { setAsked(true); api('/api/job-cancel', { id: job }).catch(() => setAsked(false)); }}>{cancelling ? 'Cancelling' : `Cancel ${what}`}</Button>
    </Group>
  );
}

// A started apply: each change with its status, the running command's output, then the run.
export function RunProgress({ job, total, onDone }) {
  const state = useJob(job, (s) => onDone?.(s.run, s.output, s));
  const entries = state?.run?.entries ?? [];
  // Each change is journaled as running before it starts.
  const finished = entries.filter((e) => e.status && e.status !== 'running').length;
  const running = !state?.done && entries.find((e) => e.status === 'running');
  const waiting = state?.done ? 0 : Math.max(total - entries.length, 0);
  return (
    <Stack gap="sm" component="section" aria-label="Apply progress">
      <Progress value={total ? (finished / total) * 100 : 100} aria-label="Changes done" color={state?.run?.status === 'failed' || entries.some((e) => e.status === 'failed') ? 'red' : 'teal'} />
      <Text role="status">
        {state?.done ? <>Run <Code>{state.run?.id ?? job}</Code>: {state.error ?? state.run?.status} ({finished} of {total} changes). <Anchor href={href('history', { run: state.run?.id })} underline="always">Open in History</Anchor></>
          : running ? `${finished} of ${total} done. Running: ${running.title}` : `${finished} of ${total} done`}
      </Text>
      <CancelJob job={job} state={state} what="the remaining changes" />
      {state?.error && <Note color="red" title="Apply failed">{state.error}</Note>}
      <Table aria-label="Changes" layout="fixed">
        <Table.Thead><Table.Tr><Table.Th w={124}>Status</Table.Th><Table.Th>Change</Table.Th></Table.Tr></Table.Thead>
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

export function EvalJob({ job, total, onDone }) {
  const s = useJob(job, onDone);
  const at = s?.progress ? s.progress.index + (s.done ? 1 : 0) : 0;
  return (
    <Stack gap="xs">
      <Progress value={(s?.done && !s.error ? total : s?.progress?.index ?? 0) / total * 100} aria-label="Eval sessions done" />
      <CancelJob job={job} state={s} what="evals" />
      <Text role="status">{s?.done ? (s.error === 'cancelled' ? 'Cancelled: targets that finished kept their results' : s.error ? `Failed: ${s.error}` : `Done: ${total} sessions`) : s?.progress ? `Session ${at + 1} of ${total}: ${s.progress.target}, case ${s.progress.case} (${s.progress.agent})` : 'Starting'}</Text>
      {s?.results && (
        <Table aria-label="New eval results">
          <Table.Thead><Table.Tr><Table.Th>Target</Table.Th><Table.Th>Agent</Table.Th><Table.Th>Miss</Table.Th><Table.Th>False trigger</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{s.results.map((r) => <Table.Tr key={`${r.target}${r.agent}`}><Table.Td>{r.target}</Table.Td><Table.Td>{r.agent} {r.agentVersion}</Table.Td><Table.Td>{r.missRate == null ? '-' : `${pct(r.missRate)}%`}</Table.Td><Table.Td>{r.falseTriggerRate == null ? '-' : `${pct(r.falseTriggerRate)}%`}</Table.Td></Table.Tr>)}</Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}
