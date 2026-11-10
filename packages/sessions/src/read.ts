import { globSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { AgentSession, SessionsBoard } from "@cedarloom/contracts";
import { z } from "zod";
import { readClaude } from "./claude.ts";
import { readCodex } from "./codex.ts";
import { withHistory } from "./history.ts";
import { estimate } from "./prices.ts";
import { writePrivate } from "./private-file.ts";
import { projectOf } from "./project.ts";
import { Summary } from "./summary.ts";

/** Where the logs are: the Claude Code home, the Codex home, the cache file and the history file (null: none). */
export interface Logs {
  readonly claude: string;
  readonly codex: string;
  readonly cache: string | null;
  readonly history: string | null;
}

// A change to what a summary holds raises it, so every log is read again.
const VERSION = 2;
const Cache = z.object({
  version: z.literal(VERSION),
  files: z.record(z.string(), z.object({ key: z.string(), summary: Summary })),
});
type Entries = z.infer<typeof Cache>["files"];

// A cache that is missing, unreadable or of another version is rebuilt from the logs.
const readCache = (file: string | null): Entries => {
  try {
    return file === null ? {} : (Cache.safeParse(JSON.parse(readFileSync(file, "utf8"))).data?.files ?? {});
  } catch {
    return {};
  }
};

// A session id has no dot: `<session>.orphaned-<time>-<suffix>.jsonl` is an earlier copy Claude Code set aside.
const logsOf = ({ claude, codex }: Logs): [string, Summary["agent"]][] => [
  ...globSync("projects/*/*.jsonl", { cwd: claude })
    .filter((path) => !basename(path, ".jsonl").includes("."))
    .map((path): [string, "claude-code"] => [join(claude, path), "claude-code"]),
  ...globSync(["sessions/**/rollout-*.jsonl", "archived_sessions/**/rollout-*.jsonl"], { cwd: codex }).map(
    (path): [string, "codex"] => [join(codex, path), "codex"],
  ),
];

const keyOf = (file: string): string | null => {
  const stat = statSync(file, { throwIfNoEntry: false });
  return stat === undefined ? null : `${stat.size}:${stat.mtimeMs}`;
};

// A log read again keeps the project found before: its worktree may be gone by now.
const summaryOf = async (file: string, agent: Summary["agent"], before: string | null): Promise<Summary | null> => {
  try {
    const summary = await (agent === "claude-code" ? readClaude(file) : readCodex(file));
    const project = before ?? (summary.folder === null ? null : projectOf(summary.folder));
    return { ...summary, project };
  } catch {
    return null;
  }
};

type Cost = Pick<AgentSession, "costUSD" | "unpriced">;

const rowOf = (summary: Summary, tokens: number, { costUSD, unpriced }: Cost): AgentSession | null => {
  const { agent, id, project, title, start, end, busyMs, tests } = summary;
  if (start === null || end === null) return null;
  const costEstimated = agent === "codex" && costUSD !== null;
  return { agent, id, project, title, start, end, busyMs, tokens, costUSD, costEstimated, unpriced, tests };
};

const latest = (times: (string | null)[]): string | null =>
  times.reduce<string | null>((last, time) => (time !== null && (last === null || time > last) ? time : last), null);

const total = (values: (number | null)[]): number | null =>
  values.reduce<number | null>((sum, value) => (value === null ? sum : (sum ?? 0) + value), null);

// A subagent's rollout, at any depth, adds its tokens, cost and time to its root session's row, whose tests stay its own;
// of two copies of one rollout (a revert) the longer counts.
const codexRows = (summaries: Summary[]): (AgentSession | null)[] => {
  const byId = new Map<string, Summary>();
  for (const s of summaries) if (s.agent === "codex" && (byId.get(s.id)?.end ?? "") <= (s.end ?? "")) byId.set(s.id, s);
  // The bound stops a loop of parents in damaged logs.
  const rootOf = (summary: Summary): Summary => {
    let at = summary;
    for (let step = 0; step < 50 && at.parent !== null; step++) at = byId.get(at.parent) ?? at;
    return at;
  };
  return [...Map.groupBy(byId.values(), rootOf)].map(([root, family]) => {
    const estimates = family.map(estimate);
    const unpriced = [...new Set(estimates.flatMap((e) => e.unpriced))].toSorted((a, b) => a.localeCompare(b));
    const cost = { costUSD: total(estimates.map((e) => e.costUSD)), unpriced };
    const tokens = family.reduce((sum, s) => sum + s.tokens, 0);
    return rowOf(
      { ...root, end: latest(family.map((s) => s.end)), busyMs: total(family.map((s) => s.busyMs)) },
      tokens,
      cost,
    );
  });
};

// Each log's summary: the cached one while the log's size and modification time hold, else read again.
// shortcut: logs are read one after another (about 8 s for 3.3 GB at first); read several at once if a first read drags.
const summariesOf = async (logs: Logs, cached: Entries): Promise<{ files: Entries; read: number }> => {
  const files: Entries = {};
  let read = 0;
  for (const [file, agent] of logsOf(logs)) {
    const key = keyOf(file);
    const hit = cached[file];
    if (key === null) continue;
    if (hit?.key !== key) read++;
    const summary = hit?.key === key ? hit.summary : await summaryOf(file, agent, hit?.summary.project ?? null);
    if (summary !== null) files[file] = { key, summary };
  }
  return { files, read };
};

/**
 * Every agent session of this machine, newest first, read from the session logs on demand. A log is parsed once per size
 * and modification time; the cache holds only logs that still exist, so it can be deleted at any time. Sessions whose
 * logs are gone come from the history, which, unlike the cache, cannot be rebuilt; `historyMoved` names the file this
 * read moved a history that is not JSON to (null: none).
 */
export const readSessions = async (logs: Logs): Promise<Pick<SessionsBoard, "sessions" | "historyMoved">> => {
  const cached = readCache(logs.cache);
  const { files, read } = await summariesOf(logs, cached);
  if (logs.cache !== null && (read > 0 || Object.keys(files).length !== Object.keys(cached).length))
    writePrivate(logs.cache, { version: VERSION, files });
  const summaries = Object.values(files).map((entry) => entry.summary);
  const claude = summaries
    .filter((s) => s.agent === "claude-code")
    .map((s) => rowOf(s, s.tokens, { costUSD: s.costUSD, unpriced: [] }));
  const live = [...claude, ...codexRows(summaries)].filter((row) => row !== null);
  const { sessions, historyMoved } = withHistory(live, logs.history);
  return { sessions: sessions.toSorted((a, b) => (a.start < b.start ? 1 : -1)), historyMoved };
};
