import {
  type Account,
  type AccountRegistry,
  type Agent,
  modelWindow,
  type Quota,
  QuotaWindow,
  type Reading,
} from "@cedarloom/contracts";

/** What the choice reads of a reading: the time it was read is not needed. */
type Current = Omit<Reading, "readAt">;

/**
 * The headroom a new worker needs in each window, in percent, the same for every account: claude-swap's lines replace
 * it for pool accounts once they reach the choice (owner decision, 2026-11-07).
 */
const DEFAULT_MINIMUM = { fiveHour: 8, sevenDay: 3 } as const;

/** A pool account as the choice saw it: its smallest margin above the minimums, null when a window is unknown. */
export interface Candidate {
  readonly account: string;
  readonly margin: number | null;
}

export type Selection =
  | {
      readonly ok: true;
      readonly account: Account;
      /**
       * Why this account, by claude-swap's strategy: `most-headroom` (`best`), `soonest-weekly-reset` (`weekly-first`,
       * `consume-first`), `highest-tier` (`priority-consume-first`). `no-readings`: no pool account had both windows
       * known, so the task stays on its account and nothing switches.
       */
      readonly reason: "most-headroom" | "soonest-weekly-reset" | "highest-tier" | "no-readings";
      readonly candidates: readonly Candidate[];
    }
  | {
      readonly ok: false;
      /** `all-leased`: every account of the pool runs its most workers at once. */
      readonly reason: "unknown-pool" | "unconfirmed-pool" | "no-headroom" | "all-leased";
      readonly candidates: readonly Candidate[];
    };

/**
 * The readings as a choice at `now` counts them. A window whose reset time has passed since its last reading counts as
 * 0 percent used, with the source `assumed-after-reset`, until the next reading replaces it; the restart-on-limit rule
 * bounds a wrong guess (owner decision "Idle window after reset", 2026-11-06). A reading whose reset time does not
 * parse is left out, so its window is unknown, as is a window never read.
 */
export const counted = <T extends Current>(readings: readonly T[], now: number): Counted<T>[] =>
  readings.flatMap((reading): Counted<T>[] => {
    const resetsAt = Date.parse(reading.resetsAt);
    if (Number.isNaN(resetsAt)) return [];
    return resetsAt > now
      ? [{ ...reading, source: "reported" }]
      : [{ ...reading, usedPercent: 0, source: "assumed-after-reset" }];
  });

/** A reading with the source of its share: reported by the agent, or assumed after its window's reset. */
export type Counted<T extends Current> = T & { readonly source: "reported" | "assumed-after-reset" };

// A window without a counted reading is unknown: it never makes an account qualify. A known window below its minimum
// disqualifies the account even when the other window is unknown. The worker model's own weekly window counts when it
// was read, against the weekly minimum, as claude-swap judges model windows; an account without one is not unknown.
const margin = (account: Account, readings: readonly Current[], model: string | undefined) => {
  let smallest = Number.POSITIVE_INFINITY;
  let unknown = false;
  const read = (window: Quota) => readings.find((each) => each.account === account.name && each.window === window);
  for (const window of QuotaWindow.options) {
    const reading = read(window);
    if (reading === undefined) unknown = true;
    else smallest = Math.min(smallest, 100 - reading.usedPercent - DEFAULT_MINIMUM[window]);
  }
  const own = model === undefined ? null : modelWindow(model);
  const reading = own === null ? undefined : read(own);
  if (reading !== undefined) smallest = Math.min(smallest, 100 - reading.usedPercent - DEFAULT_MINIMUM.sevenDay);
  return unknown && smallest >= 0 ? null : smallest;
};

/**
 * What claude-swap says of the pool's accounts, which a worker's choice honors (owner decision, 2026-11-07): its
 * `autoswitch.strategy`, each account's priority tier (0 when it has none), the accounts it has disabled, the one it
 * has active for interactive sessions, and for running workers its `autoswitch.cooldownSeconds` and
 * `autoswitch.hysteresisPct`. Without it: `best`, no tiers, none disabled, none active, 300 seconds and 10 points.
 */
interface Swap {
  readonly strategy?: "best" | "weekly-first" | "consume-first" | "priority-consume-first";
  readonly tiers?: ReadonlyMap<string, number>;
  readonly disabled?: ReadonlySet<string>;
  readonly active?: string | null;
  readonly cooldownSeconds?: number;
  readonly hysteresisPct?: number;
}

const REASONS = {
  best: "most-headroom",
  "weekly-first": "soonest-weekly-reset",
  "consume-first": "soonest-weekly-reset",
  "priority-consume-first": "highest-tier",
} as const;

// When the account's 7-day window resets next, in milliseconds; never for one unknown or already reset.
const weeklyReset = (account: Account, readings: readonly Current[], now: number): number => {
  const reading = readings.find((each) => each.account === account.name && each.window === "sevenDay");
  const at = reading === undefined ? Number.NaN : Date.parse(reading.resetsAt);
  return at > now ? at : Number.POSITIVE_INFINITY;
};

// The candidate with a margin of at least `floor` the strategy ranks first, the first one listed on a tie: `best` by
// the most headroom; the others by the soonest weekly reset, then headroom, `priority-consume-first` within the highest
// tier first. claude-swap's active account is passed over while another account qualifies.
const ranked = <T extends { readonly account: Account; readonly margin: number | null; readonly reset: number }>(
  scored: readonly T[],
  { strategy = "best", tiers = new Map(), active = null }: Swap,
  floor = 0,
): (T & { readonly reason: (typeof REASONS)[keyof typeof REASONS] }) | undefined => {
  const qualifying = scored.filter((each) => each.margin !== null && each.margin >= floor);
  const others = qualifying.filter((each) => each.account.name !== active);
  const tier = (each: T): number => (strategy === "priority-consume-first" ? (tiers.get(each.account.name) ?? 0) : 0);
  const reset = (each: T): number => (strategy === "best" ? 0 : each.reset);
  const order = (a: T, b: T): number => tier(b) - tier(a) || reset(a) - reset(b) || (b.margin ?? 0) - (a.margin ?? 0);
  const [first] = (others.length > 0 ? others : qualifying).toSorted(order);
  return first === undefined ? undefined : { ...first, reason: REASONS[strategy] };
};

// The confirmation that one person holds and pays for every account of the pool covers the accounts it named; once the
// pool's accounts differ, the pool needs a new one (owner decision, 2026-11-06: the stricter choice).
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

// The pool's accounts with a free lease; null when every one of them runs its most workers.
const freeMembers = (registry: AccountRegistry, ref: PoolRef, busy: ReadonlySet<string>): Account[] | null => {
  const pool = membersOf(registry, ref);
  const free = pool.filter((account) => !busy.has(account.name));
  return pool.length > 0 && free.length === 0 ? null : free;
};

/** Whether the pool exists and its confirmation covers the pool's accounts as they are now. */
export const isConfirmed = (registry: AccountRegistry, ref: PoolRef): boolean => {
  const settings = settingsOf(registry, ref);
  // Codex switching stays off (A40) also for a registry that was built in memory, without the format's check.
  return ref.agent !== "codex" && settings !== undefined && confirmed(settings, membersOf(registry, ref));
};

// No account qualifies. With no known reading in the pool nothing switches: the task stays on `previous`, else on the
// first account; otherwise there is no account with headroom.
const unread = (members: readonly Account[], candidates: readonly Candidate[], previous: string | null): Selection => {
  const [first] = members;
  if (first === undefined || candidates.some((each) => each.margin !== null)) {
    return { ok: false, reason: "no-headroom", candidates };
  }
  return {
    ok: true,
    account: members.find((member) => member.name === previous) ?? first,
    reason: "no-readings",
    candidates,
  };
};

/**
 * Chooses the account a new worker starts on: the pool account with headroom above both minimums that claude-swap's
 * strategy ranks first (`swap`), the first one listed on a tie. When no pool account has a known reading, nothing
 * switches: the task stays on `previous`, or on the pool's first account (owner decision, 2026-11-06). An account in
 * `busy` runs its most workers at once and is passed over, as is one claude-swap has disabled. `model` is the worker's,
 * whose own weekly window counts too. `readings` holds the latest reading per account and window, counted at `now`
 * (milliseconds).
 */
export const selectAccount = (
  registry: AccountRegistry,
  {
    previous = null,
    busy,
    model,
    swap = {},
    ...ref
  }: PoolRef & {
    readonly previous?: string | null;
    readonly busy?: ReadonlySet<string>;
    readonly model?: string | undefined;
    readonly swap?: Swap;
  },
  readings: readonly Current[],
  now: number,
): Selection => {
  if (settingsOf(registry, ref) === undefined) return { ok: false, reason: "unknown-pool", candidates: [] };
  if (!isConfirmed(registry, ref)) return { ok: false, reason: "unconfirmed-pool", candidates: [] };
  const free = freeMembers(registry, ref, busy ?? new Set());
  if (free === null) return { ok: false, reason: "all-leased", candidates: [] };
  const disabled = swap.disabled ?? new Set();
  const members = free.filter((account) => !disabled.has(account.name));
  const { scored, candidates } = scoredOf(members, counted(readings, now), model, now);
  const best = ranked(scored, swap);
  if (best !== undefined) return { ok: true, account: best.account, reason: best.reason, candidates };
  return unread(members, candidates, previous);
};

// Each account's margin and next weekly reset by the counted readings, and the candidates as a choice reports them.
const scoredOf = (members: readonly Account[], current: readonly Current[], model: string | undefined, now: number) => {
  const scored = members.map((account) => ({
    account,
    margin: margin(account, current, model),
    reset: weeklyReset(account, current, now),
  }));
  return { scored, candidates: scored.map(({ account, margin: value }) => ({ account: account.name, margin: value })) };
};

export type Move =
  | {
      readonly move: true;
      readonly account: Account;
      readonly reason: (typeof REASONS)[keyof typeof REASONS];
      readonly candidates: readonly Candidate[];
    }
  | {
      readonly move: false;
      /** `off`: the pool is unconfirmed or does not move running workers. `no-target`: no account clears the bar. */
      readonly reason: "off" | "within-line" | "cooldown" | "no-target";
      readonly candidates: readonly Candidate[];
    };

const stay = (reason: Extract<Move, { move: false }>["reason"], candidates: readonly Candidate[] = []): Move => ({
  move: false,
  reason,
  candidates,
});

type MoveRequest = PoolRef & {
  readonly from: string;
  readonly trigger: "line" | "at-limit";
  readonly since: number | null;
  readonly held?: ReadonlySet<string>;
  readonly busy?: ReadonlySet<string>;
  readonly model?: string | undefined;
  readonly swap?: Swap;
};

// Why a worker at its line stays: its margin is unknown or not below 0, or claude-swap's cooldown still runs.
const lineStay = (left: number | null, since: number | null, now: number, cooldownSeconds = 300) => {
  if (left === null || left >= 0) return "within-line";
  return since !== null && now - since < cooldownSeconds * 1000 ? "cooldown" : null;
};

// The margin a target needs: at the worker's line, its own plus claude-swap's hysteresis; at its limit, any headroom.
const floorOf = (trigger: MoveRequest["trigger"], left: number | null, hysteresisPct = 10): number =>
  trigger === "line" ? Math.max(0, (left ?? 0) + hysteresisPct) : 0;

// The strategy's first account with a margin of at least `floor` among the pool's others not busy, held or disabled.
const target = (
  members: readonly Account[],
  { from, held = new Set(), busy = new Set(), model, swap = {} }: MoveRequest,
  { current, floor, now }: { current: readonly Current[]; floor: number; now: number },
): Move => {
  const out = new Set([from, ...held, ...busy, ...(swap.disabled ?? [])]);
  const { scored, candidates } = scoredOf(
    members.filter((each) => !out.has(each.name)),
    current,
    model,
    now,
  );
  const best = ranked(scored, swap, floor);
  if (best === undefined) return stay("no-target", candidates);
  return { move: true, account: best.account, reason: best.reason, candidates };
};

/**
 * Whether a running worker on `from` moves to another account of its pool now, and to which (A41 a): only in a
 * confirmed pool with `moveRunning`. At its line (`line`: its margin below 0) it moves once claude-swap's cooldown has
 * passed since `since` (its start or last move, milliseconds), to an account whose margin beats its own by claude-swap's
 * hysteresis. At its limit (`at-limit`, the agent's own report) it moves at once to any account with headroom. The
 * target is the strategy's first among the other pool accounts; one in `busy`, `held` (its login check failed) or
 * disabled by claude-swap is passed over.
 */
export const selectMove = (
  registry: AccountRegistry,
  request: MoveRequest,
  readings: readonly Current[],
  now: number,
): Move => {
  const { from, trigger, model, swap = {} } = request;
  if (settingsOf(registry, request)?.moveRunning !== true || !isConfirmed(registry, request)) return stay("off");
  const current = counted(readings, now);
  const members = membersOf(registry, request);
  const own = members.find((account) => account.name === from);
  const left = own === undefined ? null : margin(own, current, model);
  const why = trigger === "line" ? lineStay(left, request.since, now, swap.cooldownSeconds) : null;
  if (why !== null) return stay(why);
  return target(members, request, { current, floor: floorOf(trigger, left, swap.hysteresisPct), now });
};
