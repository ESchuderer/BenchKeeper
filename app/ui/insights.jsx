import { Badge, Button, Code, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { api } from './api.js';
import { fixAction } from './fix.jsx';
import { Cli } from './parts.jsx';
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

// Findings of this machine's setup and sessions. Dismiss and Snooze are kept per finding in the config folder; a finding
// whose evidence changed comes back by itself.
export function Insights() {
  const state = useApi('/api/insights');
  // The server's answer to each click, by finding key: a click does not read the sessions again.
  const [local, setLocal] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const triage = (f, action) => {
    setBusy(f.key); setError(null);
    api('/api/insights-triage', { key: f.key, action }).then((r) => setLocal((l) => ({ ...l, [r.key]: r.triage })), (e) => setError(e.message)).finally(() => setBusy(null));
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
      <Cli>{'benchkeeper insights --json [--project <dir>] [--agents <a,b>]'}</Cli>
    </Stack>
  );
}
