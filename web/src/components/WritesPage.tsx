import { Stack, Title } from '@mantine/core';
import { SiteShell } from './SiteShell';

// html: the sections of docs/setup.md and docs/security.md, rendered at build time (pages/writes.astro).
export default function WritesPage({ base, html }: { base: string; html: string }) {
  return (
    <SiteShell base={base}>
      <Stack gap="xs" maw={960}>
        <Title order={1} fz={{ base: 34, md: 44 }}>What the app writes and what it never does</Title>
        <div className="doc" dangerouslySetInnerHTML={{ __html: html }} />
      </Stack>
    </SiteShell>
  );
}
