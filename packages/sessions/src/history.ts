import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { AgentSession } from "@cedarloom/contracts";
import { z } from "zod";
import { writePrivate } from "./private-file.ts";

// A session's figures and its key, nothing else: no title, folder, model or any other text of its log.
const Row = AgentSession.pick({
  agent: true,
  id: true,
  project: true,
  start: true,
  busyMs: true,
  tokens: true,
  costUSD: true,
  tests: true,
});
type Row = z.infer<typeof Row>;

// A change to what a row holds raises it.
const VERSION = 1;
const History = z.object({ version: z.literal(VERSION), sessions: z.array(Row) });

const keyOf = ({ agent, id }: Pick<Row, "agent" | "id">): string => `${agent}:${id}`;

const rowOf = ({ agent, id, project, start, busyMs, tokens, costUSD, tests }: AgentSession): Row => ({
  agent,
  id,
  project,
  start,
  busyMs,
  tokens,
  costUSD,
  tests,
});

// Once its log is gone a session has the history's figures only: no title, its start as its end, no unpriced models.
const sessionOf = (row: Row): AgentSession => ({
  ...row,
  title: null,
  end: row.start,
  costEstimated: row.agent === "codex" && row.costUSD !== null,
  unpriced: [],
});

// Missing, or no JSON as a cut-off write leaves it: a new history. Another version's: null, never shown or written over.
const readHistory = (file: string): Row[] | null => {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  return History.safeParse(json).data?.sessions ?? null;
};

/**
 * The live sessions, and from the history those whose logs are gone; the history then holds each live session's
 * figures as they are now. Read after the logs, so a delete during a long read holds.
 */
// shortcut: no lock, the last of two writers wins and a delete in the milliseconds before a write is undone; lock the file if that shows.
export const withHistory = (live: AgentSession[], file: string | null): AgentSession[] => {
  const kept = file === null ? null : readHistory(file);
  if (file === null || kept === null) return live;
  const rows = new Map(kept.map((row) => [keyOf(row), row]));
  let changed = false;
  for (const session of live) {
    const row = rowOf(session);
    changed ||= !isDeepStrictEqual(rows.get(keyOf(row)), row);
    rows.set(keyOf(row), row);
  }
  if (changed) writePrivate(file, { version: VERSION, sessions: [...rows.values()] });
  const own = new Set(live.map(keyOf));
  return [...live, ...[...rows.values()].filter((row) => !own.has(keyOf(row))).map(sessionOf)];
};
