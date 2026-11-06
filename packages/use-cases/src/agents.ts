import type { AgentRuntime, ContractCheck, Launch, UsageWindow } from "@cedarloom/agent-contracts";
import { type Agent, AgentVersion, type ContractCheckRecord, type Result } from "@cedarloom/contracts";
import { withStore } from "./use-cases.ts";

// A failed check is repeated after a day: a probe on an account at its limit, a network drop, or a parser fixed in a
// later CedarLoom would otherwise keep a version's readings off for good.
const RETRY_FAILED_MS = 24 * 60 * 60 * 1000;

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
  /** Whether the check of `version` proved that the CLI applies the launch's settings; no worker starts without. */
  readonly settingsApplied: boolean;
}

// Whether a recorded check settles its version: a passed one always, a failed one for a day.
const settles = (check: ContractCheckRecord, now: number): boolean =>
  check.missing.length === 0 || now - Date.parse(check.at) < RETRY_FAILED_MS;

// The probes running in this process, by state folder, agent and version: launches on a new version share one.
// shortcut: per process; two CedarLoom processes launching on a new version at once still probe twice.
const probes = new Map<string, Promise<ContractCheck>>();
const probeOnce = (key: string, probe: () => Promise<ContractCheck>): Promise<ContractCheck> => {
  const running = probes.get(key) ?? probe().finally(() => probes.delete(key));
  probes.set(key, running);
  return running;
};

// The check is kept under the version the probe ran. When that is not the version read, an update came in between or
// the init line reports another form: the read version is kept without its init line, so it is not probed on every
// launch.
const records = (agent: Agent, version: string, check: ContractCheck): ContractCheckRecord[] => {
  const at = new Date().toISOString();
  const ran = check.version ?? version;
  const own = { agent, version: ran, missing: [...check.missing], at };
  return ran === version ? [own] : [own, { agent, version, missing: ["init"], at }];
};

const record = (state: string, agent: Agent, checks: readonly ContractCheckRecord[]): Result<ContractCheckRecord[]> =>
  withStore(state, (store) => {
    for (const check of checks) store.recordContractCheck(check);
    return { ok: true, value: store.contractChecks(agent) };
  });

/**
 * Reads the version of the agent CLI that `env` runs, before each launch, because the CLI updates itself (A100). On a
 * version without a check, or whose check failed a day ago or earlier, it runs the contract check outside the store's
 * lock, since the probe is a short agent session. Only the CLI's failures are `launch.agent-unavailable`; the store's
 * own errors are reported as they are.
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
  try {
    // Checked here for every adapter: a version of another form reaches neither a probe nor the ledger.
    const read = AgentVersion.safeParse(await runtime.version(env));
    if (!read.success) return unavailable(agent, new Error("unrecognized CLI version"));
    version = read.data;
  } catch (error) {
    return unavailable(agent, error);
  }
  let checks = withStore(state, (store) => ({ ok: true, value: store.contractChecks(agent) }));
  if (!checks.ok) return checks;
  const now = Date.now();
  if (!checks.value.some((each) => each.version === version && settles(each, now))) {
    let check: ContractCheck;
    try {
      check = await probeOnce(JSON.stringify([state, agent, version]), () => runtime.checkContract(probe));
    } catch (error) {
      return unavailable(agent, error);
    }
    checks = record(state, agent, records(agent, version, check));
    if (!checks.ok) return checks;
  }
  const verified = checks.value.filter((each) => each.missing.length === 0).map((each) => each.version);
  const settingsApplied = checks.value.some(
    (each) => each.version === version && !each.missing.includes("init") && !each.missing.includes("settings"),
  );
  return { ok: true, value: { version, verified, settingsApplied } };
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
