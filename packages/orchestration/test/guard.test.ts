import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { GuardPolicy } from "@cedarloom/contracts";
import { guardCommand, guardHookOf, type Remotes, workerPolicy } from "@cedarloom/orchestration";
import { expect, test } from "vitest";
import { z } from "zod";

const Fixtures = z.object({
  policies: z.record(z.string(), GuardPolicy),
  remotes: z.record(z.string(), z.record(z.string(), z.array(z.string()))),
  // Keyed by "<policy> <folder>": each case's name, command and the rule that refuses it (null: it runs).
  cases: z.record(z.string(), z.array(z.tuple([z.string(), z.string(), z.string().nullable()]))),
});
const fixtures = Fixtures.parse(JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "guard.json"), "utf8")));
const remotes: Remotes = (folder) => {
  // git -C reaches its folder as the OS does; these fixture folders hold no links, and on Windows lose their drive.
  const found =
    fixtures.remotes[
      resolve(folder)
        .replace(/^[A-Za-z]:/, "")
        .replaceAll("\\", "/")
    ];
  return found === undefined ? null : new Map(Object.entries(found));
};
const cases = Object.entries(fixtures.cases).flatMap(([key, list]) => {
  const [policy = "", cwd = ""] = key.split(" ");
  return list.map(([name, command, rule]) => ({ name, policy, cwd, command, rule }));
});

test.each(cases)("$name", ({ policy, cwd, command, rule }) => {
  const chosen = fixtures.policies[policy];
  if (chosen === undefined) throw new Error(`no policy ${policy}`);
  expect(guardCommand(command, cwd, chosen, remotes)?.rule ?? null).toBe(rule);
});

const HOOK = join(import.meta.dirname, "..", "src", "guard-hook.ts");
// `policy` null: the hook runs without its argument.
// The hook's verdict on one input: exit 0 and silent runs the call, exit 2 with a reason refuses it.
const hook = (input: string, policy: string | null = JSON.stringify(fixtures.policies["worker"])) => {
  const ran = spawnSync(process.execPath, policy === null ? [HOOK] : [HOOK, policy], { input, encoding: "utf8" });
  if (ran.status === 0 && ran.stderr === "") return "runs";
  return ran.status === 2 && ran.stderr !== "" ? "refused" : `exit ${ran.status}`;
};
const call = (tool: string, input: object, cwd: unknown = "/work/app") =>
  JSON.stringify({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: input, cwd });
const bash = (command: unknown, cwd?: unknown) => call("Bash", { command }, cwd);

test("the hook lets a call run with exit 0 and refuses one with exit 2 and its reason", () => {
  expect([hook(bash("ls -la")), hook(bash("sudo rm -rf /tmp/x"))]).toEqual(["runs", "refused"]);
}, 30_000);

test("the hook refuses what it cannot read: input that is no JSON, a call without its command, a missing or invalid policy", () => {
  const unread = [hook("{not json"), hook(bash(undefined)), hook(bash("ls", "relative"))];
  expect([...unread, hook(bash("ls"), null), hook(bash("ls"), '{"schemaVersion":1}')]).toEqual(
    Array(5).fill("refused"),
  );
}, 30_000);

test("the hook reads a Monitor command as a Bash one, refuses PowerShell and a remote agent, and lets other tools and a WebSocket monitor through", () => {
  expect([
    hook(call("Monitor", { command: "sudo rm -rf /tmp/x" })),
    hook(call("PowerShell", { command: "Get-ChildItem" }, "C:\\work")),
    hook(call("Monitor", { ws: { url: "wss://example.com" } })),
    hook(call("Read", { file_path: "/x" })),
    hook(call("Agent", { prompt: "x", isolation: "remote" })),
    hook(call("Agent", { prompt: "x", isolation: "worktree" })),
  ]).toEqual(["refused", "refused", "runs", "runs", "refused", "runs"]);
}, 30_000);

test("a worker's policy holds its project's GitHub repositories, the hub and the memory repository, whose main no push reaches, and its hook runs from the package", () => {
  const project = mkdtempSync(join(tmpdir(), "guard-"));
  try {
    execFileSync("git", ["init", "-q", project]);
    for (const [name, url] of [
      ["origin", "git@github.com:acme/app.git"],
      ["upstream", "https://github.com/other/x"],
    ]) {
      execFileSync("git", ["-C", project, "remote", "add", name ?? "", url ?? ""]);
    }
    const policy = workerPolicy(project, { hub: "acme/tracker", memory: "acme/memory" });
    expect(policy).toEqual({
      schemaVersion: 1,
      repositories: ["acme/app", "acme/tracker", "acme/memory"],
      hub: "acme/tracker",
      memory: "acme/memory",
    });
    const { command, args } = guardHookOf(policy);
    const run = (text: string) => spawnSync(command, args, { input: bash(text, project), encoding: "utf8" }).status;
    const memory = "https://github.com/acme/memory.git";
    expect([
      run("git status"),
      run("git push -f origin main"),
      run(`git push ${memory} HEAD:refs/heads/memory/worker-20261108`),
      run(`git push ${memory} HEAD:main`),
    ]).toEqual([0, 2, 0, 2]);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}, 30_000);

test.skipIf(process.platform === "win32")(
  "the hook runs git from an absolute folder of PATH, never one a session planted",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "guard-path-"));
    try {
      mkdirSync(join(dir, "bin"));
      writeFileSync(join(dir, "bin", "git"), `#!/bin/sh\ntouch "${join(dir, "ran")}"\n`, { mode: 0o755 });
      const env = { ...process.env, PATH: `bin${delimiter}${process.env["PATH"] ?? ""}` };
      const policy = JSON.stringify(fixtures.policies["worker"]);
      spawnSync(process.execPath, [HOOK, policy], { input: bash("git push origin feature", dir), cwd: dir, env });
      expect(existsSync(join(dir, "ran"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  30_000,
);
