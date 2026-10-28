// The eval views with their charts: loaded on first use, so the recharts bundle is not part of the first load.
import { BarChart, LineChart } from '@mantine/charts';
import '@mantine/charts/styles.css';
import { Anchor, Button, Checkbox, Group, List, Paper, Select, Stack, Switch, Table, Text, Title } from '@mantine/core';
import { IconListCheck, IconPlayerPlay } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { api } from './api.js';
import { Cli, EvalJob, Section, pct } from './parts.jsx';
import { when } from './run.jsx';
import { Loading, Note, SplitView, href, icon, useApi } from './shell.jsx';

const rate = (v) => (v == null ? '-' : `${pct(v)}%`);
const seriesOf = (r) => `${r.agent}${r.model ? ` ${r.model}` : ''}`;
// One color per measure everywhere: the board's first two series, set per scheme in App.jsx.
// Recharts sorts legend items by name unless told not to; they follow this order, as the tables and tooltips do.
const LEGEND = { itemSorter: null };
const MEASURES = [{ name: 'Miss', key: 'missRate', color: 'var(--bk-s1)' }, { name: 'False trigger', key: 'falseTriggerRate', color: 'var(--bk-s2)', strokeDasharray: '5 5' }];

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
export function EvalResults({ results }) {
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

// Plan first (targets and the number of agent sessions), then start them as a job.
function RunEvals({ onDone }) {
  const [agents, setAgents] = useState(['claude']);
  const [all, setAll] = useState(false);
  const [plan, setPlan] = useState(null);
  const [job, setJob] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  // A plan answers the selection it was asked for; a later change discards it.
  const choice = useRef(0);
  const query = new URLSearchParams({ agents: agents.join(','), all: all ? '1' : '0' });
  const act = (f) => async () => { setError(null); try { await f(); } catch (e) { setError(e.message); } };
  return (
    <Section title="Run evals">
      <Text size="sm">Each case is a real agent session (Claude Code in plan mode, Codex read-only) in a scratch repository, on your subscription.</Text>
      <Group>
        <Checkbox.Group label="Agents" value={agents} onChange={(v) => { choice.current += 1; setAgents(v); setPlan(null); }}>
          <Group mt={4}><Checkbox value="claude" label="Claude Code" /><Checkbox value="codex" label="Codex" /></Group>
        </Checkbox.Group>
        <Switch label="All targets, also unchanged ones" checked={all} onChange={(e) => { choice.current += 1; setAll(e.currentTarget.checked); setPlan(null); }} />
      </Group>
      {error && <Note color="red" title="Failed">{error}</Note>}
      {!job && <Group><Button leftSection={icon(IconListCheck)} variant="default" disabled={!agents.length} onClick={act(async () => { const asked = choice.current, p = await api(`/api/eval-plan?${query}`); if (asked === choice.current) setPlan(p); })}>Plan evals</Button></Group>}
      {plan && !job && (plan.targets.length ? (
        <Stack gap="xs">
          <Table aria-label="Planned evals">
            <Table.Thead><Table.Tr><Table.Th>Target</Table.Th><Table.Th>Agent</Table.Th><Table.Th>Cases</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{plan.targets.map((t) => <Table.Tr key={`${t.target}${t.agent}`}><Table.Td>{t.target}</Table.Td><Table.Td>{t.agent}</Table.Td><Table.Td>{t.cases}</Table.Td></Table.Tr>)}</Table.Tbody>
          </Table>
          <Group><Button leftSection={icon(IconPlayerPlay)} onClick={act(async () => { setJob(await api('/api/eval', { agents: agents.join(','), all })); setRunning(true); })}>Start {plan.sessions} agent sessions</Button></Group>
        </Stack>
      ) : <Text>Every target is unchanged since its last result. Turn on all targets to run them again.</Text>)}
      {job && <EvalJob job={job.job} total={job.total} onDone={() => { setPlan(null); setRunning(false); onDone(); }} />}
      {job && <Group><Button leftSection={icon(IconListCheck)} variant="default" disabled={running} onClick={() => setJob(null)}>Plan more evals</Button></Group>}
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
      <Cli>{`benchkeeper evals run${open ? ` --target ${open}` : ''}\nbenchkeeper evals run --all`}</Cli>
    </Stack>
  );
}
