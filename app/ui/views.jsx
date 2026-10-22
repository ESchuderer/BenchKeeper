import { LineChart } from '@mantine/charts';
import { Alert, Anchor, Badge, Box, Button, Checkbox, Code, Drawer, FileInput, Grid, Group, List, Progress, RingProgress, Select, Stack, Switch, Table, Text, TextInput, Timeline, Title } from '@mantine/core';
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Cli, Loading, Plan, RunEntries, Section, StateBadge, useApi } from './parts.jsx';
import { sideBySide } from './diff.js';
import { Dot, MOD, RANK, STATE_COLOR, SplitView, download, go, href } from './shell.jsx';

const ATTENTION = ['absent', 'outdated', 'modified', 'removed', 'foreign', 'missing', 'error'];
const PARTS = ['rules', 'ask', 'plugin', 'skills', 'settings', 'tools', 'other'];
const worst = (items) => items.reduce((w, i) => (RANK.indexOf(i.state) > RANK.indexOf(w) ? i.state : w), items[0]?.state);
const note = (r) => (r.note?.case ? `eval case ${r.note.case} for ${r.note.target}` : r.note?.updateAll ? `Update all of ${r.note.updateAll}` : r.of ? `undo of ${r.of}` : '');
const when = (t) => new Date(t).toLocaleString();

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
                <a href={n.href} aria-label={`${n.label}: ${n.value}, ${n.status}`}>
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
        {nodes.map((n) => <List.Item key={n.label}><Anchor href={n.href}>{n.label}</Anchor>: {n.value} ({n.status})</List.Item>)}
      </List>
    </>
  );
}

// Doctor findings the setup can fix open the plan that fixes them; the others keep their fix text only.
function fixAction(i) {
  if (i.check === 'unexpected') return [href('agents', { plan: '1' }), 'Review removal'];
  if (['rules', 'ask', 'plugin', 'skills', 'settings', 'tools', 'global'].includes(i.check) && i.fix.startsWith('benchkeeper apply')) return [href('agents', { plan: '1' }), 'Plan fix'];
  if (i.check === 'project') return [href('projects', i.dir ? { path: i.dir } : {}), 'Plan project'];
  return null;
}

export function DoctorTable({ found }) {
  if (!found.length) return <Text>No problems found.</Text>;
  return (
    <Table.ScrollContainer minWidth={560}>
      <Table aria-label="Doctor findings">
        <Table.Thead><Table.Tr><Table.Th w={110}>Level</Table.Th><Table.Th>Problem</Table.Th><Table.Th>Fix</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {found.map((i, n) => {
            const action = fixAction(i);
            return (
              <Table.Tr key={n}>
                <Table.Td><Badge variant="default" leftSection={<Dot color={i.level === 'error' ? 'red' : 'yellow'} />}>{i.level}</Badge></Table.Td>
                <Table.Td>{i.message}</Table.Td>
                <Table.Td><Stack gap={4} align="flex-start"><Text size="sm">{i.fix}</Text>{action && <Button component="a" href={action[0]} size="xs" variant="default">{action[1]}</Button>}</Stack></Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

export function Dashboard({ overview, doctor, history, params }) {
  const inv = useApi('/api/inventory');
  const panel = params.get('panel');
  useEffect(() => { if (panel) document.getElementById(panel)?.scrollIntoView(); }, [panel, doctor.data]);
  const o = overview.data, items = inv.data ?? [];
  const agents = o?.agents.filter((a) => a.installed) ?? [];
  const attention = items.filter((i) => ATTENTION.includes(i.state));
  const errors = doctor.data?.filter((i) => i.level === 'error').length ?? 0, warnings = (doctor.data?.length ?? 0) - errors;
  const behind = o?.projects.filter((p) => p.setupVersion !== o.version).length ?? 0;
  const nodes = [
    { label: 'Agents detected', value: `${agents.length} installed`, status: agents.length ? 'ok' : 'problem', href: href('agents') },
    { label: 'Global setup', value: inv.data ? `${attention.length} need attention` : 'checking', status: attention.length ? 'attention' : 'ok', href: href('agents', { plan: '1' }) },
    { label: 'Projects', value: `${o?.projects.length ?? 0} registered, ${behind} behind`, status: behind ? 'attention' : 'ok', href: href('projects') },
    { label: 'Doctor', value: doctor.data ? `${errors} errors, ${warnings} warnings` : 'checking', status: errors ? 'problem' : warnings ? 'attention' : 'ok', href: href('dashboard', { panel: 'doctor' }) },
  ];
  return (
    <Stack gap="xl">
      <Section title="Setup flow"><Flow nodes={nodes} /></Section>
      <Grid gutter="xl">
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Section title="Install health"><Loading state={inv} label="inventory">{() => <InstallHealth items={items} />}</Loading></Section>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Section title="Coverage"><Loading state={inv} label="inventory">{() => <Coverage items={items} agents={agents} />}</Loading></Section>
        </Grid.Col>
      </Grid>
      <Section title="Needs attention">
        <Loading state={inv} label="inventory">{() => (attention.length ? (
          <Table>
            <Table.Thead><Table.Tr><Table.Th miw={130}>State</Table.Th><Table.Th>Item</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{attention.map((c) => <Table.Tr key={`${c.step}|${c.title}`}><Table.Td><StateBadge state={c.state} /></Table.Td><Table.Td>{c.title}</Table.Td></Table.Tr>)}</Table.Tbody>
          </Table>
        ) : <Text>Global setup matches {agents.map((a) => a.name).join(', ') || 'no agent'}.</Text>)}</Loading>
      </Section>
      <Grid gutter="xl">
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Section title="Recent runs">
            <Loading state={history} label="history">{(runs) => (runs.length ? (
              <Timeline bulletSize={14} lineWidth={2}>
                {runs.slice(0, 6).map((r) => (
                  <Timeline.Item key={r.id} title={<Anchor href={href('history', { run: r.id })}>{r.kind} {r.scope}</Anchor>}>
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
          <Group key={n} justify="space-between" wrap="nowrap"><Text size="sm">{n}</Text><Button size="xs" variant="default" onClick={() => onRemove(n)} aria-label={`Remove ${n}`}>Remove</Button></Group>
        )) : <Text size="sm">Choose skills with the checkboxes in the list.</Text>}
        {warn.data?.map((w) => <Alert key={w} color="yellow">{w}</Alert>)}
        {error && <Alert color="red" title="Save failed">{error}</Alert>}
        <Group><Button onClick={save} disabled={!id || !skills.length}>Save pack</Button></Group>
        <Cli>{`benchkeeper packs save ${id || '<id>'} ${skills.map((n) => `--skill ${n}`).join(' ')}`}</Cli>
      </Stack>
    </Drawer>
  );
}

function Packs({ packs, onChange }) {
  const [error, setError] = useState(null);
  const [file, setFile] = useState(0);
  const run = (f) => async (...a) => { setError(null); try { await f(...a); onChange(); } catch (e) { setError(e.message); } };
  return (
    <Section title="Packs">
      {error && <Alert color="red" title="Failed">{error}</Alert>}
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
                    {p.skills && <Button size="xs" variant="default" aria-label={`Export ${p.id}`} onClick={run(async () => { const r = await api(`/api/pack-export?id=${encodeURIComponent(p.id)}`); download(r.name, r.text); })}>Export</Button>}
                    {p.own && <Button size="xs" variant="subtle" aria-label={`Remove ${p.id}`} onClick={run(() => api('/api/packs', { action: 'remove', id: p.id }))}>Remove</Button>}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <FileInput key={file} label="Import a pack file" accept="application/json,.json" maw={360}
        onChange={run(async (f) => { if (!f) return; await api('/api/packs', { action: 'import', text: await f.text() }); setFile((n) => n + 1); })} />
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
            <Select label="Pack" clearable value={pack} onChange={setPack} data={c.packs.filter((p) => p.skills).map((p) => ({ value: p.id, label: `${p.title ?? p.id}${p.own ? ' (own)' : ''}` }))} />
            <Select label="Agent" clearable value={agent} onChange={setAgent} data={[{ value: 'claude', label: 'Claude Code' }, { value: 'codex', label: 'Codex' }]} />
            <Select label="Install state" clearable value={used} onChange={setUsed} data={[{ value: 'used', label: 'In a project' }, { value: 'unused', label: 'In no project' }]} />
            <Button variant="default" onClick={() => setBuilder(true)}>Build pack ({picked.length})</Button>
          </Group>
          <SplitView empty="Choose a skill for its source, pin and eval results." list={
            <Table aria-label="Skills">
              <Table.Thead><Table.Tr><Table.Th>Pack</Table.Th><Table.Th>Skill</Table.Th><Table.Th>Source</Table.Th><Table.Th>Projects</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {skills.map((s) => (
                  <Table.Tr key={s.name}>
                    <Table.Td><Checkbox aria-label={`Add ${s.name} to the pack`} checked={picked.includes(s.name)} onChange={() => flip(s.name)} /></Table.Td>
                    <Table.Td><Anchor href={href('catalog', { skill: s.name })} aria-current={s.name === open ? 'true' : undefined} fw={s.name === open ? 700 : undefined}>{s.name}</Anchor></Table.Td>
                    <Table.Td>{s.source}</Table.Td>
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
      <Group justify="space-between"><Title order={2} size="h3">{skill.name}</Title><Button component="a" href={href('catalog')} variant="subtle">Close</Button></Group>
      <Text>{skill.pickWhen}</Text>
      <Text size="sm">Source: {skill.source === 'own' ? 'BenchKeeper' : <Anchor href={`https://github.com/${skill.source}/tree/${skill.ref}`} target="_blank" rel="noreferrer">{skill.source}</Anchor>}{skill.ref && <>, pinned at <Code>{skill.ref.slice(0, 12)}</Code></>}{skill.license && `, ${skill.license}`}</Text>
      {skill.agents === 'codex' && <Badge variant="default">Codex only</Badge>}
      {results.length ? <EvalResults results={results} /> : <Text size="sm">No eval results for this skill. Measurements: <Anchor href="https://github.com/ESchuderer/BenchKeeper/blob/main/EVALUATIONS.md" target="_blank" rel="noreferrer">EVALUATIONS.md</Anchor></Text>}
      {skill.source === 'own' && <Loading state={text} label="skill text">{(t) => <Code block tabIndex={0}>{t.text}</Code>}</Loading>}
    </Stack>
  );
}

const pct = (v) => (v == null ? null : Math.round(v * 100));
const seriesOf = (r) => `${r.agent}${r.model ? ` ${r.model}` : ''}`;
const COLORS = ['teal.9', 'indigo.9', 'grape.9', 'orange.9', 'cyan.9', 'pink.9', 'lime.9', 'violet.9'];

// Miss and false-trigger rates over time, one series pair per agent and model; the table holds the same numbers.
function EvalResults({ results }) {
  const keys = [...new Set(results.map(seriesOf))];
  const data = results.map((r) => ({ time: when(r.time), [`${seriesOf(r)} miss`]: pct(r.missRate), [`${seriesOf(r)} false trigger`]: pct(r.falseTriggerRate) }));
  const series = keys.flatMap((k, i) => [{ name: `${k} miss`, color: COLORS[(2 * i) % COLORS.length] }, { name: `${k} false trigger`, color: COLORS[(2 * i + 1) % COLORS.length], strokeDasharray: '5 5' }]);
  return (
    <Stack gap="sm">
      <LineChart h={240} data={data} dataKey="time" series={series} unit="%" yAxisProps={{ domain: [0, 100] }} withLegend connectNulls />
      <Table.ScrollContainer minWidth={560}>
        <Table aria-label="Eval runs">
          <Table.Thead><Table.Tr><Table.Th>Time</Table.Th><Table.Th>Agent</Table.Th><Table.Th>Model</Table.Th><Table.Th>App</Table.Th><Table.Th>Cases</Table.Th><Table.Th>Miss</Table.Th><Table.Th>False trigger</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {results.map((r, i) => (
              <Table.Tr key={i}>
                <Table.Td>{when(r.time)}</Table.Td><Table.Td>{r.agent} {r.agentVersion}</Table.Td><Table.Td>{r.model ?? 'default'}</Table.Td><Table.Td>{r.appVersion}</Table.Td>
                <Table.Td>{r.cases}</Table.Td><Table.Td>{r.missRate == null ? '-' : `${pct(r.missRate)}%`}</Table.Td><Table.Td>{r.falseTriggerRate == null ? '-' : `${pct(r.falseTriggerRate)}%`}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}

export function Evals({ params }) {
  const evals = useApi('/api/evals');
  const open = params.get('target');
  return (
    <Stack gap="lg">
      <Loading state={evals} label="eval results">{(all) => {
        const targets = [...new Set(all.map((r) => r.target))];
        return targets.length ? (
          <SplitView empty="Choose a target for its rates over time." list={
            <Table aria-label="Eval targets">
              <Table.Thead><Table.Tr><Table.Th>Target</Table.Th><Table.Th>Latest</Table.Th><Table.Th>Miss</Table.Th><Table.Th>False trigger</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {targets.map((t) => {
                  const last = all.filter((r) => r.target === t).at(-1);
                  return (
                    <Table.Tr key={t}>
                      <Table.Td><Anchor href={href('evals', { target: t })} aria-current={t === open ? 'true' : undefined} fw={t === open ? 700 : undefined}>{t}</Anchor></Table.Td>
                      <Table.Td>{seriesOf(last)}</Table.Td>
                      <Table.Td>{last.missRate == null ? '-' : `${pct(last.missRate)}%`}</Table.Td>
                      <Table.Td>{last.falseTriggerRate == null ? '-' : `${pct(last.falseTriggerRate)}%`}</Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          } detail={targets.includes(open) ? (
            <Stack gap="sm" component="section" aria-label={`Eval ${open}`}>
              <Title order={2} size="h3">{open}</Title>
              <EvalResults results={all.filter((r) => r.target === open)} />
            </Stack>
          ) : null} />
        ) : <Text>No eval results yet. Running evals starts real agent sessions, so it stays in the CLI.</Text>;
      }}</Loading>
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
          <Group><Button onClick={() => load(chosen)} disabled={!chosen.length}>Plan setup for {chosen.length} agents</Button></Group>
          {error && <Alert color="red" title="Plan failed">{error}</Alert>}
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
  const q = new URLSearchParams({ dir: project.path });
  for (const k of ['disable', 'enable']) for (const n of toggles[k]) q.append(k, n);
  const plan = useApi(project.setupVersion ? `/api/project-plan?${q}` : null);
  const found = useApi(`/api/doctor?dir=${encodeURIComponent(project.path)}`);
  const flip = (s) => setToggles(({ disable, enable }) => (s.disabled
    ? { disable: disable.filter((x) => x !== s.name), enable: [...enable, s.name] }
    : { disable: [...disable, s.name], enable: enable.filter((x) => x !== s.name) }));
  return (
    <Stack gap="lg" component="section" aria-label={`Project ${project.path}`}>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Title order={2} size="h3" style={{ wordBreak: 'break-all' }}>{project.path}</Title>
        <Button variant="subtle" onClick={onChange.remove}>Remove from list</Button>
      </Group>
      {!project.setupVersion ? <Text>No state file: run <Code>benchkeeper project apply</Code> there first.</Text> : (
        <Loading state={plan} label="project plan">{(p) => (
          <>
            {!!p.chosen.length && (
              <Section title="Skills">
                {p.chosen.map((s) => <Switch key={s.name} label={s.name} checked={!s.disabled} onChange={() => flip(s)} />)}
                <Text size="sm">A skill turned off moves to <Code>.benchkeeper/disabled/</Code> when the plan is applied.</Text>
              </Section>
            )}
            <Section title={`Changes in ${project.path}`}>
              {p.warnings.map((w) => <Alert key={w} color="yellow">{w}</Alert>)}
              <Plan key={p.planId} plan={p} onDone={() => { setToggles({ disable: [], enable: [] }); onChange.done(); }} />
            </Section>
          </>
        )}</Loading>
      )}
      <Section title="Project doctor"><Loading state={found} label="doctor">{(f) => <DoctorTable found={f.map((i) => ({ ...i, dir: project.path }))} />}</Loading></Section>
    </Stack>
  );
}

const SetupBadge = ({ p, version }) => (
  <Badge variant="default" leftSection={<Dot color={!p.setupVersion ? 'gray' : p.setupVersion === version ? 'teal' : 'yellow'} />}>
    {p.setupVersion ? `${p.setupVersion} ${p.setupVersion === version ? 'current' : 'behind'}` : 'no state file'}
  </Badge>
);

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
  const version = overview.data?.version;
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
  // One request per project, so the server's synchronous apply stays as it is and each row reports on its own.
  const updateAll = act('update', async () => {
    const rows = projects.data.map((p) => ({ path: p.path, status: 'pending' }));
    setProgress([...rows]);
    for (const [i, row] of rows.entries()) {
      rows[i] = { ...row, status: 'running' };
      setProgress([...rows]);
      try { rows[i] = (await api('/api/update-all', { paths: [row.path], push }))[0] ?? { path: row.path, status: 'stopped', reason: 'no longer registered' }; } catch (e) { rows[i] = { path: row.path, status: 'stopped', reason: e.message }; }
      setProgress([...rows]);
    }
    reload();
  });
  const done = progress?.filter((r) => !['pending', 'running'].includes(r.status)).length ?? 0;
  return (
    <Stack gap="lg">
      <form onSubmit={(e) => { e.preventDefault(); act('add', async () => { await add(path); setPath(''); reload(); })(); }}>
        <Group align="flex-end">
          <TextInput label="Project folder" placeholder="/home/me/code/app" value={path} onChange={(e) => setPath(e.currentTarget.value)} w={{ base: '100%', sm: 420 }} />
          <Button variant="default" loading={busy === 'choose'} onClick={act('choose', async () => { const p = await choose(); if (p) setPath(p); })}>Choose folder</Button>
          <Button type="submit" disabled={!path} loading={busy === 'add'}>Add project</Button>
          <Button variant="default" loading={busy === 'scan'} onClick={scanRoot}>Scan for projects</Button>
        </Group>
      </form>
      {error && <Alert color="red" title="Failed">{error}</Alert>}
      {found && (
        <Section title="Found projects">
          {found.length ? (
            <>
              <Checkbox.Group value={pick} onChange={setPick} label={`Folders with an agent setup below ${path}, not registered yet`}>
                <Stack gap={4} mt="xs">{found.map((d) => <Checkbox key={d} value={d} label={d} />)}</Stack>
              </Checkbox.Group>
              <Group><Button disabled={!pick.length} loading={busy === 'add-found'} onClick={act('add-found', async () => { for (const d of pick) await add(d); setFound(null); reload(); })}>Add selected ({pick.length})</Button></Group>
            </>
          ) : <Text>No unregistered folders with AGENTS.md, skills-lock.json or a state file below {path}.</Text>}
        </Section>
      )}
      <Loading state={projects} label="projects">{(list) => (list.length ? (
        <SplitView empty="Choose a project for its plan, skills and doctor findings." list={
          <Table aria-label="Projects">
            <Table.Thead><Table.Tr><Table.Th>Project</Table.Th><Table.Th miw={140}>Setup</Table.Th><Table.Th>Changes</Table.Th><Table.Th>Tree</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {list.map((p) => (
                <Table.Tr key={p.path}>
                  <Table.Td><Anchor href={href('projects', { path: p.path })} aria-current={p.path === open ? 'true' : undefined} fw={p.path === open ? 700 : undefined} style={{ wordBreak: 'break-all' }}>{p.path}</Anchor>{p.branch && <Text size="xs">{p.branch}</Text>}</Table.Td>
                  <Table.Td><SetupBadge p={p} version={version} /></Table.Td>
                  <Table.Td>{p.error ? <Text size="sm" c="red">{p.error}</Text> : p.changes ? `${p.changes.length} pending` : '-'}</Table.Td>
                  <Table.Td>{p.repo ? (p.clean ? 'clean' : 'dirty') : 'no repository'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        } detail={open && list.some((p) => p.path === open) ? (
          <ProjectDetail key={open} project={list.find((p) => p.path === open)} onChange={{ done: reload, remove: act('remove', async () => { await api('/api/projects', { action: 'remove', path: open }); go('projects'); reload(); }) }} />
        ) : null} />
      ) : <Text>No projects. Add a folder set up with benchkeeper project apply, or scan a parent folder.</Text>)}</Loading>
      <Section title="Update all">
        <Text size="sm">Per project: branch chore/agent-setup-&lt;version&gt; in a worktree, one commit. Projects with uncommitted changes are skipped.</Text>
        <Group>
          <Checkbox label="Push and open a pull request when origin is on GitHub" checked={push} onChange={(e) => setPush(e.currentTarget.checked)} />
          <Button loading={busy === 'update'} disabled={!projects.data?.length} onClick={updateAll}>Update all</Button>
        </Group>
        {progress && (
          <>
            <Progress.Root size="lg"><Progress.Section value={(done / progress.length) * 100} aria-label={`Update all: ${done} of ${progress.length} projects`} /></Progress.Root>
            <Table aria-label="Update all results">
              <Table.Thead><Table.Tr><Table.Th>Project</Table.Th><Table.Th>Result</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{progress.map((r) => <Table.Tr key={r.path}><Table.Td><Code>{r.path}</Code></Table.Td><Table.Td>{r.status}{r.reason ? `: ${r.reason}` : ''}{r.pr && <> <Anchor href={r.pr} target="_blank" rel="noreferrer">{r.pr}</Anchor></>}</Table.Td></Table.Tr>)}</Table.Tbody>
            </Table>
          </>
        )}
      </Section>
      <Cli>{`benchkeeper projects add ${path || '<dir>'}\nbenchkeeper projects scan ${path || '<root>'}\nbenchkeeper project plan ${open ?? '<dir>'}\nbenchkeeper update-all${push ? '' : ' --no-push'}\nbenchkeeper record --project <dir> -- claude '/benchkeeper:setting-up-projects'`}</Cli>
    </Stack>
  );
}

function SideBySide({ diff, label }) {
  const rows = sideBySide(diff);
  const cell = (t) => ({ fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 'var(--mantine-font-size-xs)', whiteSpace: 'pre', verticalAlign: 'top',
    background: t?.[0] === '-' ? 'var(--mantine-color-red-light)' : t?.[0] === '+' ? 'var(--mantine-color-teal-light)' : undefined });
  return (
    <Table.ScrollContainer minWidth={480} tabIndex={0} aria-label={label}>
      <Table withColumnBorders verticalSpacing={2} aria-label={label}>
        <Table.Thead><Table.Tr><Table.Th>Before</Table.Th><Table.Th>After</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {rows.map((r, i) => (r.gap
            ? <Table.Tr key={i}><Table.Td colSpan={2} style={cell()}>...</Table.Td></Table.Tr>
            : <Table.Tr key={i}><Table.Td style={cell(r.old)}>{r.old}</Table.Td><Table.Td style={cell(r.new)}>{r.new}</Table.Td></Table.Tr>))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function RunDetail({ id, onUndo }) {
  const run = useApi(`/api/run?id=${encodeURIComponent(id)}`);
  return (
    <Stack gap="md" component="section" aria-label={`Run ${id}`}>
      <Loading state={run} label="run">{(r) => {
        const undoable = (e) => (e.status === 'done' || e.touched) && !e.undone;
        const firstOfStep = (e, i) => r.entries.findIndex((x) => x.step === e.step) === i;
        return (
          <>
            <Group justify="space-between" wrap="nowrap">
              <Title order={2} size="h3">{r.kind} {r.scope}</Title>
              <Button variant="default" disabled={!r.entries.some(undoable)} onClick={() => onUndo({ run: id })}>Undo run</Button>
            </Group>
            <Text size="sm"><Code>{r.id}</Code>, {r.status ?? 'interrupted'}, {when(r.time)}{note(r) && `, ${note(r)}`}</Text>
            {r.entries.map((e, i) => (
              <Stack key={i} gap={4}>
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <Text size="sm"><b>{e.status}</b> {e.title}{e.error || e.reason ? `: ${e.error ?? e.reason}` : ''}{e.undone ? ` (undone by ${e.undone})` : ''}</Text>
                  {firstOfStep(e, i) && undoable(e) && <Button size="xs" variant="subtle" aria-label={`Undo step ${e.step}`} onClick={() => onUndo({ run: id, step: e.step })}>Undo step</Button>}
                </Group>
                {e.diff && <SideBySide diff={e.diff} label={`Diff of ${e.path}`} />}
                {e.argv && <Code block tabIndex={0}>{`$ ${e.argv.join(' ')}`}</Code>}
              </Stack>
            ))}
          </>
        );
      }}</Loading>
    </Stack>
  );
}

export function History({ history, params, refresh }) {
  const open = params.get('run');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [n, setN] = useState(0);
  const undo = async (body) => { setError(null); try { setResult(await api('/api/undo', body)); setN((x) => x + 1); refresh(); } catch (e) { setError(e.message); } };
  return (
    <Stack gap="lg">
      {error && <Alert color="red" title="Undo failed">{error}</Alert>}
      {result && <Section title="Undo"><RunEntries run={result} /></Section>}
      <Loading state={history} label="history">{(runs) => {
        const days = [...new Set(runs.map((r) => new Date(r.time).toLocaleDateString()))];
        return runs.length ? (
          <SplitView empty="Choose a run for its changes and undo." list={
            <Stack gap="md" component="nav" aria-label="Runs">
              {days.map((d) => (
                <Stack key={d} gap="xs">
                  <Title order={2} size="h5">{d}</Title>
                  <Timeline bulletSize={14} lineWidth={2}>
                    {runs.filter((r) => new Date(r.time).toLocaleDateString() === d).map((r) => (
                      <Timeline.Item key={r.id} title={<Anchor href={href('history', { run: r.id })} aria-current={r.id === open ? 'true' : undefined} fw={r.id === open ? 700 : undefined}>{r.kind} {r.scope}</Anchor>}>
                        <Text size="sm">{r.status ?? 'interrupted'}, {r.changes} changes, {new Date(r.time).toLocaleTimeString()}</Text>
                        {note(r) && <Text size="xs">{note(r)}</Text>}
                      </Timeline.Item>
                    ))}
                  </Timeline>
                </Stack>
              ))}
            </Stack>
          } detail={open ? <RunDetail key={`${open}-${n}`} id={open} onUndo={undo} /> : null} />
        ) : <Text>No runs yet.</Text>;
      }}</Loading>
      <Cli>{`benchkeeper history\nbenchkeeper undo ${open ?? '<run>'}\nbenchkeeper undo ${open ?? '<run>'} --step <step>\nbenchkeeper case add --run <session run> --target skill:<name> --expected <text>`}</Cli>
    </Stack>
  );
}

const SHORTCUTS = [[`${MOD}+K`, 'command palette'], [`${MOD}+1 to ${MOD}+7`, 'views in sidebar order'], [`${MOD}+J`, 'light or dark theme']];

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
      {error && <Alert color="red" title="Failed">{error}</Alert>}
      <Group align="flex-end">
        <Button variant="default" disabled={!agents.length} onClick={run(async () => download('benchkeeper-profile.json', (await api(`/api/profile-export?agents=${agents.join(',')}`)).text))}>Export profile</Button>
        <FileInput key={file?.name ?? 'none'} label="Import a profile" accept="application/json,.json" maw={360}
          onChange={run(async (f) => { setPlans(null); setFile(null); if (!f) return; const text = await f.text(); setFile({ name: f.name, text, ...(await api('/api/profile-import', { text })) }); })} />
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

export function Settings({ overview, refresh }) {
  return (
    <Stack gap="xl">
      <Profile overview={overview} refresh={refresh} />
      <Section title="Keyboard shortcuts">
        <Table aria-label="Keyboard shortcuts" maw={520}>
          <Table.Thead><Table.Tr><Table.Th>Keys</Table.Th><Table.Th>Action</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{SHORTCUTS.map(([k, a]) => <Table.Tr key={k}><Table.Td><Code>{k}</Code></Table.Td><Table.Td>{a}</Table.Td></Table.Tr>)}</Table.Tbody>
        </Table>
      </Section>
      <Section title="Files">
        <List spacing={4}>
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
