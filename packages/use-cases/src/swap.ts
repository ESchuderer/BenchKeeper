import { type Finding, Quota, type Result } from "@cedarloom/contracts";
import type { RunningExtension } from "@cedarloom/extension-host";
import { keepSwapReadings, loadRegistry } from "./accounts.ts";
import { bundledExtensions, type Paths, runBundled, startBundled } from "./bundled.ts";
import { retryBusy, withStore } from "./use-cases.ts";

const ID = "cedarloom.claude-swap";
const ORCA = "cedarloom.orca";
const INTERACTIVE = { target: "interactive" };
// The host checked each window against Quota; this tells the type so.
const isQuota = <W extends { window: string }>(each: W): each is W & { window: Quota } =>
  Quota.safeParse(each.window).success;

// Whether the app ships its extension `id` and it is switched on.
const switchedOn = (paths: Paths, id: string): Result<boolean> => {
  const bundled = bundledExtensions(paths.app, paths.config);
  return bundled.ok
    ? { ok: true, value: bundled.value.some((each) => each.id === id && each.state !== "off") }
    : bundled;
};

// The claude-swap extension started and probed for `use`, then stopped; null while it is off or claude-swap is not one
// it reads (the doctor says why).
const withSwap = async <T>(
  paths: Paths,
  use: (running: RunningExtension) => Promise<Result<T>>,
): Promise<Result<T | null>> => {
  const on = switchedOn(paths, ID);
  if (!on.ok || !on.value) return on.ok ? { ok: true, value: null } : on;
  const started = await startBundled(paths, ID);
  if (!started.ok) return started;
  try {
    const probed = await started.value.target("target/probe", INTERACTIVE);
    if (!probed.ok || probed.value.status !== "supported") return probed.ok ? { ok: true, value: null } : probed;
    return await use(started.value);
  } finally {
    await started.value.stop();
  }
};

/** claude-swap's interactive account: its number, and its alias when it names a CedarLoom account. */
export type Interactive = { number: number; account: string | null };

/**
 * Keeps claude-swap's readings of the registry's Claude Code accounts, each by its claude-swap alias, which equals the
 * CedarLoom account's name, and says which account interactive sessions use. Nothing is read without claude-swap at a
 * version its extension reads, or with that extension switched off (the doctor says why); what keeps a present
 * claude-swap from answering comes back as findings.
 */
export const readSwapAccounts = async (
  paths: Paths,
): Promise<{ findings: Finding[]; interactive: Interactive | null }> => {
  const names = claudeNames(paths);
  if (!names.ok || names.value.size === 0) return { findings: names.ok ? [] : [names.finding], interactive: null };
  const read = await withSwap(paths, (running) => kept(paths.state, running, names.value));
  return read.ok ? { findings: [], interactive: read.value } : { findings: [read.finding], interactive: null };
};

// The registry's Claude Code accounts, by name.
const claudeNames = (paths: Paths): Result<Set<string>> => {
  const registry = loadRegistry(paths.config);
  if (!registry.ok) return registry;
  const accounts = registry.value?.accounts ?? [];
  return { ok: true, value: new Set(accounts.filter(({ agent }) => agent === "claude").map(({ name }) => name)) };
};

// The running extension's accounts kept as readings of the accounts their alias names; the interactive one.
const kept = async (
  state: string,
  running: RunningExtension,
  names: ReadonlySet<string>,
): Promise<Result<Interactive | null>> => {
  const listed = await running.target("target/accounts", INTERACTIVE);
  if (!listed.ok) return listed;
  for (const { alias, windows } of listed.value.accounts) {
    if (alias === undefined || !names.has(alias)) continue;
    const stored = await retryBusy(() => keepSwapReadings(state, alias, windows.filter(isQuota)));
    if (!stored.ok) return stored;
  }
  const active = listed.value.accounts.find((account) => account.active);
  if (active === undefined) return { ok: true, value: null };
  const account = active.alias !== undefined && names.has(active.alias) ? active.alias : null;
  return { ok: true, value: { number: active.number, account } };
};

const refuse = (finding: Finding): Result<never> => ({ ok: false, finding });

// `use` on the claude-swap extension, which must be there at a version it reads.
const askSwap = async <T>(paths: Paths, use: (running: RunningExtension) => Promise<Result<T>>): Promise<Result<T>> => {
  const done = await withSwap(paths, use);
  if (!done.ok) return done;
  return done.value === null
    ? refuse({ code: "accounts.swap-unavailable", params: {} })
    : { ok: true, value: done.value };
};

/**
 * What the Orca extension's follow answers: Orca's managed Claude account follows the default home's, selected with
 * orca allowed when `run` (owner, Q4); null while that extension is off.
 */
const orcaFollows = async (paths: Paths, run: boolean): Promise<Result<Record<string, unknown>> | null> => {
  const on = switchedOn(paths, ORCA);
  if (on.ok && !on.value) return null;
  return on.ok ? runBundled(paths, ORCA, "follow", run ? ["orca"] : []) : on;
};

/**
 * Switches claude-swap's interactive account (the default home's) to the CedarLoom account `name`, by its claude-swap
 * alias, and Orca's managed Claude account follows, under the same approval; without `run`, only which claude-swap
 * account that is (switched: null) and how Orca's panes pick theirs. An account a CedarLoom worker runs on is refused,
 * as claude-swap's auto mode never moves onto an account with a live session (switching plan 14.2).
 */
export const switchInteractive = async (
  paths: Paths,
  name: string,
  run: boolean,
): Promise<Result<{ number: number; switched: boolean | null; orca: Result<Record<string, unknown>> | null }>> => {
  const names = claudeNames(paths);
  if (!names.ok) return names;
  if (!names.value.has(name)) return refuse({ code: "accounts.unknown-account", params: { account: name } });
  type Switched = { number: number; switched: boolean | null };
  const switched = await askSwap(paths, async (running): Promise<Result<Switched>> => {
    const listed = await running.target("target/accounts", INTERACTIVE);
    if (!listed.ok) return listed;
    const target = listed.value.accounts.find(({ alias }) => alias === name);
    if (target === undefined) return refuse({ code: "accounts.swap-unlinked", params: { account: name } });
    const { number } = target;
    if (target.active) return { ok: true, value: { number, switched: false } };
    // shortcut: a worker that leases the account between this check and the switch is not held off; hold the account
    // across the switch once the ledger has a hold that stays after A3 removes the login check's.
    const live = await retryBusy(() => withStore(paths.state, (store) => ({ ok: true, value: store.liveLeases() })));
    if (!live.ok) return live;
    if ((live.value.get(name) ?? 0) > 0) return refuse({ code: "accounts.swap-busy", params: { account: name } });
    if (!run) return { ok: true, value: { number, switched: null } };
    const selected = await running.target("target/select", { ...INTERACTIVE, number });
    return selected.ok ? { ok: true, value: { number, switched: selected.value.switched } } : selected;
  });
  if (!switched.ok) return switched;
  // After claude-swap's switch, so Orca reads the default home's new login.
  return { ok: true, value: { ...switched.value, orca: await orcaFollows(paths, run) } };
};

/**
 * A claude-swap setting CedarLoom may set: only its auto mode's (autoswitch.*), as others, such as run.shareHistory,
 * change the sharing session mode relies on (switching plan 14.3).
 */
export const checkSwapSetting = (key: string): Result<string> =>
  key.startsWith("autoswitch.") ? { ok: true, value: key } : refuse({ code: "accounts.swap-setting", params: { key } });

/** claude-swap's auto mode settings (`cswap config`), after it set `set`, which it checks key by key. */
export const swapPolicy = async (
  paths: Paths,
  set: Record<string, string> = {},
): Promise<Result<Record<string, string | number | boolean>>> => {
  const refused = Object.keys(set)
    .map((key) => checkSwapSetting(key))
    .find((checked) => !checked.ok);
  if (refused?.ok === false) return refused;
  const changes = Object.keys(set).length > 0 ? { set } : {};
  return askSwap(paths, async (running): Promise<Result<Record<string, string | number | boolean>>> => {
    const policy = await running.target("target/policy", { ...INTERACTIVE, ...changes });
    return policy.ok ? { ok: true, value: policy.value.values } : policy;
  });
};

/**
 * claude-swap's readings for one run's workers: one read at a time, and none again within `freshMs` (claude-swap polls
 * usage about once a minute), so parallel workers start one extension, and a worker that waited for a lease reads anew.
 */
export const swapReader = (paths: Paths, freshMs = 60_000): (() => Promise<unknown>) => {
  let last: { at: number; read: Promise<unknown> } | undefined;
  return () => {
    if (last === undefined || Date.now() - last.at >= freshMs) last = { at: Date.now(), read: readSwapAccounts(paths) };
    return last.read;
  };
};
