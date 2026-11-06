import { existsSync } from "node:fs";
import { join } from "node:path";
import { importBenchKeeper, type Left, type Selection, selectAccount } from "@cedarloom/accounts";
import {
  ACCOUNTS_SCHEMA_VERSION,
  AccountRegistry,
  type Agent,
  type Finding,
  formatRegistry,
  type Plan,
  type Result,
  readDocument,
} from "@cedarloom/contracts";
import { sha256 } from "@cedarloom/ledger";
import { readJson, readOptionalJson, withStore } from "./use-cases.ts";

/** The registry file in the config folder. */
const registryPath = (config: string): string => join(config, "accounts.json");

const readRegistry = (path: string): Result<{ text: string; registry: AccountRegistry }> => {
  const file = readJson(path);
  if (!file.ok) return file;
  const registry = readDocument(AccountRegistry, ACCOUNTS_SCHEMA_VERSION, file.value.json);
  return registry.ok ? { ok: true, value: { text: file.value.text, registry: registry.value } } : registry;
};

/** The account registry of the config folder; null when there is none yet. */
export const loadRegistry = (config: string): Result<AccountRegistry | null> => {
  const file = readOptionalJson(registryPath(config));
  if (!file.ok) return file;
  if (file.value === null) return { ok: true, value: null };
  return readDocument(AccountRegistry, ACCOUNTS_SCHEMA_VERSION, file.value.json);
};

/**
 * Plans the one-time import of BenchKeeper's registry file `from`: a create of the registry, refused when one exists
 * (the create also fails at apply time if one appeared). `left` lists what stays in BenchKeeper.
 */
export const planImport = (
  config: string,
  from: string,
  now: string = new Date().toISOString(),
): Result<{ plan: Plan; left: readonly Left[] }> => {
  const path = registryPath(config);
  if (existsSync(path)) return { ok: false, finding: { code: "accounts.registry-exists", params: { path } } };
  const file = readJson(from);
  if (!file.ok) return file;
  const imported = importBenchKeeper(file.value.json, now);
  if (!imported.ok) return imported;
  const content = formatRegistry(imported.value.registry);
  const plan: Plan = { schemaVersion: 1, operations: [{ kind: "write", path, before: null, content, mode: 0o600 }] };
  return { ok: true, value: { plan, left: imported.value.left } };
};

/**
 * Plans the user's confirmation that one person holds and pays for every account of the pool, which lets new workers
 * switch between them, with the terms it answers to as a finding. A Codex pool is refused before anything is read.
 */
export const planConfirm = (
  config: string,
  { agent, pool }: { readonly agent: Agent; readonly pool: string },
  now: string = new Date().toISOString(),
): Result<{ plan: Plan; findings: Finding[] }> => {
  if (agent === "codex") return { ok: false, finding: { code: "accounts.codex-switching-off", params: { pool } } };
  const path = registryPath(config);
  const read = readRegistry(path);
  if (!read.ok) return read;
  const { text, registry } = read.value;
  const pools = registry.pools[agent] ?? {};
  if (!Object.hasOwn(pools, pool)) {
    return { ok: false, finding: { code: "accounts.unknown-pool", params: { agent, pool } } };
  }
  // The confirmation names the accounts it covers; a later change to them makes the pool unconfirmed again.
  const confirmedFor = registry.accounts.filter((a) => a.agent === agent && a.pool === pool).map((a) => a.name);
  const confirmation = { confirmedAt: now, confirmedFor };
  const next = { ...registry, pools: { ...registry.pools, [agent]: { ...pools, [pool]: confirmation } } };
  const plan: Plan = {
    schemaVersion: 1,
    operations: [{ kind: "write", path, before: sha256(text), content: formatRegistry(next) }],
  };
  return { ok: true, value: { plan, findings: [{ code: "accounts.pool-terms", params: { pool } }] } };
};

/** How many workers run on one account at once: two per Claude Code account, one per Codex home. */
export const MAX_CONCURRENT: Readonly<Record<Agent, number>> = { claude: 2, codex: 1 };

export interface AccountRequest {
  readonly task: string;
  readonly agent: Agent;
  readonly pool: string;
  /** The account the task last ran on; null on its first launch. */
  readonly previous: string | null;
}

/**
 * Chooses the account a new worker of the task starts on, under the store's lock, and records the choice in the ledger
 * with the pool's readings and each candidate's margin. A pool that yields no account records nothing.
 */
export const chooseAccount = (
  state: string,
  registry: AccountRegistry,
  request: AccountRequest,
  now?: number,
): Result<Selection> =>
  withStore(state, (store) => {
    const readings = store.readings();
    // Judged once the store is held, so a reading that expired during the wait for the lock counts as expired.
    const judged = now ?? Date.now();
    // An account whose leases are all taken starts no worker now.
    const leases = [...store.liveLeases()];
    const busy = new Set(leases.filter(([, count]) => count >= MAX_CONCURRENT[request.agent]).map(([name]) => name));
    const selection = selectAccount(registry, { ...request, busy }, readings, judged);
    if (selection.ok) {
      const pool = new Set(selection.candidates.map((candidate) => candidate.account));
      store.recordSwitch({
        at: new Date(judged).toISOString(),
        task: request.task,
        from: request.previous,
        to: selection.account.name,
        reason: selection.reason,
        readings: readings.filter((reading) => pool.has(reading.account)),
        candidates: [...selection.candidates],
      });
    }
    return { ok: true, value: selection };
  });
