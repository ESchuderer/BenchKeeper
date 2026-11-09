import type { AgentSession } from "@cedarloom/contracts";
import { expect, test } from "vitest";
import { boardOf } from "@cedarloom/sessions";

const row = (start: string, project: string | null, more: Partial<AgentSession> = {}): AgentSession => ({
  agent: "claude-code",
  id: start,
  project,
  title: null,
  start,
  end: start,
  busyMs: 60_000,
  tokens: 100,
  costUSD: 1,
  costEstimated: false,
  unpriced: [],
  tests: null,
  ...more,
});

// Newest first, as the reader gives them.
const all = [
  row("2026-11-05T09:00:00.000Z", "/work/lab", { busyMs: null, costUSD: null, tests: "fail" }),
  row("2026-11-04T23:59:00.000Z", "/work/shop", { tests: "pass" }),
  row("2026-11-04T00:00:00.000Z", "/work/shop", { costUSD: 0.5, tests: "pass" }),
  row("2026-11-03T08:00:00.000Z", "/work/shop"),
  row("2026-10-20T08:00:00.000Z", "/work/lab"),
  row("2026-10-19T08:00:00.000Z", "/work/lab"),
  row("2026-10-18T08:00:00.000Z", "/work/lab"),
  row("2026-10-01T08:00:00.000Z", null),
  // Codex keeps a rollout until its thread is deleted: an older one says nothing of Claude Code's window.
  row("2026-09-01T08:00:00.000Z", null, { agent: "codex" }),
];
const now = new Date("2026-11-05T12:00:00.000Z");

test("a period: its UTC days up to today, its sessions, and figures with days worked and the longest run", () => {
  const board = boardOf(all, { days: 3, project: null, zone: "UTC" }, now);
  expect(board.span).toEqual(["2026-11-03", "2026-11-04", "2026-11-05"]);
  expect(board.sessions.map((s) => s.start)).toEqual(all.slice(0, 4).map((s) => s.start));
  expect(board.figures).toEqual({
    sessions: 4,
    busyMs: 180_000,
    costUSD: 2.5,
    uncosted: 1,
    tokens: 400,
    days: 3,
    daysWorked: 3,
    streak: 3,
    tested: 3,
    testsPassed: 2 / 3,
  });
  // Ranked by sessions over all time, so a project keeps its place whatever the period.
  expect(board.projects).toEqual(["/work/lab", "/work/shop"]);
});

test("one project over all time, from its first session's day", () => {
  const board = boardOf(all, { days: null, project: "/work/lab", zone: "UTC" }, now);
  expect(board.span[0]).toBe("2026-10-18");
  expect(board.span).toHaveLength(19);
  // The first day Claude Code's transcripts cover, before the project's first session and after Codex's.
  expect(board.first).toBe("2026-10-01");
  expect(board.figures).toMatchObject({ sessions: 4, daysWorked: 4, streak: 3, costUSD: 3, tested: 1, testsPassed: 0 });
});

test("days are the time zone's: an evening in Los Angeles counts on that day, and nothing after today", () => {
  // 19:30 on November 4 and 5 in Los Angeles (a clock ahead), and 22:00 on the 4th there when the board is read.
  const evening = [row("2026-11-06T03:30:00.000Z", "/work/shop"), row("2026-11-05T03:30:00.000Z", "/work/shop")];
  const board = boardOf(
    evening,
    { days: 2, project: null, zone: "America/Los_Angeles" },
    new Date("2026-11-05T06:00:00.000Z"),
  );
  expect(board.span).toEqual(["2026-11-03", "2026-11-04"]);
  expect(board.first).toBe("2026-11-04");
  expect(board.figures).toMatchObject({ sessions: 1, daysWorked: 1 });
});

test("a time zone this runtime does not know counts in UTC, as TZ set but empty gives Etc/Unknown", () => {
  const board = boardOf(all, { days: 1, project: null, zone: "Etc/Unknown" }, now);
  expect([board.zone, board.span]).toEqual(["UTC", ["2026-11-05"]]);
});
