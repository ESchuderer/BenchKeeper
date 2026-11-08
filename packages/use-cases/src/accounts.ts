import { join } from "node:path";
import { counted, isConfirmed, type Move, type Selection, selectAccount, selectMove } from "@cedarloom/accounts";
import {
  ACCOUNTS_SCHEMA_VERSION,
  AccountRegistry,
  type AccountSwitch,
  Agent,
  type Quota,
  type Reading,
  type Result,
  readDocument,
} from "@cedarloom/contracts";
import type { RunStore } from "@cedarloom/ledger";
import { readOptionalJson, withStore, withView } from "./use-cases.ts";

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

/** A window of an account as claude-swap's switch target answers it: times with any offset, null when not known. */
export interface SwapWindow {
  readonly window: Quota;
  readonly usedPercent: number;
  readonly resetsAt: string | null;
  readonly readAt: string | null;
}

// A time with any offset as the ledger compares it: UTC with milliseconds.
const utc = (time: string): string => new Date(time).toISOString();

/**
 * Keeps claude-swap's windows of `account` as its readings, next to the workers' own: the newest per window counts. A
 * window without a read time (claude-swap's row was not ok, so it no longer trusts that share) drops the stored
 * claude-swap reading of that window; a worker's stays. Returns how many were kept.
 */
export const keepSwapReadings = (state: string, account: string, windows: readonly SwapWindow[]): Result<number> =>
  withStore(state, (store) => {
    let kept = 0;
    for (const { window, usedPercent, resetsAt, readAt } of windows) {
      if (readAt === null) {
        store.dropReading({ account, window, source: "cswap" });
        continue;
      }
      const reset = resetsAt === null ? null : utc(resetsAt);
      store.recordReading({ account, window, usedPercent, resetsAt: reset, readAt: utc(readAt), source: "cswap" });
      kept += 1;
    }
    return { ok: true, value: kept };
  });

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

/**
 * The readings a choice at `now` counts, and per confirmed pool the account a new worker would start on, leases and the
 * worker's model aside. Nothing is recorded; a state folder without a store has no readings.
 */
export const accountsStatus = (
  state: string,
  registry: AccountRegistry | null,
  now?: number,
): Result<{ readings: Reading[]; pools: { agent: Agent; pool: string; selection: Selection }[] }> =>
  withView(state, (view) => {
    const judged = now ?? Date.now();
    const readings = counted(view?.readings() ?? [], judged);
    const pools = Agent.options.flatMap((agent) =>
      Object.keys(registry?.pools[agent] ?? {}).flatMap((pool) =>
        registry !== null && isConfirmed(registry, { agent, pool })
          ? [{ agent, pool, selection: selectAccount(registry, { agent, pool }, readings, judged) }]
          : [],
      ),
    );
    return { ok: true, value: { readings, pools } };
  });
