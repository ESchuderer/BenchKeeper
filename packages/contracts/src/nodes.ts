import { z } from "zod";
import { isPlainText } from "./escape.ts";
import { fileFormats } from "./registry.ts";
import { LinedText } from "./text.ts";
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

// An IANA name in its exact case (legacy ones such as EST5EDT too), not an offset; a case-insensitive match is refused.
const isTimeZone = (name: string): boolean => {
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(name)) return false;
  try {
    const resolved = new Intl.DateTimeFormat("en", { timeZone: name }).resolvedOptions().timeZone;
    return resolved === name || resolved.toLowerCase() !== name.toLowerCase();
  } catch {
    return false;
  }
};

// A line for POSIX sh on every platform (Git for Windows' sh.exe, refused without one); cmd.exe would expand %NAME%.
const Command = LinedText.min(1).max(10_000);

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

// A relative project path, `/` between parts, no `..`, control character or bidirectional control.
export const ProjectPath = z
  .string()
  .min(1)
  .max(1024)
  // The pattern means the same with or without the u flag, which JSON Schema leaves to the validator.
  .regex(/^(?![/\\])(?![A-Za-z]:)(?![\s\S]*(?:^|\/)\.\.(?:\/|$))[^\\]+$/, {
    message: "a relative path inside the project, with / between its parts and no .. part",
  })
  .refine(isPlainText, "no control character and no bidirectional control")
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
          "An IANA time zone name in its exact case, such as Europe/Berlin or EST5EDT, no UTC offset; the machine's when absent",
        ),
      precheck,
    }),
  ),
  "agent.run": config(
    "AgentRunConfig",
    z
      .strictObject({
        task: LinedText.min(1).max(100_000),
        skill: z
          .string()
          .max(64)
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .optional()
          .describe(
            "The name of the step's skill folder (https://agentskills.io/specification); from the node id when absent",
          ),
        model: z
          .string()
          .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/[\]-]{0,199}$/)
          .optional()
          .describe("A model alias (opus, sonnet, haiku, inherit) or a model id; the session's model when absent"),
        effort: z
          .enum(["low", "medium", "high", "xhigh", "max"])
          .optional()
          .describe("The reasoning effort; the session's when absent"),
        tools: z
          .array(z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,127}$/))
          .max(50)
          .optional()
          .describe("The Claude Code tools the step's agent may use; the session's when absent"),
        fresh: z
          .boolean()
          .optional()
          .describe(
            "Runs the step as a reviewer: a fresh context that wrote none of the work, and only Read, Grep and Glob",
          ),
      })
      .refine((step) => step.fresh !== true || step.tools === undefined, {
        message: "a fresh reviewer takes no tools",
        path: ["tools"],
      }),
  ),
  "command.run": config(
    "CommandRunConfig",
    z.strictObject({
      command: Command,
      cwd: ProjectPath.optional().describe("The project folder when absent"),
      role: z
        .enum(["step", "check"])
        .optional()
        .describe("check: the agent step before it cannot end while the command fails; step when absent"),
    }),
  ),
  condition: config("ConditionConfig", z.strictObject({})),
  join: JoinConfig,
  "human.approval": config(
    "HumanApprovalConfig",
    z.strictObject({
      message: LinedText.min(1).max(2000),
      gate: z
        .enum(["implementation", "verdict", "merge"])
        .optional()
        .describe(
          "The level's gate this is: it stops where the level keeps it (Supervised all three, Checkpoint merge, Auto none), and at every level when absent",
        ),
    }),
  ),
  "workflow.run": config("WorkflowRunConfig", z.strictObject({ workflow: ProjectPath })),
} satisfies Readonly<Record<string, z.ZodType>>;
