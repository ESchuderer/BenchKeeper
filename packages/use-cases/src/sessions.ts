import { rmSync } from "node:fs";
import { join } from "node:path";
import type { AgentSession, SessionsBoard } from "@cedarloom/contracts";
import { type BoardQuery, boardOf, type Logs, readSessions } from "@cedarloom/sessions";
import { claudeHome, codexHome } from "./profiles.ts";

export type { BoardQuery, Logs };
export { projectOf } from "@cedarloom/sessions";

/**
 * Where this machine's session logs are: the Claude Code home, the Codex home, the cache in CedarLoom's cache folder and
 * the history in its state folder.
 */
export const sessionLogs = (
  env: Readonly<Record<string, string | undefined>>,
  cache: string,
  state: string,
): Logs & { readonly history: string } => ({
  claude: claudeHome(env),
  codex: codexHome(env),
  cache: join(cache, "sessions.json"),
  history: join(state, "sessions-history.json"),
});

/** Deletes the sessions history: rows of sessions whose logs are gone go for good; the next read records the others again. */
export const deleteHistory = ({ history }: Logs): void => {
  if (history !== null) rmSync(history, { force: true });
};

// Requests that come while a read runs share it: a first read of many logs takes seconds.
const reading = new Map<string, Promise<AgentSession[]>>();
const sessionsOf = (logs: Logs): Promise<AgentSession[]> => {
  const key = JSON.stringify(logs);
  const running = reading.get(key) ?? readSessions(logs).finally(() => reading.delete(key));
  reading.set(key, running);
  return running;
};

/** The sessions board of a period and a project, read from the session logs on demand. */
export const sessionsBoard = async (logs: Logs, query: BoardQuery, now = new Date()): Promise<SessionsBoard> =>
  boardOf(await sessionsOf(logs), query, now);
