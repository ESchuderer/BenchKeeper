import { Box, Grid, Paper, ScrollArea, Text } from '@mantine/core';
import { useEffect, useState } from 'react';

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

// Worst last, as in src/inventory.mjs.
export const RANK = ['current', 'absent', 'outdated', 'missing', 'modified', 'removed', 'foreign', 'error'];
// Status colors always come with a text label; the dot only repeats it.
export const STATE_COLOR = { current: 'teal', absent: 'gray', outdated: 'yellow', missing: 'orange', modified: 'indigo', removed: 'red', foreign: 'grape', error: 'red', behind: 'yellow', ok: 'teal', attention: 'yellow', problem: 'red' };
export const Dot = ({ color }) => <Box component="span" aria-hidden w={8} h={8} display="inline-block" style={{ borderRadius: 4, background: `var(--mantine-color-${color}-filled)` }} />;

// List on the left, the chosen item's detail on the right (sticky); stacked below md.
export function SplitView({ list, detail, empty }) {
  return (
    <Grid gutter="lg">
      <Grid.Col span={{ base: 12, md: 5 }}>
        <ScrollArea.Autosize mah="calc(100vh - 220px)" type="auto" offsetScrollbars>{list}</ScrollArea.Autosize>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 7 }}>
        <Paper withBorder p="md" style={{ position: 'sticky', top: 'calc(var(--app-shell-header-height, 0px) + var(--mantine-spacing-md))' }}>
          {detail ?? <Text>{empty}</Text>}
        </Paper>
      </Grid.Col>
    </Grid>
  );
}
