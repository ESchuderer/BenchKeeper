import { Anchor, Box, Button, Container, Group, MantineProvider, Stack, Table, Text, Title, createTheme } from '@mantine/core';
import { IconArrowLeft, IconArrowRight } from '@tabler/icons-react';
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

const REPO = 'https://github.com/ESchuderer/BenchKeeper';

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

export type Trial = {
  key: string; run: string; round: number; arm: string; setup: string; runtime: string; minutes: number; cost: number | null; overall: number | null;
  features: number | null; robustness: number | null; brownfield: number | null; mutation: number | null;
  drawings: { of: number; correctAlphaApart: number } | null;
  final: { total: number; categories: Record<string, { score: number; max: number }> } | null;
  notes: { verdict: string | null; strengths: string[]; issues: string[] } | null; screenshots: string[];
};
export type ArmRow = { arm: string; setup: string; runtime: string; score: number | null; minutes: number | null; cost: number | null; rank: number; rounds: Trial[] };
export type Ranking = { kind: 'final' | 'brownfield' | 'review'; groups: { runtime: string | null; rows: ArmRow[] }[] };
export type Run = {
  run: string; brief: string; model: string; effort: string; k: string; date: string; report: string | null; protocols: string[];
  featuresOf: number | null; robustnessOf: number | null;
};
export type Detail = Trial & { model: string; final: NonNullable<Trial['final']> };
export type Top = { brief: string; of: number; top: Detail[]; baselines: (Detail & { place: number })[] };
export type Notes = {
  briefs: Record<string, string>; runs: Record<string, { tested?: string; summary?: string; score?: string; findings: string[] }>;
  reports: { file: string; title: string; summary: string }[];
  stacks: { name: string; url: string; version: string; text: string }[];
};

// The short summary of a run, labeled as written by AI.
const Summary = ({ text }: { text?: string }) => (text ? <Text mt="md"><Text span fw={700}>AI summary: </Text>{text}</Text> : null);

const plain = (setup: string) => (setup === 'plain' ? 'no add-ons' : setup.replace(/^BK\b/, 'BenchKeeper layer'));
const of = (n: number | null, total: number | null) => (n == null || total == null ? 'n/a' : `${n}/${total}`);
const pct = (v: number | null) => (v == null ? 'n/a' : `${v}%`);
// API-equivalent USD: what the tokens would cost at API prices; the trials bill a subscription.
const usd = (v: number | null) => (v == null ? 'n/a' : `$${v.toFixed(2)}`);
// rounds half up on the decimal value (82.85 -> 82.9), which toFixed does not for binary floats
const one = (v: number) => (Math.round(Number(`${v}e1`)) / 10).toFixed(1);
const fmt = (kind: Ranking['kind'], v: number | null) => (v == null ? 'n/a' : kind === 'review' ? String(v) : one(v));
const SCORE: Record<Ranking['kind'], string> = {
  final: 'Final score (of 100)', brownfield: 'Brownfield score (of 100), median of the rounds', review: 'Review (1 to 10)',
};
const SCORE_HELP: Record<Ranking['kind'], string> = {
  final: 'six weighted categories: correctness, code quality, tests, security, UX and accessibility, documentation (method in the report).',
  brownfield: 'step checks 45, review 35, test suite green after each step 10, cross-step checks 10 (method in the report).',
  review: 'blind rating by Claude Opus 5.5. Runtimes are ranked apart: their reviews use other criteria.',
};
// An id from a runtime name ("Claude Code" -> "rank-claude-code"): ids cannot contain spaces.
const slug = (prefix: string, runtime: string | null) => `${prefix}-${(runtime ?? 'all').toLowerCase().replace(/\s+/g, '-')}`;
const runHref = (base: string, run: string) => `${base}/bench/${run}/`;
const shot = (base: string, t: Trial, f: string) => `${base}/bench/shots/${t.run}/round-${t.round}/${t.arm}/${f}`;
// "step2-compare-308_win-300_win_mag.jpg" -> "step 2, compare 308 win 300 win mag"
const shotLabel = (f: string) => f.replace(/\.\w+$/, '').replace(/^step(\d+)-/, 'step $1, ').replace(/[-_]/g, ' ');

function Meta({ r }: { r: Run }) {
  return (
    <Text size="sm" c="dimmed" mt="xs">
      {r.model} at effort {r.effort}. Each setup ran {r.k === '1' ? 'once (k = 1)' : `${r.k} times from a fresh start (k = ${r.k}), and its score is the median of those runs`}. Benchmark protocol {r.protocols.join(', ') || 'not recorded'}, run {r.date}. API cost: the tokens at API prices (the trials ran on a subscription).
    </Text>
  );
}

function Region({ label, minWidth, children }: { label: string; minWidth: number; children: ReactNode }) {
  return (
    <Table.ScrollContainer minWidth={minWidth} type="native" mt="xs" tabIndex={0} role="region" aria-label={label}>
      <Table striped verticalSpacing={4} fz="sm">{children}</Table>
    </Table.ScrollContainer>
  );
}

// Summary card of one run: winners, the top 10 by the run's score, the link to the run page.
function RunCard({ base, r, ranking, notes }: { base: string; r: Run; ranking: Ranking; notes: Notes }) {
  const note = notes.runs[r.run];
  return (
    <Box component="section" aria-labelledby={`run-${r.run}`} mb={56} className="card">
      <Title order={2} id={`run-${r.run}`}>{r.brief}, {r.model}</Title>
      {notes.briefs[r.brief] && <Text mt="xs">{notes.briefs[r.brief]}</Text>}
      <Meta r={r} />
      {note?.tested && <Text size="sm" mt="xs"><Text span fw={700}>Tested: </Text>{note.tested}</Text>}
      <Summary text={note?.summary} />
      {ranking.groups.map((g) => {
        const top = g.rows.slice(0, 10), base0 = g.rows.find((x) => x.arm === 'A' && x.runtime === 'Claude Code');
        const label = `${r.brief}, ${r.model}${g.runtime ? `, ${g.runtime}` : ''}: top 10`;
        return (
          <Box key={g.runtime ?? 'all'} mt="lg">
            <Title order={3} fz="lg">Top {top.length} of {g.rows.length}{g.runtime ? ` ${g.runtime} arms` : ' arms'}</Title>
            <Text size="sm" c="dimmed">{SCORE[ranking.kind]}: {note?.score ?? SCORE_HELP[ranking.kind]}</Text>
            <Region label={label} minWidth={480}>
              <Table.Thead>
                <Table.Tr><Table.Th>Rank</Table.Th><Table.Th>Arm</Table.Th><Table.Th>Setup</Table.Th><Table.Th>Score</Table.Th><Table.Th>Minutes</Table.Th><Table.Th>API cost</Table.Th></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {top.map((x) => (
                  <Table.Tr key={x.arm}>
                    <Table.Td>{x.rank}</Table.Td>
                    <Table.Td><Anchor href={`${runHref(base, r.run)}#arm-${x.arm}`}>{x.arm}</Anchor></Table.Td>
                    <Table.Td>{plain(x.setup)}{g.runtime ? '' : x.runtime === 'Claude Code' ? '' : ` (${x.runtime})`}</Table.Td>
                    <Table.Td fw={700}>{fmt(ranking.kind, x.score)}</Table.Td><Table.Td>{x.minutes}</Table.Td><Table.Td>{usd(x.cost)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Region>
            {base0 && !top.includes(base0) && (
              <Text size="sm" mt="xs">Plain Claude Code (A): rank {base0.rank} of {g.rows.length}, score {fmt(ranking.kind, base0.score)}.</Text>
            )}
          </Box>
        );
      })}
      <Group mt="md" gap="md">
        <Button component="a" href={runHref(base, r.run)} rightSection={<IconArrowRight size={16} />}>
          All arms, reviews and screenshots
        </Button>
        {r.report && <Anchor href={`${REPO}/blob/main/bench/results/${r.report}`}>{r.report}</Anchor>}
      </Group>
    </Box>
  );
}

export default function BenchSummary({ base, runs, notes }: { base: string; runs: { run: Run; ranking: Ranking }[]; notes: Notes }) {
  return (
    <BenchShell base={base}>
      <Stack gap="xs" maw={820} mb="xl">
        <Anchor href={`${base}/`} size="sm" underline="hover"><Group gap={4} component="span"><IconArrowLeft size={14} />Back to BenchKeeper</Group></Anchor>
        <Title order={1} fz={{ base: 32, md: 44 }}>Benchmarks</Title>
        <Text c="dimmed" size="lg">
          The winners of each published run. Each run has its own page with every arm, the review notes and the app
          screenshots. Method: the linked Markdown reports and the <Anchor href={`${REPO}/blob/main/bench/PROTOCOL.md`}>protocol</Anchor>.
        </Text>
        <Text c="dimmed">An arm is one tested setup. The BenchKeeper layer includes Ponytail.</Text>
      </Stack>

      {runs.map(({ run, ranking }) => <RunCard key={run.run} base={base} r={run} ranking={ranking} notes={notes} />)}

      <Box component="section" aria-labelledby="stacks" mb={56} maw={1000}>
        <Title order={2} id="stacks" mb="xs">Tested components</Title>
        <Region label="Components and pinned versions" minWidth={560}>
          <Table.Tbody>
            {notes.stacks.map((x) => (
              <Table.Tr key={x.name}>
                <Table.Td style={{ whiteSpace: 'nowrap' }}><Anchor href={x.url} fw={700}>{x.name}</Anchor></Table.Td><Table.Td>{x.version}</Table.Td><Table.Td>{x.text}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Region>
      </Box>

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

const CATEGORIES: [string, string][] = [['correctness', 'Correctness'], ['code_quality', 'Code quality'], ['tests', 'Tests'],
  ['security', 'Security'], ['ux_accessibility', 'UX and accessibility'], ['documentation', 'Documentation']];

// The top 10 of a brief by final score with the categories, plain Claude Code appended as the baseline (bench-data.mjs, topByBrief).
function TopDetail({ t: x }: { t: Top }) {
  const cats = CATEGORIES.map(([k, label]) => ({ k, label, max: x.top[0].final.categories[k]?.max }));
  const rows = [...x.top.map((t, i) => ({ t, rank: String(i + 1) })), ...x.baselines.map((t) => ({ t, rank: `${t.place} (baseline)` }))];
  return (
    <Box mt="xl">
      <Title order={2} fz="xl">Top 10 in detail</Title>
      <Text size="sm" c="dimmed">
        Totals within about 2 points are not separable with one trial per arm. Not in the score: drawing correctness
        (Claude Opus 5.5 review) and mutation score (share of mutants the app's own tests catch, Stryker). n/a: not measured.
      </Text>
      <Region label={`${x.brief}: top 10 in detail`} minWidth={1000}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Rank</Table.Th><Table.Th>Arm</Table.Th><Table.Th>Runtime</Table.Th><Table.Th>Setup</Table.Th>
            <Table.Th>Final</Table.Th>{cats.map((c) => <Table.Th key={c.k}>{c.label} ({c.max})</Table.Th>)}
            <Table.Th>Drawings</Table.Th><Table.Th>Mutation</Table.Th><Table.Th>Minutes</Table.Th><Table.Th>API cost</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map(({ t, rank }) => (
            <Table.Tr key={t.key}>
              <Table.Td>{rank}</Table.Td><Table.Td>{t.arm}</Table.Td><Table.Td>{t.runtime}</Table.Td><Table.Td>{plain(t.setup)}</Table.Td>
              <Table.Td fw={700}>{one(t.final.total)}</Table.Td>
              {cats.map((c) => <Table.Td key={c.k}>{one(t.final.categories[c.k].score)}</Table.Td>)}
              <Table.Td>{t.drawings ? `${t.drawings.correctAlphaApart}/${t.drawings.of}` : 'n/a'}</Table.Td><Table.Td>{pct(t.mutation)}</Table.Td>
              <Table.Td>{t.minutes}</Table.Td><Table.Td>{usd(t.cost)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Region>
    </Box>
  );
}

function Gallery({ base, t }: { base: string; t: Trial }) {
  if (!t.screenshots.length) return <Text size="sm" c="dimmed" mt="xs">No screenshots (the app did not start or the step was not reached).</Text>;
  return (
    <ul className="gallery">
      {t.screenshots.map((f) => (
        <li key={f}>
          <a href={shot(base, t, f)}>
            <img src={shot(base, t, f)} alt={`${t.arm}, round ${t.round}: ${shotLabel(f)}`} loading="lazy" decoding="async" />
          </a>
          <Text size="xs" c="dimmed" mt={4}>{shotLabel(f)}</Text>
        </li>
      ))}
    </ul>
  );
}

function Round({ base, r, kind, t, many }: { base: string; r: Run; kind: Ranking['kind']; t: Trial; many: boolean }) {
  const facts = [
    many && kind === 'brownfield' && `score ${fmt(kind, t.brownfield)}`,
    r.featuresOf != null && `features ${of(t.features, r.featuresOf)}`, r.robustnessOf != null && `robustness ${of(t.robustness, r.robustnessOf)}`,
    t.overall != null && `review ${t.overall}/10`, `${t.minutes} minutes`, t.cost != null && `API cost ${usd(t.cost)}`,
  ].filter(Boolean).join(', ');
  return (
    <Box mt="md">
      {many ? <Title order={4} fz="md">Round {t.round}: {facts}</Title> : <Text size="sm">{facts[0].toUpperCase() + facts.slice(1)}.</Text>}
      {t.notes?.verdict && <Text size="sm" mt={4}>{t.notes.verdict}</Text>}
      {t.notes && (t.notes.strengths.length > 0 || t.notes.issues.length > 0) && (
        <details className="notes">
          <summary>Review notes</summary>
          {t.notes.strengths.length > 0 && <><Text size="sm" fw={700} mt="xs">Strengths</Text><ul className="list">{t.notes.strengths.map((x) => <li key={x}>{x}</li>)}</ul></>}
          {t.notes.issues.length > 0 && <><Text size="sm" fw={700} mt="xs">Issues</Text><ul className="list">{t.notes.issues.map((x) => <li key={x}>{x}</li>)}</ul></>}
        </details>
      )}
      <Gallery base={base} t={t} />
    </Box>
  );
}

// One run: findings, the full ranking, the top 10 in detail where the run has a final score, then every arm with its rounds.
export function BenchRun({ base, r, ranking, top, notes }: { base: string; r: Run; ranking: Ranking; top?: Top; notes: Notes }) {
  const note = notes.runs[r.run], many = Number(r.k) > 1;
  return (
    <BenchShell base={base}>
      <Stack gap="xs" maw={820} mb="xl">
        <Anchor href={`${base}/bench/`} size="sm" underline="hover"><Group gap={4} component="span"><IconArrowLeft size={14} />All benchmarks</Group></Anchor>
        <Title order={1} fz={{ base: 32, md: 44 }}>{r.brief}, {r.model}</Title>
        {notes.briefs[r.brief] && <Text size="lg">{notes.briefs[r.brief]}</Text>}
        <Meta r={r} />
        {r.report && <Text>Full report: <Anchor href={`${REPO}/blob/main/bench/results/${r.report}`}>{r.report}</Anchor></Text>}
        <Summary text={note?.summary} />
        {note?.findings.length ? (<><Title order={2} fz="xl" mt="md">Key findings</Title><ul className="list">{note.findings.map((f) => <li key={f}>{f}</li>)}</ul></>) : null}
      </Stack>

      {ranking.groups.map((g) => (
        <Box key={g.runtime ?? 'all'} component="section" aria-labelledby={slug('rank', g.runtime)} mb="xl">
          <Title order={2} fz="xl" id={slug('rank', g.runtime)}>Ranking{g.runtime ? `, ${g.runtime}` : ''}</Title>
          <Text size="sm" c="dimmed">{SCORE[ranking.kind]}: {note?.score ?? SCORE_HELP[ranking.kind]}</Text>
          <Region label={`${r.brief}, ${r.model}${g.runtime ? `, ${g.runtime}` : ''}: ranked arms`} minWidth={640}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Rank</Table.Th><Table.Th>Arm</Table.Th><Table.Th>Setup</Table.Th>{!g.runtime && <Table.Th>Runtime</Table.Th>}
                <Table.Th>Score</Table.Th>{many && <Table.Th>Rounds</Table.Th>}
                {r.featuresOf != null && <Table.Th>Features</Table.Th>}{r.robustnessOf != null && <Table.Th>Robustness</Table.Th>}
                {ranking.kind !== 'review' && <Table.Th>Review</Table.Th>}<Table.Th>Minutes</Table.Th><Table.Th>API cost</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {g.rows.map((x) => {
                return (
                  <Table.Tr key={x.arm}>
                    <Table.Td>{x.rank}</Table.Td><Table.Td><Anchor href={`#arm-${x.arm}`}>{x.arm}</Anchor></Table.Td><Table.Td>{plain(x.setup)}</Table.Td>
                    {!g.runtime && <Table.Td>{x.runtime}</Table.Td>}
                    <Table.Td fw={700}>{fmt(ranking.kind, x.score)}</Table.Td>
                    {many && <Table.Td>{x.rounds.map((y) => fmt(ranking.kind, ranking.kind === 'brownfield' ? y.brownfield : ranking.kind === 'final' ? y.final?.total ?? null : y.overall)).join(', ')}</Table.Td>}
                    {r.featuresOf != null && <Table.Td>{x.rounds.map((y) => of(y.features, r.featuresOf)).join(', ')}</Table.Td>}
                    {r.robustnessOf != null && <Table.Td>{x.rounds.map((y) => of(y.robustness, r.robustnessOf)).join(', ')}</Table.Td>}
                    {ranking.kind !== 'review' && <Table.Td>{x.rounds.map((y) => y.overall ?? 'n/a').join(', ')}</Table.Td>}
                    <Table.Td>{x.minutes}</Table.Td><Table.Td>{usd(x.cost)}</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Region>
        </Box>
      ))}

      {top && <TopDetail t={top} />}

      <Title order={2} fz="xl" mt={56}>Arms</Title>
      <Text size="sm" c="dimmed">Review notes by Claude Opus 5.5 and the scorer's screenshots of each app. Select a screenshot to open it at full size.</Text>
      {ranking.groups.flatMap((g) => g.rows).map((x) => (
        <Box key={x.arm} component="section" id={`arm-${x.arm}`} aria-labelledby={`arm-h-${x.arm}`} mt="xl" className="card">
          <Title order={3} fz="lg" id={`arm-h-${x.arm}`}>
            {x.arm}: {plain(x.setup)}{x.runtime === 'Claude Code' ? '' : ` (${x.runtime})`}
          </Title>
          <Text size="sm" c="dimmed">Rank {x.rank}, score {fmt(ranking.kind, x.score)}{many ? ' (median)' : ''}.</Text>
          {x.rounds.map((t) => <Round key={t.key} base={base} r={r} kind={ranking.kind} t={t} many={many} />)}
        </Box>
      ))}
    </BenchShell>
  );
}
