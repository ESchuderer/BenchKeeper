import { ActionIcon, Anchor, Box, Button, Container, Group, Text } from '@mantine/core';
import { IconBrandGithub, IconChartBar, IconMoon, IconSun } from '@tabler/icons-react';

const REPO = 'https://github.com/ESchuderer/BenchKeeper';
const SECTIONS = [['sdlc', 'Workflow'], ['parts', 'What gets installed'], ['start', 'Quick start'], ['selected', 'Why this stack'], ['where', 'Where things run']];

// The header of every page. On the main page (home) the links stay in the page; elsewhere they lead back to its sections.
export default function SiteHeader({ base, home = false, size = 'lg' }: { base: string; home?: boolean; size?: string }) {
  const to = (id: string) => (home ? `#${id}` : `${base}/#${id}`);
  return (
    <Box component="header" className="header">
      <Container size={size} h={60}>
        <Group h="100%" justify="space-between" wrap="nowrap">
          <Anchor href={home ? '#main' : `${base}/`} underline="never" c="var(--mantine-color-text)">
            <Group gap={10} wrap="nowrap">
              <img src={`${base}/logo.svg`} alt="" width={28} height={28} className="logo" />
              <Text fw={800} size="lg">BenchKeeper</Text>
            </Group>
          </Anchor>
          <Group component="nav" aria-label="Sections" gap="lg" visibleFrom="md">
            {SECTIONS.map(([id, l]) => (
              <Anchor key={id} href={to(id)} c="dimmed" size="sm" underline="never">{l}</Anchor>
            ))}
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Button component="a" href={`${base}/bench/`} variant="default" size="xs" leftSection={<IconChartBar size={16} />} visibleFrom="sm">Benchmark</Button>
            <ActionIcon component="a" href={`${base}/bench/`} variant="default" size={36} aria-label="Benchmark" hiddenFrom="sm"><IconChartBar size={16} /></ActionIcon>
            <Button component="a" href={REPO} variant="default" size="xs" leftSection={<IconBrandGithub size={16} />} visibleFrom="sm">GitHub</Button>
            <ActionIcon component="a" href={REPO} variant="default" size={36} aria-label="GitHub" hiddenFrom="sm"><IconBrandGithub size={16} /></ActionIcon>
            <ActionIcon data-theme-toggle variant="default" size={36} aria-label="Toggle light and dark theme">
              <IconMoon size={16} className="icon-moon" />
              <IconSun size={16} className="icon-sun" />
            </ActionIcon>
          </Group>
        </Group>
      </Container>
      <Container size={size} hiddenFrom="md">
        <Group component="nav" aria-label="Sections" gap="md" wrap="nowrap" pb={10} style={{ overflowX: 'auto' }}>
          {SECTIONS.map(([id, l]) => (
            <Anchor key={id} href={to(id)} c="dimmed" size="sm" underline="never" style={{ whiteSpace: 'nowrap' }}>{l}</Anchor>
          ))}
        </Group>
      </Container>
    </Box>
  );
}
