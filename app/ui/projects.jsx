// The Projects view's tools: cards, totals, search, sort and filter chips, bulk actions, name and notes, relocate, and the two removals.
import { Anchor, Badge, Button, Checkbox, Chip, Code, Group, List, Loader, Modal, Paper, Select, Stack, Text, TextInput, Textarea, Title } from '@mantine/core';
import { IconFolderSearch, IconPencil, IconRefresh, IconRoute, IconSearch, IconTrash } from '@tabler/icons-react';
import { useEffect, useId, useState } from 'react';
import { api } from './api.js';
import { CHIPS, HEALTH, SORT_OPTIONS, costText, health, label, lags, plural, sparkText, totals } from './cards.js';
import { Swatch } from './dashboard.jsx';
import { UpdateResults } from './fix.jsx';
import { Note, go, href, icon } from './shell.jsx';

// The filter row: search, chips (needs attention, no setup, missing folder, each pack and agent in use) and the sort.
export function ProjectFilters({ query, onQuery, sort, onSort, chips, onChips, packs = [], agents = [] }) {
  const chip = (value, text) => <Chip key={value} value={value} size="sm" variant="outline">{text}</Chip>;
  return (
    <Group align="flex-end" gap="sm">
      <TextInput label="Search projects" placeholder="Name, folder or notes" leftSection={icon(IconSearch)} value={query} onChange={(e) => onQuery(e.currentTarget.value)} w={{ base: '100%', sm: 220 }} />
      <Select label="Sort by" data={SORT_OPTIONS} value={sort} onChange={(v) => onSort(v ?? 'added')} allowDeselect={false} w={170} />
      <Chip.Group multiple value={chips} onChange={onChips}>
        <Group gap={6} role="group" aria-label="Filters">
          {Object.entries(CHIPS).map(([v, text]) => chip(v, text))}
          {packs.map((p) => chip(`pack:${p}`, `Pack ${p}`))}
          {agents.map((a) => chip(`agent:${a.value}`, a.label))}
        </Group>
      </Chip.Group>
    </Group>
  );
}

// The header strip: the counts of the cards shown and one bar of their health.
export function ProjectTotals({ list, cards }) {
  const t = totals(list, cards);
  const shown = Object.keys(HEALTH).filter((h) => t.by[h]);
  const fact = (n, text) => <Stack gap={0} key={text}><Text className="bk-num" fz="xl" fw={650}>{n}</Text><Text size="sm">{text}</Text></Stack>;
  return (
    <Paper withBorder p="md" component="section" aria-label="Totals">
      <Stack gap="sm">
        <Group gap="xl">{[fact(t.projects, 'projects'), fact(t.sync, 'in sync'), fact(t.attention, 'need attention'), fact(t.week, 'sessions this week')]}</Group>
        {!!t.projects && <div className="bk-stack" role="img" aria-label={`Projects by health: ${shown.map((h) => `${t.by[h]} ${HEALTH[h].text.toLowerCase()}`).join(', ')}`}>
          {shown.map((h) => <span key={h} title={`${t.by[h]} ${HEALTH[h].text.toLowerCase()}`} style={{ width: `${(t.by[h] / t.projects) * 100}%`, backgroundColor: `var(--bk-h-${HEALTH[h].token})` }} />)}
        </div>}
      </Stack>
    </Paper>
  );
}

// Sessions per day as bars; the label is the text alternative, the numbers beside it repeat the totals.
function Sparkline({ a }) {
  const top = Math.max(1, ...a.perDay);
  return (
    <svg role="img" aria-label={sparkText(a)} viewBox={`0 0 ${a.perDay.length * 4} 24`} preserveAspectRatio="none" width="100%" height={28} style={{ display: 'block' }}>
      {a.perDay.map((n, i) => <rect key={i} x={i * 4} y={24 - Math.max(n ? 3 : 1, (n / top) * 24)} width={3} height={Math.max(n ? 3 : 1, (n / top) * 24)} fill={n ? 'var(--bk-s1)' : 'var(--bk-line)'} />)}
    </svg>
  );
}

// One project: name and folder, the health dot with the doctor finding count, the setup in one line, the last 30 days and
// the actions. The name opens the detail, where name, notes and relocate are.
export function ProjectCard({ p, card, names, checked, onCheck, onApply, onUpdate, onRemoveSetup }) {
  const id = useId();
  const h = health(p, card);
  const a = card?.activity;
  const setup = p.setupVersion ? [p.agents.map((x) => names[x] ?? x).join(', '), p.tier && `tier ${p.tier}`, ...(card?.owner ?? [])].filter(Boolean).join(', ') : null;
  return (
    <Paper component="article" withBorder p="md" aria-labelledby={id}>
      <Stack gap="sm">
        <Group gap="xs" justify="space-between" wrap="nowrap" align="flex-start">
          <Group gap="xs" wrap="nowrap" align="flex-start" miw={0}>
            <SelectCheckbox p={p} checked={checked} onChange={onCheck} />
            <Stack gap={0} miw={0}>
              <Anchor id={id} href={href('projects', { path: p.path })} fw={650} style={{ overflowWrap: 'anywhere' }}>{label(p)}</Anchor>
              {/* Cut at the start, the end names the folder; bdi keeps the slashes in order inside the right-to-left cut. */}
              <Text size="xs" truncate="start" title={p.path}><bdi>{p.path}</bdi></Text>
            </Stack>
          </Group>
          <Badge variant="default" miw="max-content" leftSection={<Swatch state={HEALTH[h].token} />}>{HEALTH[h].text}{card?.findings ? `, ${plural(card.findings, 'finding')}` : ''}</Badge>
        </Group>
        {setup ? <Text size="sm">{setup}</Text> : null}
        {!!p.packs?.length && <Group gap={4}>{p.packs.map((x) => <Badge key={x} variant="light" size="sm">{x}</Badge>)}</Group>}
        {a ? (
          <Stack gap={4}>
            <Sparkline a={a} />
            <Text size="sm"><span className="bk-num">{a.sessions}</span> sessions in 30 days{a.change ? ` (${a.change})` : ''}, <span className="bk-num">{costText(a)}</span></Text>
            {a.last && <Text size="sm">Last session {a.last.time.slice(0, 16).replace('T', ' ')}{a.last.tier ? `, tier ${a.last.tier}` : ''}</Text>}
          </Stack>
        ) : card === undefined ? <Text size="sm">Reading sessions</Text> : null}
        <Group gap="xs">
          <Button size="compact-sm" variant="default" component="a" href={href('projects', { path: p.path })} aria-label={`Details of ${label(p)}`}>Details</Button>
          <Button size="compact-sm" variant="default" onClick={() => go('sessions')}>Open board</Button>
          {p.missing ? null : !p.setupVersion
            ? <Button size="compact-sm" variant="default" aria-label={`Set up ${label(p)}`} onClick={onApply}>Set up</Button>
            : <Button size="compact-sm" variant="default" aria-label={`Apply ${label(p)}`} disabled={!p.changes?.length} onClick={onApply}>Apply</Button>}
          {!p.missing && p.setupVersion && <Button size="compact-sm" variant="default" leftSection={icon(IconRefresh, 14)} aria-label={`Update ${label(p)}`} disabled={p.current && !lags(p)} onClick={onUpdate}>Update</Button>}
          {!p.missing && p.checkout && <Button size="compact-sm" variant="subtle" leftSection={icon(IconTrash, 14)} aria-label={`Remove setup of ${label(p)}`} onClick={onRemoveSetup}>Remove setup</Button>}
        </Group>
      </Stack>
    </Paper>
  );
}

// What the selected projects allow: Update and Remove setup need a setup, Set up needs none, a missing folder neither.
export function BulkBar({ rows, onUpdate, onSetup, onRemoveList, onRemoveSetup, onClear }) {
  const ok = rows.filter((p) => !p.missing);
  const setUp = ok.filter((p) => p.setupVersion), fresh = ok.filter((p) => !p.setupVersion);
  return (
    <Group gap="xs" role="group" aria-label="Selected projects">
      <Text size="sm" fw={600}>{rows.length} selected</Text>
      <Button size="xs" variant="default" disabled={!setUp.length} onClick={onUpdate}>Update</Button>
      <Button size="xs" variant="default" disabled={!fresh.length} onClick={onSetup}>Set up</Button>
      <Button size="xs" variant="default" leftSection={icon(IconTrash, 14)} onClick={onRemoveList}>Remove from list</Button>
      <Button size="xs" variant="default" leftSection={icon(IconTrash, 14)} disabled={!setUp.some((p) => p.checkout)} onClick={onRemoveSetup}>Remove setup</Button>
      <Button size="xs" variant="subtle" onClick={onClear}>Clear selection</Button>
    </Group>
  );
}

// Unregisters: one confirmation that names the count; the folders and their files stay.
export function RemoveFromList({ paths, onClose, onDone }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { await api('/api/projects', { action: 'remove', paths }); onDone(); } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal opened onClose={onClose} withCloseButton={false} attributes={{ content: { 'aria-label': `Remove ${plural(paths.length, 'project')} from the list?` } }}>
      <Stack gap="sm">
        <Title order={2} size="h4">Remove {plural(paths.length, 'project')} from the list?</Title>
        <Text size="sm">Only the list changes. The folders, their files and BenchKeeper's setup in them stay, and so does the history. Add a folder again any time.</Text>
        {paths.length <= 5 && <List size="sm">{paths.map((p) => <List.Item key={p}><Code>{p}</Code></List.Item>)}</List>}
        {error && <Note color="red" title="Failed">{error}</Note>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button leftSection={icon(IconTrash)} loading={busy} onClick={run}>Remove {plural(paths.length, 'project')} from the list</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// One request per project, so each row reports on its own, as in Update all.
async function removeSetups(paths, push, onProgress) {
  const rows = paths.map((path) => ({ path, status: 'pending' }));
  onProgress([...rows]);
  for (const [i, row] of rows.entries()) {
    rows[i] = { ...row, status: 'running' };
    onProgress([...rows]);
    try { rows[i] = (await api('/api/remove-setup', { paths: [row.path], push }))[0] ?? { path: row.path, status: 'stopped', reason: 'no longer registered' }; } catch (e) { rows[i] = { path: row.path, status: 'stopped', reason: e.message }; }
    onProgress([...rows]);
  }
}

// Remove BenchKeeper setup: every file of every project first, then one confirmation. A local setup is one run per
// project with undo in History; a shared one becomes a pull request.
export function RemoveSetup({ paths, push, onClose, onDone }) {
  const [plans, setPlans] = useState(null);
  const [progress, setProgress] = useState(null);
  useEffect(() => {
    let live = true;
    const load = (path) => api(`/api/remove-setup-plan?dir=${encodeURIComponent(path)}`).then((p) => ({ path, ...p }), (e) => ({ path, error: e.message, changes: [] }));
    void Promise.all(paths.map(load)).then((r) => live && setPlans(r));
    return () => { live = false; };
  }, [paths]);
  const ready = (plans ?? []).filter((p) => !p.error && p.changes.length);
  const prs = ready.filter((p) => p.shared).length;
  const finished = progress && progress.every((r) => !['pending', 'running'].includes(r.status));
  const close = () => { if (progress) onDone(); else onClose(); };
  return (
    <Modal opened onClose={close} size="lg" withCloseButton={false} attributes={{ content: { 'aria-label': `Remove the BenchKeeper setup of ${plural(paths.length, 'project')}` } }}>
      <Stack gap="sm">
        <Title order={2} size="h4">Remove the BenchKeeper setup of {plural(paths.length, 'project')}</Title>
        {!plans && <Group gap="xs" role="status"><Loader size="xs" /><Text size="sm">Reading the files</Text></Group>}
        {!progress && plans?.map((p) => (
          <Stack key={p.path} gap={4} component="section" aria-label={`Files in ${p.path}`}>
            <Title order={3} size="h5" style={{ overflowWrap: 'anywhere' }}>{p.path}</Title>
            {p.error && <Text size="sm" c="red">{p.error}</Text>}
            {!p.error && !p.changes.length && <Text size="sm">No BenchKeeper setup to remove.</Text>}
            {!p.error && !!p.changes.length && (
              <>
                <Text size="sm">{p.shared ? 'Shared setup: a pull request removes these files; undo it by closing the pull request.' : 'Local setup: removed in the checkout, as one run you can undo in History.'}</Text>
                <List size="sm" aria-label={`Changes in ${p.path}`}>{p.changes.map((c) => <List.Item key={c.id}>{c.title}</List.Item>)}</List>
              </>
            )}
          </Stack>
        ))}
        {!progress && plans && <Text size="sm">The project's own AGENTS.md text, docs/agents/ and .devcontainer/ stay. The projects stay in the list, as not set up.</Text>}
        {progress && <UpdateResults what="Remove setup" progress={progress} />}
        <Group justify="flex-end">
          <Button variant="default" onClick={close}>{finished ? 'Close' : 'Cancel'}</Button>
          {!progress && <Button leftSection={icon(IconTrash)} disabled={!ready.length} onClick={() => removeSetups(ready.map((p) => p.path), push, setProgress)}>Remove setup of {plural(ready.length, 'project')}{prs ? ` (${plural(prs, 'pull request')})` : ''}</Button>}
        </Group>
      </Stack>
    </Modal>
  );
}

// Display name and notes: kept in projects.json, never written into the repository.
export function EditProject({ project, onDone, onClose }) {
  const [name, setName] = useState(project.name ?? '');
  const [notes, setNotes] = useState(project.notes ?? '');
  const [error, setError] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    try { await api('/api/projects', { action: 'rename', path: project.path, name, notes }); onDone(); } catch (x) { setError(x.message); }
  };
  return (
    <form onSubmit={save} aria-label="Project details">
      <Stack gap="xs">
        <TextInput label="Display name" description={`Shown instead of ${project.path.split('/').pop()}; empty uses the folder name`} value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={80} />
        <Textarea label="Notes" description="Kept in the BenchKeeper list only, not in the repository" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} maxLength={2000} autosize minRows={2} />
        {error && <Note color="red" title="Not saved">{error}</Note>}
        <Group>
          <Button type="submit" leftSection={icon(IconPencil)}>Save</Button>
          <Button variant="default" onClick={onClose}>Cancel</Button>
        </Group>
      </Stack>
    </form>
  );
}

// A folder that moved or was renamed: choose where it is now; the answers and the history follow.
export function Relocate({ project, onDone, onClose }) {
  const [to, setTo] = useState('');
  const [error, setError] = useState(null);
  const choose = async () => {
    const r = await api('/api/pick-folder', {});
    if (r.unavailable) setError('No folder dialog: type the path.');
    else if (r.path) setTo(r.path);
  };
  const run = async (e) => {
    e.preventDefault();
    try { await api('/api/projects', { action: 'relocate', path: project.path, to }); onDone(); } catch (x) { setError(x.message); }
  };
  return (
    <form onSubmit={run} aria-label="Relocate">
      <Stack gap="xs">
        <TextInput label="New folder" description="The setup's answers, the notes and the history move to it" placeholder="Where the folder is now" value={to} onChange={(e) => setTo(e.currentTarget.value)} />
        {error && <Note color="red" title="Not relocated">{error}</Note>}
        <Group>
          <Button type="submit" leftSection={icon(IconRoute)} disabled={!to}>Relocate</Button>
          <Button variant="default" leftSection={icon(IconFolderSearch)} onClick={() => choose().catch((x) => setError(x.message))}>Choose folder</Button>
          <Button variant="default" onClick={onClose}>Cancel</Button>
        </Group>
      </Stack>
    </form>
  );
}

// Notices after adding: the folder lies inside a registered project, or is another worktree of a registered repository
// (not added until the user says so).
export function AddNotices({ inside, worktree, onAddWorktree, onDismiss }) {
  return (
    <>
      {inside && <Note color="yellow" withCloseButton onClose={onDismiss} closeButtonLabel="Dismiss">Added, but <Code>{inside.path}</Code> lies inside the registered project <Code>{inside.of}</Code>.</Note>}
      {worktree && (
        <Note color="yellow">
          <Stack gap="xs" align="flex-start">
            <Text size="sm"><b>Same repository, other worktree.</b> <Code>{worktree.path}</Code> is another worktree of the repository of <Code>{worktree.of}</Code>, which is registered. Not added as a second project.</Text>
            <Group gap="xs">
              <Button size="xs" variant="default" onClick={onAddWorktree}>Add as a second project</Button>
              <Button size="xs" variant="default" onClick={onDismiss}>Keep one</Button>
            </Group>
          </Stack>
        </Note>
      )}
    </>
  );
}

export const MissingBadge = () => <Badge color="red" variant="light" miw="max-content">Folder not found</Badge>;
export const SelectCheckbox = ({ p, checked, onChange }) => <Checkbox aria-label={`Select ${label(p)}`} checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />;
