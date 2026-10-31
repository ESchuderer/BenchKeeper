import { Anchor, Code, Stack, Table, Text, Title } from '@mantine/core';
import { SiteShell } from './SiteShell';

const RESEARCH = 'https://github.com/ESchuderer/BenchKeeper-research';
const FILE = `${RESEARCH}/blob/main`;
// What a column of a recorded result means and how to compare it, from research bench/results/2026-10-18-mistreevous.md and the research README.
const READING: [string, string, string][] = [
  ['Score', 'Brownfield score from 0 to 100: hidden checks 35, test suite green 10, static checks 15, process checks 15, model review 25.', 'Medians of 3 rounds per arm; descriptive only, no significance tests.'],
  ['Score vs A', 'Difference of the median to plain Claude Code (arm A).', 'One arm varies by up to about 8 points between rounds, so with 3 rounds a median difference below about 3 points is not measurable.'],
  ['Minutes', 'The agent\'s time summed over the steps.', 'At equal quality, the cheaper and faster setup is the better choice.'],
  ['Cost, USD', 'The API-equivalent figure the agent reports. The trials ran on a subscription, where it counts against the usage window.', 'A higher cost needs a median at least 3 points higher and a lead in at least 2 of 3 rounds.'],
  ['Review', 'A blinded code review: Claude Opus 5.5 rates 8 criteria from 1 to 5, twice per trial.', 'A model rating is noisy and a Claude reviewer may favor Claude-written code: keep the review model fixed and read the bug list before the number.'],
];

// Statements come only from files in BenchKeeper-research; each names its source in a comment.
export default function BenchmarkPage({ base }: { base: string }) {
  return (
    <SiteShell base={base}>
      <Stack gap="md" maw={960}>
        <Title order={1} fz={{ base: 34, md: 44 }}>How the benchmark works</Title>
        {/* research README.md */}
        <Text>The benchmark measures what an agent setup does to the code an agent writes. The tooling, the reports and the recorded results live in <Anchor href={RESEARCH}>BenchKeeper-research</Anchor>.</Text>

        <Title order={2} fz={{ base: 24, md: 30 }}>How a result is produced</Title>
        {/* research bench/SCENARIOS.md, bench/results/2026-10-18-mistreevous.md "Method" */}
        <Text>Each setup (an arm) gets the same brief, hidden tests, scorer, app review, timeout and follow-up rule, and each trial runs in its own container with only its arm's components. In a brownfield brief, each step runs in a new session on the repository state the previous step left, and a step's checks run after it ends. Minutes, cost and skills are reported, not scored.</Text>

        <Title order={2} fz={{ base: 24, md: 30 }}>How to read a result</Title>
        <Table.ScrollContainer minWidth={0}>
          <Table withTableBorder withColumnBorders verticalSpacing="sm" style={{ tableLayout: 'fixed' }}>
            <Table.Thead>
              <Table.Tr><Table.Th scope="col" w="20%">Column</Table.Th><Table.Th scope="col">What it is</Table.Th><Table.Th scope="col">How to compare it</Table.Th></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {READING.map(([col, what, how]) => <Table.Tr key={col}><Table.Th scope="row">{col}</Table.Th><Table.Td>{what}</Table.Td><Table.Td>{how}</Table.Td></Table.Tr>)}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>

        <Title order={2} fz={{ base: 24, md: 30 }}>Where the results and the method live</Title>
        {/* research README.md "Recorded results", research bench/ORIGIN.md and bench/PROTOCOL.md */}
        <Text>The reports of the mistreevous brief, <Anchor href={`${FILE}/bench/results/2026-10-18-mistreevous.md`}>on Sonnet 5.5</Anchor> and <Anchor href={`${FILE}/bench/results/2026-10-19-mistreevous-opusplan.md`}>on opusplan</Anchor>, with the per-trial files they rest on next to them. The raw trial data was removed, so these tables cannot be recomputed.</Text>
        <Text>The compared arms are in <Anchor href={`${FILE}/bench/SCENARIOS.md`}><Code>bench/SCENARIOS.md</Code></Anchor>, the source of every file in <Anchor href={`${FILE}/bench/ORIGIN.md`}><Code>bench/ORIGIN.md</Code></Anchor>, and the protocol in <Anchor href={`${FILE}/bench/PROTOCOL.md`}><Code>bench/PROTOCOL.md</Code></Anchor>. New runs go into the research repository.</Text>
      </Stack>
    </SiteShell>
  );
}
