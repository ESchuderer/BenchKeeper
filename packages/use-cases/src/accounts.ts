import { chmodSync, lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { counted, type Selection, selectAccount } from "@cedarloom/accounts";
import type { LoginStatus } from "@cedarloom/agent-contracts";
import {
  type Account,
  ACCOUNTS_SCHEMA_VERSION,
  AccountRegistry,
  type Agent,
  type Finding,
  formatRegistry,
  type Plan,
  type Result,
  readDocument,
  sameFolder,
} from "@cedarloom/contracts";
import { openRunStore, sha256 } from "@cedarloom/ledger";
import { cleanEnv, NETWORK_SETTINGS } from "@cedarloom/orchestration";
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

/**
 * The account's own config folder on this machine, below the state folder. Workers run, and the login happens, only
 * there, so nothing is written into another tool's folder (owner decision "Worker homes", 2026-11-06).
 */
export const ownHome = (state: string, name: string): string => join(state, "homes", name);

interface Read {
  readonly path: string;
  readonly text: string;
  readonly registry: AccountRegistry;
  readonly account: Account;
}

/**
 * The account's own home as a real folder for the owner only. Refused when the account names another folder, when the
 * homes folder or the home is a link, so nothing written for the account lands in another folder, and when the home is
 * missing: only the login (`create`) makes it, so no worker or probe runs before the account is logged in.
 */
export const ownFolder = (
  state: string,
  { name, home: named }: Account,
  { create }: { readonly create: boolean },
): Result<string> => {
  const home = ownHome(state, name);
  if (!sameFolder(named, home)) {
    return { ok: false, finding: { code: "accounts.home-not-own", params: { account: name, home: named } } };
  }
  for (const path of [join(state, "homes"), home]) {
    const found = lstatSync(path, { throwIfNoEntry: false });
    if (found?.isSymbolicLink() === true) {
      return { ok: false, finding: { code: "accounts.home-linked", params: { account: name, path } } };
    }
    if (found === undefined && !create) {
      return { ok: false, finding: { code: "accounts.home-missing", params: { account: name, home } } };
    }
    try {
      mkdirSync(path, { recursive: true, mode: 0o700 });
      chmodSync(path, 0o700);
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      return { ok: false, finding: { code: "accounts.home-unusable", params: { account: name, path, error: cause } } };
    }
  }
  return { ok: true, value: home };
};

// The registry file with its text and the account `name`, refused when there is none or it is not Claude Code's.
const readAccount = (config: string, name: string): Result<Read> => {
  const path = registryPath(config);
  const read = readRegistry(path);
  if (!read.ok) return read;
  const account = read.value.registry.accounts.find((each) => each.name === name);
  if (account === undefined)
    return { ok: false, finding: { code: "accounts.unknown-account", params: { account: name } } };
  if (account.agent !== "claude") {
    return {
      ok: false,
      finding: { code: "accounts.login-unsupported", params: { account: name, agent: account.agent } },
    };
  }
  return { ok: true, value: { path, ...read.value, account } };
};

/**
 * Plans moving account `name` into its own home: the registry names that folder, and the folder it named before stays
 * as an alias, read for usage only. The plan is null when the account is in its own home already.
 */
export const planHome = (config: string, state: string, name: string): Result<{ plan: Plan | null; home: string }> => {
  const read = readAccount(config, name);
  if (!read.ok) return read;
  const { path, text, registry, account } = read.value;
  const home = ownHome(state, account.name);
  if (sameFolder(account.home, home)) return { ok: true, value: { plan: null, home } };
  const others = registry.accounts.filter((each) => each !== account);
  if (others.some((each) => [each.home, ...(each.aliases ?? [])].some((folder) => sameFolder(folder, home)))) {
    return { ok: false, finding: { code: "accounts.folder-taken", params: { path: home } } };
  }
  // A former own home among the account's aliases, after a change of the state folder, becomes its home again.
  const kept = (account.aliases ?? []).filter((alias) => !sameFolder(alias, home));
  const moved = { ...account, home, aliases: [...kept, account.home] };
  const next = { ...registry, accounts: registry.accounts.map((each) => (each === account ? moved : each)) };
  const content = formatRegistry(next);
  return {
    ok: true,
    value: { plan: { schemaVersion: 1, operations: [{ kind: "write", path, before: sha256(text), content }] }, home },
  };
};

/** How the agent's login ended: its exit code, or null with the error when it did not start. */
export interface LoginRun {
  readonly code: number | null;
  readonly error?: string;
}

/** Where a login runs: the launcher's environment and platform, and `run`, which starts the agent's login with `env`. */
export interface LoginHost {
  readonly parent: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  readonly run: (env: Record<string, string>) => LoginRun;
}

/**
 * Runs the agent's own login (`claude auth login`, through `run`) in the account's own home, which it creates for the
 * owner only. The login gets the clean environment of every agent process and the terminal's type for its prompts.
 */
export const loginAccount = (
  config: string,
  state: string,
  name: string,
  { parent, platform, run }: LoginHost,
): Result<{ home: string }> => {
  const read = readAccount(config, name);
  if (!read.ok) return read;
  const { account } = read.value;
  const folder = ownFolder(state, account, { create: true });
  if (!folder.ok) return folder;
  const home = folder.value;
  const ran = run({ ...cleanEnv(parent, platform, ["TERM", ...NETWORK_SETTINGS]), CLAUDE_CONFIG_DIR: home });
  if (ran.code === 0) return { ok: true, value: { home } };
  const error = ran.error ?? `exit code ${ran.code}`;
  return { ok: false, finding: { code: "accounts.login-failed", params: { account: account.name, error } } };
};

/** Where the doctor checks logins: the launcher's environment and platform, and `status`, the agent's own check. */
export interface StatusHost {
  readonly parent: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  readonly status: (env: Readonly<Record<string, string>>) => Promise<LoginStatus>;
}

// What one home's login status shows to be wrong.
const problems = (account: string, home: string, login: LoginStatus): Finding[] => {
  if (login.kind === "unknown") return [{ code: "doctor.login-unchecked", params: { account, error: login.error } }];
  if (login.kind === "logged-out") return [{ code: "doctor.logged-out", params: { account, home } }];
  const { authMethod: method, configDirectory } = login;
  const elsewhere = configDirectory !== null && configDirectory !== home;
  return [
    ...(elsewhere ? [{ code: "doctor.login-elsewhere" as const, params: { account, home, configDirectory } }] : []),
    ...(method === "claude.ai" ? [] : [{ code: "doctor.login-method" as const, params: { account, method } }]),
  ];
};

// One account's check, while the ledger holds the account for it. A home that is not the account's own, or is a link,
// is reported and never checked: the check can write into it.
const checkOne = async (state: string, account: Account, host: StatusHost): Promise<Result<Finding[]>> => {
  const { name } = account;
  const folder = ownFolder(state, account, { create: false });
  if (!folder.ok) return { ok: true, value: [folder.finding] };
  const home = folder.value;
  const store = openRunStore(state);
  if (!store.ok) return store;
  let held: ReturnType<typeof store.value.checkAccount>;
  try {
    held = store.value.checkAccount(name);
  } finally {
    store.value.close();
  }
  if (held === null) return { ok: true, value: [{ code: "doctor.login-skipped", params: { account: name } }] };
  try {
    // The check can renew the login over the network, as the login does.
    const env = { ...cleanEnv(host.parent, host.platform, NETWORK_SETTINGS), CLAUDE_CONFIG_DIR: home };
    return { ok: true, value: problems(name, home, await host.status(env)) };
  } finally {
    held.release();
  }
};

/**
 * Checks the login of each Claude Code account in its own home, one at a time: the doctor's login check. The check can
 * renew a login, so it never runs beside a worker on the account, and no worker starts on it meanwhile (owner decision
 * "Worker homes", 2026-11-06). An account outside its own home is reported instead.
 */
export const checkLogins = async (state: string, config: string, host: StatusHost): Promise<Result<Finding[]>> => {
  const loaded = loadRegistry(config);
  if (!loaded.ok) return loaded;
  const findings: Finding[] = [];
  for (const account of (loaded.value?.accounts ?? []).filter((each) => each.agent === "claude")) {
    // One at a time, so no two checks of logins run at once.
    const found = await checkOne(state, account, host);
    if (!found.ok) return found;
    findings.push(...found.value);
  }
  return { ok: true, value: findings };
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
 * with the pool's readings as the choice counted them and each candidate's margin. A pool that yields no account
 * records nothing.
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
        readings: counted(readings, judged).filter((reading) => pool.has(reading.account)),
        candidates: [...selection.candidates],
      });
    }
    return { ok: true, value: selection };
  });
