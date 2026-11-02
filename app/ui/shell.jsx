import { Alert, Badge, Box, Button, Grid, Group, Loader, Paper, ScrollArea, Stack, Text, VisuallyHidden } from '@mantine/core';
import { IconAlertCircle, IconAlertTriangle, IconCircleCheck, IconInfoCircle } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { NO_SESSION, api } from './api.js';

export { RANK } from '../src/states.mjs';

// The view, its sub path and its parameters live in the hash (#/projects/<folder>/sessions?run=...), so reloads and the
// palette can deep-link.
const parse = () => {
  const [path, query = ''] = window.location.hash.replace(/^#\/?/, '').split('?');
  const [view, ...rest] = path.split('/');
  return { view: view || 'dashboard', rest, params: new URLSearchParams(query) };
};
export const href = (view, params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  return `#/${view}${q ? `?${q}` : ''}`;
};
// A project's own page: its folder, encoded into one segment, then the tab.
export const projectHref = (path, tab, params) => href(`projects/${encodeURIComponent(path)}${tab ? `/${tab}` : ''}`, params);
export const MOD = /Mac/.test(navigator.platform) ? 'Cmd' : 'Ctrl';
export const go = (view, params) => { window.location.hash = href(view, params); };

export function useRoute() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

// Status colors always come with a text label; the dot only repeats it.
export const STATE_COLOR = { current: 'teal', installed: 'teal', absent: 'gray', outdated: 'yellow', missing: 'orange', modified: 'indigo', removed: 'red', foreign: 'grape', error: 'red', behind: 'yellow', ok: 'teal', attention: 'yellow', problem: 'red' };
export const Dot = ({ color }) => <Box component="span" aria-hidden className="bk-dot" w={8} h={8} display="inline-block" style={{ borderRadius: 4, background: `var(--mantine-color-${color}-filled)`, color: `var(--mantine-color-${color}-filled)` }} />;

// Object.groupBy needs browsers from 2024 on.
export const groupBy = (xs, key) => xs.reduce((m, x) => { (m[key(x)] ??= []).push(x); return m; }, {});

// Loads a GET endpoint; reload() fetches it again and keeps the data meanwhile, another path drops it. A request for
// an older path or load is aborted; no path clears it.
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: !!path, path });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) { setState({ data: null, error: null, loading: false, path }); return undefined; }
    const ac = new AbortController();
    setState((s) => (s.path === path ? { ...s, loading: true } : { data: null, error: null, loading: true, path }));
    api(path, undefined, { signal: ac.signal }).then((data) => !ac.signal.aborted && setState({ data, error: null, loading: false, path }), (e) => !ac.signal.aborted && setState({ data: null, error: e.message, loading: false, path }));
    return () => ac.abort();
  }, [path, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  // Until the effect runs for a new path, the old path's data must not show under it.
  return { ...(state.path === path ? state : { data: null, error: null, loading: true }), reload };
}

// For an action that removes the row it sits in: announce(id, text) moves focus to the element with that id once the
// render is done, and the status line says what happened.
export function useAnnounce() {
  const [said, setSaid] = useState(null);
  useEffect(() => { if (said) document.getElementById(said.id)?.focus(); }, [said]);
  return [<VisuallyHidden role="status">{said?.text}</VisuallyHidden>, useCallback((id, text) => setSaid({ id, text }), [])];
}

export function Loading({ state, label, children }) {
  if (state.error) return <Note color="red" title={`${label[0].toUpperCase()}${label.slice(1)} not loaded`}><Group gap="sm">{state.error}{state.reload && state.error !== NO_SESSION && <Button size="xs" variant="default" onClick={state.reload}>Try again</Button>}</Group></Note>;
  // No data yet also covers the first render after the path changes, before the effect marks it loading.
  if (state.data == null) return <Group gap="xs" role="status"><Loader size="sm" /><Text size="sm">Loading {label}</Text></Group>;
  return children(state.data);
}

const STATUS_COLOR = { done: 'teal', ready: 'teal', failed: 'red', skipped: 'gray', running: 'blue', waiting: 'gray', manual: 'yellow', cancelled: 'gray' };
export const StatusBadge = ({ status }) => <Badge variant="default" miw="max-content" leftSection={<Dot color={STATUS_COLOR[status] ?? 'gray'} />}>{status}</Badge>;

// List on the left, the chosen item's detail on the right (sticky); stacked below md.
export function SplitView({ list, detail, empty, span = 5 }) {
  return (
    <Grid gutter="lg">
      <Grid.Col span={{ base: 12, md: span }}>
        <ScrollArea.Autosize mah={{ base: 'none', md: 'calc(100vh - 220px)' }} type="auto" offsetScrollbars>{list}</ScrollArea.Autosize>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 12 - span }}>
        <Paper withBorder p="md" style={{ position: 'sticky', top: 'calc(var(--app-shell-header-height, 0px) + var(--mantine-spacing-md))' }}>
          {detail ?? <Text>{empty}</Text>}
        </Paper>
      </Grid.Col>
    </Grid>
  );
}

export function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Decorative: the text next to an icon names the action, so screen readers skip the icon.
export const icon = (Icon, size = 16) => <Icon size={size} stroke={1.75} aria-hidden="true" />;

// A long key or path breaks after . / _ - or between camelCase words, never inside a word; <wbr> adds no character to
// copied text. A word longer than the line still breaks (overflow-wrap: break-word where it is used).
export const breakAt = (text) => String(text).split(/(?<=[./_-])|(?<=[a-z])(?=[A-Z])/).flatMap((part, n) => (n ? [<wbr key={n} />, part] : [part]));
// A table wider than its column shows its scrollbar while it overflows, so a phone shows that more is to the side
// (Mantine's default shows it on hover only, which touch has not).
export const SCROLL_CUE = { type: 'auto' };
const ALERT_ICON = { red: IconAlertCircle, yellow: IconAlertTriangle, teal: IconCircleCheck };
// An Alert with the icon of its color. A teal title has 4.32:1 on the light teal background, so it takes the text color.
const TITLE = { teal: { title: { color: 'var(--mantine-color-text)' } } };
export const Note = ({ color = 'blue', ...props }) => <Alert color={color} icon={icon(ALERT_ICON[color] ?? IconInfoCircle, 20)} styles={TITLE[color]} {...props} />;

// A change's diff (or another detail) behind a button: a long page stays short until one is opened.
export function Folded({ title, children, label = ['Show diff', 'Hide diff'], name = `diff of ${title}`, initial = false }) {
  const [open, setOpen] = useState(initial);
  return (
    <Stack gap={4}>
      <Group><Button size="compact-xs" variant="default" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} ${name}`} onClick={() => setOpen(!open)}>{label[open ? 1 : 0]}</Button></Group>
      {open && children}
    </Stack>
  );
}
