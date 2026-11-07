import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ExecParams, type ExecResult, HOST_MISSING } from "@cedarloom/extension-sdk";
import { expect, test } from "vitest";
import { doctor, status } from "@cedarloom/extension-orca";

// Orca 1.4.251's own answers: --version and status --json recorded while it ran, and the answer its CLI builds when
// no app is running (cli/runtime/status.js of that version).
const recorded = (name: string): string =>
  readFileSync(join(import.meta.dirname, "fixtures", "orca-1.4.251", name), "utf8");
const orca =
  (version: string, answer: string) =>
  async ({ args }: ExecParams): Promise<ExecResult> => ({
    code: 0,
    stdout: args?.[0] === "--version" ? version : answer,
    stderr: "",
  });
// The host's answer when none of the manifest's candidates is there.
const missing = async (): Promise<ExecResult> => {
  throw Object.assign(new Error("orca is not installed: none of orca-ide found"), { code: HOST_MISSING });
};

test("each probe outcome gives its finding: not installed, not running, running, and a major version not checked with", async () => {
  const [version, running, stopped] = [
    recorded("version.txt"),
    recorded("status-running.json"),
    recorded("status-not-running.json"),
  ];
  expect([
    await doctor({ exec: missing }),
    await doctor({ exec: orca(version, stopped) }),
    await doctor({ exec: orca(version, running) }),
    await doctor({ exec: orca("2.0.1\n", running) }),
  ]).toEqual([
    [
      {
        check: "orca",
        severity: "info",
        code: "orca.missing",
        message: "Orca is not installed here (orca is not installed: none of orca-ide found).",
      },
    ],
    [
      {
        check: "orca",
        severity: "info",
        code: "orca.not-running",
        message: "Orca 1.4.251 is installed and not running.",
      },
    ],
    [{ check: "orca", severity: "info", code: "orca.running", message: "Orca 1.4.251 is running." }],
    [
      { check: "orca", severity: "info", code: "orca.running", message: "Orca 2.0.1 is running." },
      {
        check: "orca",
        severity: "warning",
        code: "orca.unobserved-major",
        message: "Orca 2.0.1 is a major version this CedarLoom was not checked with (1.4.251).",
      },
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
