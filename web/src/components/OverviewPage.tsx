import { Anchor, Container, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';
import { sdlcSvg } from '../lib/sdlc';
import facts from '../data/facts.json';
import { SiteShell } from './SiteShell';
import { SDLC_INTRO, StepList, half, md } from './Page';

const REPO = 'https://github.com/ESchuderer/BenchKeeper';
const { overview } = facts;

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <Container component="section" id={id} aria-labelledby={`${id}-h`} size="xl" p={0} w="100%">
      <Stack gap="md">
        <Title order={2} id={`${id}-h`} fz={{ base: 24, md: 30 }}>{title}</Title>
        {intro && <Text maw={720}>{intro}</Text>}
        {children}
      </Stack>
    </Container>
  );
}

function Source({ path }: { path: string }) {
  return <Text size="sm" mt="xs">Source: <Anchor href={`${REPO}/blob/main/${path}`} size="sm">{path}</Anchor></Text>;
}

export default function OverviewPage({ base }: { base: string }) {
  return (
    <SiteShell base={base}>
      <Stack gap={56}>
        <Stack gap="xs" maw={720}>
          <Title order={1} fz={{ base: 34, md: 44 }}>{overview.title}</Title>
          <Text size="lg">{md(facts.description)}</Text>
          <Text>{overview.audience} <Anchor href={`${base}/#start`}>Quick start</Anchor>, <Anchor href={`${base}/app/`}>the app with screenshots</Anchor>, <Anchor href={`${REPO}/blob/main/docs/skills.md`}>what each skill does</Anchor>.</Text>
        </Stack>
        <Section id="sdlc" title="The workflow" intro={SDLC_INTRO}>
          <div className="ring-wrap" dangerouslySetInnerHTML={{ __html: sdlcSvg }} />
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={40} verticalSpacing="xl">
            <StepList from={0} className="steps-first" />
            <StepList from={half} />
          </SimpleGrid>
        </Section>
        <Section id="brings" title="What it brings">
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            {overview.parts.map((p) => (
              <Paper key={p.id} id={p.id} withBorder p="lg" radius="lg">
                <Title order={3} fz="lg">{p.title}</Title>
                <Text size="sm" mt="xs">{md(p.text)}</Text>
                <Source path={p.evidence} />
              </Paper>
            ))}
          </SimpleGrid>
        </Section>
        <Section id="defaults" title="Opinionated defaults">
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            {overview.defaults.map((d) => (
              <Paper key={d.title} withBorder p="lg" radius="lg">
                <Title order={3} fz="lg">{d.title}</Title>
                <Text size="sm" mt="xs">{md(d.text)}</Text>
                <Text size="sm" mt="xs"><Text span fw={700} size="sm">Why:</Text> {d.reason}</Text>
                <Source path={d.evidence} />
              </Paper>
            ))}
          </SimpleGrid>
        </Section>
      </Stack>
    </SiteShell>
  );
}
