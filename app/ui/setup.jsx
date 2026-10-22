import { Anchor, Badge, Button, Checkbox, Code, Drawer, Group, List, Loader, Modal, MultiSelect, Paper, Radio, Stack, Stepper, Switch, Text, Title } from '@mantine/core';
import { IconBulb, IconPlayerPlay } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { CancelJob, useJob } from './parts.jsx';
import { DiffView, RunPanel } from './run.jsx';
import { Loading, Note, icon, useApi } from './shell.jsx';

const TIER_TEXT = { '': 'No default: each task picks its tier', quick: 'Quick: the diff fits in one sentence', standard: 'Standard: one behavior, approach clear', full: 'Full: several behaviors or a new capability', research: 'Research: questions and spikes, no repository change' };
const ENV_TITLE = { container: 'Agent in the dev container (recommended)', 'host-agent': 'Agent on the host, toolchain in the dev container', sandbox: 'Docker Sandboxes microVM', host: 'Everything on the host' };

// The query of a project plan for these first-setup answers.
const planQuery = (dir, a) => {
  const q = new URLSearchParams({ dir, setup: '1', agents: a.agents.join(','), env: a.env, sandbox: a.sandbox ? '1' : '0' });
  for (const p of a.packs) q.append('pack', p);
  for (const s of a.skills) q.append('skill', s);
  q.set('tier', a.tier);
  return q;
};

// An agent suggests env, packs and skills: it starts only after the user agreed to the session in the dialog.
function AgentAdvice({ dir, advisers, onAdvice }) {
  const [open, setOpen] = useState(false);
  const [agent, setAgent] = useState(advisers[0]?.id ?? null);
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const name = advisers.find((x) => x.id === agent)?.name ?? agent;
  const begin = async () => {
    setOpen(false); setError(null);
    try { setJob((await api('/api/setup-advice', { dir, agent })).job); } catch (e) { setError(e.message); }
  };
  if (!advisers.length) return null;
  return (
    <Stack gap="xs" mb="md">
      <Group><Button leftSection={icon(IconBulb)} variant="default" disabled={!!job} onClick={() => setOpen(true)}>Suggest with an agent</Button></Group>
      {job && <AdviceJob job={job} name={name} onDone={(s) => { setJob(null); if (s.error === 'cancelled') return; if (s.error) setError(s.error); else onAdvice(s.results, name); }} />}
      {error && <Note color="red" title="No suggestion">{error}</Note>}
      <Modal opened={open} onClose={() => setOpen(false)} withCloseButton={false} attributes={{ content: { 'aria-label': 'Start an agent session?' } }}>
        <Stack gap="sm">
          <Title order={2} size="h4">Start an agent session?</Title>
          {advisers.length > 1 && (
            <Radio.Group label="Agent" value={agent} onChange={setAgent}>
              <Group mt="xs">{advisers.map((x) => <Radio key={x.id} value={x.id} label={x.name} />)}</Group>
            </Radio.Group>
          )}
          <Text size="sm">{name} reads this repository and suggests the environment, packs and skills. You review them in these steps before anything is written.</Text>
          <List size="sm">
            <List.Item>Read only: {agent === 'codex' ? 'Codex in its read-only sandbox' : 'Claude Code in restricted mode with read tools only, without the project\'s hooks and MCP servers'}.</List.Item>
            <List.Item>One session on your {name} login and its usage limits, usually a minute or two.</List.Item>
          </List>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpen(false)}>Cancel</Button>
            <Button leftSection={icon(IconPlayerPlay)} onClick={begin}>Start {name}</Button>
          </Group>
        </Stack>
      </Modal>
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

// One project's setup, step by step: agents, where commands run, packs and skills, tier, review, then a branch
// with one commit (and a pull request when origin is on GitHub), as Update all makes them.
function SetupSteps({ dir, push, onFinish }) {
  const setup = useApi(`/api/project-setup?dir=${encodeURIComponent(dir)}`);
  const [a, setA] = useState(null);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [advice, setAdvice] = useState(null);
  useEffect(() => {
    if (!setup.data || a) return;
    // A project set up before starts from its state file, so only what the user changes is cleaned up.
    const st = setup.data.state;
    setA(st ? { agents: st.agents ?? [], env: st.env ?? 'container', sandbox: !!st.sandbox, packs: st.packs ?? [], skills: st.singles ?? [], tier: st.tier ?? '' }
      : { agents: setup.data.agents.map((x) => x.id), env: 'container', sandbox: false, packs: setup.data.suggested.packs.map((p) => p.id), skills: [], tier: '' });
  }, [setup.data]);
  const applyAdvice = (r, name) => {
    setAdvice({ ...r, name });
    setA((x) => ({ ...x, env: r.env?.id ?? x.env, packs: r.packs.length || r.skills.length ? r.packs.map((p) => p.id) : x.packs, skills: r.packs.length || r.skills.length ? r.skills.map((k) => k.name) : x.skills }));
  };
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
        <Stepper active={step} onStepClick={result ? undefined : setStep} size="sm" allowNextStepsSelect={false}>
          <Stepper.Step label="Agents">
            <Checkbox.Group label="Agents that work in this project" value={a.agents} onChange={set('agents')}>
              <Stack gap={4} mt="xs">
                {s.agents.map((x) => <Checkbox key={x.id} value={x.id} label={x.name} />)}
                {(s.state?.agents ?? []).filter((id) => !s.agents.some((x) => x.id === id)).map((id) => <Checkbox key={id} value={id} label={`${id} (not installed here)`} />)}
              </Stack>
            </Checkbox.Group>
            {!s.agents.length && <Note color="yellow" mt="sm">No agent is installed on this machine.</Note>}
          </Stepper.Step>
          <Stepper.Step label="Environment">
            <Radio.Group label="Where the agent and the project's commands run" value={a.env} onChange={set('env')}>
              <Stack gap="xs" mt="xs">
                {Object.entries(s.envs).map(([id, text]) => <Radio key={id} value={id} label={ENV_TITLE[id] ?? id} description={text ?? 'No instructions in AGENTS.md: the agent and all commands run on the host.'} />)}
              </Stack>
            </Radio.Group>
            {s.suggested.devcontainer && <Text size="sm" mt="xs">This project has a <Code>.devcontainer/</Code>.</Text>}
            <Switch mt="md" label="Claude Code sandbox for the agent's commands" checked={a.sandbox} onChange={(e) => set('sandbox')(e.currentTarget.checked)} />
          </Stepper.Step>
          <Stepper.Step label="Skills">
            <AgentAdvice dir={dir} advisers={s.advisers} onAdvice={applyAdvice} />
            {advice && (
              <Note color="blue" mb="md" title={`Suggested by ${advice.name}`} withCloseButton onClose={() => setAdvice(null)}>
                <List size="sm">
                  {advice.env && <List.Item>Environment {ENV_TITLE[advice.env.id] ?? advice.env.id}: {advice.env.reason}</List.Item>}
                  {advice.packs.map((p) => <List.Item key={p.id}>Pack {p.id}: {p.reason}</List.Item>)}
                  {advice.skills.map((k) => <List.Item key={k.name}>Skill {k.name}: {k.reason}</List.Item>)}
                  {!advice.env && !advice.packs.length && !advice.skills.length && <List.Item>No pack or skill from the library fits; your choices stay.</List.Item>}
                </List>
              </Note>
            )}
            <Checkbox.Group label="Packs" value={a.packs} onChange={set('packs')}>
              <Stack gap="xs" mt="xs">
                {s.packs.map((p) => {
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
          </Stepper.Step>
          <Stepper.Step label="Tier">
            <Radio.Group label="Default tier in AGENTS.md" value={a.tier} onChange={set('tier')}>
              <Stack gap="xs" mt="xs">{['', ...s.tiers].map((t) => <Radio key={t || 'none'} value={t} label={TIER_TEXT[t] ?? t} />)}</Stack>
            </Radio.Group>
          </Stepper.Step>
          <Stepper.Step label="Review">
            <Loading state={review} label="changes">{(p) => (
              <Stack gap="sm">
                {p.warnings.map((w) => <Note key={w} color="yellow">{w}</Note>)}
                <Text size="sm">{p.changes.length} changes on branch <Code>chore/agent-setup</Code>, nothing in your working tree.</Text>
                {p.changes.map((c) => (
                  <Stack key={c.id} gap={4}>
                    <Text size="sm" fw={600}>{c.title}</Text>
                    {c.kind === 'command' ? <Code block tabIndex={0}>{`$ ${c.argv.join(' ')}`}</Code> : c.diff?.startsWith('copy ') ? <Text size="sm">Copies <Code>{c.diff.slice(5)}</Code></Text> : c.diff ? <DiffView diff={c.diff} path={c.path} /> : null}
                  </Stack>
                ))}
                {!!p.prompts.length && (
                  <Stack gap={4}>
                    <Text size="sm" fw={600}>After merging, start in the project</Text>
                    {p.prompts.map((x) => <Text key={x.prompt} size="sm"><Code>{x.prompt}</Code> {x.why}</Text>)}
                  </Stack>
                )}
              </Stack>
            )}</Loading>
          </Stepper.Step>
          <Stepper.Completed>
            {result && (
              <Note color={result.status === 'stopped' ? 'red' : 'teal'} title={result.status}>
                {result.reason ?? <>Branch <Code>{result.branch}</Code>{result.pr && <>, pull request <Anchor href={result.pr} target="_blank" rel="noreferrer">{result.pr}</Anchor></>}</>}
              </Note>
            )}
            {result?.run && <RunPanel id={result.run} order={3} />}
            {!result && <Text>Creates branch <Code>chore/agent-setup-&lt;version&gt;</Code> in a worktree with one commit{push ? ', pushes it and opens a pull request when origin is on GitHub' : ''}.</Text>}
          </Stepper.Completed>
        </Stepper>
        {error && <Note color="red" title="Failed">{error}</Note>}
        <Group justify="space-between">
          <Button variant="default" disabled={step === 0 || !!result || busy} onClick={() => setStep(step - 1)}>Back</Button>
          {step < 5 && <Button disabled={!a.agents.length || (step === 4 && !review.data)} onClick={() => setStep(step + 1)}>{step === 4 ? 'Continue' : 'Next'}</Button>}
          {step === 5 && !result && <Button loading={busy} onClick={create}>{push ? 'Create branch and pull request' : 'Create branch'}</Button>}
          {result && <Button onClick={() => onFinish(result)}>Next project</Button>}
        </Group>
      </Stack>
    ))}</Loading>
  );
}

// First setup of one or more projects in a drawer, one after the other; a project can be skipped.
export function ProjectSetup({ paths, push, onClose, change = false }) {
  const [i, setI] = useState(0);
  const dir = paths[i];
  const next = () => (i + 1 < paths.length ? setI(i + 1) : onClose());
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
          <SetupSteps key={dir} dir={dir} push={push} onFinish={next} />
        </Stack>
      )}
    </Drawer>
  );
}
