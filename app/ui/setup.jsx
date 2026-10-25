import { Anchor, Badge, Button, Checkbox, Code, Drawer, Group, List, Loader, Modal, MultiSelect, Paper, Radio, Stack, Stepper, Switch, Text, Title } from '@mantine/core';
import { IconBulb, IconPlayerPlay } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { FrameworkChoice } from './frameworks.jsx';
import { CancelJob, ChangeList, useJob, usePrerun } from './parts.jsx';
import { RunPanel } from './run.jsx';
import { Dot, Loading, Note, icon, useApi } from './shell.jsx';

export const TIER_TEXT = { '': 'No default: each task picks its tier', quick: 'Quick: the diff fits in one sentence', standard: 'Standard: one behavior, approach clear', full: 'Full: several behaviors or a new capability', research: 'Research: questions and spikes, no repository change' };
export const ENV_TITLE = { container: 'Agent in the dev container (recommended)', 'host-agent': 'Agent on the host, toolchain in the dev container', sandbox: 'Docker Sandboxes microVM', host: 'Everything on the host' };

// The query of a project plan for these first-setup answers.
export const planQuery = (dir, a) => {
  const q = new URLSearchParams({ dir, setup: '1', agents: a.agents.join(','), env: a.env, sandbox: a.sandbox ? '1' : '0', share: a.share ? '1' : '0' });
  for (const p of a.packs) q.append('pack', p);
  for (const s of a.skills) q.append('skill', s);
  // Named whenever the answers have them (an empty choice takes the frameworks of a saved setup out); the one-run form has none.
  if (a.frameworks) { q.set('framework', a.frameworks.join(',')); q.set('agent-file', (a.agentFiles ?? []).join(',')); }
  q.set('tier', a.tier);
  return q;
};

// Asks before agent sessions start: count read-only sessions, one after the other, on the chosen agent's login.
export function AdviceConsent({ opened, onClose, advisers, count = 1, onStart }) {
  // The advisers may load after the dialog mounts: the first one until the user picks.
  const [picked, setAgent] = useState(null);
  const agent = picked ?? advisers[0]?.id ?? null;
  const name = advisers.find((x) => x.id === agent)?.name ?? agent;
  const title = count > 1 ? `Start ${count} agent sessions?` : 'Start an agent session?';
  return (
    <Modal opened={opened} onClose={onClose} withCloseButton={false} attributes={{ content: { 'aria-label': title } }}>
      <Stack gap="sm">
        <Title order={2} size="h4">{title}</Title>
        {advisers.length > 1 && (
          <Radio.Group label="Agent" value={agent} onChange={setAgent}>
            <Group mt="xs">{advisers.map((x) => <Radio key={x.id} value={x.id} label={x.name} />)}</Group>
          </Radio.Group>
        )}
        <Text size="sm">{count > 1 ? `${name} reads each of the ${count} repositories` : `${name} reads this repository`} and suggests the environment, packs and skills. You review them in these steps before anything is written.</Text>
        <List size="sm">
          <List.Item>Read only: {agent === 'codex' ? 'Codex in its read-only sandbox' : 'Claude Code in restricted mode with read tools only, without the project\'s hooks and MCP servers'}.</List.Item>
          <List.Item>{count > 1 ? `${count} sessions, one after the other,` : 'One session'} on your {name} login and its usage limits, usually a minute or two each.</List.Item>
        </List>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button leftSection={icon(IconPlayerPlay)} onClick={() => onStart(agent, name)}>Start {name}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// An agent suggests env, packs and skills: it starts only after the user agreed to the session in the dialog.
function AgentAdvice({ dir, advisers, onAdvice }) {
  const [open, setOpen] = useState(false);
  const [job, setJob] = useState(null);
  const [name, setName] = useState(null);
  const [error, setError] = useState(null);
  const begin = async (agent, agentName) => {
    setOpen(false); setError(null); setName(agentName);
    try { setJob((await api('/api/setup-advice', { dir, agent })).job); } catch (e) { setError(e.message); }
  };
  if (!advisers.length) return null;
  return (
    <Stack gap="xs" mb="md">
      <Group><Button leftSection={icon(IconBulb)} variant="default" disabled={!!job} onClick={() => setOpen(true)}>Suggest with an agent</Button></Group>
      {job && <AdviceJob job={job} name={name} onDone={(s) => { setJob(null); if (s.error === 'cancelled') return; if (s.error) setError(s.error); else onAdvice(s.results, name); }} />}
      {error && <Note color="red" title="No suggestion">{error}</Note>}
      <AdviceConsent opened={open} onClose={() => setOpen(false)} advisers={advisers} onStart={begin} />
    </Stack>
  );
}

export function AdviceJob({ job, name, onDone }) {
  const state = useJob(job, onDone);
  return (
    <Group gap="sm">
      <Group gap="xs" role="status"><Loader size="xs" /><Text size="sm">{name} is reading the repository</Text></Group>
      <CancelJob job={job} state={state} what="session" />
    </Group>
  );
}

// A plan shown for review only; its skill installs can be rehearsed on a click.
const Rehearsed = ({ plan }) => <ChangeList plan={plan} prerun={usePrerun(plan)} />;

// Every answer next to its step, each with a way back to change it.
function Answers({ rows, onChange }) {
  return (
    <List listStyleType="none" spacing="xs" aria-label="Your answers">
      {rows.map(({ label, value, step }) => (
        <List.Item key={label} styles={{ itemWrapper: { width: '100%' }, itemLabel: { width: '100%' } }}>
          <Group gap="xs" align="baseline" justify="space-between">
            <Text size="sm" style={{ overflowWrap: 'anywhere', flex: 1, minWidth: 0 }}><Text span fw={600}>{label}:</Text> {value}</Text>
            <Anchor component="button" type="button" size="sm" aria-label={`Change ${label}`} onClick={() => onChange(step)}>Change</Anchor>
          </Group>
        </List.Item>
      ))}
    </List>
  );
}

// One project's setup, step by step: agents, where commands run, packs and skills, tier, summary. Local (the default):
// written in the checkout, in files git ignores. Shared: a branch with one commit (and a pull request when origin is on
// GitHub), as Update all makes them.
function SetupSteps({ dir, push, onFinish, prefill }) {
  const setup = useApi(`/api/project-setup?dir=${encodeURIComponent(dir)}`);
  const [a, setA] = useState(null);
  const [step, setStepTo] = useState(0);
  // Set by Change on the summary: Next then returns to the summary instead of the following step.
  const [fromSummary, setFromSummary] = useState(false);
  const setStep = (n) => { setFromSummary(false); setStepTo(n); };
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [advice, setAdvice] = useState(null);
  useEffect(() => {
    if (!setup.data || a) return;
    // A project set up before starts from its state file, so only what the user changes is cleaned up.
    const st = setup.data.state;
    setA(st ? { agents: st.agents ?? [], env: st.env ?? 'container', sandbox: !!st.sandbox, packs: st.packs ?? [], skills: st.singles ?? [], frameworks: st.frameworks ?? [], agentFiles: st.agentFiles ?? [], tier: st.tier ?? '', share: st.share === true }
      : { agents: setup.data.agents.map((x) => x.id), env: setup.data.suggested.env?.id ?? 'container', sandbox: false, packs: setup.data.suggested.packs.map((p) => p.id), skills: [], frameworks: [], agentFiles: [], tier: '', share: false });
  }, [setup.data]);
  // An environment the user chose is kept: a suggestion fills it only while it still has its starting value.
  const envTouched = useRef(false);
  const applyAdvice = (r, name, prefilled = false) => {
    setAdvice({ ...r, name, prefilled, keptEnv: envTouched.current && !!r.env && r.env.id !== a.env });
    setA((x) => ({ ...x, env: envTouched.current ? x.env : r.env?.id ?? x.env, packs: r.packs.length || r.skills.length ? r.packs.map((p) => p.id) : x.packs, skills: r.packs.length || r.skills.length ? r.skills.map((k) => k.name) : x.skills }));
  };
  // A batch suggestion fills the form once, when it is ready and the form still has its starting values; after an
  // edit it waits as a note with Use it, so the user's choices stay.
  const filled = useRef(false), start = useRef(null);
  const [waiting, setWaiting] = useState(null);
  useEffect(() => {
    if (!a) return;
    start.current ??= JSON.stringify(a);
    if (!prefill || filled.current) return;
    filled.current = true;
    if (JSON.stringify(a) === start.current) applyAdvice(prefill.result, prefill.name, true);
    else setWaiting(prefill);
  }, [prefill, a]);
  const review = useApi(step === 4 && a ? `/api/project-plan?${planQuery(dir, a)}` : null);
  const set = (k) => (v) => setA((x) => ({ ...x, [k]: v }));
  const create = async () => {
    setBusy(true); setError(null);
    try { setResult((await api('/api/update-all', { paths: [dir], push, answers: { [dir]: a } }))[0]); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <Loading state={setup} label="setup choices">{(s) => (!a ? null : (
      <Stack gap="md">
        {advice?.prefilled && <Note color="blue">Prefilled from {advice.name}'s suggestion: environment, packs and skills. Review each step before you apply.</Note>}
        {waiting && (
          <Note color="blue">
            {waiting.name}'s suggestion is ready; your changes are kept.{' '}
            <Button size="xs" variant="default" onClick={() => { applyAdvice(waiting.result, waiting.name, true); setWaiting(null); }}>Use it</Button>
          </Note>
        )}
        <Stepper active={step} onStepClick={result ? undefined : setStep} size="sm" allowNextStepsSelect={false}>
          <Stepper.Step label="Agents">
            <Checkbox.Group label="Agents that work in this project" value={a.agents} onChange={set('agents')}>
              <Stack gap={4} mt="xs">
                {s.agents.map((x) => <Checkbox key={x.id} value={x.id} label={x.name} />)}
                {(s.state?.agents ?? []).filter((id) => !s.agents.some((x) => x.id === id)).map((id) => <Checkbox key={id} value={id} label={`${id} (not installed here)`} />)}
              </Stack>
            </Checkbox.Group>
            {!s.agents.length && <Note color="yellow" mt="sm">No agent is installed on this machine.</Note>}
            <Radio.Group mt="md" label="Where the setup lives" value={a.share ? 'share' : 'local'} onChange={(v) => set('share')(v === 'share')}>
              <Stack gap="xs" mt="xs">
                <Radio value="local" label="On this machine (recommended)" description="CLAUDE.local.md, AGENTS.override.md and the skills, in this checkout; git ignores them, so nothing lands in the repository." />
                <Radio value="share" label="In the repository, as a pull request" description="The AGENTS.md block, CLAUDE.md and the skills on a branch with one commit, for everyone who clones it." />
              </Stack>
            </Radio.Group>
          </Stepper.Step>
          <Stepper.Step label="Environment">
            <Radio.Group label="Where the agent and the project's commands run" value={a.env} onChange={(v) => { envTouched.current = true; set('env')(v); }}>
              <Stack gap="xs" mt="xs">
                {Object.entries(s.envs).map(([id, text]) => <Radio key={id} value={id} label={ENV_TITLE[id] ?? id} description={text ?? 'No instructions in AGENTS.md: the agent and all commands run on the host.'} />)}
              </Stack>
            </Radio.Group>
            {s.suggested.devcontainer && <Text size="sm" mt="xs">This project has a <Code>.devcontainer/</Code>.</Text>}
            {s.suggested.env && <Text size="sm" mt="xs">Preselected {ENV_TITLE[s.suggested.env.id] ?? s.suggested.env.id}: {s.suggested.env.reason}.</Text>}
            <Switch mt="md" label="Claude Code sandbox for the agent's commands" checked={a.sandbox} onChange={(e) => set('sandbox')(e.currentTarget.checked)} />
          </Stepper.Step>
          <Stepper.Step label="Skills">
            <AgentAdvice dir={dir} advisers={s.advisers} onAdvice={applyAdvice} />
            {advice && (
              <Note color="blue" mb="md" title={advice.prefilled ? `Prefilled from ${advice.name}'s suggestion` : `Suggested by ${advice.name}`} withCloseButton onClose={() => setAdvice(null)}>
                <List size="sm">
                  {advice.env && <List.Item>Environment {ENV_TITLE[advice.env.id] ?? advice.env.id}: {advice.env.reason}{advice.keptEnv && ' (your choice in the Environment step stays)'}</List.Item>}
                  {advice.packs.map((p) => <List.Item key={p.id}>Pack {p.id}: {p.reason}</List.Item>)}
                  {advice.skills.map((k) => <List.Item key={k.name}>Skill {k.name}: {k.reason}</List.Item>)}
                  {!advice.env && !advice.packs.length && !advice.skills.length && <List.Item>No pack or skill from the library fits; your choices stay.</List.Item>}
                </List>
              </Note>
            )}
            <Checkbox.Group label="Packs" value={a.packs} onChange={set('packs')}>
              <Stack gap="xs" mt="xs">
                {s.packs.filter((p) => !s.frameworks.some((f) => f.pack === p.id)).map((p) => {
                  const hint = s.suggested.packs.find((x) => x.id === p.id);
                  return (
                    <Paper key={p.id} withBorder p="xs">
                      <Checkbox value={p.id} label={<Group gap="xs"><Text fw={600} size="sm">{p.title}</Text>{hint && <Badge variant="default" size="sm">suggested: {hint.reason}</Badge>}</Group>}
                        description={`${p.pickWhen}${p.skills.length ? `. Skills: ${p.skills.join(', ')}` : ''}`} />
                    </Paper>
                  );
                })}
              </Stack>
            </Checkbox.Group>
            <MultiSelect mt="md" label="Single skills besides the packs" searchable value={a.skills} onChange={set('skills')}
              data={s.skills.filter((x) => !s.packs.filter((p) => a.packs.includes(p.id)).some((p) => p.skills.includes(x.name))).map((x) => ({ value: x.name, label: x.name }))} />
            <FrameworkChoice rows={s.frameworks} a={a} set={set} />
          </Stepper.Step>
          <Stepper.Step label="Tier">
            <Radio.Group label="Default tier in AGENTS.md" value={a.tier} onChange={set('tier')}>
              <Stack gap="xs" mt="xs">{['', ...s.tiers].map((t) => <Radio key={t || 'none'} value={t} label={TIER_TEXT[t] ?? t} />)}</Stack>
            </Radio.Group>
          </Stepper.Step>
          <Stepper.Step label="Summary">
            <Stack gap="md">
              <Answers onChange={(n) => { setStepTo(n); setFromSummary(true); }} rows={[
                { label: 'Agents', step: 0, value: a.agents.map((id) => { const x = s.agents.find((y) => y.id === id); return x ? x.name : `${id} (not installed here)`; }).join(', ') || 'None' },
                { label: 'Where the setup lives', step: 0, value: a.share ? 'In the repository, as a pull request' : 'On this machine' },
                { label: 'Environment', step: 1, value: `${(ENV_TITLE[a.env] ?? a.env).replace(/ \(recommended\)$/, '')}${a.sandbox ? ', with the Claude Code sandbox' : ''}` },
                { label: 'Packs and skills', step: 2, value: [...a.packs.filter((id) => !s.frameworks.some((f) => f.pack === id)).map((id) => s.packs.find((p) => p.id === id)?.title ?? id), ...a.skills.filter((k) => !s.packs.some((p) => a.packs.includes(p.id) && p.skills.includes(k)))].join(', ') || 'None' },
                { label: 'Frameworks', step: 2, value: [...s.frameworks.filter((f) => (f.kind === 'pack' ? a.packs.includes(f.pack) : a.frameworks.includes(f.id))).map((f) => f.title), ...(a.agentFiles.length ? [`${a.agentFiles.length} agent files`] : [])].join(', ') || 'None' },
                { label: 'Default tier', step: 3, value: TIER_TEXT[a.tier] ?? a.tier },
              ]} />
              <Loading state={review} label="changes">{(p) => (
                <Stack gap="sm">
                  {p.warnings.map((w) => <Note key={w} color="yellow">{w}</Note>)}
                  <Text size="sm">{a.share ? <>{p.changes.length} changes on branch <Code>chore/agent-setup</Code>, nothing in your working tree.</> : <>{p.changes.length} changes in this checkout, in files git ignores.</>}</Text>
                  <Rehearsed plan={p} />
                  {!!p.prompts.length && (
                    <Stack gap={4}>
                      <Text size="sm" fw={600}>{a.share ? 'After merging, start in the project' : 'Then start in the project'}</Text>
                      {p.prompts.map((x) => <Text key={x.prompt} size="sm"><Code>{x.prompt}</Code> {x.why}</Text>)}
                    </Stack>
                  )}
                </Stack>
              )}</Loading>
            </Stack>
          </Stepper.Step>
          <Stepper.Completed>
            {result && (
              <Note color={result.status === 'stopped' ? 'red' : 'teal'} title={result.status}>
                {result.reason ?? (result.branch ? <>Branch <Code>{result.branch}</Code>{result.pr && <>, pull request <Anchor href={result.pr} target="_blank" rel="noreferrer">{result.pr}</Anchor></>}</> : 'Written in this checkout; git ignores it.')}
              </Note>
            )}
            {result?.run && <RunPanel id={result.run} order={3} />}
            {!result && (a.share ? <Text>Creates branch <Code>chore/agent-setup-&lt;version&gt;</Code> in a worktree with one commit{push ? ', pushes it and opens a pull request when origin is on GitHub' : ''}.</Text>
              : <Text>Writes the setup in this checkout and adds its files to <Code>.git/info/exclude</Code>.</Text>)}
          </Stepper.Completed>
        </Stepper>
        {error && <Note color="red" title="Failed">{error}</Note>}
        {!a.agents.length && step < 5 && <Text size="sm" role="status">Pick at least one agent to continue.</Text>}
        <Group justify="space-between">
          <Button variant="default" disabled={step === 0 || !!result || busy} onClick={() => setStep(step - 1)}>Back</Button>
          {step < 5 && <Button disabled={!a.agents.length || (step === 4 && !review.data)} onClick={() => setStep(fromSummary && step < 4 ? 4 : step + 1)}>{step === 4 ? 'Continue' : fromSummary ? 'Back to summary' : 'Next'}</Button>}
          {step === 5 && !result && <Button loading={busy} onClick={create}>{!a.share ? 'Apply' : push ? 'Create branch and pull request' : 'Create branch'}</Button>}
          {result && <Button onClick={() => onFinish(result)}>Next project</Button>}
        </Group>
      </Stack>
    ))}</Loading>
  );
}

const BATCH_COLOR = { waiting: 'gray', running: 'blue', ready: 'teal', failed: 'red', cancelled: 'gray' };

// Watches one batch suggestion session.
function BatchJob({ job, onDone }) {
  useJob(job, onDone);
  return null;
}

// First setup of one or more projects in a drawer, one after the other; a project can be skipped.
// Prefill all: one read-only suggestion session per project, one at a time; each project's form starts from its
// suggestion once it is ready. Nothing is applied until the user does so per project.
// shortcut: suggestions live in this page's memory, a reload loses them; keep them on the server if that matters.
export function ProjectSetup({ paths, push, onClose, change = false }) {
  const [i, setI] = useState(0);
  const [batch, setBatch] = useState(null);
  const [ask, setAsk] = useState(false);
  const first = useApi(paths.length > 1 && !change ? `/api/project-setup?dir=${encodeURIComponent(paths[0])}` : null);
  const advisers = first.data?.advisers ?? [];
  const dir = paths[i];
  const next = () => (i + 1 < paths.length ? setI(i + 1) : onClose());
  const update = (p, patch) => setBatch((b) => ({ ...b, items: { ...b.items, [p]: { ...b.items[p], ...patch } } }));
  useEffect(() => {
    if (!batch || batch.stopped || Object.values(batch.items).some((x) => x.status === 'running')) return;
    const p = paths.find((x) => batch.items[x].status === 'waiting');
    if (!p) return;
    update(p, { status: 'running' });
    // Cancel pressed while the session was being started: it is cancelled once its id is known.
    api('/api/setup-advice', { dir: p, agent: batch.agent }).then((r) => {
      if (stopped.current) api('/api/job-cancel', { id: r.job }).catch(() => {});
      else update(p, { job: r.job });
    }, (e) => { if (!stopped.current) update(p, { status: 'failed', reason: e.message }); });
  }, [batch]);
  const start = (agent, name) => { stopped.current = false; setAsk(false); setBatch({ agent, name, items: Object.fromEntries(paths.map((p) => [p, { status: 'waiting' }])) }); };
  const stopped = useRef(false);
  const stop = () => {
    stopped.current = true;
    const running = Object.values(batch.items).find((x) => x.status === 'running' && x.job);
    if (running) api('/api/job-cancel', { id: running.job }).catch(() => {});
    setBatch((b) => ({ ...b, stopped: true }));
  };
  const status = (x) => (batch.stopped && ['waiting', 'running'].includes(x.status) ? 'cancelled' : x.status);
  const item = batch?.items[dir];
  return (
    <Drawer opened={!!dir} onClose={onClose} position="right" size="xl" withCloseButton={false} attributes={{ content: { 'aria-label': 'Set up projects' } }}>
      {dir && (
        <Stack gap="md">
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Stack gap={2}>
              <Title order={2} size="h3">{change ? 'Change project setup' : 'Set up project'} {paths.length > 1 ? `${i + 1} of ${paths.length}` : ''}</Title>
              <Code style={{ wordBreak: 'break-all' }}>{dir}</Code>
            </Stack>
            <Group gap="xs" wrap="nowrap">
              {paths.length > 1 && <Button variant="default" onClick={next}>Skip</Button>}
              <Button variant="default" onClick={onClose}>Close</Button>
            </Group>
          </Group>
          {i === 0 && !batch && advisers.length > 0 && (
            <Group>
              <Button leftSection={icon(IconBulb)} variant="default" onClick={() => setAsk(true)}>Prefill all with {advisers.length === 1 ? advisers[0].name : 'an agent'}</Button>
            </Group>
          )}
          {batch && (
            <Stack gap="xs" component="section" aria-label="Suggestions">
              <Group justify="space-between">
                <Text size="sm" fw={600}>Suggestions by {batch.name}</Text>
                {!batch.stopped && Object.values(batch.items).some((x) => ['waiting', 'running'].includes(x.status)) && <Button size="xs" variant="default" onClick={stop}>Cancel suggestions</Button>}
              </Group>
              <List size="sm" listStyleType="none" spacing={4}>
                {paths.map((p) => (
                  <List.Item key={p}>
                    <Group gap="xs" wrap="nowrap">
                      <Badge variant="default" miw="max-content" leftSection={<Dot color={BATCH_COLOR[status(batch.items[p])]} />}>{status(batch.items[p])}</Badge>
                      <Text size="sm" style={{ overflowWrap: 'anywhere' }}>{p.split('/').pop()}{batch.items[p].reason ? `: ${batch.items[p].reason}` : ''}</Text>
                    </Group>
                  </List.Item>
                ))}
              </List>
              {Object.entries(batch.items).filter(([, x]) => x.status === 'running' && x.job).map(([p, x]) => (
                <BatchJob key={x.job} job={x.job} onDone={(s) => update(p, stopped.current ? { status: 'cancelled' } : s.error ? { status: s.error === 'cancelled' ? 'cancelled' : 'failed', reason: s.error === 'cancelled' ? undefined : s.error } : { status: 'ready', result: s.results })} />
              ))}
            </Stack>
          )}
          <AdviceConsent opened={ask} onClose={() => setAsk(false)} advisers={advisers} count={paths.length} onStart={start} />
          <SetupSteps key={dir} dir={dir} push={push} onFinish={next} prefill={item?.status === 'ready' ? { result: item.result, name: batch.name } : null} />
        </Stack>
      )}
    </Drawer>
  );
}
