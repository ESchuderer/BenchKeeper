import { ActionIcon, Anchor, Box, Button, Container, Group, MantineProvider, Stack, Table, Text, Title, createTheme } from '@mantine/core';
import { IconArrowLeft, IconBrandGithub, IconMoon, IconSun } from '@tabler/icons-react';
import { Fragment, type ReactNode } from 'react';

const theme = createTheme({
  primaryColor: 'teal',
  primaryShade: { light: 9, dark: 9 },
  components: { Anchor: { defaultProps: { underline: 'always' } } },
  fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
  headings: { fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif', fontWeight: '800' },
  defaultRadius: 'md',
});

const REPO = 'https://github.com/ESchuderer/BenchKeeper';

export function BenchShell({ base, children }: { base: string; children: ReactNode }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <a className="skip" href="#main">Skip to content</a>
      <Box component="header" className="header">
        <Container size="xl" h={60}>
          <Group h="100%" justify="space-between" wrap="nowrap">
            <Anchor href={`${base}/`} underline="never" c="var(--mantine-color-text)">
              <Group gap={10} wrap="nowrap">
                <img src={`${base}/logo.svg`} alt="" width={28} height={28} className="logo" />
                <Text fw={800} size="lg">BenchKeeper</Text>
              </Group>
            </Anchor>
            <Group gap="xs" wrap="nowrap">
              <Button component="a" href={REPO} variant="default" size="xs" leftSection={<IconBrandGithub size={16} />} visibleFrom="sm">GitHub</Button>
              <ActionIcon data-theme-toggle variant="default" size={30} aria-label="Toggle light and dark theme">
                <IconMoon size={16} className="icon-moon" />
                <IconSun size={16} className="icon-sun" />
              </ActionIcon>
            </Group>
          </Group>
        </Container>
      </Box>

      <main id="main" tabIndex={-1}>
        <Container size="xl" py={{ base: 40, md: 64 }}>{children}</Container>
      </main>
    </MantineProvider>
  );
}

export type Row = { key: string; arm: string; setup: string; rank: number; features: number | null; robustness: number | null; overall: number | null; minutes: number };
export type Run = {
  run: string; brief: string; model: string; effort: string; k: string; date: string; report: string | null; protocols: string[];
  featuresOf: number | null; robustnessOf: number | null;
  groups: { runtime: string; criteria: number[]; rows: Row[] }[];
};
export type Detail = Row & {
  model: string; runtime: string; mutation: number | null; drawings: { of: number; correctAlphaApart: number } | null;
  final: { total: number; categories: Record<string, { score: number; max: number }> };
};
export type Top = { brief: string; of: number; top: Detail[]; baselines: (Detail & { place: number })[] };
export type Notes = { briefs: Record<string, string>; runs: Record<string, { protocol?: string; findings: string[] }>; reports: { file: string; title: string; summary: string }[] };

const plain = (setup: string) => (setup === 'plain' ? 'no add-ons' : setup.replace(/^BK\b/, 'BenchKeeper layer'));
const score = (n: number | null, of: number | null) => (n == null || of == null ? 'n/a' : `${n}/${of}`);
const pct = (v: number | null) => (v == null ? 'n/a' : `${v}%`);

const CATEGORIES: [string, string][] = [['correctness', 'Correctness'], ['code_quality', 'Code quality'], ['tests', 'Tests'],
  ['security', 'Security'], ['ux_accessibility', 'UX and accessibility'], ['documentation', 'Documentation']];
const one = (v: number) => v.toFixed(1);

// The top 10 of a brief across models by final score, plain Claude Code appended as the baseline (bench-data.mjs, topByBrief).
function TopDetail({ t: x }: { t: Top }) {
  const cats = CATEGORIES.map(([k, label]) => ({ k, label, max: x.top[0].final.categories[k]?.max }));
  const rows = [...x.top.map((t, i) => ({ t, rank: String(i + 1) })), ...x.baselines.map((t) => ({ t, rank: `${t.place} (baseline)` }))];
  return (
    <Box component="section" aria-labelledby={`top-${x.brief}`} mb={56}>
      <Title order={2} id={`top-${x.brief}`}>{x.brief}: top 10 of {x.of} apps</Title>
      <Text size="sm" c="dimmed" mt="xs">
        Final score out of 100 from six weighted categories: correctness (hidden feature tests, print
        check, review), code quality (review, erosion, type errors, Sonar bugs, lint, duplication), tests (line coverage,
        review), security (filtered security findings, review), UX and accessibility (review, axe, Lighthouse, HTML
        validity) and documentation (README coverage and accuracy, code comments, decision records). Totals within about
        2 points are not separable with one trial per arm. Not part of the score, measured for these apps only:
        drawings, of the 25 cartridge drawings how many a Claude Opus 5.5 review found correct (a shoulder angle drawn
        as a label instead of an angle dimension not counted against it), and mutation, the share of mutants the
        app's own tests catch (Stryker). n/a: not measured or not measurable.
      </Text>
      <Table.ScrollContainer minWidth={1100} type="native" mt="xs" tabIndex={0} role="region" aria-label={`${x.brief}: top 10 in detail`}>
        <Table striped verticalSpacing={4} fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Rank</Table.Th><Table.Th>Model</Table.Th><Table.Th>Arm</Table.Th><Table.Th>Runtime</Table.Th><Table.Th>Setup</Table.Th>
              <Table.Th>Final</Table.Th>{cats.map((c) => <Table.Th key={c.k}>{c.label} ({c.max})</Table.Th>)}
              <Table.Th>Drawings</Table.Th><Table.Th>Mutation</Table.Th><Table.Th>Minutes</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map(({ t, rank }) => (
              <Table.Tr key={t.key}>
                <Table.Td>{rank}</Table.Td><Table.Td>{t.model}</Table.Td><Table.Td>{t.arm}</Table.Td><Table.Td>{t.runtime}</Table.Td><Table.Td>{plain(t.setup)}</Table.Td>
                <Table.Td>{one(t.final.total)}</Table.Td>
                {cats.map((c) => <Table.Td key={c.k}>{one(t.final.categories[c.k].score)}</Table.Td>)}
                <Table.Td>{t.drawings ? `${t.drawings.correctAlphaApart}/${t.drawings.of}` : 'n/a'}</Table.Td><Table.Td>{pct(t.mutation)}</Table.Td>
                <Table.Td>{t.minutes}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Box>
  );
}

export default function BenchSummary({ base, runs, tops, notes }: { base: string; runs: Run[]; tops: Top[]; notes: Notes }) {
  return (
    <BenchShell base={base}>
      <Stack gap="xs" maw={820} mb="xl">
        <Anchor href={`${base}/`} size="sm" underline="hover"><Group gap={4} component="span"><IconArrowLeft size={14} />Back to BenchKeeper</Group></Anchor>
        <Title order={1} fz={{ base: 32, md: 44 }}>Benchmarks</Title>
        <Text c="dimmed" size="lg">
          A summary of each published run. Full results, per-trial data and method: the linked Markdown reports and
          the <Anchor href={`${REPO}/blob/main/bench/PROTOCOL.md`}>protocol</Anchor>.
        </Text>
        <Text c="dimmed">
          Features and robustness are hidden tests passed; review is a blind rating from 1 to 10 by Claude Opus 5.5.
          Ranked by review, then features, robustness and fewer minutes. The BenchKeeper layer includes Ponytail.
        </Text>
      </Stack>

      {runs.map((r, i) => {
        const note = notes.runs[r.run];
        // A brief's top 10 follows the last of its runs.
        const top = runs.findLastIndex((x) => x.brief === r.brief) === i ? tops.find((t) => t.brief === r.brief) : undefined;
        const protocol = r.protocols.join(', ') || note?.protocol || 'not recorded';
        return (
          <Fragment key={r.run}>
            <Box component="section" aria-labelledby={`run-${r.run}`} mb={56}>
              <Title order={2} id={`run-${r.run}`}>{r.brief}, {r.model}</Title>
              {notes.briefs[r.brief] && <Text mt="xs">{notes.briefs[r.brief]}</Text>}
              <Text size="sm" c="dimmed" mt="xs">
                Model {r.model}, effort {r.effort}, k = {r.k} (trials per arm), protocol {protocol}, run {r.date}.
              </Text>
              {r.groups.map((g) => (
                <Box key={g.runtime} mt="lg">
                  <Title order={3} fz="lg">{g.runtime}</Title>
                  <Text size="sm" c="dimmed">
                    {g.rows.length} arms; review with {g.criteria.join(' or ') || 'no'} criteria.
                  </Text>
                  <Table.ScrollContainer minWidth={640} type="native" mt="xs" tabIndex={0} role="region" aria-label={`${r.brief}, ${r.model}, ${g.runtime}: ranked arms`}>
                    <Table striped verticalSpacing={4} fz="sm">
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Rank</Table.Th><Table.Th>Arm</Table.Th><Table.Th>Setup</Table.Th><Table.Th>Features</Table.Th>
                          <Table.Th>Robustness</Table.Th><Table.Th>Review</Table.Th><Table.Th>Minutes</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {g.rows.map((t) => (
                          <Table.Tr key={t.key}>
                            <Table.Td>{t.rank}</Table.Td><Table.Td>{t.arm}</Table.Td><Table.Td>{plain(t.setup)}</Table.Td>
                            <Table.Td>{score(t.features, r.featuresOf)}</Table.Td><Table.Td>{score(t.robustness, r.robustnessOf)}</Table.Td>
                            <Table.Td>{t.overall ?? 'n/a'}</Table.Td><Table.Td>{t.minutes}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                </Box>
              ))}
              {note?.findings.length ? (
                <>
                  <Title order={3} fz="lg" mt="lg">Key findings</Title>
                  <ul className="list">{note.findings.map((f) => <li key={f}>{f}</li>)}</ul>
                </>
              ) : null}
              {r.report && (
                <Text mt="md">Full report: <Anchor href={`${REPO}/blob/main/bench/results/${r.report}`}>{r.report}</Anchor></Text>
              )}
            </Box>
            {top && <TopDetail t={top} />}
          </Fragment>
        );
      })}

      <Title order={2} mb="md">Other reports</Title>
      <Stack gap="md" maw={820}>
        {notes.reports.map((x) => (
          <div key={x.file}>
            <Anchor href={`${REPO}/blob/main/bench/results/${x.file}`} fw={700}>{x.title}</Anchor>
            <Text size="sm" mt={4}>{x.summary}</Text>
          </div>
        ))}
      </Stack>
    </BenchShell>
  );
}
