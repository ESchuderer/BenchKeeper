import { BarChart, LineChart } from '@mantine/charts';
import { Anchor, Badge, Box, Button, Checkbox, Code, Drawer, FileButton, Grid, Group, List, Modal, NavLink, Paper, Progress, RingProgress, Select, Stack, Switch, Table, Text, TextInput, Timeline, Title, useComputedColorScheme } from '@mantine/core';
import { IconAdjustments, IconDeviceFloppy, IconDownload, IconFolderOpen, IconFolderSearch, IconFolders, IconListCheck, IconListNumbers, IconPackage, IconPlayerPlay, IconPlus, IconRefresh, IconTrash, IconUpload } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { CancelJob, Cli, Plan, Section, StateBadge, useJob } from './parts.jsx';
import { RunPanel, StatusIcon, note, runTitle, when } from './run.jsx';
import { DoctorTable, FixEverythingButton, UpdateResults } from './fix.jsx';
import { updateProjects } from './update.js';
import { OneRunButtons } from './onerun.jsx';
import { ProjectSetup } from './setup.jsx';
import { Dot, Loading, MOD, Note, RANK, STATE_COLOR, SplitView, download, go, groupBy, href, icon, useApi } from './shell.jsx';

const ATTENTION = ['absent', 'outdated', 'modified', 'removed', 'foreign', 'missing', 'error'];
const PARTS = ['rules', 'ask', 'plugin', 'skills', 'settings', 'tools', 'other'];
const worst = (items) => items.reduce((w, i) => (RANK.indexOf(i.state) > RANK.indexOf(w) ? i.state : w), items[0]?.state);

function InstallHealth({ items }) {
  const by = RANK.map((s) => [s, items.filter((i) => i.state === s).length]).filter(([, n]) => n);
  return (
    <Group wrap="nowrap" align="center">
      <Box aria-hidden><RingProgress size={140} thickness={14} label={<Text ta="center" size="sm">{items.length} items</Text>} sections={by.map(([s, n]) => ({ value: (n / items.length) * 100, color: STATE_COLOR[s] }))} /></Box>
      <List listStyleType="none" spacing={4} aria-label="Global items by state">
        {by.map(([s, n]) => <List.Item key={s}><Group gap="xs"><StateBadge state={s} /><Text size="sm">{n}</Text></Group></List.Item>)}
      </List>
    </Group>
  );
}

function Coverage({ items, agents }) {
  const cols = [...agents.map((a) => [a.id, a.name]), ['machine', 'Machine']];
  const rows = PARTS.filter((p) => items.some((i) => i.step.split(':')[0] === p));
  return (
    <Table.ScrollContainer minWidth={420}>
      <Table aria-label="Coverage" withTableBorder>
        <Table.Thead><Table.Tr><Table.Th>Part</Table.Th>{cols.map(([id, name]) => <Table.Th key={id}>{name}</Table.Th>)}</Table.Tr></Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr key={r}>
              <Table.Th scope="row">{r}</Table.Th>
              {cols.map(([id, name]) => {
                const s = worst(items.filter((i) => i.step.split(':')[0] === r && i.agent === id));
                return (
                  <Table.Td key={id}>
                    {s ? <Anchor href={href('agents', id === 'machine' ? { plan: '1' } : { agent: id })} aria-label={`${r} for ${name}: ${s}, open the plan`}><StateBadge state={s} /></Anchor> : <Text size="sm">none</Text>}
                  </Table.Td>
                );
              })}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

// Inline SVG with a link per node; below sm the text list replaces it.
function Flow({ nodes }) {
  const W = 180, GAP = 30;
  return (
    <>
      <Box visibleFrom="sm" maw={960} c="var(--mantine-color-text)">
        <svg viewBox={`0 0 ${nodes.length * (W + GAP) - GAP} 110`} width="100%" role="group" aria-labelledby="flow-title">
          <title id="flow-title">Setup flow: {nodes.map((n) => n.label).join(', ')}</title>
          <defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="currentColor" /></marker></defs>
          {nodes.map((n, i) => {
            const x = i * (W + GAP);
            const color = `var(--mantine-color-${STATE_COLOR[n.status]}-filled)`;
            return (
              <g key={n.label}>
                {i > 0 && <line x1={x - GAP + 2} y1="55" x2={x - 4} y2="55" stroke="currentColor" strokeWidth="2" markerEnd="url(#flow-arrow)" />}
                <a href={n.href}>
                  <rect x={x + 1} y="4" width={W - 2} height="102" rx="8" fill="var(--mantine-color-body)" stroke={color} strokeWidth="3" />
                  <text x={x + 12} y="32" fontWeight="600" fontSize="15" fill="currentColor">{n.label}</text>
                  <text x={x + 12} y="60" fontSize="13" fill="currentColor">{n.value}</text>
                  <circle cx={x + 17} cy="84" r="5" fill={color} />
                  <text x={x + 28} y="89" fontSize="13" fill="currentColor">{n.status}</text>
                </a>
              </g>
            );
          })}
        </svg>
      </Box>
      <List hiddenFrom="sm" aria-label="Setup flow">
        {nodes.map((n) => <List.Item key={n.label}><Anchor href={n.href} underline="always">{n.label}</Anchor>: {n.value} ({n.status})</List.Item>)}
      </List>
    </>
  );
}

export function Dashboard({ overview, doctor, history, params }) {
  const inv = useApi('/api/inventory');
  const panel = params.get('panel');
  useEffect(() => { if (panel) document.getElementById(panel)?.scrollIntoView(); }, [panel, doctor.data]);
  // A new run (Fix everything, the header's jobs) changes what the inventory shows.
  useEffect(() => { if (history.data) inv.reload(); }, [history.data?.length]);
  const o = overview.data, items = inv.data ?? [];
  const agents = o?.agents.filter((a) => a.installed) ?? [];
  const attention = items.filter((i) => ATTENTION.includes(i.state));
  const errors = doctor.data?.filter((i) => i.level === 'error').length ?? 0, warnings = (doctor.data?.length ?? 0) - errors;
  const behind = o?.projects.filter((p) => p.setupVersion !== o.version).length ?? 0;
  const nodes = [
    { label: 'Agents detected', value: `${agents.length} installed`, status: agents.length ? 'ok' : 'problem', href: href('agents') },
    { label: 'Global setup', value: inv.data ? `${attention.length} need attention` : inv.error ? 'check failed' : 'checking', status: inv.error ? 'problem' : attention.length ? 'attention' : 'ok', href: href('agents', { plan: '1' }) },
    { label: 'Projects', value: `${o?.projects.length ?? 0} registered, ${behind} behind`, status: behind ? 'attention' : 'ok', href: href('projects') },
    { label: 'Doctor', value: doctor.data ? `${errors} errors, ${warnings} warnings` : doctor.error ? 'check failed' : 'checking', status: doctor.error || errors ? 'problem' : warnings ? 'attention' : 'ok', href: href('dashboard', { panel: 'doctor' }) },
  ];
  return (
    <Stack gap="xl">
      <Stack gap="xs">
        <Text size="sm" maw={560}>One-run setup prepares the global setup and the projects you pick without questions in between, then shows every change on one page to check before it applies them.</Text>
        <OneRunButtons />
      </Stack>
      <Group justify="space-between" align="flex-start">
        <Text size="sm" maw={560}>Fix everything walks through the global setup, the projects that are behind and what is left to do by hand, then applies what you checked.</Text>
        <FixEverythingButton />
      </Group>
      <Section title="Setup flow"><Flow nodes={nodes} /></Section>
      <Grid gutter="xl">
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Section title="Install health"><Loading state={inv} label="inventory">{() => <InstallHealth items={items} />}</Loading></Section>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Section title="Coverage"><Loading state={inv} label="inventory">{() => <Coverage items={items} agents={agents} />}</Loading></Section>
        </Grid.Col>
      </Grid>
      <Grid gutter="xl">
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Section title="Recent runs">
            <Loading state={history} label="history">{(runs) => (runs.length ? (
              <Timeline bulletSize={14} lineWidth={2}>
                {runs.slice(0, 6).map((r) => (
                  <Timeline.Item key={r.id} title={<Anchor href={href('history', { run: r.id })}>{runTitle(r)}</Anchor>}>
                    <Text size="sm">{r.status ?? 'interrupted'}, {when(r.time)}</Text>
                    {note(r) && <Text size="xs">{note(r)}</Text>}
                  </Timeline.Item>
                ))}
              </Timeline>
            ) : <Text>No runs yet.</Text>)}</Loading>
          </Section>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Section title="Doctor" id="doctor"><Loading state={doctor} label="doctor">{(found) => <DoctorTable found={found} />}</Loading></Section>
        </Grid.Col>
      </Grid>
      <Cli>{'benchkeeper plan\nbenchkeeper doctor'}</Cli>
    </Stack>
  );
}

function PackBuilder({ opened, onClose, skills, onRemove, onSaved }) {
  const [id, setId] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState(null);
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
        <Text fw={600}>Skills ({skills.length})</Text>
        {skills.length ? skills.map((n) => (
          <Group key={n} justify="space-between" wrap="nowrap"><Text size="sm">{n}</Text><Button leftSection={icon(IconTrash)} size="xs" variant="default" onClick={() => onRemove(n)} aria-label={`Remove ${n}`}>Remove</Button></Group>
        )) : <Text size="sm">Choose skills with the checkboxes in the list.</Text>}
        {warn.data?.map((w) => <Note key={w} color="yellow">{w}</Note>)}
        {error && <Note color="red" title="Save failed">{error}</Note>}
        <Group><Button leftSection={icon(IconDeviceFloppy)} onClick={save} disabled={!id || !skills.length}>Save pack</Button></Group>
        <Cli>{`benchkeeper packs save ${id || '<id>'} ${skills.map((n) => `--skill ${n}`).join(' ')}`}</Cli>
      </Stack>
    </Drawer>
  );
}

function Packs({ packs, onChange }) {
  const [error, setError] = useState(null);
  const [file, setFile] = useState(0);
  // A pack file whose id is an own pack's: asked first, the old file goes to the backup.
  const [replace, setReplace] = useState(null);
  const run = (f) => async (...a) => { setError(null); try { await f(...a); onChange(); } catch (e) { setError(e.message); } };
  const importText = run(async (text) => { setReplace(null); await api('/api/packs', { action: 'import', text }); setFile((n) => n + 1); });
  return (
    <Section title="Packs">
      {error && <Note color="red" title="Failed">{error}</Note>}
      <Table.ScrollContainer minWidth={520}>
        <Table aria-label="Packs">
          <Table.Thead><Table.Tr><Table.Th>Pack</Table.Th><Table.Th>Contents</Table.Th><Table.Th>Source</Table.Th><Table.Th>Actions</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {packs.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>{p.title ?? p.id}<Text size="xs">{p.id}</Text></Table.Td>
                <Table.Td>{p.skills?.join(', ') ?? `plugin: ${Object.values(p.plugins ?? {}).map((x) => x.id).join(', ')}`}</Table.Td>
                <Table.Td>{p.own ? 'own' : 'library'}</Table.Td>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    {p.skills && <Button leftSection={icon(IconDownload)} size="xs" variant="default" aria-label={`Export ${p.id}`} onClick={run(async () => { const r = await api(`/api/pack-export?id=${encodeURIComponent(p.id)}`); download(r.name, r.text); })}>Export</Button>}
                    {p.own && <Button leftSection={icon(IconTrash)} size="xs" variant="subtle" aria-label={`Remove ${p.id}`} onClick={run(() => api('/api/packs', { action: 'remove', id: p.id }))}>Remove</Button>}
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
            if (packs.some((p) => p.own && p.id === id)) setReplace({ id, text }); else importText(text);
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
  const [pack, setPack] = useState(null);
  const [agent, setAgent] = useState(null);
  const [used, setUsed] = useState(null);
  const [picked, setPicked] = useState([]);
  const [builder, setBuilder] = useState(false);
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
          <Packs packs={c.packs} onChange={refresh} />
          <PackBuilder opened={builder} onClose={() => setBuilder(false)} skills={picked} onRemove={flip} onSaved={() => { setBuilder(false); setPicked([]); refresh(); }} />
          <Cli>{`benchkeeper packs list\nbenchkeeper project apply --pack ${pack ?? '<id>'}${open ? ` --skill ${open}` : ''}`}</Cli>
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
      {results.length ? <EvalResults results={results} /> : <Text size="sm">No eval results for this skill. Measurements: <Anchor href="https://github.com/ESchuderer/BenchKeeper/blob/main/EVALUATIONS.md" target="_blank" rel="noreferrer">EVALUATIONS.md</Anchor></Text>}
      {skill.source === 'own' && <Loading state={text} label="skill text">{(t) => <Code block tabIndex={0}>{t.text}</Code>}</Loading>}
    </Stack>
  );
}

const pct = (v) => (v == null ? null : Math.round(v * 100));
const rate = (v) => (v == null ? '-' : `${pct(v)}%`);
const seriesOf = (r) => `${r.agent}${r.model ? ` ${r.model}` : ''}`;
// One color per measure everywhere; the shades per scheme are set in App.jsx.
// Recharts sorts legend items by name unless told not to; they follow this order, as the tables and tooltips do.
const LEGEND = { itemSorter: null };
const MEASURES = [{ name: 'Miss', key: 'missRate', color: 'var(--bk-miss)' }, { name: 'False trigger', key: 'falseTriggerRate', color: 'var(--bk-false-trigger)', strokeDasharray: '5 5' }];

// The latest result per target, worst first: the higher of its two rates, then the name.
function latestPerTarget(results) {
  const last = new Map(results.map((r) => [r.target, r]));
  const worst = (r) => Math.max(r.missRate ?? -1, r.falseTriggerRate ?? -1);
  return [...last.values()].sort((a, b) => worst(b) - worst(a) || a.target.localeCompare(b.target));
}

function RatesTip({ payload, label }) {
  if (!payload?.length) return null;
  return (
    <Paper px="sm" py={6} withBorder shadow="sm">
      <Text size="sm" fw={600}>{label}</Text>
      {MEASURES.map((m) => <Text key={m.name} size="sm">{m.name}: {payload[0].payload[m.name] == null ? 'no cases' : `${payload[0].payload[m.name]}%`}</Text>)}
      <Text size="xs">{payload[0].payload.cases} cases, {when(payload[0].payload.time)}</Text>
    </Paper>
  );
}

// Which skill descriptions need work, and in which direction. A rate without cases gets no bar, not 0%.
function TargetRates({ latest }) {
  const rated = latest.filter((r) => r.missRate != null || r.falseTriggerRate != null);
  if (rated.length < 2) return null;
  const data = rated.map((r) => ({ target: r.target.replace(/^skill:/, ''), cases: r.cases, time: r.time, ...Object.fromEntries(MEASURES.map((m) => [m.name, pct(r[m.key])])) }));
  return (
    <Section title="Latest rates per target">
      <Text size="sm">Miss: the skill did not load where it should. False trigger: it loaded where it should not. One case of about 6 per side moves a rate by about 17 points.</Text>
      <BarChart h={70 + data.length * 64} data={data} dataKey="target" orientation="vertical" series={MEASURES.map(({ name, color }) => ({ name, color }))}
        xAxisProps={{ domain: [0, 100], tickFormatter: (v) => `${v}%` }} yAxisProps={{ width: 150 }} withLegend legendProps={LEGEND} withBarValueLabel valueFormatter={(v) => (v == null ? '' : `${v}%`)}
        barProps={{ radius: [0, 4, 4, 0] }} tooltipProps={{ content: RatesTip }} aria-label="Latest miss and false-trigger rate per target" />
    </Section>
  );
}

// Miss and false-trigger rates of one target over time; the table holds the same numbers.
function EvalResults({ results }) {
  const data = results.map((r) => ({ time: when(r.time), ...Object.fromEntries(MEASURES.map((m) => [m.name, pct(r[m.key])])) }));
  return (
    <Stack gap="sm">
      <LineChart h={240} data={data} dataKey="time" series={MEASURES.map(({ key, ...m }) => m)} unit="%" yAxisProps={{ domain: [0, 100] }} withLegend legendProps={LEGEND} connectNulls />
      <Table.ScrollContainer minWidth={560}>
        <Table aria-label="Eval runs">
          <Table.Thead><Table.Tr><Table.Th>Time</Table.Th><Table.Th>Agent</Table.Th><Table.Th>Model</Table.Th><Table.Th>App</Table.Th><Table.Th>Cases</Table.Th><Table.Th>Miss</Table.Th><Table.Th>False trigger</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {results.map((r, i) => (
              <Table.Tr key={i}>
                <Table.Td>{when(r.time)}</Table.Td><Table.Td>{r.agent} {r.agentVersion}</Table.Td><Table.Td>{r.model ?? 'default'}</Table.Td><Table.Td>{r.appVersion}</Table.Td>
                <Table.Td>{r.cases}</Table.Td><Table.Td>{rate(r.missRate)}</Table.Td><Table.Td>{rate(r.falseTriggerRate)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}

export function EvalJob({ job, total, onDone }) {
  const s = useJob(job, onDone);
  const at = s?.progress ? s.progress.index + (s.done ? 1 : 0) : 0;
  return (
    <Stack gap="xs">
      <Progress value={(s?.done ? total : at) / total * 100} aria-label="Eval sessions done" />
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

// Plan first (targets and the number of agent sessions), then start them as a job.
function RunEvals({ onDone }) {
  const [agents, setAgents] = useState(['claude']);
  const [all, setAll] = useState(false);
  const [plan, setPlan] = useState(null);
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const query = new URLSearchParams({ agents: agents.join(','), all: all ? '1' : '0' });
  const act = (f) => async () => { setError(null); try { await f(); } catch (e) { setError(e.message); } };
  return (
    <Section title="Run evals">
      <Text size="sm">Each case is a real agent session (Claude Code in plan mode, Codex read-only) in a scratch repository, on your subscription.</Text>
      <Group>
        <Checkbox.Group label="Agents" value={agents} onChange={(v) => { setAgents(v); setPlan(null); }}>
          <Group mt={4}><Checkbox value="claude" label="Claude Code" /><Checkbox value="codex" label="Codex" /></Group>
        </Checkbox.Group>
        <Switch label="All targets, also unchanged ones" checked={all} onChange={(e) => { setAll(e.currentTarget.checked); setPlan(null); }} />
      </Group>
      {error && <Note color="red" title="Failed">{error}</Note>}
      {!job && <Group><Button leftSection={icon(IconListCheck)} variant="default" disabled={!agents.length} onClick={act(async () => setPlan(await api(`/api/eval-plan?${query}`)))}>Plan evals</Button></Group>}
      {plan && !job && (plan.targets.length ? (
        <Stack gap="xs">
          <Table aria-label="Planned evals">
            <Table.Thead><Table.Tr><Table.Th>Target</Table.Th><Table.Th>Agent</Table.Th><Table.Th>Cases</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{plan.targets.map((t) => <Table.Tr key={`${t.target}${t.agent}`}><Table.Td>{t.target}</Table.Td><Table.Td>{t.agent}</Table.Td><Table.Td>{t.cases}</Table.Td></Table.Tr>)}</Table.Tbody>
          </Table>
          <Group><Button leftSection={icon(IconPlayerPlay)} onClick={act(async () => setJob(await api('/api/eval', { agents: agents.join(','), all })))}>Start {plan.sessions} agent sessions</Button></Group>
        </Stack>
      ) : <Text>Every target is unchanged since its last result. Turn on all targets to run them again.</Text>)}
      {job && <EvalJob job={job.job} total={job.total} onDone={() => { setPlan(null); onDone(); }} />}
      {job && <Group><Button leftSection={icon(IconListCheck)} variant="default" onClick={() => setJob(null)}>Plan more evals</Button></Group>}
    </Section>
  );
}

export function Evals({ params }) {
  const evals = useApi('/api/evals');
  const [picked, setPicked] = useState(null);
  const open = params.get('target');
  return (
    <Stack gap="lg">
      <Stack gap={6} maw={720}>
        <Text>A skill only helps when the agent loads it for the tasks it is meant for, and leaves it alone otherwise. Evals test exactly that.</Text>
        <Text size="sm">Each case is a short task. BenchKeeper gives it to a real agent session in a throwaway folder and records whether the skill loaded. Two numbers come out, and lower is better for both:</Text>
        <List size="sm">
          <List.Item><b>Miss</b>: the task needed the skill, but the agent did not load it.</List.Item>
          <List.Item><b>False trigger</b>: the agent loaded the skill for a task that did not need it.</List.Item>
        </List>
        <Text size="sm">Run them after a skill or the setup changes, then compare with the last result. They use your agent subscription, a few minutes per skill.</Text>
      </Stack>
      <Loading state={evals} label="eval results">{(all) => {
        if (!all.length) return <Text>No eval results yet: plan and run them below.</Text>;
        // Rates of different agents and models do not compare: one of them at a time, the newest by default.
        const keys = [...new Set(all.map(seriesOf))];
        const series = keys.includes(picked) ? picked : seriesOf(all.at(-1));
        const mine = all.filter((r) => seriesOf(r) === series);
        const latest = latestPerTarget(mine);
        return (
          <>
            {keys.length > 1 && <Group><Select label="Agent and model" value={series} onChange={(v) => v && setPicked(v)} data={keys} allowDeselect={false} /></Group>}
            <TargetRates latest={latest} />
            <SplitView empty="Choose a target for its rates over time." list={
              <Table aria-label="Eval targets">
                <Table.Thead><Table.Tr><Table.Th>Target</Table.Th><Table.Th>Cases</Table.Th><Table.Th>Miss</Table.Th><Table.Th>False trigger</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {latest.map((r) => (
                    <Table.Tr key={r.target}>
                      <Table.Td><Anchor href={href('evals', { target: r.target })} aria-current={r.target === open ? 'true' : undefined} fw={r.target === open ? 700 : undefined}>{r.target}</Anchor></Table.Td>
                      <Table.Td>{r.cases}</Table.Td><Table.Td>{rate(r.missRate)}</Table.Td><Table.Td>{rate(r.falseTriggerRate)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            } detail={latest.some((r) => r.target === open) ? (
              <Stack gap="sm" component="section" aria-label={`Eval ${open}`}>
                <Title order={3} size="h3">{open}</Title>
                <Text size="sm">{series}</Text>
                <EvalResults results={mine.filter((r) => r.target === open)} />
              </Stack>
            ) : null} />
          </>
        );
      }}</Loading>
      <RunEvals onDone={evals.reload} />
      <Cli>{`benchkeeper eval${open ? ` --target ${open}` : ''}\nbenchkeeper eval --all`}</Cli>
    </Stack>
  );
}

export function Agents({ overview, params, refresh }) {
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
    load(ids);
  }, [auto, !!overview.data]);
  return (
    <Loading state={overview} label="agents">{(o) => {
      const chosen = select ?? installed;
      return (
        <Stack gap="lg">
          <Table.ScrollContainer minWidth={640}>
          <Table aria-label="Agents">
            <Table.Thead><Table.Tr><Table.Th>Agent</Table.Th><Table.Th>Version</Table.Th><Table.Th>Rules</Table.Th><Table.Th>Skills</Table.Th><Table.Th>Tested</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {o.agents.map((a) => (
                <Table.Tr key={a.id}>
                  <Table.Td><Checkbox label={a.name} disabled={!a.installed} checked={chosen.includes(a.id)} onChange={() => setSelect(chosen.includes(a.id) ? chosen.filter((x) => x !== a.id) : [...chosen, a.id])} /></Table.Td>
                  <Table.Td>{a.version ?? 'not installed'}</Table.Td>
                  <Table.Td><Code>~/{a.rules}</Code></Table.Td>
                  <Table.Td><Code>~/{a.skills}</Code></Table.Td>
                  <Table.Td>{a.tested ? 'tested' : 'untested'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          </Table.ScrollContainer>
          <Group><Button leftSection={icon(IconListCheck)} onClick={() => load(chosen)} disabled={!chosen.length}>Plan setup for {chosen.length} agent{chosen.length === 1 ? '' : 's'}</Button></Group>
          {error && <Note color="red" title="Plan failed">{error}</Note>}
          {plan && <Section title="Changes"><Plan key={plan.planId} plan={plan} onDone={refresh} /></Section>}
          <Text size="sm">Removing the setup: undo its runs in History. The app does not install or remove agents.</Text>
          <Cli>{`benchkeeper plan --agents ${chosen.join(',')}\nbenchkeeper apply --agents ${chosen.join(',')}`}</Cli>
        </Stack>
      );
    }}</Loading>
  );
}

function ProjectDetail({ project, onChange }) {
  const [toggles, setToggles] = useState({ disable: [], enable: [] });
  // The plan reloads with a new id after an apply, so the result lives here.
  const [applied, setApplied] = useState(null);
  const q = new URLSearchParams({ dir: project.path });
  for (const k of ['disable', 'enable']) for (const n of toggles[k]) q.append(k, n);
  const plan = useApi(project.setupVersion && !lags(project) ? `/api/project-plan?${q}` : null);
  const found = useApi(`/api/doctor?dir=${encodeURIComponent(project.path)}`);
  const flip = (s) => setToggles(({ disable, enable }) => (s.disabled
    ? { disable: disable.filter((x) => x !== s.name), enable: [...enable, s.name] }
    : { disable: [...disable, s.name], enable: enable.filter((x) => x !== s.name) }));
  return (
    <Stack gap="lg" component="section" aria-label={`Project ${project.path}`}>
      <Group justify="space-between" align="flex-start">
        <Title order={3} size="h3" style={{ overflowWrap: 'anywhere' }}>{project.path}</Title>
        <Group gap="xs">
          <Button leftSection={icon(IconFolderOpen)} variant="default" onClick={() => api('/api/reveal', { path: project.path }).catch(() => {})}>Open folder</Button>
          {project.setupVersion && !lags(project) && <Button leftSection={icon(IconAdjustments)} variant="default" onClick={onChange.setup}>Change setup</Button>}
          <Button leftSection={icon(IconTrash)} variant="subtle" onClick={onChange.remove}>Remove from list</Button>
        </Group>
      </Group>
      {!project.setupVersion ? (
        <Stack gap="xs" align="flex-start">
          <Text>Not set up yet: no <Code>.benchkeeper/state.json</Code>.</Text>
          <Button leftSection={icon(IconListNumbers)} onClick={onChange.setup}>Set up this project</Button>
        </Stack>
      ) : lags(project) ? (
        <Text>Setup {project.setupVersion} is on <Code>{project.origin}</Code>; this checkout has {project.checkout ? `setup ${project.checkout}` : 'no state file'}. Pull <Code>{project.origin}</Code> to see or change the setup here.</Text>
      ) : applied ? (
        <Section title={`Changes in ${project.path}`}>
          <Group justify="space-between"><Button leftSection={icon(IconListCheck)} variant="default" onClick={() => setApplied(null)}>Plan again</Button><Anchor href={href('history', { run: applied.id })}>Open in History</Anchor></Group>
          <RunPanel id={applied.id} output={applied.output} order={3} onChanged={onChange.done} />
        </Section>
      ) : (
        <Loading state={plan} label="project plan">{(p) => (
          <>
            {!!p.chosen.length && (
              <Section title="Skills">
                {p.chosen.map((s) => <Switch key={s.name} label={s.name} checked={!s.disabled} onChange={() => flip(s)} />)}
                <Text size="sm">A skill turned off moves to <Code>.benchkeeper/disabled/</Code> when the plan is applied.</Text>
              </Section>
            )}
            <Section title={`Changes in ${project.path}`}>
              {p.warnings.map((w) => <Note key={w} color="yellow">{w}</Note>)}
              <Plan key={p.planId} plan={p} onDone={(run, output) => { if (run) setApplied({ id: run.id, output }); setToggles({ disable: [], enable: [] }); plan.reload(); onChange.done(); }} />
            </Section>
          </>
        )}</Loading>
      )}
      <Section title="Project doctor"><Loading state={found} label="doctor">{(f) => <DoctorTable found={f.map((i) => ({ ...i, dir: project.path }))} />}</Loading></Section>
    </Stack>
  );
}

// Origin's setup counts when the checkout's is older or missing: the checkout needs a pull.
const lags = (p) => p.setupVersion && p.checkout !== p.setupVersion;
// committed: the repository still carries a setup kept local; Update all opens the pull request that removes it.
const SetupBadge = ({ p, version }) => (
  <Group gap={4} wrap="nowrap">
    <Badge variant="default" miw="max-content" leftSection={<Dot color={!p.setupVersion ? 'gray' : p.setupVersion === version ? 'teal' : 'yellow'} />}>
      {p.setupVersion ? `${p.setupVersion} ${p.setupVersion === version ? 'current' : 'behind'}${lags(p) ? ` on ${p.origin}` : ''}` : 'no state file'}
    </Badge>
    {p.setupVersion && <Badge variant="default" miw="max-content">{p.share ? 'shared' : p.committed ? 'local, still committed' : 'local'}</Badge>}
  </Group>
);

// Skills per chosen agent: in this project, and in all, its global and plugin skills included. Every one costs
// its description in each session, and similar descriptions make the agent pick the wrong one.
function SkillCount({ p, names }) {
  const agents = Object.keys(p.seen ?? {});
  if (!agents.length) return '-';
  return (
    <Stack gap={0}>
      {agents.map((a) => <Text key={a} size="sm" style={{ whiteSpace: 'nowrap' }}>{agents.length > 1 ? `${names[a] ?? a}: ` : ''}{p.skills[a]} here, {p.seen[a]} in all</Text>)}
    </Stack>
  );
}

export function Projects({ params, overview, refresh }) {
  const projects = useApi('/api/projects');
  const open = params.get('path');
  const [path, setPath] = useState('');
  const [found, setFound] = useState(null);
  const [pick, setPick] = useState([]);
  const [push, setPush] = useState(true);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [setupPaths, setSetupPaths] = useState(null);
  const version = overview.data?.version;
  const names = Object.fromEntries((overview.data?.agents ?? []).map((a) => [a.id, a.name]));
  const fresh = (projects.data ?? []).filter((p) => !p.setupVersion && !p.error).map((p) => p.path);
  const reload = () => { projects.reload(); refresh(); };
  const act = (name, f) => async () => { setError(null); setBusy(name); try { await f(); } catch (e) { setError(e.message); } setBusy(null); };
  // The OS dialog; when there is none or it is cancelled, the typed path stays.
  const choose = async () => {
    const r = await api('/api/pick-folder', {});
    if (r.unavailable) setError('No folder dialog: it needs osascript, or zenity or kdialog with a display. Type the path.');
    return r.path;
  };
  const add = (dir) => api('/api/projects', { action: 'add', path: dir });
  const scanRoot = act('scan', async () => {
    const root = path || await choose();
    if (!root) return;
    setPath(root);
    const list = await api('/api/scan', { root });
    setFound(list);
    setPick(list);
  });
  const updateAll = act('update', async () => { setConfirmPrs(false); await updateProjects(projects.data.map((p) => p.path), push, setProgress); reload(); });
  // Update all pushes a branch and opens a pull request for each project whose setup is shared or still committed.
  const [confirmPrs, setConfirmPrs] = useState(false);
  const prs = push ? (projects.data ?? []).filter((p) => p.share || p.committed).length : 0;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return (
    <Stack gap="lg">
      <form onSubmit={(e) => { e.preventDefault(); act('add', async () => { await add(path); setPath(''); reload(); })(); }}>
        <Group align="flex-end">
          <TextInput label="Project folder" placeholder="/home/me/code/app" value={path} onChange={(e) => setPath(e.currentTarget.value)} w={{ base: '100%', sm: 420 }} />
          <Button leftSection={icon(IconFolderSearch)} variant="default" loading={busy === 'choose'} onClick={act('choose', async () => { const p = await choose(); if (p) setPath(p); })}>Choose folder</Button>
          <Button leftSection={icon(IconPlus)} type="submit" disabled={!path} loading={busy === 'add'}>Add project</Button>
          <Button leftSection={icon(IconFolders)} variant="default" loading={busy === 'scan'} onClick={scanRoot}>Scan for projects</Button>
        </Group>
      </form>
      {error && <Note color="red" title="Failed">{error}</Note>}
      {found && (
        <Section title="Found projects">
          {found.length ? (
            <>
              <Checkbox.Group value={pick} onChange={setPick} label={`Folders with an agent setup below ${path}, not registered yet`}>
                <Stack gap={4} mt="xs">{found.map((d) => <Checkbox key={d} value={d} label={d} />)}</Stack>
              </Checkbox.Group>
              <Group><Button leftSection={icon(IconPlus)} disabled={!pick.length} loading={busy === 'add-found'} onClick={act('add-found', async () => { for (const d of pick) await add(d); setFound(null); reload(); })}>Add selected ({pick.length})</Button></Group>
            </>
          ) : <Text>No unregistered folders with AGENTS.md, skills-lock.json or a state file below {path}.</Text>}
        </Section>
      )}
      <Loading state={projects} label="projects">{(list) => (list.length ? (
        <SplitView empty="Choose a project for its plan, skills and doctor findings." list={
          <Table.ScrollContainer minWidth={420}>
          <Table aria-label="Projects" horizontalSpacing="xs">
            <Table.Thead><Table.Tr><Table.Th>Project</Table.Th><Table.Th>Setup</Table.Th><Table.Th>Skills</Table.Th><Table.Th>Changes</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {list.map((p) => (
                <Table.Tr key={p.path}>
                  <Table.Td><Anchor href={href('projects', { path: p.path })} aria-current={p.path === open ? 'true' : undefined} fw={p.path === open ? 700 : undefined} style={{ whiteSpace: 'nowrap' }}>{p.path.split('/').pop()}</Anchor><Text size="xs" style={{ overflowWrap: 'anywhere' }}>{[p.path, p.branch, p.repo ? (p.clean ? 'clean' : 'dirty') : 'no repository'].filter(Boolean).join(', ')}</Text></Table.Td>
                  <Table.Td><SetupBadge p={p} version={version} /></Table.Td>
                  <Table.Td><SkillCount p={p} names={names} /></Table.Td>
                  <Table.Td>{p.error ? <Text size="sm" c="red">{p.error}</Text> : p.changes ? <Text size="sm" style={{ whiteSpace: 'nowrap' }}>{p.changes.length} pending</Text> : '-'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          </Table.ScrollContainer>
        } detail={open && list.some((p) => p.path === open) ? (
          <ProjectDetail key={open} project={list.find((p) => p.path === open)} onChange={{ done: reload, setup: () => setSetupPaths({ paths: [open], change: !!list.find((p) => p.path === open)?.setupVersion }), remove: act('remove', async () => { await api('/api/projects', { action: 'remove', path: open }); go('projects'); reload(); }) }} />
        ) : null} />
      ) : <Text>No projects. Add a folder set up with benchkeeper project apply, or scan a parent folder.</Text>)}</Loading>
      <Section title="Update all">
        <Text size="sm">A local setup is written in the checkout. A shared one gets branch chore/agent-setup-&lt;version&gt; per project in a worktree, one commit. Projects with uncommitted changes are skipped. A project without a state file is set up step by step first.</Text>
        <Group>
          <Checkbox label="Push and open a pull request when origin is on GitHub" checked={push} onChange={(e) => setPush(e.currentTarget.checked)} />
          <Button leftSection={icon(IconRefresh)} loading={busy === 'update'} disabled={!projects.data?.length} onClick={prs ? () => setConfirmPrs(true) : updateAll}>Update all</Button>
          <Button variant="default" disabled={!fresh.length} onClick={() => setSetupPaths({ paths: fresh })}>Set up {fresh.length} new projects</Button>
        </Group>
        {progress && <UpdateResults progress={progress} extra={(r) => fresh.includes(r.path) && <Button size="xs" variant="default" ml="sm" onClick={() => setSetupPaths({ paths: [r.path] })}>Set up</Button>} />}
      </Section>
      <Modal opened={confirmPrs} onClose={() => setConfirmPrs(false)} withCloseButton={false} attributes={{ content: { 'aria-label': `Open up to ${plural(prs, 'pull request')}?` } }}>
        <Stack gap="sm">
          <Title order={2} size="h4">Open up to {plural(prs, 'pull request')}?</Title>
          <Text size="sm">{plural(prs, 'project')} with a shared setup get a branch pushed to origin and a pull request when origin is on GitHub. Projects with uncommitted changes are skipped.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmPrs(false)}>Cancel</Button>
            <Button leftSection={icon(IconRefresh)} onClick={updateAll}>Update all and open up to {plural(prs, 'pull request')}</Button>
          </Group>
        </Stack>
      </Modal>
      {setupPaths && <ProjectSetup paths={setupPaths.paths} change={setupPaths.change} push={push} onClose={() => { setSetupPaths(null); reload(); }} />}
      <Cli>{`benchkeeper projects add ${path || '<dir>'}\nbenchkeeper projects scan ${path || '<root>'}\nbenchkeeper project plan ${open ?? '<dir>'}\nbenchkeeper update-all${push ? '' : ' --no-push'}\nbenchkeeper record --project <dir> -- claude '/benchkeeper:setting-up-projects'`}</Cli>
    </Stack>
  );
}

export function History({ history, params, refresh }) {
  const open = params.get('run');
  return (
    <Stack gap="lg">
      <Loading state={history} label="history">{(runs) => {
        const days = Object.entries(groupBy(runs, (r) => new Date(r.time).toLocaleDateString()));
        return runs.length ? (
          <SplitView span={4} empty="Choose a run for what it changed and undo." list={
            <Stack gap="md" component="nav" aria-label="Runs">
              {days.map(([d, rs]) => (
                <Stack key={d} gap={2}>
                  <Title order={3} size="h6" tt="uppercase" px="xs">{d}</Title>
                  {rs.map((r) => (
                    <NavLink key={r.id} href={href('history', { run: r.id })} active={r.id === open} aria-current={r.id === open ? 'true' : undefined} variant="light" color="gray"
                      leftSection={<StatusIcon status={r.status ?? 'running'} />} label={runTitle(r)} styles={{ label: { color: 'var(--mantine-color-text)' }, description: { color: 'var(--mantine-color-text)' } }}
                      description={`${r.status ?? 'interrupted'}, ${r.changes} change${r.changes === 1 ? '' : 's'}, ${new Date(r.time).toLocaleTimeString()}${note(r) ? `, ${note(r)}` : ''}`} />
                  ))}
                </Stack>
              ))}
            </Stack>
          } detail={open ? <RunPanel key={open} id={open} order={3} onChanged={refresh} /> : null} />
        ) : <Text>No runs yet.</Text>;
      }}</Loading>
      <Cli>{`benchkeeper history\nbenchkeeper undo ${open ?? '<run>'}\nbenchkeeper undo ${open ?? '<run>'} --step <step>\nbenchkeeper case add --run <session run> --target skill:<name> --expected <text>`}</Cli>
    </Stack>
  );
}

const SHORTCUTS = [[`${MOD}+K, /`, 'command palette'], [`${MOD}+1 to ${MOD}+8`, 'views in sidebar order'], [`${MOD}+J`, 'light or dark theme']];

function Profile({ overview, refresh }) {
  const [file, setFile] = useState(null);
  const [plans, setPlans] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const agents = overview.data?.agents.filter((a) => a.installed).map((a) => a.id) ?? [];
  const run = (f) => async (...a) => { setError(null); setBusy(true); try { await f(...a); } catch (e) { setError(e.message); } setBusy(false); };
  return (
    <Section title="Profile">
      <Text size="sm">Agents, packs, own packs and registered projects with their answers as one file. It holds no file contents, environment values or tokens.</Text>
      {error && <Note color="red" title="Failed">{error}</Note>}
      <Group>
        <Button leftSection={icon(IconDownload)} variant="default" disabled={!agents.length} onClick={run(async () => download('benchkeeper-profile.json', (await api(`/api/profile-export?agents=${agents.join(',')}`)).text))}>Export profile</Button>
        <FileButton key={file?.name ?? 'none'} accept="application/json,.json"
          onChange={run(async (f) => { setPlans(null); setFile(null); if (!f) return; const text = await f.text(); setFile({ name: f.name, text, ...(await api('/api/profile-import', { text })) }); })}>
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
          <Section title="Global changes"><Plan key={plans.global.planId} plan={plans.global} onDone={refresh} /></Section>
          {plans.plans.map((p) => <Section key={p.planId} title={`Changes in ${p.path}`}><Plan plan={p} onDone={refresh} /></Section>)}
        </>
      )}
      <Cli>{`benchkeeper profile export benchkeeper-profile.json --agents ${agents.join(',') || '<a,b>'}\nbenchkeeper profile import benchkeeper-profile.json`}</Cli>
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
          <Table.Tbody>{SHORTCUTS.map(([k, a]) => <Table.Tr key={k}><Table.Td><Code>{k}</Code></Table.Td><Table.Td>{a}</Table.Td></Table.Tr>)}</Table.Tbody>
        </Table>
        <Switch label="Open the command palette with the / key" description="Turn it off if a single-key shortcut gets in the way of speech input or screen reader keys." checked={keys.slash} onChange={(e) => keys.setSlash(e.currentTarget.checked)} />
      </Section>
      <Section title="Files">
        <List spacing={4} size="sm">
          <List.Item><Code>~/.config/benchkeeper/ledger/</Code>: one JSON file per run</List.Item>
          <List.Item><Code>~/.config/benchkeeper/backup/</Code>: replaced and removed files per run</List.Item>
          <List.Item><Code>~/.config/benchkeeper/projects.json</Code>: registered projects</List.Item>
          <List.Item><Code>~/.config/benchkeeper/packs/</Code>: own packs</List.Item>
          <List.Item><Code>~/.config/benchkeeper/evals/</Code>: own eval cases and <Code>results.jsonl</Code></List.Item>
        </List>
        <Text size="sm"><Code>BENCHKEEPER_NO_UPDATE_CHECK=1</Code> turns off the registry request for a newer version. It runs only in a terminal and never installs.</Text>
      </Section>
    </Stack>
  );
}

// The sessions board in a frame: a scan job fills the session cache first (the first one reads every transcript), then
// the board renders from the server's last scan; a reload within a minute shows it without scanning. The frame follows the app's theme.
export function Sessions() {
  const scheme = useComputedColorScheme('light');
  const [job, setJob] = useState(null);
  const [shown, setShown] = useState(0);
  const [error, setError] = useState(null);
  const [src, setSrc] = useState(null);
  const theme = useRef(scheme);
  useEffect(() => { theme.current = scheme; }, [scheme]);
  // Each frame load takes a one-time ticket (the frame cannot send the API key), also after a theme change.
  const show = async () => {
    try { const { ticket } = await api('/api/board-ticket', {}); setSrc(`/board?theme=${theme.current}&ticket=${ticket}`); setShown((n) => n + 1); } catch (e) { setError(e.message); }
  };
  useEffect(() => { if (src) show(); }, [scheme]);
  const scan = async (force) => {
    setError(null);
    try { const r = await api('/api/sessions-scan', force ? { force: true } : {}); if (r.fresh) show(); else setJob(r.job); } catch (e) { setError(e.message); }
  };
  useEffect(() => { scan(); }, []);
  const state = useJob(job, (s) => { if (s.error) setError(s.error); else show(); setJob(null); });
  const p = state?.progress;
  return (
    <Stack gap="lg">
      <Group justify="flex-end">
        <Button leftSection={icon(IconRefresh)} variant="default" loading={!!job} onClick={() => scan(true)}>Rescan</Button>
      </Group>
      <Text maw={720}>Claude Code and Codex sessions on this machine, read from their transcripts: tier, setup, skills used, tests, cost and pull requests. Nothing leaves this machine except the pull request lookups through gh.</Text>
      {error && <Note color="red">{error}</Note>}
      {job && <Stack gap={4}><Text size="sm">Reading transcripts{p ? `: ${p.done} of ${p.total} files` : ''}</Text><Progress value={p?.total ? (p.done / p.total) * 100 : 0} aria-label="Transcripts read" /></Stack>}
      {src && <iframe key={shown} src={src} title="Sessions board" style={{ width: '100%', height: 'calc(100vh - 260px)', minHeight: 480, border: '1px solid var(--mantine-color-default-border)', borderRadius: 8 }} />}
      <Cli>benchkeeper board</Cli>
    </Stack>
  );
}
