import { Anchor, Box, Container, Group, Text } from '@mantine/core';
import { SLUG } from '../lib/repo-facts';

const REPO = `https://github.com/${SLUG}`;

// The footer of every page: license, the build's commit when known, what the app writes, the changelog, the benchmark, the repository and its security policy.
export default function SiteFooter({ base, size = 'lg', updated, commit }: { base: string; size?: string; updated?: string; commit?: string }) {
  return (
    <Box component="footer" className="band" py="xl">
      <Container size={size}>
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            BenchKeeper, MIT License
            {updated && commit && <>, updated {updated} (<Anchor href={`${REPO}/commit/${commit}`} size="sm">{commit.slice(0, 7)}</Anchor>)</>}
          </Text>
          <Group gap="md">
            <Anchor href={`${base}/writes/`} size="sm">What the app writes</Anchor>
            <Anchor href={`${base}/changelog/`} size="sm">Changelog</Anchor>
            <Anchor href={`${base}/benchmark/`} size="sm">Benchmark</Anchor>
            <Anchor href={`${REPO}/blob/main/SECURITY.md`} size="sm">Security policy</Anchor>
            <Anchor href={REPO} size="sm">github.com/{SLUG}</Anchor>
          </Group>
        </Group>
      </Container>
    </Box>
  );
}
