import type { AgentSession, SessionFigures, SessionsBoard } from "@cedarloom/contracts";
import { PRICES } from "./prices.ts";

const DAY = 86_400_000;
const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
// Calendar days as `YYYY-MM-DD`, stepped in UTC, where no day is shorter or longer than another.
const plusDays = (day: string, count: number): string =>
  new Date(Date.parse(day) + count * DAY).toISOString().slice(0, 10);

/** The calendar day an instant falls on in a time zone (an IANA name such as `Europe/Berlin`). */
const dayIn = (zone: string): ((iso: string) => string) => {
  const format = new Intl.DateTimeFormat("en", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  return (iso) => {
    const part = new Map(format.formatToParts(Date.parse(iso)).map(({ type, value }) => [type, value]));
    return `${part.get("year")}-${part.get("month")}-${part.get("day")}`;
  };
};

/** The figures of a period: `days` are its sessions' days, `span` the period's days, oldest first. */
const figuresOf = (sessions: readonly AgentSession[], days: string[], span: readonly string[]): SessionFigures => {
  const started = new Set(days);
  let run = 0;
  let streak = 0;
  for (const day of span) {
    run = started.has(day) ? run + 1 : 0;
    streak = Math.max(streak, run);
  }
  const costs = sessions.flatMap((session) => (session.costUSD === null ? [] : [session.costUSD]));
  const tested = sessions.filter((session) => session.tests !== null);
  return {
    sessions: sessions.length,
    busyMs: sum(sessions.map((session) => session.busyMs ?? 0)),
    costUSD: costs.length > 0 ? sum(costs) : null,
    uncosted: sessions.length - costs.length,
    tokens: sum(sessions.map((session) => session.tokens)),
    days: span.length,
    daysWorked: span.filter((day) => started.has(day)).length,
    streak,
    tested: tested.length,
    testsPassed: tested.length > 0 ? tested.filter((session) => session.tests === "pass").length / tested.length : null,
  };
};

/** The period by its length in days up to today (null: all time), the project (null: every one), and the time zone. */
export interface BoardQuery {
  readonly days: number | null;
  readonly project: string | null;
  readonly zone: string;
}

// All time is at most the longest period, so one log with a reset clock does not make a span of decades.
const LONGEST = 3650;

/** The board of a period and a project, from every session of the machine, newest first; `now` decides today. */
export const boardOf = (
  all: readonly AgentSession[],
  { days, project, zone }: BoardQuery,
  now: Date,
): SessionsBoard => {
  const dayOf = dayIn(zone);
  const today = dayOf(now.toISOString());
  const own = project === null ? all : all.filter((s) => s.project === project);
  const oldest = own.at(-1);
  const from = days === null && oldest !== undefined ? dayOf(oldest.start) : plusDays(today, 1 - (days ?? 1));
  const start = [from, plusDays(today, 1 - LONGEST)].reduce((a, b) => (a > b ? a : b));
  const span: string[] = [];
  for (let day = start <= today ? start : today; day <= today; day = plusDays(day, 1)) span.push(day);
  const sessions = own.filter((s) => dayOf(s.start) >= (span[0] ?? today));
  const counts = Map.groupBy(
    all.flatMap((s) => (s.project === null ? [] : [s.project])),
    (name) => name,
  );
  const projects = [...counts]
    .toSorted(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b))
    .map(([name]) => name);
  const first = all.at(-1);
  return {
    days,
    project,
    zone,
    span,
    first: first === undefined ? null : dayOf(first.start),
    projects,
    figures: figuresOf(
      sessions,
      sessions.map((s) => dayOf(s.start)),
      span,
    ),
    sessions,
    prices: { date: PRICES.date, source: PRICES.source },
  };
};
