import { Stack, Title } from '@mantine/core';
import { SiteShell } from './SiteShell';

// html: CHANGELOG.md, rendered at build time (pages/changelog.astro).
export default function ChangelogPage({ base, html }: { base: string; html: string }) {
  return (
    <SiteShell base={base}>
      <Stack gap="xs" maw={960}>
        <Title order={1} fz={{ base: 34, md: 44 }}>Changelog</Title>
        <div className="doc" dangerouslySetInnerHTML={{ __html: html }} />
      </Stack>
    </SiteShell>
  );
}
