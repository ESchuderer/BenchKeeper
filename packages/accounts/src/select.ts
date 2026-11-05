import type { Account, AccountRegistry, Agent } from "@cedarloom/contracts";

/** The usage windows of the agent-neutral quota model. */
export type Window = "fiveHour" | "sevenDay";

const WINDOWS: readonly Window[] = ["fiveHour", "sevenDay"];

/** One usage window of an account as last read: the used share in percent and when the window resets. */
export interface Reading {
  readonly account: string;
  readonly window: Window;
  readonly usedPercent: number;
  readonly resetsAt: string;
}

/** A pool account as the choice saw it: its smallest margin above its minimums, null when a window is unknown. */
export interface Candidate {
  readonly account: string;
  readonly margin: number | null;
}

export type Selection =
  | { readonly ok: true; readonly account: Account; readonly candidates: readonly Candidate[] }
  | {
      readonly ok: false;
      readonly reason: "unknown-pool" | "unconfirmed-pool" | "no-headroom";
      readonly candidates: readonly Candidate[];
    };

// A reading is unknown once its window resets, or when its reset time does not parse: it never makes an account qualify.
const margin = (registry: AccountRegistry, account: Account, readings: readonly Reading[], now: number) => {
  let smallest = Number.POSITIVE_INFINITY;
  for (const window of WINDOWS) {
    const reading = readings.find((each) => each.account === account.name && each.window === window);
    if (reading === undefined || !(Date.parse(reading.resetsAt) > now)) return null;
    const minimum = account.minimum?.[window] ?? registry.minimum[window];
    smallest = Math.min(smallest, 100 - reading.usedPercent - minimum);
  }
  return smallest;
};

// The candidate with the largest margin of at least 0, the first one on a tie.
const most = <T extends { readonly margin: number | null }>(scored: readonly T[]): T | undefined => {
  let best: T | undefined;
  for (const each of scored) {
    if (each.margin !== null && each.margin >= 0 && each.margin > (best?.margin ?? -1)) best = each;
  }
  return best;
};

/**
 * Chooses the account a new worker starts on: the pool account with the most headroom above both of its minimums, the
 * first one listed on a tie. `readings` holds the latest reading per account and window; `now` is in milliseconds.
 */
export const selectAccount = (
  registry: AccountRegistry,
  { agent, pool }: { readonly agent: Agent; readonly pool: string },
  readings: readonly Reading[],
  now: number,
): Selection => {
  const pools = registry.pools[agent] ?? {};
  // Own keys only, so a pool named like an inherited property (constructor, tostring) is no pool.
  const settings = Object.hasOwn(pools, pool) ? pools[pool] : undefined;
  if (settings === undefined) return { ok: false, reason: "unknown-pool", candidates: [] };
  // Switching needs the user's confirmation that one person holds and pays for every account of the pool (A5).
  if (settings.confirmedAt === null) return { ok: false, reason: "unconfirmed-pool", candidates: [] };
  const members = registry.accounts.filter((account) => account.agent === agent && account.pool === pool);
  const scored = members.map((account) => ({ account, margin: margin(registry, account, readings, now) }));
  const candidates = scored.map(({ account, margin: value }) => ({ account: account.name, margin: value }));
  const best = most(scored);
  return best === undefined
    ? { ok: false, reason: "no-headroom", candidates }
    : { ok: true, account: best.account, candidates };
};
