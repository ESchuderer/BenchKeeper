import { type Finding, Quota, type Result } from "@cedarloom/contracts";
import type { RunningExtension } from "@cedarloom/extension-host";
import { keepSwapReadings, loadRegistry } from "./accounts.ts";
import { bundledExtensions, type Paths, startBundled } from "./bundled.ts";
import { retryBusy } from "./use-cases.ts";

const ID = "cedarloom.claude-swap";
const INTERACTIVE = { target: "interactive" };
// The host checked each window against Quota; this tells the type so.
const isQuota = <W extends { window: string }>(each: W): each is W & { window: Quota } =>
  Quota.safeParse(each.window).success;

/**
 * Keeps claude-swap's readings of the registry's Claude Code accounts, each by its claude-swap alias, which equals the
 * CedarLoom account's name. Nothing is read without claude-swap at a version its extension reads, or with that
 * extension switched off (the doctor says why); what keeps a present claude-swap from answering comes back as findings.
 */
export const readSwapAccounts = async (paths: Paths): Promise<Finding[]> => {
  const names = claudeNames(paths);
  if (!names.ok || names.value.size === 0) return names.ok ? [] : [names.finding];
  const bundled = bundledExtensions(paths.app, paths.config);
  if (!bundled.ok) return [bundled.finding];
  if (!bundled.value.some(({ id, state }) => id === ID && state !== "off")) return [];
  const started = await startBundled(paths, ID);
  if (!started.ok) return [started.finding];
  try {
    return await kept(paths.state, started.value, names.value);
  } finally {
    await started.value.stop();
  }
};

// The registry's Claude Code accounts, by name.
const claudeNames = (paths: Paths): Result<Set<string>> => {
  const registry = loadRegistry(paths.config);
  if (!registry.ok) return registry;
  const accounts = registry.value?.accounts ?? [];
  return { ok: true, value: new Set(accounts.filter(({ agent }) => agent === "claude").map(({ name }) => name)) };
};

// The started extension's accounts kept as readings of the accounts their alias names, once its probe passes.
const kept = async (state: string, running: RunningExtension, names: ReadonlySet<string>): Promise<Finding[]> => {
  const probed = await running.target("target/probe", INTERACTIVE);
  if (!probed.ok || probed.value.status !== "supported") return probed.ok ? [] : [probed.finding];
  const listed = await running.target("target/accounts", INTERACTIVE);
  if (!listed.ok) return [listed.finding];
  for (const { alias, windows } of listed.value.accounts) {
    if (alias === undefined || !names.has(alias)) continue;
    const stored = await retryBusy(() => keepSwapReadings(state, alias, windows.filter(isQuota)));
    if (!stored.ok) return [stored.finding];
  }
  return [];
};

/**
 * claude-swap's readings for one run's workers: one read at a time, and none again within `freshMs` (claude-swap polls
 * usage about once a minute), so parallel workers start one extension, and a worker that waited for a lease reads anew.
 */
export const swapReader = (paths: Paths, freshMs = 60_000): (() => Promise<Finding[]>) => {
  let last: { at: number; read: Promise<Finding[]> } | undefined;
  return () => {
    if (last === undefined || Date.now() - last.at >= freshMs) last = { at: Date.now(), read: readSwapAccounts(paths) };
    return last.read;
  };
};
