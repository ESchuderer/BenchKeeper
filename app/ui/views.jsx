import { Alert, Anchor, Badge, Box, Button, Checkbox, Code, Grid, Group, List, Paper, RingProgress, Select, Stack, Table, Text, TextInput, Timeline, Title } from '@mantine/core';
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Cli, Loading, Plan, RunEntries, Section, StateBadge, useApi } from './parts.jsx';
import { Dot, MOD, RANK, STATE_COLOR, href } from './shell.jsx';

const ATTENTION = ['outdated', 'modified', 'removed', 'foreign', 'missing', 'error'];
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
            <Table.Thead><Table.Tr><Table.Th>State</Table.Th><Table.Th>Item</Table.Th></Table.Tr></Table.Thead>
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

export function Catalog() {
  const cat = useApi('/api/catalog');
  const [q, setQ] = useState('');
  const [pack, setPack] = useState(null);
  const [agent, setAgent] = useState(null);
  const [used, setUsed] = useState(null);
  const [open, setOpen] = useState(null);
  return (
    <Loading state={cat} label="catalog">{(c) => {
      const inPack = pack && c.packs.find((p) => p.id === pack)?.skills;
      const skills = c.skills.filter((s) => (!q || `${s.name} ${s.pickWhen}`.toLowerCase().includes(q.toLowerCase()))
        && (!inPack || inPack.includes(s.name)) && (!agent || (agent === 'codex' ? true : s.agents !== 'codex'))
        && (!used || (used === 'used' ? s.projects > 0 : s.projects === 0)));
      return (
        <Stack gap="lg">
          <Group align="flex-end">
            <TextInput label="Search" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
            <Select label="Pack" clearable value={pack} onChange={setPack} data={c.packs.filter((p) => p.skills).map((p) => ({ value: p.id, label: `${p.title ?? p.id}${p.own ? ' (own)' : ''}` }))} />
            <Select label="Agent" clearable value={agent} onChange={setAgent} data={[{ value: 'claude', label: 'Claude Code' }, { value: 'codex', label: 'Codex' }]} />
            <Select label="Install state" clearable value={used} onChange={setUsed} data={[{ value: 'used', label: 'In a project' }, { value: 'unused', label: 'In no project' }]} />
          </Group>
          <Grid>
            <Grid.Col span={{ base: 12, md: open ? 6 : 12 }}>
              <Table aria-label="Skills">
                <Table.Thead><Table.Tr><Table.Th>Skill</Table.Th><Table.Th>Source</Table.Th><Table.Th>Projects</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {skills.map((s) => (
                    <Table.Tr key={s.name}>
                      <Table.Td><Anchor component="button" type="button" onClick={() => setOpen(s.name)}>{s.name}</Anchor></Table.Td>
                      <Table.Td>{s.source}</Table.Td>
                      <Table.Td>{s.projects}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Grid.Col>
            {open && <Grid.Col span={{ base: 12, md: 6 }}><SkillDetail skill={c.skills.find((s) => s.name === open)} onClose={() => setOpen(null)} /></Grid.Col>}
          </Grid>
          <Cli>{`benchkeeper packs list\nbenchkeeper project apply --pack ${pack ?? '<id>'}${open ? ` --skill ${open}` : ''}`}</Cli>
        </Stack>
      );
    }}</Loading>
  );
}

function SkillDetail({ skill, onClose }) {
  const text = useApi(skill.source === 'own' ? `/api/skill?name=${encodeURIComponent(skill.name)}` : null);
  return (
    <Paper withBorder p="md" component="section" aria-label={`Skill ${skill.name}`}>
      <Stack gap="xs">
        <Group justify="space-between"><Title order={2} size="h3">{skill.name}</Title><Button variant="subtle" onClick={onClose}>Close</Button></Group>
        <Text>{skill.pickWhen}</Text>
        <Text size="sm">Source: {skill.source === 'own' ? 'BenchKeeper' : <Anchor href={`https://github.com/${skill.source}/tree/${skill.ref}`} target="_blank" rel="noreferrer">{skill.source}</Anchor>}{skill.ref && <>, pinned at <Code>{skill.ref.slice(0, 12)}</Code></>}{skill.license && `, ${skill.license}`}</Text>
        {skill.agents === 'codex' && <Badge variant="default">Codex only</Badge>}
        <Text size="sm">Measurements: <Anchor href="https://github.com/ESchuderer/BenchKeeper/blob/main/EVALUATIONS.md" target="_blank" rel="noreferrer">EVALUATIONS.md</Anchor></Text>
        {skill.source === 'own' && <Loading state={text} label="skill text">{(t) => <Code block>{t.text}</Code>}</Loading>}
      </Stack>
    </Paper>
  );
}

export function Agents({ overview, params }) {
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
          {plan && <Section title="Changes"><Plan key={plan.planId} plan={plan} onDone={overview.reload} /></Section>}
          <Text size="sm">Removing the setup: undo its runs in History. The app does not install or remove agents.</Text>
          <Cli>{`benchkeeper plan --agents ${chosen.join(',')}\nbenchkeeper apply --agents ${chosen.join(',')}`}</Cli>
        </Stack>
      );
    }}</Loading>
  );
}

export function Projects() {
  const projects = useApi('/api/projects');
  const [path, setPath] = useState('');
  const [plan, setPlan] = useState(null);
  const [push, setPush] = useState(true);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const act = (f) => async () => { setError(null); setBusy(true); try { await f(); } catch (e) { setError(e.message); } setBusy(false); };
  return (
    <Stack gap="lg">
      <form onSubmit={(e) => { e.preventDefault(); act(async () => { await api('/api/projects', { action: 'add', path }); setPath(''); projects.reload(); })(); }}>
        <Group align="flex-end">
          <TextInput label="Project folder" placeholder="/home/me/code/app" value={path} onChange={(e) => setPath(e.currentTarget.value)} w={420} />
          <Button type="submit" disabled={!path}>Add project</Button>
        </Group>
      </form>
      {error && <Alert color="red" title="Failed">{error}</Alert>}
      <Loading state={projects} label="projects">{(list) => (list.length ? (
        <Table aria-label="Projects">
          <Table.Thead><Table.Tr><Table.Th>Project</Table.Th><Table.Th>Setup</Table.Th><Table.Th>Branch</Table.Th><Table.Th>Working tree</Table.Th><Table.Th>Changes</Table.Th><Table.Th>Actions</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {list.map((p) => (
              <Table.Tr key={p.path}>
                <Table.Td><Code>{p.path}</Code></Table.Td>
                <Table.Td>{p.setupVersion ?? 'no state file'}</Table.Td>
                <Table.Td>{p.branch ?? '-'}</Table.Td>
                <Table.Td>{p.repo ? (p.clean ? 'clean' : 'changed') : 'not a repository'}</Table.Td>
                <Table.Td>{p.error ?? p.changes?.length ?? '-'}</Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    <Button size="xs" variant="default" disabled={!p.setupVersion} onClick={act(async () => setPlan({ path: p.path, ...(await api(`/api/project-plan?dir=${encodeURIComponent(p.path)}`)) }))}>Plan</Button>
                    <Button size="xs" variant="subtle" onClick={act(async () => { await api('/api/projects', { action: 'remove', path: p.path }); projects.reload(); })}>Remove from list</Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : <Text>No projects. Add a folder set up with benchkeeper project apply.</Text>)}</Loading>
      {plan && (
        <Section title={`Changes in ${plan.path}`}>
          {plan.warnings.map((w) => <Alert key={w} color="yellow">{w}</Alert>)}
          <Plan key={plan.planId} plan={plan} onDone={projects.reload} />
        </Section>
      )}
      <Section title="Update all">
        <Text size="sm">Per project: branch chore/agent-setup-&lt;version&gt; in a worktree, one commit. Projects with uncommitted changes are skipped.</Text>
        <Group>
          <Checkbox label="Push and open a pull request when origin is on GitHub" checked={push} onChange={(e) => setPush(e.currentTarget.checked)} />
          <Button loading={busy} disabled={!projects.data?.length} onClick={act(async () => { setResults(await api('/api/update-all', { paths: projects.data.map((p) => p.path), push })); projects.reload(); })}>Update all</Button>
        </Group>
        {results && (
          <Table aria-label="Update all results">
            <Table.Thead><Table.Tr><Table.Th>Project</Table.Th><Table.Th>Result</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{results.map((r) => <Table.Tr key={r.path}><Table.Td><Code>{r.path}</Code></Table.Td><Table.Td>{r.status}{r.reason ? `: ${r.reason}` : ''}{r.pr && <> <Anchor href={r.pr} target="_blank" rel="noreferrer">{r.pr}</Anchor></>}</Table.Td></Table.Tr>)}</Table.Tbody>
          </Table>
        )}
      </Section>
      <Cli>{`benchkeeper projects add ${path || '<dir>'}\nbenchkeeper project plan <dir>\nbenchkeeper update-all${push ? '' : ' --no-push'}\nbenchkeeper record --project <dir> -- claude '/benchkeeper:setting-up-projects'`}</Cli>
    </Stack>
  );
}

export function History() {
  const history = useApi('/api/history');
  const [open, setOpen] = useState(null);
  const run = useApi(open ? `/api/run?id=${open}` : null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const undo = (id) => async () => { setError(null); try { setResult(await api('/api/undo', { run: id })); history.reload(); } catch (e) { setError(e.message); } };
  return (
    <Stack gap="lg">
      {error && <Alert color="red" title="Undo failed">{error}</Alert>}
      {result && <Section title="Undo"><RunEntries run={result} /></Section>}
      <Loading state={history} label="history">{(runs) => (runs.length ? (
        <Table aria-label="Runs">
          <Table.Thead><Table.Tr><Table.Th>Run</Table.Th><Table.Th>Kind</Table.Th><Table.Th>Status</Table.Th><Table.Th>Scope</Table.Th><Table.Th>Changes</Table.Th><Table.Th>Actions</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {runs.map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td><Code>{r.id}</Code>{note(r) && <Text size="xs">{note(r)}</Text>}</Table.Td>
                <Table.Td>{r.kind}</Table.Td>
                <Table.Td>{r.status ?? 'interrupted'}</Table.Td>
                <Table.Td>{r.scope}</Table.Td>
                <Table.Td>{r.changes}</Table.Td>
                <Table.Td><Group gap="xs"><Button size="xs" variant="default" onClick={() => setOpen(r.id)}>Changes</Button><Button size="xs" variant="subtle" onClick={undo(r.id)}>Undo</Button></Group></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : <Text>No runs yet.</Text>)}</Loading>
      {open && <Section title={`Run ${open}`}><Loading state={run} label="run">{(r) => <RunEntries run={r} />}</Loading></Section>}
      <Cli>{`benchkeeper history\nbenchkeeper undo ${open ?? '<run>'}\nbenchkeeper case add --run <session run> --target skill:<name> --expected <text>`}</Cli>
    </Stack>
  );
}


const SHORTCUTS = [[`${MOD}+K`, 'command palette'], [`${MOD}+1 to ${MOD}+6`, 'views in sidebar order'], [`${MOD}+J`, 'light or dark theme']];

export function Settings() {
  return (
    <Stack gap="xl">
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
      <Cli>{'benchkeeper --help'}</Cli>
    </Stack>
  );
}
