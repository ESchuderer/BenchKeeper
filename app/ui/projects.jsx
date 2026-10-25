// The Projects view's tools: search, sort and filter, bulk actions, name and notes, relocate, and the two removals.
import { Badge, Button, Checkbox, Code, Group, List, Loader, Modal, Select, Stack, Text, TextInput, Textarea, Title } from '@mantine/core';
import { IconFolderSearch, IconPencil, IconRoute, IconSearch, IconTrash } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { UpdateResults } from './fix.jsx';
import { Note, icon } from './shell.jsx';

export const label = (p) => p.name || p.path.split('/').pop();
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

const FILTERS = {
  all: ['All projects', () => true],
  'not-set-up': ['Not set up', (p) => !p.missing && !p.setupVersion],
  behind: ['Behind', (p, version) => !!p.setupVersion && p.setupVersion !== version],
  local: ['Local setup', (p) => !!p.setupVersion && !p.share],
  shared: ['Shared setup', (p) => p.share === true],
  missing: ['Folder not found', (p) => p.missing === true],
  changes: ['Has changes', (p) => !!p.changes?.length],
};
export const FILTER_OPTIONS = Object.entries(FILTERS).map(([value, [text]]) => ({ value, label: text }));
// Missing first, then not set up, behind, current: what needs attention comes first.
const setupRank = (p, version) => { if (p.missing) return 0; if (!p.setupVersion) return 1; return p.setupVersion === version ? 3 : 2; };
const SORTS = {
  added: ['Order added', () => 0],
  name: ['Name', (a, b) => label(a).localeCompare(label(b))],
  setup: ['Setup state', (a, b, version) => setupRank(a, version) - setupRank(b, version)],
  last: ['Last change', (a, b) => (b.last ?? '').localeCompare(a.last ?? '')],
};
export const SORT_OPTIONS = Object.entries(SORTS).map(([value, [text]]) => ({ value, label: text }));

// The rows to show: search over name, folder and notes, then the filter, then the sort (a stable one, so ties and the
// default keep the order the projects were added in).
export function visibleProjects(list, { query = '', sort = 'added', filter = 'all', pack = '', agent = '', version } = {}) {
  const q = query.trim().toLowerCase();
  const match = FILTERS[filter]?.[1] ?? FILTERS.all[1];
  const rows = list.filter((p) => match(p, version) && (!pack || p.packs?.includes(pack)) && (!agent || p.agents?.includes(agent)) && (!q || [label(p), p.path, p.notes ?? ''].some((t) => t.toLowerCase().includes(q))));
  const by = SORTS[sort]?.[1] ?? SORTS.added[1];
  return rows.map((p, i) => ({ p, i })).sort((a, b) => by(a.p, b.p, version) || a.i - b.i).map(({ p }) => p);
}

export function ProjectFilters({ query, onQuery, sort, onSort, filter, onFilter, pack, onPack, packs = [], agent, onAgent, agents = [] }) {
  return (
    <Group align="flex-end" gap="sm">
      <TextInput label="Search projects" placeholder="Name, folder or notes" leftSection={icon(IconSearch)} value={query} onChange={(e) => onQuery(e.currentTarget.value)} w={{ base: '100%', sm: 220 }} />
      <Select label="Show" data={FILTER_OPTIONS} value={filter} onChange={(v) => onFilter(v ?? 'all')} allowDeselect={false} w={170} />
      <Select label="Pack" placeholder="Any pack" clearable data={packs} value={pack || null} onChange={(v) => onPack(v ?? '')} w={150} />
      <Select label="Agent" placeholder="Any agent" clearable data={agents} value={agent || null} onChange={(v) => onAgent(v ?? '')} w={150} />
      <Select label="Sort by" data={SORT_OPTIONS} value={sort} onChange={(v) => onSort(v ?? 'added')} allowDeselect={false} w={170} />
    </Group>
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
