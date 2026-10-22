import { Anchor, Badge, Button, Checkbox, Code, Drawer, Group, List, Progress, Stack, Stepper, Table, Text, Title } from '@mantine/core';
import { IconPlayerPlay, IconTool, IconWand } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { ChangeList, RunProgress, defaultSelect, usePrerun } from './parts.jsx';
import { Dot, Loading, Note, href, icon, useApi } from './shell.jsx';

// Doctor findings the setup can fix open the plan that fixes them; the others keep their fix text only.
export function fixAction(i) {
  if (i.check === 'unexpected') return [href('agents', { plan: '1' }), 'Review removal'];
  if (['rules', 'ask', 'plugin', 'skills', 'settings', 'tools', 'global'].includes(i.check) && i.fix.startsWith('benchkeeper apply')) return [href('agents', { plan: '1' }), 'Plan fix'];
  if (i.check === 'project') return [href('projects', i.dir ? { path: i.dir } : {}), 'Plan project'];
  return null;
}

export function DoctorTable({ found }) {
  if (!found.length) return <Text>No problems found.</Text>;
  return (
    <Table.ScrollContainer minWidth={560}>
      <Table aria-label="Doctor findings">
        <Table.Thead><Table.Tr><Table.Th w={110}>Level</Table.Th><Table.Th>Problem</Table.Th><Table.Th>Fix</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {found.map((i, n) => {
            const action = fixAction(i);
            return (
              <Table.Tr key={n}>
                <Table.Td><Badge variant="default" leftSection={<Dot color={i.level === 'error' ? 'red' : 'yellow'} />}>{i.level}</Badge></Table.Td>
                <Table.Td>{i.message}</Table.Td>
                <Table.Td><Stack gap={4} align="flex-start">{!(action && i.fix.startsWith('benchkeeper ')) && <Text size="sm">{i.fix}</Text>}{action && <Button component="a" href={action[0]} size="xs" variant="default" leftSection={icon(IconTool)}>{action[1]}</Button>}</Stack></Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

// Update all, one request per project, so the server's synchronous apply stays as it is and each row reports on its own.
export async function updateProjects(paths, push, onProgress) {
  const rows = paths.map((path) => ({ path, status: 'pending' }));
  onProgress([...rows]);
  for (const [i, row] of rows.entries()) {
    rows[i] = { ...row, status: 'running' };
    onProgress([...rows]);
    try { rows[i] = (await api('/api/update-all', { paths: [row.path], push }))[0] ?? { path: row.path, status: 'stopped', reason: 'no longer registered' }; } catch (e) { rows[i] = { path: row.path, status: 'stopped', reason: e.message }; }
    onProgress([...rows]);
  }
  return rows;
}

export function UpdateResults({ progress, extra }) {
  const done = progress.filter((r) => !['pending', 'running'].includes(r.status)).length;
  return (
    <>
      <Progress.Root size="lg"><Progress.Section value={(done / progress.length) * 100} aria-label={`Update all: ${done} of ${progress.length} projects`} /></Progress.Root>
      <Table aria-label="Update all results">
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

// Projects Update all can take: set up before, readable, behind this version or with changes pending. Uncommitted
// changes or no repository: shown, not offered, as Update all would skip them.
const offered = (p) => p.setupVersion && !p.error && (!p.current || p.changes?.length);
const blocked = (p) => (!p.repo ? 'no repository' : !p.clean ? 'uncommitted changes' : null);

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
  const manual = (doctor.data ?? []).filter((i) => !fixAction(i));
  const list = (projects.data ?? []).filter(offered);
  const open = list.filter((p) => !blocked(p)).map((p) => p.path);
  const fresh = (projects.data ?? []).filter((p) => !p.setupVersion && !p.error).length;
  const nothing = !select?.length && !picked.length;
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
              <Text size="sm">Each checked project gets branch <Code>chore/agent-setup-{version}</Code> in a worktree with one commit, pushed with a pull request when origin is on GitHub. Your working tree stays as it is.</Text>
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
                          description={[p.path, `setup ${p.setupVersion}${p.current ? '' : `, ${version} available`}`, `${p.changes?.length ?? 0} pending`, p.branch, blocked(p) && `skipped: ${blocked(p)}`].filter(Boolean).join(', ')} />
                      ))}
                    </Stack>
                  </Checkbox.Group>
                </>
              ) : <Text>Every registered project is current.</Text>}
              {fresh > 0 && <Text size="sm">{fresh} registered project{fresh > 1 ? 's have' : ' has'} no setup yet: set {fresh > 1 ? 'them' : 'it'} up step by step in <Anchor href={href('projects')} underline="always" onClick={onClose}>Projects</Anchor>.</Text>}
            </Stack>
          )}</Loading>
        </Stepper.Step>
        <Stepper.Step label="By hand">
          <Stack gap="sm">
            <Text size="sm">Doctor findings the setup cannot fix. They stay until you do what the fix column says.</Text>
            <Loading state={doctor} label="doctor">{() => <DoctorTable found={manual} />}</Loading>
          </Stack>
        </Stepper.Step>
        <Stepper.Step label="Apply">
          <List spacing={4} aria-label="What Apply does">
            <List.Item>Global setup: {select?.length ? `${select.length} of ${global.data.changes.length} changes` : 'nothing'}</List.Item>
            <List.Item>Projects: {picked.length ? `${picked.length}, one branch and pull request each` : 'none'}</List.Item>
            <List.Item>By hand: {manual.length ? `${manual.length} left to you` : 'nothing'}</List.Item>
          </List>
        </Stepper.Step>
        <Stepper.Completed>
          {running && <FixRun plan={global.data} select={select} paths={picked} onFinished={() => setBusy(false)} />}
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

// The global apply first, then each project in turn; a cancelled apply leaves the projects as they are.
function FixRun({ plan, select, paths, onFinished }) {
  const [job, setJob] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [stopped, setStopped] = useState(false);
  const projects = () => (paths.length ? updateProjects(paths, true, setProgress) : Promise.resolve()).then(onFinished);
  useEffect(() => {
    if (!select?.length) { projects(); return; }
    api('/api/apply', { planId: plan.planId, select }).then(setJob, (e) => { setError(e.message); projects(); });
  }, []);
  return (
    <Stack gap="md">
      {error && <Note color="red" title="Global setup failed">{error}</Note>}
      {job && (
        <Stack gap="xs">
          <Title order={3} size="h5">Global setup</Title>
          <RunProgress job={job.job} total={job.total} onDone={(run) => { if (run?.status === 'cancelled') { setStopped(true); onFinished(); } else projects(); }} />
        </Stack>
      )}
      {stopped && paths.length > 0 && <Note color="yellow" title="Projects not updated">The global setup was cancelled, so the projects were left as they are.</Note>}
      {progress && (
        <Stack gap="xs">
          <Title order={3} size="h5">Projects</Title>
          <UpdateResults progress={progress} />
        </Stack>
      )}
    </Stack>
  );
}

export function FixEverything({ version, doctor, onClose }) {
  const [opened, setOpened] = useState(false);
  // Open until the run is over: closing it would end the project updates still to come.
  const [busy, setBusy] = useState(false);
  const close = () => { if (busy) return; setOpened(false); onClose?.(); };
  return (
    <>
      <Button leftSection={icon(IconWand)} onClick={() => setOpened(true)}>Fix everything</Button>
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
    </>
  );
}
