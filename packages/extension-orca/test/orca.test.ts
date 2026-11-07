import { readFileSync } from "node:fs";
import { join } from "node:path";
import { doctor, follow, status } from "@cedarloom/extension-orca";
import { type DoctorFinding, type ExecParams, type ExecResult, HOST_MISSING, valueAt } from "@cedarloom/extension-sdk";
import { expect, test } from "vitest";

// Orca 1.4.251's own answers: --version, status --json, skills installed --json (four of its skills) and account list
// --json (its claude block, two saved accounts in place of the real ones, on the System default) recorded while it ran,
// and the answer its CLI builds when no app is running (cli/runtime/status.js of that version).
const recorded = (name: string): string =>
  readFileSync(join(import.meta.dirname, "fixtures", "orca-1.4.251", name), "utf8");
const SYSTEM = recorded("accounts-system.json");
const [HOME, OTHER] = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
// The recorded account list with `id` selected for new Claude panes, and the default home signed in as `email`.
const selecting = (id: string, email = "Home@example.com"): string =>
  SYSTEM.replace('"host": null', `"host": "${id}"`).replace('"Home@example.com"', `"${email}"`);
const orca =
  (version: string, answer: string, code = 0, skills = recorded("skills-installed.json"), accounts = SYSTEM) =>
  async ({ args }: ExecParams): Promise<ExecResult> => {
    const own: Record<string, string> = { "--version": version, skills, account: accounts };
    const stdout = own[args?.[0] ?? ""];
    return stdout === undefined ? { code, stdout: answer, stderr: "" } : { code: 0, stdout, stderr: "" };
  };
// A skills list in the recorded answer's shape.
const listed = (...skills: { name: string; providers: string[] }[]): string =>
  JSON.stringify({ id: "local-skills", ok: true, result: { skills } });
// The host's answer when none of the manifest's candidates is there.
const missing = async (): Promise<ExecResult> => {
  throw Object.assign(new Error("orca is not installed: none of orca-ide found"), { code: HOST_MISSING });
};
const codes = (findings: DoctorFinding[]) => findings.map(({ check, severity, code }) => [check, severity, code]);

test("each probe outcome gives its finding, a major version not checked with or an answer that does not read warns, and Windows is not checked", async () => {
  const [version, running] = [recorded("version.txt"), recorded("status-running.json")];
  const findings = [
    await doctor({ exec: missing }, "linux"),
    await doctor({ exec: orca(version, recorded("status-not-running.json")) }, "linux"),
    await doctor({ exec: orca(version, running) }, "darwin"),
    await doctor({ exec: orca("1.5.0\n", running) }, "darwin"),
    await doctor({ exec: orca("2.0.1\n", running) }, "darwin"),
    await doctor({ exec: orca("Orca 2.0.0\n", running) }, "darwin"),
    await doctor({ exec: orca(version, "", 1) }, "darwin"),
    await doctor({ exec: orca(version, running) }, "win32"),
  ];
  expect(findings.map(codes)).toEqual([
    [["orca", "info", "orca.missing"]],
    [["orca", "info", "orca.not-running"]],
    [
      ["orca", "info", "orca.running"],
      ["orca", "info", "orca.accounts-system"],
    ],
    [
      ["orca", "info", "orca.running"],
      ["orca", "info", "orca.accounts-system"],
    ],
    [
      ["orca", "info", "orca.running"],
      ["orca", "warning", "orca.unobserved-major"],
      ["orca", "info", "orca.accounts-system"],
    ],
    [
      ["orca", "info", "orca.running"],
      ["orca", "warning", "orca.unreadable"],
      ["orca", "info", "orca.accounts-system"],
    ],
    [["orca", "warning", "orca.unreadable"]],
    [["orca", "info", "orca.unchecked"]],
  ]);
});

test("while Orca runs, the doctor finds the Orca skills Claude Code lacks, and warns on a list that does not read", async () => {
  const [version, running] = [recorded("version.txt"), recorded("status-running.json")];
  const codexOnly = listed(
    { name: "orca-cli", providers: ["agent-skills", "claude"] },
    { name: "orchestration", providers: ["codex"] },
  );
  const neither = listed({ name: "tdd", providers: ["claude"] });
  const findings = await Promise.all(
    [codexOnly, neither, "{}"].map((skills) => doctor({ exec: orca(version, running, 0, skills) }, "darwin")),
  );
  expect(findings.map(codes)).toEqual([
    [
      ["orca", "info", "orca.running"],
      ["orca", "info", "orca.skills-missing"],
      ["orca", "info", "orca.accounts-system"],
    ],
    [
      ["orca", "info", "orca.running"],
      ["orca", "info", "orca.skills-missing"],
      ["orca", "info", "orca.accounts-system"],
    ],
    [
      ["orca", "info", "orca.running"],
      ["orca", "warning", "orca.skills-unreadable"],
      ["orca", "info", "orca.accounts-system"],
    ],
  ]);
});

test("the status action says whether Orca is installed, its version, whether it is running, and how its Claude panes pick their account", async () => {
  const [version, running] = [recorded("version.txt"), recorded("status-running.json")];
  expect([
    await status({ exec: missing }),
    await status({ exec: orca(version, recorded("status-not-running.json")) }),
    await status({ exec: orca(version, running) }),
    (await status({ exec: orca(version, running, 0, undefined, selecting(OTHER)) }))["claudeAccounts"],
  ]).toEqual([
    { installed: false, running: false },
    { installed: true, version: "1.4.251", running: false },
    { installed: true, version: "1.4.251", running: true, claudeAccounts: "system default" },
    "managed, another account",
  ]);
});

test("while Orca runs, the doctor says how its Claude panes pick their account, and warns for a saved account other than the default home's or a list that does not read", async () => {
  const [version, running] = [recorded("version.txt"), recorded("status-running.json")];
  const findings = await Promise.all(
    [selecting(HOME), selecting(OTHER), selecting(HOME, "nobody@example.com"), "{}"].map((accounts) =>
      doctor({ exec: orca(version, running, 0, undefined, accounts) }, "darwin"),
    ),
  );
  expect(findings.map((each) => codes(each).at(-1))).toEqual([
    ["orca", "info", "orca.accounts-managed"],
    ["orca", "warning", "orca.accounts-elsewhere"],
    ["orca", "warning", "orca.accounts-elsewhere"],
    ["orca", "warning", "orca.accounts-unreadable"],
  ]);
});

// Orca with its account list, answering a select as its CLI does from 1.4.252 (the account state accounts.selectClaude
// returns, stablyai/orca#38944); every call kept.
const accountsOrca = (version: string, accounts: string, selected = HOME) => {
  const ran: string[][] = [];
  const state = JSON.stringify({
    id: "local-select",
    ok: true,
    result: valueAt(JSON.parse(selecting(selected)), "result", "claude"),
  });
  const exec = async ({ args = [] }: ExecParams): Promise<ExecResult> => {
    ran.push(args);
    const answers: Record<string, string> = {
      "--version": version,
      status: recorded("status-running.json"),
      account: args[1] === "select" ? state : accounts,
    };
    return { code: 0, stdout: answers[args[0] ?? ""] ?? "", stderr: "" };
  };
  return { exec, selects: () => ran.filter(([command, verb]) => command === "account" && verb === "select") };
};

test("follow selects the saved account signed in as the default home for new Claude panes, only with orca allowed and from Orca 1.4.252; on the System default or that account it changes nothing", async () => {
  const allow = { allow: ["orca"] };
  const [system, home, other] = [
    accountsOrca("1.4.252", SYSTEM),
    accountsOrca("1.4.252", selecting(HOME)),
    accountsOrca("1.4.252", selecting(OTHER)),
  ];
  const shown = accountsOrca("1.4.252", selecting(OTHER));
  const { runs, approve } = await follow({ exec: shown.exec, config: {} });
  expect([
    await follow({ exec: system.exec, config: allow }),
    await follow({ exec: home.exec, config: allow }),
    { runs, approve },
    await follow({ exec: other.exec, config: allow }),
    [system, home, shown].map(({ selects }) => selects().length),
    other.selects(),
  ]).toEqual([
    { mode: "system default", followed: true },
    { mode: "managed, the default home's account", followed: true },
    { runs: `orca account select --agent claude --account ${HOME}`, approve: "cedarloom orca follow --allow orca" },
    { mode: "managed, the default home's account", followed: true },
    [0, 0, 0],
    [["account", "select", "--agent", "claude", "--account", HOME, "--json"]],
  ]);
});

test("follow selects nothing before Orca 1.4.252, without a saved account signed in as the default home, or while Orca is not running; a select that leaves another account fails", async () => {
  const allow = { allow: ["orca"] };
  const older = accountsOrca("1.4.251", selecting(OTHER));
  const unknown = accountsOrca("1.4.252", selecting(OTHER, "nobody@example.com"));
  const stuck = accountsOrca("1.4.252", selecting(OTHER), OTHER);
  const stopped = orca(recorded("version.txt"), recorded("status-not-running.json"));
  expect([
    Object.keys(await follow({ exec: older.exec, config: allow })).toSorted(),
    Object.keys(await follow({ exec: unknown.exec, config: allow })).toSorted(),
    (await follow({ exec: stopped, config: allow }))["followed"],
    [older, unknown].map(({ selects }) => selects().length),
  ]).toEqual([["followed", "hint", "mode"], ["followed", "hint", "mode"], false, [0, 0]]);
  await expect(follow({ exec: stuck.exec, config: allow })).rejects.toThrow(HOME);
});
