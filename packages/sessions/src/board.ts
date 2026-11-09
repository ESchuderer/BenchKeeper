import type { AgentSession, SessionFigures, SessionsBoard } from "@cedarloom/contracts";
import { PRICES } from "./prices.ts";

const DAY = 86_400_000;
const dayOf = (time: number): string => new Date(time).toISOString().slice(0, 10);
const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

/** The figures of a period: `sessions` are its sessions, `span` its UTC days (`YYYY-MM-DD`, oldest first). */
const figuresOf = (sessions: readonly AgentSession[], span: readonly string[]): SessionFigures => {
  const started = new Set(sessions.map((session) => session.start.slice(0, 10)));
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

/** The period, by its length in days up to today (null: all time), and the project (null: every project). */
export interface BoardQuery {
  readonly days: number | null;
  readonly project: string | null;
}

/** The board of a period and a project, from every session of the machine, newest first; `now` decides today. */
export const boardOf = (all: readonly AgentSession[], { days, project }: BoardQuery, now: Date): SessionsBoard => {
  const today = Date.parse(dayOf(now.getTime()));
  const oldest = all.at(-1)?.start.slice(0, 10);
  const from = days === null ? Math.min(Date.parse(oldest ?? dayOf(today)), today) : today - (days - 1) * DAY;
  const span: string[] = [];
  for (let time = from; time <= today; time += DAY) span.push(dayOf(time));
  const first = span[0] ?? "";
  const sessions = all.filter((s) => s.start.slice(0, 10) >= first && (project === null || s.project === project));
  const counts = Map.groupBy(
    all.flatMap((s) => (s.project === null ? [] : [s.project])),
    (name) => name,
  );
  const projects = [...counts]
    .toSorted(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b))
    .map(([name]) => name);
  return {
    days,
    project,
    span,
    projects,
    figures: figuresOf(sessions, span),
    sessions,
    prices: { date: PRICES.date, source: PRICES.source },
  };
};
