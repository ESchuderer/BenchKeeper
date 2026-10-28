import { Badge, Button, Code, Group, List, Loader, Modal, Paper, Radio, Stack, Text, Title } from '@mantine/core';
import { useRef, useState } from 'react';
import { api } from './api.js';
import { fixAction } from './fix.jsx';
import { CancelJob, Cli, useJob } from './parts.jsx';
import { Dot, Loading, Note, href, useApi } from './shell.jsx';

const SEVERITY_COLOR = { error: 'red', warning: 'yellow', info: 'blue' };
const SHOWN = 10;
const day = (iso) => iso.slice(0, 10);

// The evidence a finding is about, by signal: the unused skills, the failed sessions of a project, or the file or folder of a doctor finding.
function Evidence({ finding: { evidence: e } }) {
  const [all, setAll] = useState(false);
  const items = e.skills ? e.skills.map((s) => `${s.name} (${s.scope})`) : e.sessionIds ?? [e.file ?? e.dir].filter(Boolean);
  if (!items.length) return null;
  const list = all ? items : items.slice(0, SHOWN);
  return (
    <Group gap={6} role="list" aria-label="Evidence">
      {list.map((x) => <Code key={x} role="listitem" style={{ overflowWrap: 'anywhere' }}>{x}</Code>)}
      {items.length > SHOWN && <Button size="compact-xs" variant="subtle" aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${items.length}`}</Button>}
    </Group>
  );
}

function Card({ finding: f, busy, onTriage }) {
  // The doctor's finding shape decides whether the setup can fix it, as in the Dashboard.
  const action = fixAction({ ...f.evidence, message: f.message, fix: f.fix });
  return (
    <Paper component="article" withBorder p="md" aria-labelledby={`finding-${f.key}`}>
      <Stack gap="sm">
        <Group gap="xs">
          <Badge variant="default" leftSection={<Dot color={SEVERITY_COLOR[f.severity]} />}>{f.severity}</Badge>
          <Badge variant="default">{f.signal}</Badge>
        </Group>
        <Title order={3} size="h5" id={`finding-${f.key}`}>{f.message}</Title>
        <Evidence finding={f} />
        {!(action && f.fix.startsWith('benchkeeper ')) && <Text size="sm">{f.fix}</Text>}
        <Group gap="xs">
          {action && <Button component="a" href={action[0]} size="xs">Apply</Button>}
          <Button size="xs" variant="default" disabled={busy} onClick={() => onTriage(f, 'dismiss')}>Dismiss</Button>
          <Button size="xs" variant="default" disabled={busy} onClick={() => onTriage(f, 'snooze')}>Snooze 7 days</Button>
        </Group>
      </Stack>
    </Paper>
  );
}

const costText = (c) => (c?.usd != null ? `$${c.usd.toFixed(4)} (API-equivalent)` : c?.tokens != null ? `${c.tokens.toLocaleString('en-US')} tokens` : 'no cost recorded');

// An agent's summary of the findings shown, with a suggested order. It starts only on a click, after the one-time consent,
// and the exact input is on the page next to the button. The text is read-only model text and cannot act on a finding.
function Narrative({ rev }) {
  const state = useApi(`/api/insights-narrative?rev=${rev}`);
  const [picked, setPicked] = useState(null);
  const [asking, setAsking] = useState(false);
  const [open, setOpen] = useState(false);
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  // A second click before the job exists would start a second request and show its 409 as an error.
  const starting = useRef(false);
  const d = state.data;
  if (!d || !d.count) return null;
  const agent = picked ?? d.advisers[0]?.id ?? null;
  const name = d.advisers.find((x) => x.id === agent)?.name ?? agent;
  const run = async () => {
    if (starting.current) return;
    starting.current = true;
    setAsking(false); setError(null);
    try {
      if (!d.consented) await api('/api/insights-narrative-consent', {});
      setJob((await api('/api/insights-narrative', { agent, id: d.id })).job);
    } catch (e) { setError(e.message); state.reload(); } finally { starting.current = false; }
  };
  return (
    <Paper component="section" withBorder p="md" aria-labelledby="narrative-title">
      <Stack gap="sm">
        <Title order={2} size="h4" id="narrative-title">Adviser narrative</Title>
        {d.narrative && (
          <Stack gap={4}>
            <Group gap="xs"><Badge variant="default">Model text</Badge><Text size="xs">{d.advisers.find((x) => x.id === d.narrative.agent)?.name ?? d.narrative.agent}, {d.narrative.at.slice(0, 10)}, {costText(d.narrative.cost)}</Text></Group>
            <Text style={{ whiteSpace: 'pre-wrap' }}>{d.narrative.text}</Text>
          </Stack>
        )}
        {!d.narrative && !job && <Text size="sm">An agent summarizes the findings below and suggests the order to work through them. It runs only when you start it.</Text>}
        {d.advisers.length ? (
          <>
            <div>
              <Button size="xs" variant="subtle" aria-expanded={open} aria-controls="narrative-input" onClick={() => setOpen(!open)}>Input sent to the agent ({d.size.toLocaleString('en-US')} characters)</Button>
              {open && <Code block id="narrative-input" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{d.prompt}</Code>}
            </div>
            {d.advisers.length > 1 && (
              <Radio.Group label="Agent" value={agent} onChange={setPicked}>
                <Group mt="xs">{d.advisers.map((x) => <Radio key={x.id} value={x.id} label={x.name} />)}</Group>
              </Radio.Group>
            )}
            <Group gap="sm">
              <Button size="xs" disabled={!!job} onClick={() => (d.consented ? run() : setAsking(true))}>{d.narrative ? `Write again with ${name}` : `Write with ${name}`}</Button>
              {job && <NarrativeJob job={job} name={name} onDone={(s) => { setJob(null); if (s.error && s.error !== 'cancelled') setError(s.error); state.reload(); }} />}
            </Group>
          </>
        ) : <Text size="sm">Needs Claude Code or Codex installed.</Text>}
        {error && <Note color="red" title="No narrative">{error}</Note>}
      </Stack>
      <Modal opened={asking} onClose={() => setAsking(false)} withCloseButton={false} attributes={{ content: { 'aria-label': 'Send the findings to an agent?' } }}>
        <Stack gap="sm">
          <Title order={2} size="h4">Send the findings to an agent?</Title>
          <Text size="sm">The narrative starts one session of {name} on your login and its usage limits. It receives the input shown under Input sent to the agent, and nothing else.</Text>
          <List size="sm">
            <List.Item>The findings only: id, signal, severity, the finding's message, counts, the window and sample size, the proposal text. A project by its folder name.</List.Item>
            <List.Item>No session messages, prompts, file contents, skill descriptions or full paths.</List.Item>
            <List.Item>The session has no tools and no project to read. Nothing runs on a schedule or when you open this view; every run is a click, with the input beside it.</List.Item>
            <List.Item>The text is kept on this machine for these findings and dropped when they change. It cannot apply, dismiss or snooze anything.</List.Item>
          </List>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setAsking(false)}>Cancel</Button>
            <Button onClick={run}>Agree and write with {name}</Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
  );
}

function NarrativeJob({ job, name, onDone }) {
  const state = useJob(job, onDone);
  return (
    <Group gap="sm">
      <Group gap="xs" role="status"><Loader size="xs" /><Text size="sm">{name} is writing</Text></Group>
      <CancelJob job={job} state={state} what="session" />
    </Group>
  );
}

// Findings of this machine's setup and sessions. Dismiss and Snooze are kept per finding in the config folder; a finding
// whose evidence changed comes back by itself.
export function Insights() {
  const state = useApi('/api/insights');
  // The server's answer to each click, by finding key: a click does not read the sessions again.
  const [local, setLocal] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  // Counts the saved triage clicks: the narrative covers the findings shown, so it reads its input again after each.
  const [rev, setRev] = useState(0);
  const triage = (f, action) => {
    setBusy(f.key); setError(null);
    api('/api/insights-triage', { key: f.key, action }).then((r) => { setLocal((l) => ({ ...l, [r.key]: r.triage })); setRev((n) => n + 1); }, (e) => setError(e.message)).finally(() => setBusy(null));
  };
  return (
    <Stack gap="lg">
      <Loading state={state} label="insights">
        {({ samples, findings }) => {
          const now = Date.now();
          const current = (f) => { const t = f.key in local ? local[f.key] : f.triage; return t?.state === 'snoozed' && Date.parse(t.until) <= now ? null : t; };
          const shown = findings.filter((f) => !current(f)), hidden = findings.filter((f) => current(f));
          return (
            <>
              {error && <Note color="red" title="Not saved">{error}</Note>}
              {samples.sessions < samples.minSamples && <Text size="sm">{samples.sessions} Claude Code sessions in the last 90 days: the unused-skills signal needs {samples.minSamples}, and friction needs {samples.minSamples} in one project.</Text>}
              <Narrative rev={rev} />
              {shown.length ? shown.map((f) => <Card key={f.key} finding={f} busy={busy === f.key} onTriage={triage} />) : <Text>No findings.</Text>}
              {hidden.length > 0 && (
                <Stack gap="sm" component="section" aria-label="Hidden findings">
                  <div><Button variant="default" size="xs" aria-expanded={hiddenOpen} aria-controls="hidden-findings" onClick={() => setHiddenOpen(!hiddenOpen)}>Hidden ({hidden.length})</Button></div>
                  {hiddenOpen && (
                    <Stack gap="xs" id="hidden-findings">
                      {hidden.map((f) => (
                        <Group key={f.key} gap="sm" justify="space-between" wrap="nowrap" align="flex-start">
                          <Text size="sm">{f.message}<br />{current(f).state === 'dismissed' ? 'Dismissed' : `Snoozed until ${day(current(f).until)}`}</Text>
                          <Button size="xs" variant="default" miw="max-content" disabled={busy === f.key} onClick={() => triage(f, 'reopen')}>Show again</Button>
                        </Group>
                      ))}
                    </Stack>
                  )}
                </Stack>
              )}
            </>
          );
        }}
      </Loading>
      <Cli>{'benchkeeper insights --json [--project <dir>] [--agents <a,b>] [--narrative --agent <claude|codex> [--yes]]'}</Cli>
    </Stack>
  );
}
