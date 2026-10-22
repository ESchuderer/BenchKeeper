import { Anchor, Badge, Button, Code, Group, List, Paper, SegmentedControl, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconArrowBackUp, IconCircleCheck, IconCircleX, IconHandStop, IconPlayerSkipForward, IconProgress } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { api } from './api.js';
import { parseDiff, sideBySide } from './diff.js';
import { Loading, StatusBadge, useApi } from './parts.jsx';
import { Dot, Note, href, icon } from './shell.jsx';
import './run.css';

export const note = (r) => (r.note?.case ? `eval case ${r.note.case} for ${r.note.target}` : r.note?.updateAll ? `Update all of ${r.note.updateAll}` : r.of ? `undo of ${r.of}` : '');
export const when = (t) => new Date(t).toLocaleString();
const base = (p) => p.split(/[\\/]/).filter(Boolean).at(-1) ?? p;
export const runTitle = (r) => `${r.kind === 'undo' ? 'Undo' : r.kind === 'session' ? 'Agent session' : 'Apply'}: ${r.scope === 'global' ? 'global setup' : base(r.scope)}`;

const STATUS = { done: [IconCircleCheck, 'teal'], failed: [IconCircleX, 'red'], skipped: [IconPlayerSkipForward, 'gray'], cancelled: [IconPlayerSkipForward, 'gray'], manual: [IconHandStop, 'yellow'], running: [IconProgress, 'blue'] };
export const StatusIcon = ({ status }) => {
  const [I, color] = STATUS[status] ?? STATUS.running;
  return <ThemeIcon variant="light" color={color} size="md" radius="xl" aria-hidden="true" style={{ flexShrink: 0 }}><I size={18} stroke={1.75} /></ThemeIcon>;
};

// Split or unified, kept per browser; without storage it lasts the page.
export function useDiffMode() {
  const [mode, set] = useState(() => { try { return localStorage.getItem('bk-diff') === 'split' ? 'split' : 'unified'; } catch { return 'unified'; } });
  return [mode, (m) => { set(m); try { localStorage.setItem('bk-diff', m); } catch { /* not kept */ } }];
}

const LIMIT = 80;
const cls = (l) => (!l ? 'none' : l.kind === '+' ? 'add' : l.kind === '-' ? 'del' : '');
const sign = (l) => (l.kind === ' ' ? ' ' : l.kind);

// A file's diff with line numbers. Split needs room and both sides: created and deleted files stay unified.
export function DiffView({ diff, path, mode = 'unified' }) {
  const d = useMemo(() => parseDiff(diff), [diff]);
  const [all, setAll] = useState(false);
  const wide = useMediaQuery('(min-width: 62em)');
  const oneSided = d.hunks.length === 1 && /^@@ -0,0 |\+0,0 @@/.test(d.hunks[0].head);
  const split = mode === 'split' && wide && !oneSided;
  const rows = d.hunks.flatMap((h) => [{ head: h.head }, ...(split ? sideBySide(h.lines) : h.lines)]);
  const shown = all ? rows : rows.slice(0, LIMIT);
  return (
    <div className="bk-diff">
      <Group className="bk-diff-head" justify="space-between" wrap="nowrap" gap="xs">
        <Text size="xs" ff="monospace" style={{ overflowWrap: 'anywhere' }}>{path}</Text>
        <Text size="xs" ff="monospace" style={{ flexShrink: 0 }}><span className="bk-plus">+{d.added}</span> <span className="bk-minus">-{d.removed}</span></Text>
      </Group>
      <div className="bk-diff-body" tabIndex={0} role="group" aria-label={`Diff of ${path}`}>
        <table>
          <tbody>
            {shown.map((r, i) => (r.head ? <tr key={i} className="hunk"><td colSpan={split ? 4 : 3}>{r.head}</td></tr>
              : split ? (
                <tr key={i}>
                  <td className={`n ${cls(r.old)}`}>{r.old?.a}</td><td className={`t ${cls(r.old)}`}>{r.old && `${sign(r.old)} ${r.old.text}`}</td>
                  <td className={`n ${cls(r.new)}`}>{r.new?.b}</td><td className={`t ${cls(r.new)}`}>{r.new && `${sign(r.new)} ${r.new.text}`}</td>
                </tr>
              ) : (
                <tr key={i} className={cls(r)}>
                  <td className="n">{r.a}</td><td className="n">{r.b}</td><td className="t">{`${sign(r)} ${r.text}`}</td>
                </tr>
              )))}
          </tbody>
        </table>
      </div>
      {rows.length > LIMIT && <Button size="compact-xs" variant="subtle" m={4} onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all ${rows.length} lines`}</Button>}
    </div>
  );
}

const FILE_STATUS = { A: 'added', D: 'deleted', M: 'changed' };
const undoable = (e) => (e.status === 'done' || e.touched) && !e.undone;

function EntryBody({ e, mode }) {
  if (e.diff) return <DiffView diff={e.diff} path={e.path} mode={mode} />;
  if (e.kind === 'write' && e.status === 'done') {
    return <Text size="sm">{e.folder ? <>Copied the folder <Code>{e.path}</Code>.</> : <><Code>{e.path}</Code> changed since, so its diff is not shown.</>}</Text>;
  }
  if (e.kind === 'remove' && e.status === 'done') return <Text size="sm">Moved <Code>{e.path}</Code> to the run's backup.</Text>;
  if (e.argv) {
    return (
      <Stack gap={4}>
        <Code block tabIndex={0}>{`$ ${e.argv.join(' ')}${e.output ? `\n${e.output}` : ''}`}</Code>
        {e.exit != null && <Text size="xs">Exit code {e.exit}</Text>}
      </Stack>
    );
  }
  if (e.kind === 'session') {
    return e.files.length ? (
      <Stack gap="xs">
        {e.files.map((f) => (f.diff ? <DiffView key={f.path} diff={f.diff} path={f.path} mode={mode} /> : <Text key={f.path} size="sm"><Code>{f.path}</Code> {FILE_STATUS[f.status] ?? f.status}, no text diff</Text>))}
      </Stack>
    ) : <Text size="sm">The session changed no files.</Text>;
  }
  if (e.files?.length) return <List size="sm" spacing={2}>{e.files.map((f) => <List.Item key={f.path}>Restored <Code>{f.path}</Code></List.Item>)}</List>;
  return null;
}

// One run as a report: what it did to each file and command, with undo per step and for the run.
export function RunReport({ run: r, onUndo, busy, order = 2 }) {
  const [mode, setMode] = useDiffMode();
  const diffs = r.entries.flatMap((e) => [e.diff, ...(e.files ?? []).map((f) => f.diff)]).filter(Boolean);
  const lines = useMemo(() => diffs.map(parseDiff).reduce((s, d) => ({ added: s.added + d.added, removed: s.removed + d.removed }), { added: 0, removed: 0 }), [r]);
  const statuses = Object.entries(Object.groupBy(r.entries, (e) => e.reason === 'cancelled' ? 'cancelled' : e.status ?? 'running'));
  const firstOfStep = (e, i) => r.entries.findIndex((x) => x.step === e.step) === i;
  return (
    <Stack gap="md" component="section" aria-label={`Run ${r.id}`}>
      <Group justify="space-between" align="flex-start" gap="sm">
        <Stack gap={4} style={{ minWidth: 0 }}>
          <Group gap="xs"><StatusIcon status={r.status ?? 'running'} /><Title order={order} size="h3">{runTitle(r)}</Title></Group>
          <Text size="sm">{when(r.time)}, run <Code>{r.id}</Code>{note(r) && `, ${note(r)}`}{r.status ? '' : ', interrupted'}</Text>
        </Stack>
        <Group gap="xs">
          {!!diffs.length && <SegmentedControl size="xs" aria-label="Diff layout" styles={{ label: { transition: 'none' } }} value={mode} onChange={setMode} data={[{ label: 'Unified', value: 'unified' }, { label: 'Split', value: 'split' }]} />}
          {onUndo && <Button size="xs" leftSection={icon(IconArrowBackUp)} variant="default" loading={busy} disabled={!r.entries.some(undoable)} onClick={() => onUndo({ run: r.id })}>Undo run</Button>}
        </Group>
      </Group>
      <Group gap="xs" role="group" aria-label="Summary">
        {statuses.map(([s, es]) => <Badge key={s} variant="default" leftSection={<Dot color={STATUS[s]?.[1] ?? 'gray'} />}>{es.length} {s}</Badge>)}
        {!!diffs.length && <Badge variant="default">{diffs.length} file{diffs.length === 1 ? '' : 's'}, +{lines.added} -{lines.removed} lines</Badge>}
      </Group>
      {r.entries.map((e, i) => (
        <Paper key={i} withBorder p="sm" radius="md" component="article" aria-label={e.title}>
          <Stack gap="xs">
            <Group justify="space-between" align="flex-start" gap="xs">
              <Group gap="xs" wrap="nowrap" align="flex-start" style={{ flex: '1 1 16rem', minWidth: 0 }}>
                <StatusIcon status={e.reason === 'cancelled' ? 'cancelled' : e.status} />
                <Stack gap={0} style={{ minWidth: 0 }}>
                  <Text size="sm" fw={600} style={{ overflowWrap: 'anywhere' }}>{e.title}</Text>
                  <Text size="xs">{e.step}{e.undone ? `, undone by ${e.undone}` : ''}</Text>
                </Stack>
              </Group>
              <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
                <StatusBadge status={e.status ?? 'running'} />
                {onUndo && firstOfStep(e, i) && undoable(e) && <Button size="compact-xs" variant="subtle" leftSection={icon(IconArrowBackUp, 14)} disabled={busy} aria-label={`Undo step ${e.step}`} onClick={() => onUndo({ run: r.id, step: e.step })}>Undo step</Button>}
              </Group>
            </Group>
            {(e.error || e.reason) && <Text size="sm" c={e.error ? 'red' : undefined}>{e.error ?? e.reason}</Text>}
            <EntryBody e={e} mode={mode} />
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
}

// A run loaded by id, with undo. onChanged runs after an undo, for counts elsewhere.
export function RunPanel({ id, onChanged, order }) {
  const run = useApi(`/api/run?id=${encodeURIComponent(id)}`);
  const [undone, setUndone] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const undo = async (body) => {
    setError(null);
    setBusy(true);
    try { setUndone(await api('/api/undo', body)); run.reload(); onChanged?.(); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <Stack gap="md">
      {error && <Note color="red" title="Undo failed">{error}</Note>}
      {undone && (
        <Note color={undone.status === 'failed' ? 'red' : 'teal'} title={undone.status === 'failed' ? 'Undo failed' : 'Undone'}>
          {undone.entries.filter((e) => e.status === 'done').length} of {undone.entries.length} changes undone, see run <Anchor href={href('history', { run: undone.id })}>{undone.id}</Anchor>.
        </Note>
      )}
      <Loading state={run} label="run">{(r) => <RunReport run={r} onUndo={undo} busy={busy} order={order} />}</Loading>
    </Stack>
  );
}
