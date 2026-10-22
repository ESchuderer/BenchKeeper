import { Anchor, AppShell, Badge, Burger, Button, Group, Kbd, MantineProvider, NavLink, Text, Title, createTheme, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { useDisclosure, useHotkeys } from '@mantine/hooks';
import { Spotlight, spotlight } from '@mantine/spotlight';
import { useEffect } from 'react';
import { useApi } from './parts.jsx';
import { Dot, MOD, go, href, useRoute } from './shell.jsx';
import { Agents, Catalog, Dashboard, Evals, History, Projects, Settings } from './views.jsx';

// Descriptions in the text color: Mantine's dimmed default is below 4.5:1 on white.
const described = { styles: { description: { color: 'var(--mantine-color-text)' } } };
const theme = createTheme({ primaryColor: 'teal', primaryShade: { light: 9, dark: 9 }, defaultRadius: 'md',
  components: { Checkbox: described, Radio: described, Switch: described, InputWrapper: described } });
const VIEWS = [['dashboard', 'Dashboard', Dashboard], ['catalog', 'Catalog', Catalog], ['agents', 'Agents', Agents], ['projects', 'Projects', Projects], ['history', 'History', History], ['evals', 'Evals', Evals], ['settings', 'Settings', Settings]];

function DoctorBadge({ doctor }) {
  if (!doctor.data) return <Badge variant="default">Doctor: {doctor.error ? 'failed' : 'checking'}</Badge>;
  const errors = doctor.data.filter((i) => i.level === 'error').length, warnings = doctor.data.length - errors;
  return (
    <Anchor href={href('dashboard', { panel: 'doctor' })} underline="never">
      <Badge variant="default" leftSection={<Dot color={errors ? 'red' : warnings ? 'yellow' : 'teal'} />}>Doctor: {errors} errors, {warnings} warnings</Badge>
    </Anchor>
  );
}

function Shell() {
  const { view, params } = useRoute();
  const [nav, { toggle, close }] = useDisclosure();
  const overview = useApi('/api/overview');
  // Fetched once here: the header badge and the Dashboard share it, and it makes a registry request.
  const doctor = useApi('/api/doctor');
  const history = useApi('/api/history');
  const catalog = useApi('/api/catalog');
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme('light');
  // After any change: the header, sidebar counts, palette and views read these.
  const refresh = () => { overview.reload(); doctor.reload(); history.reload(); catalog.reload(); };
  const toggleTheme = () => setColorScheme(scheme === 'dark' ? 'light' : 'dark');
  // Spotlight binds mod+K itself.
  useHotkeys([...VIEWS.map(([id], i) => [`mod+${i + 1}`, () => go(id)]), ['mod+J', toggleTheme]]);
  useEffect(close, [view, params.toString()]);
  const o = overview.data;
  const counts = { dashboard: doctor.data?.length, projects: o?.projects.filter((p) => p.setupVersion !== o.version).length, history: history.data?.length };
  const actions = [
    { group: 'Views', actions: VIEWS.map(([id, label]) => ({ id: `view-${id}`, label, onClick: () => go(id) })) },
    { group: 'Projects', actions: (o?.projects ?? []).map((p) => ({ id: `project-${p.path}`, label: p.path, onClick: () => go('projects', { path: p.path }) })) },
    { group: 'Skills', actions: (catalog.data?.skills ?? []).map((s) => ({ id: `skill-${s.name}`, label: s.name, description: s.pickWhen, onClick: () => go('catalog', { skill: s.name }) })) },
    { group: 'Runs', actions: (history.data ?? []).slice(0, 20).map((r) => ({ id: `run-${r.id}`, label: `${r.kind} ${r.scope}`, description: r.id, onClick: () => go('history', { run: r.id }) })) },
    { group: 'Actions', actions: [
      { id: 'plan-global', label: 'Plan global setup', onClick: () => go('agents', { plan: '1' }) },
      { id: 'doctor', label: 'Run doctor', onClick: () => { doctor.reload(); go('dashboard', { panel: 'doctor' }); } },
      { id: 'theme', label: 'Toggle theme', onClick: toggleTheme },
    ] },
  ];
  const View = (VIEWS.find(([id]) => id === view) ?? VIEWS[0])[2];
  return (
    <AppShell header={{ height: 60 }} navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !nav } }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={nav} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Views" />
            <Title order={1} size="h4">BenchKeeper</Title>
            {o && <Badge variant="outline" visibleFrom="xs">{o.version}</Badge>}
            <Group visibleFrom="md"><DoctorBadge doctor={doctor} /></Group>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Button variant="default" onClick={spotlight.open} rightSection={<Kbd visibleFrom="sm">{MOD}+K</Kbd>}>Search</Button>
            <Button variant="default" onClick={toggleTheme} aria-label={scheme === 'dark' ? 'Light theme' : 'Dark theme'}>{scheme === 'dark' ? 'Light' : 'Dark'}</Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs" aria-label="Views">
        {VIEWS.map(([id, label]) => (
          <NavLink key={id} component="a" href={href(id)} label={label} active={view === id} variant="filled" color="dark" aria-current={view === id ? 'page' : undefined}
            rightSection={counts[id] ? <Badge variant="default" size="sm">{counts[id]}</Badge> : null} />
        ))}
        <Text size="xs" mt="auto" p="xs">{MOD}+1 to {MOD}+{VIEWS.length}: views</Text>
      </AppShell.Navbar>
      <AppShell.Main>
        <View key={view} params={params} overview={overview} doctor={doctor} history={history} catalog={catalog} refresh={refresh} />
      </AppShell.Main>
      <Spotlight actions={actions} nothingFound="Nothing found" highlightQuery attributes={{ content: { 'aria-label': 'Command palette' } }} searchProps={{ placeholder: 'Views, projects, skills, runs, actions', 'aria-label': 'Search' }}
        scrollAreaProps={{ viewportProps: { tabIndex: 0, 'aria-label': 'Results' } }} styles={{ actionDescription: { color: 'var(--mantine-color-text)' } }} />
    </AppShell>
  );
}

export default function App() {
  return <MantineProvider theme={theme} defaultColorScheme="auto"><Shell /></MantineProvider>;
}
