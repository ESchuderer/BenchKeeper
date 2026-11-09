import { z } from "zod";
import { contracts } from "./registry.ts";

/**
 * One agent session as its own log records it, for the sessions board. `project`: the repository its folder belongs to
 * (the main worktree's folder), else the folder; `title` is the agent's own text, never markup. `busyMs` (API and tool
 * time) and `costUSD` are null when the log has none.
 */
export const AgentSession = z
  .strictObject({
    agent: z.enum(["claude-code"]),
    id: z.string(),
    project: z.string().nullable(),
    title: z.string().nullable(),
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    busyMs: z.number().min(0).nullable(),
    tokens: z.int().min(0),
    costUSD: z.number().min(0).nullable(),
    tests: z.enum(["pass", "fail"]).nullable(),
  })
  .register(contracts, { id: "AgentSession" });
export type AgentSession = z.infer<typeof AgentSession>;
