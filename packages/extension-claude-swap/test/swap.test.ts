import { readFileSync } from "node:fs";
import { join } from "node:path";
import { auto, autoOff, autoOn, doctor, install, sessions, status, targets } from "@cedarloom/extension-claude-swap";
import {
  type DoctorFinding,
  type ExecParams,
  type ExecResult,
  HOST_MISSING,
  type TargetContext,
} from "@cedarloom/extension-sdk";
import { expect, test } from "vitest";

// claude-swap 0.30.0's own answers to --version, list --json and status --json, recorded with three of its accounts;
// emails, organizations and aliases replaced, and fields this extension does not read (plans, countdowns, pace) cut.
const recorded = (name: string): string =>
  readFileSync(join(import.meta.dirname, "fixtures", "cswap-0.30.0", name), "utf8");
const LIST = recorded("list.json");
// What claude-swap 0.30.0 prints for its menu bar service (cli.py, _menubar_service); it has no JSON form.
const MENUBAR: Record<string, string> = {
  "--service-status": "Menu bar service is not installed.\nInstall it with: cswap menubar --install-service\n",
  "--install-service":
    "Menu bar service installed (com.cswap.menubar).\n  plist: /home/me/Library/LaunchAgents/x.plist\n",
  "--uninstall-service": "Menu bar service removed.\n",
};
const cswap =
  (answers: { list?: string; status?: string; switch?: string } = {}, version = recorded("version.txt")) =>
  async ({ args = [] }: ExecParams): Promise<ExecResult> => {
    const [command = "", flag = ""] = args;
    const outputs: Record<string, () => string> = {
      "--version": () => version,
      list: () => answers.list ?? LIST,
      switch: () => (flag === "1" ? (answers.switch ?? "") : ""),
      config: () => (flag === "set" ? "" : recorded("config.json")),
      menubar: () => MENUBAR[flag] ?? "",
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
const on = (exec: TargetContext["exec"]): TargetContext => ({ locale: "en", exec });
const INTERACTIVE = { target: "interactive" };
const accounts = async (exec: TargetContext["exec"]) =>
  (await targets["target/accounts"]?.(INTERACTIVE, on(exec)))?.accounts;
const probe = async (exec: TargetContext["exec"]) => (await targets["target/probe"]?.(INTERACTIVE, on(exec)))?.status;
const current = async (exec: TargetContext["exec"]) =>
  (await targets["target/current"]?.(INTERACTIVE, on(exec)))?.number;
const codes = (findings: DoctorFinding[]) => findings.map(({ check, severity, code }) => [check, severity, code]);
// The recorded list with its first account's row changed.
const firstRow = (change: (row: Record<string, unknown>) => Record<string, unknown>): string => {
  const list: unknown = JSON.parse(LIST);
  const rows: unknown = Reflect.get(Object(list), "accounts");
  const [first, ...rest] = Array.isArray(rows) ? rows : [];
  return JSON.stringify({ ...Object(list), accounts: [change(Object(first)), ...rest] });
};

// The recorded first account, as the target answers it.
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

test("the interactive target lists claude-swap's accounts by number with their windows and read times; a row it no longer trusts gives its windows without one", async () => {
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

test("a row without a number is left out, an alias no CedarLoom account can have is dropped, and an account whose login died is held and sends both windows unread", async () => {
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
          { window: "fiveHour", usedPercent: 0, resetsAt: null, readAt: null },
          { window: "sevenDay", usedPercent: 0, resetsAt: null, readAt: null },
        ],
      ],
    ],
  ]);
});

// claude-swap 0.30.0's answer to switch --json, in the shape its switcher builds (_switch_result_from_op).
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

const select = (answer: string) =>
  targets["target/select"]?.({ ...INTERACTIVE, number: 1 }, on(cswap({ switch: answer })));

test("select switches claude-swap to the account by its number and answers from and to by number; a refusal fails without the email", async () => {
  expect([await select(SWITCHED), await select(refusal)?.catch(namesEmail)]).toEqual([
    { switched: true, from: 3, to: 1, reason: "switched" },
    false,
  ]);
});

// A machine without claude-swap with these installers; an install makes cswap answer, and `ran` keeps what it ran.
const machine = (installers: string[]) => {
  const ran: string[][] = [];
  const exec = async ({ program, args = [] }: ExecParams): Promise<ExecResult> => {
    if (program === "cswap" && ran.length > 0) return { code: 0, stdout: "cswap 0.30.0\n", stderr: "" };
    if (program === "cswap" || !installers.includes(program)) throw notFound(program);
    if (args[0] !== "--version") ran.push([program, ...args]);
    return { code: 0, stdout: "", stderr: "" };
  };
  return { exec, ran };
};

test("install shows what it runs and runs it only with its program allowed, with the menu bar on macOS; with claude-swap there it does nothing", async () => {
  const [shown, linux, none] = [machine(["uv", "pipx"]), machine(["pipx"]), machine([])];
  expect([
    await install({ exec: shown.exec, config: { allow: [] } }, "darwin"),
    shown.ran,
    await install({ exec: linux.exec, config: { allow: ["pipx"] } }, "linux"),
    linux.ran,
    await install({ exec: none.exec, config: { allow: ["uv"] } }, "linux").catch(() => "failed"),
    await install({ exec: cswap(), config: {} }, "darwin"),
  ]).toEqual([
    {
      installed: false,
      runs: "uv tool install --python '>=3.12' --exclude-newer 2026-11-07T00:00:00Z 'claude-swap[menubar]==0.30.0'",
      approve: "cedarloom claude-swap install --allow uv",
    },
    [],
    { installed: true, version: "0.30.0" },
    [["pipx", "install", "claude-swap==0.30.0"]],
    "failed",
    { installed: true, version: "0.30.0" },
  ]);
});

test("the probe takes claude-swap from 0.30.0 with JSON schemaVersion 1; missing, older, unreadable or another schema is unsupported", async () => {
  const newer = JSON.stringify({ ...JSON.parse(recorded("status.json")), schemaVersion: 2 });
  expect([
    await probe(cswap()),
    await probe(cswap({}, "cswap 0.31.2\n")),
    await probe(missing),
    await probe(cswap({}, "cswap 0.29.0\n")),
    await probe(cswap({}, "cswap dev\n")),
    await probe(cswap({ status: newer })),
  ]).toEqual(["supported", "supported", "unsupported", "unsupported", "unsupported", "unsupported"]);
});

test("the current account is the one claude-swap manages and has active; a login it does not manage is none", async () => {
  const answer = JSON.parse(recorded("status.json"));
  const unmanaged = JSON.stringify({ ...answer, active: { ...answer.active, managed: false } });
  expect([await current(cswap()), await current(cswap({ status: unmanaged }))]).toEqual([3, null]);
});

test("the doctor says when multi-account switching is off and names an account whose login died", async () => {
  const dead = firstRow(({ usage: _usage, ...row }) => ({ ...row, usageStatus: "relogin_required", usage: null }));
  const findings = [
    await doctor({ exec: missing }),
    await doctor({ exec: cswap({}, "cswap 0.29.0\n") }),
    await doctor({ exec: cswap() }),
    await doctor({ exec: cswap({ list: dead }) }),
    await doctor({ exec: cswap({ list: "{}" }) }),
  ];
  expect(findings.map(codes)).toEqual([
    [["claude-swap", "info", "claude-swap.missing"]],
    [["claude-swap", "warning", "claude-swap.unsupported"]],
    [["claude-swap", "info", "claude-swap.ready"]],
    [
      ["claude-swap", "info", "claude-swap.ready"],
      ["claude-swap", "warning", "claude-swap.relogin"],
    ],
    [["claude-swap", "warning", "claude-swap.unsupported"]],
  ]);
});

test("the status action says whether claude-swap is installed, its version, its accounts and the active one", async () => {
  expect([await status({ exec: missing }), await status({ exec: cswap() })]).toEqual([
    { installed: false },
    { installed: true, version: "0.30.0", accounts: 3, active: 3 },
  ]);
});

const line = (number: number, list?: string) =>
  sessions["session/line"]?.({ provider: "claude", number }, on(cswap(list === undefined ? {} : { list }))).catch(
    () => "failed",
  );

test("the session line runs claude-swap's session mode on a listed account; one it holds or does not list fails", async () => {
  const dead = firstRow(({ usage: _usage, ...row }) => ({ ...row, usageStatus: "relogin_required", usage: null }));
  expect([await line(2), await line(1, dead), await line(9)]).toEqual([
    { argv: ["cswap", "run", "2", "--require-session", "--"] },
    "failed",
    "failed",
  ]);
});

const keys = (outputs: Record<string, unknown>) => Object.keys(outputs).toSorted();

test("auto mode is claude-swap's menu bar service on macOS, installed or removed only with cswap allowed; elsewhere hints only", async () => {
  const allowed = { allow: ["cswap"] };
  expect([
    (await auto({ exec: cswap() }, "darwin"))["service"],
    await autoOn({ exec: cswap(), config: {} }, "darwin"),
    (await autoOn({ exec: cswap(), config: allowed }, "darwin"))["service"],
    (await autoOff({ exec: cswap(), config: allowed }, "darwin"))["service"],
    keys(await auto({ exec: cswap() }, "linux")),
    keys(await autoOn({ exec: cswap(), config: allowed }, "linux")),
  ]).toEqual([
    "Menu bar service is not installed.",
    { runs: "cswap menubar --install-service", approve: "cedarloom claude-swap auto-on --allow cswap" },
    "Menu bar service installed (com.cswap.menubar).",
    "Menu bar service removed.",
    ["hint"],
    ["hint"],
  ]);
});

test("the policy is claude-swap's own settings, set through cswap config set; a setting without a value is left out", async () => {
  const ran: string[][] = [];
  const exec = async (request: ExecParams) => {
    ran.push(request.args ?? []);
    return cswap()(request);
  };
  const policy = await targets["target/policy"]?.({ ...INTERACTIVE, set: { "autoswitch.threshold": "85" } }, on(exec));
  expect([
    policy?.values["autoswitch.threshold"],
    policy?.values["autoswitch.strategy"],
    "autoswitch.weeklyThreshold" in (policy?.values ?? {}),
    ran[0],
  ]).toEqual([90, "best", false, ["config", "set", "autoswitch.threshold", "85"]]);
});
