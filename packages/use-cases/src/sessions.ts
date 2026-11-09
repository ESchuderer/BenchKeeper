import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { SessionsBoard } from "@cedarloom/contracts";
import { type BoardQuery, boardOf, type Logs, readSessions } from "@cedarloom/sessions";
import { claudeHome } from "./profiles.ts";

export type { BoardQuery, Logs };

/**
 * Where this machine's session logs are: the Claude Code home, the Codex home (`CODEX_HOME`, else `~/.codex`, as
 * codex-rs/utils/home-dir resolves it), and the cache file in CedarLoom's cache folder.
 */
export const sessionLogs = (env: Readonly<Record<string, string | undefined>>, cache: string): Logs => ({
  claude: claudeHome(env),
  codex: resolve(env["CODEX_HOME"] || join(homedir(), ".codex")),
  cache: join(cache, "sessions.json"),
});

/** The sessions board of a period and a project, read from the session logs on demand. */
export const sessionsBoard = async (logs: Logs, query: BoardQuery, now = new Date()): Promise<SessionsBoard> =>
  boardOf(await readSessions(logs), query, now);
