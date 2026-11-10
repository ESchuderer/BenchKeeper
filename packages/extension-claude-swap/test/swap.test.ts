import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  auto,
  autoOff,
  autoOn,
  doctor,
  install,
  list,
  settings,
  status,
  switchTo,
} from "@cedarloom/extension-claude-swap";
import { type DoctorFinding, type ExecParams, type ExecResult, HOST_MISSING } from "@cedarloom/extension-sdk";
import { expect, test } from "vitest";

// claude-swap's own answers to --version, list --json and status --json, recorded with 0.30.0 and three of its
// accounts; emails, organizations and aliases replaced, and fields this extension does not read (plans, countdowns,
// pace) cut. 1.0.0 builds them alike: its json_output.py adds planDisplayName only, and its settings keys are the same.
const recorded = (name: string): string =>
  readFileSync(join(import.meta.dirname, "fixtures", "cswap-1.0.0", name), "utf8");
const LIST = recorded("list.json");
const OFF = "  auto-switch: off -- the menu bar shows usage but will not switch accounts; turn it on from the menu\n";
const RUNNING = "Menu bar service: running (pid 4242)\n  starts at login: yes\n  plist: /home/me/x.plist\n";
// What claude-swap 1.0.0 prints for its menu bar (cli.py: _menubar_service, _menubar_start), "auto-switch: off" on
// stderr; it has no JSON form. The service status by state, the changes by their first flag.
const MENUBAR: Record<string, Pick<ExecResult, "stdout" | "stderr">> = {
  none: { stdout: "Menu bar service is not installed.\nStart it with: cswap menubar\n", stderr: "" },
  on: { stdout: `${RUNNING}  auto-switch: on\n`, stderr: "" },
  off: { stdout: RUNNING, stderr: OFF },
  "--install-service": {
    stdout: "Menu bar service installed (com.cswap.menubar).\n  plist: /home/me/x.plist\n  auto-switch: on\n",
    stderr: "",
  },
  "--no-auto-switch": { stdout: "Menu bar restarted (pid 4243) to apply the auto-switch setting.\n", stderr: OFF },
};
// uv 0.13.7's tool list (uv tool list --show-extras) with claude-swap and its menu bar, and without.
const WITH_MENU_BAR = "claude-swap v1.0.0 [extras: menubar]\n- claude-swap\n- cswap\n";
const BARE = "claude-swap v1.0.0\n- claude-swap\n- cswap\n";
type Answers = { list?: string; status?: string; switch?: string; tools?: string; service?: "none" | "on" | "off" };
const menubar = (answers: Answers, flag: string): ExecResult => {
  const said = MENUBAR[flag === "--service-status" ? (answers.service ?? "none") : flag];
  return { code: 0, stdout: said?.stdout ?? "", stderr: said?.stderr ?? "" };
};
const cswap =
  (answers: Answers = {}, version = recorded("version.txt")) =>
  async ({ args = [] }: ExecParams): Promise<ExecResult> => {
    const [command = "", flag = ""] = args;
    if (command === "menubar") return menubar(answers, flag);
    const outputs: Record<string, () => string> = {
      "--version": () => version,
      list: () => answers.list ?? LIST,
      switch: () => (flag === "1" ? (answers.switch ?? "") : ""),
      config: () => (flag === "set" ? "" : recorded("config.json")),
      tool: () => answers.tools ?? WITH_MENU_BAR,
    };
    const stdout = outputs[command]?.() ?? answers.status ?? recorded("status.json");
    return { code: 0, stdout, stderr: "" };
  };
// The host's answer when none of the manifest's candidates is there.
const notFound = (program: string) =>
  Object.assign(new Error(`${program} is not installed: none of ${program} found`), { code: HOST_MISSING });
const missing = async (): Promise<ExecResult> => {
  throw notFound("cswap");
};
const accounts = async (exec: (request: ExecParams) => Promise<ExecResult>) => (await list({ exec })).accounts;
const codes = (findings: DoctorFinding[]) => findings.map(({ check, severity, code }) => [check, severity, code]);
// The recorded list with its first account's row changed.
const firstRow = (change: (row: Record<string, unknown>) => Record<string, unknown>): string => {
  const parsed: unknown = JSON.parse(LIST);
  const rows: unknown = Reflect.get(Object(parsed), "accounts");
  const [first, ...rest] = Array.isArray(rows) ? rows : [];
  return JSON.stringify({ ...Object(parsed), accounts: [change(Object(first)), ...rest] });
};

// The recorded first account, as the list answers it.
const WORK = {
  number: 1,
  alias: "work",
  active: false,
  disabled: false,
  held: false,
  threshold: null,
  windows: [
    {
      window: "fiveHour",
      usedPercent: 0,
      resetsAt: "2026-11-07T12:50:00.157763+00:00",
      readAt: "2026-11-07T11:14:00Z",
    },
    {
      window: "sevenDay",
      usedPercent: 63,
      resetsAt: "2026-11-07T15:00:00.157784+00:00",
      readAt: "2026-11-07T11:14:00Z",
    },
    {
      window: "sevenDay:fable",
      usedPercent: 3,
      resetsAt: "2026-11-07T15:00:00.157924+00:00",
      readAt: "2026-11-07T11:14:00Z",
    },
  ],
};

test("the list gives claude-swap's accounts by number with their windows and read times; a row it no longer trusts gives its windows without one", async () => {
  const listed = await accounts(cswap());
  const distrusted = firstRow(({ usage, alias: _alias, ...row }) => ({
    ...row,
    usageStatus: "token_expired",
    usage: null,
    lastGoodUsage: { ...Object(usage), scoped: [{ name: "Model 2", pct: 10, resetsAt: null }] },
    disabled: true,
    threshold: 85,
  }));
  expect([
    listed?.map(({ number, alias, active }) => [number, alias, active]),
    listed?.[0],
    (await accounts(cswap({ list: distrusted })))?.[0],
  ]).toEqual([
    [
      [1, "work", false],
      [2, "home", false],
      [3, "spare", true],
    ],
    WORK,
    {
      number: 1,
      active: false,
      disabled: true,
      held: false,
      threshold: 85,
      windows: [
        { window: "fiveHour", usedPercent: 0, resetsAt: "2026-11-07T12:50:00.157763+00:00", readAt: null },
        { window: "sevenDay", usedPercent: 63, resetsAt: "2026-11-07T15:00:00.157784+00:00", readAt: null },
      ],
    },
  ]);
});

test("a row without a number is left out, an alias that is no short plain name is dropped, and an account whose login died is held with both windows unread", async () => {
  const unnumbered = firstRow(({ number: _number, ...row }) => row);
  const odd = firstRow((row) => ({ ...row, alias: "Work Laptop" }));
  const dead = firstRow(({ usage: _usage, ...row }) => ({ ...row, usageStatus: "relogin_required", usage: null }));
  const listed = [await accounts(cswap({ list: unnumbered })), await accounts(cswap({ list: odd }))];
  expect([
    listed.map((each) => each?.map(({ number, alias }) => [number, alias])),
    [(await accounts(cswap({ list: dead })))?.[0]].map((account) => [account?.held, account?.windows]),
  ]).toEqual([
    [
      [
        [2, "home"],
        [3, "spare"],
      ],
      [
        [1, undefined],
        [2, "home"],
        [3, "spare"],
      ],
    ],
    [
      [
        true,
        [
          { window: "fiveHour", usedPercent: null, resetsAt: null, readAt: null },
          { window: "sevenDay", usedPercent: null, resetsAt: null, readAt: null },
        ],
      ],
    ],
  ]);
});

// claude-swap's answer to switch --json, in the shape its switcher builds (_switch_result_from_op, alike in 1.0.0).
const SWITCHED = JSON.stringify({
  schemaVersion: 1,
  switched: true,
  from: { number: 3, email: "user3@example.com" },
  to: { number: 1, email: "user1@example.com" },
  reason: "switched",
  warnings: [],
});
const namesEmail = (error: unknown) => String(Reflect.get(Object(error), "message")).includes("@");
// Its refusal of a switch onto an account a session-mode instance runs on, which names the email (switcher.py).
const refusal = JSON.stringify({
  schemaVersion: 1,
  error: {
    type: "ClaudeSwitchError",
    message: "Account-1 (user1@example.com) has a live session-mode Claude instance",
  },
});

const switched = (answer: string, config: unknown = { allow: ["cswap"] }, account = "1") =>
  switchTo({ exec: cswap({ switch: answer }), config, inputs: { account } });

test("switch runs cswap switch on the account's number only with cswap allowed and answers from and to by number; a refusal fails without the email, and a number that is none fails", async () => {
  expect([
    await switched(SWITCHED, {}),
    await switched(SWITCHED),
    await switched(refusal).catch(namesEmail),
    await switched(SWITCHED, { allow: ["cswap"] }, "1 --all").catch(() => "refused"),
  ]).toEqual([
    { runs: "cswap switch 1", approve: "cedarloom claude-swap switch --account 1 --allow cswap" },
    { switched: true, from: 3, to: 1 },
    false,
    "refused",
  ]);
});

// A machine without claude-swap with these installers; an install makes cswap answer, and `ran` keeps what it ran.
const machine = (installers: string[]) => {
  const ran: string[][] = [];
  const exec = async ({ program, args = [] }: ExecParams): Promise<ExecResult> => {
    if (program === "cswap" && ran.length > 0) return { code: 0, stdout: "cswap 1.0.0\n", stderr: "" };
    if (program === "cswap" || !installers.includes(program)) throw notFound(program);
    if (args[0] !== "--version") ran.push([program, ...args]);
    return { code: 0, stdout: "", stderr: "" };
  };
  return { exec, ran };
};

test("install shows uv's command and runs it only with uv allowed and that very command approved, with the menu bar on macOS; with claude-swap there it does nothing, and without uv it fails", async () => {
  const [shown, linux, none] = [machine(["uv"]), machine(["uv"]), machine([])];
  const stale = { approved: "uv tool install 'claude-swap[menubar]==0.30.0'" };
  const pinned =
    "--no-config --default-index https://pypi.org/simple --python >=3.12 --exclude-newer 2026-11-08T00:00:00Z";
  expect([
    await install({ exec: shown.exec, config: { allow: [] } }, "darwin"),
    keys(await install({ exec: shown.exec, config: { allow: ["uv"] }, inputs: stale }, "darwin")),
    shown.ran,
    await install({ exec: linux.exec, config: { allow: ["uv"] } }, "linux"),
    linux.ran,
    await install({ exec: none.exec, config: { allow: ["uv"] } }, "linux").catch(() => "failed"),
    await install({ exec: cswap(), config: {} }, "darwin"),
  ]).toEqual([
    {
      installed: false,
      runs: "uv tool install --no-config --default-index https://pypi.org/simple --python '>=3.12' --exclude-newer 2026-11-08T00:00:00Z 'claude-swap[menubar]==1.0.0'",
      approve: "cedarloom claude-swap install --allow uv",
      installer: "uv",
      source: "https://pypi.org/project/claude-swap/1.0.0/",
      release: "1.0.0",
      hint: expect.any(String),
    },
    ["approve", "hint", "installed", "installer", "release", "runs", "source"],
    [],
    { installed: true, version: "1.0.0" },
    [["uv", "tool", "install", ...pinned.split(" "), "claude-swap==1.0.0"]],
    "failed",
    { installed: true, version: "1.0.0" },
  ]);
});

test("the doctor reads claude-swap from 1.0.0 with JSON schemaVersion 1, says when it switches no account and names an account whose login died", async () => {
  const dead = firstRow(({ usage: _usage, ...row }) => ({ ...row, usageStatus: "relogin_required", usage: null }));
  const newer = JSON.stringify({ ...JSON.parse(LIST), schemaVersion: 2 });
  const findings = [
    await doctor({ exec: missing }),
    await doctor({ exec: cswap({}, "cswap 0.30.0\n") }),
    await doctor({ exec: cswap({}, "cswap dev\n") }),
    await doctor({ exec: cswap() }),
    await doctor({ exec: cswap({ list: dead }) }),
    await doctor({ exec: cswap({ list: "{}" }) }),
    await doctor({ exec: cswap({ list: newer }) }),
  ];
  const unsupported = [["claude-swap", "warning", "claude-swap.unsupported"]];
  expect(findings.map(codes)).toEqual([
    [["claude-swap", "info", "claude-swap.missing"]],
    unsupported,
    unsupported,
    [["claude-swap", "info", "claude-swap.ready"]],
    [
      ["claude-swap", "info", "claude-swap.ready"],
      ["claude-swap", "warning", "claude-swap.relogin"],
    ],
    unsupported,
    unsupported,
  ]);
});

test("the status action says whether claude-swap is installed, its version, its accounts and the active one", async () => {
  expect([await status({ exec: missing }), await status({ exec: cswap() })]).toEqual([
    { installed: false },
    { installed: true, version: "1.0.0", accounts: 3, active: 3 },
  ]);
});

const keys = (outputs: Record<string, unknown>) => Object.keys(outputs).toSorted();

test("auto mode is claude-swap's own auto switch on macOS: on installs the menu bar service with it on, off turns it off where a service is installed, each with the menu bar confirmed and only with cswap allowed; elsewhere hints only", async () => {
  const allowed = { allow: ["cswap"] };
  const [none, on, off, bare] = [cswap(), cswap({ service: "on" }), cswap({ service: "off" }), cswap({ tools: BARE })];
  const running = "Menu bar service: running (pid 4242)";
  expect([
    await auto({ exec: on }, "darwin"),
    await auto({ exec: off }, "darwin"),
    await auto({ exec: none }, "darwin"),
    await autoOn({ exec: none, config: {} }, "darwin"),
    await autoOn({ exec: none, config: allowed }, "darwin"),
    await autoOff({ exec: on, config: {} }, "darwin"),
    await autoOff({ exec: on, config: allowed }, "darwin"),
    keys(await autoOff({ exec: none, config: allowed }, "darwin")),
    keys(await autoOn({ exec: bare, config: allowed }, "darwin")),
    keys(await auto({ exec: cswap() }, "linux")),
    keys(await autoOn({ exec: cswap(), config: allowed }, "linux")),
    keys(await autoOff({ exec: cswap(), config: allowed }, "win32")),
    keys(await auto({ exec: missing }, "darwin")),
  ]).toEqual([
    { service: running, autoSwitch: true },
    { service: running, autoSwitch: false },
    { service: "Menu bar service is not installed." },
    {
      runs: "cswap menubar --install-service --auto-switch",
      approve: "cedarloom claude-swap auto-on --allow cswap",
      hint: expect.any(String),
    },
    { service: "Menu bar service installed (com.cswap.menubar).", autoSwitch: true },
    { runs: "cswap menubar --no-auto-switch", approve: "cedarloom claude-swap auto-off --allow cswap" },
    { service: "Menu bar restarted (pid 4243) to apply the auto-switch setting.", autoSwitch: false },
    ...Array.from({ length: 6 }, () => ["hint"]),
  ]);
});

test("settings are claude-swap's auto mode settings, set through cswap config set only with cswap allowed; one outside auto mode is never set", async () => {
  const ran: string[][] = [];
  const exec = async (request: ExecParams) => {
    ran.push(request.args ?? []);
    return cswap()(request);
  };
  const [allowed, threshold] = [{ allow: ["cswap"] }, { key: "autoswitch.threshold", value: "85" }];
  const shown = await settings({ exec, config: {}, inputs: threshold });
  const values = Object((await settings({ exec, config: allowed, inputs: threshold }))["settings"]);
  const other = settings({ exec, config: allowed, inputs: { key: "run.shareHistory", value: "false" } });
  await expect(other).rejects.toThrow("run.shareHistory");
  expect([
    shown,
    values["autoswitch.threshold"],
    values["autoswitch.strategy"],
    "autoswitch.weeklyThreshold" in values,
    "run.shareHistory" in values,
    ran.filter(([command, flag]) => command === "config" && flag === "set"),
  ]).toEqual([
    {
      runs: "cswap config set -- autoswitch.threshold 85",
      approve: "cedarloom claude-swap settings --key autoswitch.threshold --value 85 --allow cswap",
    },
    90,
    "best",
    false,
    false,
    [["config", "set", "--", "autoswitch.threshold", "85"]],
  ]);
});
