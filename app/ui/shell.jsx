import { Alert, Box, Grid, Paper, ScrollArea, Text } from '@mantine/core';
import { IconAlertCircle, IconAlertTriangle, IconCircleCheck, IconInfoCircle } from '@tabler/icons-react';
import { useEffect, useState } from 'react';

export { RANK } from '../src/states.mjs';

// The view and its parameters live in the hash (#/projects?path=...), so reloads and the palette can deep-link.
const parse = () => {
  const [view, query = ''] = window.location.hash.replace(/^#\/?/, '').split('?');
  return { view: view || 'dashboard', params: new URLSearchParams(query) };
};
export const href = (view, params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  return `#/${view}${q ? `?${q}` : ''}`;
};
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
export const STATE_COLOR = { current: 'teal', absent: 'gray', outdated: 'yellow', missing: 'orange', modified: 'indigo', removed: 'red', foreign: 'grape', error: 'red', behind: 'yellow', ok: 'teal', attention: 'yellow', problem: 'red' };
export const Dot = ({ color }) => <Box component="span" aria-hidden w={8} h={8} display="inline-block" style={{ borderRadius: 4, background: `var(--mantine-color-${color}-filled)` }} />;

// List on the left, the chosen item's detail on the right (sticky); stacked below md.
export function SplitView({ list, detail, empty, span = 5 }) {
  return (
    <Grid gutter="lg">
      <Grid.Col span={{ base: 12, md: span }}>
        <ScrollArea.Autosize mah="calc(100vh - 220px)" type="auto" offsetScrollbars>{list}</ScrollArea.Autosize>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 12 - span }}>
        <Paper withBorder p="md" style={{ position: 'sticky', top: 'calc(var(--app-shell-header-height, 0px) + var(--mantine-spacing-md))' }}>
          {detail ?? <Text>{empty}</Text>}
        </Paper>
      </Grid.Col>
    </Grid>
  );
}

// A file for the browser to save, from text the server returned.
export function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Decorative: the text next to an icon names the action, so screen readers skip the icon.
export const icon = (Icon, size = 16) => <Icon size={size} stroke={1.75} aria-hidden="true" />;
const ALERT_ICON = { red: IconAlertCircle, yellow: IconAlertTriangle, teal: IconCircleCheck };
// An Alert with the icon of its color.
export const Note = ({ color = 'blue', ...props }) => <Alert color={color} icon={icon(ALERT_ICON[color] ?? IconInfoCircle, 20)} {...props} />;
