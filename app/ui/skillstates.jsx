import { Button, Group, Modal, Select, Stack, Switch, Table, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { Plan, Section, StateBadge } from './parts.jsx';
import { Loading, Note, icon, useApi } from './shell.jsx';
import { label } from './projects.jsx';
import { IconPlus, IconRefresh, IconRestore, IconTrash } from '@tabler/icons-react';

const STATES = ['current', 'outdated', 'modified', 'removed', 'disabled'];
const short = (ref) => ref?.slice(0, 12);

// One switch per pack of a project, and "Copy packs from project". The switches only change the plan below them;
// nothing is written before that plan is applied.
export function PackSwitches({ packs, project, others, toggles, setToggles }) {
  const flip = (p) => setToggles((t) => (p.enabled
    ? { ...t, packOff: [...t.packOff, p.id], packOn: t.packOn.filter((x) => x !== p.id) }
    : { ...t, packOn: [...t.packOn, p.id], packOff: t.packOff.filter((x) => x !== p.id) }));
  const copyFrom = (path) => {
    const from = others.find((o) => o.path === path);
    const now = project.packs ?? [];
    setToggles((t) => ({ ...t, packOn: from ? from.packs.filter((x) => !now.includes(x)) : [], packOff: from ? now.filter((x) => !from.packs.includes(x)) : [] }));
  };
  const sources = others.filter((o) => o.path !== project.path && o.setupVersion && !o.missing);
  return (
    <Section title="Packs">
      <Group gap="lg">
        {packs.map((p) => <Switch key={p.id} label={p.title} description={p.skills == null ? 'a plugin' : `${p.skills} skills${p.own ? ', own' : ''}`} checked={p.enabled} onChange={() => flip(p)} />)}
      </Group>
      {!!sources.length && <Select label="Copy packs from project" placeholder="Choose a project" clearable maw={360} data={sources.map((o) => ({ value: o.path, label: `${label(o)}: ${o.packs.join(', ') || 'no packs'}` }))} onChange={copyFrom} />}
      <Text size="sm">Turning a pack off removes the skills no other pack or single pick needs. The changes are listed below before anything is written; undo restores them.</Text>
    </Section>
  );
}

// The plan of one skill action in a project, in a dialog: the same plan, diff, apply and undo as the project view.
function ActionPlan({ act, onClose, onDone }) {
  const plan = useApi(act ? `/api/project-plan?${new URLSearchParams([['dir', act.dir], ...act.params])}` : null);
  return (
    <Modal opened={!!act} onClose={onClose} size="xl" withCloseButton={false} attributes={{ content: { 'aria-label': act?.title ?? 'Skill action' } }}>
      <Stack gap="sm">
        <Title order={2} size="h4">{act?.title}</Title>
        <Text size="sm">{act?.dir}</Text>
        <Loading state={plan} label="skill plan">{(p) => (
          <>
            {p.warnings.map((w) => <Note key={w} color="yellow">{w}</Note>)}
            <Plan key={p.planId} plan={p} onDone={onDone} />
          </>
        )}</Loading>
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Close</Button></Group>
      </Stack>
    </Modal>
  );
}

// Every skill of every registered project with its state against the library, the commit installed and the one the
// library offers, and the folders no setup installed (never touched by an update or an apply).
export function SkillStates({ refresh }) {
  const data = useApi('/api/skills');
  const [act, setAct] = useState(null);
  const [state, setState] = useState(null);
  const start = (dir, title, params) => setAct({ dir, title, params: [...params] });
  const close = () => { setAct(null); data.reload(); refresh?.(); };
  return (
    <Section title="Skill states">
      <Loading state={data} label="skill states">{(d) => {
        const rows = d.projects.flatMap((p) => p.skills.map((s) => ({ p, s }))).filter(({ s }) => !state || s.state === state);
        const untracked = d.projects.flatMap((p) => p.untracked.map((u) => ({ p, u })));
        return (
          <>
            <Select label="State" placeholder="Any" clearable maw={200} value={state} onChange={setState} data={STATES} />
            {rows.length ? (
              <Table.ScrollContainer minWidth={820}>
                <Table aria-label="Skill states">
                  <Table.Thead><Table.Tr><Table.Th>Project</Table.Th><Table.Th>Skill</Table.Th><Table.Th>State</Table.Th><Table.Th>Installed</Table.Th><Table.Th>Library offers</Table.Th><Table.Th>Active</Table.Th><Table.Th>Actions</Table.Th></Table.Tr></Table.Thead>
                  <Table.Tbody>
                    {rows.map(({ p, s }) => {
                      const where = `${s.name} in ${label(p)}`;
                      const off = s.state === 'disabled';
                      return (
                        <Table.Tr key={`${p.path}:${s.name}`}>
                          <Table.Td>{label(p)}</Table.Td>
                          <Table.Td>{s.name}{!!s.packs.length && <Text size="xs">pack {s.packs.join(', ')}</Text>}</Table.Td>
                          <Table.Td><StateBadge state={s.state} /></Table.Td>
                          <Table.Td>{s.own ? 'BenchKeeper' : short(s.pinned) ?? 'not recorded'}</Table.Td>
                          <Table.Td>{s.own ? 'BenchKeeper' : short(s.newest) ?? '-'}</Table.Td>
                          <Table.Td><Switch label={off ? 'off' : 'on'} aria-label={`Active: ${where}`} checked={!off} onChange={() => start(p.path, `${off ? 'Activate' : 'Deactivate'} ${where}`, [[off ? 'enable' : 'disable', s.name], ['focus', s.name]])} /></Table.Td>
                          <Table.Td>
                            <Group gap="xs" wrap="nowrap">
                              <Button size="compact-xs" variant="default" leftSection={icon(IconRefresh, 14)} aria-label={`Update ${where}`} disabled={!['outdated', 'removed'].includes(s.state)} onClick={() => start(p.path, `Update ${where}`, [['focus', s.name]])}>Update</Button>
                              <Button size="compact-xs" variant="default" leftSection={icon(IconRestore, 14)} aria-label={`Reset ${where}`} disabled={s.state !== 'modified'} onClick={() => start(p.path, `Reset ${where}`, [['reset', s.name], ['focus', s.name]])}>Reset</Button>
                              <Button size="compact-xs" variant="subtle" leftSection={icon(IconTrash, 14)} aria-label={`Remove ${where}`} disabled={!s.single} title={s.single ? undefined : `Comes from pack ${s.packs.join(', ') || 'the setup'}: switch the pack off`} onClick={() => start(p.path, `Remove ${where}`, [['drop', s.name], ['focus', s.name]])}>Remove</Button>
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            ) : <Text size="sm" role="status">{state ? `No skill is ${state}.` : 'No registered project has a setup with skills.'}</Text>}
            {(!!untracked.length || !!d.global.length) && (
              <Stack gap="xs" component="section" aria-label="Untracked skill folders">
                <Title order={4} size="h5">Untracked skill folders</Title>
                <Text size="sm">No BenchKeeper setup installed these. An update or an apply never touches them.</Text>
                {!!untracked.length && (
                  <Table.ScrollContainer minWidth={520}>
                    <Table aria-label="Untracked folders">
                      <Table.Thead><Table.Tr><Table.Th>Project</Table.Th><Table.Th>Skill</Table.Th><Table.Th>Folder</Table.Th><Table.Th>Actions</Table.Th></Table.Tr></Table.Thead>
                      <Table.Tbody>
                        {untracked.map(({ p, u }) => (
                          <Table.Tr key={`${p.path}:${u.name}`}>
                            <Table.Td>{label(p)}</Table.Td>
                            <Table.Td>{u.name}</Table.Td>
                            <Table.Td>{u.folders.join(', ')}</Table.Td>
                            <Table.Td>{u.library
                              ? <Button size="compact-xs" variant="default" leftSection={icon(IconPlus, 14)} aria-label={`Adopt ${u.name} in ${label(p)}`} onClick={() => start(p.path, `Adopt ${u.name} in ${label(p)}`, [['pick', u.name], ['focus', u.name]])}>Adopt</Button>
                              : <Text size="sm">left alone: not a library skill</Text>}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                )}
                {!!d.global.length && <Text size="sm">In an agent's global folder: {d.global.map((g) => `${g.name} (${g.folders.join(', ')})`).join(', ')}. Left alone.</Text>}
              </Stack>
            )}
          </>
        );
      }}</Loading>
      <ActionPlan act={act} onClose={close} onDone={() => data.reload()} />
    </Section>
  );
}
