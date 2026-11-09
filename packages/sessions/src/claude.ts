import { basename } from "node:path";
import { z } from "zod";
import { eachLine, isoOf, jsonOf, Span } from "./jsonl.ts";
import type { Summary } from "./summary.ts";
import { outcomeOf, type TestRun, testRunOf } from "./test-run.ts";

// The transcript format is Claude Code's own and undocumented: each schema reads only the fields used here.
const count = z.number().min(0).optional();
const Content = z.array(z.unknown()).catch([]);
const Head = z.object({
  type: z.string(),
  cwd: z.string().optional(),
  aiTitle: z.string().optional(),
  agentName: z.string().optional(),
});
const Assistant = z.object({
  message: z.object({
    id: z.string().optional(),
    usage: z
      .object({
        input_tokens: count,
        cache_creation_input_tokens: count,
        cache_read_input_tokens: count,
        output_tokens: count,
      })
      .optional(),
    content: Content,
  }),
});
const Bash = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.literal("Bash"),
  input: z.object({ command: z.string(), run_in_background: z.boolean().optional() }),
});
const User = z.object({ message: z.object({ content: Content }) });
const Result = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  is_error: z.boolean().optional(),
  content: z
    .union([z.string(), z.array(z.object({ text: z.string().optional() }))])
    .transform((value) => (typeof value === "string" ? value : value.map((part) => part.text ?? "").join("\n")))
    .catch(""),
});
// The session's running totals, rewritten as the session goes on; Claude Code's own cost, API and tool time.
const CostState = z.object({
  totalCostUSD: z.number().min(0),
  totalAPIDuration: count,
  totalToolDuration: count,
  modelUsage: z.record(
    z.string(),
    z.object({ inputTokens: count, outputTokens: count, cacheReadInputTokens: count, cacheCreationInputTokens: count }),
  ),
});

// Only lines of these kinds are parsed; their type is checked after, as tool output can quote such text.
const READ = /"type":"(?:assistant|user|cost-state|ai-title|agent-name)"/;

const sum = (values: Iterable<number | undefined>): number => {
  let total = 0;
  for (const value of values) total += value ?? 0;
  return total;
};

// By the exit code: a result without an error passed, an error with an exit code failed; else by the summary.
const outcome = (run: TestRun, { is_error, content }: z.infer<typeof Result>): Summary["tests"] => {
  if (run === "output") return outcomeOf(content);
  if (is_error !== true) return "pass";
  return /Exit code [1-9]/.test(content) ? "fail" : null;
};

class Transcript {
  folder: string | null = null;
  title: string | null = null;
  cost: z.infer<typeof CostState> | null = null;
  tests: Summary["tests"] = null;
  readonly span = new Span();
  // Tokens per message id: a message streams as several lines that repeat its usage.
  readonly usage = new Map<string, number>();
  // Test runs whose result has not come yet.
  readonly pending = new Map<string, TestRun>();
  readonly kinds: Partial<Record<string, (json: unknown, head: z.infer<typeof Head>) => void>> = {
    assistant: (json) => this.assistant(json),
    user: (json) => this.user(json),
    "cost-state": (json) => {
      this.cost = CostState.safeParse(json).data ?? this.cost;
    },
    "ai-title": (_, head) => {
      this.title = head.aiTitle ?? this.title;
    },
    "agent-name": (_, head) => {
      this.title ??= head.agentName ?? null;
    },
  };

  read(line: string): void {
    this.span.at(line);
    if (!READ.test(line)) return;
    const json = jsonOf(line);
    const head = Head.safeParse(json).data;
    if (head === undefined) return;
    this.folder ??= head.cwd ?? null;
    this.kinds[head.type]?.(json, head);
  }

  assistant(json: unknown): void {
    const message = Assistant.safeParse(json).data?.message;
    if (message === undefined) return;
    const { id, usage } = message;
    if (id !== undefined && usage !== undefined) {
      const { input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens } = usage;
      this.usage.set(id, sum([input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens]));
    }
    for (const part of message.content) {
      const bash = Bash.safeParse(part).data;
      // A run sent to the background answers at once, before its tests end.
      const run = bash === undefined || bash.input.run_in_background === true ? null : testRunOf(bash.input.command);
      if (bash !== undefined && run !== null) this.pending.set(bash.id, run);
    }
  }

  // The last test run with a known result decides.
  user(json: unknown): void {
    for (const part of User.safeParse(json).data?.message.content ?? []) {
      const result = Result.safeParse(part).data;
      const run = result === undefined ? undefined : this.pending.get(result.tool_use_id);
      if (result === undefined || run == null) continue;
      this.pending.delete(result.tool_use_id);
      this.tests = outcome(run, result) ?? this.tests;
    }
  }

  summary(file: string): Summary {
    const { cost } = this;
    const models = Object.values(cost?.modelUsage ?? {});
    // Without a cost-state line yet (a session still running), the tokens are the messages' own.
    const tokens =
      models.length > 0
        ? sum(
            models.flatMap((m) => [m.inputTokens, m.outputTokens, m.cacheReadInputTokens, m.cacheCreationInputTokens]),
          )
        : sum(this.usage.values());
    return {
      id: basename(file, ".jsonl"),
      folder: this.folder,
      project: null,
      title: this.title,
      start: isoOf(this.span.first),
      end: isoOf(this.span.last),
      busyMs: cost === null ? null : sum([cost.totalAPIDuration, cost.totalToolDuration]),
      tokens,
      costUSD: cost?.totalCostUSD ?? null,
      tests: this.tests,
    };
  }
}

/** One Claude Code transcript (`projects/<folder>/<session>.jsonl` in its home). */
export const readClaude = async (file: string): Promise<Summary> => {
  const transcript = new Transcript();
  await eachLine(file, (line) => transcript.read(line));
  return transcript.summary(file);
};
