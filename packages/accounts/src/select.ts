import { type Account, type AccountRegistry, type Agent, QuotaWindow, type Reading } from "@cedarloom/contracts";

/** What the choice reads of a reading: the time it was read is not needed. */
type Current = Omit<Reading, "readAt">;

/** A pool account as the choice saw it: its smallest margin above its minimums, null when a window is unknown. */
export interface Candidate {
  readonly account: string;
  readonly margin: number | null;
}

export type Selection =
  | {
      readonly ok: true;
      readonly account: Account;
      /** `no-readings`: no pool account had both windows known, so the task stays on its account and nothing switches. */
      readonly reason: "most-headroom" | "no-readings";
      readonly candidates: readonly Candidate[];
    }
  | {
      readonly ok: false;
      readonly reason: "unknown-pool" | "unconfirmed-pool" | "no-headroom";
      readonly candidates: readonly Candidate[];
    };

// A reading is unknown once its window resets, or when its reset time does not parse: it never makes an account qualify.
// A known window below its minimum disqualifies the account even when the other window is unknown.
const margin = (registry: AccountRegistry, account: Account, readings: readonly Current[], now: number) => {
  let smallest = Number.POSITIVE_INFINITY;
  let unknown = false;
  for (const window of QuotaWindow.options) {
    const reading = readings.find((each) => each.account === account.name && each.window === window);
    if (reading === undefined || !(Date.parse(reading.resetsAt) > now)) unknown = true;
    else
      smallest = Math.min(
        smallest,
        100 - reading.usedPercent - (account.minimum?.[window] ?? registry.minimum[window]),
      );
  }
  return unknown && smallest >= 0 ? null : smallest;
};

// The candidate with the largest margin of at least 0, the first one on a tie.
const most = <T extends { readonly margin: number | null }>(scored: readonly T[]): T | undefined => {
  let best: T | undefined;
  for (const each of scored) {
    if (each.margin !== null && each.margin >= 0 && each.margin > (best?.margin ?? -1)) best = each;
  }
  return best;
};

// The confirmation that one person holds and pays for every account of the pool covers the accounts it named; once the
// pool's accounts differ, the pool needs a new one (pending owner decision, 2026-11-05: the stricter choice).
const confirmed = (settings: { confirmedAt: string | null; confirmedFor: readonly string[] }, members: Account[]) => {
  const named = new Set(settings.confirmedFor);
  return settings.confirmedAt !== null && named.size === members.length && members.every((m) => named.has(m.name));
};

type PoolRef = { readonly agent: Agent; readonly pool: string };

// Own keys only, so a pool named constructor, the one inherited property the name rule admits, is no pool.
const settingsOf = (registry: AccountRegistry, { agent, pool }: PoolRef) => {
  const pools = registry.pools[agent] ?? {};
  return Object.hasOwn(pools, pool) ? pools[pool] : undefined;
};

const membersOf = (registry: AccountRegistry, { agent, pool }: PoolRef): Account[] =>
  registry.accounts.filter((account) => account.agent === agent && account.pool === pool);

/** Whether the pool exists and its confirmation covers the pool's accounts as they are now. */
export const isConfirmed = (registry: AccountRegistry, ref: PoolRef): boolean => {
  const settings = settingsOf(registry, ref);
  // Codex switching stays off (A40) also for a registry that was built in memory, without the format's check.
  return ref.agent !== "codex" && settings !== undefined && confirmed(settings, membersOf(registry, ref));
};

/**
 * Chooses the account a new worker starts on: the pool account with the most headroom above both of its minimums, the
 * first one listed on a tie. When no pool account has a known reading, nothing switches: the task stays on `previous`,
 * or on the pool's first account (pending owner decision, 2026-11-05). `readings` holds the latest reading per account
 * and window; `now` is in milliseconds.
 */
export const selectAccount = (
  registry: AccountRegistry,
  { previous = null, ...ref }: PoolRef & { readonly previous?: string | null },
  readings: readonly Current[],
  now: number,
): Selection => {
  if (settingsOf(registry, ref) === undefined) return { ok: false, reason: "unknown-pool", candidates: [] };
  if (!isConfirmed(registry, ref)) return { ok: false, reason: "unconfirmed-pool", candidates: [] };
  const members = membersOf(registry, ref);
  const scored = members.map((account) => ({ account, margin: margin(registry, account, readings, now) }));
  const candidates = scored.map(({ account, margin: value }) => ({ account: account.name, margin: value }));
  const best = most(scored);
  if (best !== undefined) return { ok: true, account: best.account, reason: "most-headroom", candidates };
  const [first] = members;
  if (first !== undefined && scored.every((each) => each.margin === null)) {
    const stay = members.find((member) => member.name === previous) ?? first;
    return { ok: true, account: stay, reason: "no-readings", candidates };
  }
  return { ok: false, reason: "no-headroom", candidates };
};
