import { resolve } from "node:path";
import { shown } from "@cedarloom/contracts";
import * as useCases from "@cedarloom/use-cases";
import { type Context, EXIT, emit } from "./output.ts";
import { cacheDir } from "./state.ts";

type Board = Awaited<ReturnType<typeof useCases.sessionsBoard>>;

export const logsOf = (ctx: Context) => useCases.sessionLogs(ctx.io.env, cacheDir(ctx.io.env), ctx.state);

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const time = (ms: number | null): string => {
  if (ms === null) return "-";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};
const usd = (value: number | null): string => (value === null ? "-" : `$${value.toFixed(2)}`);
const share = (value: number | null): string => (value === null ? "-" : `${Math.round(value * 100)}%`);

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

// Paths and titles come from the session logs: shown with control characters escaped.
const figures = ({ span, project, zone, first, prices, figures: f }: Board): string[] => [
  `${plural(f.sessions, "session")} from ${span[0] ?? "-"} to ${span.at(-1) ?? "-"} (${zone}), ${project === null ? "every project" : shown(project)}`,
  `agent time ${time(f.busyMs)}, tokens ${compact.format(f.tokens)}, cost ${usd(f.costUSD)} (estimates: Claude Code's own, Codex at OpenAI's list prices of ${prices.date}; ${f.uncosted} without a cost)`,
  `days worked ${f.daysWorked} of ${f.days}, longest run ${plural(f.streak, "day")}; tests passed ${share(f.testsPassed)} of ${plural(f.tested, "session")} with a test run`,
  ...(first !== null && (span[0] ?? first) < first
    ? [`Claude Code data from ${first}: it deletes older transcripts, so earlier days show less work`]
    : []),
];

const line = (s: Board["sessions"][number], at: Intl.DateTimeFormat): string =>
  [
    at.format(Date.parse(s.start)),
    s.agent.padEnd(11),
    time(s.busyMs).padStart(7),
    compact.format(s.tokens).padStart(6),
    usd(s.costUSD).padStart(8),
    (s.tests ?? "-").padEnd(4),
    shown(s.project ?? "-", 80),
    shown(s.title ?? "", 80),
  ].join("  ");

/** The sessions board of a period (default the last 30 days) and a project: its figures, then its sessions, newest first. */
export const board = async (
  ctx: Context,
  options: { days?: number; all?: true; project?: string },
): Promise<number> => {
  const days = options.all === true ? null : (options.days ?? 30);
  // A folder names its repository's project, as the sessions count it: `--project .` in a worktree too.
  const project = options.project === undefined ? null : useCases.projectOf(resolve(options.project));
  // The days of this machine's own time zone, as its clock shows the sessions' times.
  const zone: string | undefined = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const value = await useCases.sessionsBoard(logsOf(ctx), { days, project, zone });
  // Swedish dates and times read as ISO: 2026-11-09 08:44.
  // The board's zone: an unknown one (TZ set but empty gives Etc/Unknown) counted in UTC.
  const at = new Intl.DateTimeFormat("sv-SE", { timeZone: value.zone, dateStyle: "short", timeStyle: "short" });
  const lines = [...figures(value), ...value.sessions.map((s) => line(s, at))];
  emit(ctx, "board", { board: value }, lines.join("\n"));
  return EXIT.ok;
};

/** Shows deleting the sessions history, or with --yes deletes it. */
export const deleteHistory = (ctx: Context, yes?: true): number => {
  const logs = logsOf(ctx);
  const { history } = logs;
  if (yes === true) useCases.deleteHistory(logs);
  const human =
    yes === true
      ? `Deleted the sessions history ${history}. Sessions whose logs still exist stay on the board, and the history records them again at the next read.`
      : `Would delete the sessions history ${history}: sessions whose logs are gone leave the board for good; sessions whose logs still exist stay, and the history records them again.\nNothing changed. Run the command again with --yes.`;
  emit(ctx, "history", { history, deleted: yes === true }, human);
  return EXIT.ok;
};
