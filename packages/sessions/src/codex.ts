import { basename } from "node:path";
import { z } from "zod";
import { eachLine, isoOf, jsonOf, Span } from "./jsonl.ts";
import { PRICES } from "./prices.ts";
import { type Counts, NONE, type Summary } from "./summary.ts";
import { outcomeOf, testRunIn } from "./test-run.ts";

// The rollout format of openai/codex at commit 8703d32b (codex-rs/protocol, history and rollout/src/policy.rs).
const count = z.number().min(0);
const Line = z.object({ type: z.string(), payload: z.record(z.string(), z.unknown()) });
// A spawned subagent names its parent in `source` (SessionSource::SubAgent), also at the top level.
const Meta = z
  .object({
    id: z.string(),
    parent_thread_id: z.string().nullish(),
    source: z
      .object({ subagent: z.object({ thread_spawn: z.object({ parent_thread_id: z.string() }) }) })
      .optional()
      .catch(undefined),
    forked_from_id: z.string().nullish(),
    cwd: z.string().optional(),
    timestamp: z.string().optional(),
    model_provider: z.string().nullish(),
  })
  .transform(({ parent_thread_id, source, forked_from_id, ...meta }) => ({
    ...meta,
    parent: parent_thread_id ?? source?.subagent.thread_spawn.parent_thread_id ?? null,
    forked: forked_from_id != null,
  }));
const Context = z.object({ model: z.string() });
const Usage = z.object({
  input_tokens: count.optional(),
  cached_input_tokens: count.default(0),
  cache_write_input_tokens: count.default(0),
  output_tokens: count.default(0),
  total_tokens: count.optional(),
});
const TokenCount = z.object({ info: z.object({ total_token_usage: Usage, last_token_usage: Usage.nullish() }) });
// A copied settings line keeps its original thread's id (ThreadSettingsAppliedEvent).
const Settings = z.object({ thread_id: z.string().nullish() });
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
const READ = /"(?:session_meta|turn_context|token_count|task_complete|CommandExecution|thread_settings_applied)"/;

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
const countsOf = (total: z.infer<typeof Usage>): Counts | null =>
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
  // A run the user declined, or one that did not start, is recorded with -1: it never ran.
  if (run === null || exit_code == null || exit_code < 0) return null;
  return exit_code === 0 ? "pass" : "fail";
};

// Without a readable session_meta line, the thread id from the name `rollout-<time>-<id>[_<copy>].jsonl`.
const idOf = (file: string): string =>
  /-([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})(?:_|$)/.exec(basename(file, ".jsonl"))?.[1] ??
  basename(file, ".jsonl");

const metaOf = (meta: z.infer<typeof Meta> | null, file: string) => ({
  id: meta?.id ?? idOf(file),
  parent: meta?.parent ?? null,
  provider: meta?.model_provider ?? null,
  folder: meta?.cwd ?? null,
});

// A fork's rollout starts with its parent's history, copied up to the fork's own settings line, and its token totals go
// on from its parent's (codex-rs/core/src/session/mod.rs, InitialHistory::Forked).
class Rollout {
  meta: z.infer<typeof Meta> | null = null;
  seen = false;
  copying = false;
  // A fork's totals before its first own request: what it took over.
  base: number | null = null;
  model: string | null = null;
  busyMs: number | null = null;
  tokens = 0;
  tests: Summary["tests"] = null;
  readonly span = new Span();
  readonly usage: Summary["usage"] = {};
  // The totals are cumulative and a token_count can repeat: the model in use gets the growth since the last one.
  last: Counts = NONE;
  readonly items: Partial<Record<string, (payload: Record<string, unknown>) => void>> = {
    // The first is the rollout's own; a fork copies its parent's after it.
    session_meta: (payload) => {
      if (this.seen) return;
      this.seen = true;
      this.meta = Meta.safeParse(payload).data ?? null;
      this.copying = this.meta?.forked === true;
    },
    turn_context: (payload) => {
      this.model = Context.safeParse(payload).data?.model ?? this.model;
    },
    event_msg: (payload) => {
      const type = String(payload["type"]);
      if (!this.copying || type === "thread_settings_applied") this.events[type]?.(payload);
    },
  };
  readonly events: Partial<Record<string, (payload: Record<string, unknown>) => void>> = {
    token_count: (payload) => this.count(payload),
    task_complete: (payload) => {
      const ms = Complete.safeParse(payload).data?.duration_ms;
      if (ms != null) this.busyMs = (this.busyMs ?? 0) + ms;
    },
    item_completed: (payload) => this.command(payload),
    thread_settings_applied: (payload) => {
      const id = Settings.safeParse(payload).data?.thread_id;
      if (id != null && id === this.meta?.id) this.copying = false;
    },
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
    if (this.meta?.forked === true && this.base === null) this.takeOver(info);
    this.tokens = info.total_token_usage.total_tokens ?? this.tokens;
    const now = countsOf(info.total_token_usage);
    if (now === null) return;
    const growth = less(now, this.last);
    this.last = now;
    // The long-context rate goes by the last request's input, not by the growth, which can span several requests.
    this.add(growth, (info.last_token_usage?.input_tokens ?? 0) > PRICES.longAbove);
  }

  // The totals before the fork's first own request, its total less that request's usage.
  takeOver({ total_token_usage: total, last_token_usage: last }: z.infer<typeof TokenCount>["info"]): void {
    this.last = less(countsOf(total) ?? NONE, (last && countsOf(last)) ?? NONE);
    this.base = (total.total_tokens ?? 0) - (last?.total_tokens ?? 0);
  }

  // Tokens before any turn names its model are kept, so the estimate lists them as unpriced.
  add(growth: Counts, long: boolean): void {
    const used = (this.usage[this.model ?? "unknown model"] ??= { short: NONE, long: NONE });
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
      tokens: Math.max(0, this.tokens - (this.base ?? 0)),
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
