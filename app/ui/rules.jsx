import { Badge, Button, Code, Drawer, Group, List, Progress, Select, Stack, Table, Text, Textarea, Title } from '@mantine/core';
import { IconEye, IconPencil, IconPlayerStop } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Cli, Plan, PlanClose, PlanDropped, PlanSwitch, Section, usePlanRunning } from './parts.jsx';
import { when } from './run.jsx';
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
  // name: the agent's name, for the plan's sentence on the context the file costs.
  const toggle = async (agent, row, on, name) => {
    setBusy(row.path); setError(null);
    try {
      const plan = await api('/api/rules-plan', { agent, file: row.path, dir, on });
      const what = name && row.tokens != null && `${name} ${on ? 'loads this file again' : 'stops loading this file'}: about ${number(row.tokens)} tokens ${on ? 'more' : 'less'} ${row.load === 'path-scoped' ? 'in each turn it loads for matching files' : 'in every turn'}`;
      onPlan({ row, dir, on, plan: what ? { ...plan, changes: plan.changes.map((c) => ({ impact: what, ...c })) } : plan });
    } catch (e) { setError(e.message); }
    setBusy(null);
  };
  return { busy, error, toggle };
}

// Findings of the checks: severity, file and line in the message, the fix, and a switch-off plan where that is safe.
// A busy control here and in Files ignores clicks but keeps the keyboard focus (a disabled one loses it).
// locked: an apply runs, and a new plan would drop its view.
function Findings({ findings, dir, onPlan, locked }) {
  const { busy, error, toggle } = useSwitch(dir, onPlan);
  if (!findings.length) return <Text>No rule file is over a limit or broken.</Text>;
  return (
    <Stack gap="sm">
      {error && <Note color="red" title="Not planned">{error}</Note>}
      <Table.ScrollContainer minWidth={560} scrollAreaProps={{ viewportProps: { tabIndex: 0, role: 'region', 'aria-label': 'Rule findings, scrollable' } }}>
        <Table aria-label="Rule findings" verticalSpacing="xs">
          <Table.Thead><Table.Tr><Table.Th w={110}>Level</Table.Th><Table.Th>Problem</Table.Th><Table.Th>Fix</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {findings.map((f) => { const off = locked || busy === f.action?.file; return (
              <Table.Tr key={f.message}>
                <Table.Td><Badge variant="default" miw="max-content" leftSection={<Dot color={f.level === 'error' ? 'red' : 'yellow'} />}>{f.level}</Badge></Table.Td>
                <Table.Td style={{ overflowWrap: 'anywhere' }}>{f.message}</Table.Td>
                <Table.Td>
                  <Stack gap={4} align="flex-start">
                    <Text size="sm">{f.fix}</Text>
                    {f.action && <Button size="compact-xs" variant="default" leftSection={icon(IconPlayerStop)} data-disabled={off || undefined} aria-disabled={off || undefined} onClick={() => !off && toggle(f.action.agent, { path: f.action.file, shown: f.file }, false)}>Turn off {f.file}</Button>}
                  </Stack>
                </Table.Td>
              </Table.Tr>
            ); })}
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

// The text of a file being edited: size and findings from the server 300 ms after the last keystroke (an answer for an
// older text is dropped), Save as a plan with the diff.
function RuleEditor({ row, dir, start, onDone, onClose, running, onRunning }) {
  const [text, setText] = useState(start);
  const [check, setCheck] = useState({ tokens: row.tokens, lines: row.lines, findings: null });
  const [plan, setPlan] = useState(null);
  const [failed, setFailed] = useState(null);
  const body = { agent: row.agent, file: row.path, ...(dir ? { dir } : {}) };
  const latest = useRef(text);
  useEffect(() => {
    latest.current = text;
    const timer = setTimeout(() => {
      api('/api/rule-check', { ...body, text }).then((r) => { if (latest.current === text) setCheck(r); }, (e) => setFailed(e.message));
    }, 300);
    return () => clearTimeout(timer);
  }, [text]);
  const save = async () => {
    setFailed(null);
    try { setPlan(await api('/api/rule-edit-plan', { ...body, text })); } catch (e) { setFailed(e.message); }
  };
  return (
    <Stack gap="sm">
      <Textarea label={`Text of ${row.shown}`} value={text} readOnly={running} onChange={(e) => { setText(e.currentTarget.value); setPlan(null); }} autosize minRows={10} maxRows={30} spellCheck={false} styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }} />
      <Text size="sm" aria-live="polite">About {number(check.tokens)} tokens, {number(check.lines)} lines</Text>
      {check.findings && (check.findings.length
        ? <List size="sm" aria-label={`Findings in ${row.shown}`}>{check.findings.map((f) => <List.Item key={f.message}>{f.level}: {f.message}. Fix: {f.fix}.</List.Item>)}</List>
        : <Text size="sm">The checks find nothing in this file.</Text>)}
      {failed && <Note color="red" title="Not planned">{failed}</Note>}
      {plan
        ? <Section title="Changes"><Plan key={plan.planId} plan={plan} scope={dir ? 'project' : 'global'} onRunning={onRunning} onDone={onDone} /><Group><Button variant="default" data-disabled={running || undefined} aria-disabled={running || undefined} onClick={() => !running && onClose()}>Close editor</Button></Group></Section>
        : <Group><Button onClick={save} disabled={text === start}>Save</Button><Button variant="default" onClick={onClose}>Discard</Button></Group>}
    </Stack>
  );
}

// A row the editor may write: the user's own or the project's file, listed in the view it belongs to.
const editable = (row, dir) => row.owner !== 'BenchKeeper' && row.exists !== false && !(dir && row.scope === 'global');

// The text of one listed file, on this machine only; Edit turns it into the editor.
function Preview({ row, dir, onClose, onSaved }) {
  const [editing, setEditing] = useState(false);
  // Closing while the editor's plan applies would drop the run's view and its reload.
  const [running, setRunning] = useState(false);
  const state = useApi(row ? `/api/rule-text?${new URLSearchParams({ agent: row.agent, file: row.path, ...(dir ? { dir } : {}) })}` : null);
  const close = () => { if (running) return; setEditing(false); onClose(); };
  return (
    <Drawer opened={!!row} onClose={close} closeOnEscape={!editing} closeOnClickOutside={!editing} position="right" size="lg" withCloseButton={false} attributes={{ content: { 'aria-label': 'Rule file text' } }}>
      <Stack gap="md">
        <Group justify="space-between" wrap="nowrap"><Title order={2} size="h3" style={{ overflowWrap: 'anywhere' }}>{row?.path}</Title><PlanClose running={running} onClose={close} /></Group>
        <Loading state={state} label="the file">
          {(d) => (
            <>
              <Text size="sm">Shown here only: it is not written to History, logs or the exported profile.{d.truncated ? ' The first 200,000 characters.' : ''}</Text>
              {editing
                ? <RuleEditor row={row} dir={dir} start={d.text} onDone={() => { state.reload(); onSaved(); }} onClose={() => setEditing(false)} running={running} onRunning={setRunning} />
                : (
                  <>
                    {editable(row, dir) && !d.truncated && <Group><Button leftSection={icon(IconPencil)} onClick={() => setEditing(true)}>Edit</Button></Group>}
                    <Code block tabIndex={0} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{d.text}</Code>
                  </>
                )}
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

// The auto memory folders with notes, in numbers only: read-only, the notes stay with Claude Code. With auto memory off
// for a row's project nothing of it loads, so its badge does not judge the size.
const Memory = ({ memory: { folders } }) => (
  <Table.ScrollContainer minWidth={560} scrollAreaProps={{ viewportProps: { tabIndex: 0, role: 'region', 'aria-label': 'Auto memory per project, scrollable' } }}>
    <Table aria-label="Auto memory per project" verticalSpacing="xs">
      <Table.Thead><Table.Tr><Table.Th>Project</Table.Th><Table.Th ta="right">Notes</Table.Th><Table.Th ta="right">Size</Table.Th><Table.Th>Last change</Table.Th><Table.Th>MEMORY.md</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>
        {folders.map((m) => (
          <Table.Tr key={m.path}>
            <Table.Td><Code style={{ overflowWrap: 'anywhere' }}>{m.project}</Code></Table.Td>
            <Table.Td ta="right">{number(m.notes)}</Table.Td>
            <Table.Td ta="right">{number(m.bytes)} bytes</Table.Td>
            <Table.Td>{when(m.changed)}</Table.Td>
            <Table.Td>{m.enabled ? <Badge variant="default" miw="max-content" leftSection={<Dot color={m.over ? 'yellow' : 'teal'} />}>{m.over ? 'over the load limit' : 'within the load limit'}</Badge> : <Badge variant="default" miw="max-content" leftSection={<Dot color="gray" />}>not loaded</Badge>}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  </Table.ScrollContainer>
);

// pending: the open plan; its row's switch shows it (PlanSwitch).
function Files({ agent, dir, limit, onPlan, onPreview, pending, onClear, locked }) {
  const { busy, error, toggle } = useSwitch(dir, onPlan);
  if (!agent.rows.length) return <Text size="sm">No instruction file found.</Text>;
  return (
    <Stack gap="sm">
      {error && <Note color="red" title="Not planned">{error}</Note>}
      <Table.ScrollContainer minWidth={760} scrollAreaProps={{ viewportProps: { tabIndex: 0, role: 'region', 'aria-label': `${agent.name} instruction files, scrollable` } }}>
        <Table aria-label={`${agent.name} instruction files`} verticalSpacing="sm">
          <Table.Thead><Table.Tr><Table.Th>Load order</Table.Th><Table.Th>File</Table.Th><Table.Th>Owner</Table.Th><Table.Th ta="right">Size</Table.Th><Table.Th>State</Table.Th><Table.Th>Switch</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {agent.rows.map((r) => { const wait = pending?.row.path === r.path, off = locked || busy === r.path; return (
              <Table.Tr key={r.path}>
                <Table.Td>{r.order ?? '-'}</Table.Td>
                <Table.Td><Stack gap={2}><Code style={{ overflowWrap: 'anywhere' }}>{r.shown}</Code><Text size="sm">{r.scope}</Text></Stack></Table.Td>
                <Table.Td><Badge variant="default" miw="max-content">{r.owner}</Badge></Table.Td>
                <Table.Td ta="right">{number(r.tokens)} tokens<Text size="sm">{number(r.bytes)} bytes{r.lines ? `, ${r.lines} lines` : ''}</Text><Limit label={r.shown} value={r.tokens} max={limit} unit="tokens" by="BenchKeeper" /></Table.Td>
                <Table.Td><Stack gap={2}><Loads row={r} />{r.by && <Text size="sm">{r.by}</Text>}</Stack></Table.Td>
                <Table.Td miw={220}>
                  <Group gap="xs" wrap="nowrap" align="flex-start">
                    {r.switch.by
                      ? <PlanSwitch name={`Load ${r.shown} in ${agent.name}`} hideName on={r.load !== 'off'} pending={wait ? pending : null} off={off}
                        onAsk={(on) => toggle(agent.id, r, on, agent.name)} onClear={onClear} />
                      : <Text size="sm">No switch: {r.switch.why}.</Text>}
                    <Button size="compact-xs" variant="default" leftSection={icon(IconEye)} aria-label={`Show text of ${r.shown}`} onClick={() => onPreview(r)}>Text</Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ); })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}

// The instruction files each agent loads, globally or for a registered project, with the context they cost.
// project: a registered folder; the view then shows only its files, without the choice.
export function Rules({ overview, params, refresh, project }) {
  const projects = overview.data?.projects ?? [];
  const [dir, setDir] = useState(project ?? params.get('path') ?? GLOBAL);
  const [pending, setPending] = useState(null);
  const [running, setRunning, idle, dropped] = usePlanRunning();
  const [preview, setPreview] = useState(null);
  const chosen = dir === GLOBAL ? undefined : dir;
  // A plan asked for under another selection is dropped when it arrives.
  const shown = useRef(chosen);
  shown.current = chosen;
  const state = useApi(`/api/rules${chosen ? `?${new URLSearchParams({ dir: chosen })}` : ''}`);
  const choose = (v) => { if (running) return; setDir(v ?? GLOBAL); setPending(null); };
  const onPlan = (p) => { if (p.dir === shown.current && idle()) setPending(p); };
  return (
    <Stack gap="lg">
      <Note>The instruction files the agents load, who wrote them, what they cost in context and what the checks found. A file that is not BenchKeeper's is yours: nothing here deletes it. A switch is a plan with a diff, and History undoes it.</Note>
      {!project && <Select label="Show" data={[{ value: GLOBAL, label: 'Global files' }, ...projects.map((p) => ({ value: p.path, label: p.name ? `${p.name} (${p.path})` : p.path }))]} value={dir} onChange={choose} readOnly={running} aria-disabled={running || undefined} allowDeselect={false} comboboxProps={{ withinPortal: false }} maw={560} />}
      <Loading state={state} label="instruction files">
        {(data) => (
          <Stack gap="xl">
            <Section title="Checks"><Findings findings={data.findings} dir={chosen} onPlan={onPlan} locked={running} /></Section>
            {data.agents.map((a) => (
              <Stack key={a.id} gap="md">
                <Title order={2} size="h3">{a.name}</Title>
                <Section title={`${a.name} context budget`}><Budget budget={a.budget} /></Section>
                {a.memory?.folders.length > 0 && (
                  <Section title={`${a.name} auto memory`}>
                    <Text size="sm">{a.memory.folders.some((m) => m.enabled)
                      ? `Notes are the topic files beside MEMORY.md, which load on demand. Claude Code loads the first ${a.memory.lines} lines or ${a.memory.bytes / 1024} KB of MEMORY.md at the start of a session.${a.memory.folders.every((m) => m.enabled) ? '' : ' Auto memory is off for the rows marked not loaded (autoMemoryEnabled is false in the settings that apply there).'}`
                      : 'Auto memory is off (autoMemoryEnabled is false): Claude Code loads neither MEMORY.md nor the notes beside it. They stay on disk.'}</Text>
                    <Memory memory={a.memory} />
                  </Section>
                )}
                <Section title={`${a.name} files${chosen ? ' for this project' : ''}`}>
                  <Files agent={a} dir={chosen} limit={data.limit} onPlan={onPlan} onPreview={setPreview} pending={pending && !pending.done ? pending : null} onClear={() => setPending(null)} locked={running} />
                </Section>
              </Stack>
            ))}
          </Stack>
        )}
      </Loading>
      {pending && (
        <Section title="Changes">
          {/* done: applied or cancelled, so the switch shows the file's state again. */}
          <Plan key={pending.plan.planId} plan={pending.plan} why={`You turned the switch ${pending.on ? 'on' : 'off'} in Rules.`} scope={chosen ? 'project' : 'global'} onRunning={setRunning}
            onCancel={(done) => setPending((p) => ({ ...p, done }))} onDone={() => { setPending((p) => ({ ...p, done: true })); state.reload(); refresh(); }} />
          {/* Closing during an apply would drop the run's view and its reload. */}
          <PlanDropped dropped={dropped} />
          <Group><PlanClose running={running} onClose={() => setPending(null)} /></Group>
        </Section>
      )}
      <Preview key={preview?.path} row={preview} dir={chosen} onClose={() => setPreview(null)} onSaved={() => { state.reload(); refresh(); }} />
      <Cli>{'benchkeeper rules list [--agent claude|codex] [--project <dir>]\nbenchkeeper rules check [--project <dir>] [--limit <tokens>]\nbenchkeeper rules disable <file> [--project <dir>]\nbenchkeeper rules enable <file> [--project <dir>]'}</Cli>
    </Stack>
  );
}
