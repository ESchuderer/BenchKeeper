import { Anchor, Box, Grid, Group, List, Stack, Table, Text, Timeline } from '@mantine/core';
import { useEffect, useRef } from 'react';
import { Cli, Section, StateBadge } from './parts.jsx';
import { note, runTitle, when } from './run.jsx';
import { DoctorTable, FixEverythingButton } from './fix.jsx';
import { OneRunButtons } from './onerun.jsx';
import { label, plural } from './projects.jsx';
import { HEALTH } from '../src/tokens.mjs';
import { Loading, RANK, STATE_COLOR, href, useApi } from './shell.jsx';

const ATTENTION = ['absent', 'outdated', 'modified', 'removed', 'foreign', 'missing', 'error'];
const PARTS = ['rules', 'ask', 'plugin', 'skills', 'settings', 'tools', 'other'];
const worst = (items) => items.reduce((w, i) => (RANK.indexOf(i.state) > RANK.indexOf(w) ? i.state : w), items[0]?.state);

// The health bar never relies on the hue: each segment is named with its number in the legend, and the table repeats
// every figure. Its colors (--bk-h-*) are board tokens.
const STYLE = `.bk-stack{display:flex;gap:2px;height:16px;border-radius:8px;overflow:hidden;background:var(--mantine-color-default-border)}.bk-stack>span{min-width:3px;background-image:linear-gradient(180deg,rgb(255 255 255/.18),transparent 60%)}
.bk-bars{display:flex;flex-direction:column;gap:6px;list-style:none;margin:0;padding:0}.bk-bars>li{display:grid;grid-template-columns:minmax(0,9rem) minmax(40px,1fr) 2.5rem;gap:12px;align-items:center}
.bk-bar{display:block;height:10px;border-radius:0 6px 6px 0;background:linear-gradient(90deg,color-mix(in srgb,var(--bk-s1) 75%,var(--bk-accent)),var(--bk-s1))}`;
const Swatch = ({ state }) => <Box component="span" aria-hidden w={10} h={10} display="inline-block" style={{ borderRadius: 3, backgroundColor: `var(--bk-h-${state})` }} />;

// Where a figure leads: the scopes it counts. Items that are not current are changes the plans would make.
function target(state, projects) {
  if (!projects) return href('agents', { plan: '1' });
  if (state === 'current' || state === 'untracked') return href('projects');
  return href('projects', { show: 'changes' });
}

function Installed({ data, names }) {
  const skills = (counts, to) => Object.entries(counts).map(([id, n]) => <Anchor key={id} href={to(id)} mr="sm">{names[id] ?? id} {n}</Anchor>);
  const packs = (ids) => (ids.length ? ids.map((id) => <Anchor key={id} href={href('catalog', { pack: id })} mr="sm">{id}</Anchor>) : 'none');
  const globalPacks = [...new Set(Object.values(data.global.packs).flat())];
  return (
    <Table.ScrollContainer minWidth={420}>
      <Table aria-label="Installed skills and packs" withTableBorder>
        <Table.Thead><Table.Tr><Table.Th>Scope</Table.Th><Table.Th>Skills per agent</Table.Th><Table.Th>Packs</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          <Table.Tr><Table.Th scope="row">Global</Table.Th><Table.Td>{skills(data.global.skills, (id) => href('agents', { agent: id }))}</Table.Td><Table.Td>{packs(globalPacks)}</Table.Td></Table.Tr>
          {data.projects.map((p) => (
            <Table.Tr key={p.path}>
              <Table.Th scope="row"><Anchor href={href('projects', { path: p.path })}>{label(p)}</Anchor>{p.error && <Text size="xs" fw={400}>{p.error}</Text>}</Table.Th>
              <Table.Td>{p.setup ? skills(p.skills, () => href('projects', { path: p.path })) : p.error ? 'cannot be read' : 'not set up'}</Table.Td>
              <Table.Td>{p.setup ? packs(p.packs) : 'none'}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function Health({ data }) {
  const rows = [{ key: 'global', label: 'Global', states: data.global.states, to: href('agents', { plan: '1' }) },
    ...data.projects.filter((p) => p.states).map((p) => ({ key: p.path, label: label(p), states: { ...p.states, untracked: p.untracked }, to: href('projects', { path: p.path }) }))];
  // The inventory's untracked is zero by definition; a project's comes from its folders.
  const total = (s, from = rows) => from.reduce((n, r) => n + (r.states[s] ?? 0), 0);
  const shown = HEALTH.filter((s) => total(s) > 0);
  const all = shown.reduce((n, s) => n + total(s), 0);
  const summary = shown.map((s) => `${total(s)} ${s}`).join(', ');
  if (!all) return <Text size="sm">No items yet.</Text>;
  return (
    <Stack gap="sm">
      <div className="bk-stack" role="img" aria-label={`Items by state: ${summary}`}>
        {shown.map((s) => <span key={s} title={`${total(s)} ${s}`} style={{ width: `${(total(s) / all) * 100}%`, backgroundColor: `var(--bk-h-${s})` }} />)}
      </div>
      <List listStyleType="none" aria-label="Items by state, all scopes" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
        {shown.map((s) => (
          <List.Item key={s}><Group gap={6} wrap="nowrap"><Swatch state={s} /><Anchor href={target(s, total(s, rows.slice(1)))} aria-label={`${total(s)} ${s}, open what it counts`}>{total(s)} {s}</Anchor></Group></List.Item>
        ))}
      </List>
      <details>
        <summary>Table of values</summary>
        <Table.ScrollContainer minWidth={420}>
          <Table aria-label="Items by state per scope" withTableBorder mt="xs">
            <Table.Thead><Table.Tr><Table.Th>Scope</Table.Th>{shown.map((s) => <Table.Th key={s}>{s}</Table.Th>)}</Table.Tr></Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.key}>
                  <Table.Th scope="row">{r.label}</Table.Th>
                  {shown.map((s) => <Table.Td key={s}>{r.states[s] ? <Anchor href={r.to} aria-label={`${r.label}: ${r.states[s]} ${s}`}>{r.states[s]}</Anchor> : 0}</Table.Td>)}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </details>
      <Text size="sm">Untracked is a skill folder in a project that BenchKeeper did not install.</Text>
    </Stack>
  );
}

// Packs no project chose are one line under the table, not rows of zeros.
function PackCoverage({ data, names }) {
  const { agents } = data.coverage;
  const used = (p) => agents.some((a) => p.cells[a.id]);
  const packs = data.coverage.packs.filter(used), unused = data.coverage.packs.filter((p) => !used(p));
  return (
    <Stack gap="xs">
      {!!packs.length && <Table.ScrollContainer minWidth={420}>
        <Table aria-label="Pack coverage" withTableBorder>
          <Table.Thead><Table.Tr><Table.Th>Pack</Table.Th>{agents.map((a) => <Table.Th key={a.id}>{a.name}</Table.Th>)}</Table.Tr></Table.Thead>
          <Table.Tbody>
            {packs.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Th scope="row">
                  <Anchor href={href('catalog', { pack: p.id })}>{p.title}</Anchor>
                  {!!p.codexOnly.length && <Text size="xs" fw={400}>{plural(p.codexOnly.length, 'skill')} for Codex only: {p.codexOnly.join(', ')}</Text>}
                  {!!p.plugin.length && <Text size="xs" fw={400}>plugin for {p.plugin.map((a) => names[a] ?? a).join(', ')}</Text>}
                </Table.Th>
                {agents.map((a) => (
                  <Table.Td key={a.id}>{p.cells[a.id] ? <Anchor href={href('projects', { pack: p.id, agent: a.id })} aria-label={`${p.title} for ${a.name}: ${plural(p.cells[a.id], 'project')}`}>{p.cells[a.id]}</Anchor> : 0}</Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>}
      {!!unused.length && <Text size="sm">In no project: {unused.map((p, n) => <span key={p.id}>{n ? ', ' : ''}<Anchor href={href('catalog', { pack: p.id })}>{p.title}</Anchor></span>)}</Text>}
    </Stack>
  );
}

// A sorted bar list: name, bar, count. The count is text, so the bar only adds the comparison.
function CatalogByPack({ data }) {
  const max = Math.max(1, ...data.catalog.map((p) => p.skills));
  return (
    <Stack gap="xs">
      <ul className="bk-bars" aria-label="Skills per pack">
        {data.catalog.map((p) => (
          <li key={p.id}><Anchor href={href('catalog', { pack: p.id })}>{p.title}</Anchor><span aria-hidden><span className="bk-bar" style={{ width: `${(p.skills / max) * 100}%` }} /></span><Text size="sm" ta="right" className="bk-num">{p.skills}</Text></li>
        ))}
      </ul>
      {data.coverage.packs.some((p) => p.skills === null) && <Text size="sm">Packs that are plugins have no skill list: {data.coverage.packs.filter((p) => p.skills === null).map((p) => p.title).join(', ')}.</Text>}
    </Stack>
  );
}

// Which global setup part reaches which agent, worst state of a part; a cell opens that agent's plan.
function Parts({ items, agents }) {
  const cols = [...agents.map((a) => [a.id, a.name]), ['machine', 'Machine']];
  const rows = PARTS.filter((p) => items.some((i) => i.step.split(':')[0] === p));
  return (
    <Table.ScrollContainer minWidth={420}>
      <Table aria-label="Global setup by part" withTableBorder>
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
  // The server reads the inventory and every project once for this and the inventory above.
  const dash = useApi('/api/dashboard');
  const panel = params.get('panel');
  useEffect(() => { if (panel) document.getElementById(panel)?.scrollIntoView(); }, [panel, doctor.data]);
  // A new run or a newest run that finished (Fix everything, the header's jobs) changes what the inventory shows; the history arriving the first time does not.
  const runs = useRef(undefined);
  const latest = history.data?.slice(0, 3).map((r) => `${r.id}:${r.status}`).join();
  useEffect(() => {
    if (latest === undefined) return;
    if (runs.current !== undefined && latest !== runs.current) { inv.reload(); dash.reload(); }
    runs.current = latest;
  }, [latest]);
  const o = overview.data, items = inv.data ?? [];
  const agents = o?.agents.filter((a) => a.installed) ?? [];
  const names = Object.fromEntries((o?.agents ?? []).map((a) => [a.id, a.name]));
  const attention = items.filter((i) => ATTENTION.includes(i.state));
  const errors = doctor.data?.filter((i) => i.level === 'error').length ?? 0, warnings = (doctor.data?.length ?? 0) - errors;
  const behind = o?.projects.filter((p) => !p.current).length ?? 0;
  const nodes = [
    { label: 'Agents detected', value: `${agents.length} installed`, status: agents.length ? 'ok' : 'problem', href: href('agents') },
    { label: 'Global setup', value: inv.data ? `${attention.length} need attention` : inv.error ? 'check failed' : 'checking', status: inv.error ? 'problem' : attention.length ? 'attention' : 'ok', href: href('agents', { plan: '1' }) },
    { label: 'Projects', value: `${o?.projects.length ?? 0} registered, ${behind} behind`, status: behind ? 'attention' : 'ok', href: href('projects') },
    { label: 'Doctor', value: doctor.data ? `${errors} errors, ${warnings} warnings` : doctor.error ? 'check failed' : 'checking', status: doctor.error || errors ? 'problem' : warnings ? 'attention' : 'ok', href: href('dashboard', { panel: 'doctor' }) },
  ];
  return (
    <Stack gap="xl" className="bk-dash">
      <style>{STYLE}</style>
      <Stack gap="xs">
        <Text size="sm" maw={560}>One-run setup prepares the global setup and the projects you pick without questions in between, then shows every change on one page to check before it applies them.</Text>
        <OneRunButtons />
      </Stack>
      <Group justify="space-between" align="flex-start">
        <Text size="sm" maw={560}>Fix everything walks through the global setup, the projects that are behind and what is left to do by hand, then applies what you checked.</Text>
        <FixEverythingButton />
      </Group>
      <Section title="Setup flow"><Flow nodes={nodes} /></Section>
      <Section title="Install level">
        <Text size="sm">{o?.level?.level ?? 'none'}{o?.level?.adds ? `: ${o.level.adds}` : ''}</Text>
      </Section>
      {agents.some((a) => a.plugin) && (
        <Section title="BenchKeeper plugin">
          {agents.filter((a) => a.plugin).map((a) => (
            <Text key={a.id} size="sm">{a.name}: {a.plugin.installed ? `installed ${a.plugin.installed}` : 'not installed'}, available {a.plugin.available}</Text>
          ))}
          {agents.flatMap((a) => (a.plugin?.accounts ?? []).map((x) => (
            <Text key={`${a.id}:${x.name}`} size="sm">{a.name} account {x.name}: {x.installed ? `installed ${x.installed}` : 'not installed'}{x.ref ? `, on ${x.ref}, left to its own update` : x.behind ? `, behind ${a.plugin.available}: benchkeeper apply updates it` : ''}</Text>
          )))}
        </Section>
      )}
      <Section title="Installed"><Loading state={dash} label="dashboard">{(d) => <Installed data={d} names={names} />}</Loading></Section>
      <Section title="Health"><Loading state={dash} label="dashboard">{(d) => <Health data={d} />}</Loading></Section>
      <Grid gutter="xl">
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Section title="Coverage"><Loading state={dash} label="dashboard">{(d) => <PackCoverage data={d} names={names} />}</Loading></Section>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Section title="Catalog by pack"><Loading state={dash} label="dashboard">{(d) => <CatalogByPack data={d} />}</Loading></Section>
        </Grid.Col>
      </Grid>
      <Section title="Global setup by part"><Loading state={inv} label="inventory">{() => <Parts items={items} agents={agents} />}</Loading></Section>
      <Grid gutter="xl">
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Section title="Recent runs">
            <Loading state={history} label="history">{(list) => (list.length ? (
              <Timeline bulletSize={14} lineWidth={2}>
                {list.slice(0, 6).map((r) => (
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
