import { resolve } from "node:path";
import { shown } from "@cedarloom/contracts";
import * as useCases from "@cedarloom/use-cases";
import { type Context, EXIT, emit } from "./output.ts";
import { cacheDir } from "./state.ts";

type Board = Awaited<ReturnType<typeof useCases.sessionsBoard>>;

export const logsOf = (ctx: Context): useCases.Logs => useCases.sessionLogs(ctx.io.env, cacheDir(ctx.io.env));

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const time = (ms: number | null): string => {
  if (ms === null) return "-";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};
const usd = (value: number | null): string => (value === null ? "-" : `$${value.toFixed(2)}`);
const share = (value: number | null): string => (value === null ? "-" : `${Math.round(value * 100)}%`);

// Paths and titles come from the session logs: shown with control characters escaped.
const figures = ({ span, project, figures: f }: Board): string[] => [
  `${f.sessions} sessions from ${span[0] ?? "-"} to ${span.at(-1) ?? "-"}, ${project === null ? "every project" : shown(project)}`,
  `agent time ${time(f.busyMs)}, tokens ${compact.format(f.tokens)}, cost ${usd(f.costUSD)} (estimates; ${f.uncosted} without a cost)`,
  `days worked ${f.daysWorked} of ${f.days}, longest run ${f.streak}; tests passed ${share(f.testsPassed)} of ${f.tested} with a test run`,
];

const line = (s: Board["sessions"][number]): string =>
  [
    `${s.start.slice(0, 16).replace("T", " ")}Z`,
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
  const value = await useCases.sessionsBoard(logsOf(ctx), { days, project });
  emit(ctx, "board", { board: value }, [...figures(value), ...value.sessions.map(line)].join("\n"));
  return EXIT.ok;
};
