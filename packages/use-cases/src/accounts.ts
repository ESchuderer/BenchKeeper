import { chmodSync, lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { counted, type Move, type Selection, selectAccount, selectMove } from "@cedarloom/accounts";
import {
  type Account,
  ACCOUNTS_SCHEMA_VERSION,
  AccountRegistry,
  type AccountSwitch,
  Agent,
  type Reading,
  type Result,
  readDocument,
  sameFolder,
} from "@cedarloom/contracts";
import type { RunStore } from "@cedarloom/ledger";
import { readOptionalJson, withStore } from "./use-cases.ts";

/** The registry file in the config folder. */
const registryPath = (config: string): string => join(config, "accounts.json");

/** The account registry of the config folder; null when there is none yet. */
export const loadRegistry = (config: string): Result<AccountRegistry | null> => {
  const file = readOptionalJson(registryPath(config));
  if (!file.ok) return file;
  if (file.value === null) return { ok: true, value: null };
  return readDocument(AccountRegistry, ACCOUNTS_SCHEMA_VERSION, file.value.json);
};

/**
 * The account's own config folder on this machine, below the state folder. Workers run, and the login happens, only
 * there, so nothing is written into another tool's folder (owner decision "Worker homes", 2026-11-06).
 */
export const ownHome = (state: string, name: string): string => join(state, "homes", name);

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

/** How many workers run on one account at once: two per Claude Code account, one per Codex home. */
export const MAX_CONCURRENT: Readonly<Record<Agent, number>> = { claude: 2, codex: 1 };

export interface AccountRequest {
  readonly task: string;
  readonly agent: Agent;
  readonly pool: string;
  /** The account the task last ran on; null on its first launch. */
  readonly previous: string | null;
  /** The model the worker runs: its own weekly window counts too, once read. */
  readonly model?: string | undefined;
}

// Accounts whose leases are all taken: they start or take over no worker now.
const fullAccounts = (store: RunStore, agent: Agent): Set<string> =>
  new Set([...store.liveLeases()].filter(([, count]) => count >= MAX_CONCURRENT[agent]).map(([name]) => name));

// Records a choice dated when its readings were judged, with the counted readings of its accounts and candidates.
const recordChoice = (
  store: RunStore,
  { readings, judged }: { readings: readonly Reading[]; judged: number },
  row: Omit<AccountSwitch, "at" | "readings">,
): void => {
  const shown = new Set([...row.candidates.map((candidate) => candidate.account), row.from]);
  const counts = counted(readings, judged).filter((reading) => shown.has(reading.account));
  store.recordSwitch({ ...row, at: new Date(judged).toISOString(), readings: counts });
};

/**
 * Chooses the account a new worker of the task starts on, under the store's lock, and records the choice in the ledger
 * with the pool's readings the choice counted and each candidate's margin. A pool that yields no account records
 * nothing.
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
    const busy = fullAccounts(store, request.agent);
    const selection = selectAccount(registry, { ...request, busy }, readings, judged);
    if (selection.ok) {
      const { task, previous: from } = request;
      const { account, reason, candidates } = selection;
      const row = { task, from, to: account.name, reason, trigger: "launch" as const, candidates: [...candidates] };
      recordChoice(store, { readings, judged }, row);
    }
    return { ok: true, value: selection };
  });

/** A running worker that may move: its task, its pool, the account it runs on, and why it would move. */
export interface MoveRequest {
  readonly task: string;
  readonly agent: Agent;
  readonly pool: string;
  readonly from: string;
  readonly trigger: "line" | "at-limit";
  /** Accounts whose login check failed: held, so no worker moves onto them. */
  readonly held?: ReadonlySet<string>;
  readonly model?: string | undefined;
}

/**
 * Decides under the store's lock whether a running worker of the task moves to another account of its pool now
 * (`selectMove`), and records a move in the ledger with its trigger. claude-swap's cooldown counts from the task's latest
 * row or worker start: a resumed worker starts without a row.
 */
export const chooseMove = (
  state: string,
  registry: AccountRegistry,
  request: MoveRequest,
  now?: number,
): Result<Move> =>
  withStore(state, (store) => {
    const readings = store.readings();
    const judged = now ?? Date.now();
    const last = store.lastSwitchOrLaunch(request.task);
    const since = last === null ? null : Date.parse(last);
    const move = selectMove(
      registry,
      { ...request, since, busy: fullAccounts(store, request.agent) },
      readings,
      judged,
    );
    if (move.move) {
      const { task, from, trigger } = request;
      const row = { task, from, to: move.account.name, reason: move.reason, trigger, candidates: [...move.candidates] };
      recordChoice(store, { readings, judged }, row);
    }
    return { ok: true, value: move };
  });
