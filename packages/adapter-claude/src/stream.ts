import type { AgentEvent, UsageWindow } from "@cedarloom/agent-contracts";
import type { Json } from "@cedarloom/contracts";
import { z } from "zod";

// Only the fields CedarLoom reads; the CLI adds fields with most releases, and the whole line stays in `raw`.
const Init = z.looseObject({
  type: z.literal("system"),
  subtype: z.literal("init"),
  session_id: z.string(),
  claude_code_version: z.string(),
  model: z.string(),
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

type RateLimitInfo = z.infer<typeof RateLimit>["rate_limit_info"];

const windows = (info: RateLimitInfo): UsageWindow[] =>
  Object.entries(info.unifiedWindows ?? { [info.rateLimitType]: info }).map(([window, reading]) => ({
    window,
    status: reading.status,
    percent: reading.utilization === undefined ? null : Math.round(reading.utilization * 10_000) / 100,
    resetsAt: reading.resetsAt === undefined ? null : new Date(reading.resetsAt * 1000).toISOString(),
  }));

const parseJson = (line: string): Json => {
  try {
    return JSON.parse(line);
  } catch {
    return line;
  }
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
      version = init.data.claude_code_version;
      return { type: "init", sessionId: init.data.session_id, agentVersion: version, model: init.data.model, raw };
    }
    const limit = RateLimit.safeParse(raw);
    if (limit.success && version !== undefined && verified(version)) {
      return { type: "usage", agentVersion: version, windows: windows(limit.data.rate_limit_info), raw };
    }
    const result = Result.safeParse(raw);
    if (result.success) {
      const ok = !result.data.is_error && result.data.subtype === "success";
      return { type: "result", ok, text: result.data.result ?? null, raw };
    }
    return { type: "other", raw };
  };
};
