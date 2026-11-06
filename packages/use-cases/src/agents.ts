import type { AgentRuntime, ContractCheck, Launch, UsageWindow } from "@cedarloom/agent-contracts";
import type { Agent, ContractCheckRecord, Result } from "@cedarloom/contracts";
import { withStore } from "./use-cases.ts";

const unavailable = (agent: Agent, error: unknown): Result<never> => ({
  ok: false,
  finding: {
    code: "launch.agent-unavailable",
    params: { agent, error: error instanceof Error ? error.message : "unknown error" },
  },
});

export interface CheckedVersions {
  /** The version the launch's environment runs now. */
  readonly version: string;
  /** The versions whose contract check passed: the launch's verifiedVersions. */
  readonly verified: readonly string[];
}

const record = (state: string, check: ContractCheckRecord): Result<ContractCheckRecord[]> =>
  withStore(state, (store) => {
    store.recordContractCheck(check);
    return { ok: true, value: store.contractChecks(check.agent) };
  });

/**
 * Reads the version of the agent CLI that `env` runs, before each launch, because the CLI updates itself (A100). On a
 * version without a recorded check, it runs the contract check outside the store's lock, since the probe is a short
 * agent session, and records it under the version the probe ran. A version whose check failed is not checked again.
 */
export const checkedVersions = async <L extends Launch>(
  state: string,
  agent: Agent,
  runtime: AgentRuntime<L>,
  {
    env,
    probe,
  }: { readonly env: Readonly<Record<string, string>>; readonly probe: Omit<L, "prompt" | "verifiedVersions"> },
): Promise<Result<CheckedVersions>> => {
  let version: string;
  let check: ContractCheck | null = null;
  try {
    version = await runtime.version(env);
    const known = withStore(state, (store) => ({ ok: true, value: store.contractChecks(agent) }));
    if (!known.ok) return known;
    if (!known.value.some((each) => each.version === version)) check = await runtime.checkContract(probe);
    const checks =
      check === null
        ? known
        : record(state, {
            agent,
            version: check.version ?? version,
            missing: [...check.missing],
            at: new Date().toISOString(),
          });
    if (!checks.ok) return checks;
    return {
      ok: true,
      value: {
        version,
        verified: checks.value.filter((each) => each.missing.length === 0).map((each) => each.version),
      },
    };
  } catch (error) {
    return unavailable(agent, error);
  }
};

/**
 * Stores the usage windows a session reported for its account as the latest readings: only windows with an
 * agent-neutral name, a share and a reset time. The adapter reports usage only on versions whose check passed.
 */
export const recordUsage = (
  state: string,
  account: string,
  windows: readonly UsageWindow[],
  readAt: string = new Date().toISOString(),
): Result<number> =>
  withStore(state, (store) => {
    const readings = windows.flatMap(({ quota, percent, resetsAt }) =>
      quota === null || percent === null || resetsAt === null
        ? []
        : [{ account, window: quota, usedPercent: percent, resetsAt, readAt }],
    );
    for (const reading of readings) store.recordReading(reading);
    return { ok: true, value: readings.length };
  });
