import { Badge, Button, Code, Group, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconDownload, IconRefresh, IconTrash } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Cli, Plan, PlanClose, PlanDropped, Section, usePlanRunning } from './parts.jsx';
import { Dot, Folded, Loading, Note, icon, useAnnounce, useApi } from './shell.jsx';

const TIER = { generic: 'generic', user: 'private' };
const STATE = { current: ['teal', 'matches the template'], outdated: ['yellow', 'template changed'], modified: ['yellow', 'changed on the runner'], removed: ['red', 'gone from the runner'], unknown: ['gray', 'unknown'] };
const when = (iso) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : 'no time');

function Installed({ i }) {
  const [color, label] = STATE[i.state];
  return (
    <Stack gap={2}>
      <Badge variant="default" miw="max-content" leftSection={<Dot color={color} />}>{label}</Badge>
      {i.changed.length > 0 && <Text size="sm">Changed: {i.changed.join(', ')}</Text>}
      {i.enabled !== null && <Text size="sm">{i.enabled ? 'Enabled' : 'Disabled'}, mode {i.values.mode}</Text>}
      <Code style={{ overflowWrap: 'anywhere' }}>{i.dir}</Code>
      {i.note && <Text size="sm">{i.note}</Text>}
    </Stack>
  );
}

// The last run that was not skipped and the skipped runs after it, when the runner keeps a history.
function LastRun({ runs }) {
  if (!runs) return <Text size="sm">Not read</Text>;
  if (runs.note) return <Text size="sm">{runs.note}</Text>;
  return (
    <Stack gap={2}>
      <Text size="sm">{runs.last ? `${runs.last.status.replaceAll('_', ' ')}, ${when(runs.last.at)}` : 'No run yet'}</Text>
      {runs.skipped > 0 && <Text size="sm">{runs.skipped} skipped {runs.last ? 'since' : ''}</Text>}
    </Stack>
  );
}

// Project and parameter values for one template; an empty field keeps the template's default.
function InstallForm({ a, projects, onPlan, onCancel }) {
  const t = a.template;
  const [dir, setDir] = useState(projects[0]?.path ?? null);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  // Install opened the form below the table: the keyboard continues in its first field.
  const first = useRef(null);
  useEffect(() => { first.current?.focus(); }, []);
  const submit = async () => {
    setBusy(true);
    await onPlan({ op: 'install', id: a.id, dir, values: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '')) });
    setBusy(false);
  };
  return (
    <Stack gap="sm" component="form" onSubmit={(e) => { e.preventDefault(); submit().catch(console.error); }} aria-label={`Install ${t.title}`}>
      <Text size="sm">Installed disabled and in mode {t.mode}: enable it in the runner once a manual run reads right. Schedule <Code>{t.schedule}</Code>, precheck <Code style={{ overflowWrap: 'anywhere' }}>{t.precheck}</Code>.</Text>
      <Select ref={first} label="Project" description="A registered project; the runs start in its folder" data={projects.map((p) => ({ value: p.path, label: p.name ? `${p.name} (${p.path})` : p.path }))} value={dir} onChange={setDir} allowDeselect={false} />
      {Object.entries(t.parameters).map(([k, p]) => (
        <TextInput key={k} label={k} description={`${p.description}${p.default === undefined ? ' Required.' : ''}`} placeholder={p.default} value={values[k] ?? ''}
          onChange={(e) => setValues({ ...values, [k]: e.currentTarget.value })} autoComplete="off" spellCheck={false} />
      ))}
      <Group>
        <Button type="submit" leftSection={icon(IconDownload)} loading={busy} disabled={!dir}>Plan the install</Button>
        <Button variant="default" onClick={onCancel}>Cancel</Button>
      </Group>
    </Stack>
  );
}

// Scheduled agent runs from templates: the generic ones and your private ones, installed on the runner as plans with a
// diff and undo, and compared with the template they came from.
export function Automations({ overview, refresh }) {
  const state = useApi('/api/automations');
  const projects = overview.data?.projects ?? [];
  const [pending, setPending] = useState(null);
  const [running, setRunning, idle, dropped] = usePlanRunning();
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const plan = async (body) => {
    setError(null);
    try { const p = await api('/api/automations-plan', body); if (idle()) { setPending({ plan: p, why: `You asked to ${body.op} this automation in Automations.` }); setForm(null); } } catch (e) { setError(e.message); }
  };
  const done = () => { state.reload(); refresh(); };
  const [checking, setChecking] = useState(false);
  const [found, setFound] = useState(null);
  const [status, announce] = useAnnounce();
  // The server keeps the view for 15 seconds; Check again reads the runner anew.
  const check = () => {
    setChecking(true);
    api('/api/automations?fresh=1').then((d) => d.runner.installed && setFound(d.runner.name), () => {}).finally(() => { setChecking(false); state.reload(); });
  };
  // Check again found the runner and its button is gone: focus goes to the templates once they show.
  useEffect(() => {
    if (found && state.data?.runner.installed) { announce('automations-templates-title', `${found} found`); setFound(null); }
  }, [found, state.data, announce]);
  const intro = <Note>A template is one scheduled agent run: a schedule, a precheck that skips the run when there is nothing to do, and the prompt. Install creates it on the runner, disabled and report only. Update sets it back to the template, remove deletes it with its run history. Each is a plan with a diff and an undo in History.</Note>;
  return (
    <Stack gap="lg">
      {status}
      {error && <Note color="red" title="Not planned">{error}</Note>}
      <Loading state={state} label="automations">
        {(data) => {
          const open = data.automations.find((a) => a.id === form);
          const templates = (
            <Section title="Templates" id="automations-templates">
              {data.automations.length === 0
                ? <Text>No template yet. Put your own in <Code>automations/</Code> of the config folder.</Text>
                : (
                  <Table.ScrollContainer minWidth={760} scrollAreaProps={{ viewportProps: { tabIndex: 0, role: 'region', 'aria-label': 'Automations, scrollable' } }}>
                    <Table aria-label="Automations" verticalSpacing="sm">
                      <Table.Thead><Table.Tr><Table.Th>Automation</Table.Th><Table.Th>Schedule</Table.Th><Table.Th>Installed</Table.Th><Table.Th>Last run</Table.Th><Table.Th>Actions</Table.Th></Table.Tr></Table.Thead>
                      <Table.Tbody>
                        {data.automations.map((a) => {
                          const name = a.template?.title ?? a.installed?.name ?? a.id;
                          return (
                            <Table.Tr key={a.id}>
                              <Table.Td><Stack gap={2}><Text fw={600}>{name}</Text><Text size="sm">{a.id}</Text>{a.template ? <Badge variant="default" miw="max-content">{TIER[a.template.tier]}</Badge> : <Badge variant="default" miw="max-content">template missing</Badge>}</Stack></Table.Td>
                              <Table.Td>{a.template ? <Code>{a.template.schedule || 'on demand'}</Code> : null}</Table.Td>
                              <Table.Td miw={220}>{a.installed ? <Installed i={a.installed} /> : <Text size="sm">Not installed</Text>}</Table.Td>
                              <Table.Td miw={160}>{a.installed ? <LastRun runs={a.installed.runs} /> : null}</Table.Td>
                              <Table.Td miw={220}>
                                <Group gap="xs">
                                  {!a.installed && a.template && <Button size="compact-xs" leftSection={icon(IconDownload)} aria-label={`Install ${name}`} disabled={!data.runner.installed || !a.template.schedule || !a.template.precheck.trim()} onClick={() => setForm(a.id)}>Install</Button>}
                                  {a.installed?.state === 'removed' && a.template && <Button size="compact-xs" leftSection={icon(IconDownload)} aria-label={`Install ${name} again`} disabled={!data.runner.installed} onClick={() => setForm(a.id)}>Install again</Button>}
                                  {a.installed && a.installed.state !== 'removed' && <Button size="compact-xs" variant="default" leftSection={icon(IconRefresh)} aria-label={`Update ${name}`} disabled={!data.runner.installed || !a.template} onClick={() => plan({ op: 'update', id: a.id })}>Update</Button>}
                                  {a.installed && <Button size="compact-xs" variant="default" color="red" leftSection={icon(IconTrash)} aria-label={`Remove ${name}`} disabled={!data.runner.installed} onClick={() => plan({ op: 'remove', id: a.id })}>Remove</Button>}
                                </Group>
                              </Table.Td>
                            </Table.Tr>
                          );
                        })}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                )}
            </Section>
          );
          return (
            <Stack gap="lg">
              {/* Without the runner its one setup step leads; the templates and what they are wait behind Show templates. */}
              {data.runner.installed ? intro : (
                <Note color="yellow" title={`Set up ${data.runner.name}`} styles={{ title: { color: 'var(--mantine-color-text)' } }}>
                  <Stack gap="sm">
                    <Text size="sm">{data.runner.note}. Install, update and remove need its CLI; the templates show without it. A PATH changed after BenchKeeper started counts once BenchKeeper restarts.</Text>
                    <Group><Button size="xs" variant="default" onClick={check} loading={checking || state.loading}>Check again</Button></Group>
                  </Stack>
                </Note>
              )}
              {data.errors.map((e) => <Note color="red" title="Template not loaded" key={e.file}><Code style={{ overflowWrap: 'anywhere' }}>{e.file}</Code>: {e.message}</Note>)}
              {data.runner.installed ? templates : <Folded title="Templates" label={['Show templates', 'Hide templates']} name="templates"><Stack gap="lg">{intro}{templates}</Stack></Folded>}
              {open && (
                <Section title={`Install ${open.template.title}`}>
                  {projects.length
                    ? <InstallForm key={open.id} a={open} projects={projects} onPlan={plan} onCancel={() => setForm(null)} />
                    : <Text>Register a project first: an automation runs in a project folder.</Text>}
                </Section>
              )}
              {pending && (
                <Section title="Changes">
                  <Plan key={pending.plan.planId} plan={pending.plan} why={pending.why} scope="global" onRunning={setRunning} onDone={done} />
                  <PlanDropped dropped={dropped} />
                  <Group><PlanClose running={running} onClose={() => setPending(null)} /></Group>
                </Section>
              )}
            </Stack>
          );
        }}
      </Loading>
      <Cli>{'benchkeeper automations list\nbenchkeeper automations show <id>\nbenchkeeper automations install <id> [--param name=value..] [--project <dir>]\nbenchkeeper automations update|remove|diff <id>\nbenchkeeper automations status'}</Cli>
    </Stack>
  );
}
