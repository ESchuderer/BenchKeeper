import type { Api, components } from "@cedarloom/client";
import { Alert, Group, Paper, SegmentedControl, Select, SimpleGrid, Stack, Table, Text } from "@mantine/core";
import { type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useState } from "react";
import { call } from "./call.ts";
import { t, when } from "./i18n.ts";

type Board = components["schemas"]["SessionsBoard"];
type Row = Board["sessions"][number];
type Metric = "sessions" | "busyMs" | "tokens" | "costUSD";

// Mantine's own shades, validated as a categorical set on white: CVD and normal-vision separation, 3:1 contrast.
const SERIES = ["blue-7", "orange-8", "teal-8", "violet-6", "pink-7"].map((name) => `var(--mantine-color-${name})`);
const OTHER = "var(--mantine-color-gray-6)";
const VALUE: Record<Metric, (row: Row) => number> = {
  sessions: () => 1,
  busyMs: (row) => row.busyMs ?? 0,
  tokens: (row) => row.tokens,
  costUSD: (row) => row.costUSD ?? 0,
};
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const dollars = new Intl.NumberFormat("en", { style: "currency", currency: "USD" });
// The board's days are UTC days.
const date = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });
const time = (ms: number | null): string => {
  if (ms === null) return t("sessions.none");
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};
const usd = (value: number | null): string => (value === null ? t("sessions.none") : dollars.format(value));
const FORMAT: Record<Metric, (value: number) => string> = {
  sessions: String,
  busyMs: time,
  tokens: (value) => compact.format(value),
  costUSD: usd,
};
const folder = (path: string): string => path.split(/[\\/]/).findLast(Boolean) ?? path;
const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

const Figure = ({ label, value, note }: { label: string; value: string; note: string | null }) => (
  <Paper withBorder p="sm">
    <Text size="sm">{label}</Text>
    <Text size="xl" fw={600}>
      {value}
    </Text>
    {note !== null && <Text size="xs">{note}</Text>}
  </Paper>
);

// The period reaches past the logs the agent tools still keep: its first days have no data, not no work.
const before = ({ span, first }: Board): boolean => first !== null && (span[0] ?? first) < first;

const Figures = ({ board }: { board: Board }) => {
  const { figures: f, prices, first } = board;
  const since =
    before(board) && first !== null ? t("sessions.dataFrom", { first: date.format(Date.parse(first)) }) : "";
  return (
    <SimpleGrid cols={{ base: 2, sm: 3 }}>
      <Figure label={t("sessions.count")} value={String(f.sessions)} note={null} />
      <Figure label={t("sessions.time")} value={time(f.busyMs)} note={t("sessions.timeNote")} />
      <Figure
        label={t("sessions.cost")}
        value={usd(f.costUSD)}
        note={t("sessions.costNote", { date: prices.date, uncosted: f.uncosted })}
      />
      <Figure label={t("sessions.tokens")} value={compact.format(f.tokens)} note={t("sessions.tokensNote")} />
      <Figure
        label={t("sessions.daysWorked")}
        value={t("sessions.daysOf", { worked: f.daysWorked, days: f.days })}
        note={[t("sessions.streak", { streak: f.streak }), since].filter(Boolean).join(". ")}
      />
      <Figure
        label={t("sessions.testsPassed")}
        value={f.testsPassed === null ? t("sessions.none") : `${Math.round(f.testsPassed * 100)}%`}
        note={t("sessions.tested", { tested: f.tested })}
      />
    </SimpleGrid>
  );
};

// The calendar day a session started on in the board's time zone, as the server counts it; Canada writes YYYY-MM-DD.
const dayIn = (zone: string): ((iso: string) => string) => {
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: zone });
  return (iso) => format.format(Date.parse(iso));
};

/** The board's series: its busiest projects by rank over all time, so a project keeps its color, then Other. */
const seriesOf = (board: Board) => {
  const top = board.projects.slice(0, SERIES.length);
  // A chosen project outside the busiest is named too, in Other's color.
  const named = board.project === null || top.includes(board.project) ? top : [...top, board.project];
  const slot = (row: Row): number => {
    const at = named.indexOf(row.project ?? "");
    return at === -1 ? named.length : at;
  };
  const byDay = Map.groupBy(board.sessions, (row) => dayIn(board.zone)(row.start));
  return { named, slot, byDay };
};

const W = 720;
const H = 160;

// A project keeps the color of its rank; the legend names only those the period shows.
const Legend = ({ named, rows, stacks }: { named: string[]; rows: Row[]; stacks: number[][] }) => {
  const shown = new Set(rows.map((row) => row.project));
  const other = stacks.some((column) => (column.at(-1) ?? 0) > 0);
  const keys = [
    ...named.flatMap((name, at) => (shown.has(name) ? [[name, SERIES[at] ?? OTHER] as const] : [])),
    ...(other ? [[t("sessions.other"), OTHER] as const] : []),
  ];
  return (
    <Group gap="md">
      {keys.map(([name, color]) => (
        <Group key={name} gap={6}>
          <svg width={12} height={12} aria-hidden="true">
            <rect width={12} height={12} rx={3} fill={color} />
          </svg>
          <Text size="sm" title={name}>
            {folder(name)}
          </Text>
        </Group>
      ))}
    </Group>
  );
};

// Each day's values per series, the last one Other.
const stacksOf = (board: Board, metric: Metric): { named: string[]; stacks: number[][] } => {
  const { named, slot, byDay } = seriesOf(board);
  const stacks = board.span.map((day) => {
    const parts = Array.from({ length: named.length + 1 }, () => 0);
    for (const row of byDay.get(day) ?? []) parts[slot(row)] = (parts[slot(row)] ?? 0) + VALUE[metric](row);
    return parts;
  });
  return { named, stacks };
};

type BarsProps = { stacks: number[][]; days: string[]; at: number | null; series: number };

// One stacked column per day, 2 px of surface between segments; the day in focus stands out.
const Bars = ({ stacks, days, at, series }: BarsProps) => {
  const peak = Math.max(...stacks.map(sum), 0) || 1;
  // The gaps between segments take room too, so the tallest stack stays inside the top line.
  const gaps = 2 * Math.max(0, ...stacks.map((column) => column.filter((value) => value > 0).length - 1));
  const scale = (H - 8 - gaps) / peak;
  const step = W / Math.max(days.length, 1);
  const width = Math.max(1, Math.min(18, step - 2));
  return stacks.map((column, i) => {
    let top = H;
    return column.map((value, k) => {
      const height = value * scale;
      if (height <= 0) return null;
      top -= height;
      const y = top;
      top -= 2;
      const fill = k < series ? (SERIES[k] ?? OTHER) : OTHER;
      const box = { x: i * step + (step - width) / 2, y, width, height: Math.max(1, height), rx: 2 };
      return <rect key={`${days[i]}-${k}`} {...box} fill={fill} opacity={at !== null && at !== i ? 0.55 : 1} />;
    });
  });
};

// The days before the oldest session log, greyed: no data, not no work.
const Before = ({ board: { span, first } }: { board: Board }) => {
  const days = first === null ? 0 : span.filter((day) => day < first).length;
  return days === 0 ? null : <rect width={(days * W) / span.length} height={H} fill="var(--mantine-color-gray-1)" />;
};

// A day's values per project, or that the logs do not reach it.
const readoutOf = (board: Board, day: string, values: string[]): string =>
  board.first !== null && day < board.first ? t("sessions.noData") : values.join(", ") || "0";

/** Sessions, time, tokens or cost per day and project; the readout names a day's values, by pointer or arrow keys. */
const Chart = ({ board, metric }: { board: Board; metric: Metric }): ReactNode => {
  const [at, setAt] = useState<number | null>(null);
  const { named, stacks } = stacksOf(board, metric);
  const move = (to: number): void => setAt(Math.min(Math.max(to, 0), board.span.length - 1));
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    move((at ?? board.span.length) + (event.key === "ArrowLeft" ? -1 : 1));
  };
  const onPointer = (event: MouseEvent<SVGSVGElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    move(Math.floor(((event.clientX - box.left) / box.width) * board.span.length));
  };
  const day = at === null ? undefined : board.span[at];
  const names = [...named, t("sessions.other")];
  const parts = at === null ? [] : (stacks[at] ?? []);
  const values = parts.flatMap((value, k) => (value > 0 ? [`${folder(names[k] ?? "")} ${FORMAT[metric](value)}`] : []));
  const readout = day === undefined ? "" : readoutOf(board, day, values);
  return (
    <Stack gap="xs">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        tabIndex={0}
        aria-label={t("sessions.chart", { metric, from: board.span[0] ?? "", to: board.span.at(-1) ?? "" })}
        onKeyDown={onKey}
        onMouseMove={onPointer}
        onMouseLeave={() => setAt(null)}
      >
        <Before board={board} />
        <line x1={0} x2={W} y1={8.5} y2={8.5} stroke="var(--mantine-color-gray-3)" />
        <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--mantine-color-gray-4)" />
        <Bars stacks={stacks} days={board.span} at={at} series={named.length} />
      </svg>
      <Group justify="space-between">
        <Text size="xs">{date.format(Date.parse(board.span[0] ?? ""))}</Text>
        <Text size="xs">{t("sessions.peak", { value: FORMAT[metric](Math.max(...stacks.map(sum), 0)) })}</Text>
        <Text size="xs">{date.format(Date.parse(board.span.at(-1) ?? ""))}</Text>
      </Group>
      <Text size="sm" role="status">
        {day === undefined ? t("sessions.hint") : `${date.format(Date.parse(day))}: ${readout}`}
      </Text>
      <Legend named={named} rows={board.sessions} stacks={stacks} />
    </Stack>
  );
};

const SessionRow = ({ row }: { row: Row }) => (
  <Table.Tr>
    <Table.Td>{when(row.start)}</Table.Td>
    <Table.Td title={row.project ?? ""}>{row.project === null ? t("sessions.none") : folder(row.project)}</Table.Td>
    <Table.Td>{row.title ?? ""}</Table.Td>
    <Table.Td>{t("sessions.agent", { agent: row.agent })}</Table.Td>
    <Table.Td>{time(row.busyMs)}</Table.Td>
    <Table.Td>{compact.format(row.tokens)}</Table.Td>
    <Table.Td>{usd(row.costUSD)}</Table.Td>
    <Table.Td>{t("sessions.result", { tests: row.tests ?? "none" })}</Table.Td>
  </Table.Tr>
);

const SessionTable = ({ rows }: { rows: Row[] }) => (
  <Table.ScrollContainer minWidth={760}>
    <Table striped>
      <Table.Caption c="bright">{t("sessions.caption")}</Table.Caption>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{t("sessions.started")}</Table.Th>
          <Table.Th>{t("sessions.project")}</Table.Th>
          <Table.Th>{t("sessions.title")}</Table.Th>
          <Table.Th>{t("sessions.agentColumn")}</Table.Th>
          <Table.Th>{t("sessions.time")}</Table.Th>
          <Table.Th>{t("sessions.tokens")}</Table.Th>
          <Table.Th>{t("sessions.costColumn")}</Table.Th>
          <Table.Th>{t("sessions.tests")}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row) => (
          <SessionRow key={`${row.agent}-${row.id}`} row={row} />
        ))}
      </Table.Tbody>
    </Table>
  </Table.ScrollContainer>
);

const PERIODS = ["7", "30", "90", "all"];
const METRICS: Metric[] = ["sessions", "busyMs", "tokens", "costUSD"];

type FilterProps = {
  board: Board | null;
  days: string;
  project: string | null;
  onChoose: (choice: { days?: string; project?: string | null }) => void;
};

const Filters = ({ board, days, project, onChoose }: FilterProps) => (
  <Group align="end">
    <SegmentedControl
      aria-label={t("sessions.period")}
      value={days}
      onChange={(value) => onChoose({ days: value })}
      data={PERIODS.map((value) => ({
        value,
        label: value === "all" ? t("sessions.allTime") : t("sessions.days", { days: value }),
      }))}
    />
    <Select
      label={t("sessions.project")}
      value={project ?? ""}
      onChange={(value) => onChoose({ project: value === "" || value === null ? null : value })}
      data={[
        { value: "", label: t("sessions.allProjects") },
        ...(board?.projects ?? []).map((value) => ({ value, label: value })),
      ]}
      allowDeselect={false}
    />
  </Group>
);

// The board's days are the browser's, as its table shows the sessions' times.
const queryOf = (days: string, project: string | null) => ({
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  ...(days === "all" ? {} : { days: Number(days) }),
  ...(project === null ? {} : { project }),
});

/** The sessions board: a period's figures, sessions per day and project, and its sessions; read on each choice. */
export const SessionsBoard = ({ api }: { api: Api }): ReactNode => {
  const [days, setDays] = useState("30");
  const [project, setProject] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("sessions");
  const [board, setBoard] = useState<Board | null>(null);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    let current = true;
    const query = queryOf(days, project);
    const show = async (): Promise<void> => {
      const answer = await call(() => api.GET("/api/sessions", { params: { query } }));
      if (!current) return;
      setProblem("problem" in answer ? answer.problem : "");
      if ("data" in answer) setBoard(answer.data);
    };
    void show();
    // A later choice's answer replaces this one; an answer that arrives after it is dropped.
    return () => void (current = false);
  }, [api, days, project]);
  return (
    <Stack>
      {problem !== "" && <Alert color="red">{problem}</Alert>}
      <Filters
        board={board}
        days={days}
        project={project}
        onChoose={(choice) => {
          if (choice.days !== undefined) setDays(choice.days);
          if (choice.project !== undefined) setProject(choice.project);
        }}
      />
      {board === null ? (
        <Text role="status">{t("sessions.reading")}</Text>
      ) : (
        <>
          <Figures board={board} />
          <SegmentedControl
            aria-label={t("sessions.metric")}
            value={metric}
            onChange={(value) => setMetric(METRICS.find((m) => m === value) ?? "sessions")}
            data={METRICS.map((value) => ({ value, label: t("sessions.metricName", { metric: value }) }))}
          />
          <Chart key={`${board.days}-${board.project}`} board={board} metric={metric} />
          {board.sessions.length === 0 ? <Text>{t("sessions.empty")}</Text> : <SessionTable rows={board.sessions} />}
        </>
      )}
    </Stack>
  );
};
