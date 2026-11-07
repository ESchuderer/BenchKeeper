import { readFileSync } from "node:fs";
import { join } from "node:path";
import { doctor, status } from "@cedarloom/extension-orca";
import { type DoctorFinding, type ExecParams, type ExecResult, HOST_MISSING } from "@cedarloom/extension-sdk";
import { expect, test } from "vitest";

// Orca 1.4.251's own answers: --version, status --json and skills installed --json (four of its skills) recorded while
// it ran, and the answer its CLI builds when no app is running (cli/runtime/status.js of that version).
const recorded = (name: string): string =>
  readFileSync(join(import.meta.dirname, "fixtures", "orca-1.4.251", name), "utf8");
const orca =
  (version: string, answer: string, code = 0, skills = recorded("skills-installed.json")) =>
  async ({ args }: ExecParams): Promise<ExecResult> => {
    if (args?.[0] === "--version") return { code: 0, stdout: version, stderr: "" };
    return args?.[0] === "skills" ? { code: 0, stdout: skills, stderr: "" } : { code, stdout: answer, stderr: "" };
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
    [["orca", "info", "orca.running"]],
    [["orca", "info", "orca.running"]],
    [
      ["orca", "info", "orca.running"],
      ["orca", "warning", "orca.unobserved-major"],
    ],
    [
      ["orca", "info", "orca.running"],
      ["orca", "warning", "orca.unreadable"],
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
    ],
    [
      ["orca", "info", "orca.running"],
      ["orca", "info", "orca.skills-missing"],
    ],
    [
      ["orca", "info", "orca.running"],
      ["orca", "warning", "orca.skills-unreadable"],
    ],
  ]);
});

test("the status action says whether Orca is installed, its version, and whether it is running", async () => {
  const answered = orca(recorded("version.txt"), recorded("status-running.json"));
  expect([await status({ exec: missing }), await status({ exec: answered })]).toEqual([
    { installed: false, running: false },
    { installed: true, version: "1.4.251", running: true },
  ]);
});
