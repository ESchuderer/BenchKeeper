import { Alert, Anchor, Badge, Button, Checkbox, Code, Drawer, Group, MultiSelect, Paper, Radio, Stack, Stepper, Switch, Text, Title } from '@mantine/core';
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Loading, useApi } from './parts.jsx';

const TIER_TEXT = { '': 'No default: each task picks its tier', quick: 'Quick: the diff fits in one sentence', standard: 'Standard: one behavior, approach clear', full: 'Full: several behaviors or a new capability', research: 'Research: questions and spikes, no repository change' };
const ENV_TITLE = { container: 'Agent in the dev container', 'host-agent': 'Agent on the host, toolchain in the dev container', sandbox: 'Docker Sandboxes microVM', host: 'Everything on the host' };

// The query of a project plan for these first-setup answers.
const planQuery = (dir, a) => {
  const q = new URLSearchParams({ dir, setup: '1', agents: a.agents.join(','), env: a.env, sandbox: a.sandbox ? '1' : '0' });
  for (const p of a.packs) q.append('pack', p);
  for (const s of a.skills) q.append('skill', s);
  if (a.tier) q.set('tier', a.tier);
  return q;
};

// One project's first setup, step by step: agents, where commands run, packs and skills, tier, review, then a branch
// with one commit (and a pull request when origin is on GitHub), as Update all makes them.
function SetupSteps({ dir, push, onFinish }) {
  const setup = useApi(`/api/project-setup?dir=${encodeURIComponent(dir)}`);
  const [a, setA] = useState(null);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (setup.data && !a) setA({ agents: setup.data.agents.map((x) => x.id), env: setup.data.suggested.devcontainer ? 'host-agent' : 'container', sandbox: false, packs: setup.data.suggested.packs.map((p) => p.id), skills: [], tier: '' });
  }, [setup.data]);
  const review = useApi(step === 4 && a ? `/api/project-plan?${planQuery(dir, a)}` : null);
  const set = (k) => (v) => setA((x) => ({ ...x, [k]: v }));
  const create = async () => {
    setBusy(true); setError(null);
    try { setResult((await api('/api/update-all', { paths: [dir], push, answers: { [dir]: { ...a, tier: a.tier || undefined } } }))[0]); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <Loading state={setup} label="setup choices">{(s) => (!a ? null : (
      <Stack gap="md">
        <Stepper active={step} onStepClick={result ? undefined : setStep} size="sm" allowNextStepsSelect={false}>
          <Stepper.Step label="Agents">
            <Checkbox.Group label="Agents that work in this project" value={a.agents} onChange={set('agents')}>
              <Stack gap={4} mt="xs">{s.agents.map((x) => <Checkbox key={x.id} value={x.id} label={x.name} />)}</Stack>
            </Checkbox.Group>
            {!s.agents.length && <Alert color="yellow" mt="sm">No agent is installed on this machine.</Alert>}
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
                {p.warnings.map((w) => <Alert key={w} color="yellow">{w}</Alert>)}
                <Text size="sm">{p.changes.length} changes on branch <Code>chore/agent-setup</Code>, nothing in your working tree.</Text>
                {p.changes.map((c) => (
                  <Stack key={c.id} gap={4}>
                    <Text size="sm" fw={600}>{c.title}</Text>
                    {c.kind === 'command' ? <Code block tabIndex={0}>{`$ ${c.argv.join(' ')}`}</Code> : c.diff ? <Code block tabIndex={0}>{c.diff}</Code> : null}
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
            {result ? (
              <Alert color={result.status === 'stopped' ? 'red' : 'teal'} title={result.status}>
                {result.reason ?? <>Branch <Code>{result.branch}</Code>{result.pr && <>, pull request <Anchor href={result.pr} target="_blank" rel="noreferrer">{result.pr}</Anchor></>}</>}
              </Alert>
            ) : <Text>Creates branch <Code>chore/agent-setup-&lt;version&gt;</Code> in a worktree with one commit{push ? ', pushes it and opens a pull request when origin is on GitHub' : ''}.</Text>}
          </Stepper.Completed>
        </Stepper>
        {error && <Alert color="red" title="Failed">{error}</Alert>}
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
export function ProjectSetup({ paths, push, onClose }) {
  const [i, setI] = useState(0);
  const dir = paths[i];
  const next = () => (i + 1 < paths.length ? setI(i + 1) : onClose());
  return (
    <Drawer opened={!!dir} onClose={onClose} position="right" size="xl" withCloseButton={false} attributes={{ content: { 'aria-label': 'Set up projects' } }}>
      {dir && (
        <Stack gap="md">
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Stack gap={2}>
              <Title order={2} size="h3">Set up project {paths.length > 1 ? `${i + 1} of ${paths.length}` : ''}</Title>
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
