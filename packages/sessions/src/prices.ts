import type { Counts, Summary } from "./summary.ts";

// US dollars per million tokens: input, cached input, 30-minute cache write (null: billed as input), output.
type Rate = readonly [number, number, number | null, number];

/** OpenAI's standard API list prices, for the estimated cost of Codex sessions; `long` is the rate above `longAbove` input tokens. */
export const PRICES: {
  readonly date: string;
  readonly source: string;
  readonly longAbove: number;
  readonly models: Readonly<Record<string, { readonly short: Rate; readonly long?: Rate }>>;
} = {
  date: "2026-10-31",
  source: "https://developers.openai.com/api/docs/pricing",
  longAbove: 272_000,
  models: {
    "gpt-6-astra": { short: [10, 1, 12.5, 50], long: [20, 2, 25, 75] },
    "gpt-6.1-sol": { short: [2, 0.1, 2.5, 10], long: [4, 0.2, 5, 15] },
    "gpt-6.1-terra": { short: [1, 0.05, 1.25, 5], long: [2, 0.1, 2.5, 7.5] },
    "gpt-6-luna": { short: [0.1, 0.01, 0.125, 0.5], long: [0.2, 0.02, 0.25, 0.75] },
    "gpt-6-sol": { short: [2, 0.2, 2.5, 10], long: [4, 0.4, 5, 15] },
    "gpt-5.6-sol": { short: [4, 0.4, 5, 20], long: [8, 0.8, 10, 30] },
    "gpt-5.6-terra": { short: [2, 0.2, 2.5, 12], long: [4, 0.4, 5, 18] },
    "gpt-5.6-luna": { short: [0.2, 0.02, 0.25, 1.2], long: [0.4, 0.04, 0.5, 1.8] },
    "gpt-5.5": { short: [5, 0.5, null, 30], long: [10, 1, null, 45] },
    "gpt-5.4": { short: [2.5, 0.25, null, 15], long: [5, 0.5, null, 22.5] },
    "gpt-5.4-mini": { short: [0.75, 0.075, null, 4.5] },
    "gpt-5.3-codex": { short: [1.75, 0.175, null, 14] },
    "gpt-5.2": { short: [1.75, 0.175, null, 14] },
    "gpt-5.1": { short: [1.25, 0.125, null, 10] },
    "gpt-5": { short: [1.25, 0.125, null, 10] },
    "gpt-5-mini": { short: [0.25, 0.025, null, 2] },
  },
};

// Input includes the cached and the written tokens (Codex's test parses_cache_write_token_usage).
const usd = ({ input, cached, written, output }: Counts, [rate, cachedRate, writeRate, outputRate]: Rate): number =>
  ((input - cached - written) * rate + cached * cachedRate + written * (writeRate ?? rate) + output * outputRate) / 1e6;

/** The list-price cost of a Codex session's usage (null with nothing priced) and the models it leaves out. */
export const estimate = ({ provider, usage }: Summary): { costUSD: number | null; unpriced: string[] } => {
  let costUSD: number | null = null;
  const unpriced: string[] = [];
  for (const [model, { short, long }] of Object.entries(usage)) {
    // Another provider's model is not priced at OpenAI's rates.
    const rate = provider === null || provider === "openai" ? PRICES.models[model] : undefined;
    if (rate === undefined) unpriced.push(model);
    else costUSD = (costUSD ?? 0) + usd(short, rate.short) + usd(long, rate.long ?? rate.short);
  }
  return { costUSD, unpriced };
};
