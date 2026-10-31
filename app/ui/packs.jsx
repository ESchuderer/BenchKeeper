import { Anchor, Badge, Button, Code, FileButton, Group, Modal, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconDownload, IconTrash, IconUpload } from '@tabler/icons-react';
import { useState } from 'react';
import { api } from './api.js';
import { Cli, Section } from './parts.jsx';
import { plural } from './cards.js';
import { Loading, Note, download, href, icon, useAnnounce } from './shell.jsx';

// Files in the packs folder that are no pack: the library leaves them out, so they are listed here to be removed (the file goes to the backups).
function InvalidPacks({ files, onChange, announce }) {
  const [error, setError] = useState(null);
  // This section goes with its last file: focus then moves to the packs heading.
  const remove = async (file) => {
    setError(null);
    try { await api('/api/packs', { action: 'remove', id: file }); onChange(); announce(files.length > 1 ? 'invalid-packs-title' : 'packs-title', `Removed: ${file}`); } catch (e) { setError(e.message); }
  };
  return (
    <Section title="Pack files that are not packs" id="invalid-packs">
      {error && <Note color="red" title="Failed">{error}</Note>}
      {files.map(({ file, reason }) => (
        <Group key={file} justify="space-between" wrap="nowrap">
          <Text size="sm"><Code>{file}</Code>: {reason}</Text>
          <Button leftSection={icon(IconTrash)} size="xs" variant="subtle" aria-label={`Remove ${file}`} onClick={() => remove(file)}>Remove</Button>
        </Group>
      ))}
    </Section>
  );
}

const SHOWN = 3;
const usedBy = (p) => (p.usedBy?.length ? `Used by ${p.usedBy.map((d) => d.split('/').pop()).join(', ')}` : 'Not used');

// The first skills of a pack as chips, the rest one click away.
function SkillChips({ pack }) {
  const [all, setAll] = useState(false);
  const extra = pack.skills.length - SHOWN;
  return (
    <Group gap={4}>
      {(all ? pack.skills : pack.skills.slice(0, SHOWN)).map((n) => <Badge key={n} variant="default" size="sm" tt="none">{n}</Badge>)}
      {extra > 0 && <Button size="compact-xs" variant="subtle" aria-expanded={all} aria-label={`${all ? 'Fewer' : `+${extra} more`} skills of ${pack.id}`} onClick={() => setAll(!all)}>{all ? 'Fewer' : `+${extra}`}</Button>}
    </Group>
  );
}

function PackCard({ pack: p, run, announce }) {
  return (
    <Paper withBorder p="sm" role="group" aria-label={`Pack ${p.id}`}>
      <Stack gap={6} h="100%" justify="space-between">
        <Stack gap={6}>
          <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
            <div style={{ overflowWrap: 'anywhere' }}><Text fw={600} size="sm">{p.title ?? p.id}</Text><Text size="xs">{p.id}</Text></div>
            <Group gap={6} wrap="nowrap">
              {p.own && <Badge variant="default" size="sm">own</Badge>}
              {p.skills && <Text size="xs" style={{ whiteSpace: 'nowrap' }}>{plural(p.skills.length, 'skill')}</Text>}
            </Group>
          </Group>
          {p.skills ? <SkillChips pack={p} /> : <Text size="xs" style={{ overflowWrap: 'anywhere' }}>plugin: {[...new Set(Object.values(p.plugins ?? {}).map((x) => x.id))].join(', ')}</Text>}
        </Stack>
        <Group justify="space-between" gap="xs">
          <Text size="xs">{usedBy(p)}</Text>
          <Group gap="xs" wrap="nowrap">
            {p.skills && <Button leftSection={icon(IconDownload)} size="xs" variant="default" aria-label={`Export ${p.id}`} onClick={run(async () => { const r = await api(`/api/pack-export?id=${encodeURIComponent(p.id)}`); download(r.name, r.text); })}>Export</Button>}
            {p.own && <Button leftSection={icon(IconTrash)} size="xs" variant="subtle" aria-label={`Remove ${p.id}`} disabled={!!p.usedBy?.length} title={p.usedBy?.length ? `In use by ${p.usedBy.join(', ')}: switch it off there first` : undefined} onClick={run(async () => { await api('/api/packs', { action: 'remove', id: p.id }); announce('packs-title', `Removed: ${p.id}`); })}>Remove</Button>}
          </Group>
        </Group>
      </Stack>
    </Paper>
  );
}

const Cards = ({ list, run, announce }) => <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs">{list.map((p) => <PackCard key={p.id} pack={p} run={run} announce={announce} />)}</SimpleGrid>;

function Packs({ packs, onChange, announce }) {
  const [error, setError] = useState(null);
  const [file, setFile] = useState(0);
  // A pack file whose id is an own pack's: asked first, the old file goes to the backup.
  const [replace, setReplace] = useState(null);
  const run = (f) => async (...a) => { setError(null); try { await f(...a); onChange(); } catch (e) { setError(e.message); } };
  const importText = run(async (text) => { setReplace(null); await api('/api/packs', { action: 'import', text }); setFile((n) => n + 1); });
  const plugins = packs.filter((p) => !p.skills), library = packs.filter((p) => p.skills);
  return (
    <>
      <Group justify="space-between" align="flex-start">
        <Text size="sm">A pack is switched on or off per project, on the project's Installs tab: <Anchor href={href('projects')} underline="always">Projects</Anchor>.</Text>
        <FileButton key={file} accept="application/json,.json"
          onChange={async (f) => {
            if (!f) return;
            setError(null);
            let text;
            try { text = await f.text(); } catch (e) { setError(e.message); return; }
            let id; try { id = JSON.parse(text).id; } catch { /* the server names what is wrong */ }
            if (packs.some((p) => p.own && p.id === id)) setReplace({ id, text }); else await importText(text);
          }}>
          {(props) => <Button leftSection={icon(IconUpload)} variant="default" {...props}>Import pack file</Button>}
        </FileButton>
      </Group>
      {error && <Note color="red" title="Failed">{error}</Note>}
      {plugins.length > 0 && <Section title="Plugin packs" id="plugin-packs"><Cards list={plugins} run={run} announce={announce} /></Section>}
      <Section title="Library and own packs" id="packs"><Cards list={library} run={run} announce={announce} /></Section>
      <Modal opened={!!replace} onClose={() => { setReplace(null); setFile((n) => n + 1); }} withCloseButton={false} attributes={{ content: { 'aria-label': `Replace pack ${replace?.id}?` } }}>
        <Stack gap="sm">
          <Title order={2} size="h4">Replace pack {replace?.id}?</Title>
          <Text size="sm">An own pack with this id exists. Its file goes to the run backups, as when a pack is removed.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => { setReplace(null); setFile((n) => n + 1); }}>Cancel</Button>
            <Button onClick={() => importText(replace.text)}>Replace pack {replace?.id}</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

// The Catalog's second page: the library packs and the own ones, defined once; a project switches them on its Installs tab.
export function CatalogPacks({ catalog, refresh }) {
  // Here and not in the packs sections: the section of files that are not packs goes with its last file.
  const [status, announce] = useAnnounce();
  return (
    <Loading state={catalog} label="catalog">{(c) => (
      <Stack gap="lg">
        <Packs packs={c.packs} onChange={refresh} announce={announce} />
        {c.invalidPacks?.length > 0 && <InvalidPacks files={c.invalidPacks} onChange={refresh} announce={announce} />}
        {status}
        <Cli>{'benchkeeper packs list\nbenchkeeper packs show|export|remove <id>\nbenchkeeper packs import <file>\nbenchkeeper packs enable|disable <id> --project <dir>'}</Cli>
      </Stack>
    )}</Loading>
  );
}
