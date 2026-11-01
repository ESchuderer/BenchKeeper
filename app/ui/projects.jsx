// The Projects view's tools: cards, totals, search, sort and filter chips, bulk actions, name and notes, relocate, the two
// removals, and a new project from a preset.
import { Anchor, Badge, Button, Checkbox, Chip, Code, Group, List, Loader, Modal, NativeSelect, Paper, Select, Stack, Text, TextInput, Textarea, Title } from '@mantine/core';
import { IconFileText, IconFolderSearch, IconPencil, IconRefresh, IconRoute, IconSearch, IconTrash } from '@tabler/icons-react';
import { useEffect, useId, useState } from 'react';
import { api } from './api.js';
import { CHIPS, HEALTH, SORT_OPTIONS, costText, health, label, lags, plural, sparkText, totals } from './cards.js';
import { Swatch } from './dashboard.jsx';
import { UpdateResults } from './fix.jsx';
import { Plan } from './parts.jsx';
import { Note, go, icon, projectHref } from './shell.jsx';

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

// The setup in one line, the packs and the last 30 days: on the card and on the project's Overview.
export function ProjectFacts({ p, card, names }) {
  const a = card?.activity;
  const setup = p.setupVersion ? [p.agents.map((x) => names[x] ?? x).join(', '), p.tier && `tier ${p.tier}`, ...(card?.owner ?? [])].filter(Boolean).join(', ') : null;
  return (
    <>
      {setup ? <Text size="sm">{setup}</Text> : null}
      {!!p.packs?.length && <Group gap={4}>{p.packs.map((x) => <Badge key={x} variant="light" size="sm">{x}</Badge>)}</Group>}
      {a ? (
        <Stack gap={4}>
          <Sparkline a={a} />
          <Text size="sm"><span className="bk-num">{a.sessions}</span> sessions in 30 days{a.change ? ` (${a.change})` : ''}, <span className="bk-num">{costText(a)}</span></Text>
          {a.last && <Text size="sm">Last session {a.last.time.slice(0, 16).replace('T', ' ')}{a.last.tier ? `, tier ${a.last.tier}` : ''}</Text>}
        </Stack>
      ) : card === undefined ? <Text size="sm">Reading sessions</Text> : null}
    </>
  );
}

// The health dot with the doctor finding count.
export const HealthBadge = ({ p, card }) => {
  const h = health(p, card);
  return <Badge variant="default" miw="max-content" leftSection={<Swatch state={HEALTH[h].token} />}>{HEALTH[h].text}{card?.findings ? `, ${plural(card.findings, 'finding')}` : ''}</Badge>;
};

// One project: name and folder, the health dot, the facts and the actions. The name opens the project's own page.
export function ProjectCard({ p, card, names, checked, onCheck, onApply, onUpdate, onRemoveSetup }) {
  const id = useId();
  return (
    <Paper component="article" withBorder p="md" aria-labelledby={id}>
      <Stack gap="sm">
        <Group gap="xs" justify="space-between" wrap="nowrap" align="flex-start">
          <Group gap="xs" wrap="nowrap" align="flex-start" miw={0}>
            <SelectCheckbox p={p} checked={checked} onChange={onCheck} />
            <Stack gap={0} miw={0}>
              <Anchor id={id} href={projectHref(p.path)} fw={650} style={{ overflowWrap: 'anywhere' }}>{label(p)}</Anchor>
              {/* Cut at the start, the end names the folder; bdi keeps the slashes in order inside the right-to-left cut. */}
              <Text size="xs" truncate="start" title={p.path}><bdi>{p.path}</bdi></Text>
            </Stack>
          </Group>
          <HealthBadge p={p} card={card} />
        </Group>
        <ProjectFacts p={p} card={card} names={names} />
        <Group gap="xs">
          <Button size="compact-sm" variant="default" component="a" href={projectHref(p.path)} aria-label={`Details of ${label(p)}`}>Details</Button>
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
        <Text size="sm">Only the list changes: the folders, their files, BenchKeeper's setup in them and the history stay. Add a folder again any time.</Text>
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
async function removeSetups(paths, onProgress) {
  const rows = paths.map((path) => ({ path, status: 'pending' }));
  onProgress([...rows]);
  for (const [i, row] of rows.entries()) {
    rows[i] = { ...row, status: 'running' };
    onProgress([...rows]);
    try { rows[i] = (await api('/api/remove-setup', { paths: [row.path] }))[0] ?? { path: row.path, status: 'stopped', reason: 'no longer registered' }; } catch (e) { rows[i] = { path: row.path, status: 'stopped', reason: e.message }; }
    onProgress([...rows]);
  }
}

// Remove BenchKeeper setup: every file of every project first, then one confirmation. A local setup is one run per
// project with undo in History; a shared one becomes a commit on a local branch.
export function RemoveSetup({ paths, onClose, onDone }) {
  const [plans, setPlans] = useState(null);
  const [progress, setProgress] = useState(null);
  useEffect(() => {
    let live = true;
    const load = (path) => api(`/api/remove-setup-plan?dir=${encodeURIComponent(path)}`).then((p) => ({ path, ...p }), (e) => ({ path, error: e.message, changes: [] }));
    void Promise.all(paths.map(load)).then((r) => live && setPlans(r));
    return () => { live = false; };
  }, [paths]);
  const ready = (plans ?? []).filter((p) => !p.error && p.changes.length);
  const branches = ready.filter((p) => p.shared).length;
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
                <Text size="sm">{p.shared ? 'Shared setup: a commit on branch chore/remove-agent-setup removes these files, for you to push; undo it by deleting the branch.' : 'Local setup: removed in the checkout, as one run you can undo in History.'}</Text>
                <List size="sm" aria-label={`Changes in ${p.path}`}>{p.changes.map((c) => <List.Item key={c.id}>{c.title}</List.Item>)}</List>
              </>
            )}
          </Stack>
        ))}
        {!progress && plans && <Text size="sm">The project's own AGENTS.md text, docs/agents/ and .devcontainer/ stay. The projects stay in the list, as not set up.</Text>}
        {progress && <UpdateResults what="Remove setup" progress={progress} />}
        <Group justify="flex-end">
          <Button variant="default" onClick={close}>{finished ? 'Close' : 'Cancel'}</Button>
          {!progress && <Button leftSection={icon(IconTrash)} disabled={!ready.length} onClick={() => removeSetups(ready.map((p) => p.path), setProgress)}>Remove setup of {plural(ready.length, 'project')}{branches ? ` (${branches} on a branch)` : ''}</Button>}
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

// A new folder from a preset: its plan; after the apply the folder is registered and the check's recommendations come as a
// second plan with no change selected.
export function CreateFromPreset({ onDone, onClose }) {
  const [presets, setPresets] = useState(null);
  const [preset, setPreset] = useState('');
  const [dir, setDir] = useState('');
  const [plan, setPlan] = useState(null);
  const [rec, setRec] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api('/api/presets').then((l) => { setPresets(l); setPreset(l[0]?.id ?? ''); }, (e) => setError(e.message)); }, []);
  const show = async (e) => {
    e.preventDefault();
    setError(null);
    try { setPlan(await api(`/api/create-plan?${new URLSearchParams({ dir, preset })}`)); } catch (x) { setError(x.message); }
  };
  const created = async (run) => {
    // No run: an undo in the run's view; the list reloads and the recommendations no longer apply.
    if (!run) { setRec(null); onDone(); return; }
    // A failed or cancelled run is not registered; the server refuses a folder without its state file.
    if (run.status !== 'done') return;
    try {
      await api('/api/projects', { action: 'add', path: plan.dir, setup: true });
      onDone();
      setRec(await api(`/api/recommendations?${new URLSearchParams({ dir: plan.dir })}`));
    } catch (x) { setError(x.message); }
  };
  if (presets && !presets.length) {
    return <Text size="sm">No presets yet. Save the setup of a project as one: <Code>benchkeeper presets save &lt;id&gt; --project &lt;dir&gt;</Code> <Button size="xs" variant="default" onClick={onClose}>Close</Button></Text>;
  }
  return (
    <Stack gap="sm">
      {!plan ? (
        <form onSubmit={show}>
          <Group align="flex-end">
            <NativeSelect label="Preset" data={(presets ?? []).map((p) => ({ value: p.id, label: `${p.title} (${p.answers.agents.join(', ')}; packs: ${p.answers.packs?.join(', ') || 'none'})` }))} value={preset} onChange={(e) => setPreset(e.currentTarget.value)} />
            <TextInput label="New folder" description="Must not exist yet" placeholder="/home/me/code/new-app" value={dir} onChange={(e) => setDir(e.currentTarget.value)} w={{ base: '100%', sm: 420 }} />
            <Button type="submit" leftSection={icon(IconFileText)} disabled={!dir || !preset}>Show the plan</Button>
            <Button variant="default" onClick={onClose}>Cancel</Button>
          </Group>
        </form>
      ) : (
        <>
          <Text size="sm">The folder <Code>{plan.dir}</Code> from the preset <Code>{preset}</Code>, registered after the apply:</Text>
          <Plan plan={plan} scope="project" onDone={created} onCancel={(on) => on && onClose()} />
        </>
      )}
      {error && <Note color="red" title="Failed">{error}</Note>}
      {rec && (rec.items.length ? (
        <Stack gap="xs" component="section" aria-label="Recommendations">
          <Title order={4}>Recommendations</Title>
          <List size="sm">{rec.items.map((r) => <List.Item key={r.name}>{r.action === 'add' ? 'Add the pack' : 'Turn off the skill'} <Code>{r.name}</Code>: {r.reason}</List.Item>)}</List>
          <Plan plan={rec} scope="project" why="Recommended by the check after creation; nothing is selected" />
        </Stack>
      ) : <Text size="sm" role="status">No recommendations: the new project matches what BenchKeeper knows.</Text>)}
    </Stack>
  );
}

export const MissingBadge = () => <Badge color="red" variant="light" miw="max-content">Folder not found</Badge>;
export const SelectCheckbox = ({ p, checked, onChange }) => <Checkbox aria-label={`Select ${label(p)}`} checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />;
