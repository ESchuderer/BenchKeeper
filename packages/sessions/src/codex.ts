import { basename } from "node:path";
import { z } from "zod";
import { eachLine, isoOf, jsonOf, Span } from "./jsonl.ts";
import { PRICES } from "./prices.ts";
import { type Counts, NONE, type Summary } from "./summary.ts";
import { outcomeOf, testRunIn } from "./test-run.ts";

// The rollout format of openai/codex at commit 8703d32b (codex-rs/protocol, history and rollout/src/policy.rs).
const count = z.number().min(0);
const Line = z.object({ type: z.string(), payload: z.record(z.string(), z.unknown()) });
const Meta = z.object({
  id: z.string(),
  parent_thread_id: z.string().nullish(),
  cwd: z.string().optional(),
  timestamp: z.string().optional(),
  model_provider: z.string().nullish(),
});
const Context = z.object({ model: z.string() });
const TokenCount = z.object({
  info: z.object({
    total_token_usage: z.object({
      input_tokens: count.optional(),
      cached_input_tokens: count.default(0),
      cache_write_input_tokens: count.default(0),
      output_tokens: count.default(0),
      total_tokens: count.optional(),
    }),
    last_token_usage: z.object({ input_tokens: count }).nullish(),
  }),
});
const Complete = z.object({ duration_ms: count.nullish() });
// Persisted only in paginated history mode: the default legacy mode records no command results.
const Command = z.object({
  item: z.object({
    type: z.literal("CommandExecution"),
    command: z.array(z.string()),
    exit_code: z.int().nullish(),
    aggregated_output: z.string().nullish(),
  }),
});

// Only lines of these kinds are parsed; a compacted line, which repeats earlier ones, fails the type check after.
const READ = /"(?:session_meta|turn_context|token_count|task_complete|CommandExecution)"/;

const less = (a: Counts, b: Counts): Counts => ({
  input: Math.max(0, a.input - b.input),
  cached: Math.max(0, a.cached - b.cached),
  written: Math.max(0, a.written - b.written),
  output: Math.max(0, a.output - b.output),
});
const plus = (a: Counts, b: Counts): Counts => ({
  input: a.input + b.input,
  cached: a.cached + b.cached,
  written: a.written + b.written,
  output: a.output + b.output,
});

// Older rollouts record the total only: no counts, and so no estimate.
const countsOf = (total: z.infer<typeof TokenCount>["info"]["total_token_usage"]): Counts | null =>
  total.input_tokens === undefined
    ? null
    : {
        input: total.input_tokens,
        cached: total.cached_input_tokens,
        written: total.cache_write_input_tokens,
        output: total.output_tokens,
      };

// By the exit code when it is the run's, else by the run's summary in the output.
const outcomeIn = ({ command, exit_code, aggregated_output }: z.infer<typeof Command>["item"]): Summary["tests"] => {
  const run = testRunIn(command);
  if (run === "output") return outcomeOf(aggregated_output ?? "");
  if (run === null || exit_code == null) return null;
  return exit_code === 0 ? "pass" : "fail";
};

const metaOf = (meta: z.infer<typeof Meta> | null, file: string) => ({
  id: meta?.id ?? basename(file, ".jsonl"),
  parent: meta?.parent_thread_id ?? null,
  provider: meta?.model_provider ?? null,
  folder: meta?.cwd ?? null,
});

class Rollout {
  meta: z.infer<typeof Meta> | null = null;
  model: string | null = null;
  busyMs: number | null = null;
  tokens = 0;
  tests: Summary["tests"] = null;
  readonly span = new Span();
  readonly usage: Summary["usage"] = {};
  // The totals are cumulative and a token_count can repeat: the model in use gets the growth since the last one.
  last: Counts = NONE;
  readonly items: Partial<Record<string, (payload: Record<string, unknown>) => void>> = {
    session_meta: (payload) => {
      this.meta ??= Meta.safeParse(payload).data ?? null;
    },
    turn_context: (payload) => {
      this.model = Context.safeParse(payload).data?.model ?? this.model;
    },
    event_msg: (payload) => this.events[String(payload["type"])]?.(payload),
  };
  readonly events: Partial<Record<string, (payload: Record<string, unknown>) => void>> = {
    token_count: (payload) => this.count(payload),
    task_complete: (payload) => {
      const ms = Complete.safeParse(payload).data?.duration_ms;
      if (ms != null) this.busyMs = (this.busyMs ?? 0) + ms;
    },
    item_completed: (payload) => this.command(payload),
  };

  read(line: string): void {
    this.span.at(line);
    if (!READ.test(line)) return;
    const item = Line.safeParse(jsonOf(line)).data;
    if (item !== undefined) this.items[item.type]?.(item.payload);
  }

  count(payload: unknown): void {
    const info = TokenCount.safeParse(payload).data?.info;
    if (info === undefined) return;
    this.tokens = info.total_token_usage.total_tokens ?? this.tokens;
    const now = countsOf(info.total_token_usage);
    if (now === null) return;
    const growth = less(now, this.last);
    this.last = now;
    // The long-context rate goes by the last request's input, not by the growth, which can span several requests.
    this.add(growth, (info.last_token_usage?.input_tokens ?? 0) > PRICES.longAbove);
  }

  add(growth: Counts, long: boolean): void {
    if (this.model === null) return;
    const used = (this.usage[this.model] ??= { short: NONE, long: NONE });
    if (long) used.long = plus(used.long, growth);
    else used.short = plus(used.short, growth);
  }

  // No exit code or summary recorded: the result is unknown, and the last known one stays.
  command(payload: unknown): void {
    const item = Command.safeParse(payload).data?.item;
    if (item !== undefined) this.tests = outcomeIn(item) ?? this.tests;
  }

  summary(file: string): Summary {
    return {
      agent: "codex",
      ...metaOf(this.meta, file),
      project: null,
      title: null,
      start: isoOf(this.meta?.timestamp ?? this.span.first),
      end: isoOf(this.span.last),
      busyMs: this.busyMs,
      tokens: this.tokens,
      costUSD: null,
      tests: this.tests,
      usage: this.usage,
    };
  }
}

/** One Codex rollout (`sessions/YYYY/MM/DD/rollout-*.jsonl` in its home). */
export const readCodex = async (file: string): Promise<Summary> => {
  const rollout = new Rollout();
  await eachLine(file, (line) => rollout.read(line));
  return rollout.summary(file);
};
