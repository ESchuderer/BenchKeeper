import {
  type ActionContext,
  type DoctorFinding,
  type ProgramVersion,
  programVersion,
  type TargetAccount,
  type TargetHandlers,
  type TargetProbe,
  type TargetWindow,
  valueAt as at,
} from "@cedarloom/extension-sdk";

/** The claude-swap version whose JSON this extension and its recorded test outputs were checked with; older is not read. */
export const OBSERVED = "0.30.0";
// Below the doctor's 10 s for its three calls: claude-swap answers list and status from its usage cache.
const MS = 3000;

type Exec = Pick<ActionContext, "exec">;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const textOr = (value: unknown, otherwise: string | null): string | null =>
  typeof value === "string" ? value : otherwise;
const releaseOf = (version: string): number[] | undefined => /^(\d+)\.(\d+)\.(\d+)/.exec(version)?.slice(1).map(Number);
// Whether a release is older than another, part by part.
const older = (release: number[], than: number[]): boolean => {
  const step = release.findIndex((part, index) => part !== than[index]);
  return step !== -1 && (release[step] ?? 0) < (than[step] ?? 0);
};

/** Its version from `cswap --version` ("cswap 0.30.0"), or why it is not installed here. */
const probeOf = async ({ exec }: Exec): Promise<ProgramVersion> => {
  const found = await programVersion(exec, "cswap", MS);
  return found.installed ? { installed: true, version: found.version.replace(/^cswap\s+/, "") } : found;
};

/** claude-swap's JSON answer to a command: one object of schemaVersion 1; its error envelope or another version throws. */
const cswap = async ({ exec }: Exec, args: string[]): Promise<unknown> => {
  const command = `cswap ${args.join(" ")}`;
  const { code, stdout } = await exec({ program: "cswap", args: [...args, "--json"], timeoutMs: MS });
  let answer: unknown;
  try {
    answer = JSON.parse(stdout);
  } catch (error) {
    // A failing run's exit code says more than its empty output.
    throw new Error(code === 0 ? `${command}: no JSON answer` : `${command} exited with ${code}`, { cause: error });
  }
  const message = at(answer, "error", "message");
  if (typeof message === "string") throw new Error(`${command}: ${message}`);
  if (code !== 0) throw new Error(`${command} exited with ${code}`);
  const version = at(answer, "schemaVersion");
  if (version !== 1) throw new Error(`${command} answered schemaVersion ${String(version)}, not 1`);
  return answer;
};

// A model's own weekly window, as CedarLoom names it (`sevenDay:fable`); a name it cannot hold is left out.
const scopedName = (name: unknown): string | undefined =>
  typeof name === "string" && /^[A-Za-z]{1,20}$/.test(name) ? `sevenDay:${name.toLowerCase()}` : undefined;

/**
 * An account's windows. claude-swap trusts a row's usage only while its `usageStatus` is `ok`: a row it no longer
 * trusts gives its last good windows without a read time, so CedarLoom drops what it kept of them.
 */
const windowsOf = (row: unknown): TargetWindow[] => {
  const trusted = at(row, "usageStatus") === "ok";
  const usage = trusted ? at(row, "usage") : at(row, "lastGoodUsage");
  const readAt = trusted ? textOr(at(row, "usageFetchedAt"), null) : null;
  const scoped = at(usage, "scoped");
  const named: [string | undefined, unknown][] = [
    ["fiveHour", at(usage, "fiveHour")],
    ["sevenDay", at(usage, "sevenDay")],
    ...(Array.isArray(scoped) ? scoped : []).map((entry): [string | undefined, unknown] => [
      scopedName(at(entry, "name")),
      entry,
    ]),
  ];
  const windows = named.flatMap(([window, entry]) => {
    const pct = at(entry, "pct");
    if (window === undefined || typeof pct !== "number") return [];
    const resetsAt = textOr(at(entry, "resetsAt"), null);
    return [{ window, usedPercent: Math.min(100, Math.max(0, pct)), resetsAt, readAt }];
  });
  // Without last good windows, the two every account has, unread, still drop what CedarLoom kept.
  const unread = ["fiveHour", "sevenDay"].map((window) => ({ window, usedPercent: 0, resetsAt: null, readAt: null }));
  return trusted || windows.length > 0 ? windows.slice(0, 16) : unread;
};

// Only an alias that can be a CedarLoom account's name links one (switching plan 1.6).
const ALIAS = /^[a-z0-9_-]{1,32}$/;

// An account by its number; a row without one is left out, so the host takes the rest of the answer.
const accountOf = (row: unknown): TargetAccount[] => {
  const [number, alias, threshold] = [at(row, "number"), at(row, "alias"), at(row, "threshold")];
  if (!Number.isInteger(number) || Number(number) < 1) return [];
  return [
    {
      number: Number(number),
      ...(typeof alias === "string" && ALIAS.test(alias) ? { alias } : {}),
      active: at(row, "active") === true,
      disabled: at(row, "disabled") === true,
      threshold: typeof threshold === "number" && threshold >= 0 && threshold <= 100 ? threshold : null,
      windows: windowsOf(row),
    },
  ];
};

const rowsOf = async (context: Exec): Promise<unknown[]> => {
  const rows = at(await cswap(context, ["list"]), "accounts");
  if (!Array.isArray(rows)) throw new Error("cswap list --json lists no accounts");
  return rows;
};

/** Whether the claude-swap found is a version whose JSON this extension reads, and why not. */
const judged = async (context: Exec, found: ProgramVersion): Promise<TargetProbe> => {
  if (!found.installed) return { status: "unsupported", detail: `claude-swap is not installed: ${found.reason}` };
  const release = releaseOf(found.version);
  if (release === undefined)
    return { status: "unsupported", detail: `claude-swap's version ${found.version} does not read` };
  if (older(release, releaseOf(OBSERVED) ?? [])) {
    return { status: "unsupported", detail: `claude-swap ${found.version} is older than ${OBSERVED}` };
  }
  try {
    await cswap(context, ["status"]);
  } catch (error) {
    return { status: "unsupported", detail: messageOf(error) };
  }
  return { status: "supported", detail: `claude-swap ${found.version}` };
};

/** The switch target `interactive`: the default home's account, which claude-swap switches. */
export const targets: TargetHandlers = {
  "target/probe": async (_params, context) => judged(context, await probeOf(context)),
  "target/accounts": async (_params, context) => ({
    accounts: (await rowsOf(context)).flatMap(accountOf).slice(0, 64),
  }),
  "target/current": async (_params, context) => {
    const active = at(await cswap(context, ["status"]), "active");
    const number = at(active, "number");
    return { number: at(active, "managed") === true && typeof number === "number" ? number : null };
  },
};

const finding = (severity: DoctorFinding["severity"], code: string, message: string): DoctorFinding => ({
  check: "claude-swap",
  severity,
  code,
  message,
});

// An account claude-swap no longer fetches until its login is renewed (its usageStatus `relogin_required`).
const reloginOf = (row: unknown): DoctorFinding => {
  const alias = at(row, "alias");
  const name = `account ${String(at(row, "number"))}${typeof alias === "string" ? ` (${alias})` : ""}`;
  const step = `log in with it, then run cswap add --slot ${String(at(row, "number"))}`;
  return finding("warning", "claude-swap.relogin", `claude-swap needs a new login for ${name}: ${step}.`);
};

/**
 * The doctor's check: without claude-swap, or with one whose JSON this extension does not read, multi-account switching
 * is off and workers run on one account; an account whose login died is named with its fix.
 */
export const doctor = async (context: Exec): Promise<DoctorFinding[]> => {
  const off = "multi-account switching is off, and workers run on one account";
  const unsupported = (detail: string) => [finding("warning", "claude-swap.unsupported", `${detail}: ${off}.`)];
  try {
    const found = await probeOf(context);
    if (!found.installed) return [finding("info", "claude-swap.missing", `claude-swap is not installed here: ${off}.`)];
    const probed = await judged(context, found);
    if (probed.status !== "supported") return unsupported(probed.detail);
    const rows = await rowsOf(context);
    const ready = finding("info", "claude-swap.ready", `${probed.detail} manages ${rows.length} accounts.`);
    return [ready, ...rows.filter((row) => at(row, "usageStatus") === "relogin_required").map(reloginOf)];
  } catch (error) {
    return unsupported(messageOf(error));
  }
};

/** The status action: whether claude-swap is installed, its version, its accounts and the active one. */
export const status = async (context: Exec): Promise<Record<string, unknown>> => {
  const found = await probeOf(context);
  if (!found.installed) return { installed: false };
  const rows = await rowsOf(context);
  const active = rows.find((row) => at(row, "active") === true);
  return {
    installed: true,
    version: found.version,
    accounts: rows.length,
    ...(active === undefined ? {} : { active: Number(at(active, "number")) }),
  };
};
