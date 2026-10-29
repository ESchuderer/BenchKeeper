import { Anchor, Badge, Button, Checkbox, Code, Drawer, Group, List, Progress, Stack, Stepper, Table, Text, Title } from '@mantine/core';
import { IconPlayerPlay, IconPlayerStop, IconTool, IconWand } from '@tabler/icons-react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { splitSource } from './fixsource.js';
import { updateProjects } from './update.js';
import { ChangeList, RunProgress, SettingFactsOf, StartBlock, confirms, defaultSelect, usePrerun } from './parts.jsx';
import { Dot, Loading, Note, groupBy, href, icon, useApi } from './shell.jsx';

// Doctor findings the setup can fix open the plan that fixes them; the others keep their fix text only.
export function fixAction(i) {
  if (i.check === 'unexpected') return [href('agents', { plan: '1' }), 'Review removal'];
  if (['rules', 'ask', 'plugin', 'skills', 'settings', 'tools', 'global', 'ponytail'].includes(i.check) && i.fix.startsWith('benchkeeper apply')) return [href('agents', { plan: '1' }), 'Plan fix'];
  if (i.check === 'agent-settings') return [href('agent-settings', { ...(/^Codex/.test(i.message) ? { agent: 'codex' } : {}), ...(i.dir ? { layer: 'project', path: i.dir } : {}) }), 'Open settings'];
  if (i.check === 'project') return [href('projects', i.dir ? { path: i.dir } : {}), 'Plan project'];
  return null;
}

// A fix names its source (fixsource.js) and a finding its run by id: the cell shows the action, the source becomes
// a link, and a run id opens the run in History.
const RUN = /(\d{8}T\d{6}Z-[0-9a-f]{6})/;
const withRuns = (text) => text.split(RUN).map((part, n) => (n % 2 ? <Anchor key={n} href={href('history', { run: part })}>{part}</Anchor> : part));

export function DoctorTable({ found, onAction }) {
  if (!found.length) return <Text>No problems found.</Text>;
  return (
    <Table.ScrollContainer minWidth={560}>
      <Table aria-label="Doctor findings">
        <Table.Thead><Table.Tr><Table.Th w={140}>Level</Table.Th><Table.Th>Problem</Table.Th><Table.Th>Fix</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {found.map((i, n) => {
            const action = fixAction(i), { text, source } = splitSource(i.fix);
            return (
              <Table.Tr key={n}>
                <Table.Td><Badge variant="default" leftSection={<Dot color={i.level === 'error' ? 'red' : 'yellow'} />}>{i.tag ?? i.level}</Badge></Table.Td>
                <Table.Td>{withRuns(i.message)}{i.settings && <SettingFactsOf settings={i.settings} />}</Table.Td>
                <Table.Td>
                  <Stack gap={4} align="flex-start">
                    {action ? <Button component="a" href={action[0]} onClick={onAction} size="xs" variant="default" leftSection={icon(IconTool)}>{action[1]}</Button> : <Text size="sm">{withRuns(text)}</Text>}
                    {source && <Anchor href={source} target="_blank" rel="noreferrer" size="sm" title={source}>Documentation</Anchor>}
                    {i.start && <StartBlock start={i.start} />}
                  </Stack>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

export function UpdateResults({ progress, extra, what = 'Update all' }) {
  const done = progress.filter((r) => !['pending', 'running'].includes(r.status)).length;
  const by = Object.entries(groupBy(progress.slice(0, done), (r) => r.status)).map(([s, rs]) => `${rs.length} ${s}`).join(', ');
  return (
    <>
      <Text size="sm" role="status">{done < progress.length ? `${done} of ${progress.length} projects done${by ? `: ${by}` : ''}` : `${what} finished: ${by}`}</Text>
      <Progress.Root size="lg"><Progress.Section value={(done / progress.length) * 100} aria-label={`${what}: ${done} of ${progress.length} projects`} /></Progress.Root>
      <Table aria-label={`${what} results`}>
        <Table.Thead><Table.Tr><Table.Th>Project</Table.Th><Table.Th>Result</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{progress.map((r) => (
          <Table.Tr key={r.path}>
            <Table.Td><Code>{r.path}</Code></Table.Td>
            <Table.Td>
              {r.status}{r.reason ? `: ${r.reason}` : ''}{r.pr && <> <Anchor href={r.pr} target="_blank" rel="noreferrer">{r.pr}</Anchor></>}{r.run && <> <Anchor href={href('history', { run: r.run })}>Open report</Anchor></>}
              {extra?.(r)}
            </Table.Td>
          </Table.Tr>
        ))}</Table.Tbody>
      </Table>
    </>
  );
}

// Projects Update all can take: set up before, behind this version or with changes pending. A state file that cannot be
// read, no repository, or uncommitted changes where Update all commits (a shared setup, or one still committed): shown,
// not offered, as Update all would stop or skip them.
const offered = (p) => p.error || (p.setupVersion && (!p.current || p.changes?.length));
const blocked = (p) => (p.error ? p.error : !p.repo ? 'no repository' : !p.clean && (p.share || p.committed) ? 'uncommitted changes' : null);

// The global plan, then the projects to update, then what is left to do by hand; Apply runs both at the end.
function FixSteps({ version, doctor, onClose, setBusy }) {
  const global = useApi('/api/global-plan');
  const projects = useApi('/api/projects');
  const [step, setStep] = useState(0);
  const [select, setSelect] = useState(null);
  const [picked, setPicked] = useState([]);
  const [running, setRunning] = useState(false);
  const prerun = usePrerun(global.data);
  useEffect(() => { if (global.data && !select) setSelect(defaultSelect(global.data)); }, [global.data]);
  const manual = (doctor.data ?? []).filter((i) => !fixAction(i)), covered = (doctor.data?.length ?? 0) - manual.length;
  const list = (projects.data ?? []).filter(offered);
  const open = list.filter((p) => !blocked(p)).map((p) => p.path);
  const fresh = (projects.data ?? []).filter((p) => !p.setupVersion && !p.error && !p.missing).length;
  const nothing = !select?.length && !picked.length;
  const branched = list.filter((p) => picked.includes(p.path) && (p.share || p.committed));
  const viaPr = branched.filter((p) => p.github).length, onBranch = branched.length - viaPr, inPlace = picked.length - branched.length;
  return (
    <Stack gap="md">
      <Stepper active={running ? 4 : step} onStepClick={running ? undefined : setStep} size="sm">
        <Stepper.Step label="Global setup">
          <Loading state={global} label="global plan">{(plan) => (
            <Stack gap="sm">
              <Text size="sm">Rules, settings, plugins and skills for the installed agents. Removals stay off until you check them.</Text>
              {select && <ChangeList plan={plan} select={select} setSelect={setSelect} prerun={prerun} />}
            </Stack>
          )}</Loading>
        </Stepper.Step>
        <Stepper.Step label="Projects">
          <Loading state={projects} label="projects">{() => (
            <Stack gap="sm">
              <Text size="sm">A shared setup, or one still committed in the repository, gets a branch and a pull request when origin is on GitHub; after you merge the removal of a committed one and pull, the next Update all writes it locally.</Text>
              {list.length ? (
                <>
                  <Group gap="xs">
                    <Button size="xs" variant="default" disabled={!open.length} onClick={() => setPicked(open)}>Select all</Button>
                    <Button size="xs" variant="default" disabled={!picked.length} onClick={() => setPicked([])}>Select none</Button>
                    <Text size="sm">{picked.length} of {list.length} selected</Text>
                  </Group>
                  <Checkbox.Group value={picked} onChange={setPicked} label="Projects behind or with pending changes">
                    <Stack gap="xs" mt="xs">
                      {list.map((p) => (
                        <Checkbox key={p.path} value={p.path} disabled={!!blocked(p)} label={p.path.split('/').pop()}
                          description={[p.path, p.setupVersion && `setup ${p.setupVersion}${p.current ? '' : `, ${version} available`}`, `${p.changes?.length ?? 0} pending`, p.branch, blocked(p) && `skipped: ${blocked(p)}`].filter(Boolean).join(', ')} />
                      ))}
                    </Stack>
                  </Checkbox.Group>
                </>
              ) : <Text>Every registered project set up before is current.</Text>}
              {fresh > 0 && <Text size="sm">{fresh} registered project{fresh > 1 ? 's have' : ' has'} no setup yet: set {fresh > 1 ? 'them' : 'it'} up step by step in <Anchor href={href('projects')} underline="always" onClick={onClose}>Projects</Anchor>.</Text>}
            </Stack>
          )}</Loading>
        </Stepper.Step>
        <Stepper.Step label="By hand">
          <Stack gap="sm">
            <Text size="sm">Doctor findings the setup cannot fix. They stay until you do what the fix column says.{covered > 0 && ` The ${covered} other finding${covered > 1 ? 's' : ''} the global plan or a project update fixes; whatever is still open shows after the run.`}</Text>
            <Loading state={doctor} label="doctor">{() => <DoctorTable found={manual} />}</Loading>
          </Stack>
        </Stepper.Step>
        <Stepper.Step label="Apply">
          <List spacing={4} aria-label="What Apply does">
            <List.Item>Global setup: {select?.length ? `${select.length} of ${global.data.changes.length} changes` : 'nothing'}</List.Item>
            <List.Item>Projects: {picked.length ? [inPlace && `${inPlace} written in their checkout`, onBranch && `${onBranch} as a branch`, viaPr && `${viaPr} as a branch and pull request`].filter(Boolean).join(', ') : 'none'}</List.Item>
            <List.Item>By hand: {manual.length ? `${manual.length} left to you` : 'nothing'}; the doctor runs again after the run</List.Item>
          </List>
        </Stepper.Step>
        <Stepper.Completed>
          {running && <FixRun plan={global.data} select={select} paths={picked} setBusy={setBusy} onClose={onClose} />}
        </Stepper.Completed>
      </Stepper>
      {!running && (
        <Group justify="space-between">
          <Button variant="default" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</Button>
          {step < 3 ? <Button onClick={() => setStep(step + 1)}>Next</Button>
            : <Button leftSection={icon(IconPlayerPlay)} disabled={nothing} onClick={() => { setRunning(true); setBusy(true); }}>Apply</Button>}
        </Group>
      )}
    </Stack>
  );
}

// The global apply first, then each project in turn: only after a global run that is done, else when the user says so.
// Then the doctor again, for what is still open.
function FixRun({ plan, select, paths, setBusy, onClose }) {
  const [job, setJob] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [stopped, setStopped] = useState(null);
  const [finished, setFinished] = useState(false);
  const [stopAsked, setStopAsked] = useState(false);
  const control = useRef({ stop: false });
  const after = useApi(finished ? '/api/doctor' : null);
  const finish = () => { setFinished(true); setBusy(false); };
  const projects = () => { setStopped(null); setStopAsked(false); control.current.stop = false; (paths.length ? updateProjects(paths, true, setProgress, control.current) : Promise.resolve()).then(finish).catch(console.error); };
  const halt = (why) => { if (paths.length) setStopped(why); finish(); };
  useEffect(() => {
    if (!select?.length) { projects(); return; }
    api('/api/apply', { planId: plan.planId, select, ...confirms(plan, select) }).then(setJob, (e) => { setError(e.message); halt('failed to start'); });
  }, []);
  return (
    <Stack gap="md">
      {error && <Note color="red" title="Global setup failed">{error}</Note>}
      {job && (
        <Stack gap="xs">
          <Title order={3} size="h5">Global setup</Title>
          {/* A cancel during the last change still ends the run done: the job's flag says it was cancelled. */}
          <RunProgress job={job.job} total={job.total} onDone={(run, _, s) => (run?.status === 'done' && !s.cancelled ? projects() : halt(s.cancelled ? 'cancelled' : run?.status ?? 'without a status, see History'))} />
        </Stack>
      )}
      {stopped && (
        <Note color="yellow" title="Projects not updated">
          <Stack gap="xs" align="flex-start">
            <Text size="sm">The global setup {stopped === 'failed to start' ? 'failed to start' : `ended ${stopped}`}, so the {paths.length} checked project{paths.length > 1 ? 's were' : ' was'} left as they are.</Text>
            <Button size="xs" variant="default" onClick={() => { setFinished(false); setBusy(true); projects(); }}>Update the projects anyway</Button>
          </Stack>
        </Note>
      )}
      {progress && (
        <Stack gap="xs">
          <Title order={3} size="h5">Projects</Title>
          <UpdateResults progress={progress} />
          {!finished && (
            <Group>
              <Button size="xs" variant="default" leftSection={icon(IconPlayerStop)} disabled={stopAsked} onClick={() => { control.current.stop = true; setStopAsked(true); }}>{stopAsked ? 'Stopping after this project' : 'Stop after this project'}</Button>
            </Group>
          )}
        </Stack>
      )}
      {finished && (
        <Stack gap="xs">
          <Title order={3} size="h5">Still open</Title>
          <Loading state={after} label="doctor">{(found) => <DoctorTable found={found} onAction={onClose} />}</Loading>
        </Stack>
      )}
    </Stack>
  );
}

// The wizard lives in the app shell, above the views: a view change (a shortcut, the palette) must not end the project
// updates still to come. Open until the run is over.
const OpenFix = createContext(() => {});
export const FixEverythingButton = () => <Button leftSection={icon(IconWand)} onClick={useContext(OpenFix)}>Fix everything</Button>;

export function FixEverything({ version, doctor, onClose, children }) {
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => { if (busy) return; setOpened(false); onClose?.(); };
  return (
    <OpenFix.Provider value={() => setOpened(true)}>
      {children}
      <Drawer opened={opened} onClose={close} position="right" size="xl" withCloseButton={false} closeOnEscape={!busy} closeOnClickOutside={!busy} attributes={{ content: { 'aria-label': 'Fix everything' } }}>
        {opened && (
          <Stack gap="md">
            <Group justify="space-between">
              <Title order={2} size="h3">Fix everything</Title>
              <Button variant="default" disabled={busy} onClick={close}>Close</Button>
            </Group>
            <FixSteps version={version} doctor={doctor} onClose={close} setBusy={setBusy} />
          </Stack>
        )}
      </Drawer>
    </OpenFix.Provider>
  );
}
