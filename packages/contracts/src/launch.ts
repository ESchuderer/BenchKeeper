import { z } from "zod";
import { Agent, AgentVersion } from "./accounts.ts";
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
});
export type LaunchRecord = z.infer<typeof LaunchRecord>;
