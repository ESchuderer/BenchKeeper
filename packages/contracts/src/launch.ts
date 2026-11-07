import { z } from "zod";
import { Agent, AgentVersion } from "./accounts.ts";
import { AutomationLevel } from "./automation.ts";
import { fileFormats } from "./registry.ts";

/** The result file format this CedarLoom reads; a worker's newer one is refused. */
export const WORKER_RESULT_SCHEMA_VERSION = 1;

/** A worker's verdict on its task; `not-run` is never a pass (A80). */
export const Verdict = z.enum(["pass", "findings", "not-run"]);

/**
 * The file a worker writes when it ends. The launcher accepts its verdict only with the run's own id, so a replaced
 * process's file is refused; a missing, empty or invalid file means the run failed, whatever the exit code.
 */
export const WorkerResult = z
  .strictObject({
    schemaVersion: z.literal(WORKER_RESULT_SCHEMA_VERSION),
    runId: z.uuid(),
    verdict: Verdict,
    summary: z.string().max(2000),
  })
  .register(fileFormats, { id: "WorkerResult" });
export type WorkerResult = z.infer<typeof WorkerResult>;

/**
 * The settings a run ran with, so runs can be compared by them (A90): the workflow phase, the models, the effort, the
 * agent's permission mode, whether a fresh reviewer runs, the automation level at the start, and the task's tier where
 * it is decided (quick, standard or full; null where not yet, as for a plan launch). The CLI version is the record's
 * own column.
 */
export const RunLabels = z.strictObject({
  phase: z.enum(["plan", "implement", "review"]),
  model: z.string().min(1),
  subagentModel: z.string().min(1),
  effort: z.enum(["low", "medium", "high", "xhigh"]),
  permissionMode: z.string().min(1).max(64),
  review: z.boolean(),
  level: AutomationLevel,
  tier: z.enum(["quick", "standard", "full"]).nullable(),
});
export type RunLabels = z.infer<typeof RunLabels>;

const Names = z.array(z.string().min(1));

/**
 * The plugins of a launch as its init line named them: the ones the launch passed (`expected`), the ones loaded, the
 * skills of the expected plugins, and each plugin's load error as `<plugin>: <message>`.
 */
export const LaunchPlugins = z.strictObject({ expected: Names, loaded: Names, skills: Names, errors: Names });
export type LaunchPlugins = z.infer<typeof LaunchPlugins>;

const Count = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

/**
 * A worker session's token and cost totals as its final result reports them, subagents included: the token counts
 * summed over the models it used (`modelUsage`), and `total_cost_usd`, Claude Code's own estimate, not billing data
 * (https://code.claude.com/docs/en/agent-sdk/cost-tracking).
 */
export const RunTotals = z.strictObject({
  inputTokens: Count,
  outputTokens: Count,
  cacheReadTokens: Count,
  cacheCreationTokens: Count,
  costUsd: z.number().min(0).max(1e9),
});
export type RunTotals = z.infer<typeof RunTotals>;

/**
 * One worker launch as the ledger keeps it; while it runs (finishedAt null) it holds a lease on its account. `failed`:
 * no valid result of this run; `interrupted`: its launcher ended before it did.
 */
export const LaunchRecord = z.strictObject({
  runId: z.uuid(),
  task: z.string(),
  agent: Agent,
  account: z.string().min(1),
  version: AgentVersion,
  pid: z.int().positive(),
  startedAt: z.iso.datetime({ precision: 3 }),
  finishedAt: z.iso.datetime({ precision: 3 }).nullable(),
  verdict: z.enum([...Verdict.options, "failed", "interrupted"]).nullable(),
  labels: RunLabels,
  // Null until the run's init line names its plugins.
  plugins: LaunchPlugins.nullable(),
  // What the session's final result reported; null while unknown.
  totals: RunTotals.nullable(),
});
export type LaunchRecord = z.infer<typeof LaunchRecord>;
