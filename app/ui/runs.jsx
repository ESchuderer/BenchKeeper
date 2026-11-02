import { Button, Code, Group, List, Select, Stack, Table, Text, Title } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { useState } from 'react';
import { api } from './api.js';
import { Cli, Plan, PlanClose, PlanSwitch, Section } from './parts.jsx';
import { Loading, Note, SCROLL_CUE, breakAt, icon, useApi } from './shell.jsx';

const money = (x) => (x == null ? 'not recorded' : `$${x.toFixed(2)}`);
const Scroll = ({ label, children }) => (
  <Table.ScrollContainer minWidth={560} scrollAreaProps={{ ...SCROLL_CUE, viewportProps: { tabIndex: 0, role: 'region', 'aria-label': `${label}, scrollable` } }}>
    {/* One line per row: the table scrolls sideways instead of wrapping a task or a path into a taller row. */}
    <Table aria-label={label} style={{ whiteSpace: 'nowrap' }}>{children}</Table>
  </Table.ScrollContainer>
);
// A section without data: one line with its title and the reason.
const Empty = ({ title, children }) => <Text size="sm" component="section" aria-label={title}><Title order={3} fz="sm" lh="inherit" display="inline">{title}</Title>: {children}</Text>;

// Runs and tasks, read when the view opens and on Refresh; no timer. The rows hold ids, states and counts, never a prompt or worker output.
export function Runs() {
  const runs = useApi('/api/runs');
  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <Text maw={720}>Orchestrated runs and tasks in the registered projects and their worktrees with cost and tokens, each project's last setup change and the multi-agent IDE's runs, read when the view opens and on Refresh: nothing runs while it is closed.</Text>
        <Button leftSection={icon(IconRefresh)} variant="default" loading={runs.loading} onClick={runs.reload}>Refresh</Button>
      </Group>
      <Loading state={runs} label="runs">{(d) => (
        <Stack gap="lg">
          {d.runs.length ? (
            <Section title="Orchestrated runs">
              <Text size="sm">From the sessions read {d.scanned.slice(0, 16).replace('T', ' ')} UTC in the registered projects and their worktrees. Codex costs are estimated from tokens and OpenAI API prices.</Text>
              <Scroll label="Orchestrated runs and tasks">
                <Table.Thead><Table.Tr><Table.Th>Run</Table.Th><Table.Th>Task</Table.Th><Table.Th>Worktree</Table.Th><Table.Th>Branch</Table.Th><Table.Th>Sessions</Table.Th><Table.Th>Cost</Table.Th><Table.Th>Tokens</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {d.runs.flatMap((x) => [{ ...x, task: 'all tasks', total: true }, ...x.tasks].map((t) => (
                    <Table.Tr key={`${x.run}-${t.total ? '' : t.task}`}>
                      <Table.Td>{x.run ?? 'not recorded'}</Table.Td>
                      <Table.Td>{t.task ?? 'not recorded'}</Table.Td>
                      <Table.Td>{t.worktree ? <Code>{t.worktree}</Code> : '-'}</Table.Td>
                      <Table.Td>{t.branch ?? '-'}</Table.Td>
                      <Table.Td>{t.sessions}</Table.Td>
                      <Table.Td>{money(t.costUSD)}</Table.Td>
                      <Table.Td>{t.tokens}</Table.Td>
                    </Table.Tr>
                  )))}
                </Table.Tbody>
              </Scroll>
            </Section>
          ) : <Empty title="Orchestrated runs">no orchestrated sessions in a registered project or its worktrees, from the sessions read {d.scanned.slice(0, 16).replace('T', ' ')} UTC.</Empty>}
          {d.setup.length ? (
            <Section title="Last setup change">
              <List spacing={4} size="sm">
                {d.setup.map((p) => <List.Item key={p.project}><Code>{p.project}</Code>: {p.lastChange ? `${p.lastChange.kind} ${p.lastChange.status}, ${p.lastChange.time.slice(0, 16).replace('T', ' ')} UTC` : 'none'}</List.Item>)}
              </List>
            </Section>
          ) : <Empty title="Last setup change">no project is registered.</Empty>}
          {d.ide.runs === null ? <Empty title={d.ide.name}>not installed, or its run list could not be read.</Empty> : !d.ide.runs.length ? <Empty title={d.ide.name}>no runs.</Empty> : (
            <Section title={d.ide.name}>
              <Scroll label={`${d.ide.name} runs`}>
                <Table.Thead><Table.Tr><Table.Th>Run</Table.Th><Table.Th>Updated</Table.Th><Table.Th>Tasks</Table.Th><Table.Th>States</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {d.ide.runs.map((r) => (
                    <Table.Tr key={r.id}>
                      <Table.Td><Code>{r.id}</Code></Table.Td>
                      <Table.Td>{r.updated ?? '-'}</Table.Td>
                      <Table.Td>{r.tasks ?? 'not read'}</Table.Td>
                      <Table.Td>{Object.entries(r.states).map(([s, n]) => `${n} ${s}`).join(', ') || '-'}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Scroll>
            </Section>
          )}
        </Stack>
      )}</Loading>
      {/* Reference, not status: folded until opened. */}
      <details>
        <summary><Text component="span" fw={600}>Command</Text></summary>
        <Stack mt="md"><Cli>benchkeeper sessions list --run &lt;id&gt;</Cli></Stack>
      </details>
    </Stack>
  );
}

// Preferences: each surface with its default and what it costs while on; the tier strip is the one that runs without being opened.
export function Surfaces() {
  const band = useApi('/api/tier-band');
  const style = useApi('/api/status-style');
  const [plan, setPlan] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  // While a plan is asked for, the switch ignores input: a second answer could replace a plan that already applies.
  const [asking, setAsking] = useState(false);
  // why: the sentence the plan shows; on: set for the tier strip switch only.
  // route and body: the status line style plans in an account's settings.json, not in the user settings.
  const ask = async (key, value, why, on, route = '/api/settings-plan', body = null) => {
    setError(null); setPlan(null); setAsking(true);
    try { setPlan({ key, value, why, on, plan: await api(route, body ?? { agent: 'claude', layer: 'user', edits: { [key]: value } }) }); } catch (e) { setError(e.message); }
    setAsking(false);
  };
  const pending = (key) => (plan && !plan.done && plan.key === key ? plan : null);
  return (
    <Section title="Views and their cost">
      <List spacing={4} size="sm" maw={720}>
        <List.Item>Terminal tier strip: off by default. While on, a Claude Code hook runs each time the prompt is drawn, runs <Code>git branch --show-current</Code> after each answer step, and reads each command and edit of the main loop.</List.Item>
        <List.Item>Sessions board: written by each sessions scan (opening Sessions or Runs) and by <Code>benchkeeper sessions board</Code>; no server, nothing runs between.</List.Item>
        <List.Item>Sessions view: reads the sessions cache and only the transcripts changed since the last scan.</List.Item>
        <List.Item>Runs view: read when you open it or press Refresh, no timer. It reuses the last sessions scan or scans like Sessions; with the multi-agent IDE installed, it asks for its run list and the tasks of each run (at most 21 calls).</List.Item>
      </List>
      <Loading state={band} label="tier strip setting">{(b) => (
        <PlanSwitch name="Terminal tier strip" description="The plugin option in your Claude Code user settings, applied as a plan you can undo." on={b.on}
          pending={pending(b.key)} off={running || asking} onAsk={(on) => ask(b.key, on, `You turned the tier strip ${on ? 'on' : 'off'} in Preferences.`, on)} onClear={() => setPlan(null)} />
      )}</Loading>
      <Loading state={style} label="status line setting">{(st) => (st.accounts.length ? st.accounts.map((a) => {
        const key = `${st.key}:${a.name}`;
        return (
          <Select key={a.name} label={`Status line of account ${a.name}`} maw={420} allowDeselect={false} disabled={running || asking}
            description={pending(key) ? 'Apply or cancel in Changes below' : <>The plugin option in <Code style={{ overflowWrap: 'break-word' }}>{breakAt(a.file)}</Code>, which this account's status line reads. Usage is recorded in every style.</>}
            data={[{ value: 'merged', label: 'Usage and Ponytail level' }, { value: 'plugin', label: 'Ponytail level only' }, { value: 'benchkeeper', label: 'Usage only' }, { value: 'none', label: 'Nothing' }]}
            value={pending(key)?.value ?? a.value} onChange={(v) => (v === a.value ? setPlan(null) : ask(key, v, `You chose the status line style ${v} for account ${a.name} in Preferences.`, undefined, '/api/status-style', { account: a.name, value: v }))} />
        );
      }) : <Text size="sm">Status line: no host account is tracked. <Code>benchkeeper accounts track &lt;name&gt;</Code> installs it in a host account, whose style is chosen here then. An account in a dev container sets its style in its own settings.json: the plugin option <Code>statusStyle</Code> under <Code>pluginConfigs."benchkeeper@benchkeeper".options</Code>.</Text>)}</Loading>
      {error && <Note color="red" title="Not planned">{error}</Note>}
      {plan && (
        <Section title="Changes">
          {/* done: applied or cancelled, so the switch shows the setting again. */}
          <Plan key={plan.plan.planId} plan={plan.plan} why={plan.why} scope="global" onRunning={setRunning}
            onCancel={(done) => setPlan((p) => ({ ...p, done }))} onDone={() => { setPlan((p) => ({ ...p, done: true })); band.reload(); style.reload(); }} />
          <Group><PlanClose running={running} onClose={() => setPlan(null)} /></Group>
        </Section>
      )}
    </Section>
  );
}
