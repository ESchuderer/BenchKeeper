import { ActionIcon, Anchor, Box, Container, Group, Text } from '@mantine/core';
import { IconBrandGithub, IconGitFork, IconMoon, IconStar, IconSun, IconTag } from '@tabler/icons-react';
import { SLUG, facts } from '../lib/repo-facts';

const REPO = `https://github.com/${SLUG}`;
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
              <Text fw={800} size="lg" className="wordmark">BenchKeeper</Text>
            </Group>
          </Anchor>
          <Group component="nav" aria-label="Sections" gap={14} wrap="nowrap" visibleFrom="lg" style={{ flex: 'none' }}>
            {SECTIONS.map(([id, l]) => (
              <Anchor key={id} href={to(id)} c="dimmed" size="sm" underline="never" style={{ whiteSpace: 'nowrap' }}>{l}</Anchor>
            ))}
            <Anchor href={`${base}/overview/`} c="dimmed" size="sm" underline="never" style={{ whiteSpace: 'nowrap' }}>Overview</Anchor>
            <Anchor href={`${base}/app/`} c="dimmed" size="sm" underline="never" style={{ whiteSpace: 'nowrap' }}>The app</Anchor>
          </Group>
          <Group gap="xs" wrap="nowrap" className="header-end">
            <a href={REPO} className="repo">
              <IconBrandGithub size={28} aria-hidden="true" className="repo-icon" />
              <span className="repo-text">
                <span className="repo-name">{SLUG}</span>
                {(facts.tag || facts.stars || facts.forks) && (
                  <span className="repo-facts">
                    {facts.tag && <span><IconTag size={12} aria-hidden="true" /><span className="sr-only">latest release </span>{facts.tag}</span>}
                    {facts.stars && <span><IconStar size={12} aria-hidden="true" />{facts.stars}<span className="sr-only"> stars</span></span>}
                    {facts.forks && <span><IconGitFork size={12} aria-hidden="true" />{facts.forks}<span className="sr-only"> forks</span></span>}
                  </span>
                )}
              </span>
            </a>
            <ActionIcon data-theme-toggle variant="default" size={36} aria-label="Dark theme">
              <IconMoon size={16} className="icon-moon" />
              <IconSun size={16} className="icon-sun" />
            </ActionIcon>
          </Group>
        </Group>
      </Container>
      <Container size={size} hiddenFrom="lg">
        <Group component="nav" aria-label="Sections" gap="md" wrap="nowrap" pb={10} style={{ overflowX: 'auto' }}>
          {SECTIONS.map(([id, l]) => (
            <Anchor key={id} href={to(id)} c="dimmed" size="sm" underline="never" style={{ whiteSpace: 'nowrap' }}>{l}</Anchor>
          ))}
          <Anchor href={`${base}/overview/`} c="dimmed" size="sm" underline="never" style={{ whiteSpace: 'nowrap' }}>Overview</Anchor>
            <Anchor href={`${base}/app/`} c="dimmed" size="sm" underline="never" style={{ whiteSpace: 'nowrap' }}>The app</Anchor>
        </Group>
      </Container>
    </Box>
  );
}
