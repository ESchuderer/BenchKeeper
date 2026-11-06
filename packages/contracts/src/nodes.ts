import { z } from "zod";
import { fileFormats } from "./registry.ts";
import { JoinConfig } from "./workflow.ts";

// minute, hour, day of month, month, day of week (0 is Sunday).
const CRON_FIELDS: readonly (readonly [number, number])[] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
];
const number = (text: string): number => (/^\d{1,2}$/.test(text) ? Number(text) : Number.NaN);

// `*`, `n` or `n-m` within the field's bounds.
const cronRange = (range: string, [min, max]: readonly [number, number]): boolean => {
  if (range === "*") return true;
  const [from = "", to = from, ...more] = range.split("-");
  const [low, high] = [number(from), number(to)];
  return more.length === 0 && low >= min && high <= max && low <= high;
};

// One list item of a cron field: a range with an optional `/step`, which crontab(5) defines after `*` or a range only.
const cronItem = (item: string, bounds: readonly [number, number]): boolean => {
  const [range = "", step, ...extra] = item.split("/");
  const stepOk = step === undefined || (/^[1-9]\d?$/.test(step) && (range === "*" || range.includes("-")));
  return extra.length === 0 && stepOk && cronRange(range, bounds);
};

/** Whether a text is a five-field cron schedule in numbers (no month or weekday names, no seconds). */
export const isCron = (text: string): boolean => {
  const fields = text.trim().split(/\s+/);
  return (
    fields.length === CRON_FIELDS.length &&
    fields.every((field, index) => {
      const bounds = CRON_FIELDS[index];
      return bounds !== undefined && field.split(",").every((item) => cronItem(item, bounds));
    })
  );
};

// An IANA name, not a UTC offset, in its exact case: a name Intl only matches case-insensitively is refused.
const isTimeZone = (name: string): boolean => {
  if (!/^[A-Za-z][A-Za-z_]*(?:\/[A-Za-z0-9_+-]+)*$/.test(name)) return false;
  try {
    const resolved = new Intl.DateTimeFormat("en", { timeZone: name }).resolvedOptions().timeZone;
    return resolved === name || resolved.toLowerCase() !== name.toLowerCase();
  } catch {
    return false;
  }
};

/**
 * A command line for POSIX `sh` on every platform: Git for Windows' `sh.exe` on native Windows, where the node is
 * refused when there is none (pending owner decision). `cmd.exe` would expand `%NAME%` before parsing the line.
 */
const Command = z.string().min(1).max(10_000);

// Resolved against the project folder, the path never steps above it.
const inside = (path: string): boolean => {
  let depth = 0;
  for (const part of path.split("/")) {
    if (part === "..") depth -= 1;
    else if (part !== "" && part !== ".") depth += 1;
    if (depth < 0) return false;
  }
  return true;
};

/**
 * A path inside the project: relative, `/` between its parts, no `..` part (also behind a line break), no control
 * character; normalized against the project folder it stays inside. The executor still resolves links (a folder that
 * links outside), which no pattern can see.
 */
const ProjectPath = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^(?![/\\])(?![A-Za-z]:)(?![\s\S]*(?:^|\/)\.\.(?:\/|$))[^\\\p{Cc}]+$/u, {
    message: "a relative path inside the project, with / between its parts, no .. part and no control character",
  })
  .refine(inside, "a path that stays inside the project");

const precheck = Command.describe(
  "A read-only command run before the workflow: exit code 0 starts the run, any other skips it",
);

const config = <T extends z.ZodType>(id: string, schema: T): T => {
  fileFormats.add(schema, { id });
  return schema;
};

/**
 * The configuration (`with`) of each node type of workflow schema version 1. A node without `with` is checked as `{}`.
 * Values never reach a command as text: a command gets the workflow's inputs as environment variables only, which `sh`
 * expands after it has parsed the line.
 */
export const NODE_CONFIGS = {
  "trigger.manual": config("TriggerManualConfig", z.strictObject({ precheck: precheck.optional() })),
  "trigger.schedule": config(
    "TriggerScheduleConfig",
    z.strictObject({
      cron: z
        .string()
        .refine(isCron, "a five-field cron schedule in numbers")
        .describe(
          "Five numeric fields, minute hour day month weekday (0 is Sunday): `*`, `n`, `n-m`, lists; `/step` after `*` or `n-m`",
        ),
      timezone: z
        .string()
        .refine(isTimeZone, "an IANA time zone")
        .optional()
        .describe(
          "An IANA time zone name in its exact case, such as Europe/Berlin, no UTC offset; the machine's when absent",
        ),
      precheck,
    }),
  ),
  "agent.run": config(
    "AgentRunConfig",
    z.strictObject({
      task: z.string().min(1).max(100_000),
      provider: z.enum(["claude-code"]).optional().describe("`claude-code` when absent"),
      phase: z
        .enum(["plan", "implement", "review"])
        .optional()
        .describe("Picks the pinned model and effort of the phase; `implement` when absent"),
    }),
  ),
  "command.run": config(
    "CommandRunConfig",
    z.strictObject({ command: Command, cwd: ProjectPath.optional().describe("The project folder when absent") }),
  ),
  "file.read": config("FileReadConfig", z.strictObject({ path: ProjectPath })),
  "file.write": config("FileWriteConfig", z.strictObject({ path: ProjectPath })),
  condition: config("ConditionConfig", z.strictObject({})),
  join: JoinConfig,
  "human.approval": config("HumanApprovalConfig", z.strictObject({ message: z.string().min(1).max(2000) })),
  "workflow.run": config("WorkflowRunConfig", z.strictObject({ workflow: ProjectPath })),
} satisfies Readonly<Record<string, z.ZodType>>;
