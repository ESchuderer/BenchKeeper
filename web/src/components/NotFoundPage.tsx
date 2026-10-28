import { Anchor, Stack, Text, Title } from '@mantine/core';
import { BenchShell } from './BenchShell';

export default function NotFoundPage({ base }: { base: string }) {
  return (
    <BenchShell base={base}>
      <Stack gap="xs" maw={720}>
        <Title order={1} fz={{ base: 34, md: 44 }}>Page not found</Title>
        <Text size="lg">
          Go to the <Anchor href={`${base}/`}>start page</Anchor>, the <Anchor href={`${base}/overview/`}>overview</Anchor> or <Anchor href={`${base}/app/`}>the app</Anchor>.
        </Text>
      </Stack>
    </BenchShell>
  );
}
