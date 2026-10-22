import { Alert, Anchor, Badge, Button, Checkbox, Code, Grid, Group, Paper, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useState } from 'react';
import { api } from './api.js';
import { Cli, Loading, Plan, RunEntries, Section, StateBadge, useApi } from './parts.jsx';

const ATTENTION = ['outdated', 'modified', 'removed', 'foreign'];

export function Dashboard({ overview }) {
  const plan = useApi('/api/global-plan');
  const doctor = useApi('/api/doctor');
  return (
    <Stack gap="xl">
      <Section title="Agents">
        <Loading state={overview} label="agents">{(o) => (
          <Table>
            <Table.Thead><Table.Tr><Table.Th>Agent</Table.Th><Table.Th>Version</Table.Th><Table.Th>Projects</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {o.agents.filter((a) => a.installed).map((a) => (
                <Table.Tr key={a.id}><Table.Td>{a.name}</Table.Td><Table.Td>{a.version}</Table.Td><Table.Td>{o.projects.filter((p) => p.agents.includes(a.id)).length}</Table.Td></Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}</Loading>
      </Section>
      <Section title="Needs attention">
        <Loading state={plan} label="global plan">{(p) => {
          const items = p.changes.filter((c) => ATTENTION.includes(c.state));
          return items.length ? (
            <Table>
              <Table.Thead><Table.Tr><Table.Th>State</Table.Th><Table.Th>Item</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{items.map((c) => <Table.Tr key={c.id}><Table.Td><StateBadge state={c.state} /></Table.Td><Table.Td>{c.title}</Table.Td></Table.Tr>)}</Table.Tbody>
            </Table>
          ) : <Text>Global setup matches {p.agents.join(', ') || 'no agent'}.</Text>;
        }}</Loading>
      </Section>
      <Section title="Doctor">
        <Loading state={doctor} label="doctor">{(found) => (found.length ? (
          <Table>
            <Table.Thead><Table.Tr><Table.Th>Level</Table.Th><Table.Th>Problem</Table.Th><Table.Th>Fix</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{found.map((i, n) => <Table.Tr key={n}><Table.Td>{i.level}</Table.Td><Table.Td>{i.message}</Table.Td><Table.Td>{i.fix}</Table.Td></Table.Tr>)}</Table.Tbody>
          </Table>
        ) : <Text>No problems found.</Text>)}</Loading>
      </Section>
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

export function Agents({ overview }) {
  const [select, setSelect] = useState(null);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  return (
    <Loading state={overview} label="agents">{(o) => {
      const chosen = select ?? o.agents.filter((a) => a.installed).map((a) => a.id);
      const load = async () => { setError(null); setPlan(null); try { setPlan(await api(`/api/global-plan?agents=${chosen.join(',')}`)); } catch (e) { setError(e.message); } };
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
          <Group><Button onClick={load} disabled={!chosen.length}>Plan setup for {chosen.length} agents</Button></Group>
          {error && <Alert color="red" title="Plan failed">{error}</Alert>}
          {plan && <Section title="Changes"><Plan plan={plan} onDone={overview.reload} /></Section>}
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
          <Plan plan={plan} onDone={projects.reload} />
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
  const note = (r) => (r.note?.case ? `eval case ${r.note.case} for ${r.note.target}` : r.of ? `undo of ${r.of}` : '');
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

