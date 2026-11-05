import { type Selection, selectAccount } from "@cedarloom/accounts";
import type { AccountRegistry, Agent, Result } from "@cedarloom/contracts";
import { withStore } from "./use-cases.ts";

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
  now: number = Date.now(),
): Result<Selection> =>
  withStore(state, (store) => {
    const readings = store.readings();
    const selection = selectAccount(registry, request, readings, now);
    if (selection.ok) {
      const pool = new Set(selection.candidates.map((candidate) => candidate.account));
      store.recordSwitch({
        task: request.task,
        from: request.previous,
        to: selection.account.name,
        readings: readings.filter((reading) => pool.has(reading.account)),
        candidates: [...selection.candidates],
      });
    }
    return { ok: true, value: selection };
  });
