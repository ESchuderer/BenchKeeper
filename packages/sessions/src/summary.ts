import { AgentSession } from "@cedarloom/contracts";
import { z } from "zod";

const count = z.number().min(0);

/** Tokens of one model: input (with the cached and the written ones), read from the cache, written to it, output. */
export const Counts = z.strictObject({ input: count, cached: count, written: count, output: count });
export type Counts = z.infer<typeof Counts>;

export const NONE: Counts = { input: 0, cached: 0, written: 0, output: 0 };

// What the cache keeps of a log: the row as the contract has it, with the folder, the times as read, and a Codex thread's
// parent, provider and usage, priced when the rows are built, so a new price table applies to it.
export const Summary = AgentSession.omit({ costEstimated: true, unpriced: true }).extend({
  parent: z.string().nullable(),
  provider: z.string().nullable(),
  folder: z.string().nullable(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  usage: z.record(z.string(), z.strictObject({ short: Counts, long: Counts })),
});
export type Summary = z.infer<typeof Summary>;
