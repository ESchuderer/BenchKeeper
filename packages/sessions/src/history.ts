import { isUtf8 } from "node:buffer";
import { readFileSync } from "node:fs";
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

// A copy of the bytes read, not a rename of the path, so a second reader cannot move the first one's new history over them.
const moveAside = (file: string, bytes: Buffer): Kept | null =>
  writePrivate(`${file}.bad`, bytes) ? { rows: [], moved: `${file}.bad` } : null;

// A file unreadable now or of another version may read later, so it is never written over; one not JSON never will.
const readHistory = (file: string): Kept | null => {
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ENOENT" ? { rows: [], moved: null } : null;
  }
  // A byte that is not UTF-8 would parse as U+FFFD and garble or drop its row, with no copy of the byte.
  if (!isUtf8(bytes)) return moveAside(file, bytes);
  let json: unknown;
  try {
    // A byte-order mark, as Windows editors save one, still leaves JSON.
    json = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    return moveAside(file, bytes);
  }
  const rows = History.safeParse(json).data?.sessions.flatMap((row) => Row.safeParse(row).data ?? []);
  return rows === undefined ? null : { rows, moved: null };
};

/**
 * The live sessions, and from the history those whose logs are gone; the history then holds each live session's
 * figures as they are now. Read after the logs, so a delete during a long read holds. `historyMoved`: the `.bad` file
 * this read moved a history that is not JSON aside to, else null.
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
  // A history that is not JSON is replaced even with no live session, so the next read does not copy it again.
  if (changed || kept.moved !== null)
    writePrivate(file, JSON.stringify({ version: VERSION, sessions: [...rows.values()] }));
  const own = new Set(live.map(keyOf));
  const gone = [...rows.values()].filter((row) => !own.has(keyOf(row))).map(sessionOf);
  return { sessions: [...live, ...gone], historyMoved: kept.moved };
};
