import { Anchor, Badge, Button, Code, Group, NumberInput, SegmentedControl, Select, Stack, Switch, Table, Text, TextInput } from '@mantine/core';
import { IconArrowBackUp, IconListCheck } from '@tabler/icons-react';
import { useState } from 'react';
import { api } from './api.js';
import { Cli, Plan, Section } from './parts.jsx';
import { Loading, Note, href, icon, useApi } from './shell.jsx';

const LAYERS = { user: 'User file', project: 'Project file', local: 'Local file' };
const SHOWN = 150;
const UNSET = '(unset)';
// A color fade between schemes would be caught half way by the contrast check, and is not worth a transition here.
const NOFADE = { label: { transition: 'none' } };
const text = (v) => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));

// One control for one key; edit is undefined (untouched), null (remove the key) or the new value.
function ValueControl({ row, own, edit, setEdit }) {
  const shown = edit === undefined ? own : edit;
  const label = `${row.key} value`;
  const set = (v) => setEdit(v === own || (v == null && own == null) ? undefined : v);
  switch (row.type) {
    case 'switch':
      // Environment switches are set or removed, never 0 or false.
      return <Switch aria-label={label} label={shown != null ? 'set' : 'not set'} checked={shown != null} onChange={(e) => set(e.currentTarget.checked ? (own ?? true) : null)} />;
    case 'bool':
      return <SegmentedControl styles={NOFADE} aria-label={label} size="xs" data={[UNSET, 'true', 'false']} value={shown == null ? UNSET : String(shown)} onChange={(v) => set(v === UNSET ? null : v === 'true')} />;
    case 'enum':
      return <Select aria-label={label} data={[...(row.values ?? []).map(String), ...(typeof shown === 'string' && !(row.values ?? []).includes(shown) ? [shown] : [])]} value={shown ?? null} placeholder={UNSET} clearable searchable={!!row.also}
        onChange={(v) => set(v)} allowDeselect={false} comboboxProps={{ withinPortal: false }} />;
    case 'int': case 'number':
      return <NumberInput aria-label={label} value={shown ?? ''} min={row.min} allowDecimal={row.type === 'number'} onChange={(v) => { if (v === '') set(null); else if (Number.isFinite(Number(v))) set(Number(v)); }} />;
    case 'string':
      return <TextInput aria-label={label} value={shown ?? ''} placeholder={UNSET} onChange={(e) => set(e.currentTarget.value || null)} />;
    case 'attribution': {
      const mode = shown === false ? 'hidden' : shown && typeof shown === 'object' ? 'custom' : 'built-in';
      const custom = mode === 'custom' ? shown : { commit: '', pr: '', sessionUrl: false };
      return (
        <Stack gap={6}>
          <SegmentedControl styles={NOFADE} aria-label={label} size="xs" data={['built-in', 'custom', 'hidden']} value={mode}
            onChange={(v) => set(v === 'built-in' ? null : v === 'hidden' ? false : { commit: '', pr: '', sessionUrl: false })} />
          {mode === 'custom' && (
            <>
              <TextInput aria-label="attribution commit text" placeholder="commit trailer" value={custom.commit ?? ''} onChange={(e) => set({ ...custom, commit: e.currentTarget.value })} />
              <TextInput aria-label="attribution pull request text" placeholder="pull request text" value={custom.pr ?? ''} onChange={(e) => set({ ...custom, pr: e.currentTarget.value })} />
              <Switch label="session link" checked={!!custom.sessionUrl} onChange={(e) => set({ ...custom, sessionUrl: e.currentTarget.checked })} />
            </>
          )}
        </Stack>
      );
    }
    case 'object':
      return <Code>{own === undefined ? UNSET : text(own)}</Code>;
    default:
      // strings, JSON values and keys only a schema describes: JSON text, a bare word counts as text.
      return <TextInput aria-label={label} value={edit === undefined ? text(own) : edit === null ? '' : text(edit)} placeholder={UNSET}
        onChange={(e) => { const s = e.currentTarget.value; if (!s) return set(null); try { set(JSON.parse(s)); } catch { set(s); } }} />;
  }
}

const layerBadge = (r) => (r.layer ? <Badge variant="default">{r.layer === 'managed' ? 'managed (read-only)' : r.layer}</Badge> : <Text size="sm">default: {r.default ?? 'built-in'}</Text>);

function Row({ row, layer, edits, setEdit }) {
  const own = row.sets?.find((x) => x.layer === layer)?.value;
  const edit = edits[row.key];
  const suggest = row.suggest;
  return (
    <Table.Tr>
      <Table.Td>
        <Stack gap={2}>
          <Code>{row.key}</Code>
          <Text size="sm">{row.sentence}</Text>
          {row.setByApp && <Text size="sm">BenchKeeper's setup writes this key too: another value shows as drift in Doctor, and the next apply restores the setup's value.</Text>}
          {suggest && (own === undefined && edit === undefined) && (
            <Group gap="xs">
              <Text size="sm">Suggested: {suggest.value == null ? 'leave unset' : String(suggest.value)}. {suggest.reason}</Text>
              {suggest.value != null && <Button size="compact-xs" variant="default" leftSection={icon(IconArrowBackUp)} aria-label={`Use suggestion for ${row.key}`} onClick={() => setEdit(row.key, suggest.value)}>Use suggestion</Button>}
              {suggest.source && <Anchor underline="always" size="sm" href={suggest.source} target="_blank" rel="noreferrer">Source</Anchor>}
            </Group>
          )}
          {row.notes?.map((n) => (
            <Note key={n.id} color={n.level === 'warning' ? 'yellow' : 'blue'} p="xs">
              {n.message} <Anchor size="sm" c="inherit" underline="always" href={n.source} target="_blank" rel="noreferrer">Source</Anchor>
            </Note>
          ))}
        </Stack>
      </Table.Td>
      <Table.Td miw={200}>{row.editable === false ? <Text size="sm">Not edited here: {row.scope ? `it lives in the ${row.scope} file or layer` : 'it is a table, edit the file by hand'}.</Text> : <ValueControl row={row} own={own} edit={edit} setEdit={(v) => setEdit(row.key, v)} />}</Table.Td>
      <Table.Td>{row.layer ? <Stack gap={2}><Badge variant="default" miw="max-content">{row.layer === 'managed' ? 'managed (read-only)' : `from ${row.layer}`}</Badge><Text size="sm">{text(row.value)}</Text></Stack> : layerBadge(row)}</Table.Td>
    </Table.Tr>
  );
}

function Rows({ rows, layer, edits, setEdit, label }) {
  if (!rows.length) return <Text size="sm">No setting matches.</Text>;
  return (
    <Table.ScrollContainer minWidth={720} scrollAreaProps={{ viewportProps: { tabIndex: 0, role: 'region', 'aria-label': `${label}, scrollable` } }}>
      <Table aria-label={label} verticalSpacing="sm">
        <Table.Thead><Table.Tr><Table.Th>Setting</Table.Th><Table.Th>{LAYERS[layer]}</Table.Th><Table.Th>In effect</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{rows.map((r) => <Row key={r.key} row={r} layer={layer} edits={edits} setEdit={setEdit} />)}</Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function Editor({ data, agent, layer, dir, edits, setEdit, clear, advanced, onApplied }) {
  const [search, setSearch] = useState('');
  const [changed, setChanged] = useState(false);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const count = Object.keys(edits).length;
  const q = search.trim().toLowerCase();
  const match = (r) => (!q || `${r.key} ${r.sentence ?? ''}`.toLowerCase().includes(q)) && (!changed || r.changed);
  const basic = data.settings.filter(match);
  const groups = [...new Set(basic.map((r) => r.group))];
  const adv = (data.advanced ?? []).filter(match);
  const review = async (body) => {
    setBusy(true); setError(null); setPlan(null);
    try { setPlan(await api('/api/settings-plan', { agent, layer, dir, ...body })); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <Stack gap="lg">
      <Table.ScrollContainer minWidth={560} scrollAreaProps={{ viewportProps: { tabIndex: 0, role: 'region', 'aria-label': 'Settings files, scrollable' } }}>
        <Table aria-label="Settings files">
          <Table.Thead><Table.Tr><Table.Th>Layer</Table.Th><Table.Th>File</Table.Th><Table.Th>State</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {data.layers.map((l) => (
              <Table.Tr key={`${l.layer}-${l.path}`}>
                <Table.Td>{l.layer}</Table.Td>
                <Table.Td><Code>{l.path}</Code></Table.Td>
                <Table.Td>{l.error ? `unreadable: ${l.error}` : l.readOnly ? (l.exists ? 'read-only, set by whoever manages this machine' : 'not present') : l.exists ? 'present' : 'not created yet'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {data.layers.filter((l) => l.error && !l.readOnly).map((l) => <Note key={l.path} color="red"><Text span fw={600}>This file is not edited. </Text>{l.path} cannot be read ({l.error}). {agent === 'claude' ? 'Claude Code reads strict JSON and skips the whole file on one error.' : ''} Fix it by hand first.</Note>)}
      {data.notes.length > 0 && (
        <Stack gap="xs" role="region" aria-label="Notes on conflicting settings">
          {data.notes.map((n) => <Note key={n.id} color={n.level === 'warning' ? 'yellow' : 'blue'}><Text span fw={600}>Conflicting settings. </Text>{n.message} <Anchor size="sm" c="inherit" underline="always" href={n.source} target="_blank" rel="noreferrer">Source</Anchor></Note>)}
        </Stack>
      )}
      <Group align="flex-end">
        <TextInput label="Search settings" placeholder="key or words" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
        <Switch label="Changed from default" checked={changed} onChange={(e) => setChanged(e.currentTarget.checked)} />
        {data.bundles?.map((b) => <Button key={b.id} variant="default" loading={busy} onClick={() => review({ bundle: b.id })}>{b.label}: set the switches</Button>)}
      </Group>
      {data.bundles?.map((b) => <Text key={b.id} size="sm">{b.label}: {b.sentence} <Anchor underline="always" size="sm" href={b.source} target="_blank" rel="noreferrer">Source</Anchor></Text>)}
      {groups.map((g) => (
        <Section key={g} title={g}><Rows rows={basic.filter((r) => r.group === g)} layer={layer} edits={edits} setEdit={setEdit} label={g} /></Section>
      ))}
      {!groups.length && !advanced && <Text>No setting matches.</Text>}
      {advanced && (
        <Section title="Every key of the pinned schemas">
          <Text size="sm">{adv.length} keys{adv.length > SHOWN ? `, the first ${SHOWN} shown: search to narrow` : ''}. A value is JSON, a bare word counts as text.</Text>
          <Rows rows={adv.slice(0, SHOWN)} layer={layer} edits={edits} setEdit={setEdit} label="Advanced keys" />
        </Section>
      )}
      {advanced && data.env && (
        <Section title="Environment entries in the settings files">
          {data.env.length ? (
            <Table aria-label="Environment entries" maw={640}>
              <Table.Thead><Table.Tr><Table.Th>Name</Table.Th><Table.Th>Value</Table.Th><Table.Th>Layer</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{data.env.map((e) => <Table.Tr key={`${e.layer}-${e.name}`}><Table.Td><Code>{e.name}</Code></Table.Td><Table.Td>{e.secret ? 'set (value hidden)' : text(e.value)}</Table.Td><Table.Td>{e.layer}</Table.Td></Table.Tr>)}</Table.Tbody>
            </Table>
          ) : <Text size="sm">None.</Text>}
        </Section>
      )}
      {advanced && data.outside?.length > 0 && (
        <Section title="Not in the app's list">
          <Text size="sm">Keys that neither the app nor the pinned schemas and reference know. They are shown as they are and kept: edits never rewrite or drop them.</Text>
          <Table aria-label="Keys outside the app's list" maw={640}>
            <Table.Thead><Table.Tr><Table.Th>Key</Table.Th><Table.Th>Value</Table.Th><Table.Th>Layer</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{data.outside.map((x) => <Table.Tr key={`${x.layer}-${x.key}`}><Table.Td><Code>{x.key}</Code></Table.Td><Table.Td><Code>{text(x.value)}</Code></Table.Td><Table.Td>{x.layer}</Table.Td></Table.Tr>)}</Table.Tbody>
          </Table>
        </Section>
      )}
      {data.trust && (
        <Section title="Trusted projects">
          {data.trust.length ? (
            <Table aria-label="Trusted projects" maw={720}>
              <Table.Thead><Table.Tr><Table.Th>Folder</Table.Th><Table.Th>Trust</Table.Th><Table.Th>State</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {data.trust.map((t) => (
                  <Table.Tr key={t.path}>
                    <Table.Td><Code>{t.path}</Code></Table.Td><Table.Td>{t.trust ?? '-'}</Table.Td>
                    <Table.Td>{t.exists ? 'exists' : <Group gap="xs">no longer exists<Button size="compact-xs" variant="default" disabled={layer !== 'user' || edits[`projects.${t.path}`] === null} aria-label={`${edits[`projects.${t.path}`] === null ? 'Marked for removal' : 'Remove'} ${t.path}`} onClick={() => setEdit(`projects.${t.path}`, null)}>{edits[`projects.${t.path}`] === null ? 'Marked for removal' : 'Remove'}</Button></Group>}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : <Text size="sm">None.</Text>}
        </Section>
      )}
      <Group>
        <Button leftSection={icon(IconListCheck)} loading={busy} disabled={!count} onClick={() => review({ edits })}>Review {count} change{count === 1 ? '' : 's'}</Button>
        {count > 0 && <Button variant="default" onClick={() => { clear(); setPlan(null); }}>Discard changes</Button>}
      </Group>
      {error && <Note color="red" title="Not planned">{error}</Note>}
      {plan && <Section title="Changes"><Plan key={plan.planId} plan={plan} onDone={() => { clear(); onApplied(); }} /></Section>}
    </Stack>
  );
}

// The agents' own settings files. Distinct from Settings, which holds the app's preferences.
export function AgentSettings({ overview, params, refresh }) {
  const [agent, setAgent] = useState(params.get('agent') === 'codex' ? 'codex' : 'claude');
  const [layer, setLayer] = useState(params.get('layer') === 'project' ? 'project' : 'user');
  const [dir, setDir] = useState(params.get('path'));
  const [advanced, setAdvanced] = useState(false);
  const [edits, setEdits] = useState({});
  const projects = overview.data?.projects ?? [];
  const chosen = layer === 'user' ? undefined : dir ?? projects[0]?.path;
  const query = new URLSearchParams({ agent, ...(chosen ? { dir: chosen } : {}), ...(advanced ? { advanced: '1' } : {}) });
  const state = useApi(layer === 'user' || chosen ? `/api/settings?${query}` : null);
  const setEdit = (key, v) => setEdits((e) => { const n = { ...e }; if (v === undefined) delete n[key]; else n[key] = v; return n; });
  const reset = (f) => (v) => { f(v); setEdits({}); };
  const layers = agent === 'claude' ? Object.keys(LAYERS) : ['user', 'project'];
  return (
    <Stack gap="lg">
      <Note>These are the agents' own settings files. The app's own preferences (shortcuts, profile) are in <Anchor c="inherit" underline="always" href={href('settings')}>Settings</Anchor>. Every change is a plan with a diff, and History undoes it.</Note>
      <Group align="flex-end">
        <SegmentedControl styles={NOFADE} aria-label="Agent" data={[{ value: 'claude', label: 'Claude Code' }, { value: 'codex', label: 'Codex' }]} value={agent} onChange={reset((v) => { setAgent(v); if (v === 'codex' && layer === 'local') setLayer('user'); })} />
        <Select label="Write to" data={layers.map((l) => ({ value: l, label: LAYERS[l] }))} value={layer} onChange={reset((v) => setLayer(v ?? 'user'))} allowDeselect={false} comboboxProps={{ withinPortal: false }} />
        {layer !== 'user' && <Select label="Project" data={projects.map((p) => p.path)} value={chosen ?? null} onChange={reset(setDir)} placeholder="register a project first" allowDeselect={false} comboboxProps={{ withinPortal: false }} />}
        <Switch label="Advanced: every key" checked={advanced} onChange={(e) => setAdvanced(e.currentTarget.checked)} />
      </Group>
      {layer !== 'user' && !chosen && <Note color="yellow">The project and local files belong to a registered project: add one under Projects.</Note>}
      {chosen || layer === 'user' ? (
        <Loading state={state} label="settings">
          {(data) => <Editor key={`${agent}-${layer}-${chosen}`} data={data} agent={agent} layer={layer} dir={chosen} edits={edits} setEdit={setEdit} clear={() => setEdits({})} advanced={advanced} onApplied={() => { state.reload(); refresh(); }} />}
        </Loading>
      ) : null}
      <Cli>{`benchkeeper settings list --agent ${agent}\nbenchkeeper settings set <key> <value> --agent ${agent}\nbenchkeeper settings set <key> --unset --agent ${agent}`}</Cli>
    </Stack>
  );
}
