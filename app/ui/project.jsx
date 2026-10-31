// A project's own page (#/projects/<folder>/<tab>): the header with name, health and folder, and one tab per part.
import { Anchor, Button, Code, Group, List, Menu, SimpleGrid, Stack, Tabs, Text, Title } from '@mantine/core';
import { IconAdjustments, IconChevronDown, IconFolderOpen, IconListCheck, IconListNumbers, IconPencil, IconRoute, IconTrash } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { label, lags } from './cards.js';
import { DoctorFindings } from './fix.jsx';
import { Plan, Section } from './parts.jsx';
import { EditProject, HealthBadge, ProjectFacts, Relocate, RemoveFromList, RemoveSetup } from './projects.jsx';
import { RunPanel } from './run.jsx';
import { ProjectSetup } from './setup.jsx';
import { InstallRow, PackSwitches, SkillStates } from './skillstates.jsx';
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
  // Keyed by folder: another project gets fresh form, dialog and Installs state.
  return props.rest[0] ? <ProjectPage key={props.rest[0]} {...props} /> : <ProjectList {...props} />;
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
  const [revealError, setRevealError] = useState(null);
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
              {live && p.setupVersion && !lags(p) && <Button leftSection={icon(IconAdjustments)} onClick={() => setDialog('setup-run')}>Change setup</Button>}
              <Menu position="bottom-end" withinPortal={false} withInitialFocusPlaceholder={false}>
                <Menu.Target><Button variant="default" rightSection={icon(IconChevronDown, 14)}>More</Button></Menu.Target>
                <Menu.Dropdown>
                  {live && <Menu.Item leftSection={icon(IconFolderOpen)} onClick={() => api('/api/reveal', { path: p.path }).then(() => setRevealError(null), (e) => setRevealError(e.message))}>Open folder</Menu.Item>}
                  <Menu.Item leftSection={icon(IconPencil)} onClick={() => setForm('edit')}>Edit name and notes</Menu.Item>
                  <Menu.Item leftSection={icon(IconRoute)} onClick={() => setForm('relocate')}>Relocate</Menu.Item>
                  <Menu.Divider />
                  <Menu.Item c="light-dark(var(--mantine-color-red-9), var(--mantine-color-red-3))" leftSection={icon(IconTrash)} onClick={() => setDialog('list')}>Remove from list</Menu.Item>
                  {live && p.checkout && <Menu.Item c="light-dark(var(--mantine-color-red-9), var(--mantine-color-red-3))" leftSection={icon(IconTrash)} onClick={() => setDialog('setup')}>Remove BenchKeeper setup</Menu.Item>}
                </Menu.Dropdown>
              </Menu>
            </Group>
          </Group>
          {revealError && <Note color="red" title="Open folder failed">{revealError}</Note>}
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
          {dialog === 'setup' && <RemoveSetup paths={[p.path]} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); }} />}
          {dialog === 'setup-run' && <ProjectSetup paths={[p.path]} change={!!p.setupVersion} onClose={() => { setDialog(null); reload(); }} />}
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
          <DoctorFindings state={found} path={`/api/doctor?dir=${encodeURIComponent(p.path)}`} dir={p.path} />
        </Section>
      )}
    </Stack>
  );
}

// The per-project install controls: packs, workflow owner, skills and agent files, one switch each with its scope hint; what
// the global setup makes active here; the plan and its result; the skill states with their actions.
const NO_TOGGLES = { disable: [], enable: [], packOn: [], packOff: [], fileOn: [], fileOff: [] };
function Installs({ project, others, onDone, onSetup }) {
  const [toggles, setToggles] = useState(NO_TOGGLES);
  // The plan reloads with a new id after an apply, so the result lives here.
  const [applied, setApplied] = useState(null);
  const [running, setRunning] = useState(false);
  // An apply on either side reloads the other: the plan's switches and the skill states read the same files.
  const [tick, setTick] = useState(0);
  const q = new URLSearchParams({ dir: project.path });
  for (const [k, name] of [['disable', 'disable'], ['enable', 'enable'], ['packOn', 'pack-on'], ['packOff', 'pack-off'], ['fileOn', 'file-on'], ['fileOff', 'file-off']]) for (const n of toggles[k]) q.append(name, n);
  const plan = useApi(!project.missing && project.setupVersion && !lags(project) ? `/api/project-plan?${q}` : null);
  // The rows stay while the next plan loads, so a switch keeps the keyboard focus; only the plan itself waits for it.
  const shown = useRef(null);
  if (plan.data) shown.current = { path: project.path, data: plan.data };
  const rows = { ...plan, data: plan.data ?? (shown.current?.path === project.path ? shown.current.data : null) };
  // A switch flips from its row, so it waits for the plan; during an apply a new plan would drop the running job's view.
  const locked = plan.loading || running;
  const flip = (s) => setToggles(({ disable, enable, ...rest }) => (s.disabled
    ? { ...rest, disable: disable.filter((x) => x !== s.name), enable: [...enable, s.name] }
    : { ...rest, disable: [...disable, s.name], enable: enable.filter((x) => x !== s.name) }));
  const flipFile = (f) => setToggles(({ fileOn, fileOff, ...rest }) => (f.on
    ? { ...rest, fileOn: fileOn.filter((x) => x !== f.path), fileOff: [...fileOff, f.path] }
    : { ...rest, fileOn: [...fileOn, f.path], fileOff: fileOff.filter((x) => x !== f.path) }));
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
      {applied ? (
        <Section title="Changes">
          <Group justify="space-between"><Button leftSection={icon(IconListCheck)} variant="default" onClick={() => setApplied(null)}>Plan again</Button><Anchor href={projectHref(project.path, 'history', { run: applied.id })}>Open in History</Anchor></Group>
          <RunPanel id={applied.id} output={applied.output} order={3} onChanged={onDone} />
        </Section>
      ) : (
        <Loading state={rows} label="project plan">{(p) => (
          <>
            {/* A global pack this project does not choose shows once, in the global block. */}
            <PackSwitches packs={p.packs.filter((x) => !p.global.packs.some((g) => g.id === x.id))} project={project} others={others} toggles={toggles} setToggles={setToggles} busy={locked} />
            {!!p.chosen.length && (
              <Section title="Skills">
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs">
                  {p.chosen.map((s) => <InstallRow key={s.name} label={s.name} checked={!s.disabled} onChange={() => flip(s)} busy={locked} hint={s.hint} state={s.state}
                    facts={{ summary: s.pickWhen ?? s.name, eli5: 'one instruction file the agent loads when a task fits it', impact: 'off moves it to .benchkeeper/disabled/ when the plan is applied', default: 'on, with its pack or as a single pick', current: s.disabled ? 'off' : 'on' }} />)}
                </SimpleGrid>
              </Section>
            )}
            {!!p.files.length && (
              <Section title="Agent files">
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs">
                  {p.files.map((f) => <InstallRow key={f.path} label={f.name} checked={f.on} onChange={() => flipFile(f)} busy={locked} disabled={!!f.fixed && !f.on} why={f.fixed} hint="only this project" state={f.state}
                    facts={{ summary: f.pickWhen, eli5: 'a description of a helper agent your agent can hand work to', impact: `fetches ${f.name}.md from ${f.source} at a pinned commit into the project's agent folder`, default: 'off', current: f.on ? 'on' : 'off' }} />)}
                </SimpleGrid>
              </Section>
            )}
            <GlobalBlock g={p.global} />
            <Section title="Changes">
              <Loading state={plan} label="project plan">{(fresh) => (
                <>
                  {fresh.warnings.map((w) => <Note key={w} color="yellow">{w}</Note>)}
                  <Plan key={fresh.planId} plan={fresh} why={Object.values(toggles).some((x) => x.length) ? 'You flipped the switches above in Projects.' : undefined} scope="project" onRunning={setRunning} onDone={(run, output) => { if (run) setApplied({ id: run.id, output }); setToggles(NO_TOGGLES); plan.reload(); setTick((n) => n + 1); onDone(); }} />
                </>
              )}</Loading>
            </Section>
          </>
        )}</Loading>
      )}
      <SkillStates key={tick} dir={project.path} refresh={() => { plan.reload(); onDone(); }} />
    </Stack>
  );
}

// What the global setup makes active in this project and the project does not choose itself: read only, changed on the global page.
function GlobalBlock({ g }) {
  return (
    <Section title="Active here from your global setup">
      <List size="sm">
        <List.Item>BenchKeeper plugin: {g.plugin.length ? `on for ${g.plugin.join(', ')}` : "not installed for this project's agents"}</List.Item>
        {g.packs.map((x) => <List.Item key={x.id}>{x.title}: pack for all projects</List.Item>)}
        {g.skills.map((x) => <List.Item key={x.agent}>{x.agent}: <span className="bk-num">{x.count}</span> global skills</List.Item>)}
      </List>
      <Anchor href={href('agents')} size="sm">Change them in Global setup</Anchor>
    </Section>
  );
}
