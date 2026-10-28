import { ActionIcon, Alert, Anchor, AppShell, Badge, Burger, Button, Code, Drawer, Group, Kbd, MantineProvider, Modal, NavLink, Loader, Stack, Text, Title, createTheme, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { useDisclosure, useHotkeys, useMediaQuery } from '@mantine/hooks';
import { Spotlight, spotlight } from '@mantine/spotlight';
import { IconActivity, IconAdjustmentsHorizontal, IconBooks, IconCalendarTime, IconChartBar, IconBulb, IconCode, IconFileText, IconFolders, IconHistory, IconListTree, IconLayoutDashboard, IconMoon, IconPlug, IconPower, IconRobot, IconSearch, IconSettings, IconSun, IconUsers } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
// The repository's logo, as on the site; black on white, inverted in dark mode like there.
import logo from '../../assets/logo.svg';
import { PRIMARY, SHAPE, varsOf } from '../src/tokens.mjs';
import { api } from './api.js';
import { EvalJob, RunProgress } from './parts.jsx';
import { Dot, MOD, go, href, icon, projectHref, useApi, useRoute } from './shell.jsx';
import { AdviceJob } from './setup.jsx';
import { FixEverything } from './fix.jsx';
import { ApplyProgress, OneRunDrawer, OneRunProvider } from './onerun.jsx';
import { AgentSettings } from './agentsettings.jsx';
import { Runs } from './runs.jsx';
import { Accounts } from './accounts.jsx';
import { Automations } from './automations.jsx';
import { Extensions } from './extensions.jsx';
import { Insights } from './insights.jsx';
import { Rules } from './rules.jsx';
import { Editors } from './editors.jsx';
import { Agents, Catalog, Dashboard, Evals, History, Sessions, Settings } from './views.jsx';
import { Projects } from './project.jsx';

// Descriptions in the text color: Mantine's dimmed default is below 4.5:1 on white.
const described = { styles: { description: { color: 'var(--mantine-color-text)' } } };
const theme = createTheme({
  respectReducedMotion: true,
  colors: { bench: PRIMARY }, primaryColor: 'bench', primaryShade: { light: 9, dark: 9 }, defaultRadius: 'md',
  // The board's card radius and shadow; the shadow differs per scheme, so it is the variable.
  radius: { md: SHAPE['radius-sm'], lg: SHAPE.radius },
  shadows: { xs: 'var(--bk-shadow)', sm: 'var(--bk-shadow)' },
  fontFamily: "'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontFamilyMonospace: SHAPE.mono,
  headings: {
    fontWeight: '650',
    sizes: { h1: { fontSize: '1.375rem', lineHeight: '1.3' }, h2: { fontSize: '1.25rem', lineHeight: '1.35' }, h3: { fontSize: '1.0625rem', lineHeight: '1.4' },
      h4: { fontSize: '1rem', lineHeight: '1.45' }, h5: { fontSize: '0.9375rem', lineHeight: '1.5' }, h6: { fontSize: '0.75rem', lineHeight: '1.5' } },
  },
  components: {
    Checkbox: described, Radio: described, Switch: described, InputWrapper: described,
    Paper: { defaultProps: { shadow: 'xs', radius: 'lg' } }, Card: { defaultProps: { shadow: 'xs', radius: 'lg', withBorder: true } },
    Badge: { defaultProps: { radius: 'xl' } }, NavLink: { defaultProps: { variant: 'light' } }, Progress: { defaultProps: { radius: 'xl' } },
  },
});
// The board's tokens as variables per scheme (--bk-page, --bk-s1, ...); text, dimmed text and the chart grid come from
// them and hold 4.5:1 on page and surface (tested in board.test.mjs).
const resolver = () => Object.fromEntries(['light', 'dark'].map((s) => [s, {
  ...varsOf(s, 'bk-', true), '--mantine-color-text': 'var(--bk-ink)', '--mantine-color-dimmed': 'var(--bk-ink-2)', '--mantine-color-body': 'var(--bk-surface)',
}]).concat([['variables', {}]]));
// The sidebar's groups; Ctrl+1 to Ctrl+9 open the first nine views in this order.
const GROUPS = [
  ['Overview', [['dashboard', 'Dashboard', Dashboard, IconLayoutDashboard], ['history', 'History', History, IconHistory]]],
  ['Projects', [['projects', 'Projects', Projects, IconFolders], ['catalog', 'Catalog', Catalog, IconBooks]]],
  ['Analysis', [['sessions', 'Sessions', Sessions, IconActivity], ['runs', 'Runs', Runs, IconListTree], ['insights', 'Insights', Insights, IconBulb], ['evals', 'Evals', Evals, IconChartBar]]],
  ['Agent configuration', [['agents', 'Global setup', Agents, IconRobot], ['agent-settings', 'Agent settings', AgentSettings, IconAdjustmentsHorizontal], ['rules', 'Rules', Rules, IconFileText], ['extensions', 'Extensions', Extensions, IconPlug], ['accounts', 'Accounts', Accounts, IconUsers]]],
  ['Machine', [['automations', 'Automations', Automations, IconCalendarTime], ['settings', 'Preferences', Settings, IconSettings]]],
];
const VIEWS = GROUPS.flatMap(([, views]) => views);
// The "Advanced" group: only while its setting is on, else the route does not exist.
const ADVANCED = [['editors', 'Presets, pins and policy', Editors, IconCode]];

// The "/" key opens the palette unless turned off in Preferences (WCAG 2.1.4: a character-key shortcut must be switchable).
const SLASH = 'bk-slash';
function useSlash() {
  const [on, set] = useState(() => { try { return localStorage.getItem(SLASH) !== 'off'; } catch { return true; } });
  return [on, (v) => { set(v); try { localStorage.setItem(SLASH, v ? 'on' : 'off'); } catch { /* lasts for this page */ } }];
}

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
    let live = true, timer, busy = false;
    // A hidden tab neither asks nor keeps a timer; it asks at once when it is shown again.
    const poll = async () => {
      if (document.hidden) return;
      busy = true;
      try {
        const j = await api('/api/jobs');
        if (!live) return;
        if (j.length < seen.current) onDone();
        seen.current = j.length;
        setJobs(j);
      } catch { /* the next poll tries again */ } finally { busy = false; }
      if (live) timer = setTimeout(poll, 2000);
    };
    const shown = () => { if (!document.hidden && !busy) { clearTimeout(timer); poll().catch(console.error); } };
    document.addEventListener('visibilitychange', shown);
    poll().catch(console.error);
    return () => { live = false; clearTimeout(timer); document.removeEventListener('visibilitychange', shown); };
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
              <Text fw={600}>{j.kind === 'apply' ? `Apply: ${j.title}` : j.kind === 'apply-all' ? 'One-run setup' : j.kind === 'eval' ? 'Evals' : `Agent session: ${j.title}`}</Text>
              {j.kind === 'apply' ? <RunProgress job={j.id} total={j.total} /> : j.kind === 'apply-all' ? <ApplyProgress job={j.id} total={j.total} /> : j.kind === 'eval' ? <EvalJob job={j.id} total={j.total} /> : <AdviceJob job={j.id} name="The agent" />}
            </Stack>
          ))}
        </Stack>
      </Drawer>
    </>
  );
}

// Full screen until the first overview arrives, so the views never show 0 agents or an error for what is only not loaded yet.
function Splash({ error, retry }) {
  return (
    <Stack component="main" h="100vh" align="center" justify="center" gap="md" p="md">
      <Title order={1} size="h3">BenchKeeper</Title>
      {error
        ? <Alert color="red" title="Cannot read the setup" maw={480}><Stack gap="sm" align="flex-start">{error}<Button size="xs" variant="default" onClick={retry}>Try again</Button></Stack></Alert>
        : <Group gap="xs" role="status"><Loader size="sm" /><Text size="sm">Starting, reading the setup</Text></Group>}
    </Stack>
  );
}

function Shell() {
  const { view, rest, params } = useRoute();
  const [nav, { toggle, close }] = useDisclosure();
  const [oneRun, setOneRun] = useState(null);
  const overview = useApi('/api/overview');
  // Fetched once here: the header badge and the Dashboard share it, and it makes a registry request.
  const doctor = useApi('/api/doctor');
  const history = useApi('/api/history');
  const catalog = useApi('/api/catalog');
  const [slash, setSlash] = useSlash();
  const [stopOpen, stopModal] = useDisclosure(false);
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme('light');
  // After any change: the header, sidebar counts, palette and views read these.
  const refresh = () => { overview.reload(); doctor.reload(); history.reload(); catalog.reload(); };
  const toggleTheme = () => setColorScheme(scheme === 'dark' ? 'light' : 'dark');
  // Spotlight binds mod+K itself.
  useHotkeys([...VIEWS.slice(0, 9).map(([id], i) => [`mod+${i + 1}`, () => go(id)]), ['mod+J', toggleTheme]]);
  useEffect(close, [view, rest.join('/'), params.toString()]);
  // A refresh that fails clears the overview: the shell stays up on the last one, only the first load shows the splash.
  const seen = useRef(null);
  useEffect(() => { if (overview.data) seen.current = overview.data; }, [overview.data]);
  const o = overview.data ?? seen.current;
  const views = o?.editors ? [...VIEWS, ...ADVANCED] : VIEWS;
  const counts = { dashboard: doctor.data?.length, projects: o?.projects.filter((p) => !p.current).length, history: history.data?.length };
  const actions = [
    { group: 'Views', actions: views.map(([id, label]) => ({ id: `view-${id}`, label, onClick: () => go(id) })) },
    { group: 'Projects', actions: (o?.projects ?? []).map((p) => ({ id: `project-${p.path}`, label: p.path, onClick: () => { window.location.hash = projectHref(p.path); } })) },
    { group: 'Skills', actions: (catalog.data?.skills ?? []).map((s) => ({ id: `skill-${s.name}`, label: s.name, description: s.pickWhen, onClick: () => go('catalog', { skill: s.name }) })) },
    { group: 'Runs', actions: (history.data ?? []).slice(0, 20).map((r) => ({ id: `run-${r.id}`, label: `${r.kind} ${r.scope}`, description: r.id, onClick: () => go('history', { run: r.id }) })) },
    { group: 'Actions', actions: [
      { id: 'plan-global', label: 'Plan global setup', onClick: () => go('agents', { plan: '1' }) },
      { id: 'one-run-everything', label: 'Set up everything in one run', onClick: () => setOneRun('everything') },
      { id: 'one-run-global', label: 'Set up global only in one run', onClick: () => setOneRun('global') },
      { id: 'one-run-projects', label: 'Set up projects in one run', onClick: () => setOneRun('projects') },
      { id: 'doctor', label: 'Run doctor', onClick: () => { doctor.reload(); go('dashboard', { panel: 'doctor' }); } },
      { id: 'theme', label: 'Toggle theme', onClick: toggleTheme },
    ] },
  ];
  const [, label, View] = views.find(([id]) => id === view) ?? VIEWS[0];
  // The title names the view, and a view change moves focus to its heading so a screen reader announces it; not on the
  // first load, and not while a dialog holds the focus.
  const first = useRef(true);
  useEffect(() => {
    document.title = `${label} - BenchKeeper`;
    if (first.current) { first.current = false; return undefined; }
    // The palette is still closing when it sends the user to a view: wait for it, but not for a drawer the user keeps.
    let tries = 0, timer;
    const focus = () => {
      if (!document.querySelector('[role=dialog]')) document.getElementById('view-title')?.focus();
      else if (++tries < 10) timer = setTimeout(focus, 100);
    };
    focus();
    return () => clearTimeout(timer);
  }, [label]);
  // A closed menu on a phone is only moved off screen: its links and buttons must not stay Tab stops.
  const phone = useMediaQuery('(max-width: 47.99em)');
  if (!o) return <Splash error={overview.error} retry={overview.reload} />;
  return (
    <FixEverything version={o?.version} doctor={doctor} onClose={refresh}>
      <OneRunProvider value={setOneRun}>
      <a className="bk-skip" href="#view-title" onClick={(e) => { e.preventDefault(); document.getElementById('view-title')?.focus(); }}>Skip to content</a>
      <AppShell header={{ height: 60 }} navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !nav } }} padding="md">
        <AppShell.Header>
          <Group h="100%" px="md" justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap">
              <Burger opened={nav} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Views" aria-expanded={nav} aria-controls="app-nav" />
              <Group gap={8} wrap="nowrap"><img src={logo} alt="" width={30} height={30} style={scheme === 'dark' ? { filter: 'invert(1)' } : undefined} /><Title order={1} size="h4">BenchKeeper</Title></Group>
              {o && <Badge variant="outline" visibleFrom="xs">{o.version}</Badge>}
              <Group visibleFrom="md"><DoctorBadge doctor={doctor} /></Group>
            </Group>
            <Group gap="xs" wrap="nowrap">
              <RunningJobs onDone={() => refresh()} />
              <Button visibleFrom="sm" leftSection={icon(IconSearch)} variant="default" onClick={spotlight.open} rightSection={<Kbd>{MOD}+K</Kbd>}>Search</Button>
              <ActionIcon hiddenFrom="sm" variant="default" size={36} onClick={spotlight.open} aria-label="Search">{icon(IconSearch, 18)}</ActionIcon>
              <ActionIcon visibleFrom="sm" variant="default" size={36} onClick={toggleTheme} aria-label={scheme === 'dark' ? 'Light theme' : 'Dark theme'}>{icon(scheme === 'dark' ? IconSun : IconMoon, 18)}</ActionIcon>
              <ActionIcon visibleFrom="sm" variant="default" size={36} onClick={stopModal.open} aria-label="Stop BenchKeeper">{icon(IconPower, 18)}</ActionIcon>
            </Group>
          </Group>
        </AppShell.Header>
        <AppShell.Navbar id="app-nav" p="xs" aria-label="Views" inert={phone && !nav ? true : undefined}>
          {[...GROUPS, ...(o.editors ? [['Advanced', ADVANCED]] : [])].map(([group, items], g) => (
            <div key={group} role="group" aria-labelledby={`nav-${g}`}>
              <Text id={`nav-${g}`} size="xs" fw={600} px="sm" pt={g ? 'sm' : 0} pb={4}>{group}</Text>
              {items.map(([id, label, , Icon]) => (
                <NavLink key={id} component="a" href={href(id)} label={label} leftSection={icon(Icon, 18)} active={view === id} aria-current={view === id ? 'page' : undefined}
                  rightSection={counts[id] ? <Badge variant="default" size="sm" className="bk-num">{counts[id]}</Badge> : null} />
              ))}
            </div>
          ))}
          {/* The header has no room for the doctor count below md, nor for theme and Stop below sm: they live here. */}
          <Stack gap="xs" mt="auto" p="xs">
            <Group hiddenFrom="md"><DoctorBadge doctor={doctor} /></Group>
            <Button hiddenFrom="sm" variant="default" leftSection={icon(scheme === 'dark' ? IconSun : IconMoon)} onClick={toggleTheme}>{scheme === 'dark' ? 'Light theme' : 'Dark theme'}</Button>
            <Button hiddenFrom="sm" variant="default" leftSection={icon(IconPower)} onClick={stopModal.open}>Stop BenchKeeper</Button>
          </Stack>
          <Text size="xs" mt="auto" p="xs" visibleFrom="sm">{MOD}+1 to {MOD}+9: the first nine views</Text>
        </AppShell.Navbar>
        <AppShell.Main>
          <Title order={2} size="h3" id="view-title" tabIndex={-1} mb="md" style={{ outline: 'none' }}>{label}</Title>
          <View key={view} rest={rest} params={params} overview={overview} doctor={doctor} history={history} catalog={catalog} refresh={refresh} keys={{ slash, setSlash, views: VIEWS.slice(0, 9).map(([, l]) => l) }} />
        </AppShell.Main>
        <Spotlight actions={actions} shortcut={slash ? ['mod + K', '/'] : 'mod + K'} nothingFound="Nothing found" highlightQuery attributes={{ content: { 'aria-label': 'Command palette' } }} searchProps={{ placeholder: 'Views, projects, skills, runs, actions', 'aria-label': 'Search' }}
          scrollAreaProps={{ viewportProps: { tabIndex: 0, 'aria-label': 'Results' } }} styles={{ actionDescription: { color: 'var(--mantine-color-text)' } }} />
      </AppShell>
      <StopApp version={o?.version} opened={stopOpen} close={stopModal.close} />
      <OneRunDrawer mode={oneRun} onClose={() => { setOneRun(null); refresh(); }} />
      </OneRunProvider>
    </FixEverything>
  );
}

// Stops the local server, as Ctrl+C in its terminal does; the server refuses while an apply or eval runs.
function StopApp({ version, opened, close }) {
  const [state, setState] = useState({ busy: false, error: null, stopped: false });
  const stop = () => {
    setState({ busy: true, error: null, stopped: false });
    api('/api/shutdown', {}).then(() => setState({ busy: false, error: null, stopped: true }), (e) => setState({ busy: false, error: e.message, stopped: false }));
  };
  const title = state.stopped ? 'BenchKeeper stopped' : 'Stop BenchKeeper?';
  return (
    <>
      <Modal opened={opened} onClose={state.stopped ? () => {} : close} withCloseButton={false} attributes={{ content: { 'aria-label': title } }}>
        <Stack gap="sm">
          <Title order={2} size="h4">{title}</Title>
          <Text size="sm">{state.stopped ? 'The server has stopped; you can close this tab.' : 'The local server stops and this page stops working. Scans and agent suggestions still running are cancelled.'}</Text>
          <Text size="sm">Start it again: <Code>npx benchkeeper{version ? `@${version}` : ''}</Code></Text>
          {state.error && <Alert color="red" role="alert" title="Not stopped">{state.error}</Alert>}
          {!state.stopped && (
            <Group justify="flex-end">
              <Button variant="default" onClick={close}>Cancel</Button>
              <Button color="red" loading={state.busy} onClick={stop}>Stop</Button>
            </Group>
          )}
        </Stack>
      </Modal>
    </>
  );
}

export default function App() {
  return <MantineProvider theme={theme} defaultColorScheme="auto" cssVariablesResolver={resolver}><Shell /></MantineProvider>;
}
