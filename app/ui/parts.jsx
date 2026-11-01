import { Anchor, Badge, Button, Checkbox, Code, Group, Loader, Paper, Progress, Stack, Switch, Table, Text, Title, VisuallyHidden } from '@mantine/core';
import { IconCopy, IconPlayerPlay, IconPlayerStop } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { DiffView, RunPanel } from './run.jsx';
import { Dot, Folded, Loading, Note, STATE_COLOR, StatusBadge, href, icon, useApi } from './shell.jsx';

export const pct = (v) => (v == null ? null : Math.round(v * 100));

// One block per command, so nothing hides past the right edge on a phone: a long one wraps at its spaces, a flag such
// as --limit never splits at its hyphen, and its continuation lines are indented under the command. A word longer than
// the line (a long --agents list) still breaks.
const FLAG = /^\[?-/;
const commandLines = (text) => String(text).split('\n').map((line, n) => (
  <div key={n} style={{ paddingLeft: '2ch', textIndent: '-2ch' }}>
    {line.split(/( +)/).map((part, k) => (FLAG.test(part) ? <span key={k} style={{ whiteSpace: 'nowrap' }}>{part}</span> : part))}
  </div>
));
export const Cli = ({ children }) => (
  <Stack gap={4}>
    <Text size="sm" fw={600}>CLI</Text>
    <Code block tabIndex={0} style={{ whiteSpace: 'normal', overflowWrap: 'break-word' }}>{commandLines(children)}</Code>
  </Stack>
);

function CommandLine({ command, name }) {
  const [copied, setCopied] = useState(null);
  // Without a clipboard (an insecure context) the call throws, which counts as a failed copy.
  const copy = () => Promise.resolve().then(() => navigator.clipboard.writeText(command)).then(() => setCopied('Copied'), () => setCopied('Copy failed: select the command and copy it by hand.'));
  return (
    <Stack gap={4}>
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <Code block tabIndex={0} style={{ flex: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{command}</Code>
        <Button size="compact-xs" variant="default" leftSection={icon(IconCopy)} aria-label={`Copy ${name}`} onClick={copy}>Copy</Button>
      </Group>
      <Text size="xs" role="status" c={copied && copied !== 'Copied' ? 'red' : undefined}>{copied}</Text>
    </Stack>
  );
}

// A step only the user can start: the app shows the line for their own terminal and does not run it.
export const StartBlock = ({ start, why }) => (
  <Stack gap={4}>
    <Text size="sm">Start in a terminal: {start.agent} in <Code>{start.dir}</Code>{why ? `, ${why}` : ''}</Text>
    <CommandLine command={start.command} name={`the command for ${start.prompt}`} />
  </Stack>
);

export const Section = ({ title, children, id }) => (
  <Stack gap="sm" component="section" aria-label={title} id={id}>
    {/* With an id, the heading can take focus after an action removed a row of the section. */}
    <Title order={3} size="h3" id={id && `${id}-title`} tabIndex={id ? -1 : undefined}>{title}</Title>
    {children}
  </Stack>
);

export const StateBadge = ({ state }) => (state ? <Badge variant="default" style={{ flexShrink: 0 }} leftSection={<Dot color={STATE_COLOR[state] ?? 'gray'} />}>{state}</Badge> : null);

// Skill installs of a plan, rehearsed on the server in a scratch folder when the user asks (the rehearsal runs third-party
// code): start() begins it, the job state holds results per change id. Leaving the plan stops a rehearsal still running.
// The server runs it in an OS sandbox; where none starts, a result is `unavailable` and anyway() asks for one without.
export function usePrerun(plan) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  // The plan the user asked for: another plan is not asked for, in the same render that shows it.
  const [askedFor, setAskedFor] = useState(null);
  const asked = plan?.planId != null && askedFor?.planId === plan.planId;
  const unconfined = asked && askedFor.unconfined === true;
  const want = plan?.changes.some((c) => c.prerun);
  useEffect(() => {
    setJob(null); setError(null);
  }, [plan?.planId]);
  useEffect(() => {
    if (!want || !asked) return undefined;
    let live = true, id = null;
    setJob(null);
    const cancel = () => id && api('/api/job-cancel', { id }).catch(() => {});
    api('/api/prerun', { planId: plan.planId, ...(unconfined ? { unconfined: true } : {}) }).then((r) => { id = r.job; if (live) setJob(r.job); else cancel(); }, (e) => live && setError(e.message));
    return () => { live = false; cancel(); };
  }, [plan?.planId, want, asked, unconfined]);
  const state = useJob(job);
  return want ? { job, asked, unconfined, start: () => setAskedFor({ planId: plan.planId }), anyway: () => setAskedFor({ planId: plan.planId, unconfined: true }), state: error ? { done: true, error } : state } : null;
}

const WHERE = {
  srt: 'in a sandbox (writes only in a scratch folder, network limited to the registry and GitHub)',
  bwrap: 'in a sandbox that confines writes to a scratch folder',
  'sandbox-exec': 'in a sandbox that confines writes to a scratch folder',
  none: 'in a scratch folder without a sandbox',
};

function Rehearsal({ c, prerun }) {
  const r = prerun.state?.results?.[c.id];
  if (!prerun.asked) return null;
  if (!r) {
    if (!prerun.state?.done) return <Group gap="xs" role="status"><Loader size="xs" /><Text size="sm">Rehearsing in a scratch folder for the files it writes</Text></Group>;
    return <Text size="sm">{prerun.state.cancelled ? 'Preview cancelled.' : `No preview${prerun.state.error ? `: ${prerun.state.error}` : ''}.`}</Text>;
  }
  if (r.unavailable) return <Text size="sm">Preview unavailable: {r.error}.</Text>;
  if (r.error) return <Text size="sm" c="red">Preview failed: {r.error}</Text>;
  if (!r.files.length) return <Text size="sm">Changes no files.</Text>;
  return (
    <Stack gap={4}>
      <Text size="sm">Rehearsed {WHERE[r.sandbox] ?? WHERE.none}, it changes:</Text>
      {r.note && <Text size="sm">Not fully confined: {r.note}.</Text>}
      {r.files.map((f) => <DiffView key={f.path} diff={f.diff} path={f.path} />)}
      {r.more > 0 && <Text size="sm">and {r.more} more files</Text>}
    </Stack>
  );
}

const FROM = { user: 'the user file', project: 'the project file', local: 'the local file', managed: 'managed settings', environment: 'the environment' };
const shownValue = (v) => (v === undefined ? 'unset' : typeof v === 'string' ? v : JSON.stringify(v));

// One agent setting the same way in every view: summary, plain words, impact, default, and the value in effect with where it
// comes from. A key outside the app's catalog says so instead of guessing.
export function SettingFacts({ f }) {
  return (
    <Stack gap={2} role="group" aria-label={`About ${f.key}`} style={{ overflowWrap: 'anywhere' }}>
      <Text size="sm">{f.summary ?? 'Not explained yet.'}</Text>
      {f.eli5 && <Text size="sm">In plain words: {f.eli5}</Text>}
      {f.impact && <Text size="sm">Impact: {f.impact}</Text>}
      <Text size="sm">
        Default: {f.default ?? 'not stated'}. Current: {f.from === 'default' ? 'the default' : `${shownValue(f.value)}, from ${FROM[f.from]}`}.{' '}
        <Anchor size="sm" underline="always" href={f.docs} target="_blank" rel="noreferrer">Docs</Anchor>
      </Text>
    </Stack>
  );
}

// The facts of the keys a doctor finding, an Insights finding or a planned change names ({ agent, keys, dir }), read on demand.
export function SettingFactsOf({ settings: s }) {
  const state = useApi(`/api/settings?${new URLSearchParams({ agent: s.agent, keys: s.keys.join(','), ...(s.dir ? { dir: s.dir } : {}) })}`);
  return <Loading state={state} label="setting facts">{(list) => <Stack gap="xs">{list.map((f) => <SettingFacts key={f.key} f={f} />)}</Stack>}</Loading>;
}

// The cards of a plan in this order; plugins BenchKeeper did not install get their own card after them.
const GROUPS = [['install', 'Install'], ['update', 'Update'], ['remove', 'Remove'], ['settings', 'Settings'], ['action', 'Needs your action']];
// A unit's changes share one card: the first of these that one of them belongs to.
const PRECEDENCE = ['action', 'remove', 'settings', 'update', 'install'];
// A removal: a destructive change, a file removal, or a command that removes (a skill BenchKeeper installed is preselected).
const removes = (c) => c.destructive || c.kind === 'remove' || (c.kind === 'command' && c.argv.some((a) => a === 'remove' || a === 'uninstall'));
const groupOf = (c) => (c.error ? 'action' : removes(c) ? 'remove' : c.settings ? 'settings'
  : c.kind === 'write' && ['outdated', 'modified', 'foreign', 'current'].includes(c.state) ? 'update' : 'install');
// Long cards start folded.
const LONG = 5;

// The status chip: what the item is now. The server marks every removal as foreign; the full setup's removals (steps
// other:...) are the user's own, the rest BenchKeeper set up.
const CHIP = { absent: ['new', 'teal'], removed: ['new', 'teal'], outdated: ['outdated', 'yellow'], modified: ['modified', 'indigo'], foreign: ['installed by you', 'grape'], current: ['current', 'gray'] };
// A settings merge: what it does to its keys, not the state of the whole file.
const KEY_CHIP = { new: ['new key', 'teal'], changed: ['changed key', 'yellow'], removed: ['removed key', 'orange'], current: ['current', 'gray'] };
const chipOf = (c) => (c.foreign || (c.kind === 'command' && removes(c) && c.step?.startsWith('other:')) ? CHIP.foreign
  : c.settings && KEY_CHIP[c.keyState] ? KEY_CHIP[c.keyState]
  : c.kind === 'write' ? CHIP[c.state] ?? CHIP.absent : removes(c) ? ['installed by BenchKeeper', 'gray'] : CHIP.absent);
const Chip = ({ c }) => {
  const [label, color] = chipOf(c);
  return <Badge variant="default" style={{ flexShrink: 0 }} leftSection={<Dot color={color} />}>{label}</Badge>;
};

const sentence = (t) => `${t[0].toUpperCase()}${t.slice(1)}${t.endsWith('.') ? '' : '.'}`;
// What changes for the user and what could stop working.
const whatOf = (c) => {
  if (c.impact) return sentence(c.impact);
  if (c.kind === 'remove') return `Deletes ${c.path}.`;
  if (c.kind === 'command') return removes(c) ? 'Removes it from the agent: whatever uses it stops working.' : 'Adds it to the agent.';
  if (c.destructive) return `Takes it out of ${c.path}: whatever relies on it stops working.`;
  if (c.settings && !c.error) return `${c.keyState === 'removed' ? 'Removes' : 'Sets'} ${c.settings.keys.join(', ')} ${c.keyState === 'removed' ? 'from' : 'in'} ${c.path}; other keys stay.`;
  if (c.state === 'modified') return `Replaces your edits in ${c.path}.`;
  if (!c.state || c.state === 'absent' || c.state === 'removed') return `Creates ${c.path}.`;
  return `Changes ${c.path}.`;
};
// Why BenchKeeper offers it, from its state; a view that knows the user asked for it says so instead (why).
const whyOf = (c, why) => (c.foreign || c.step?.startsWith('other:') ? 'Not part of BenchKeeper\'s setup: offered for removal, kept unless you tick it.'
  : c.optional ? 'Optional: BenchKeeper suggests it, it stays off unless you tick it.'
  : why ?? (removes(c) ? 'It is no longer part of BenchKeeper\'s setup, or you asked to remove it.'
    : c.state === 'outdated' ? 'BenchKeeper\'s setup has a newer version.'
    : c.state === 'modified' ? 'The file differs from BenchKeeper\'s setup.'
    : c.always ? 'BenchKeeper records what it set up, for updates and the doctor.'
    : c.state === 'current' ? 'Part of BenchKeeper\'s setup.' : 'Part of BenchKeeper\'s setup and not there yet.'));
const AFFECTS = { global: 'Every project on this machine.', project: 'This project only.' };
// What History does to undo it, after the word History; null when it cannot.
const undoOf = (c) => (c.kind === 'command' ? (c.undoArgv ? (removes(c) ? ' installs it again.' : ' removes it again.') : null)
  : c.settings ? ' restores the file as it was before the run.' : c.state === 'modified' ? ' restores your edits.' : c.kind === 'remove' ? ' puts the file back.' : ' restores the file as it was.');

// The labelled lines above a change's diff: what it does, why, who it affects, how to undo it and where it comes from.
// A settings change takes its source from its setting facts.
function About({ c, why, scope }) {
  const affects = AFFECTS[c.installUnit?.scope ?? scope], undo = undoOf(c);
  // A git source names owner/name or a full URL.
  const repo = c.installUnit?.source?.type === 'git' && c.installUnit.source.repo;
  const url = repo && (/^https?:\/\//.test(repo) ? repo : `https://github.com/${repo}`);
  const line = (label, text) => <Text size="sm"><Text span size="sm" fw={600}>{label}:</Text> {text}</Text>;
  return (
    <Stack gap={2} role="group" aria-label={`About ${c.title}`}>
      {line('What it does', whatOf(c))}
      {line('Why', whyOf(c, why))}
      {affects && line('Affects', affects)}
      {line('Undo', undo ? <><Anchor size="sm" underline="always" href={href('history')}>History</Anchor>{undo}</> : 'History cannot undo this command.')}
      {repo && line('Source', <Anchor size="sm" underline="always" href={url} target="_blank" rel="noreferrer">{repo.replace(/^https:\/\/github\.com\//, '')}</Anchor>)}
    </Stack>
  );
}

// One card per group with its count; a long one opens on a button. With select, a box selects or clears the whole card.
function Card({ title, rows, select, setSelect, selectable, folded, children }) {
  const [open, setOpen] = useState(!folded);
  const ids = rows.flat().map(([c]) => c.id), on = select ? ids.filter((id) => select.includes(id)).length : 0;
  const pick = ids.filter((id) => selectable.includes(id));
  return (
    <Paper withBorder p="sm" role="group" aria-label={title}>
      <Stack gap="sm">
        <Group justify="space-between" gap="xs">
          <Text fw={600}>{title} ({ids.length}{select ? `, ${on} selected` : ''})</Text>
          <Group gap="xs">
            {select && !!pick.length && (
              <Checkbox size="xs" label="Select all" aria-label={`Select all in ${title}`} checked={pick.every((id) => select.includes(id))} indeterminate={on > 0 && !pick.every((id) => select.includes(id))}
                onChange={() => setSelect((s) => (pick.every((id) => s.includes(id)) ? s.filter((id) => !ids.includes(id)) : [...new Set([...s, ...pick])]))} />
            )}
            {folded && <Button size="compact-xs" variant="default" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} ${title}`} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'}</Button>}
          </Group>
        </Group>
        {open && children}
      </Stack>
    </Paper>
  );
}

// The changes of a plan in cards by group (Install, Update, Remove, Settings, Needs your action), each with a
// sentence, a status chip, what it does, why, who it affects and its undo, the command and the diff behind a button, and
// rehearsed skill installs. With select and setSelect, one checkbox per change; changes of one unit go together: toggling
// one toggles all of them. why: the reason when the user asked for these changes; scope: global or project, where a change
// does not name its own.
export function ChangeList({ plan, select, setSelect, prerun, why, scope }) {
  if (!plan.changes.length) return <Text>{NOTHING}</Text>;
  const unitOf = (c) => (c.unit ? plan.changes.filter((x) => x.unit === c.unit).map((x) => x.id) : [c.id]);
  const toggle = (c) => setSelect((s) => (s.includes(c.id) ? s.filter((x) => !unitOf(c).includes(x)) : [...new Set([...s, ...unitOf(c)])]));
  // A unit's changes are listed together under one note, at the place of its first change.
  const units = new Map(), groups = [], foreign = [];
  plan.changes.forEach((c, i) => {
    if (c.foreign) foreign.push([c, i]);
    else if (c.unit && units.has(c.unit)) units.get(c.unit).push([c, i]);
    else { const g = [[c, i]]; if (c.unit) units.set(c.unit, g); groups.push(g); }
  });
  const cardOf = (g) => PRECEDENCE.find((k) => g.some(([c]) => groupOf(c) === k));
  // Select all leaves out what cannot be made and the plugins BenchKeeper did not install.
  const selectable = groups.filter((g) => !g.some(([c]) => c.error)).flat().map(([c]) => c.id);
  // A plugin BenchKeeper did not install: kept by default, adding its pack to a project comes before removing it.
  const foreignRow = ([c, i]) => (
    <Stack key={`${c.id}:${i}`} gap={4} style={{ overflowWrap: 'anywhere' }}>
      <Group gap="xs" align="flex-start"><Text size="sm">{c.title}</Text><Chip c={c} /></Group>
      <About c={c} why={why} scope={scope} />
      <Group><Button component="a" href={href('projects')} size="xs" variant="default">Add {c.pack} to a project</Button></Group>
      {select && <Checkbox checked={select.includes(c.id)} disabled={!!c.error} onChange={() => toggle(c)} label={`Remove ${c.argv.at(-1)}`} />}
    </Stack>
  );
  const row = ([c, i]) => (
    <Stack key={`${c.id}:${i}`} gap={4} style={{ overflowWrap: 'anywhere' }}>
      <Group gap="xs" align="flex-start">
        {select ? (
          <Checkbox checked={select.includes(c.id)} disabled={!!c.error || unitOf(c).some((id) => plan.changes.find((x) => x.id === id).error)} onChange={() => toggle(c)} label={sentence(c.title)} />
        ) : <Text size="sm" fw={600}>{sentence(c.title)}</Text>}
        <Chip c={c} />
      </Group>
      <About c={c} why={why} scope={scope} />
      {c.error && <Text size="sm" c="red">{c.kind === 'command' ? 'Not applied' : 'Cannot merge'}: {c.error}</Text>}
      {c.settings && <SettingFactsOf settings={c.settings} />}
      {c.argv && !c.diff && <Folded title={c.title} label={['Show command', 'Hide command']} name={`command of ${c.title}`}><CommandLine command={c.argv.join(' ')} name={`the command of ${c.title}`} /></Folded>}
      {c.diff?.startsWith('copy ') ? <Text size="sm">Copies <Code>{c.diff.slice(5)}</Code></Text>
        : c.diff && <Folded title={c.title} label={['Show file diff', 'Hide file diff']} name={`file diff of ${c.title}`}><DiffView diff={c.diff} path={c.path} /></Folded>}
      {c.prerun && prerun && <Rehearsal c={c} prerun={prerun} />}
    </Stack>
  );
  const card = (g) => (g.length > 1 ? (
    <Stack key={g[0][0].unit} gap="sm" pl="sm" role="group" aria-label={`${g.length} changes that go together`} style={{ borderLeft: '2px solid var(--mantine-color-default-border)' }}>
      <Text size="sm">These {g.length} changes go together.</Text>
      {g.map(row)}
    </Stack>
  ) : row(g[0]));
  return (
    <Stack gap="sm">
      {prerun && !prerun.asked && (
        <Group gap="xs">
          <Button size="xs" variant="default" onClick={prerun.start}>Preview the files the skill installs write</Button>
          <Text size="sm">Runs the install in a scratch folder: it downloads and runs third-party code.</Text>
        </Group>
      )}
      {prerun?.asked && !prerun.unconfined && Object.values(prerun.state?.results ?? {}).some((r) => r.unavailable) && (
        <Group gap="xs">
          <Button size="xs" variant="default" onClick={prerun.anyway}>Rehearse anyway without a sandbox</Button>
          <Text size="sm">Only HOME and the folder variables point to the scratch folder then; the command can write elsewhere and reach any host.</Text>
        </Group>
      )}
      {prerun && <CancelJob job={prerun.job} state={prerun.state} what="the preview" />}
      {GROUPS.map(([k, title]) => {
        const rows = groups.filter((g) => cardOf(g) === k);
        return rows.length ? <Card key={k} title={title} rows={rows} select={select} setSelect={setSelect} selectable={selectable} folded={rows.flat().length > LONG}>{rows.map(card)}</Card> : null;
      })}
      {!!foreign.length && (
        <Card title="Plugins BenchKeeper did not install" rows={[foreign]} select={select} setSelect={setSelect} selectable={[]} folded>
          <Text size="sm">Kept unless you tick one: each removal is its own choice.</Text>
          {foreign.map(foreignRow)}
        </Card>
      )}
    </Stack>
  );
}

// The server runs a removal only with this flag: the user ticks each removal on its own.
export const confirms = (plan, select) => ({ confirmDestructive: plan.changes.some((c) => c.destructive && select?.includes(c.id)) });

const NOTHING = 'Nothing to change: everything already matches.';

export const defaultSelect = (plan) => plan.changes.filter((c) => c.selected && !c.error).map((c) => c.id);

// A plan from the server: its changes (removals off by default), then apply from a footer that stays in view. After the
// apply, the run with its undo replaces the plan. onRunning hears when an apply starts and ends, onCancel when the user
// cancels (true) or reviews the changes again (false). why and scope go to the change list. initial: the ids ticked at
// the start, instead of the plan's own default.
export function Plan({ plan, onDone, onRunning, onCancel, why, scope, initial }) {
  const [select, setSelect] = useState(() => initial ?? defaultSelect(plan));
  const [cancelled, setCancelled] = useState(false);
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(null);
  const prerun = usePrerun(plan);
  useEffect(() => () => onRunning?.(false), []);
  // After Cancel or Review again, focus moves to the first control of what replaced the button.
  const root = useRef(null);
  const moved = useRef(false);
  useEffect(() => { if (moved.current) root.current?.querySelector('button:enabled, input:enabled')?.focus(); }, [cancelled]);
  if (applied) {
    return (
      <Stack gap="sm">
        <Group justify="flex-end"><Anchor href={href('history', { run: applied.id })}>Open in History</Anchor></Group>
        <RunPanel id={applied.id} output={applied.output} order={3} onChanged={() => onDone?.()} />
      </Stack>
    );
  }
  if (!plan.changes.length) return <Text>{NOTHING}</Text>;
  const cancel = (on) => { moved.current = true; setCancelled(on); onCancel?.(on); };
  if (cancelled) {
    return (
      <Group gap="xs" ref={root}>
        <Text role="status">Cancelled. Nothing was changed.</Text>
        <Button size="xs" variant="default" onClick={() => cancel(false)}>Review the changes again</Button>
      </Group>
    );
  }
  const run = async () => {
    setBusy(true);
    onRunning?.(true);
    try { setJob(await api('/api/apply', { planId: plan.planId, select, ...confirms(plan, select) })); } catch (e) { setError(e.message); onRunning?.(false); }
    setBusy(false);
  };
  if (job) return <RunProgress focus job={job.job} total={job.total} onDone={(run, output) => { if (run) setApplied({ id: run.id, output }); onRunning?.(false); onDone?.(run, output); }} />;
  return (
    <Stack gap="sm" ref={root}>
      {error && <Note color="red" title="Apply failed">{error}</Note>}
      <ChangeList plan={plan} select={select} setSelect={setSelect} prerun={prerun} why={why} scope={scope} />
      <Group role="group" aria-label="Selected changes" justify="space-between" gap="xs" py="xs"
        style={{ position: 'sticky', bottom: 0, zIndex: 1, background: 'var(--mantine-color-body)', borderTop: '1px solid var(--mantine-color-default-border)' }}>
        <Text size="sm" role="status">{select.length} {select.length === 1 ? 'change' : 'changes'} selected</Text>
        <Group gap="xs">
          {/* While the apply request is out, Cancel would hide a job that has started. */}
          <Button variant="default" data-disabled={busy || undefined} aria-disabled={busy || undefined} onClick={() => !busy && cancel(true)}>Cancel</Button>
          <Button leftSection={icon(IconPlayerPlay)} onClick={run} loading={busy} disabled={!select.length} aria-label={`Apply ${select.length} ${select.length === 1 ? 'change' : 'changes'}`}>Apply</Button>
        </Group>
      </Group>
    </Stack>
  );
}

// The apply state of a view's open plan: running for its controls, idle() for a plan that arrives later (asked for
// before the apply started), which must not replace a running plan: that drops the run's view and its reload.
// dropped: the last plan that arrived was dropped, until one is taken.
export function usePlanRunning() {
  const [running, setRunning] = useState(false);
  const [dropped, setDropped] = useState(false);
  const now = useRef(false);
  const onRunning = (on) => { now.current = on; setRunning(on); };
  const idle = () => { setDropped(now.current); return !now.current; };
  return [running, onRunning, idle, dropped];
}

export const PlanDropped = ({ dropped }) => dropped && <Text size="sm" role="status">Finish the running change first, then try again.</Text>;

// Close under a plan: while it applies, closing would drop the run's view and its reload, so the button ignores clicks
// but keeps the keyboard focus.
export const PlanClose = ({ running, onClose }) => (
  <Button variant="default" data-disabled={running || undefined} aria-disabled={running || undefined} onClick={() => !running && onClose()}>Close</Button>
);

// A switch whose change is a plan. pending: the plan it opened, shown as the asked-for position and Pending until the
// plan is applied, cancelled or closed; flipping it then closes the plan (onClear). The label is the name and the state,
// so the accessible name contains the visible word; hideName keeps the name for screen readers only. off: input is
// ignored but the switch keeps the keyboard focus.
export const PlanSwitch = ({ name, hideName, on, pending, off, description, onAsk, onClear }) => {
  const state = pending ? 'Pending' : on ? 'On' : 'Off';
  return (
    <Switch label={<>{hideName ? <VisuallyHidden>{name}: </VisuallyHidden> : `${name}: `}{state}</>} description={pending ? 'Apply or cancel in Changes below' : description}
      checked={pending ? pending.on : on} aria-disabled={off || undefined} style={off ? { opacity: 0.6 } : undefined}
      onChange={(e) => (off ? undefined : pending ? onClear() : onAsk(e.currentTarget.checked))} />
  );
};

// A started job (apply or eval), polled until it is done. A failed poll is retried; only a lost job (404) or ten
// misses in a row end the view, the job itself goes on.
export function useJob(job, onDone) {
  const [state, setState] = useState(null);
  useEffect(() => {
    // Another job's state must not show under this one.
    setState(null);
    if (!job) return undefined;
    let live = true, timer, misses = 0;
    const poll = async () => {
      try {
        const s = await api(`/api/job?id=${job}`);
        if (!live) return;
        misses = 0;
        setState(s);
        if (s.done) { onDone?.(s); return; }
      } catch (e) {
        if (!live) return;
        if (e.status === 404 || ++misses >= 10) {
          const error = `${e.message}: see History`;
          setState((x) => ({ ...x, done: true, error }));
          onDone?.({ done: true, error });
          return;
        }
      }
      timer = setTimeout(poll, 400);
    };
    poll().catch(console.error);
    return () => { live = false; clearTimeout(timer); };
  }, [job]);
  return state;
}

// Stops a job: an apply after the change that runs, an eval or a suggestion at once.
export function CancelJob({ job, state, what }) {
  const [asked, setAsked] = useState(false);
  if (!state || state.done) return null;
  const cancelling = asked || state.cancelled;
  return (
    <Group>
      <Button size="xs" variant="default" leftSection={icon(IconPlayerStop)} disabled={cancelling}
        onClick={() => { setAsked(true); api('/api/job-cancel', { id: job }).catch(() => setAsked(false)); }}>{cancelling ? 'Cancelling' : `Cancel ${what}`}</Button>
    </Group>
  );
}

// A started apply: each change with its status, the running command's output, then the run.
// focus: the section takes focus on mount, for a view that replaced the button that started it.
export function RunProgress({ job, total, onDone, focus }) {
  const state = useJob(job, (s) => onDone?.(s.run, s.output, s));
  const ref = useRef(null);
  useEffect(() => { if (focus) ref.current?.focus(); }, []);
  const entries = state?.run?.entries ?? [];
  // Each change is journaled as running before it starts.
  const finished = entries.filter((e) => e.status && e.status !== 'running').length;
  const running = !state?.done && entries.find((e) => e.status === 'running');
  const waiting = state?.done ? 0 : Math.max(total - entries.length, 0);
  return (
    <Stack gap="sm" component="section" aria-label="Apply progress" ref={ref} tabIndex={-1}>
      <Progress value={total ? (finished / total) * 100 : 100} aria-label="Changes done" color={state?.run?.status === 'failed' || entries.some((e) => e.status === 'failed') ? 'red' : 'teal'} />
      <Text role="status">
        {state?.done ? <>Run <Code>{state.run?.id ?? job}</Code>: {state.error ?? state.run?.status} ({finished} of {total} changes). <Anchor href={href('history', { run: state.run?.id })} underline="always">Open in History</Anchor></>
          : running ? `${finished} of ${total} done. Running: ${running.title}` : `${finished} of ${total} done`}
      </Text>
      <CancelJob job={job} state={state} what="the remaining changes" />
      {state?.error && <Note color="red" title="Apply failed">{state.error}</Note>}
      <Table aria-label="Changes" layout="fixed">
        <Table.Thead><Table.Tr><Table.Th w={124}>Status</Table.Th><Table.Th>Change</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {entries.map((e) => {
            const status = e.status ?? (state?.done ? 'failed' : 'running'), out = state?.output?.[e.id];
            return (
              <Table.Tr key={e.id}>
                <Table.Td><StatusBadge status={status} /></Table.Td>
                <Table.Td>
                  {e.title}{e.error || e.reason ? `: ${e.error ?? e.reason}` : ''}
                  {e.argv && <Code block tabIndex={0} mt={4}>{`$ ${e.argv.join(' ')}${out ? `\n${out.trimEnd()}` : ''}`}</Code>}
                </Table.Td>
              </Table.Tr>
            );
          })}
          {waiting > 0 && <Table.Tr><Table.Td><StatusBadge status="waiting" /></Table.Td><Table.Td>{waiting} more</Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

export function EvalJob({ job, total, onDone }) {
  const s = useJob(job, onDone);
  const at = s?.progress ? s.progress.index + (s.done ? 1 : 0) : 0;
  return (
    <Stack gap="xs">
      <Progress value={(s?.done && !s.error ? total : s?.progress?.index ?? 0) / total * 100} aria-label="Eval sessions done" />
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
