// A project's own page (#/projects/<folder>/<tab>): the header with name, health and folder, and one tab per part.
import { Anchor, Button, Code, Group, List, Stack, Switch, Tabs, Text, Title } from '@mantine/core';
import { IconAdjustments, IconFolderOpen, IconListCheck, IconListNumbers, IconPencil, IconRoute, IconTrash } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { label, lags } from './cards.js';
import { DoctorTable } from './fix.jsx';
import { Plan, Section } from './parts.jsx';
import { EditProject, HealthBadge, ProjectFacts, Relocate, RemoveFromList, RemoveSetup } from './projects.jsx';
import { RunPanel } from './run.jsx';
import { ProjectSetup } from './setup.jsx';
import { PackSwitches } from './skillstates.jsx';
import { AgentSettings } from './agentsettings.jsx';
import { Rules } from './rules.jsx';
import { History, ProjectList, Sessions } from './views.jsx';
import { Loading, Note, go, href, icon, projectHref, useApi } from './shell.jsx';

const TABS = [['overview', 'Overview'], ['installs', 'Installs'], ['sessions', 'Sessions'], ['rules', 'Rules and settings'], ['history', 'History']];

export function Projects(props) {
  const legacy = props.params.get('path');
  // Older links (#/projects?path=...) open the Installs tab; replace keeps Back from landing on the redirect again.
  useEffect(() => { if (legacy) window.location.replace(projectHref(legacy, 'installs')); }, [legacy]);
  if (legacy) return null;
  return props.rest[0] ? <ProjectPage {...props} /> : <ProjectList {...props} />;
}

function ProjectPage({ rest, params, overview, history, refresh }) {
  let path = null;
  try { path = decodeURIComponent(rest[0]); } catch { /* a broken link shows the empty state */ }
  const tab = TABS.some(([t]) => t === rest[1]) ? rest[1] : 'overview';
  const projects = useApi('/api/projects');
  const extra = useApi('/api/project-cards');
  // undefined until the user opens or closes a form: a missing folder starts with Relocate open.
  const [form, setForm] = useState(undefined);
  const [dialog, setDialog] = useState(null);
  const names = Object.fromEntries((overview.data?.agents ?? []).map((a) => [a.id, a.name]));
  const reload = () => { projects.reload(); extra.reload(); refresh(); };
  return (
    <Loading state={projects} label="projects">{(list) => {
      const p = list.find((x) => x.path === path);
      if (!p) return (
        <Stack gap="sm" align="flex-start">
          <Text style={{ overflowWrap: 'anywhere' }}>No registered project at {path ?? 'this address'}.</Text>
          <Anchor href={href('projects')}>Back to Projects</Anchor>
        </Stack>
      );
      const card = extra.data ? extra.data.find((c) => c.path === p.path) ?? null : extra.error ? null : undefined;
      const live = !p.missing;
      const open = form === undefined ? (p.missing ? 'relocate' : null) : form;
      return (
        <Stack gap="lg" component="section" aria-label={`Project ${p.path}`}>
          <Anchor href={href('projects')} size="sm">All projects</Anchor>
          <Group justify="space-between" align="flex-start">
            <Stack gap={2} miw={0}>
              <Group gap="xs"><Title order={3} size="h3" style={{ overflowWrap: 'anywhere' }}>{label(p)}</Title><HealthBadge p={p} card={card} /></Group>
              <Text size="sm" style={{ overflowWrap: 'anywhere' }}>{p.path}</Text>
              {p.notes && <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{p.notes}</Text>}
            </Stack>
            <Group gap="xs">
              {live && <Button leftSection={icon(IconFolderOpen)} variant="default" onClick={() => api('/api/reveal', { path: p.path }).catch(() => {})}>Open folder</Button>}
              <Button leftSection={icon(IconPencil)} variant="default" onClick={() => setForm('edit')}>Edit name and notes</Button>
              <Button leftSection={icon(IconRoute)} variant="default" onClick={() => setForm('relocate')}>Relocate</Button>
              <Button leftSection={icon(IconTrash)} variant="subtle" onClick={() => setDialog('list')}>Remove from list</Button>
              {live && p.checkout && <Button leftSection={icon(IconTrash)} variant="subtle" onClick={() => setDialog('setup')}>Remove BenchKeeper setup</Button>}
            </Group>
          </Group>
          {open === 'edit' && <EditProject project={p} onDone={() => { setForm(null); reload(); }} onClose={() => setForm(null)} />}
          {open === 'relocate' && <Relocate project={p} onDone={() => { setForm(null); go('projects'); reload(); }} onClose={() => setForm(null)} />}
          {p.missing && <Note color="red" title="Folder not found">{p.path} does not exist. Relocate the project when the folder moved or was renamed, or remove it from the list.</Note>}
          <Tabs value={tab} onChange={(t) => { window.location.hash = projectHref(p.path, t); }} keepMounted={false}>
            <Tabs.List aria-label="Project views">{TABS.map(([t, text]) => <Tabs.Tab key={t} value={t}>{text}</Tabs.Tab>)}</Tabs.List>
            <Tabs.Panel value="overview" pt="md"><Overview p={p} card={card} names={names} /></Tabs.Panel>
            <Tabs.Panel value="installs" pt="md"><Installs project={p} others={list} onDone={reload} onSetup={() => setDialog('setup-run')} /></Tabs.Panel>
            <Tabs.Panel value="sessions" pt="md">{live ? <Sessions project={p.path} /> : <Text>The folder is not found: no sessions to read.</Text>}</Tabs.Panel>
            <Tabs.Panel value="rules" pt="md">
              {live ? (
                <Stack gap="xl">
                  <Rules overview={overview} params={new URLSearchParams()} refresh={refresh} project={p.path} />
                  <Title order={2} size="h3">Agent settings</Title>
                  <AgentSettings overview={overview} params={new URLSearchParams()} refresh={refresh} project={p.path} />
                </Stack>
              ) : <Text>The folder is not found: no files to read.</Text>}
            </Tabs.Panel>
            <Tabs.Panel value="history" pt="md">
              <History history={history} params={params} refresh={refresh} only={(r) => r.scope === p.path || r.note?.updateAll === p.path} link={(run) => projectHref(p.path, 'history', { run })} />
            </Tabs.Panel>
          </Tabs>
          {dialog === 'list' && <RemoveFromList paths={[p.path]} onClose={() => setDialog(null)} onDone={() => { setDialog(null); go('projects'); reload(); }} />}
          {dialog === 'setup' && <RemoveSetup paths={[p.path]} push onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); }} />}
          {dialog === 'setup-run' && <ProjectSetup paths={[p.path]} change={!!p.setupVersion} push onClose={() => { setDialog(null); reload(); }} />}
        </Stack>
      );
    }}</Loading>
  );
}

// What the card shows, in full: the facts, the items by state and the doctor's findings.
function Overview({ p, card, names }) {
  const found = useApi(p.missing ? null : `/api/doctor?dir=${encodeURIComponent(p.path)}`);
  const states = Object.entries(card?.states ?? {}).filter(([, n]) => n);
  return (
    <Stack gap="lg">
      <Stack gap="sm">
        <ProjectFacts p={p} card={card} names={names} />
        {!p.setupVersion && !p.missing && <Text size="sm">Not set up yet: the Installs tab sets it up.</Text>}
        {!!states.length && <List size="sm" aria-label="Items by state">{states.map(([s, n]) => <List.Item key={s}><span className="bk-num">{n}</span> {s}</List.Item>)}</List>}
      </Stack>
      {!p.missing && (
        <Section title="Project doctor">
          <Group><Button size="xs" variant="default" onClick={found.reload} loading={found.loading}>Check again</Button></Group>
          <Loading state={found} label="doctor">{(f) => <DoctorTable found={f.map((i) => ({ ...i, dir: p.path }))} />}</Loading>
        </Section>
      )}
    </Stack>
  );
}

// The per-project install controls: pack and skill switches, the plan and its result.
const NO_TOGGLES = { disable: [], enable: [], packOn: [], packOff: [] };
function Installs({ project, others, onDone, onSetup }) {
  const [toggles, setToggles] = useState(NO_TOGGLES);
  // The plan reloads with a new id after an apply, so the result lives here.
  const [applied, setApplied] = useState(null);
  const q = new URLSearchParams({ dir: project.path });
  for (const [k, name] of [['disable', 'disable'], ['enable', 'enable'], ['packOn', 'pack-on'], ['packOff', 'pack-off']]) for (const n of toggles[k]) q.append(name, n);
  const plan = useApi(!project.missing && project.setupVersion && !lags(project) ? `/api/project-plan?${q}` : null);
  const flip = (s) => setToggles(({ disable, enable, ...rest }) => (s.disabled
    ? { ...rest, disable: disable.filter((x) => x !== s.name), enable: [...enable, s.name] }
    : { ...rest, disable: [...disable, s.name], enable: enable.filter((x) => x !== s.name) }));
  if (project.missing) return <Text>The folder is not found: relocate the project first.</Text>;
  if (!project.setupVersion) return (
    <Stack gap="xs" align="flex-start">
      <Text>Not set up yet: no <Code>.benchkeeper/state.json</Code>.</Text>
      <Button leftSection={icon(IconListNumbers)} onClick={onSetup}>Set up this project</Button>
    </Stack>
  );
  if (lags(project)) return <Text>Setup {project.setupVersion} is on <Code>{project.origin}</Code>; this checkout has {project.checkout ? `setup ${project.checkout}` : 'no state file'}. Pull <Code>{project.origin}</Code> to see or change the setup here.</Text>;
  return (
    <Stack gap="lg">
      <Group><Button leftSection={icon(IconAdjustments)} variant="default" onClick={onSetup}>Change setup</Button></Group>
      {applied ? (
        <Section title={`Changes in ${project.path}`}>
          <Group justify="space-between"><Button leftSection={icon(IconListCheck)} variant="default" onClick={() => setApplied(null)}>Plan again</Button><Anchor href={projectHref(project.path, 'history', { run: applied.id })}>Open in History</Anchor></Group>
          <RunPanel id={applied.id} output={applied.output} order={3} onChanged={onDone} />
        </Section>
      ) : (
        <Loading state={plan} label="project plan">{(p) => (
          <>
            <PackSwitches packs={p.packs} project={project} others={others} toggles={toggles} setToggles={setToggles} />
            {!!p.chosen.length && (
              <Section title="Skills">
                {p.chosen.map((s) => <Switch key={s.name} label={s.name} checked={!s.disabled} onChange={() => flip(s)} />)}
                <Text size="sm">A skill turned off moves to <Code>.benchkeeper/disabled/</Code> when the plan is applied.</Text>
              </Section>
            )}
            <Section title={`Changes in ${project.path}`}>
              {p.warnings.map((w) => <Note key={w} color="yellow">{w}</Note>)}
              <Plan key={p.planId} plan={p} onDone={(run, output) => { if (run) setApplied({ id: run.id, output }); setToggles(NO_TOGGLES); plan.reload(); onDone(); }} />
            </Section>
          </>
        )}</Loading>
      )}
    </Stack>
  );
}
