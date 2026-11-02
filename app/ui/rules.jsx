import { ActionIcon, Badge, Box, Button, Code, Drawer, Group, List, Paper, Popover, Progress, Select, Stack, Table, Tabs, Text, Textarea, Title } from '@mantine/core';
import { IconEye, IconInfoCircle, IconPencil, IconPlayerStop } from '@tabler/icons-react';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from './api.js';
import { Cli, Plan, PlanClose, PlanDropped, PlanSwitch, Section, usePlanRunning } from './parts.jsx';
import { when } from './run.jsx';
import { Dot, Loading, Note, SCROLL_CUE, breakAt, icon, useApi } from './shell.jsx';

const GLOBAL = 'global';
const LOAD = { always: ['teal', 'loads'], 'path-scoped': ['blue', 'loads for matching files'], off: ['gray', 'off'], shadowed: ['yellow', 'not read'] };
const number = (n) => n.toLocaleString('en-US');

// The five largest sources of a budget and the rest as one, each with the color of its segment (the board's series).
const SERIES = ['s1', 's2', 's3', 's4', 's5'];
const partsOf = (items) => {
  const sorted = items.filter((i) => i.tokens > 0).sort((a, b) => b.tokens - a.tokens);
  const top = sorted.slice(0, SERIES.length).map((i, n) => ({ label: i.label, tokens: i.tokens, color: `var(--bk-${SERIES[n]})` }));
  const rest = sorted.slice(SERIES.length);
  return rest.length ? [...top, { label: `${rest.length} more sources`, tokens: rest.reduce((n, i) => n + i.tokens, 0), color: 'var(--bk-other)' }] : top;
};

// A value against its limit, with who sets the limit; with parts, one segment per source and a tick at the limit when it is passed.
const Limit = ({ label, value, max, unit, by, parts }) => {
  const name = `${label}: ${number(value)} of ${number(max)} ${unit}, limit set by ${by}`;
  if (!parts) return <Progress size="sm" value={Math.min(100, (value / max) * 100)} color={value > max ? 'red' : 'teal'} aria-label={name} />;
  const scale = Math.max(max, parts.reduce((n, p) => n + p.tokens, 0));
  return (
    <Progress.Root size="lg" role="progressbar" aria-label={name} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)} aria-valuetext={`${number(value)} of ${number(max)} ${unit}`} styles={{ root: { gap: 2 } }}>
      {parts.map((p) => <Progress.Section key={p.label} value={(p.tokens / scale) * 100} color={p.color} withAria={false} />)}
      {scale > max && <span aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, left: `${(max / scale) * 100}%`, width: 2, background: 'var(--bk-ink)' }} />}
    </Progress.Root>
  );
};

// What each segment of the bar is, largest first.
const Legend = ({ parts, name }) => (
  <List listStyleType="none" aria-label={`${name} sources`} styles={{ root: { display: 'flex', flexWrap: 'wrap', gap: '4px 16px' } }}>
    {parts.map((p) => (
      <List.Item key={p.label}>
        <Group gap={8} wrap="nowrap">
          <span aria-hidden className="bk-dot" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: 'currentColor', color: p.color, flex: 'none' }} />
          <Code style={{ overflowWrap: 'anywhere' }}>{p.label}</Code>
          <span className="bk-num">{number(p.tokens)}</span>
        </Group>
      </List.Item>
    ))}
  </List>
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

// The result of the checks as one chip beside the budget count; the findings themselves follow in Findings.
const ChecksChip = ({ findings }) => (
  <Badge variant="default" h="auto" py={4} styles={{ label: { whiteSpace: 'normal' } }} leftSection={<Dot color={findings.some((f) => f.level === 'error') ? 'red' : findings.length ? 'yellow' : 'teal'} />}>
    {findings.length ? `${findings.length} ${findings.length === 1 ? 'finding' : 'findings'}` : 'No rule file is over a limit or broken'}
  </Badge>
);

// Findings of the checks: severity, file and line in the message, the fix, and a switch-off plan where that is safe.
// A busy control here and in Files ignores clicks but keeps the keyboard focus (a disabled one loses it).
// locked: an apply runs, and a new plan would drop its view.
function Findings({ findings, dir, onPlan, locked }) {
  const { busy, error, toggle } = useSwitch(dir, onPlan);
  return (
    <Stack gap="sm">
      {error && <Note color="red" title="Not planned">{error}</Note>}
      <Table.ScrollContainer minWidth={560} scrollAreaProps={{ ...SCROLL_CUE, viewportProps: { tabIndex: 0, role: 'region', 'aria-label': 'Rule findings, scrollable' } }}>
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

// The estimate behind an info button; Escape on the button closes it too (Mantine closes on Escape only inside the dropdown).
function TokenNote({ name }) {
  const [opened, setOpened] = useState(false);
  const note = useId();
  return (
    <Popover opened={opened} onChange={setOpened} width={240} withArrow withinPortal={false} position="bottom-start">
      <Popover.Target>
        <ActionIcon variant="subtle" color="gray" size="sm" aria-label={`How ${name} tokens are counted`} aria-describedby={opened ? note : undefined} onClick={() => setOpened((o) => !o)} onKeyDown={(e) => e.key === 'Escape' && setOpened(false)}>{icon(IconInfoCircle, 16)}</ActionIcon>
      </Popover.Target>
      <Popover.Dropdown maw="calc(100vw - 32px)"><Text size="sm" id={note}>A token is counted as four bytes: an estimate.</Text></Popover.Dropdown>
    </Popover>
  );
}

// The top panel: per agent what loads at the start of every session against BenchKeeper's limit, as one bar split by source
// with its legend, and the result of the checks as a chip beside the count. detail: the findings, when there are any.
const Summary = ({ agents, chip, detail }) => (
  <Paper withBorder p="md" component="section" aria-label="Summary">
    <Stack gap="md">
      <Group justify="space-between" align="flex-start" gap="md">
        <Stack gap="md" style={{ flex: '1 1 360px', minWidth: 0 }}>
          {agents.map(({ id, name, budget: { total, items, over, threshold, limits: [start] } }) => {
            const parts = partsOf(items);
            // Codex counts only what fits its size limit; the sources stay as found.
            const unloaded = items.reduce((n, i) => n + i.tokens, 0) - total;
            return (
              <Stack key={id} gap="xs">
                <Group gap={4} wrap="nowrap" align="flex-start">
                  <Text><Text span fw={700}>{name}:</Text> <Text span fw={700} fz={22} className="bk-num">{number(total)}</Text> of {number(start.max)} tokens at the start of a session (limit set by {start.by})</Text>
                  <TokenNote name={name} />
                </Group>
                <Limit {...start} parts={parts.length ? parts : undefined} />
                {parts.length > 0 && <Legend parts={parts} name={name} />}
                {unloaded > 0 && <Text size="sm">About {number(unloaded)} tokens of these sources may not load: {name} stops adding files at its size limit.</Text>}
                {over && <Note color="yellow">More than {number(threshold)} tokens (BenchKeeper's own limit, not the agent's): every turn pays for them. Turn off a file, split a long one into path-scoped rules, or shorten the largest source.</Note>}
              </Stack>
            );
          })}
        </Stack>
        {/* contents: the region keeps the chip and the findings together while they sit in the panel's own rows. */}
        <Box component="section" aria-label="Checks" style={{ display: 'contents' }}>
          {chip}
          {detail && <Box style={{ flex: '1 1 100%', minWidth: 0 }}>{detail}</Box>}
        </Box>
      </Group>
    </Stack>
  </Paper>
);

// The rest of an agent's budget: the other limits and what loads on demand; the sources are the bar and the file rows.
const hasBudget = (b) => b.onDemand > 0 || b.notes.length > 0 || b.limits.length > 1;
function Budget({ budget }) {
  return (
    <Stack gap="xs">
      {budget.onDemand > 0 && <Text size="sm">About {number(budget.onDemand)} more tokens of path-scoped rules load only when matching files are used.</Text>}
      {budget.notes.map((n) => <Note key={n} color="yellow">{n}</Note>)}
      {budget.limits.slice(1).map((l) => (
        <Stack key={l.label} gap={2}>
          <Text size="sm">{l.label}: {number(l.value)} of {number(l.max)} {l.unit} (limit set by {l.by})</Text>
          <Limit {...l} />
        </Stack>
      ))}
    </Stack>
  );
}

// The auto memory folders with notes, in numbers only: read-only, the notes stay with Claude Code. With auto memory off
// for a row's project nothing of it loads, so its badge does not judge the size.
const Memory = ({ memory: { folders } }) => (
  <Table.ScrollContainer minWidth={560} scrollAreaProps={{ ...SCROLL_CUE, viewportProps: { tabIndex: 0, role: 'region', 'aria-label': 'Auto memory per project, scrollable' } }}>
    <Table aria-label="Auto memory per project" verticalSpacing="xs">
      <Table.Thead><Table.Tr><Table.Th>Project</Table.Th><Table.Th ta="right">Notes</Table.Th><Table.Th ta="right">Size</Table.Th><Table.Th>Last change</Table.Th><Table.Th>MEMORY.md</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>
        {folders.map((m) => (
          <Table.Tr key={m.path}>
            <Table.Td><Code style={{ overflowWrap: 'break-word' }}>{breakAt(m.project)}</Code></Table.Td>
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

// One row per file: switch, path with its state, a bar against the limit with the token count, the text. pending: the open
// plan; its row's switch shows it (PlanSwitch).
function Files({ agent, dir, limit, onPlan, onPreview, pending, onClear, locked }) {
  const { busy, error, toggle } = useSwitch(dir, onPlan);
  if (!agent.rows.length) return <Text size="sm">No instruction file found.</Text>;
  return (
    <Stack gap="sm">
      {error && <Note color="red" title="Not planned">{error}</Note>}
      <Text size="sm">A file that is not BenchKeeper's is yours: nothing here deletes it.</Text>
      <List listStyleType="none" aria-label={`${agent.name} instruction files`} styles={{ item: { borderTop: '1px solid var(--mantine-color-default-border)' }, itemWrapper: { display: 'block', width: '100%' } }}>
        {agent.rows.map((r) => { const wait = pending?.row.path === r.path, off = locked || busy === r.path; return (
          <List.Item key={r.path}>
            <Box style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', padding: '10px 0' }}>
              <Box style={{ flex: '0 0 72px' }}>
                {r.switch.by
                  ? <PlanSwitch name={`Load ${r.shown} in ${agent.name}`} hideName on={r.load !== 'off'} pending={wait ? pending : null} off={off}
                    onAsk={(on) => toggle(agent.id, r, on, agent.name)} onClear={onClear} />
                  : '-'}
              </Box>
              <Stack gap={4} style={{ flex: '1 1 200px', minWidth: 0 }}>
                <Code style={{ overflowWrap: 'anywhere', alignSelf: 'flex-start' }}>{r.shown}</Code>
                <Group gap={6}>
                  <Loads row={r} />
                  <Badge variant="default" miw="max-content">{r.owner}</Badge>
                  <Text size="sm">{r.scope}{r.order != null ? `, load order ${r.order}` : ''}, {number(r.bytes)} bytes{r.lines ? `, ${r.lines} lines` : ''}</Text>
                </Group>
                {r.by && <Text size="sm">{r.by}</Text>}
                {!r.switch.by && <Text size="sm">No switch: {r.switch.why}.</Text>}
              </Stack>
              <Group gap="sm" wrap="nowrap" style={{ flex: '0 1 240px', minWidth: 0 }}>
                <Box style={{ flex: 1, minWidth: 0 }}><Limit label={r.shown} value={r.tokens} max={limit} unit="tokens" by="BenchKeeper" /></Box>
                <Text className="bk-num" ta="right" miw={64}>{number(r.tokens)}</Text>
              </Group>
              <ActionIcon variant="default" size="sm" aria-label={`Show text of ${r.shown}`} onClick={() => onPreview(r)}>{icon(IconEye, 16)}</ActionIcon>
            </Box>
          </List.Item>
        ); })}
      </List>
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
      {!project && <Select label="Show" data={[{ value: GLOBAL, label: 'Global files' }, ...projects.map((p) => ({ value: p.path, label: p.name ? `${p.name} (${p.path})` : p.path }))]} value={dir} onChange={choose} readOnly={running} aria-disabled={running || undefined} allowDeselect={false} comboboxProps={{ withinPortal: false }} maw={560} />}
      <Loading state={state} label="instruction files">
        {(data) => (
          <Stack gap="xl">
            <Summary agents={data.agents} chip={<ChecksChip findings={data.findings} />} detail={data.findings.length > 0 && <Findings findings={data.findings} dir={chosen} onPlan={onPlan} locked={running} />} />
            {data.agents.length > 0 && (
              <Tabs defaultValue={data.agents[0].id}>
                <Tabs.List aria-label="Agents">{data.agents.map((a) => <Tabs.Tab key={a.id} value={a.id}>{a.name}</Tabs.Tab>)}</Tabs.List>
                {data.agents.map((a) => (
                  <Tabs.Panel key={a.id} value={a.id} pt="md">
                    <Stack gap="xl">
                      {hasBudget(a.budget) && <Section title={`${a.name} context budget`}><Budget budget={a.budget} /></Section>}
                      <Section title={`${a.name} files${chosen ? ' for this project' : ''}`}>
                        <Files agent={a} dir={chosen} limit={data.limit} onPlan={onPlan} onPreview={setPreview} pending={pending && !pending.done ? pending : null} onClear={() => setPending(null)} locked={running} />
                      </Section>
                      {a.memory?.folders.length > 0 && (
                        <Section title={`${a.name} auto memory`}>
                          <Text size="sm">{a.memory.folders.some((m) => m.enabled)
                            ? `Notes are the topic files beside MEMORY.md, which load on demand. Claude Code loads the first ${a.memory.lines} lines or ${a.memory.bytes / 1024} KB of MEMORY.md at the start of a session.${a.memory.folders.every((m) => m.enabled) ? '' : ' Auto memory is off for the rows marked not loaded (autoMemoryEnabled is false in the settings that apply there).'}`
                            : 'Auto memory is off (autoMemoryEnabled is false): Claude Code loads neither MEMORY.md nor the notes beside it. They stay on disk.'}</Text>
                          <Memory memory={a.memory} />
                        </Section>
                      )}
                    </Stack>
                  </Tabs.Panel>
                ))}
              </Tabs>
            )}
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
