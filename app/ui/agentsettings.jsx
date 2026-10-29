import { Anchor, Badge, Button, Code, Group, NumberInput, SegmentedControl, Select, Stack, Switch, Table, Text, TextInput } from '@mantine/core';
import { IconArrowBackUp, IconListCheck } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Folded, Plan, Section, SettingFacts } from './parts.jsx';
import { Dot, Loading, Note, href, icon, useAnnounce, useApi } from './shell.jsx';
import { differs, fixOf, matches, ownOf } from './suggest.js';

const LAYERS = { user: 'User file', project: 'Project file', local: 'Local file' };
const SHOWN = 150;
const UNSET = '(unset)';
// A color fade between schemes would be caught half way by the contrast check, and is not worth a transition here.
const NOFADE = { label: { transition: 'none' } };
const text = (v) => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));
const KIND = { conflict: 'Conflicting settings', hardening: 'Hardening', ignored: 'Ignored setting', note: 'Note' };
const FROM = { user: 'the user file', project: 'the project file', local: 'the local file', managed: 'managed settings', environment: 'the environment' };

// A note on the settings: what it found, then the default, the risk and what the fix changes on lines of their own, then the buttons.
const SettingNote = ({ n, children }) => (
  <Note color={n.level === 'warning' ? 'yellow' : 'blue'}>
    <Stack gap={4}>
      <Text size="sm"><Text span fw={600}>{KIND[n.kind]}. </Text>{n.message}</Text>
      {n.default && <Text size="sm"><Text span fw={600}>Default: </Text>{n.default}</Text>}
      {n.risk && <Text size="sm"><Text span fw={600}>Risk: </Text>{n.risk}</Text>}
      {n.fixChanges && <Text size="sm"><Text span fw={600}>What the fix changes: </Text>{n.fixChanges}</Text>}
      <Group gap="xs">{children}<Anchor size="sm" c="inherit" underline="always" href={n.source} target="_blank" rel="noreferrer">Source</Anchor></Group>
    </Stack>
  </Note>
);

// Under the value: the value in effect when another file or the environment wins, then the suggestion with its marker.
function Compare({ row, layer, own, edit, use }) {
  const s = row.suggest;
  const shown = edit === undefined ? own : edit;
  return (
    <>
      {row.from !== layer && row.from !== 'default' && <Text size="sm">In effect: {text(row.value)}, from {FROM[row.from] ?? row.from}.</Text>}
      {s && (matches(row, shown) ? <Text size="sm">Matches suggested{edit === undefined ? '' : ' (in your changes)'}.</Text> : (
        <Group gap="xs">
          <Text size="sm">Suggested: {s.value == null ? 'leave unset' : text(s.value)}. {s.reason}</Text>
          {use && <Button size="compact-xs" variant="default" leftSection={icon(IconArrowBackUp)} aria-label={`Use suggested for ${row.key}`} onClick={use}>Use suggested</Button>}
          {s.source && <Anchor underline="always" size="sm" href={s.source} target="_blank" rel="noreferrer">Source</Anchor>}
        </Group>
      ))}
    </>
  );
}

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

function Row({ row, layer, edits, setEdit, stage }) {
  const own = ownOf(row, layer);
  const edit = edits[row.key];
  const editable = row.editable !== false;
  return (
    <Table.Tr>
      <Table.Td>
        <Stack gap={2}>
          <Group gap="xs"><Code id={`setting-${row.key}`} tabIndex={-1}>{row.key}</Code>{differs(row, layer) && <Badge variant="default" miw="max-content" leftSection={<Dot color="yellow" />}>Differs from suggested</Badge>}</Group>
          <SettingFacts f={row} />
          {row.setByApp && <Text size="sm">BenchKeeper's setup writes this key too: another value shows as drift in Doctor, and the next apply restores the setup's value.</Text>}
          {row.notes?.map((n) => (
            <Note key={n.id} color={n.level === 'warning' ? 'yellow' : 'blue'} p="xs">
              {n.message} <Anchor size="sm" c="inherit" underline="always" href={n.source} target="_blank" rel="noreferrer">Source</Anchor>
            </Note>
          ))}
        </Stack>
      </Table.Td>
      <Table.Td miw={200}>
        <Stack gap={6}>
          {editable ? <ValueControl row={row} own={own} edit={edit} setEdit={(v) => setEdit(row.key, v)} /> : <Text size="sm">Not edited here: {row.masked ? 'it holds a secret, shown masked: edit the file by hand' : row.scope ? `it lives in the ${row.scope} file or layer` : 'it is a table, edit the file by hand'}.</Text>}
          <Compare row={row} layer={layer} own={own} edit={edit} use={editable ? () => stage({ [row.key]: row.suggest.value }) : undefined} />
        </Stack>
      </Table.Td>
    </Table.Tr>
  );
}

function Rows({ rows, layer, edits, setEdit, stage, label }) {
  if (!rows.length) return <Text size="sm">No setting matches.</Text>;
  return (
    <Table.ScrollContainer minWidth={720} scrollAreaProps={{ viewportProps: { tabIndex: 0, role: 'region', 'aria-label': `${label}, scrollable` } }}>
      <Table aria-label={label} verticalSpacing="sm">
        <Table.Thead><Table.Tr><Table.Th>Setting</Table.Th><Table.Th>{LAYERS[layer]}</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{rows.map((r) => <Row key={r.key} row={r} layer={layer} edits={edits} setEdit={setEdit} stage={stage} />)}</Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function Editor({ data, agent, layer, dir, edits, setEdit: put, clear, advanced, onApplied }) {
  const [search, setSearch] = useState('');
  const [changed, setChanged] = useState(false);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [dismissError, setDismissError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [only, setOnly] = useState(false);
  const [showHardening, setShowHardening] = useState(false);
  const [target, setTarget] = useState(null);
  // A plan holds the edits of its Review: a later edit drops it, and a pending Review's answer for older edits is ignored, so Apply never clears edits it did not write.
  const rev = useRef(0);
  const setEdit = (key, v) => { put(key, v); rev.current++; setPlan(null); };
  const count = Object.keys(edits).length;
  const q = search.trim().toLowerCase();
  const match = (r) => (!q || `${r.key} ${r.summary ?? ''} ${r.sentence ?? ''}`.toLowerCase().includes(q)) && (!changed || r.changed) && (!only || differs(r, layer));
  const basic = data.settings.filter(match);
  const groups = [...new Set(basic.map((r) => r.group))];
  const adv = (data.advanced ?? []).filter(match);
  const review = async (body) => {
    setBusy(true); setError(null); setPlan(null);
    const asked = rev.current;
    try { const p = await api('/api/settings-plan', { agent, layer, dir, ...body }); if (asked === rev.current) setPlan(p); } catch (e) { if (asked === rev.current) setError(e.message); }
    setBusy(false);
  };
  // Use suggested and a note's fix: the values join the pending edits, and the plan of all of them opens at once.
  const stage = (fix) => { for (const [k, v] of Object.entries(fix)) setEdit(k, v); void review({ edits: { ...edits, ...fix } }); };
  useEffect(() => { if (plan) document.getElementById('settings-changes-title')?.focus(); }, [plan]);
  const clearFilters = () => { setSearch(''); setChanged(false); setOnly(false); };
  // Go to the setting: a filter may hide its row, so focus waits for the render without filters.
  useEffect(() => { if (target) { document.getElementById(`setting-${target}`)?.focus(); setTarget(null); } }, [target]);
  const rowsOf = (n) => (n.keys ?? []).map((k) => data.settings.find((r) => r.key === k)).filter(Boolean);
  const noteButtons = (n) => {
    const fix = fixOf(n, rowsOf(n), layer);
    const first = rowsOf(n)[0];
    return (
      <>
        {Object.keys(fix).length > 0 ? <Button size="compact-xs" variant="default" loading={busy} aria-label={`Fix, review the change: ${n.id}`} onClick={() => stage(fix)}>Fix: review the change</Button>
          : first && <Button size="compact-xs" variant="default" aria-label={`Go to the setting: ${n.id}`} onClick={() => { clearFilters(); setTarget(first.key); }}>Go to the setting</Button>}
        <Button size="compact-xs" variant="default" aria-label={`Dismiss, I accept this: ${n.id}`} onClick={() => dismiss(n.id, true)}>Dismiss, I accept this</Button>
      </>
    );
  };
  const hardening = data.notes.filter((n) => n.kind === 'hardening');
  const suggested = data.settings.filter((r) => r.suggest);
  const [status, announce] = useAnnounce();
  // The notes region stays after either click: a dismissed note is listed under Dismissed, a shown one among the notes.
  const dismiss = (id, dismissed) => { setDismissError(null); api('/api/settings-dismiss', { id, dismissed }).then(() => { onApplied(); announce('setting-notes', `${dismissed ? 'Dismissed' : 'Shown again'}: ${id}`); }, (e) => setDismissError(e.message)); };
  const dismissed = data.dismissed ?? [];
  return (
    <Stack gap="lg">
      {data.layers.filter((l) => l.error && !l.readOnly).map((l) => <Note key={l.path} color="red"><Text span fw={600}>This file is not edited. </Text>{l.path} cannot be read ({l.error}). {agent === 'claude' ? 'Claude Code reads strict JSON and skips the whole file on one error.' : ''} Fix it by hand first.</Note>)}
      {(data.notes.length > 0 || dismissed.length > 0) && (
        <Stack gap="xs" role="region" aria-label="Notes on the settings" id="setting-notes" tabIndex={-1}>
          {status}
          {dismissError && <Note color="red" title="Not saved">{dismissError}</Note>}
          {data.notes.filter((n) => n.kind !== 'hardening').map((n) => <SettingNote key={n.id} n={n}>{noteButtons(n)}</SettingNote>)}
          {hardening.length > 0 && (
            <Group gap="xs">
              <Button size="compact-sm" variant="subtle" aria-expanded={showHardening} onClick={() => setShowHardening(!showHardening)}>Hardening advice ({hardening.length})</Button>
              {!showHardening && <Text size="sm" style={{ overflowWrap: 'anywhere' }}>{hardening.flatMap((n) => rowsOf(n).map((r) => r.key).slice(0, 1)).join(', ')}</Text>}
            </Group>
          )}
          {showHardening && hardening.map((n) => <SettingNote key={n.id} n={n}>{noteButtons(n)}</SettingNote>)}
          {dismissed.length > 0 && <Group><Button size="compact-sm" variant="subtle" aria-expanded={showDismissed} onClick={() => setShowDismissed(!showDismissed)}>Dismissed ({dismissed.length})</Button></Group>}
          {showDismissed && dismissed.map((n) => <SettingNote key={n.id} n={n}><Button size="compact-xs" variant="default" aria-label={`Show again: ${n.id}`} onClick={() => dismiss(n.id, false)}>Show again</Button></SettingNote>)}
        </Stack>
      )}
      {suggested.length > 0 && <Text>{suggested.filter((r) => differs(r, layer)).length} of {suggested.length} settings with a suggestion differ from it in the {LAYERS[layer].toLowerCase()}.</Text>}
      <Group align="flex-end">
        <TextInput label="Search settings" placeholder="key or words" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
        <Switch label="Changed from default" checked={changed} onChange={(e) => setChanged(e.currentTarget.checked)} />
        <Switch label="Differs from suggested" checked={only} onChange={(e) => setOnly(e.currentTarget.checked)} />
        {data.bundles?.map((b) => <Button key={b.id} variant="default" loading={busy} onClick={() => review({ bundle: b.id })}>{b.label}: set the switches</Button>)}
      </Group>
      {data.bundles?.map((b) => <Text key={b.id} size="sm">{b.label}: {b.sentence} <Anchor underline="always" size="sm" href={b.source} target="_blank" rel="noreferrer">Source</Anchor></Text>)}
      {groups.map((g) => (
        <Section key={g} title={g}><Rows rows={basic.filter((r) => r.group === g)} layer={layer} edits={edits} setEdit={setEdit} stage={stage} label={g} /></Section>
      ))}
      {!groups.length && !advanced && <Group gap="sm"><Text>No setting matches.</Text><Button size="xs" variant="default" onClick={clearFilters}>Clear search and filters</Button></Group>}
      {advanced && (
        <Section title="Every key of the pinned schemas">
          <Text size="sm">{adv.length} keys{adv.length > SHOWN ? `, the first ${SHOWN} shown: search to narrow` : ''}. A value is JSON, a bare word counts as text.</Text>
          <Rows rows={adv.slice(0, SHOWN)} layer={layer} edits={edits} setEdit={setEdit} stage={stage} label="Advanced keys" />
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
      <Folded title="Settings files" name={`settings files (${data.layers.length})`} label={[`Show settings files (${data.layers.length})`, 'Hide settings files']}>
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
      </Folded>
      <Group>
        <Button leftSection={icon(IconListCheck)} loading={busy} disabled={!count} onClick={() => review({ edits })}>Review {count} change{count === 1 ? '' : 's'}</Button>
        {count > 0 && <Button variant="default" onClick={() => { clear(); rev.current++; setPlan(null); }}>Discard changes</Button>}
      </Group>
      {error && <Note color="red" title="Not planned">{error}</Note>}
      {plan && <Section title="Changes" id="settings-changes"><Plan key={plan.planId} plan={plan} why="You changed these values in Agent settings." scope={layer === 'user' ? 'global' : 'project'} onDone={() => { clear(); onApplied(); }} /></Section>}
    </Stack>
  );
}

// The agents' own settings files. Distinct from Preferences, the app's own.
// project: a registered folder; the view then writes only its project and local files.
export function AgentSettings({ overview, params, refresh, project }) {
  const [agent, setAgent] = useState(params.get('agent') === 'codex' ? 'codex' : 'claude');
  const [layer, setLayer] = useState(project || params.get('layer') === 'project' ? 'project' : 'user');
  const [dir, setDir] = useState(project ?? params.get('path'));
  const [advanced, setAdvanced] = useState(false);
  const [edits, setEdits] = useState({});
  const projects = overview.data?.projects ?? [];
  const chosen = layer === 'user' ? undefined : dir ?? projects[0]?.path;
  const query = new URLSearchParams({ agent, ...(chosen ? { dir: chosen } : {}), ...(advanced ? { advanced: '1' } : {}) });
  const state = useApi(layer === 'user' || chosen ? `/api/settings?${query}` : null);
  const setEdit = (key, v) => setEdits((e) => { const n = { ...e }; if (v === undefined) delete n[key]; else n[key] = v; return n; });
  const reset = (f) => (v) => { f(v); setEdits({}); };
  const layers = (agent === 'claude' ? Object.keys(LAYERS) : ['user', 'project']).filter((l) => !project || l !== 'user');
  return (
    <Stack gap="lg">
      <Note>Every change is a plan with a diff, and History undoes it.</Note>
      <Group align="flex-end">
        <SegmentedControl styles={NOFADE} aria-label="Agent" data={[{ value: 'claude', label: 'Claude Code' }, { value: 'codex', label: 'Codex' }]} value={agent} onChange={reset((v) => { setAgent(v); if (v === 'codex' && layer === 'local') setLayer(project ? 'project' : 'user'); })} />
        <Select label="Write to" data={layers.map((l) => ({ value: l, label: LAYERS[l] }))} value={layer} onChange={reset((v) => setLayer(v ?? layer))} allowDeselect={false} comboboxProps={{ withinPortal: false }} />
        {layer !== 'user' && !project && <Select label="Project" data={projects.map((p) => p.path)} value={chosen ?? null} onChange={reset(setDir)} placeholder="register a project first" allowDeselect={false} comboboxProps={{ withinPortal: false }} />}
        <Switch label="Advanced: every key" checked={advanced} onChange={(e) => setAdvanced(e.currentTarget.checked)} />
      </Group>
      {layer !== 'user' && !chosen && <Note color="yellow">The project and local files belong to a registered project: add one under Projects.</Note>}
      {chosen || layer === 'user' ? (
        <Loading state={state} label="settings">
          {(data) => <Editor key={`${agent}-${layer}-${chosen}`} data={data} agent={agent} layer={layer} dir={chosen} edits={edits} setEdit={setEdit} clear={() => setEdits({})} advanced={advanced} onApplied={() => { state.reload(); refresh(); }} />}
        </Loading>
      ) : null}
    </Stack>
  );
}
