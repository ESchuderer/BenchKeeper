import { ActionIcon, Anchor, AppShell, Badge, Burger, Button, Drawer, Group, Kbd, MantineProvider, NavLink, Stack, Text, Title, createTheme, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { useDisclosure, useHotkeys } from '@mantine/hooks';
import { Spotlight, spotlight } from '@mantine/spotlight';
import { IconBooks, IconChartBar, IconFolders, IconHistory, IconLayoutDashboard, IconMoon, IconRobot, IconSearch, IconSettings, IconSun } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
// The repository's logo, as on the site; black on white, inverted in dark mode like there.
import logo from '../../assets/logo.svg';
import { api } from './api.js';
import { RunProgress } from './parts.jsx';
import { Dot, MOD, go, href, icon, useApi, useRoute } from './shell.jsx';
import { AdviceJob } from './setup.jsx';
import { Agents, Catalog, Dashboard, EvalJob, Evals, History, Projects, Settings } from './views.jsx';

// Descriptions in the text color: Mantine's dimmed default is below 4.5:1 on white.
const described = { styles: { description: { color: 'var(--mantine-color-text)' } } };
const theme = createTheme({
  primaryColor: 'teal', primaryShade: { light: 9, dark: 9 }, defaultRadius: 'md',
  fontFamily: "'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontFamilyMonospace: "ui-monospace, 'SF Mono', 'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, monospace",
  headings: {
    fontWeight: '650',
    sizes: { h1: { fontSize: '1.375rem', lineHeight: '1.3' }, h2: { fontSize: '1.25rem', lineHeight: '1.35' }, h3: { fontSize: '1.0625rem', lineHeight: '1.4' },
      h4: { fontSize: '1rem', lineHeight: '1.45' }, h5: { fontSize: '0.9375rem', lineHeight: '1.5' }, h6: { fontSize: '0.75rem', lineHeight: '1.5' } },
  },
  components: { Checkbox: described, Radio: described, Switch: described, InputWrapper: described, Paper: { defaultProps: { shadow: 'xs' } } },
});
// Chart colors per scheme, checked with the dataviz palette validator: shade 9 is too dark on the dark surface.
const chartColors = (t) => ({ variables: {}, light: { '--bk-miss': t.colors.teal[9], '--bk-false-trigger': t.colors.indigo[9] }, dark: { '--bk-miss': t.colors.teal[7], '--bk-false-trigger': t.colors.indigo[6] } });
// Dashboard and Projects first: the views used most.
const VIEWS = [['dashboard', 'Dashboard', Dashboard, IconLayoutDashboard], ['projects', 'Projects', Projects, IconFolders], ['catalog', 'Catalog', Catalog, IconBooks], ['agents', 'Agents', Agents, IconRobot],
  ['history', 'History', History, IconHistory], ['evals', 'Evals', Evals, IconChartBar], ['settings', 'Settings', Settings, IconSettings]];

function DoctorBadge({ doctor }) {
  if (!doctor.data) return <Badge variant="default">Doctor: {doctor.error ? 'failed' : 'checking'}</Badge>;
  const errors = doctor.data.filter((i) => i.level === 'error').length, warnings = doctor.data.length - errors;
  return (
    <Anchor href={href('dashboard', { panel: 'doctor' })} underline="never">
      <Badge variant="default" leftSection={<Dot color={errors ? 'red' : warnings ? 'yellow' : 'teal'} />}>Doctor: {errors} errors, {warnings} warnings</Badge>
    </Anchor>
  );
}

// Jobs that run on the server (apply, evals, setup suggestions), found again after a reload or on another view.
function RunningJobs({ onDone }) {
  const [jobs, setJobs] = useState([]);
  const [open, setOpen] = useState(false);
  const seen = useRef(0);
  useEffect(() => {
    let live = true, timer;
    const poll = async () => {
      try {
        const j = await api('/api/jobs');
        if (!live) return;
        if (j.length < seen.current) onDone();
        seen.current = j.length;
        setJobs(j);
      } catch { /* the next poll tries again */ }
      timer = setTimeout(poll, 2000);
    };
    poll();
    return () => { live = false; clearTimeout(timer); };
  }, []);
  if (!jobs.length && !open) return null;
  return (
    <>
      {!!jobs.length && <Button variant="default" onClick={() => setOpen(true)} leftSection={<Dot color="blue" />}>{jobs.length} running</Button>}
      <Drawer opened={open} onClose={() => setOpen(false)} position="right" size="lg" withCloseButton={false} attributes={{ content: { 'aria-label': 'Running jobs' } }}>
        <Stack gap="lg">
          <Group justify="space-between"><Title order={2} size="h3">Running jobs</Title><Button variant="default" onClick={() => setOpen(false)}>Close</Button></Group>
          {!jobs.length && <Text>Nothing is running.</Text>}
          {jobs.map((j) => (
            <Stack key={j.id} gap="xs">
              <Text fw={600}>{j.kind === 'apply' ? `Apply: ${j.title}` : j.kind === 'eval' ? 'Evals' : `Agent session: ${j.title}`}</Text>
              {j.kind === 'apply' ? <RunProgress job={j.id} total={j.total} /> : j.kind === 'eval' ? <EvalJob job={j.id} total={j.total} /> : <AdviceJob job={j.id} name="The agent" />}
            </Stack>
          ))}
        </Stack>
      </Drawer>
    </>
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
            <Group gap={8} wrap="nowrap"><img src={logo} alt="" width={30} height={30} style={scheme === 'dark' ? { filter: 'invert(1)' } : undefined} /><Title order={1} size="h4">BenchKeeper</Title></Group>
            {o && <Badge variant="outline" visibleFrom="xs">{o.version}</Badge>}
            <Group visibleFrom="md"><DoctorBadge doctor={doctor} /></Group>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <RunningJobs onDone={() => refresh()} />
            <Button leftSection={icon(IconSearch)} variant="default" onClick={spotlight.open} rightSection={<Kbd visibleFrom="sm">{MOD}+K</Kbd>}>Search</Button>
            <ActionIcon variant="default" size={36} onClick={toggleTheme} aria-label={scheme === 'dark' ? 'Light theme' : 'Dark theme'}>{icon(scheme === 'dark' ? IconSun : IconMoon, 18)}</ActionIcon>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs" aria-label="Views">
        {VIEWS.map(([id, label, , Icon]) => (
          <NavLink key={id} component="a" href={href(id)} label={label} leftSection={icon(Icon, 18)} active={view === id} variant="filled" color="dark" aria-current={view === id ? 'page' : undefined}
            rightSection={counts[id] ? <Badge variant="default" size="sm">{counts[id]}</Badge> : null} />
        ))}
        <Text size="xs" mt="auto" p="xs">{MOD}+1 to {MOD}+{VIEWS.length}: views</Text>
      </AppShell.Navbar>
      <AppShell.Main>
        <View key={view} params={params} overview={overview} doctor={doctor} history={history} catalog={catalog} refresh={refresh} />
      </AppShell.Main>
      <Spotlight actions={actions} shortcut={['mod + K', '/']} nothingFound="Nothing found" highlightQuery attributes={{ content: { 'aria-label': 'Command palette' } }} searchProps={{ placeholder: 'Views, projects, skills, runs, actions', 'aria-label': 'Search' }}
        scrollAreaProps={{ viewportProps: { tabIndex: 0, 'aria-label': 'Results' } }} styles={{ actionDescription: { color: 'var(--mantine-color-text)' } }} />
    </AppShell>
  );
}

export default function App() {
  return <MantineProvider theme={theme} defaultColorScheme="auto" cssVariablesResolver={chartColors}><Shell /></MantineProvider>;
}
