import { z } from "zod";
import { contracts } from "./registry.ts";

/**
 * One agent session as its own log records it, for the sessions board. `project`: the repository its folder belongs to
 * (the main worktree's folder), else the folder; `title` is the agent's own text, never markup. `busyMs` (Claude Code's
 * API and tool time, Codex's turn time) and `costUSD` are null when the log has none; `costEstimated`: priced from the
 * dated list-price table, which has no rate for the `unpriced` models. A session whose log is gone comes from the
 * history: its project, start, agent time, tokens, cost and test result only, so no title, its start as its end and no
 * `unpriced` models.
 */
export const AgentSession = z
  .strictObject({
    agent: z.enum(["claude-code", "codex"]),
    id: z.string(),
    project: z.string().nullable(),
    title: z.string().nullable(),
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    busyMs: z.number().min(0).nullable(),
    tokens: z.int().min(0),
    costUSD: z.number().min(0).nullable(),
    costEstimated: z.boolean(),
    unpriced: z.array(z.string()),
    tests: z.enum(["pass", "fail"]).nullable(),
  })
  .register(contracts, { id: "AgentSession" });
export type AgentSession = z.infer<typeof AgentSession>;

/**
 * The figures of a period's sessions: `costUSD` is null when no session has a cost and `uncosted` counts those without;
 * `daysWorked` of `days` have a session start, `streak` is their longest run; `testsPassed` is the share of the `tested`
 * sessions whose last test run passed.
 */
export const SessionFigures = z
  .strictObject({
    sessions: z.int().min(0),
    busyMs: z.number().min(0),
    costUSD: z.number().min(0).nullable(),
    uncosted: z.int().min(0),
    tokens: z.int().min(0),
    days: z.int().min(0),
    daysWorked: z.int().min(0),
    streak: z.int().min(0),
    tested: z.int().min(0),
    testsPassed: z.number().min(0).max(1).nullable(),
  })
  .register(contracts, { id: "SessionFigures" });
export type SessionFigures = z.infer<typeof SessionFigures>;

/**
 * The sessions board of a period (`days` up to today; null: all time) and a project (null: every one): `span` holds its
 * days in `zone`, oldest first; `first` is the first day of Claude Code data: the oldest Claude Code session the
 * history kept (else the oldest transcript), as Claude Code deletes old transcripts; `projects` are ranked by sessions
 * over all time; `sessions` are newest first; `prices` dates Codex's price table.
 */
export const SessionsBoard = z
  .strictObject({
    days: z.int().min(1).nullable(),
    project: z.string().nullable(),
    zone: z.string(),
    span: z.array(z.iso.date()),
    first: z.iso.date().nullable(),
    projects: z.array(z.string()),
    figures: SessionFigures,
    sessions: z.array(AgentSession),
    prices: z.strictObject({ date: z.iso.date(), source: z.url() }),
  })
  .register(contracts, { id: "SessionsBoard" });
export type SessionsBoard = z.infer<typeof SessionsBoard>;
