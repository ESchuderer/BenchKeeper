import type { AgentEvent, UsageWindow } from "@cedarloom/agent-contracts";
import { AgentVersion, type Json, type RunTotals } from "@cedarloom/contracts";
import { z } from "zod";
import { SETTINGS_SENTINEL } from "./overlay.ts";

// A core tool every session lists: a list without it, empty for one, proves nothing.
const CORE_TOOL = "Read";

// Only the fields CedarLoom reads; the CLI adds fields with most releases, and the whole line stays in `raw`.
const Init = z.looseObject({
  type: z.literal("system"),
  subtype: z.literal("init"),
  session_id: z.string(),
  // Read with AgentVersion in initEvent.
  claude_code_version: z.unknown(),
  model: z.string(),
  tools: z.array(z.string()).optional(),
  // The Agent SDK's SDKSystemMessage (https://code.claude.com/docs/en/agent-sdk/typescript). A field of another form is
  // left out, so it never costs the line its settings proof.
  plugins: z
    .array(z.looseObject({ name: z.string() }))
    .optional()
    .catch(undefined),
  skills: z.array(z.string()).optional().catch(undefined),
  plugin_errors: z
    .array(z.looseObject({ plugin: z.string(), message: z.string() }))
    .optional()
    .catch(undefined),
});

// The usage share arrives as a fraction and the reset in Unix seconds; a share above 1 or a reset past the year 2286
// means the format changed, and the line is not read.
const Window = z.looseObject({
  status: z.string(),
  utilization: z.number().min(0).max(1).optional(),
  resetsAt: z.int().min(0).max(1e10).optional(),
});

// Undocumented for `claude -p`, so read only on versions whose contract check passed. Observed: 2.1.316 reports every
// window in `unifiedWindows`, 2.1.309 the limiting window at the top.
const RateLimit = z.looseObject({
  type: z.literal("rate_limit_event"),
  rate_limit_info: Window.extend({
    rateLimitType: z.string(),
    unifiedWindows: z.record(z.string(), Window).optional(),
  }),
});

const Result = z.looseObject({
  type: z.literal("result"),
  subtype: z.string(),
  is_error: z.boolean(),
  result: z.string().optional(),
});

const Tokens = z.int().min(0).max(Number.MAX_SAFE_INTEGER);
// What a result reports of the session's spend: the cost and each model's tokens, read apart from the result itself, so
// a field of another shape costs only the totals, never the verdict.
const Spend = z.looseObject({
  total_cost_usd: z.number().min(0).max(1e9),
  modelUsage: z.record(
    z.string(),
    z.looseObject({
      inputTokens: Tokens,
      outputTokens: Tokens,
      cacheReadInputTokens: Tokens,
      cacheCreationInputTokens: Tokens,
    }),
  ),
});

// The session's totals over every model it used, subagents included, which `usage` leaves out
// (https://code.claude.com/docs/en/agent-sdk/cost-tracking); none when the result reports none, or only zeros, as the
// result of a crashed session may.
const totalsOf = (raw: Json): RunTotals | null => {
  const spend = Spend.safeParse(raw);
  if (!spend.success) return null;
  const models = Object.values(spend.data.modelUsage);
  const sum = (key: "inputTokens" | "outputTokens" | "cacheReadInputTokens" | "cacheCreationInputTokens"): number =>
    models.reduce((total, model) => total + model[key], 0);
  const totals = {
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    cacheReadTokens: sum("cacheReadInputTokens"),
    cacheCreationTokens: sum("cacheCreationInputTokens"),
    costUsd: spend.data.total_cost_usd,
  };
  return Object.values(totals).every((value) => value === 0) ? null : totals;
};

type RateLimitInfo = z.infer<typeof RateLimit>["rate_limit_info"];

// Claude Code's window names in the agent-neutral quota model; a window not listed is reported but not stored.
const QUOTA: Readonly<Record<string, UsageWindow["quota"]>> = { five_hour: "fiveHour", seven_day: "sevenDay" };

const windows = (info: RateLimitInfo): UsageWindow[] =>
  Object.entries(info.unifiedWindows ?? { [info.rateLimitType]: info }).map(([window, reading]) => ({
    window,
    status: reading.status,
    percent: reading.utilization === undefined ? null : Math.round(reading.utilization * 10_000) / 100,
    resetsAt: reading.resetsAt === undefined ? null : new Date(reading.resetsAt * 1000).toISOString(),
    quota: QUOTA[window] ?? null,
  }));

const parseJson = (line: string): Json => {
  try {
    return JSON.parse(line);
  } catch {
    return line;
  }
};

/**
 * Splits stdout into lines, and ends with `null` in place of a line longer than `max` bytes: a string past the engine's
 * limit (https://nodejs.org/api/buffer.html#bufferconstantsmax_string_length) throws where no caller can catch it. The
 * size is checked per chunk, so a line passes `max` by one chunk at most.
 */
export async function* lines(input: AsyncIterable<Buffer>, max: number): AsyncGenerator<string | null> {
  let parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of input) {
    let start = 0;
    for (let end = chunk.indexOf("\n"); end !== -1; end = chunk.indexOf("\n", start)) {
      parts.push(chunk.subarray(start, end));
      yield Buffer.concat(parts).toString("utf8");
      parts = [];
      size = 0;
      start = end + 1;
    }
    parts.push(chunk.subarray(start));
    size += chunk.length - start;
    if (size > max) {
      yield null;
      return;
    }
  }
  if (size > 0) yield Buffer.concat(parts).toString("utf8");
}

// The init event; a version of another form leaves the session ID to resume by, but no version.
const initEvent = (data: z.infer<typeof Init>, raw: Json): Extract<AgentEvent, { type: "init" }> => {
  const known = AgentVersion.safeParse(data.claude_code_version);
  const agentVersion = known.success ? known.data : null;
  const tools = data.tools ?? null;
  // The settings deny the sentinel by its bare name, which removes it from the tools: its absence proves they applied.
  const settingsApplied = tools !== null && tools.includes(CORE_TOOL) && !tools.includes(SETTINGS_SENTINEL);
  const plugins =
    data.plugins === undefined
      ? null
      : {
          loaded: data.plugins.map((plugin) => plugin.name),
          skills: data.skills ?? [],
          errors: (data.plugin_errors ?? []).map((error) => `${error.plugin}: ${error.message}`),
        };
  const { session_id: sessionId, model } = data;
  return { type: "init", sessionId, agentVersion, model, tools, settingsApplied, plugins, raw };
};

/**
 * Turns stream-json lines into events, one call per line. A rate-limit line becomes a usage event only after the init
 * line named a version that `verified` accepts; otherwise, like every line it does not know, it stays `other`.
 */
export const streamParser = (verified: (version: string) => boolean): ((line: string) => AgentEvent) => {
  let version: string | undefined;
  return (line) => {
    const raw = parseJson(line);
    const init = Init.safeParse(raw);
    if (init.success) {
      const event = initEvent(init.data, raw);
      version = event.agentVersion ?? undefined;
      return event;
    }
    const limit = RateLimit.safeParse(raw);
    if (limit.success && version !== undefined && verified(version)) {
      return { type: "usage", agentVersion: version, windows: windows(limit.data.rate_limit_info), raw };
    }
    const result = Result.safeParse(raw);
    if (result.success) {
      const ok = !result.data.is_error && result.data.subtype === "success";
      return { type: "result", ok, text: result.data.result ?? null, totals: totalsOf(raw), raw };
    }
    return { type: "other", raw };
  };
};
