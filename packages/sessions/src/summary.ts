import { AgentSession } from "@cedarloom/contracts";
import { z } from "zod";

// What the cache keeps of a log: the row as the contract has it, with the folder, and the times as read.
export const Summary = AgentSession.omit({ agent: true }).extend({
  folder: z.string().nullable(),
  start: z.string().nullable(),
  end: z.string().nullable(),
});
export type Summary = z.infer<typeof Summary>;
