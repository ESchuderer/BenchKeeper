import { Badge, Button, Code, Drawer, Group, Progress, Select, Stack, Switch, Table, Text, Title } from '@mantine/core';
import { IconEye, IconPlayerStop } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { api } from './api.js';
import { Cli, Plan, Section } from './parts.jsx';
import { Dot, Loading, Note, icon, useApi } from './shell.jsx';

const GLOBAL = 'global';
const KINDS = { rules: 'Rule files', imports: 'Imports', skills: 'Skill descriptions', memory: 'Auto memory' };
const LOAD = { always: ['teal', 'loads'], 'path-scoped': ['blue', 'loads for matching files'], off: ['gray', 'off'], shadowed: ['yellow', 'not read'] };
const number = (n) => n.toLocaleString('en-US');

// A value against its limit, with who sets the limit.
const Limit = ({ label, value, max, unit, by }) => (
  <Progress size="sm" value={Math.min(100, (value / max) * 100)} color={value > max ? 'red' : 'teal'} aria-label={`${label}: ${number(value)} of ${number(max)} ${unit}, limit set by ${by}`} />
);

// A switch request: the plan comes back through onPlan, a refusal shows as an error.
function useSwitch(dir, onPlan) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const toggle = async (agent, row, on) => {
    setBusy(row.path); setError(null);
    try { onPlan({ row, dir, plan: await api('/api/rules-plan', { agent, file: row.path, dir, on }) }); } catch (e) { setError(e.message); }
    setBusy(null);
  };
  return { busy, error, toggle };
}

// Findings of the checks: severity, file and line in the message, the fix, and a switch-off plan where that is safe.
function Findings({ findings, dir, onPlan }) {
  const { busy, error, toggle } = useSwitch(dir, onPlan);
  if (!findings.length) return <Text>No rule file is over a limit or broken.</Text>;
  return (
    <Stack gap="sm">
      {error && <Note color="red" title="Not planned">{error}</Note>}
      <Table.ScrollContainer minWidth={560} scrollAreaProps={{ viewportProps: { tabIndex: 0, role: 'region', 'aria-label': 'Rule findings, scrollable' } }}>
        <Table aria-label="Rule findings" verticalSpacing="xs">
          <Table.Thead><Table.Tr><Table.Th w={110}>Level</Table.Th><Table.Th>Problem</Table.Th><Table.Th>Fix</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {findings.map((f) => (
              <Table.Tr key={f.message}>
                <Table.Td><Badge variant="default" miw="max-content" leftSection={<Dot color={f.level === 'error' ? 'red' : 'yellow'} />}>{f.level}</Badge></Table.Td>
                <Table.Td style={{ overflowWrap: 'anywhere' }}>{f.message}</Table.Td>
                <Table.Td>
                  <Stack gap={4} align="flex-start">
                    <Text size="sm">{f.fix}</Text>
                    {f.action && <Button size="compact-xs" variant="default" leftSection={icon(IconPlayerStop)} disabled={busy === f.action.file} onClick={() => toggle(f.action.agent, { path: f.action.file, shown: f.file }, false)}>Turn off {f.file}</Button>}
                  </Stack>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}

const Loads = ({ row }) => {
  const [color, text] = LOAD[row.load];
  return <Badge variant="default" miw="max-content" leftSection={<Dot color={color} />}>{text}</Badge>;
};

// The text of one listed file, on this machine only.
function Preview({ agent, file, dir, onClose }) {
  const state = useApi(file ? `/api/rule-text?${new URLSearchParams({ agent, file, ...(dir ? { dir } : {}) })}` : null);
  return (
    <Drawer opened={!!file} onClose={onClose} position="right" size="lg" withCloseButton={false} attributes={{ content: { 'aria-label': 'Rule file text' } }}>
      <Stack gap="md">
        <Group justify="space-between" wrap="nowrap"><Title order={2} size="h3" style={{ overflowWrap: 'anywhere' }}>{file}</Title><Button variant="default" onClick={onClose}>Close</Button></Group>
        <Loading state={state} label="the file">
          {(d) => (
            <>
              <Text size="sm">Shown here only: it is not written to History, logs or the exported profile.{d.truncated ? ' The first 200,000 characters.' : ''}</Text>
              <Code block tabIndex={0} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{d.text}</Code>
            </>
          )}
        </Loading>
      </Stack>
    </Drawer>
  );
}

function Budget({ budget }) {
  return (
    <Stack gap="xs">
      <Text>About <Text span fw={700}>{number(budget.total)} tokens</Text> load at the start of every session{budget.largest ? <>; the largest source is <Code>{budget.largest.label}</Code> with {number(budget.largest.tokens)}</> : null}. A token is counted as four bytes: an estimate.</Text>
      {budget.over && <Note color="yellow">More than {number(budget.threshold)} tokens (BenchKeeper's own limit, not the agent's): every turn pays for them. Turn off a file, split a long one into path-scoped rules, or shorten the largest source.</Note>}
      {budget.onDemand > 0 && <Text size="sm">About {number(budget.onDemand)} more tokens of path-scoped rules load only when matching files are used.</Text>}
      {budget.notes.map((n) => <Note key={n} color="yellow">{n}</Note>)}
      {budget.limits.map((l) => (
        <Stack key={l.label} gap={2}>
          <Text size="sm">{l.label}: {number(l.value)} of {number(l.max)} {l.unit} (limit set by {l.by})</Text>
          <Limit {...l} />
        </Stack>
      ))}
      <Table.ScrollContainer minWidth={480} scrollAreaProps={{ viewportProps: { tabIndex: 0, role: 'region', 'aria-label': 'Context budget, scrollable' } }}>
        <Table aria-label="Context budget" verticalSpacing="xs">
          <Table.Thead><Table.Tr><Table.Th>Source</Table.Th><Table.Th>Counts as</Table.Th><Table.Th ta="right">Tokens</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {budget.items.map((i) => <Table.Tr key={`${i.kind}-${i.label}`}><Table.Td><Code>{i.label}</Code></Table.Td><Table.Td>{KINDS[i.kind]}</Table.Td><Table.Td ta="right">{number(i.tokens)}</Table.Td></Table.Tr>)}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}

function Files({ agent, dir, limit, onPlan, onPreview }) {
  const { busy, error, toggle } = useSwitch(dir, onPlan);
  if (!agent.rows.length) return <Text size="sm">No instruction file found.</Text>;
  return (
    <Stack gap="sm">
      {error && <Note color="red" title="Not planned">{error}</Note>}
      <Table.ScrollContainer minWidth={760} scrollAreaProps={{ viewportProps: { tabIndex: 0, role: 'region', 'aria-label': `${agent.name} instruction files, scrollable` } }}>
        <Table aria-label={`${agent.name} instruction files`} verticalSpacing="sm">
          <Table.Thead><Table.Tr><Table.Th>Load order</Table.Th><Table.Th>File</Table.Th><Table.Th>Owner</Table.Th><Table.Th ta="right">Size</Table.Th><Table.Th>State</Table.Th><Table.Th>Switch</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {agent.rows.map((r) => (
              <Table.Tr key={r.path}>
                <Table.Td>{r.order ?? '-'}</Table.Td>
                <Table.Td><Stack gap={2}><Code style={{ overflowWrap: 'anywhere' }}>{r.shown}</Code><Text size="sm">{r.scope}</Text></Stack></Table.Td>
                <Table.Td><Badge variant="default" miw="max-content">{r.owner}</Badge></Table.Td>
                <Table.Td ta="right">{number(r.tokens)} tokens<Text size="sm">{number(r.bytes)} bytes{r.lines ? `, ${r.lines} lines` : ''}</Text><Limit label={r.shown} value={r.tokens} max={limit} unit="tokens" by="BenchKeeper" /></Table.Td>
                <Table.Td><Stack gap={2}><Loads row={r} />{r.by && <Text size="sm">{r.by}</Text>}</Stack></Table.Td>
                <Table.Td miw={220}>
                  <Group gap="xs" wrap="nowrap" align="flex-start">
                    {r.switch.by
                      ? <Switch aria-label={`Load ${r.shown} in ${agent.name}`} label={r.load === 'off' ? 'Turn on' : 'On'} checked={r.load !== 'off'} disabled={busy === r.path} onChange={(e) => toggle(agent.id, r, e.currentTarget.checked)} />
                      : <Text size="sm">No switch: {r.switch.why}.</Text>}
                    <Button size="compact-xs" variant="default" leftSection={icon(IconEye)} aria-label={`Show text of ${r.shown}`} onClick={() => onPreview(r.path)}>Text</Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}

// The instruction files each agent loads, globally or for a registered project, with the context they cost.
export function Rules({ overview, params, refresh }) {
  const projects = overview.data?.projects ?? [];
  const [dir, setDir] = useState(params.get('path') ?? GLOBAL);
  const [pending, setPending] = useState(null);
  const [preview, setPreview] = useState(null);
  const chosen = dir === GLOBAL ? undefined : dir;
  // A plan asked for under another selection is dropped when it arrives.
  const shown = useRef(chosen);
  shown.current = chosen;
  const state = useApi(`/api/rules${chosen ? `?${new URLSearchParams({ dir: chosen })}` : ''}`);
  const choose = (v) => { setDir(v ?? GLOBAL); setPending(null); };
  const onPlan = (p) => { if (p.dir === shown.current) setPending(p); };
  return (
    <Stack gap="lg">
      <Note>The instruction files the agents load, who wrote them, what they cost in context and what the checks found. A file that is not BenchKeeper's is yours: nothing here deletes it. A switch is a plan with a diff, and History undoes it.</Note>
      <Select label="Show" data={[{ value: GLOBAL, label: 'Global files' }, ...projects.map((p) => ({ value: p.path, label: p.name ? `${p.name} (${p.path})` : p.path }))]} value={dir} onChange={choose} allowDeselect={false} comboboxProps={{ withinPortal: false }} maw={560} />
      <Loading state={state} label="instruction files">
        {(data) => (
          <Stack gap="xl">
            <Section title="Checks"><Findings findings={data.findings} dir={chosen} onPlan={onPlan} /></Section>
            {data.agents.map((a) => (
              <Stack key={a.id} gap="md">
                <Title order={2} size="h3">{a.name}</Title>
                <Section title={`${a.name} context budget`}><Budget budget={a.budget} /></Section>
                <Section title={`${a.name} files${chosen ? ' for this project' : ''}`}>
                  <Files agent={a} dir={chosen} limit={data.limit} onPlan={onPlan} onPreview={(file) => setPreview({ agent: a.id, file })} />
                </Section>
              </Stack>
            ))}
          </Stack>
        )}
      </Loading>
      {pending && (
        <Section title="Changes">
          <Plan key={pending.plan.planId} plan={pending.plan} onDone={() => { state.reload(); refresh(); }} />
          <Group><Button variant="default" onClick={() => setPending(null)}>Close</Button></Group>
        </Section>
      )}
      <Preview agent={preview?.agent} file={preview?.file} dir={chosen} onClose={() => setPreview(null)} />
      <Cli>{'benchkeeper rules list [--agent claude|codex] [--project <dir>]\nbenchkeeper rules check [--project <dir>] [--limit <tokens>]\nbenchkeeper rules disable <file> [--project <dir>]\nbenchkeeper rules enable <file> [--project <dir>]'}</Cli>
    </Stack>
  );
}
