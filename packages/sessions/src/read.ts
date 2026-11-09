import { globSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentSession } from "@cedarloom/contracts";
import { z } from "zod";
import { readClaude } from "./claude.ts";
import { projectOf } from "./project.ts";
import { Summary } from "./summary.ts";

/** Where the logs are: the Claude Code home, and the cache file (null: none). */
export interface Logs {
  readonly claude: string;
  readonly cache: string | null;
}

// A change to what a summary holds raises it, so every log is read again.
const VERSION = 1;
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

// Titles and folders of the user's sessions: this user only; renamed into place, so no reader sees half a file.
const writeCache = (file: string, files: Entries): void => {
  const temp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(temp, JSON.stringify({ version: VERSION, files }), { mode: 0o600 });
    renameSync(temp, file);
  } catch {
    // A cache that cannot be written is rebuilt next time.
  }
};

const logsOf = ({ claude }: Logs): string[] =>
  globSync("projects/*/*.jsonl", { cwd: claude }).map((path) => join(claude, path));

const keyOf = (file: string): string | null => {
  const stat = statSync(file, { throwIfNoEntry: false });
  return stat === undefined ? null : `${stat.size}:${stat.mtimeMs}`;
};

// A log read again keeps the project found before: its worktree may be gone by now.
const summaryOf = async (file: string, before: string | null): Promise<Summary | null> => {
  try {
    const summary = await readClaude(file);
    const project = before ?? (summary.folder === null ? null : projectOf(summary.folder));
    return { ...summary, project };
  } catch {
    return null;
  }
};

const rowOf = ({ id, project, title, start, end, busyMs, tokens, costUSD, tests }: Summary): AgentSession | null =>
  start === null || end === null
    ? null
    : { agent: "claude-code", id, project, title, start, end, busyMs, tokens, costUSD, tests };

// Each log's summary: the cached one while the log's size and modification time hold, else read again.
// shortcut: logs are read one after another (about 8 s for 3.3 GB at first); read several at once if a first read drags.
const summariesOf = async (logs: Logs, cached: Entries): Promise<{ files: Entries; read: number }> => {
  const files: Entries = {};
  let read = 0;
  for (const file of logsOf(logs)) {
    const key = keyOf(file);
    const hit = cached[file];
    if (key === null) continue;
    if (hit?.key !== key) read++;
    const summary = hit?.key === key ? hit.summary : await summaryOf(file, hit?.summary.project ?? null);
    if (summary !== null) files[file] = { key, summary };
  }
  return { files, read };
};

/**
 * Every agent session of this machine, newest first, read from the session logs on demand. A log is parsed once per size
 * and modification time; the cache holds only logs that still exist, so it can be deleted at any time.
 */
export const readSessions = async (logs: Logs): Promise<AgentSession[]> => {
  const cached = readCache(logs.cache);
  const { files, read } = await summariesOf(logs, cached);
  if (logs.cache !== null && (read > 0 || Object.keys(files).length !== Object.keys(cached).length))
    writeCache(logs.cache, files);
  return Object.values(files)
    .map((entry) => rowOf(entry.summary))
    .filter((row) => row !== null)
    .toSorted((a, b) => (a.start < b.start ? 1 : -1));
};
