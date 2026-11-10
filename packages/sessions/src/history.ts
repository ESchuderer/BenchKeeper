import { readFileSync, renameSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { AgentSession, type SessionsBoard } from "@cedarloom/contracts";
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
const History = z.object({ version: z.literal(VERSION), sessions: z.array(z.unknown()) });

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

type Kept = { rows: Row[]; moved: string | null };

// As Chromium's JsonPrefStore does: its rows stay for recovery by hand, not overwritten; null leaves an unmovable one.
const moveAside = (file: string): Kept | null => {
  try {
    renameSync(file, `${file}.bad`);
    return { rows: [], moved: `${file}.bad` };
  } catch {
    return null;
  }
};

// Missing: a new history; no JSON (a cut-off write, a stray byte): moved to `.bad`, replacing an older one, and a new
// history. Unreadable now (no permission, a rename on Windows) or another version's: null, never shown or written over.
// A row this version cannot read goes at the next write.
const readHistory = (file: string): Kept | null => {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ENOENT" ? { rows: [], moved: null } : null;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return moveAside(file);
  }
  const rows = History.safeParse(json).data?.sessions.flatMap((row) => Row.safeParse(row).data ?? []);
  return rows === undefined ? null : { rows, moved: null };
};

/**
 * The live sessions, and from the history those whose logs are gone; the history then holds each live session's
 * figures as they are now. Read after the logs, so a delete during a long read holds. `historyMoved`: the `.bad` file
 * this read moved a history that is not JSON to, else null.
 */
// shortcut: no lock, the last of two writers wins and a delete in the milliseconds before a write is undone; lock the file if that shows.
export const withHistory = (
  live: AgentSession[],
  file: string | null,
): Pick<SessionsBoard, "sessions" | "historyMoved"> => {
  const kept = file === null ? null : readHistory(file);
  if (file === null || kept === null) return { sessions: live, historyMoved: null };
  const rows = new Map(kept.rows.map((row) => [keyOf(row), row]));
  let changed = false;
  for (const session of live) {
    const row = rowOf(session);
    changed ||= !isDeepStrictEqual(rows.get(keyOf(row)), row);
    rows.set(keyOf(row), row);
  }
  if (changed) writePrivate(file, { version: VERSION, sessions: [...rows.values()] });
  const own = new Set(live.map(keyOf));
  const gone = [...rows.values()].filter((row) => !own.has(keyOf(row))).map(sessionOf);
  return { sessions: [...live, ...gone], historyMoved: kept.moved };
};
