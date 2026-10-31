import { Anchor, Badge, Button, Checkbox, Code, Drawer, FileButton, Group, List, Loader, Modal, NavLink, Progress, SegmentedControl, Select, SimpleGrid, Stack, Switch, Table, Text, TextInput, Title, Tooltip, VisuallyHidden, useComputedColorScheme } from '@mantine/core';
import { IconDeviceFloppy, IconDownload, IconFolderSearch, IconFolders, IconListCheck, IconPackage, IconPlus, IconRefresh, IconTrash, IconUpload } from '@tabler/icons-react';
import { Component, Suspense, lazy, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Cli, Plan, Section, StateBadge, useJob } from './parts.jsx';
import { RunPanel, StatusIcon, note, runTitle, when } from './run.jsx';
import { UpdateResults } from './fix.jsx';
import { ATTENTION } from './dashboard.jsx';
import { updateProjects } from './update.js';
import { ProjectSetup } from './setup.jsx';
import { SkillStates } from './skillstates.jsx';
import { SessionsHistory } from './sessionscache.jsx';
import { Surfaces } from './runs.jsx';
import { AddNotices, BulkBar, MissingBadge, ProjectCard, ProjectFilters, ProjectTotals, RemoveFromList, RemoveSetup, SelectCheckbox } from './projects.jsx';
import { chipsOf, label, lags, plural, visibleProjects } from './cards.js';
import { Dot, Folded, Loading, MOD, Note, SplitView, download, groupBy, href, icon, projectHref, useAnnounce, useApi } from './shell.jsx';

// The charts load with the first eval view or skill with results, not with the first page.
const EvalResults = lazy(() => import('./evals.jsx').then((m) => ({ default: m.EvalResults })));
const EvalsPage = lazy(() => import('./evals.jsx').then((m) => ({ default: m.Evals })));
const LoadingCharts = <Group gap="xs"><Loader size="sm" /><Text size="sm">Loading charts</Text></Group>;
// The chunk can fail to load: offline, or the server runs a newer build than this page.
class ChartsBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <Note color="red" title="Charts did not load"><Group gap="sm">Reload the page; if BenchKeeper was updated, it needs the new one.<Button size="xs" variant="default" onClick={() => window.location.reload()}>Reload</Button></Group></Note>
      : this.props.children;
  }
}
const Charts = ({ children }) => <ChartsBoundary><Suspense fallback={LoadingCharts}>{children}</Suspense></ChartsBoundary>;
export const Evals = (props) => <Charts><EvalsPage {...props} /></Charts>;

export { Dashboard } from './dashboard.jsx';

function PackBuilder({ opened, onClose, skills, onRemove, onSaved }) {
  const [id, setId] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState(null);
  const [status, announce] = useAnnounce();
  const warn = useApi(skills.length ? `/api/pack-warnings?skills=${skills.map(encodeURIComponent).join(',')}` : null);
  const save = async () => {
    setError(null);
    try { await api('/api/packs', { action: 'save', id, title, skills }); setId(''); setTitle(''); onSaved(); } catch (e) { setError(e.message); }
  };
  return (
    // No Drawer title: its <header> would be a second banner landmark.
    <Drawer opened={opened} onClose={onClose} position="right" withCloseButton={false} attributes={{ content: { 'aria-label': 'Build a pack' } }}>
      <Stack gap="sm">
        <Group justify="space-between"><Title order={2} size="h3">Build a pack</Title><Button variant="subtle" onClick={onClose}>Close</Button></Group>
        <TextInput label="Pack id: lowercase letters, digits and dashes" value={id} onChange={(e) => setId(e.currentTarget.value)} />
        <TextInput label="Title" value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
        <Text fw={600} id="pack-skills" tabIndex={-1}>Skills ({skills.length})</Text>
        {status}
        {skills.length ? skills.map((n) => (
          <Group key={n} justify="space-between" wrap="nowrap"><Text size="sm">{n}</Text><Button leftSection={icon(IconTrash)} size="xs" variant="default" onClick={() => { onRemove(n); announce('pack-skills', `Removed: ${n}`); }} aria-label={`Remove ${n}`}>Remove</Button></Group>
        )) : <Text size="sm">Choose skills with the checkboxes in the list.</Text>}
        {warn.data?.map((w) => <Note key={w} color="yellow">{w}</Note>)}
        {error && <Note color="red" title="Save failed">{error}</Note>}
        <Group><Button leftSection={icon(IconDeviceFloppy)} onClick={save} disabled={!id || !skills.length}>Save pack</Button></Group>
        <Cli>{`benchkeeper packs save ${id || '<id>'} ${skills.map((n) => `--skill ${n}`).join(' ')}`}</Cli>
      </Stack>
    </Drawer>
  );
}

// Files in the packs folder that are no pack: the library leaves them out, so they are listed here to be removed (the file goes to the backups).
function InvalidPacks({ files, onChange, announce }) {
  const [error, setError] = useState(null);
  // This section goes with its last file: focus then moves to the Packs heading.
  const remove = async (file) => {
    setError(null);
    try { await api('/api/packs', { action: 'remove', id: file }); onChange(); announce(files.length > 1 ? 'invalid-packs-title' : 'packs-title', `Removed: ${file}`); } catch (e) { setError(e.message); }
  };
  return (
    <Section title="Pack files that are not packs" id="invalid-packs">
      {error && <Note color="red" title="Failed">{error}</Note>}
      {files.map(({ file, reason }) => (
        <Group key={file} justify="space-between" wrap="nowrap">
          <Text size="sm"><Code>{file}</Code>: {reason}</Text>
          <Button leftSection={icon(IconTrash)} size="xs" variant="subtle" aria-label={`Remove ${file}`} onClick={() => remove(file)}>Remove</Button>
        </Group>
      ))}
    </Section>
  );
}

function Packs({ packs, onChange, announce }) {
  const [error, setError] = useState(null);
  const [file, setFile] = useState(0);
  // A pack file whose id is an own pack's: asked first, the old file goes to the backup.
  const [replace, setReplace] = useState(null);
  const run = (f) => async (...a) => { setError(null); try { await f(...a); onChange(); } catch (e) { setError(e.message); } };
  const importText = run(async (text) => { setReplace(null); await api('/api/packs', { action: 'import', text }); setFile((n) => n + 1); });
  return (
    <Section title="Packs" id="packs">
      {error && <Note color="red" title="Failed">{error}</Note>}
      <Table.ScrollContainer minWidth={520}>
        <Table aria-label="Packs">
          <Table.Thead><Table.Tr><Table.Th>Pack</Table.Th><Table.Th>Contents</Table.Th><Table.Th>Source</Table.Th><Table.Th>Used by</Table.Th><Table.Th>Actions</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {packs.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>{p.title ?? p.id}<Text size="xs">{p.id}</Text></Table.Td>
                <Table.Td>{p.skills?.join(', ') ?? `plugin: ${Object.values(p.plugins ?? {}).map((x) => x.id).join(', ')}`}</Table.Td>
                <Table.Td>{p.own ? 'own' : 'library'}</Table.Td>
                <Table.Td>{p.usedBy?.length ? p.usedBy.map((d) => d.split('/').pop()).join(', ') : '-'}</Table.Td>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    {p.skills && <Button leftSection={icon(IconDownload)} size="xs" variant="default" aria-label={`Export ${p.id}`} onClick={run(async () => { const r = await api(`/api/pack-export?id=${encodeURIComponent(p.id)}`); download(r.name, r.text); })}>Export</Button>}
                    {p.own && <Button leftSection={icon(IconTrash)} size="xs" variant="subtle" aria-label={`Remove ${p.id}`} disabled={!!p.usedBy?.length} title={p.usedBy?.length ? `In use by ${p.usedBy.join(', ')}: switch it off there first` : undefined} onClick={run(async () => { await api('/api/packs', { action: 'remove', id: p.id }); announce('packs-title', `Removed: ${p.id}`); })}>Remove</Button>}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Group>
        <FileButton key={file} accept="application/json,.json"
          onChange={async (f) => {
            if (!f) return;
            setError(null);
            let text;
            try { text = await f.text(); } catch (e) { setError(e.message); return; }
            let id; try { id = JSON.parse(text).id; } catch { /* the server names what is wrong */ }
            if (packs.some((p) => p.own && p.id === id)) setReplace({ id, text }); else await importText(text);
          }}>
          {(props) => <Button leftSection={icon(IconUpload)} variant="default" {...props}>Import pack file</Button>}
        </FileButton>
      </Group>
      <Modal opened={!!replace} onClose={() => { setReplace(null); setFile((n) => n + 1); }} withCloseButton={false} attributes={{ content: { 'aria-label': `Replace pack ${replace?.id}?` } }}>
        <Stack gap="sm">
          <Title order={2} size="h4">Replace pack {replace?.id}?</Title>
          <Text size="sm">An own pack with this id exists. Its file goes to the run backups, as when a pack is removed.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => { setReplace(null); setFile((n) => n + 1); }}>Cancel</Button>
            <Button onClick={() => importText(replace.text)}>Replace pack {replace?.id}</Button>
          </Group>
        </Stack>
      </Modal>
    </Section>
  );
}

export function Catalog({ catalog, params, refresh }) {
  const evals = useApi('/api/evals');
  const [q, setQ] = useState('');
  const [pack, setPack] = useState(params.get('pack'));
  const [agent, setAgent] = useState(params.get('agent'));
  const [used, setUsed] = useState(null);
  const [picked, setPicked] = useState([]);
  const [builder, setBuilder] = useState(false);
  // Here and not in the packs sections: the section of files that are not packs goes with its last file.
  const [status, announce] = useAnnounce();
  const open = params.get('skill');
  const flip = (n) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));
  return (
    <Loading state={catalog} label="catalog">{(c) => {
      const inPack = pack && c.packs.find((p) => p.id === pack)?.skills;
      const skills = c.skills.filter((s) => (!q || `${s.name} ${s.pickWhen}`.toLowerCase().includes(q.toLowerCase()))
        && (!inPack || inPack.includes(s.name)) && (!agent || (agent === 'codex' ? true : s.agents !== 'codex'))
        && (!used || (used === 'used' ? s.projects > 0 : s.projects === 0)));
      const skill = c.skills.find((s) => s.name === open);
      return (
        <Stack gap="lg">
          <Group align="flex-end">
            <TextInput label="Search" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
            <Select label="Pack" placeholder="All packs" clearable value={pack} onChange={setPack} data={c.packs.filter((p) => p.skills).map((p) => ({ value: p.id, label: `${p.title ?? p.id}${p.own ? ' (own)' : ''}` }))} />
            <Select label="Agent" placeholder="All agents" clearable value={agent} onChange={setAgent} data={[{ value: 'claude', label: 'Claude Code' }, { value: 'codex', label: 'Codex' }]} />
            <Select label="Install state" placeholder="Any" clearable value={used} onChange={setUsed} data={[{ value: 'used', label: 'In a project' }, { value: 'unused', label: 'In no project' }]} />
            <Button leftSection={icon(IconPackage)} variant="default" onClick={() => setBuilder(true)}>Build pack ({picked.length})</Button>
          </Group>
          <SplitView empty="Choose a skill for its source, pin and eval results." list={
            <Table aria-label="Skills">
              <Table.Thead><Table.Tr><Table.Th>Pack</Table.Th><Table.Th>Skill</Table.Th><Table.Th>Projects</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {skills.map((s) => (
                  <Table.Tr key={s.name}>
                    <Table.Td><Checkbox size="md" aria-label={`Add ${s.name} to the pack`} checked={picked.includes(s.name)} onChange={() => flip(s.name)} /></Table.Td>
                    <Table.Td><Anchor href={href('catalog', { skill: s.name })} aria-current={s.name === open ? 'true' : undefined} fw={s.name === open ? 700 : undefined} style={{ whiteSpace: 'nowrap' }}>{s.name}</Anchor></Table.Td>
                    <Table.Td>{s.projects}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          } detail={skill ? <SkillDetail key={skill.name} skill={skill} results={evals.data?.filter((r) => r.target === `skill:${skill.name}`) ?? []} /> : null} />
          <SkillStates refresh={refresh} />
          <Packs packs={c.packs} onChange={refresh} announce={announce} />
          {c.invalidPacks?.length > 0 && <InvalidPacks files={c.invalidPacks} onChange={refresh} announce={announce} />}
          {status}
          <PackBuilder opened={builder} onClose={() => setBuilder(false)} skills={picked} onRemove={flip} onSaved={() => { setBuilder(false); setPicked([]); refresh(); }} />
          <Cli>{`benchkeeper packs list\nbenchkeeper projects apply --pack ${pack ?? '<id>'}${open ? ` --skill ${open}` : ''}\nbenchkeeper skills list --project <dir>\nbenchkeeper skills update|reset|remove|adopt|enable|disable <name> --project <dir>`}</Cli>
        </Stack>
      );
    }}</Loading>
  );
}

function SkillDetail({ skill, results }) {
  const text = useApi(skill.source === 'own' ? `/api/skill?name=${encodeURIComponent(skill.name)}` : null);
  return (
    <Stack gap="xs" component="section" aria-label={`Skill ${skill.name}`}>
      <Group justify="space-between"><Title order={3} size="h3">{skill.name}</Title><Button component="a" href={href('catalog')} variant="subtle">Close</Button></Group>
      <Text>{skill.pickWhen}</Text>
      <Text size="sm">Source: {skill.source === 'own' ? 'BenchKeeper' : <Anchor href={`https://github.com/${skill.source}/tree/${skill.ref}`} target="_blank" rel="noreferrer">{skill.source}</Anchor>}{skill.ref && <>, pinned at <Code>{skill.ref.slice(0, 12)}</Code></>}{skill.license && `, ${skill.license}`}</Text>
      {skill.agents === 'codex' && <Badge variant="default">Codex only</Badge>}
      {results.length ? <Charts><EvalResults results={results} /></Charts> : <Text size="sm">No eval results for this skill. Measurements: <Anchor href="https://github.com/ESchuderer/BenchKeeper-research/blob/main/EVALUATIONS.md" target="_blank" rel="noreferrer">EVALUATIONS.md</Anchor></Text>}
      {skill.source === 'own' && <Loading state={text} label="skill text">{(t) => <Code block tabIndex={0}>{t.text}</Code>}</Loading>}
    </Stack>
  );
}

// The global parts by the inventory's step prefix, each with the view that edits it.
const GLOBAL_PARTS = [[['plugin', 'pack'], 'Plugins and packs', 'extensions', 'Extensions'], [['skills'], 'Skills'], [['rules'], 'Rules', 'rules', 'Rules'],
  [['ask', 'settings'], 'Settings', 'agent-settings', 'Agent settings'], [['tools'], 'Machine tools'], [['other'], 'Other global items']];

// What the global setup installs, by part, with its state on disk; a part's items open on a button, open from the start when some need attention.
function GlobalItems({ items }) {
  const parts = GLOBAL_PARTS.map(([steps, title, view, viewName]) => ({ title, view, viewName, rows: items.filter((i) => steps.includes(i.step.split(':')[0])) })).filter((p) => p.rows.length);
  if (!parts.length) return <Text size="sm">Nothing is installed globally yet: plan the setup below.</Text>;
  return parts.map((p) => {
    const attention = p.rows.filter((i) => ATTENTION.includes(i.state)).length;
    return (
      <Stack key={p.title} gap={4} component="section" aria-label={p.title}>
        <Group gap="xs" justify="space-between">
          <Text fw={600}>{p.title} ({p.rows.length}{attention ? `, ${attention} need attention` : ''})</Text>
          {p.view && <Anchor href={href(p.view)} size="sm">Open {p.viewName}</Anchor>}
        </Group>
        <Folded title={p.title} label={['Show items', 'Hide items']} name={`items of ${p.title}`} initial={attention > 0}>
          <List size="sm" listStyleType="none" spacing={4}>
            {p.rows.map((i) => <List.Item key={`${i.step}|${i.title}`}><Group gap="xs" wrap="nowrap"><StateBadge state={i.state} /><Text size="sm" style={{ overflowWrap: 'anywhere' }}>{i.title}</Text></Group></List.Item>)}
          </List>
        </Folded>
      </Stack>
    );
  });
}

// One row per agent. An installed agent shows a short chip per missing feature with the sentence as its tooltip;
// the agents that are not installed show the sentences.
function AgentTable({ label, agents, chosen, onCheck }) {
  return (
    <Table.ScrollContainer minWidth={640} scrollAreaProps={{ viewportProps: { tabIndex: 0, role: 'region', 'aria-label': `${label}, scrollable` } }}>
      <Table aria-label={label}>
        <Table.Thead><Table.Tr><Table.Th>Agent</Table.Th><Table.Th>Version</Table.Th><Table.Th>Rules</Table.Th><Table.Th>Skills</Table.Th><Table.Th>Tested</Table.Th><Table.Th>Not available</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {agents.map((a) => (
            <Table.Tr key={a.id}>
              <Table.Td><Checkbox label={a.name} disabled={!a.installed} checked={chosen.includes(a.id)} onChange={() => onCheck(chosen.includes(a.id) ? chosen.filter((x) => x !== a.id) : [...chosen, a.id])} /></Table.Td>
              <Table.Td>{a.version ?? 'not installed'}</Table.Td>
              <Table.Td><Code>~/{a.rules}</Code></Table.Td>
              <Table.Td><Code>~/{a.skills}</Code></Table.Td>
              <Table.Td>{a.tested ? 'tested' : 'untested'}</Table.Td>
              <Table.Td>{!a.unavailable.length ? 'nothing' : a.installed ? (
                <Group gap={4}>
                  {/* shortcut: the chip is the sentence up to "is not available", fine while every sentence has that form. */}
                  {a.unavailable.map((m) => { const [short, rest] = m.split(/(?= is not available)/); return <Tooltip key={m} label={m} events={{ hover: true, focus: true, touch: true }} transitionProps={{ duration: 0 }}><Badge variant="default" tabIndex={0}>{short}<VisuallyHidden>{rest}</VisuallyHidden></Badge></Tooltip>; })}
                </Group>
              ) : <List size="sm" listStyleType="none">{a.unavailable.map((m) => <List.Item key={m}>{m}</List.Item>)}</List>}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

// Only global things: per-project setup lives on each project's page.
export function Agents({ overview, params, refresh }) {
  const inv = useApi('/api/inventory');
  const [select, setSelect] = useState(null);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const installed = overview.data?.agents.filter((a) => a.installed).map((a) => a.id) ?? [];
  const load = async (ids) => { setError(null); setPlan(null); try { setPlan(await api(`/api/global-plan?agents=${ids.join(',')}`)); } catch (e) { setError(e.message); } };
  // #/agents?agent=claude or ?plan=1 (Dashboard, palette) opens that plan.
  const auto = params.get('agent') ?? (params.get('plan') ? '*' : null);
  useEffect(() => {
    if (!auto || !overview.data) return;
    const ids = auto === '*' ? installed : [auto];
    setSelect(ids);
    load(ids).catch(console.error);
  }, [auto, !!overview.data]);
  return (
    <Loading state={overview} label="agents">{(o) => {
      const chosen = select ?? installed;
      return (
        <Stack gap="lg">
          <Text>Per-project setup lives in each project: <Anchor href={href('projects')} underline="always">Projects</Anchor>.</Text>
          {o.agents.some((a) => a.installed) ? <AgentTable label="Agents" agents={o.agents.filter((a) => a.installed)} chosen={chosen} onCheck={setSelect} /> : <Text size="sm">No agent is installed on this machine.</Text>}
          {o.agents.some((a) => !a.installed) && (
            <details>
              <summary><Text component="span" fw={600}>{plural(o.agents.filter((a) => !a.installed).length, 'agent')} not installed</Text></summary>
              <AgentTable label="Agents not installed" agents={o.agents.filter((a) => !a.installed)} chosen={chosen} onCheck={setSelect} />
            </details>
          )}
          <Text size="sm">Agent logins: <Anchor href={href('accounts')} underline="always">Accounts</Anchor>.</Text>
          <Section title="Installed globally"><Loading state={inv} label="global items">{(items) => <GlobalItems items={items} />}</Loading></Section>
          <Group><Button leftSection={icon(IconListCheck)} onClick={() => load(chosen)} disabled={!chosen.length}>Plan setup for {chosen.length} agent{chosen.length === 1 ? '' : 's'}</Button></Group>
          {error && <Note color="red" title="Plan failed">{error}</Note>}
          {plan && <Section title="Changes"><Plan key={plan.planId} plan={plan} scope="global" onDone={() => { refresh(); inv.reload(); }} /></Section>}
          <Text size="sm">Removing the setup: undo its runs in History. The app does not install or remove agents.</Text>
          <Cli>{`benchkeeper plan --agents ${chosen.join(',')}\nbenchkeeper apply --agents ${chosen.join(',')}`}</Cli>
        </Stack>
      );
    }}</Loading>
  );
}

// One status: the setup state and where it lives. committed: the repository still carries a setup kept local; Update
// all opens the pull request that removes it.
const SetupBadge = ({ p }) => {
  if (p.missing) return <MissingBadge />;
  const where = p.share ? 'shared' : p.committed ? 'local, still committed' : 'local';
  const text = !p.setupVersion ? 'not set up' : lags(p) ? `set up on ${p.origin} only` : p.current ? `current, ${where}` : `behind (${p.setupVersion}), ${where}`;
  return <Badge variant="default" miw="max-content" leftSection={<Dot color={!p.setupVersion ? 'gray' : p.current && !lags(p) ? 'teal' : 'yellow'} />}>{text}</Badge>;
};

// Skills each session of a chosen agent loads here: the project's own plus its global and plugin skills. Every one
// costs its description in each session, and similar descriptions make the agent pick the wrong one.
function SkillCount({ p, names }) {
  const agents = Object.keys(p.seen ?? {});
  if (!agents.length) return '-';
  return (
    <Stack gap={0}>
      {agents.map((a) => <Text key={a} size="sm" style={{ whiteSpace: 'nowrap' }} title={`${p.skills[a]} from this project`}>{agents.length > 1 ? `${names[a] ?? a}: ` : ''}{p.seen[a]} loaded</Text>)}
    </Stack>
  );
}

function ChangesCell({ p }) {
  if (p.missing) return <Text size="sm" c="red" style={{ whiteSpace: 'nowrap' }}>Folder not found</Text>;
  if (p.error) return <Text size="sm" c="red">{p.error}</Text>;
  return p.changes ? <Text size="sm" style={{ whiteSpace: 'nowrap' }}>{p.changes.length} pending</Text> : '-';
}

function ProjectRow({ p, names, checked, onCheck }) {
  const tree = p.missing ? null : p.repo ? (p.clean ? 'clean' : 'dirty') : 'no repository';
  return (
    <Table.Tr>
      <Table.Td><SelectCheckbox p={p} checked={checked} onChange={onCheck} /></Table.Td>
      <Table.Td>
        <Group gap="xs" wrap="nowrap">
          <Anchor href={projectHref(p.path)} style={{ whiteSpace: 'nowrap' }}>{label(p)}</Anchor>
          {tree && <Text size="xs">{tree}</Text>}
        </Group>
        {/* Cut at the start, the end names the folder; bdi keeps the slashes in order inside the right-to-left cut. */}
        <Text size="xs" truncate="start" maw={240} title={p.path}><bdi>{[p.path, p.branch].filter(Boolean).join(', ')}</bdi></Text>
      </Table.Td>
      <Table.Td><SetupBadge p={p} /></Table.Td>
      <Table.Td><SkillCount p={p} names={names} /></Table.Td>
      <Table.Td><ChangesCell p={p} /></Table.Td>
    </Table.Tr>
  );
}

// Cards or table, remembered in this browser.
const LAYOUT = 'bk-projects-layout';
function useLayout() {
  const [layout, set] = useState(() => { try { return localStorage.getItem(LAYOUT) === 'table' ? 'table' : 'cards'; } catch { return 'cards'; } });
  return [layout, (v) => { set(v); try { localStorage.setItem(LAYOUT, v); } catch { /* lasts for this page */ } }];
}

export function ProjectList({ params, overview, refresh }) {
  const projects = useApi('/api/projects');
  // Sessions, doctor counts and item states: a scan can take a while, so the cards show first and fill in.
  const extra = useApi('/api/project-cards');
  const cards = extra.data ? Object.fromEntries(extra.data.map((c) => [c.path, c])) : {};
  const [layout, setLayout] = useLayout();
  const [path, setPath] = useState('');
  const [found, setFound] = useState(null);
  const [pick, setPick] = useState([]);
  const [push, setPush] = useState(true);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [setupPaths, setSetupPaths] = useState(null);
  const [view, setView] = useState({ query: '', sort: 'added', chips: chipsOf(params) });
  const [selected, setSelected] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [notices, setNotices] = useState({});
  const names = Object.fromEntries((overview.data?.agents ?? []).map((a) => [a.id, a.name]));
  const all = projects.data ?? [];
  const live = all.filter((p) => !p.missing);
  const fresh = live.filter((p) => !p.setupVersion && !p.error).map((p) => p.path);
  const reload = () => { projects.reload(); extra.reload(); refresh(); };
  const act = (name, f) => async () => { setError(null); setBusy(name); try { await f(); } catch (e) { setError(e.message); } setBusy(null); };
  // The OS dialog; when there is none or it is cancelled, the typed path stays.
  const choose = async () => {
    const r = await api('/api/pick-folder', {});
    if (r.unavailable) setError('No folder dialog: it needs osascript, or zenity or kdialog with a display. Type the path.');
    return r.path;
  };
  // The folder is checked first: another worktree of a registered repository waits for the user's word.
  const add = async (dir, worktree = false) => {
    const c = await api(`/api/project-check?path=${encodeURIComponent(dir)}`);
    if (c.worktree && !worktree) { setNotices({ worktree: { path: c.path, of: c.worktree } }); return false; }
    await api('/api/projects', { action: 'add', path: c.path, worktree });
    setNotices(c.inside ? { inside: { path: c.path, of: c.inside } } : {});
    return true;
  };
  const addTyped = (worktree) => act('add', async () => { if (await add(path, worktree)) { setPath(''); reload(); } });
  const addFound = act('add-found', async () => {
    const failed = [];
    for (const d of pick) {
      try { if (!(await add(d))) failed.push(`${d}: same repository as a registered project (another worktree)`); } catch (e) { failed.push(`${d}: ${e.message}`); }
    }
    setFound(null);
    reload();
    if (failed.length) throw new Error(failed.join('; '));
  });
  const scanRoot = act('scan', async () => {
    const root = path || await choose();
    if (!root) return;
    setPath(root);
    const list = await api('/api/scan', { root });
    setFound(list);
    setPick(list);
  });
  // Update all pushes a branch and opens a pull request for each project the list marks willPush (a shared or still
  // committed setup whose origin is on GitHub); any other shared or committed project gets a local branch only.
  const [confirmPrs, setConfirmPrs] = useState(null);
  const prsOf = (paths) => (push ? live.filter((p) => paths.includes(p.path) && p.willPush).length : 0);
  const runUpdate = (paths) => act('update', async () => { setConfirmPrs(null); await updateProjects(paths, push, setProgress); reload(); })();
  const startUpdate = (paths) => (prsOf(paths) ? setConfirmPrs(paths) : runUpdate(paths));
  const prs = prsOf(confirmPrs ?? []);
  const rows = visibleProjects(all, view, cards);
  // Bulk actions act on the rows shown: a search or filter never leaves hidden projects selected.
  const chosen = rows.filter((p) => selected.includes(p.path));
  const setUp = (list) => list.filter((p) => !p.missing && p.setupVersion).map((p) => p.path);
  const closeDialog = (removed) => { setDialog(null); if (removed) setSelected((s) => s.filter((x) => !dialog.paths.includes(x))); reload(); };
  const toggle = (paths, on) => setSelected((s) => (on ? [...new Set([...s, ...paths])] : s.filter((x) => !paths.includes(x))));
  const shown = rows.map((p) => p.path);
  const allShown = !!shown.length && shown.every((x) => selected.includes(x));
  return (
    <Stack gap="lg">
      <form onSubmit={(e) => { e.preventDefault(); void addTyped(false)(); }}>
        <Group align="flex-end">
          <TextInput label="Project folder" placeholder="/home/me/code/app" value={path} onChange={(e) => setPath(e.currentTarget.value)} w={{ base: '100%', sm: 420 }} />
          <Button leftSection={icon(IconFolderSearch)} variant="default" loading={busy === 'choose'} onClick={act('choose', async () => { const p = await choose(); if (p) setPath(p); })}>Choose folder</Button>
          <Button leftSection={icon(IconPlus)} type="submit" disabled={!path} loading={busy === 'add'}>Add project</Button>
          <Button leftSection={icon(IconFolders)} variant="default" loading={busy === 'scan'} onClick={scanRoot}>Scan for projects</Button>
        </Group>
      </form>
      {error && <Note color="red" title="Failed">{error}</Note>}
      <AddNotices {...notices} onAddWorktree={act('add', async () => { if (await add(notices.worktree.path, true)) reload(); })} onDismiss={() => setNotices({})} />
      {found && (
        <Section title="Found projects">
          {found.length ? (
            <>
              <Checkbox.Group value={pick} onChange={setPick} label={`Folders with an agent setup below ${path}, not registered yet`}>
                <Stack gap={4} mt="xs">{found.map((d) => <Checkbox key={d} value={d} label={d} />)}</Stack>
              </Checkbox.Group>
              <Group><Button leftSection={icon(IconPlus)} disabled={!pick.length} loading={busy === 'add-found'} onClick={addFound}>Add selected ({pick.length})</Button></Group>
            </>
          ) : <Text>No unregistered folders with AGENTS.md, skills-lock.json or a state file below {path}.</Text>}
        </Section>
      )}
      <Loading state={projects} label="projects">{(list) => (list.length ? (
        <Stack gap="sm">
          <ProjectTotals list={rows} cards={cards} />
          <ProjectFilters {...view} onQuery={(query) => setView({ ...view, query })} onSort={(sort) => setView({ ...view, sort })} onChips={(chips) => setView({ ...view, chips })}
            packs={[...new Set(all.flatMap((p) => p.packs ?? []))]} agents={Object.entries(names).map(([value, text]) => ({ value, label: text }))} />
          <Group justify="space-between">
            <Checkbox label="Select all shown projects" checked={allShown} indeterminate={!allShown && shown.some((x) => selected.includes(x))} onChange={(e) => toggle(shown, e.currentTarget.checked)} disabled={!shown.length} />
            <SegmentedControl size="xs" aria-label="Show projects as" data={[{ value: 'cards', label: 'Cards' }, { value: 'table', label: 'Table' }]} value={layout} onChange={setLayout} />
          </Group>
          {extra.error && <Note color="yellow" title="Sessions and doctor counts not read">{extra.error}</Note>}
          {!!chosen.length && <BulkBar rows={chosen} onClear={() => setSelected([])} onUpdate={() => startUpdate(setUp(chosen))} onSetup={() => setSetupPaths({ paths: chosen.filter((p) => !p.missing && !p.setupVersion).map((p) => p.path) })}
            onRemoveList={() => setDialog({ kind: 'list', paths: chosen.map((p) => p.path) })} onRemoveSetup={() => setDialog({ kind: 'setup', paths: setUp(chosen) })} />}
          {!rows.length ? <Text size="sm" role="status">No project matches the search and filters.</Text> : layout === 'cards' ? (
            <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md" role="list" aria-label="Projects">
              {rows.map((p) => (
                <div role="listitem" key={p.path}>
                  <ProjectCard p={p} card={extra.data ? cards[p.path] ?? null : extra.error ? null : undefined} names={names} checked={selected.includes(p.path)} onCheck={(on) => toggle([p.path], on)}
                    onApply={() => (p.setupVersion ? (window.location.hash = projectHref(p.path, 'installs')) : setSetupPaths({ paths: [p.path] }))} onUpdate={() => startUpdate([p.path])} onRemoveSetup={() => setDialog({ kind: 'setup', paths: [p.path] })} />
                </div>
              ))}
            </SimpleGrid>
          ) : (
            <Table.ScrollContainer minWidth={420}>
              <Table aria-label="Projects" horizontalSpacing="xs">
                <Table.Thead><Table.Tr>
                  <Table.Th w={32}><VisuallyHidden>Select</VisuallyHidden></Table.Th>
                  <Table.Th>Project</Table.Th><Table.Th>Setup</Table.Th><Table.Th>Skills</Table.Th><Table.Th>Changes</Table.Th>
                </Table.Tr></Table.Thead>
                <Table.Tbody>{rows.map((p) => <ProjectRow key={p.path} p={p} names={names} checked={selected.includes(p.path)} onCheck={(on) => toggle([p.path], on)} />)}</Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Stack>
      ) : <Text>No projects yet. Next step: add a project folder above, or scan a parent folder for projects.</Text>)}</Loading>
      <Section title="Update all">
        <Text size="sm">A local setup is written in the checkout. A shared one gets branch chore/agent-setup-&lt;version&gt; per project in a worktree, one commit. Projects with uncommitted changes are skipped. A project without a state file is set up step by step first.</Text>
        <Group>
          <Checkbox label="Push and open a pull request when origin is on GitHub" checked={push} onChange={(e) => setPush(e.currentTarget.checked)} />
          <Button leftSection={icon(IconRefresh)} loading={busy === 'update'} disabled={!live.length} onClick={() => startUpdate(live.map((p) => p.path))}>Update all</Button>
          <Button variant="default" disabled={!fresh.length} onClick={() => setSetupPaths({ paths: fresh })}>Set up {fresh.length} new projects</Button>
        </Group>
        {progress && <UpdateResults progress={progress} extra={(r) => fresh.includes(r.path) && <Button size="xs" variant="default" ml="sm" onClick={() => setSetupPaths({ paths: [r.path] })}>Set up</Button>} />}
      </Section>
      <Modal opened={!!confirmPrs} onClose={() => setConfirmPrs(null)} withCloseButton={false} attributes={{ content: { 'aria-label': `Open up to ${plural(prs, 'pull request')}?` } }}>
        <Stack gap="sm">
          <Title order={2} size="h4">Open up to {plural(prs, 'pull request')}?</Title>
          <Text size="sm">{plural(prs, 'project')} on GitHub with a shared setup or a local one still committed get a branch pushed to origin and a pull request (the second kind removes the committed setup); without a GitHub origin the branch stays local. Projects with uncommitted changes are skipped.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmPrs(null)}>Cancel</Button>
            <Button leftSection={icon(IconRefresh)} onClick={() => runUpdate(confirmPrs)}>Update all and open up to {plural(prs, 'pull request')}</Button>
          </Group>
        </Stack>
      </Modal>
      {dialog?.kind === 'list' && <RemoveFromList paths={dialog.paths} onClose={() => setDialog(null)} onDone={() => closeDialog(true)} />}
      {dialog?.kind === 'setup' && <RemoveSetup paths={dialog.paths} push={push} onClose={() => setDialog(null)} onDone={() => closeDialog(false)} />}
      {setupPaths && <ProjectSetup paths={setupPaths.paths} change={setupPaths.change} push={push} onClose={() => { setSetupPaths(null); reload(); }} />}
      <Cli>{`benchkeeper projects add ${path || '<dir>'}\nbenchkeeper projects scan ${path || '<root>'}\nbenchkeeper projects rename <dir> <name> --notes <text>\nbenchkeeper projects relocate <old> <new>\nbenchkeeper projects remove <dir> [--setup]\nbenchkeeper projects plan <dir>\nbenchkeeper packs enable|disable <id> --project <dir>\nbenchkeeper projects update${push ? '' : ' --no-push'}\nbenchkeeper sessions record --project <dir> -- claude '/benchkeeper:setting-up-projects'`}</Cli>
    </Stack>
  );
}

// The list shows the newest runs: a ledger of years holds thousands, and each is a link.
const RUNS_SHOWN = 100;

// only: keeps the runs of one project; link: where a run opens, so a project's History stays on its page.
export function History({ history, params, refresh, only, link = (run) => href('history', { run }) }) {
  const open = params.get('run');
  const [more, setMore] = useState(false);
  return (
    <Stack gap="lg">
      <Loading state={history} label="history">{(all) => {
        const runs = only ? all.filter(only) : all;
        // A run opened by its link stays in the list, however old.
        const linked = runs.findIndex((r) => r.id === open);
        const listed = more || runs.length <= RUNS_SHOWN ? runs : linked >= RUNS_SHOWN ? [...runs.slice(0, RUNS_SHOWN), runs[linked]] : runs.slice(0, RUNS_SHOWN);
        const days = Object.entries(groupBy(listed, (r) => new Date(r.time).toLocaleDateString()));
        return runs.length ? (
          <SplitView span={4} empty="Choose a run for what it changed and undo." list={
            <Stack gap="md" component="nav" aria-label="Runs">
              {days.map(([d, rs]) => (
                <Stack key={d} gap={2}>
                  <Title order={3} size="h6" tt="uppercase" px="xs">{d}</Title>
                  {rs.map((r) => (
                    <NavLink key={r.id} href={link(r.id)} active={r.id === open} aria-current={r.id === open ? 'true' : undefined} variant="light" color="gray"
                      leftSection={<StatusIcon status={r.status ?? 'running'} />} label={runTitle(r)} styles={{ label: { color: 'var(--mantine-color-text)' }, description: { color: 'var(--mantine-color-text)' } }}
                      description={`${r.status ?? 'interrupted'}, ${r.changes} change${r.changes === 1 ? '' : 's'}, ${new Date(r.time).toLocaleTimeString()}${note(r) ? `, ${note(r)}` : ''}`} />
                  ))}
                </Stack>
              ))}
              {listed.length < runs.length && <Button variant="default" onClick={() => setMore(true)}>Show {runs.length - listed.length} older runs</Button>}
            </Stack>
          } detail={open ? <RunPanel key={open} id={open} order={3} onChanged={refresh} fold /> : null} />
        ) : <Text>No runs yet.</Text>;
      }}</Loading>
      <Cli>{`benchkeeper history\nbenchkeeper undo ${open ?? '<run>'}\nbenchkeeper undo ${open ?? '<run>'} --step <step>\nbenchkeeper evals cases add --run <session run> --target skill:<name> --expected <text>`}</Cli>
    </Stack>
  );
}

// The view keys come from the sidebar: the first nine views in its order.
const shortcuts = (views) => [[`${MOD}+K, /`, 'command palette'], ...views.map((v, i) => [`${MOD}+${i + 1}`, v]), [`${MOD}+J`, 'light or dark theme']];

function Profile({ overview, refresh }) {
  const [file, setFile] = useState(null);
  const [plans, setPlans] = useState(null);
  const [error, setError] = useState(null);
  const [skipped, setSkipped] = useState([]);
  const [busy, setBusy] = useState(false);
  const agents = overview.data?.agents.filter((a) => a.installed).map((a) => a.id) ?? [];
  const run = (f) => async (...a) => { setError(null); setBusy(true); try { await f(...a); } catch (e) { setError(e.message); } setBusy(false); };
  return (
    <Section title="Profile">
      <Text size="sm">Agents, packs, own packs and registered projects with their answers as one file. It holds no file contents, environment values or tokens.</Text>
      {error && <Note color="red" title="Failed">{error}</Note>}
      {skipped.map((m) => <Note key={m} color="yellow">{m}</Note>)}
      <Group>
        <Button leftSection={icon(IconDownload)} variant="default" disabled={!agents.length} onClick={run(async () => { const r = await api(`/api/profile-export?agents=${agents.join(',')}`); download('benchkeeper-profile.json', r.text); setSkipped(r.skipped); })}>Export profile</Button>
        <FileButton key={file?.name ?? 'none'} accept="application/json,.json"
          onChange={run(async (f) => { setPlans(null); setFile(null); setSkipped([]); if (!f) return; const text = await f.text(); setFile({ name: f.name, text, ...(await api('/api/profile-import', { text })) }); })}>
          {(props) => <Button leftSection={icon(IconUpload)} variant="default" {...props}>Import profile</Button>}
        </FileButton>
      </Group>
      {file && !plans && (
        <Stack gap="xs" aria-label="Profile contents" component="section">
          <Text size="sm">Agents: {file.agents.join(', ')}. Global packs: {file.globalPacks.join(', ') || 'none'}. Own packs: {file.packs.join(', ') || 'none'}.</Text>
          <List spacing={2}>{file.projects.map((p) => <List.Item key={p.path}><Code>{p.path}</Code>{p.here ? '' : ': not on this machine, skipped'}</List.Item>)}</List>
          <Group><Button loading={busy} onClick={run(async () => { setPlans(await api('/api/profile-import', { text: file.text, register: true })); refresh(); })}>Register projects and packs</Button></Group>
        </Stack>
      )}
      {plans && (
        <>
          <Text size="sm">Registered projects: {plans.projects.join(', ') || 'none'}. Own packs: {plans.packs.join(', ') || 'none'}.{plans.missing.length ? ` Skipped: ${plans.missing.join(', ')}.` : ''}</Text>
          {[...plans.skippedPacks, ...plans.skipped].map((m) => <Note key={m} color="yellow">Skipped {m}</Note>)}
          {plans.refused.map((m) => <Note key={m} color="yellow">Not registered: {m}</Note>)}
          {plans.notes.map((m) => <Note key={m} color="blue">{m}</Note>)}
          <Section title="Changes on this machine"><Plan key={plans.global.planId} plan={plans.global} onDone={refresh} scope="global" /></Section>
          {plans.plans.map((p) => <Section key={p.planId} title={`Changes in ${p.path}`}><Plan plan={p} onDone={refresh} scope="project" /></Section>)}
        </>
      )}
      <Cli>{`benchkeeper profile export benchkeeper-profile.json --agents ${agents.join(',') || '<a,b>'}\nbenchkeeper profile import benchkeeper-profile.json`}</Cli>
    </Section>
  );
}

// The preference editors: the "Advanced" view exists only while it is on.
function EditorSetting({ overview, refresh }) {
  const [error, setError] = useState(null);
  const set = (editors) => { setError(null); api('/api/preferences', { editors }).then(refresh, (e) => setError(e.message)); };
  return (
    <Section title="Advanced">
      <Switch label="Editors" description="Presets, pins and policy, under Advanced in the sidebar" checked={!!overview.data?.editors} onChange={(e) => set(e.currentTarget.checked)} />
      {error && <Note color="red" title="Not saved">{error}</Note>}
    </Section>
  );
}

export function Settings({ overview, refresh, keys }) {
  return (
    <Stack gap="xl">
      <Profile overview={overview} refresh={refresh} />
      <Section title="Keyboard shortcuts">
        <Table aria-label="Keyboard shortcuts" maw={520}>
          <Table.Thead><Table.Tr><Table.Th>Keys</Table.Th><Table.Th>Action</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{shortcuts(keys.views).map(([k, a]) => <Table.Tr key={k}><Table.Td><Code>{k}</Code></Table.Td><Table.Td>{a}</Table.Td></Table.Tr>)}</Table.Tbody>
        </Table>
        <Switch label="Open the command palette with the / key" description="Turn it off if a single-key shortcut gets in the way of speech input or screen reader keys." checked={keys.slash} onChange={(e) => keys.setSlash(e.currentTarget.checked)} />
      </Section>
      <Surfaces />
      <SessionsHistory />
      <EditorSetting overview={overview} refresh={refresh} />
      <Section title="Files">
        <List spacing={4} size="sm">
          <List.Item><Code>~/.config/benchkeeper/ledger/</Code>: one JSON file per run</List.Item>
          <List.Item><Code>~/.config/benchkeeper/backup/</Code>: replaced and removed files per run</List.Item>
          <List.Item><Code>~/.config/benchkeeper/projects.json</Code>: registered projects</List.Item>
          <List.Item><Code>~/.config/benchkeeper/preferences.json</Code>: the app's own preferences (Editors)</List.Item>
          <List.Item><Code>~/.config/benchkeeper/packs/</Code>: own packs</List.Item>
          <List.Item><Code>~/.config/benchkeeper/evals/</Code>: own eval cases and <Code>results.jsonl</Code></List.Item>
          <List.Item><Code>~/.config/benchkeeper/insights-triage.json</Code>: Insights findings you dismissed or snoozed (finding ids and dates)</List.Item>
          <List.Item><Code>.cache/benchkeeper/sessions.json</Code> in your home folder: session summaries for the Sessions board</List.Item>
        </List>
        <Text size="sm"><Code>BENCHKEEPER_NO_UPDATE_CHECK=1</Code> turns off the registry request for a newer version. It runs only in a terminal and never installs.</Text>
      </Section>
    </Stack>
  );
}

// The sessions board in a frame: a scan job fills the session cache first (the first one reads every transcript), then
// the board renders from the server's last scan; a reload within a minute shows it without scanning. The frame follows the
// app's theme without reloading, and takes the height of the board, so the page scrolls and the frame does not.
// project: a registered folder; the board then shows only its sessions.
export function Sessions({ project }) {
  const scheme = useComputedColorScheme('light');
  const [job, setJob] = useState(null);
  const [shown, setShown] = useState(0);
  const [error, setError] = useState(null);
  const [src, setSrc] = useState(null);
  const [height, setHeight] = useState(480);
  const [ponytail, setPonytail] = useState(false);
  const [notes, setNotes] = useState([]);
  const frame = useRef(null);
  const theme = useRef(scheme);
  useEffect(() => {
    theme.current = scheme;
    frame.current?.contentWindow?.postMessage({ bkTheme: scheme }, window.location.origin);
  }, [scheme]);
  useEffect(() => {
    const on = (e) => {
      if (e.source === frame.current?.contentWindow && e.origin === window.location.origin && Number.isFinite(e.data?.bkBoardHeight)) setHeight(Math.max(480, e.data.bkBoardHeight));
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, []);
  // Each frame load takes a one-time ticket (the frame cannot send the API key).
  const show = async () => {
    try { const { ticket, ponytail: pt } = await api('/api/board-ticket', {}); setPonytail(!!pt); setSrc(`/board?${new URLSearchParams({ theme: theme.current, ticket, ...(project ? { project } : {}) })}`); setShown((n) => n + 1); } catch (e) { setError(e.message); }
  };
  const scan = async (force) => {
    setError(null);
    try { const r = await api('/api/sessions-scan', force ? { force: true } : {}); if (r.fresh) await show(); else setJob(r.job); } catch (e) { setError(e.message); }
  };
  useEffect(() => { scan().catch(console.error); }, []);
  // notes: Ponytail ledger files and rows the scan skipped.
  const state = useJob(job, (s) => { setNotes(s.results?.notes ?? []); if (s.error) setError(s.error); else show().catch(console.error); setJob(null); });
  const p = state?.progress;
  return (
    <Stack gap="lg">
      <Group><Button leftSection={icon(IconRefresh)} variant="default" loading={!!job} onClick={() => scan(true)}>Rescan</Button>
        {ponytail && <Button variant="default" onClick={() => api('/api/ponytail-board', {}).catch((e) => setError(e.message))}>Open Ponytail's board</Button>}</Group>
      {error && <Note color="red">{error}</Note>}
      {notes.map((n) => <Note key={n} color="yellow">{n}</Note>)}
      {job && <Stack gap={4}><Text size="sm">Reading transcripts{p ? `: ${p.done} of ${p.total} files` : ''}</Text><Progress value={p?.total ? (p.done / p.total) * 100 : 0} aria-label="Transcripts read" /></Stack>}
      {src && <iframe ref={frame} key={shown} src={src} title="Sessions board" onLoad={() => frame.current?.contentWindow?.postMessage({ bkTheme: theme.current }, window.location.origin)} style={{ display: 'block', width: '100%', height, border: 0 }} />}
      <Cli>benchkeeper sessions board</Cli>
    </Stack>
  );
}
