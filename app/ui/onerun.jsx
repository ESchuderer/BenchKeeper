import { Anchor, Button, Checkbox, Code, Drawer, Group, NativeSelect, Progress, Stack, Table, Text, Title } from '@mantine/core';
import { IconPlayerPlay, IconWand } from '@tabler/icons-react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { CancelJob, ChangeList, confirms, defaultSelect, useJob, usePrerun } from './parts.jsx';
import { AdviceConsent, ENV_TITLE, TIER_TEXT, planQuery } from './setup.jsx';
import { Loading, Note, StatusBadge, href, icon, useApi } from './shell.jsx';

// One run: pick what to set up, prepare every plan unattended (one progress bar), review them on one page, apply the
// checked changes as one job. Global plan, agent suggestions, project plans and the skill rehearsal are the existing
// routes; only the apply is one job (POST /api/apply-all).
// shortcut: the prepared plans live in this page's memory (a reload loses them, the plans on the server expire after
// 30 minutes); keep them on the server if that matters.

const MODES = {
  everything: 'Prepares the global setup and every project Update all does not handle, then shows all changes on one page. Nothing is written until you apply.',
  global: 'Prepares the global setup: rules, settings, plugins and skills for the installed agents. Nothing is written until you apply.',
  projects: 'Prepares the projects you check: an agent suggests the setup of a project without one, then each project gets its plan. Nothing is written until you apply.',
};
const LEVEL_OPTIONS = [
  { value: 'lite', label: 'Lite: the BenchKeeper plugin only, nothing else on the machine' },
  { value: 'standard', label: 'Standard: the plugin, plus the local block in each project you pick' },
  { value: 'full', label: 'Full: standard plus global rules, settings, other plugins and host tools' },
];
const base = (p) => p.split(/[\\/]/).filter(Boolean).at(-1) ?? p;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FINISHED = ['ready', 'failed', 'cancelled'];

async function waitJob(id) {
  for (;;) {
    const s = await api(`/api/job?id=${id}`);
    if (s.done) return s;
    await sleep(400);
  }
}

// A project's first answers: its state file, or the suggested defaults; an agent's suggestion on top.
function initialAnswers(setup, advice) {
  const st = setup.state;
  const a = st ? { agents: st.agents ?? [], env: st.env ?? 'container', sandbox: !!st.sandbox, packs: st.packs ?? [], skills: st.singles ?? [], tier: st.tier ?? '' }
    : { agents: setup.agents.map((x) => x.id), env: setup.suggested.env?.id ?? 'container', sandbox: false, packs: setup.suggested.packs.map((p) => p.id), skills: [], tier: '' };
  if (!advice) return a;
  const some = advice.packs.length || advice.skills.length;
  return { ...a, env: advice.env?.id ?? a.env, packs: some ? advice.packs.map((p) => p.id) : a.packs, skills: some ? advice.skills.map((k) => k.name) : a.skills };
}
const projectPlanOf = (dir, a) => api(`/api/project-plan?${planQuery(dir, { ...a, share: false })}`);

const OneRunContext = createContext(() => {});
const useOneRun = () => useContext(OneRunContext);
export const OneRunProvider = OneRunContext.Provider;

export function OneRunButtons() {
  const open = useOneRun();
  return (
    <Group gap="xs" role="group" aria-label="One-run setup">
      <Button leftSection={icon(IconWand)} onClick={() => open('everything')}>Set up everything</Button>
      <Button variant="default" onClick={() => open('global')}>Set up global only</Button>
      <Button variant="default" onClick={() => open('projects')}>Set up projects</Button>
    </Group>
  );
}

// Open until the run is over: the drawer sits in the app shell, so a view change does not end a run.
export function OneRunDrawer({ mode, onClose }) {
  const [busy, setBusy] = useState(false);
  // The review holds minutes of agent work: only the Close button leaves it, not a stray Escape or click.
  const [reviewing, setReviewing] = useState(false);
  const close = () => { if (!busy) onClose(); };
  return (
    <Drawer opened={!!mode} onClose={close} position="right" size="xl" withCloseButton={false} closeOnEscape={!busy && !reviewing} closeOnClickOutside={!busy && !reviewing} attributes={{ content: { 'aria-label': 'One-run setup' } }}>
      {mode && (
        <Stack gap="md">
          <Group justify="space-between">
            <Title order={2} size="h3">One-run setup</Title>
            <Button variant="default" disabled={busy} onClick={close}>Close</Button>
          </Group>
          <Flow key={mode} mode={mode} setBusy={setBusy} setReviewing={setReviewing} />
        </Stack>
      )}
    </Drawer>
  );
}

function Flow({ mode, setBusy, setReviewing }) {
  const [stage, setStage] = useState('start');
  useEffect(() => { setReviewing(stage === 'review'); return () => setReviewing(false); }, [stage]);
  // A remount (another mode from the palette) or an unmount drops the progress that would clear it; the job goes on.
  useEffect(() => () => setBusy(false), []);
  const [items, setItems] = useState([]);
  const [prepared, setPrepared] = useState(false);
  const [job, setJob] = useState(null);
  const cancelled = useRef(false), current = useRef(null);
  const patch = (key, p) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...(typeof p === 'function' ? p(i) : p) } : i)));

  const prepare = async (form, adviser) => {
    cancelled.current = false;
    const list = [...(form.global ? [{ key: 'global', title: 'Global setup', status: 'waiting' }] : []), ...form.picked.map((path) => ({ key: path, title: base(path), path, status: 'waiting' }))];
    setItems(list);
    setStage('prepare'); setBusy(true); setPrepared(false);
    for (const it of list) {
      if (cancelled.current) { patch(it.key, { status: 'cancelled' }); continue; }
      patch(it.key, { status: 'running', detail: it.key === 'global' ? 'building the plan' : 'reading the setup choices' });
      try {
        if (it.key === 'global') await prepareGlobal(patch, form.level);
        else await prepareProject(it, adviser, patch);
      } catch (e) { patch(it.key, { status: 'failed', detail: e.message }); }
    }
    current.current = null;
    setBusy(false); setPrepared(true);
    if (!cancelled.current) setStage('review');
  };
  const prepareGlobal = async (patchItem, level) => {
    const plan = await api(`/api/global-plan?level=${level}`);
    patchItem('global', { status: 'ready', detail: `${plan.changes.length} changes`, plan, include: true, select: defaultSelect(plan) });
  };
  const prepareProject = async (it, adviser, patchItem) => {
    const setup = await api(`/api/project-setup?dir=${encodeURIComponent(it.path)}`);
    let advice = null, note = null;
    if (!setup.state && adviser) {
      patchItem(it.key, { detail: `${adviser.name} is reading the repository` });
      const r = await api('/api/setup-advice', { dir: it.path, agent: adviser.id });
      current.current = r.job;
      const s = await waitJob(r.job);
      if (s.error === 'cancelled' || cancelled.current) { patchItem(it.key, { status: 'cancelled', detail: undefined }); return; }
      if (s.error) note = `no suggestion (${s.error}), the defaults are used`; else advice = { ...s.results, name: adviser.name };
    }
    patchItem(it.key, { detail: 'building the plan' });
    const answers = initialAnswers(setup, advice);
    const plan = await projectPlanOf(it.path, answers);
    patchItem(it.key, { status: 'ready', detail: note ?? `${plan.changes.length} changes`, note, setup, advice, answers, builtFor: JSON.stringify(answers), plan, include: true, select: defaultSelect(plan) });
  };
  const cancel = () => {
    cancelled.current = true;
    if (current.current) api('/api/job-cancel', { id: current.current }).catch(() => {});
    setItems((list) => list.map((i) => (i.status === 'waiting' ? { ...i, status: 'cancelled' } : i)));
  };
  const startOver = () => { setStage('start'); setItems([]); };

  if (stage === 'start') return <Start mode={mode} onStart={prepare} />;
  if (stage === 'prepare') return <Prepare items={items} prepared={prepared} onCancel={cancel} onReview={() => setStage('review')} onStartOver={startOver} />;
  if (stage === 'review') return <Review items={items} patch={patch} onStartOver={startOver} onApply={(r) => { setJob(r); setBusy(true); setStage('apply'); }} />;
  return <ApplyProgress job={job.job} total={job.total} onDone={() => setBusy(false)} />;
}

function Start({ mode, onStart }) {
  const data = useApi('/api/one-run');
  const [form, setForm] = useState(null);
  const [ask, setAsk] = useState(false);
  useEffect(() => {
    if (!data.data || form) return;
    const open = data.data.projects.filter((p) => !p.blocked);
    setForm({ global: mode !== 'projects', level: data.data.level, picked: mode === 'everything' ? open.map((p) => p.path) : mode === 'projects' ? open.filter((p) => p.state !== 'current').map((p) => p.path) : [] });
  }, [data.data]);
  return (
    <Loading state={data} label="projects">{(d) => (!form ? null : (
      <Stack gap="md">
        <Text size="sm">{MODES[mode]}</Text>
        <Checkbox label="Global setup" description="Rules, settings, plugins and skills for the installed agents" checked={form.global} onChange={(e) => setForm({ ...form, global: e.currentTarget.checked })} />
        {form.global && <NativeSelect label="Level" data={LEVEL_OPTIONS} value={form.level} onChange={(e) => setForm({ ...form, level: e.currentTarget.value })} />}
        {d.projects.length ? (
          <Checkbox.Group label="Projects" value={form.picked} onChange={(picked) => setForm({ ...form, picked })}>
            <Stack gap="xs" mt="xs">
              {d.projects.map((p) => (
                <Checkbox key={p.path} value={p.path} disabled={!!p.blocked} label={base(p.path)}
                  description={[p.path, p.state === 'none' ? 'no setup yet' : p.state === 'behind' ? `setup ${p.setupVersion}, behind` : 'current', p.blocked && `left to Update all: ${p.blocked}`].filter(Boolean).join(', ')} />
              ))}
            </Stack>
          </Checkbox.Group>
        ) : <Text size="sm">No project is registered yet; add one in Projects.</Text>}
        {!d.agents.length && <Note color="yellow">No agent is installed on this machine.</Note>}
        <Group>
          <Button leftSection={icon(IconPlayerPlay)} disabled={!form.global && !form.picked.length} onClick={() => (form.picked.some((p) => d.projects.find((x) => x.path === p).state === 'none') && d.advisers.length ? setAsk(true) : onStart(form, null))}>Start</Button>
        </Group>
        <AdviceConsent opened={ask} onClose={() => setAsk(false)} advisers={d.advisers} count={form.picked.filter((p) => d.projects.find((x) => x.path === p).state === 'none').length}
          onStart={(id, name) => { setAsk(false); onStart(form, { id, name }); }} />
      </Stack>
    ))}</Loading>
  );
}

function Prepare({ items, prepared, onCancel, onReview, onStartOver }) {
  const done = items.filter((i) => FINISHED.includes(i.status)).length;
  const ready = items.filter((i) => i.status === 'ready').length;
  return (
    <Stack gap="sm" component="section" aria-label="Prepare progress">
      <Progress value={items.length ? (done / items.length) * 100 : 100} aria-label="Items prepared" />
      <Text size="sm" role="status">{prepared ? `Cancelled: ${ready} of ${items.length} items are ready.` : `${done} of ${items.length} items prepared`}</Text>
      {!prepared && <Group><Button size="xs" variant="default" onClick={onCancel}>Cancel</Button></Group>}
      <Table aria-label="Items" layout="fixed">
        <Table.Thead><Table.Tr><Table.Th w={124}>Status</Table.Th><Table.Th>Item</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {items.map((i) => (
            <Table.Tr key={i.key}>
              <Table.Td><StatusBadge status={i.status} /></Table.Td>
              <Table.Td style={{ overflowWrap: 'anywhere' }}>{i.title}{i.detail ? `: ${i.detail}` : ''}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {prepared && (
        <Group>
          <Button disabled={!ready} onClick={onReview}>Review what is ready</Button>
          <Button variant="default" onClick={onStartOver}>Start over</Button>
        </Group>
      )}
    </Stack>
  );
}

function Review({ items, patch, onStartOver, onApply }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // A project whose answers changed waits for its new plan: the old one would write what the page no longer shows.
  const stale = items.some((i) => i.answers && i.builtFor !== JSON.stringify(i.answers));
  const sections = items.filter((i) => i.plan && !i.planError && i.include && i.select.length);
  const total = sections.reduce((n, i) => n + i.select.length, 0);
  const apply = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api('/api/apply-all', { sections: sections.map((i) => ({ planId: i.plan.planId, select: i.select })), confirmDestructive: sections.some((i) => confirms(i.plan, i.select).confirmDestructive) });
      onApply(r);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <Stack gap="lg">
      <Text size="sm">Nothing is written yet. Uncheck what you do not want, open a diff to read it, and change a project's answers in place.</Text>
      {items.map((i) => <ReviewSection key={i.key} item={i} patch={patch} />)}
      {error && <Note color="red" title="Apply failed">{error}</Note>}
      <Group justify="space-between">
        <Button variant="default" onClick={onStartOver}>Start over</Button>
        <Button leftSection={icon(IconPlayerPlay)} loading={busy} disabled={!sections.length || stale} onClick={apply}>Apply {total} changes in {sections.length} sections</Button>
      </Group>
    </Stack>
  );
}

// One section of the review: the global plan or one project, with its checkbox, its changes and (a project) its answers.
function ReviewSection({ item, patch }) {
  const { key, title, path, plan } = item;
  const setSelect = (f) => patch(key, (i) => ({ select: f(i.select) }));
  if (!plan) {
    return (
      <Stack gap={4} component="section" aria-label={title}>
        <Title order={3} size="h5">{title}</Title>
        {path && <Code style={{ wordBreak: 'break-all' }}>{path}</Code>}
        <Note color={item.status === 'cancelled' ? 'yellow' : 'red'} title={item.status === 'cancelled' ? 'Cancelled' : 'No plan'}>{item.status === 'cancelled' ? 'Not prepared.' : item.detail ?? 'Not prepared.'}</Note>
      </Stack>
    );
  }
  return (
    <Stack gap="sm" component="section" aria-label={title}>
      <Checkbox checked={item.include && !item.planError} disabled={!!item.planError} onChange={(e) => patch(key, { include: e.currentTarget.checked })} label={<Text fw={600}>{title}</Text>}
        description={[path, `${item.select.length} of ${plan.changes.length} changes checked`].filter(Boolean).join(', ')} />
      {item.note && <Note color="yellow">{item.note}</Note>}
      {item.advice && <Text size="sm">Suggested by {item.advice.name}: {[item.advice.env && `environment ${item.advice.env.id}`, ...item.advice.packs.map((p) => `pack ${p.id}`), ...item.advice.skills.map((k) => `skill ${k.name}`)].filter(Boolean).join(', ') || 'nothing from the library fits'}.</Text>}
      {item.setup && <Answers item={item} patch={patch} />}
      {item.planError && <Note color="red" title="No plan for these answers">{item.planError}</Note>}
      {plan.warnings?.map((w) => <Note key={w} color="yellow">{w}</Note>)}
      <PlanBody plan={plan} select={item.select} setSelect={setSelect} />
    </Stack>
  );
}

// Changes as ChangeList shows them, with each diff behind a button and its skill installs rehearsed.
function PlanBody({ plan, select, setSelect }) {
  const prerun = usePrerun(plan);
  return <ChangeList plan={plan} select={select} setSelect={setSelect} prerun={prerun} collapsed />;
}

// A project's answers, editable in place: an edit builds that project's plan again, with its changes checked as by default.
function Answers({ item, patch }) {
  const { key, path, setup, answers } = item;
  const [open, setOpen] = useState(false);
  const now = JSON.stringify(answers);
  const busy = item.builtFor !== now;
  useEffect(() => {
    if (item.builtFor === now) return undefined;
    let live = true;
    projectPlanOf(path, answers).then((plan) => live && patch(key, { plan, builtFor: now, select: defaultSelect(plan), planError: null }), (e) => live && patch(key, { builtFor: now, planError: e.message }));
    return () => { live = false; };
  }, [now]);
  const set = (k) => (v) => patch(key, (i) => ({ answers: { ...i.answers, [k]: v } }));
  const names = Object.fromEntries(setup.agents.map((x) => [x.id, x.name]));
  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Text size="sm">Answers: {answers.agents.map((a) => names[a] ?? a).join(', ') || 'no agent'}; {ENV_TITLE[answers.env]?.replace(/ \(recommended\)$/, '') ?? answers.env}; {answers.packs.length ? `packs ${answers.packs.join(', ')}` : 'no pack'}; {answers.tier ? `tier ${answers.tier}` : 'no default tier'}</Text>
        <Button size="compact-xs" variant="default" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Edit'} answers of ${item.title}`} onClick={() => setOpen(!open)}>{open ? 'Hide answers' : 'Edit answers'}</Button>
        {busy && <Text size="sm" role="status">Building the plan again</Text>}
      </Group>
      {open && (
        <Stack gap="sm">
          <Checkbox.Group label="Agents" value={answers.agents} onChange={set('agents')}>
            <Group mt="xs">{setup.agents.map((x) => <Checkbox key={x.id} value={x.id} label={x.name} />)}</Group>
          </Checkbox.Group>
          <NativeSelect label="Where the agent and the project's commands run" value={answers.env} onChange={(e) => set('env')(e.currentTarget.value)}
            data={Object.keys(setup.envs).map((id) => ({ value: id, label: ENV_TITLE[id] ?? id }))} />
          <Checkbox.Group label="Packs" value={answers.packs} onChange={set('packs')}>
            <Group mt="xs">{setup.packs.map((x) => <Checkbox key={x.id} value={x.id} label={x.title} />)}</Group>
          </Checkbox.Group>
          <NativeSelect label="Default tier in AGENTS.md" value={answers.tier} onChange={(e) => set('tier')(e.currentTarget.value)}
            data={['', ...setup.tiers].map((t) => ({ value: t, label: TIER_TEXT[t] ?? t }))} />
        </Stack>
      )}
    </Stack>
  );
}

// The apply job: a line per section with its changes done, the reason when it failed, a link to its run for undo.
export function ApplyProgress({ job, total, onDone }) {
  const state = useJob(job, onDone);
  const sections = state?.sections ?? [];
  const done = (s) => s.run?.entries.filter((e) => e.status && e.status !== 'running').length ?? 0;
  const finished = sections.filter((s) => !['waiting', 'running'].includes(s.status)).length;
  const fraction = sections.reduce((n, s) => n + (['waiting'].includes(s.status) ? 0 : s.status === 'running' ? (s.total ? done(s) / s.total : 0) : 1), 0);
  const failed = sections.some((s) => s.status === 'failed');
  return (
    <Stack gap="sm" component="section" aria-label="Apply progress">
      <Progress value={total ? (fraction / total) * 100 : 100} aria-label="Sections done" color={failed ? 'red' : 'teal'} />
      <Text role="status">{state?.done ? `Finished: ${sections.filter((s) => s.status === 'done').length} of ${total} sections done${failed ? `, ${sections.filter((s) => s.status === 'failed').length} failed` : ''}${state.cancelled ? ', cancelled' : ''}` : `${finished} of ${total} sections done`}</Text>
      <CancelJob job={job} state={state} what="the remaining changes" />
      {state?.error && <Note color="red" title="Apply failed">{state.error}</Note>}
      <Table aria-label="Sections" layout="fixed">
        <Table.Thead><Table.Tr><Table.Th w={124}>Status</Table.Th><Table.Th>Section</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {sections.map((s) => {
            const running = s.status === 'running' && s.run?.entries.find((e) => e.status === 'running');
            return (
              <Table.Tr key={s.scope}>
                <Table.Td><StatusBadge status={s.status} /></Table.Td>
                <Table.Td style={{ overflowWrap: 'anywhere' }}>
                  {s.title}: {done(s)} of {s.total} changes{running ? `, running ${running.title}` : ''}{s.error ? `. ${s.error}` : ''}
                  {s.run && <> <Anchor href={href('history', { run: s.run.id })} underline="always">Open report</Anchor></>}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
