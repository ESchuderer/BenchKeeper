import { Anchor, Badge, Box, Button, Code, Group, List, Loader, Menu, Modal, Paper, Radio, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { splitSource } from './fixsource.js';
import { LEVEL_COLOR, fixAction } from './fix.jsx';
import { levelCounts } from '../src/levels.mjs';
import { CancelJob, Cli, SettingFactsOf, useJob } from './parts.jsx';
import { Dot, Loading, Note, href, icon, useAnnounce, useApi } from './shell.jsx';
import { ActionPlan } from './skillstates.jsx';

const SEVERITIES = [['error', 'Errors'], ['warning', 'Warnings'], ['info', 'Info']];
// Areas in user words, from fields the findings carry: a doctor finding that names settings keys belongs to Agent settings.
const AREAS = ['Setup', 'Agent settings', 'Updates', 'Skills', 'Sessions'];
const areaOf = (f) => (f.settings ? 'Agent settings' : { hygiene: 'Setup', freshness: 'Updates', skills: 'Skills', 'unused-skills': 'Skills', friction: 'Sessions' }[f.signal] ?? 'Setup');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const SHOWN = 10;
const day = (iso) => iso.slice(0, 10);
const TRIAGED = { dismiss: 'Dismissed', snooze: 'Snoozed for 7 days', reopen: 'Shown again' };

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

// A skill proposal opens the plan of its project with the same switches as the project's page; nothing is written before that plan is applied.
const proposal = (f) => f.evidence.action && { dir: f.evidence.dir, title: f.message, params: f.evidence.skills.flatMap((s) => [[f.evidence.action, s.name], ['focus', s.name]]) };

// What the setup can do about a finding: the doctor's finding shape decides whether the setup can fix it, as in the Dashboard.
const fixOf = (f) => ({ action: fixAction({ ...f.evidence, message: f.message, fix: f.fix }), plan: proposal(f), ...splitSource(f.fix) });

function Details({ finding: f, fix: { action, plan, text, source } }) {
  return (
    <>
      {f.settings && <SettingFactsOf settings={f.settings} />}
      <Evidence finding={f} />
      {!((action || plan) && f.fix.startsWith('benchkeeper ')) && <Text size="sm">Fix: {text}</Text>}
      {source && <Anchor href={source} target="_blank" rel="noreferrer" size="sm" title={source} w="fit-content">Documentation</Anchor>}
    </>
  );
}

function FixButtons({ fix: { action, plan }, onPlan }) {
  return (
    <>
      {action && <Button component="a" href={action[0]} size="xs">{action[1]}</Button>}
      {plan && <Button size="xs" onClick={() => onPlan(plan)}>Plan</Button>}
    </>
  );
}

// A path of four or more parts shows its last two in a row's title; the title's hover and the opened row show it in full.
// A folder name may hold spaces; the last part may not, as the words after a path are not part of it.
const PATH = /(?<![\w:/.~-])(?:[~.]|[A-Za-z]:)?(?:[\\/][^\s\\/:,;()'"]+(?: [^\s\\/:,;()'"]+)*(?=[\\/])){3,}[\\/][^\s\\/:,;()'"]+/g;
const shortPaths = (text) => text.replace(PATH, (p) => `\u2026/${p.split(/[\\/]/).slice(-2).join('/')}`);
// Errors are full cards; warnings and info are rows, so the summary names a finding as its card or row does.
const titleOf = (f) => (f.severity === 'error' ? f.message : shortPaths(f.message));

function Card({ finding: f, busy, onTriage, onPlan }) {
  const fix = fixOf(f);
  return (
    <Paper component="article" withBorder p="md" aria-labelledby={`finding-${f.key}`}>
      <Stack gap="sm">
        <Title order={4} size="h5" id={`finding-${f.key}`} tabIndex={-1} style={{ overflowWrap: 'anywhere' }}>{f.message}</Title>
        <Details finding={f} fix={fix} />
        <Group gap="xs">
          <FixButtons fix={fix} onPlan={onPlan} />
          <Group gap="xs" ml="auto">
            <Button size="xs" variant="default" disabled={busy} onClick={() => onTriage(f, 'dismiss')}>Dismiss</Button>
            <Button size="xs" variant="default" disabled={busy} onClick={() => onTriage(f, 'snooze')}>Snooze 7 days</Button>
          </Group>
        </Group>
      </Stack>
    </Paper>
  );
}

// One line: the title opens the evidence and the fix hint, Dismiss and Snooze wait under More. The rows of an area share one surface.
function Row({ finding: f, first, busy, onTriage, onPlan }) {
  const [open, setOpen] = useState(false);
  const fix = fixOf(f), title = shortPaths(f.message);
  return (
    <Box component="article" px="md" py="xs" aria-labelledby={`finding-${f.key}`} style={first ? undefined : { borderTop: '1px solid var(--mantine-color-default-border)' }}>
      <Group gap="xs">
        <Title order={4} size="h6" id={`finding-${f.key}`} tabIndex={-1} style={{ flex: '1 1 16rem', minWidth: 0 }}>
          <UnstyledButton aria-expanded={open} aria-controls={open ? `finding-more-${f.key}` : undefined} title={f.message} onClick={() => setOpen(!open)} fz="inherit" fw="inherit" ta="left" style={{ display: 'flex', gap: 6, alignItems: 'center', overflowWrap: 'anywhere' }}>
            <span style={{ display: 'flex', flexShrink: 0 }}>{icon(open ? IconChevronDown : IconChevronRight)}</span>{title}
          </UnstyledButton>
        </Title>
        <Group gap="xs" ml="auto">
          <FixButtons fix={fix} onPlan={onPlan} />
          <Menu withinPortal={false} position="bottom-end">
            <Menu.Target><Button size="xs" variant="default" disabled={busy}>More</Button></Menu.Target>
            <Menu.Dropdown>
              <Menu.Item disabled={busy} onClick={() => onTriage(f, 'dismiss')}>Dismiss</Menu.Item>
              <Menu.Item disabled={busy} onClick={() => onTriage(f, 'snooze')}>Snooze 7 days</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      {open && (
        <Stack gap="sm" mt="xs" id={`finding-more-${f.key}`}>
          {title !== f.message && <Text size="sm" style={{ overflowWrap: 'anywhere' }}>{f.message}</Text>}
          <Details finding={f} fix={fix} />
        </Stack>
      )}
    </Box>
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
  // A failed read keeps the section, so a narrative kept for these findings is one Try again away.
  if (state.error) return <details><summary><Text component="span" fw={600}>Adviser narrative</Text></summary><Loading state={state} label="adviser narrative" /></details>;
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
  // Opt-in: folded until opened, or open once a narrative was written for these findings.
  return (
    <details open={!!d.narrative}>
      <summary><Text component="span" fw={600}>Adviser narrative</Text></summary>
      <Paper component="section" withBorder p="md" mt="xs" aria-label="Adviser narrative">
        <Stack gap="sm">
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
    </details>
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
  // The finding whose triage is being saved: triage waits across the list, as each click picks its focus target from the list as it is.
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  // Counts the saved triage clicks: the narrative covers the findings shown, so it reads its input again after each.
  const [rev, setRev] = useState(0);
  const [act, setAct] = useState(null);
  const [status, announce] = useAnnounce();
  // The response carries no time: what was checked is dated by this read.
  const at = useMemo(() => new Date(), [state.data]);
  // focus: the id of the element that takes focus once the finding has moved to the other list.
  const triage = (f, action, focus) => {
    setBusy(f.key); setError(null);
    api('/api/insights-triage', { key: f.key, action }).then((r) => { setLocal((l) => ({ ...l, [r.key]: r.triage })); setRev((n) => n + 1); announce(focus, `${TRIAGED[action]}: ${f.message}`); }, (e) => setError(e.message)).finally(() => setBusy(null));
  };
  return (
    <Stack gap="lg">
      <Loading state={state} label="insights">
        {({ samples, findings }) => {
          const now = Date.now();
          const current = (f) => { const t = f.key in local ? local[f.key] : f.triage; return t?.state === 'snoozed' && Date.parse(t.until) <= now ? null : t; };
          const shown = findings.filter((f) => !current(f)), hidden = findings.filter((f) => current(f));
          // Most severe first, then by area; inside an area the server's order.
          const groups = SEVERITIES.map(([sev, label]) => [sev, label, AREAS.map((a) => [a, shown.filter((f) => f.severity === sev && areaOf(f) === a)]).filter(([, l]) => l.length)]).filter(([, , areas]) => areas.length);
          const order = groups.flatMap(([, , areas]) => areas.flatMap(([, l]) => l));
          // After Dismiss or Snooze the next finding's heading of the same severity, else the previous, then the list heading:
          // a heading in another severity group may be folded.
          const next = (f) => { const i = order.indexOf(f), g = [order[i + 1], order[i - 1]].find((x) => x?.severity === f.severity); return g ? `finding-${g.key}` : 'findings-title'; };
          const counts = levelCounts(order, (f) => f.severity).text;
          const goTo = (f) => { const h = document.getElementById(`finding-${f.key}`); h.closest('details').open = true; h.focus(); };
          return (
            <>
              {error && <Note color="red" title="Not saved">{error}</Note>}
              <Text>
                {order.length ? <>{plural(order.length, 'finding')}: {counts}. Do first: <Anchor component="button" fw={600} ta="left" onClick={() => goTo(order[0])}>{titleOf(order[0])}</Anchor></>
                  : hidden.length ? `No findings shown: ${hidden.length} dismissed or snoozed.` : 'No findings.'}
              </Text>
              <Text size="sm">
                Checked at {at.toTimeString().slice(0, 5)}: the doctor's checks of the setup and agent settings, the installed skills, the registered projects and {plural(samples.sessions, 'Claude Code session')} of the last 90 days.
                {samples.sessions < samples.minSamples && ` The session signals need ${samples.minSamples}: unused skills over all sessions, friction in one project.`}
              </Text>
              <Narrative rev={rev} />
              {(groups.length > 0 || hidden.length > 0) && <Title order={2} size="h4" id="findings-title" tabIndex={-1}>Findings</Title>}
              {status}
              {groups.map(([sev, label, areas]) => (
                <details key={sev} open={sev !== 'info'}>
                  <summary><Dot color={LEVEL_COLOR[sev]} /> <Text component="span" fw={600}>{label} ({areas.reduce((n, [, l]) => n + l.length, 0)})</Text></summary>
                  <Stack gap="sm" mt="sm">
                    {areas.map(([area, list]) => (
                      <Stack key={area} gap="sm">
                        <Title order={3} size="h6">{area}</Title>
                        {sev === 'error'
                          ? list.map((f) => <Card key={f.key} finding={f} busy={busy != null} onTriage={(g, a) => triage(g, a, next(g))} onPlan={setAct} />)
                          : <Paper withBorder>{list.map((f, i) => <Row key={f.key} finding={f} first={!i} busy={busy != null} onTriage={(g, a) => triage(g, a, next(g))} onPlan={setAct} />)}</Paper>}
                      </Stack>
                    ))}
                  </Stack>
                </details>
              ))}
              {hidden.length > 0 && (
                <Stack gap="sm" component="section" aria-label="Dismissed and snoozed findings" id="hidden-findings-section" tabIndex={-1}>
                  <div><Button variant="default" size="xs" aria-expanded={hiddenOpen} aria-controls="hidden-findings" onClick={() => setHiddenOpen(!hiddenOpen)}>Dismissed and snoozed ({hidden.length})</Button></div>
                  {hiddenOpen && (
                    <Stack gap="xs" id="hidden-findings">
                      {hidden.map((f) => (
                        <Group key={f.key} gap="sm" justify="space-between" wrap="nowrap" align="flex-start">
                          <Text size="sm">{f.message}<br />{current(f).state === 'dismissed' ? 'Dismissed' : `Snoozed until ${day(current(f).until)}`}</Text>
                          <Button size="xs" variant="default" miw="max-content" disabled={busy != null} onClick={() => triage(f, 'reopen', hidden.length > 1 ? 'hidden-findings-section' : 'findings-title')}>Show again</Button>
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
      <ActionPlan act={act} onClose={() => { setAct(null); state.reload(); }} />
      <Cli>{'benchkeeper insights --json [--project <dir>] [--agents <a,b>] [--narrative --agent <claude|codex> [--yes]]'}</Cli>
    </Stack>
  );
}
