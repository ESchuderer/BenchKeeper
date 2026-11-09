import {
  type ActionContext,
  allowed,
  type DoctorFinding,
  HOST_MISSING,
  jsonAnswer,
  olderRelease,
  type ProgramVersion,
  programVersion,
  shellWord,
  valueAt as at,
} from "@cedarloom/extension-sdk";

/** The claude-swap version whose JSON this extension and its recorded test outputs were checked with; older is not read. */
export const OBSERVED = "1.0.0";
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

// Not installed is a starting state, not a failure: every action that needs claude-swap names its install.
const MISSING = "claude-swap is not installed: cedarloom claude-swap install";

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const textOr = (value: unknown, otherwise: string | null): string | null =>
  typeof value === "string" ? value : otherwise;

/** Its version from `cswap --version` ("cswap 1.0.0"), or why it is not installed here. */
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

// cswap run through the host, whose missing program becomes the install hint.
const runCswap = ({ exec }: Exec, args: string[], timeoutMs: number) =>
  exec({ program: "cswap", args, timeoutMs }).catch((error: unknown) => {
    throw at(error, "code") === HOST_MISSING ? new Error(MISSING) : error;
  });

/** claude-swap's JSON answer to a command: one object of schemaVersion 1; its error envelope or another version throws. */
const cswap = async (context: Exec, args: string[], timeoutMs = FETCH_MS): Promise<unknown> => {
  const command = `cswap ${args.join(" ")}`;
  const ran = await runCswap(context, [...args, "--json"], timeoutMs);
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
    const ran = await runCswap({ exec }, ["config", "set", "--", key, value], MS);
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
// The claude-swap release an install pins, the one this extension reads (coordinator, 2026-11-09); on macOS with the
// menu bar, which runs claude-swap's own auto mode as a service (switching plan 14.3).
const specOf = (platform: string): string => `claude-swap${platform === "darwin" ? "[menubar]" : ""}==${OBSERVED}`;
// Where an install downloads claude-swap from: PyPI, named in the command.
const INDEX = "https://pypi.org/simple";
const SOURCE = `https://pypi.org/project/claude-swap/${OBSERVED}/`;
// uv only (coordinator, 2026-11-09). claude-swap needs Python 3.12 or newer, which uv finds or downloads when asked (the
// first python3 on the path can be older: macOS ships 3.9); it reads no uv.toml, whose indexes would come before PyPI,
// and takes the dependencies as they were the day after the pin's release (1.0.0: 2026-11-07T14:52Z).
const UV_ARGS = [
  ..."tool install --no-config --default-index".split(" "),
  INDEX,
  ..."--python >=3.12 --exclude-newer 2026-11-08T00:00:00Z".split(" "),
];
// What else the install fetches, which the approval shows: rumps 0.4.0, which the menu bar needs, is on PyPI only as a
// source archive, so uv builds it.
const fetchesOf = (platform: string): string =>
  `uv takes claude-swap's dependencies from PyPI as they were on 2026-11-08${platform === "darwin" ? ", builds rumps 0.4.0 (the menu bar) from its source archive, which runs its setup code and fetches setuptools," : ""} and downloads a Python 3.12 or newer build from releases.astral.sh (python-build-standalone) when none is installed.`;
// Below the minute a CLI verb's action has; claude-swap and the menu bar's packages download once.
const VERB_MS = 55_000;

/**
 * The install action: nothing to do while claude-swap is here; otherwise uv's command, with the release it pins, where
 * it downloads it from and what else it fetches. It runs it only once the user names uv with `--allow` (an approval
 * line; nothing installs unnamed) and, given `approved`, only that very command.
 */
export const install = async (
  { exec, config, inputs = {} }: Pick<ActionContext, "exec" | "config"> & Partial<Pick<ActionContext, "inputs">>,
  platform: string = process.platform,
): Promise<Record<string, unknown>> => {
  const found = await probeOf({ exec });
  if (found.installed) return { installed: true, version: found.version };
  if (!(await programVersion(exec, "uv", MS)).installed) {
    throw new Error("uv is not installed: install uv first (https://docs.astral.sh/uv/getting-started/installation/)");
  }
  const args = [...UV_ARGS, specOf(platform)];
  const runs = lineOf(["uv", ...args]);
  // A command other than the approved one, as after CedarLoom's pin moved, is shown to approve again.
  const { approved = runs } = inputs;
  if (!allowed(config, "uv") || approved !== runs) {
    const [approve, hint] = ["cedarloom claude-swap install --allow uv", fetchesOf(platform)];
    return { installed: false, runs, approve, installer: "uv", source: SOURCE, release: OBSERVED, hint };
  }
  const ran = await exec({ program: "uv", args, timeoutMs: VERB_MS });
  if (ran.code !== 0) throw new Error(`${runs} exited with ${ran.code}: ${ran.stderr.trim().slice(-500)}`);
  const now = await probeOf({ exec });
  if (!now.installed) throw new Error(`${runs} ran, and cswap is still not found: ${now.reason}`);
  return { installed: true, version: now.version };
};

// claude-swap's own auto mode runs in its macOS menu bar service; CedarLoom writes no service, plist or crontab.
const elsewhere = (platform: string): string =>
  platform === "win32"
    ? "run cswap auto in a terminal; claude-swap has no service on Windows"
    : "run cswap auto in a terminal, or from cron: */5 * * * * cswap auto --once --json >> ~/.cswap-auto.log";
// claude-swap's service starts its menu bar at each login, which needs its menubar extra; without it, it exits and
// launchd restarts it again and again.
const NO_MENU_BAR = `claude-swap's menu bar (claude-swap[menubar]) is not confirmed: add it with ${lineOf(["uv", ...UV_ARGS, "--force", specOf("darwin")])}, or ${elsewhere("darwin")}`;
const NO_SERVICE = "claude-swap's menu bar service is not installed, so it switches no account on its own";
const STARTS = "the service starts claude-swap's menu bar (claude-swap[menubar], found) at each login";

// Whether claude-swap has its menu bar, as uv lists a tool's extras ("claude-swap v1.0.0 [extras: menubar]").
// shortcut: an install by hand is never confirmed and gets the hint; read its metadata if such installs show up.
const menuBarOf = async ({ exec }: Exec): Promise<boolean> => {
  const ran = await exec({ program: "uv", args: ["tool", "list", "--show-extras"], timeoutMs: MS }).catch(() => null);
  const line = ran?.code === 0 ? ran.stdout.split("\n").find((each) => each.startsWith("claude-swap v")) : undefined;
  return (line?.split("[extras: ")[1]?.split("]")[0]?.split(", ") ?? []).includes("menubar");
};

/**
 * What `cswap menubar <args>` says first, such as "Menu bar service: running (pid 4242)", and whether the menu bar
 * switches accounts: claude-swap prints "auto-switch: on" on stdout, "auto-switch: off -- ..." on stderr, and neither
 * while no service is installed. It has no JSON form.
 */
const serviceOf = async ({ exec }: Exec, args: string[]): Promise<{ service: string; autoSwitch?: boolean }> => {
  const ran = await exec({ program: "cswap", args: ["menubar", ...args], timeoutMs: FETCH_MS });
  if (ran.code !== 0) throw new Error(`cswap menubar ${args.join(" ")} exited with ${ran.code}`);
  const [on, off] = [/^\s*auto-switch: on$/m.test(ran.stdout), /^\s*auto-switch: off\b/m.test(ran.stderr)];
  return { service: ran.stdout.trim().split("\n")[0] ?? "", ...(on || off ? { autoSwitch: on } : {}) };
};

/** Whether claude-swap's menu bar service runs and switches accounts, its auto mode on macOS; elsewhere how to run it. */
export const auto = async (context: Exec, platform: string = process.platform): Promise<Record<string, unknown>> => {
  if (platform !== "darwin") return { hint: elsewhere(platform) };
  if (!(await probeOf(context)).installed) return { hint: MISSING };
  const said = await serviceOf(context, ["--service-status"]);
  return (await menuBarOf(context)) ? said : { ...said, hint: NO_MENU_BAR };
};

// Why auto switching cannot change here, or null: not macOS, no claude-swap, no menu bar, or for off no service.
const unchangeable = async (context: Exec, platform: string, on: boolean): Promise<string | null> => {
  if (platform !== "darwin") return elsewhere(platform);
  if (!(await probeOf(context)).installed) return MISSING;
  if (!(await menuBarOf(context))) return NO_MENU_BAR;
  return on || (await serviceOf(context, ["--service-status"])).autoSwitch !== undefined ? null : NO_SERVICE;
};

/**
 * Turns the menu bar's auto switching on or off with claude-swap's own command, only once the user names cswap with
 * `--allow`. On installs the service too, which starts the menu bar at each login; off applies only where a service is
 * installed, as `cswap menubar` sets one up first otherwise. Either restarts a running menu bar, which reads the switch
 * once at launch.
 */
const autoSwitch =
  (on: boolean) =>
  async (
    { exec, config }: Pick<ActionContext, "exec" | "config">,
    platform: string = process.platform,
  ): Promise<Record<string, unknown>> => {
    const hint = await unchangeable({ exec }, platform, on);
    if (hint !== null) return { hint };
    const args = on ? ["--install-service", "--auto-switch"] : ["--no-auto-switch"];
    const [runs, approve] = [
      `cswap menubar ${args.join(" ")}`,
      `cedarloom claude-swap auto-${on ? "on" : "off"} --allow cswap`,
    ];
    if (!allowed(config, "cswap")) return { runs, approve, ...(on ? { hint: STARTS } : {}) };
    return serviceOf({ exec }, args);
  };
/** Auto switching on: the menu bar service installed with its auto-switch on (switching plan 14.3). */
export const autoOn = autoSwitch(true);
/** Auto switching off: the menu bar keeps showing usage and switches no account. */
export const autoOff = autoSwitch(false);
