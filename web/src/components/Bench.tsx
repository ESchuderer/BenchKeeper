import {
  ActionIcon, Anchor, Badge, Box, Button, Card, Container, Group, MantineProvider, NativeSelect, SimpleGrid, Stack, Table, Text,
  TextInput, Title, createTheme,
} from '@mantine/core';
import { IconArrowLeft, IconBrandGithub, IconMoon, IconSun } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { methodLabel } from '../../scripts/bench-data.mjs';

const theme = createTheme({
  primaryColor: 'teal',
  primaryShade: { light: 9, dark: 9 },
  components: { Anchor: { defaultProps: { underline: 'always' } } },
  fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
  headings: { fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif', fontWeight: '800' },
  defaultRadius: 'md',
});

const REPO = 'https://github.com/ESchuderer/BenchKeeper';
const CRITERIA: [string, string][] = [
  ['requirements', 'Requirements'], ['correctness', 'Correctness'], ['security', 'Security'], ['code_quality', 'Code quality'],
  ['tests', 'Tests'], ['ux_design', 'UX and design'], ['accessibility', 'Accessibility'], ['simplicity', 'Simplicity'],
  ['maintainability', 'Maintainability'], ['visual_design', 'Visual design'], ['layout', 'Layout'], ['usability', 'Usability'], ['reception', 'Reception'],
];
const PAGES: Record<string, string> = { start: 'Start page', form: 'Booking form', confirmation: 'Confirmation', staff: 'Staff page' };

export type Shot = { page: string; thumb: string; width: number; height: number; full: string };
export type Trial = {
  key: string; brief: string; model: string; runtime: string; arm: string; setup: string; framework: string; spec: string;
  bk: boolean; ponytail: boolean; features: number | null; robustness: number | null; followups: number; minutes: number;
  testsFirst: boolean; reviewStep: boolean; overall: number | null; scores: Record<string, number>; verdict: string;
  method: { protocol: string | null; tests: string | null; criteria: number | null; bk: string };
  strengths: string[]; issues: string[]; shots: Shot[];
};

const slug = (k: string) => `trial-${k.replace(/[^a-zA-Z0-9]+/g, '-')}`;
const yesNo = (b: boolean) => (b ? 'yes' : 'no');
const values = (ts: Trial[], f: (t: Trial) => string) => [...new Set(ts.map(f))].sort();

function Filter({ name, label, options }: { name: string; label: string; options: string[] }) {
  return <NativeSelect name={name} label={label} data={[{ value: '', label: 'All' }, ...options]} size="sm" />;
}

function SortHead({ k, children }: { k: string; children: string }) {
  return (
    <Table.Th>
      <button type="button" className="sort" data-sort={k}>{children}</button>
    </Table.Th>
  );
}

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

const METHOD = 'Each trial is one app built from the brief by one arm, runtime and model, scored by hidden tests (6 features, 12 robustness checks) and reviewed blind by Claude Opus 5.5 (overall 1 to 10, criteria 1 to 5). One trial per arm and model, so differences are descriptive, not significant.';

export type Brief = { id: string; summary: string; trials: number; arms: number; runtimes: string[]; models: string[]; dates: string[]; methods: { label: string; count: number }[]; reports: string[] };

function Methods({ brief }: { brief: Brief }) {
  return (
    <Text size="sm" c="dimmed" mt="xs">
      Testing method: {brief.methods.map((m, i) => <span key={m.label}>{i > 0 && '; '}{m.label}{brief.methods.length > 1 && ` (${m.count} trials)`}</span>)}
    </Text>
  );
}

export function BenchIndex({ base, briefs }: { base: string; briefs: Brief[] }) {
  return (
    <BenchShell base={base}>
      <Stack gap="xs" maw={820} mb="xl">
        <Anchor href={`${base}/`} size="sm" underline="hover"><Group gap={4} component="span"><IconArrowLeft size={14} />Back to BenchKeeper</Group></Anchor>
        <Title order={1} fz={{ base: 32, md: 44 }}>Benchmark database</Title>
        <Text c="dimmed" size="lg">
          {METHOD} Method: <Anchor href={`${REPO}/blob/main/bench/PROTOCOL.md`}>protocol</Anchor>; results and costs: <Anchor href={`${REPO}/tree/main/bench/results`}>bench/results</Anchor>.
        </Text>
      </Stack>
      <Title order={2} mb="md">Briefs</Title>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        {briefs.map((b) => (
          <Card key={b.id} withBorder padding="lg" className="lift linked">
            <Anchor href={`${base}/bench/${b.id}/`} fw={700} fz="lg" className="stretched" underline="hover">{b.id}</Anchor>
            <Text size="sm" mt="xs">{b.summary}</Text>
            <Text size="sm" c="dimmed" mt="sm">
              {b.trials} trials, {b.arms} arms; {b.runtimes.join(' and ')}; {b.models.join(' and ')}; run {b.dates.join(', ')}
            </Text>
            <Methods brief={b} />
          </Card>
        ))}
      </SimpleGrid>
    </BenchShell>
  );
}

export default function Bench({ base, brief, trials }: { base: string; brief: Brief; trials: Trial[] }) {
  const attrs = (t: Trial, i: number) => ({
    'data-runtime': t.runtime, 'data-model': t.model, 'data-framework': t.framework, 'data-spec': t.spec,
    'data-bk': yesNo(t.bk), 'data-ponytail': yesNo(t.ponytail), 'data-key': t.key,
    'data-text': [t.arm, t.setup, t.framework, t.spec, t.model, t.runtime, t.verdict].join(' ').toLowerCase(),
    'data-order': i, 'data-features': t.features ?? -1, 'data-robustness': t.robustness ?? -1, 'data-overall': t.overall ?? -1,
    'data-followups': t.followups, 'data-minutes': t.minutes,
  });
  return (
    <BenchShell base={base}>
          <Stack gap="xs" maw={820} mb="xl">
            <Anchor href={`${base}/bench/`} size="sm" underline="hover"><Group gap={4} component="span"><IconArrowLeft size={14} />All briefs</Group></Anchor>
            <Title order={1} fz={{ base: 32, md: 44 }}>Brief {brief.id}</Title>
            <Text size="lg">{brief.summary}</Text>
            <Text c="dimmed">
              {METHOD} BK is the BenchKeeper layer, which includes Ponytail. Brief: <Anchor href={`${REPO}/blob/main/bench/briefs/${brief.id}/brief.md`}>brief.md</Anchor>
              {brief.reports.map((r) => <span key={r}>; report: <Anchor href={`${REPO}/blob/main/bench/results/${r}`}>{r}</Anchor></span>)}.
            </Text>
            <Methods brief={brief} />
          </Stack>

          <form data-filters hidden className="filters" aria-label="Filter trials">
            <SimpleGrid cols={{ base: 2, sm: 4, lg: 7 }} spacing="sm">
              <Filter name="runtime" label="Runtime" options={values(trials, (t) => t.runtime)} />
              <Filter name="model" label="Model" options={values(trials, (t) => t.model)} />
              <Filter name="framework" label="Framework" options={values(trials, (t) => t.framework)} />
              <Filter name="spec" label="Spec tool" options={values(trials, (t) => t.spec)} />
              <Filter name="bk" label="BK layer" options={['yes', 'no']} />
              <Filter name="ponytail" label="Ponytail" options={['yes', 'no']} />
              <TextInput name="q" type="search" label="Search" size="sm" />
            </SimpleGrid>
            <Group mt="sm" gap="sm">
              <Button type="reset" variant="default" size="xs">Reset</Button>
              <Text size="sm" c="dimmed" data-count aria-live="polite">{trials.length} trials</Text>
            </Group>
          </form>

          <Table.ScrollContainer minWidth={1100} mt="lg">
            <Table striped highlightOnHover verticalSpacing="xs" fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Arm</Table.Th><Table.Th>Setup</Table.Th><Table.Th>Runtime</Table.Th><Table.Th>Model</Table.Th>
                  <SortHead k="features">Features</SortHead><SortHead k="robustness">Robustness</SortHead><SortHead k="overall">Review</SortHead>
                  <SortHead k="followups">Follow-ups</SortHead><SortHead k="minutes">Minutes</SortHead>
                  <Table.Th>Tests first</Table.Th><Table.Th>Review step</Table.Th><Table.Th>Start page</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody data-rows>
                {trials.map((t, i) => (
                  <Table.Tr key={t.key} data-trial-row {...attrs(t, i)}>
                    <Table.Td><Anchor href={`#${slug(t.key)}`} fw={700}>{t.arm}</Anchor></Table.Td>
                    <Table.Td>{t.setup}</Table.Td><Table.Td>{t.runtime}</Table.Td><Table.Td>{t.model}</Table.Td>
                    <Table.Td>{t.features == null ? 'n/a' : `${t.features}/6`}</Table.Td>
                    <Table.Td>{t.robustness == null ? 'n/a' : `${t.robustness}/12`}</Table.Td>
                    <Table.Td>{t.overall ?? 'n/a'}</Table.Td><Table.Td>{t.followups}</Table.Td><Table.Td>{t.minutes}</Table.Td>
                    <Table.Td>{yesNo(t.testsFirst)}</Table.Td><Table.Td>{yesNo(t.reviewStep)}</Table.Td>
                    <Table.Td>
                      {t.shots[0] ? (
                        <a href={t.shots[0].full}><img src={t.shots[0].thumb} alt={`Start page, arm ${t.arm}, ${t.runtime}, ${t.model}`} width={96} height={Math.round(96 * t.shots[0].height / t.shots[0].width)} className="thumb" loading="lazy" /></a>
                      ) : 'none'}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>

          <Title order={2} mt={56} mb="md">Trials</Title>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg" data-cards>
            {trials.map((t) => (
              <Card key={t.key} withBorder padding="lg" id={slug(t.key)} data-card={t.key}>
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <Title order={3} fz="lg">Arm {t.arm}: {t.setup}</Title>
                  <Badge variant="filled" size="lg" style={{ flexShrink: 0 }}>{t.overall ?? 'n/a'}/10</Badge>
                </Group>
                <Text size="sm" c="dimmed">{t.runtime}, {t.model}</Text>
                <Text size="sm" mt="xs">
                  Features {t.features == null ? 'n/a' : `${t.features}/6`}, robustness {t.robustness == null ? 'n/a' : `${t.robustness}/12`}, follow-ups {t.followups}, {t.minutes} minutes,
                  tests first {yesNo(t.testsFirst)}, review step {yesNo(t.reviewStep)}
                </Text>
                {t.shots.length > 0 && (
                  <SimpleGrid cols={4} spacing={6} mt="sm">
                    {t.shots.map((s) => (
                      <a key={s.page} href={s.full}>
                        <img src={s.thumb} alt={`${PAGES[s.page] || s.page}, arm ${t.arm}, ${t.runtime}, ${t.model}`} width={s.width} height={s.height} className="thumb" loading="lazy" />
                      </a>
                    ))}
                  </SimpleGrid>
                )}
                {t.verdict && <Text size="sm" mt="sm">{t.verdict}</Text>}
                <Text size="xs" c="dimmed" mt="xs">Testing method: {methodLabel(t.method)}</Text>
                <details className="more">
                  <summary>Ratings, strengths and issues</summary>
                  <Table fz="xs" mt="xs" verticalSpacing={2}>
                    <Table.Tbody>
                      {CRITERIA.filter(([k]) => k in t.scores).map(([k, l]) => (
                        <Table.Tr key={k}><Table.Td>{l}</Table.Td><Table.Td>{t.scores[k]}/5</Table.Td></Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                  {t.strengths.length > 0 && (<><Text size="sm" fw={700} mt="sm">Strengths</Text><ul className="list">{t.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></>)}
                  {t.issues.length > 0 && (<><Text size="sm" fw={700} mt="sm">Issues</Text><ul className="list">{t.issues.map((s, i) => <li key={i}>{s}</li>)}</ul></>)}
                </details>
              </Card>
            ))}
          </SimpleGrid>
    </BenchShell>
  );
}
