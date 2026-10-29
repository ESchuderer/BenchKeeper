import { Badge, Button, Group, Loader, Modal, Paper, Select, SimpleGrid, Stack, Switch, Table, Text, Title } from '@mantine/core';
import { useRef, useState } from 'react';
import { Plan, Section, StateBadge } from './parts.jsx';
import { Loading, Note, icon, useApi } from './shell.jsx';
import { label } from './cards.js';
import { IconPlus, IconRefresh, IconRestore, IconTrash } from '@tabler/icons-react';

const STATES = ['current', 'outdated', 'modified', 'removed', 'disabled'];
const short = (ref) => ref?.slice(0, 12);

// One row of a project's Installs tab: a switch, the scope hint, the state on disk, the scopes an agent fixes with the reason,
// and the five facts of the explainer (summary, plain words, impact, default, current). A busy switch ignores clicks but
// stays focusable (a disabled input loses the keyboard focus).
export function InstallRow({ label, checked, onChange, disabled, busy, hint, state, fixed = [], facts, why }) {
  return (
    <Paper withBorder p="xs">
      <Stack gap={4}>
        <Group justify="space-between" align="flex-start" gap="xs">
          <Switch checked={checked} onChange={busy ? () => {} : onChange} disabled={disabled} aria-disabled={busy || undefined} style={busy ? { opacity: 0.6 } : undefined} label={label} />
          <Group gap={4}><Badge variant="default" size="sm">{hint}</Badge><StateBadge state={state} /></Group>
        </Group>
        {why && <Text size="xs">Fixed: {why}.</Text>}
        {fixed.map((f) => <Text key={f.agent} size="xs">{f.agent}: {f.scope === 'global' ? 'also global' : 'only this project'}, fixed: {f.reason}.</Text>)}
        <Stack gap={0} style={{ overflowWrap: 'anywhere' }}>
          <Text size="xs">{facts.summary}</Text>
          <Text size="xs">In plain words: {facts.eli5}</Text>
          <Text size="xs">Impact: {facts.impact}</Text>
          <Text size="xs">Default: {facts.default}. Current: {facts.current}.</Text>
        </Stack>
      </Stack>
    </Paper>
  );
}

const packImpact = (p) => (p.plugin
  ? p.scope === 'global' ? 'the global setup installs the plugin once for the user; this project records the choice' : 'installs the plugin for Claude Code in this project only (local scope)'
  : p.scope === 'global' ? `its ${p.skills} skills sit in the global skill folders of Claude Code and Codex; this project records the choice` : `copies ${p.skills} skills into this project; off removes the ones no other pack or single skill needs`);
const packFacts = (p, eli5) => ({ summary: p.pickWhen ?? p.title, impact: packImpact(p), default: p.suggested ? `on, suggested: ${p.suggested}` : 'off', current: p.enabled ? 'on' : 'off',
  eli5: eli5 ?? (p.plugin ? 'a plugin adds skills and commands to the agent from a folder of its own' : 'a set of skills, instruction files the agent reads when a task fits them') });

const OWNER = 'these skills run the steps of larger tasks: questions first, a spec and tickets, tests first, a review';

// One switch per pack of a project, the workflow owner in a section of its own, and "Copy packs from project". The switches
// only change the plan below them; nothing is written before that plan is applied.
export function PackSwitches({ packs, project, others, toggles, setToggles, busy }) {
  const flip = (p) => setToggles((t) => (p.enabled
    ? { ...t, packOff: [...t.packOff, p.id], packOn: t.packOn.filter((x) => x !== p.id) }
    : { ...t, packOn: [...t.packOn, p.id], packOff: t.packOff.filter((x) => x !== p.id) }));
  const copyFrom = (path) => {
    const from = others.find((o) => o.path === path);
    const now = project.packs ?? [];
    setToggles((t) => ({ ...t, packOn: from ? from.packs.filter((x) => !now.includes(x)) : [], packOff: from ? now.filter((x) => !from.packs.includes(x)) : [] }));
  };
  const sources = others.filter((o) => o.path !== project.path && o.setupVersion && !o.missing);
  // Grouped by the saved setup and the repository's hints, not by the switch, so a switch never moves on a click.
  const near = (p) => (project.packs ?? []).includes(p.id) || p.suggested;
  const rest = packs.filter((p) => !p.owner), owners = packs.filter((p) => p.owner);
  const groups = [['In use or suggested', rest.filter(near)], ['More packs', rest.filter((p) => !near(p))]].filter(([, list]) => list.length);
  const row = (p, eli5) => (
    <InstallRow key={p.id} checked={p.enabled} onChange={() => flip(p)} busy={busy} hint={p.hint} state={p.state} fixed={p.fixed} facts={packFacts(p, eli5)}
      label={<Group gap="xs"><Text fw={600} size="sm">{p.title}</Text>{p.suggested && <Badge variant="default" size="sm">suggested</Badge>}</Group>} />
  );
  return (
    <>
      <Section title="Packs">
        {groups.map(([group, list], g) => (
          <div key={group} role="group" aria-labelledby={`packs-${g}`}>
            <Text id={`packs-${g}`} size="sm" fw={600} mb="xs">{group}</Text>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs">{list.map((p) => row(p))}</SimpleGrid>
          </div>
        ))}
        {!!sources.length && <Select label="Copy packs from project" placeholder="Choose a project" clearable disabled={busy} maw={360} data={sources.map((o) => ({ value: o.path, label: `${label(o)}: ${o.packs.join(', ') || 'no packs'}` }))} onChange={copyFrom} />}
        <Text size="sm">Nothing is written before the plan below is applied.</Text>
      </Section>
      {!!owners.length && <Section title="Workflow owner"><SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs">{owners.map((p) => row(p, OWNER))}</SimpleGrid></Section>}
    </>
  );
}

// The plan of one skill action in a project, in a dialog: the same plan, diff, apply and undo as the project view.
export function ActionPlan({ act, onClose, onDone }) {
  const plan = useApi(act ? `/api/project-plan?${new URLSearchParams([['dir', act.dir], ...act.params])}` : null);
  return (
    <Modal opened={!!act} onClose={onClose} size="xl" withCloseButton={false} attributes={{ content: { 'aria-label': act?.title ?? 'Skill action' } }}>
      <Stack gap="sm">
        <Title order={2} size="h4">{act?.title}</Title>
        <Text size="sm">{act?.dir}</Text>
        <Loading state={plan} label="skill plan">{(p) => (
          <>
            {p.warnings.map((w) => <Note key={w} color="yellow">{w}</Note>)}
            <Plan key={p.planId} plan={p} scope="project" onDone={onDone} />
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
  // Whether each skill source is asked for its default branch (the one network call): only on a click.
  const [checked, setChecked] = useState(false);
  const data = useApi(checked ? '/api/skills?check=1' : '/api/skills');
  const [act, setAct] = useState(null);
  const [state, setState] = useState(null);
  const start = (dir, title, params) => setAct({ dir, title, params: [...params] });
  const close = () => { setAct(null); data.reload(); refresh?.(); };
  // The check is another path, which drops the data: the table without the check stays until it answers.
  const last = useRef(null);
  if (data.data) last.current = data.data;
  return (
    <Section title="Skill states">
      <Group align="flex-end" gap="md">
        <Select label="State" placeholder="Any" clearable maw={200} value={state} onChange={setState} data={STATES} />
        {/* Not the loading prop: it disables the button, which drops the focus. */}
        <Button variant="default" leftSection={checked && data.loading ? <Loader size={14} /> : icon(IconRefresh, 14)} aria-busy={checked && data.loading} onClick={() => (checked ? data.reload() : setChecked(true))}>Check for updates</Button>
      </Group>
      <Loading state={data.data || data.error ? data : { ...data, data: last.current }} label="skill states">{(d) => {
        const rows = d.projects.flatMap((p) => p.skills.map((s) => ({ p, s }))).filter(({ s }) => !state || s.state === state);
        const untracked = d.projects.flatMap((p) => p.untracked.map((u) => ({ p, u })));
        return (
          <>
            {rows.length ? (
              <Table.ScrollContainer minWidth={820}>
                <Table aria-label="Skill states">
                  <Table.Thead><Table.Tr><Table.Th>Project</Table.Th><Table.Th>Skill</Table.Th><Table.Th>State</Table.Th><Table.Th>Installed</Table.Th><Table.Th>Source now</Table.Th><Table.Th>Active</Table.Th><Table.Th>Actions</Table.Th></Table.Tr></Table.Thead>
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
                          <Table.Td>{s.own ? 'BenchKeeper' : short(s.newest) ?? (checked ? 'not reachable' : 'not checked')}</Table.Td>
                          <Table.Td><Switch label={off ? 'off' : 'on'} aria-label={`Active: ${where}`} checked={!off} onChange={() => start(p.path, `${off ? 'Activate' : 'Deactivate'} ${where}`, [[off ? 'enable' : 'disable', s.name], ['focus', s.name]])} /></Table.Td>
                          <Table.Td>
                            <Group gap="xs" wrap="nowrap">
                              <Button size="compact-xs" variant="default" leftSection={icon(IconRefresh, 14)} aria-label={`Update ${where}`} disabled={!['outdated', 'removed'].includes(s.state)} onClick={() => start(p.path, `Update ${where}`, [['update', s.name], ['focus', s.name]])}>Update</Button>
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
                <Text size="sm">No BenchKeeper setup installed these. A skill action, a projects apply and Update all never touch them.</Text>
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
                {!!d.global.length && <Text size="sm">In an agent's global folder: {d.global.map((g) => `${g.name} (${g.folders.join(', ')})`).join(', ')}. The global setup offers to move these to the backup, never preselected.</Text>}
              </Stack>
            )}
          </>
        );
      }}</Loading>
      <ActionPlan act={act} onClose={close} onDone={() => data.reload()} />
    </Section>
  );
}
