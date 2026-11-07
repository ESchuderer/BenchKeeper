import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
const cases = Object.entries(fixtures.cases).flatMap(([key, list]) => {
  const [policy = "", cwd = ""] = key.split(" ");
  return list.map(([name, command, rule]) => ({ name, policy, cwd, command, rule }));
});

test.each(cases)("$name", ({ policy, command, rule }) => {
  const chosen = fixtures.policies[policy];
  if (chosen === undefined) throw new Error(`no policy ${policy}`);
  expect(guardCommand(command, chosen)?.rule ?? null).toBe(rule);
});

const HOOK = join(import.meta.dirname, "..", "src", "guard-hook.ts");
const policyFile = (): string => {
  const path = join(mkdtempSync(join(tmpdir(), "cedarloom-guard-")), "policy.json");
  writeFileSync(path, JSON.stringify(fixtures.policies["worker"]));
  return path;
};
// `policy` null: the hook runs without its argument.
const hook = (input: string, policy: string | null = policyFile()) => {
  const ran = spawnSync(process.execPath, policy === null ? [HOOK] : [HOOK, policy], { input, encoding: "utf8" });
  return { status: ran.status, refused: ran.stderr !== "" };
};
const bash = (command: unknown, cwd: unknown = "/work/app") =>
  JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd });

test("the hook lets a call run with exit 0 and refuses one with exit 2 and its reason", () => {
  expect(hook(bash("ls -la"))).toEqual({ status: 0, refused: false });
  expect(hook(bash("git commit --no-verify -m wip"))).toEqual({ status: 2, refused: true });
}, 30_000);

test("the hook refuses what it cannot read: input that is no JSON, a call without its command, a missing policy", () => {
  expect(hook("{not json")).toEqual({ status: 2, refused: true });
  expect(hook(bash(undefined))).toEqual({ status: 2, refused: true });
  expect(hook(bash("ls", "relative"))).toEqual({ status: 2, refused: true });
  expect(hook(bash("ls"), null)).toEqual({ status: 2, refused: true });
  expect(hook(bash("ls"), join(tmpdir(), "no-such-policy.json"))).toEqual({ status: 2, refused: true });
}, 30_000);

const monitor = (input: object) => JSON.stringify({ tool_name: "Monitor", tool_input: input, cwd: "/work/app" });

test("the hook reads a Monitor command as a Bash one, and lets other tools and a WebSocket monitor through", () => {
  expect(hook(monitor({ command: "git push -f origin x" }))).toEqual({ status: 2, refused: true });
  expect(hook(monitor({ ws: { url: "wss://example.com" } }))).toEqual({ status: 0, refused: false });
  expect(hook(JSON.stringify({ tool_name: "Read", tool_input: { file_path: "/x" }, cwd: "/" }))).toEqual({
    status: 0,
    refused: false,
  });
}, 30_000);
