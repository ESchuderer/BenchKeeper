import { Anchor, Code, Container, MantineProvider, Stack, Table, Text, Title, createTheme } from '@mantine/core';
import type { ReactNode } from 'react';
import SiteHeader from './SiteHeader';

const theme = createTheme({
  primaryColor: 'teal',
  primaryShade: { light: 9, dark: 9 },
  components: { Anchor: { defaultProps: { underline: 'always' } } },
  fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
  headings: { fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif', fontWeight: '800' },
  defaultRadius: 'md',
});

const EVAL = 'https://github.com/ESchuderer/BenchKeeper-Eval';

export function BenchShell({ base, children }: { base: string; children: ReactNode }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <a className="skip" href="#main">Skip to content</a>
      <SiteHeader base={base} size="xl" />

      <main id="main" tabIndex={-1}>
        <Container size="xl" py={{ base: 40, md: 64 }}>{children}</Container>
      </main>
    </MantineProvider>
  );
}

// Headline numbers of the recorded runs, all on Sonnet 5.5 at effort high unless stated. Scores are 0 to 100.
const RUNS: { brief: string; setup: string; headline: string }[] = [
  {
    brief: 'Brownfield: an existing Svelte site gets CI, a compare view and two bug fixes in three sessions',
    setup: '8 arms, 3 rounds each',
    headline: 'Median scores 82.85 to 86.18. Plain Claude Code scored 85.69 in 12.8 minutes for 2.42 USD (API-equivalent); BenchKeeper setup-v3.3 with Matt Pocock\'s skills 85.76 in 8.1 minutes for 1.66 USD; setup-v5.0 86.18 in 17.7 minutes for 3.70 USD. One arm varies by up to 7 points between rounds, so differences below about 3 points are not measurable.',
  },
  {
    brief: 'Brownfield: a TypeScript library (behaviour trees) gets a snapshot and restore feature in three sessions',
    setup: '12 arms, 3 rounds each',
    headline: 'Median scores 84.08 to 90.12. Plain Claude Code scored 86.97 in 22.7 minutes for 3.76 USD; Ponytail alone 87.58 in 13.3 minutes for 2.17 USD; ECC 90.12 in 35.3 minutes for 7.52 USD. One arm varies by up to 8 points between rounds.',
  },
  {
    brief: 'The same library brief with the model setting opusplan',
    setup: '2 arms, 3 rounds each',
    headline: 'BenchKeeper setup-v5.0 scored 90.34 and plain Claude Code 86.61. No trial entered plan mode, and opusplan added cost through Opus subagents with no measurable gain over Sonnet 5.5.',
  },
  {
    brief: 'Greenfield: a React booking app, one trial per arm',
    setup: '22 Claude Code arms',
    headline: 'The hidden tests do not separate the arms: every app passes all 6 feature and 12 robustness tests. The best review sum is 62 of 65 (OpenSpec), plain Claude Code 57 (rank 10). Ponytail cost less in all 6 recorded pairs. Descriptive only.',
  },
  {
    brief: 'Greenfield: a static reference app with search, detail view, drawing and print view, one trial per arm',
    setup: '22 Claude Code and 7 OpenCode arms',
    headline: 'Final scores of the top 10 span 81.8 to 84.8; plain Claude Code scored 78.3 (rank 19 of 29). Totals within about 2 points are not separable.',
  },
];

export default function BenchSummary({ base }: { base: string }) {
  return (
    <BenchShell base={base}>
      <Stack gap="md" maw={900}>
        <Title order={1}>Benchmarks</Title>
        <Text>
          Each setup runs as its own arm on the same briefs: plain Claude Code, skill libraries, Ponytail, OpenSpec and the BenchKeeper layer. The benchmark lives in its own repository, <Anchor href={EVAL}>BenchKeeper-Eval</Anchor>: briefs, hidden tests, scorer, arm definitions, run scripts and the recorded results with reports per run.
        </Text>
        <Title order={2} mt="lg">Headline numbers</Title>
        <Table.ScrollContainer minWidth={560} type="native" tabIndex={0} role="region" aria-label="Headline numbers per run">
          <Table striped verticalSpacing="xs" fz="sm">
            <Table.Thead>
              <Table.Tr><Table.Th>Brief</Table.Th><Table.Th>Arms</Table.Th><Table.Th>Result</Table.Th></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {RUNS.map((r) => (
                <Table.Tr key={r.brief}><Table.Td>{r.brief}</Table.Td><Table.Td>{r.setup}</Table.Td><Table.Td>{r.headline}</Table.Td></Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <Text size="sm">
          Cost is the API-equivalent figure the agent reports: the trials ran on a subscription. Reports with every arm, review and score: <Anchor href={`${EVAL}/tree/develop/bench/results`}>bench/results</Anchor>. Method and protocol versions: <Anchor href={`${EVAL}/blob/develop/bench/PROTOCOL.md`}>bench/PROTOCOL.md</Anchor>.
        </Text>
        <Title order={2} mt="lg">Reproduce a run</Title>
        <Text>Needs Podman, Node 22.23.3 and a Claude Code subscription token. Clone the repository, build an arm image and run a brief:</Text>
        <Code block>{`git clone https://github.com/ESchuderer/BenchKeeper-Eval
cd BenchKeeper-Eval
podman build -f bench/image/Containerfile --build-arg ARM=<arm> -t benchkeeper-arm-<arm> .
bench/run-brief.sh <brief> <model> <effort> <k> <seed> [arms]`}</Code>
        <Text size="sm">The agent transcripts and built apps of the recorded runs are release assets of the repository; <Code>node bench/scripts/results-assets.mjs fetch</Code> restores and verifies them.</Text>
      </Stack>
    </BenchShell>
  );
}
