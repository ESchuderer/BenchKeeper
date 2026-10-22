import { Badge, Container, Group, MantineProvider, Tabs, Title, createTheme } from '@mantine/core';
import { useState } from 'react';
import { useApi } from './parts.jsx';
import { Agents, Catalog, Dashboard, History, Projects } from './views.jsx';

const theme = createTheme({ primaryColor: 'teal', primaryShade: { light: 9, dark: 9 }, defaultRadius: 'md' });
const VIEWS = [['dashboard', 'Dashboard', Dashboard], ['catalog', 'Catalog', Catalog], ['agents', 'Agents', Agents], ['projects', 'Projects', Projects], ['history', 'History', History]];

export default function App() {
  const [view, setView] = useState('dashboard');
  const overview = useApi('/api/overview');
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Container size="xl" py="lg">
        <Group gap="sm" mb="md" component="header">
          <Title order={1} size="h2">BenchKeeper</Title>
          {overview.data && <Badge variant="outline">{overview.data.version}</Badge>}
        </Group>
        <Tabs value={view} onChange={setView} keepMounted={false} component="main">
          <Tabs.List mb="lg">
            {VIEWS.map(([id, label]) => <Tabs.Tab key={id} value={id}>{label}</Tabs.Tab>)}
          </Tabs.List>
          {VIEWS.map(([id, , View]) => (
            <Tabs.Panel key={id} value={id}><View overview={overview} /></Tabs.Panel>
          ))}
        </Tabs>
      </Container>
    </MantineProvider>
  );
}
