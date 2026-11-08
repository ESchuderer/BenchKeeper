import {
  type ActionContext,
  allowed,
  type DoctorFinding,
  jsonAnswer,
  olderRelease,
  type ProgramVersion,
  programVersion,
  shellWord,
  valueAt as at,
} from "@cedarloom/extension-sdk";

/** The claude-swap version whose JSON this extension and its recorded test outputs were checked with; older is not read. */
export const OBSERVED = "0.30.0";
// `--version` answers at once. list, status and switch may fetch usage with claude-swap's own 10 s timeouts and refresh
// a login, whose grant the server consumes: stopped mid-refresh, the new token can be lost, so they get more time.
const MS = 3000;
const FETCH_MS = 30_000;

type Exec = Pick<ActionContext, "exec">;
// Rows claude-swap cannot use until the user logs in again (`relogin_required`) or adds a login (`no_credentials`).
const HELD = new Set(["relogin_required", "no_credentials"]);
const held = (row: unknown): boolean => HELD.has(String(at(row, "usageStatus")));
// The settings of claude-swap's auto mode, the only ones CedarLoom shows or sets: others, such as run.shareHistory,
// change how claude-swap runs Claude Code itself (switching plan 14.3).
const AUTO_SETTINGS = "autoswitch.";

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const textOr = (value: unknown, otherwise: string | null): string | null =>
  typeof value === "string" ? value : otherwise;

/** Its version from `cswap --version` ("cswap 0.30.0"), or why it is not installed here. */
const probeOf = async ({ exec }: Exec): Promise<ProgramVersion> => {
  const found = await programVersion(exec, "cswap", MS);
  return found.installed ? { installed: true, version: found.version.replace(/^cswap\s+/, "") } : found;
};

// claude-swap's messages can name an account's email; no identity leaves the extension (switching plan 1.5).
const withoutEmails = (text: string): string =>
  text
    .split(" ")
    .map((word) => (word.includes("@") ? "<email>" : word))
    .join(" ");

/** claude-swap's JSON answer to a command: one object of schemaVersion 1; its error envelope or another version throws. */
const cswap = async ({ exec }: Exec, args: string[], timeoutMs = FETCH_MS): Promise<unknown> => {
  const command = `cswap ${args.join(" ")}`;
  const ran = await exec({ program: "cswap", args: [...args, "--json"], timeoutMs });
  const answer = jsonAnswer(command, ran);
  const message = at(answer, "error", "message");
  if (typeof message === "string") throw new Error(`${command}: ${withoutEmails(message)}`);
  if (ran.code !== 0) throw new Error(`${command} exited with ${ran.code}`);
  const version = at(answer, "schemaVersion");
  if (version !== 1) throw new Error(`${command} answered schemaVersion ${String(version)}, not 1`);
  return answer;
};

// A model's own weekly window, such as `sevenDay:fable`; a name of another form is left out.
const scopedName = (name: unknown): string | undefined =>
  typeof name === "string" && /^[A-Za-z]{1,20}$/.test(name) ? `sevenDay:${name.toLowerCase()}` : undefined;

/**
 * A window of an account: a share in percent, when it resets, and when claude-swap read it (null: it no longer trusts
 * that share).
 */
type Window = { window: string; usedPercent: number; resetsAt: string | null; readAt: string | null };

/**
 * An account's windows. claude-swap trusts a row's usage only while its `usageStatus` is `ok`: a row it no longer
 * trusts gives its last good windows without a read time.
 */
const windowsOf = (row: unknown): Window[] => {
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
  // Without last good windows, the two every account has, unread.
  const unread = ["fiveHour", "sevenDay"].map((window) => ({ window, usedPercent: 0, resetsAt: null, readAt: null }));
  return trusted || windows.length > 0 ? windows.slice(0, 16) : unread;
};

// A short plain alias only: claude-swap's aliases are the user's own text.
const ALIAS = /^[a-z0-9_-]{1,32}$/;

/**
 * An account by its number, with its alias if any and its switch line in percent if any; `held`: claude-swap starts
 * nothing on it until the user logs in again. A row without a number is left out. No email leaves the extension.
 */
type Account = {
  number: number;
  alias?: string;
  active: boolean;
  disabled: boolean;
  held: boolean;
  threshold: number | null;
  windows: Window[];
};
const accountOf = (row: unknown): Account[] => {
  const [number, alias, threshold] = [at(row, "number"), at(row, "alias"), at(row, "threshold")];
  if (!Number.isInteger(number) || Number(number) < 1) return [];
  return [
    {
      number: Number(number),
      ...(typeof alias === "string" && ALIAS.test(alias) ? { alias } : {}),
      active: at(row, "active") === true,
      disabled: at(row, "disabled") === true,
      held: held(row),
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

// Why a version is not one this extension reads; none when it is.
const versionProblem = (version: string): string | undefined => {
  const older = olderRelease(version, OBSERVED);
  if (older === undefined) return `claude-swap's version ${version} does not read`;
  return older ? `claude-swap ${version} is older than ${OBSERVED}` : undefined;
};

/** The list action: claude-swap's accounts with their usage, from `cswap list --json`. */
export const list = async (context: Exec): Promise<{ accounts: Account[] }> => ({
  accounts: (await rowsOf(context)).flatMap(accountOf).slice(0, 64),
});

// claude-swap's account numbers as a user types them.
const NUMBER = /^[1-9]\d{0,5}$/;

/**
 * The switch action: interactive sessions, and new workers, use claude-swap's account `account` (its number), switched by
 * `cswap switch`, which it runs only once the user names cswap with `--allow`. A switch waits on Claude Code's locks,
 * about 18 s at most (switching plan 1.5).
 */
export const switchTo = async ({
  exec,
  config,
  inputs,
}: Pick<ActionContext, "exec" | "config" | "inputs">): Promise<Record<string, unknown>> => {
  const given = inputs["account"];
  const number = typeof given === "string" ? given : "";
  if (!NUMBER.test(number)) throw new Error(`not a claude-swap account number: ${withoutEmails(number).slice(0, 40)}`);
  const runs = `cswap switch ${number}`;
  if (!allowed(config, "cswap")) {
    return { runs, approve: `cedarloom claude-swap switch --account ${number} --allow cswap` };
  }
  const answer = await cswap({ exec }, ["switch", number], VERB_MS);
  const [from, to] = [at(answer, "from", "number"), at(answer, "to", "number")];
  if (typeof to !== "number") throw new Error(`${runs} named no account it switched to`);
  return { switched: at(answer, "switched") === true, ...(typeof from === "number" ? { from } : {}), to };
};

/**
 * The settings action: claude-swap's auto mode settings (`cswap config`). With `key` and `value`, it sets one first
 * through `cswap config set`, which checks it, only once the user names cswap with `--allow`.
 */
export const settings = async ({
  exec,
  config,
  inputs,
}: Pick<ActionContext, "exec" | "config" | "inputs">): Promise<Record<string, unknown>> => {
  const [key, value] = [inputs["key"], inputs["value"]];
  if (key !== undefined || value !== undefined) {
    if (typeof key !== "string" || typeof value !== "string") throw new Error("a setting needs both key and value");
    if (!key.startsWith(AUTO_SETTINGS))
      throw new Error(`${key} is not one of claude-swap's ${AUTO_SETTINGS}* settings`);
    if (!allowed(config, "cswap")) {
      // Quoted only where a shell needs it, so the line pastes into cmd.exe too, where single quotes stay.
      const [k, v] = [key, value].map((word) => (/^[\w.@%+=:,/-]+$/.test(word) ? word : shellWord(word)));
      return {
        runs: `cswap config set -- ${k} ${v}`,
        approve: `cedarloom claude-swap settings --key ${k} --value ${v} --allow cswap`,
      };
    }
    // After --, a value that starts with - stays a value.
    const ran = await exec({ program: "cswap", args: ["config", "set", "--", key, value], timeoutMs: MS });
    const why = withoutEmails(ran.stderr.trim().split("\n")[0] ?? "").slice(0, 300);
    if (ran.code !== 0) throw new Error(`cswap config set ${key} exited with ${ran.code}: ${why}`);
  }
  const listed = at(await cswap({ exec }, ["config"]), "settings");
  const values = (Array.isArray(listed) ? listed : []).flatMap((setting): [string, string | number | boolean][] => {
    const [name, kept] = [at(setting, "key"), at(setting, "value")];
    const plain = typeof kept === "string" || typeof kept === "number" || typeof kept === "boolean";
    return typeof name === "string" && name.startsWith(AUTO_SETTINGS) && plain ? [[name, kept]] : [];
  });
  return { settings: Object.fromEntries(values) };
};

const finding = (severity: DoctorFinding["severity"], code: string, message: string): DoctorFinding => ({
  check: "claude-swap",
  severity,
  code,
  message,
});

// An account claude-swap holds until the user logs in with it and adds that login again.
const reloginOf = (row: unknown): DoctorFinding => {
  const alias = at(row, "alias");
  const name = `account ${String(at(row, "number"))}${typeof alias === "string" ? ` (${alias})` : ""}`;
  const step = `log in with it, then run cswap add --slot ${String(at(row, "number"))}`;
  return finding("warning", "claude-swap.relogin", `claude-swap needs a new login for ${name}: ${step}.`);
};

/**
 * The doctor's check, with two calls (`--version` and `list`, whose JSON schema it checks): without claude-swap, or with
 * one whose JSON this extension does not read, no account switches and every session runs on the default home's login;
 * an account whose login died is named with its fix.
 */
export const doctor = async (context: Exec): Promise<DoctorFinding[]> => {
  const off = "no account switches, and every session runs on the default home's login";
  const unsupported = (detail: string) => [finding("warning", "claude-swap.unsupported", `${detail}: ${off}.`)];
  try {
    const found = await probeOf(context);
    if (!found.installed) return [finding("info", "claude-swap.missing", `claude-swap is not installed here: ${off}.`)];
    const problem = versionProblem(found.version);
    if (problem !== undefined) return unsupported(problem);
    const rows = await rowsOf(context);
    const ready = finding("info", "claude-swap.ready", `claude-swap ${found.version} manages ${rows.length} accounts.`);
    return [ready, ...rows.filter((row) => held(row)).map(reloginOf)];
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

// As a shell would need it, to copy.
const lineOf = (words: string[]): string => words.map((word) => (/[[>]/.test(word) ? `'${word}'` : word)).join(" ");
// The claude-swap release an install pins, the one this extension reads (coordinator, 2026-11-07); on macOS with the
// menu bar, which runs claude-swap's own auto mode as a service (switching plan 14.3).
const specOf = (platform: string): string => `claude-swap${platform === "darwin" ? "[menubar]" : ""}==${OBSERVED}`;
// The installers the host may run, in this order, and their install arguments. claude-swap needs Python 3.12 or newer,
// which uv finds or downloads when asked (the first python3 on the path can be older: macOS ships 3.9), and uv takes
// its dependencies as they were the day after the pin's release; pipx has no such option.
const INSTALLERS: [string, string[]][] = [
  ["uv", ["tool", "install", "--python", ">=3.12", "--exclude-newer", "2026-11-07T00:00:00Z"]],
  ["pipx", ["install"]],
];
// Below the minute a CLI verb's action has; claude-swap and the menu bar's packages download once.
const VERB_MS = 55_000;

/**
 * The install action: nothing to do while claude-swap is here; otherwise the command it runs, which it runs only once
 * the user names its program with `--allow` (an approval line; nothing installs unnamed).
 * shortcut: the approval rides in the action's config, which only a CLI verb sets today; a workflow node's `with` could
 * set it too, so a host-owned grant (as `initialize` carries `granted`) must carry it before workflows run actions.
 */
export const install = async (
  { exec, config }: Pick<ActionContext, "exec" | "config">,
  platform: string = process.platform,
): Promise<Record<string, unknown>> => {
  const found = await probeOf({ exec });
  if (found.installed) return { installed: true, version: found.version };
  for (const [program, args] of INSTALLERS) {
    if (!(await programVersion(exec, program, MS)).installed) continue;
    const spec = specOf(platform);
    const runs = lineOf([program, ...args, spec]);
    if (!allowed(config, program)) {
      return { installed: false, runs, approve: `cedarloom claude-swap install --allow ${program}` };
    }
    const ran = await exec({ program, args: [...args, spec], timeoutMs: VERB_MS });
    if (ran.code !== 0) throw new Error(`${runs} exited with ${ran.code}: ${ran.stderr.trim().slice(-500)}`);
    const now = await probeOf({ exec });
    if (!now.installed) throw new Error(`${runs} ran, and cswap is still not found: ${now.reason}`);
    return { installed: true, version: now.version };
  }
  throw new Error(
    "neither uv nor pipx is installed: install uv first (https://docs.astral.sh/uv/getting-started/installation/)",
  );
};

// claude-swap's own auto mode runs in its macOS menu bar service; CedarLoom writes no service, plist or crontab.
const elsewhere = (platform: string): string =>
  platform === "win32"
    ? "run cswap auto in a terminal; claude-swap has no service on Windows"
    : "run cswap auto in a terminal, or from cron: */5 * * * * cswap auto --once --json >> ~/.cswap-auto.log";
const TOGGLE = "turn on Settings, Auto-switch accounts in the menu bar once; CedarLoom never writes that setting";
const MISSING = "claude-swap is not installed: cedarloom claude-swap install";
const [UV, UV_ARGS] = INSTALLERS[0] ?? ["uv", []];
// claude-swap's service starts its menu bar at each login, which needs its menubar extra; without it, it exits and
// launchd restarts it again and again.
const NO_MENU_BAR = `claude-swap's menu bar (claude-swap[menubar]) is not confirmed: add it with ${lineOf([UV, ...UV_ARGS, "--force", specOf("darwin")])}, or ${elsewhere("darwin")}`;

// Whether claude-swap has its menu bar, as uv lists a tool's extras ("claude-swap v0.30.0 [extras: menubar]").
// shortcut: a pipx install or one by hand is never confirmed and gets the hint; read pipx's metadata once checked.
const menuBarOf = async ({ exec }: Exec): Promise<boolean> => {
  const ran = await exec({ program: UV, args: ["tool", "list", "--show-extras"], timeoutMs: MS }).catch(() => null);
  const line = ran?.code === 0 ? ran.stdout.split("\n").find((each) => each.startsWith("claude-swap v")) : undefined;
  return (line?.split("[extras: ")[1]?.split("]")[0]?.split(", ") ?? []).includes("menubar");
};

// What `cswap menubar <flag>` says first, such as "Menu bar service: running (pid 4242)"; it has no JSON form.
const serviceOf = async ({ exec }: Exec, flag: string): Promise<string> => {
  const ran = await exec({ program: "cswap", args: ["menubar", flag], timeoutMs: FETCH_MS });
  if (ran.code !== 0) throw new Error(`cswap menubar ${flag} exited with ${ran.code}`);
  return ran.stdout.trim().split("\n")[0] ?? "";
};

/** Whether claude-swap's menu bar service runs, which hosts its auto mode on macOS; elsewhere how to run auto mode. */
export const auto = async (context: Exec, platform: string = process.platform): Promise<Record<string, unknown>> => {
  if (platform !== "darwin") return { hint: elsewhere(platform) };
  if (!(await probeOf(context)).installed) return { hint: MISSING };
  const hint = (await menuBarOf(context)) ? TOGGLE : NO_MENU_BAR;
  return { service: await serviceOf(context, "--service-status"), hint };
};

// Installs or removes the menu bar service through claude-swap, only once the user names cswap with --allow. `needs`:
// what the service starts, which must be there first.
const serviceChange =
  (flag: string, verb: string, after: string, needs: string | null) =>
  async (
    { exec, config }: Pick<ActionContext, "exec" | "config">,
    platform: string = process.platform,
  ): Promise<Record<string, unknown>> => {
    if (platform !== "darwin") return { hint: elsewhere(platform) };
    if (!(await probeOf({ exec })).installed) return { hint: MISSING };
    if (needs !== null && !(await menuBarOf({ exec }))) return { hint: NO_MENU_BAR };
    const runs = `cswap menubar ${flag}`;
    const approve = `cedarloom claude-swap ${verb} --allow cswap`;
    if (!allowed(config, "cswap")) return { runs, approve, ...(needs === null ? {} : { hint: needs }) };
    return { service: await serviceOf({ exec }, flag), hint: after };
  };
/** The menu bar service installed, so claude-swap's auto mode can run without a terminal (switching plan 14.3). */
export const autoOn = serviceChange(
  "--install-service",
  "auto-on",
  TOGGLE,
  "the service starts claude-swap's menu bar (claude-swap[menubar], found) at each login",
);
/** The menu bar service removed. */
export const autoOff = serviceChange(
  "--uninstall-service",
  "auto-off",
  "claude-swap's auto mode no longer runs on its own",
  null,
);
