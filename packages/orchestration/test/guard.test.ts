import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GuardPolicy } from "@cedarloom/contracts";
import { guardCommand } from "@cedarloom/orchestration";
import { expect, test } from "vitest";
import { z } from "zod";

const Fixtures = z.object({
  policies: z.record(z.string(), GuardPolicy),
  // Keyed by "<policy> <folder>": each case's name, command and the rule that refuses it (null: it runs).
  cases: z.record(z.string(), z.array(z.tuple([z.string(), z.string(), z.string().nullable()]))),
});
const fixtures = Fixtures.parse(JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "guard.json"), "utf8")));
const cases = Object.values(fixtures.cases).flatMap((list) =>
  list.map(([name, command, rule]) => ({ name, command, rule })),
);

test.each(cases)("$name", ({ command, rule }) => {
  expect(guardCommand(command)?.rule ?? null).toBe(rule);
});

const HOOK = join(import.meta.dirname, "..", "src", "guard-hook.ts");
// `policy` null: the hook runs without its argument.
const hook = (input: string, policy: string | null = JSON.stringify(fixtures.policies["worker"])) => {
  const ran = spawnSync(process.execPath, policy === null ? [HOOK] : [HOOK, policy], { input, encoding: "utf8" });
  return { status: ran.status, refused: ran.stderr !== "" };
};
const bash = (command: unknown, cwd: unknown = "/work/app") =>
  JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd });

test("the hook lets a call run with exit 0 and refuses one with exit 2 and its reason", () => {
  expect(hook(bash("ls -la"))).toEqual({ status: 0, refused: false });
  expect(hook(bash("sudo rm -rf /tmp/x"))).toEqual({ status: 2, refused: true });
}, 30_000);

test("the hook refuses what it cannot read: input that is no JSON, a call without its command, a missing or invalid policy", () => {
  expect(hook("{not json")).toEqual({ status: 2, refused: true });
  expect(hook(bash(undefined))).toEqual({ status: 2, refused: true });
  expect(hook(bash("ls", "relative"))).toEqual({ status: 2, refused: true });
  expect(hook(bash("ls"), null)).toEqual({ status: 2, refused: true });
  expect(hook(bash("ls"), '{"schemaVersion":1}')).toEqual({ status: 2, refused: true });
}, 30_000);

const monitor = (input: object) => JSON.stringify({ tool_name: "Monitor", tool_input: input, cwd: "/work/app" });

test("the hook reads a Monitor command as a Bash one, refuses PowerShell, and lets other tools and a WebSocket monitor through", () => {
  expect(hook(monitor({ command: "sudo rm -rf /tmp/x" }))).toEqual({ status: 2, refused: true });
  expect(hook(monitor({ ws: { url: "wss://example.com" } }))).toEqual({ status: 0, refused: false });
  expect(
    hook(JSON.stringify({ tool_name: "PowerShell", tool_input: { command: "Get-ChildItem" }, cwd: "C:\\work" })),
  ).toEqual({
    status: 2,
    refused: true,
  });
  expect(hook(JSON.stringify({ tool_name: "Read", tool_input: { file_path: "/x" }, cwd: "/" }))).toEqual({
    status: 0,
    refused: false,
  });
}, 30_000);
