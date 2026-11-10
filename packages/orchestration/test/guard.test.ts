import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { GuardPolicy } from "@cedarloom/contracts";
import { folderRemotes, guardCommand, originRepos, type Remotes, TYPED_REMOTE } from "@cedarloom/orchestration";
import { expect, test, vi } from "vitest";
import { z } from "zod";

const Fixtures = z.object({
  // As a call meets them: the hook has read `origin` already, and the repositories a workflow's agent may merge in.
  policies: z.record(
    z.string(),
    GuardPolicy.omit({ plugin: true }).extend({
      repositories: z.array(z.string()),
      merge: z.array(z.string()).optional(),
    }),
  ),
  remotes: z.record(z.string(), z.record(z.string(), z.array(z.string()))),
  // Keyed by "<policy> <folder>": each case's name, command and the rule that refuses it (null: it runs).
  cases: z.record(z.string(), z.array(z.tuple([z.string(), z.string(), z.string().nullable()]))),
});
const fixtures = Fixtures.parse(JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "guard.json"), "utf8")));
// A typed URL stays as typed: no fixture folder rewrites one.
const remotes: Remotes = (folder, url) => {
  if (url !== undefined) return new Map([[TYPED_REMOTE, [url]]]);
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
  expect(guardCommand(command, cwd, { ...chosen, merge: chosen.merge ?? [] }, remotes)?.rule ?? null).toBe(rule);
});

const HOOK = join(import.meta.dirname, "..", "src", "guard-hook.ts");
// A package's policy, its plugin w.
const PACKAGE = JSON.stringify({ schemaVersion: 1, hub: null, memory: null, plugin: "w" });
// `policy` null: the hook runs without its argument.
// The hook's verdict on one input: exit 0 and silent runs the call, exit 2 with a reason refuses it.
const hook = (input: string, policy: string | null = PACKAGE) => {
  const ran = spawnSync(process.execPath, policy === null ? [HOOK] : [HOOK, policy], { input, encoding: "utf8" });
  if (ran.status === 0 && ran.stderr === "") return "runs";
  return ran.status === 2 && ran.stderr !== "" ? "refused" : `exit ${ran.status}`;
};
// A workflow script's agent: its type, with the agent id a subagent has.
const WORKFLOW = { agent_type: "workflow-subagent", agent_id: "a1" };
const call = (tool: string, input: object, cwd: unknown = "/work/app", agent: object = WORKFLOW) =>
  JSON.stringify({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: input, cwd, ...agent });
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

test("the hook reads a Monitor command as a Bash one, refuses PowerShell, a remote agent and one it does not bind, and lets other tools and a WebSocket monitor through", () => {
  expect([
    hook(call("Monitor", { command: "sudo rm -rf /tmp/x" })),
    hook(call("PowerShell", { command: "Get-ChildItem" }, "C:\\work")),
    hook(call("Agent", { prompt: "x", isolation: "remote", subagent_type: "w:review" })),
    // Without a type, Claude Code starts a general-purpose agent, which the guard does not bind.
    hook(call("Agent", { prompt: "x" })),
    hook(call("Monitor", { ws: { url: "wss://example.com" } })),
    hook(call("Read", { file_path: "/x" })),
    hook(call("Agent", { prompt: "x", isolation: "worktree", subagent_type: "w:review" })),
  ]).toEqual(["refused", "refused", "refused", "refused", "runs", "runs", "runs"]);
}, 30_000);

// A Git project whose origin is acme/app, with the package's policy (plugin w) and `fields`, removed after `run`.
const inProject = (fields: object, run: (project: string, policy: string) => void): void => {
  const project = mkdtempSync(join(tmpdir(), "guard-"));
  try {
    execFileSync("git", ["init", "-q", project]);
    execFileSync("git", ["-C", project, "remote", "add", "origin", "git@github.com:acme/app.git"]);
    const policy = { schemaVersion: 1, hub: null, memory: null, plugin: "w", ...fields };
    run(project, JSON.stringify(policy));
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
};
// A step of the package that runs as its own subagent.
const STEP = { agent_type: "w:build", agent_id: "a3" };

test("at Auto the hook lets a workflow script's agent merge in its project's origin, and refuses a step's own subagent that merges or starts an agent of that type", () => {
  inProject({ merge: "workflow" }, (project, policy) => {
    const as = (command: string, agent: object) => hook(call("Bash", { command }, project, agent), policy);
    expect([
      as("gh pr merge 3 --squash", WORKFLOW),
      as("git push https://github.com/other/x main", WORKFLOW),
      as("gh pr merge 3 --squash", STEP),
      hook(call("Agent", { prompt: "merge 3", subagent_type: "workflow-subagent" }, project, STEP), policy),
    ]).toEqual(["runs", "refused", "refused", "refused"]);
  });
}, 30_000);

test("the hook binds only a workflow's own agents: any other caller runs untouched, merges and approvals included", () => {
  inProject({ merge: "refuse" }, (project, policy) => {
    const as = (agent: object, command: string, tool = "Bash") => hook(call(tool, { command }, project, agent), policy);
    expect([
      as({}, "gh pr view 7 -R cli/cli"),
      as({}, "(cd src && ls)"),
      as({}, "gh pr merge 5"),
      as({}, "gh pr review 5 --approve"),
      as({}, "gh pr merge 5", "PowerShell"),
      hook(call("Agent", { prompt: "x", isolation: "remote" }, project, {}), policy),
      // Another plugin's subagent, and a session started as a workflow script's agent type (no agent id).
      as({ agent_type: "other:review", agent_id: "a2" }, "(cd app && gh pr merge 5)"),
      as({ agent_type: "workflow-subagent" }, "gh pr merge 5"),
      as(WORKFLOW, "gh pr view 7 -R cli/cli"),
      as(WORKFLOW, "(cd src && ls)"),
      as(WORKFLOW, "gh pr merge 5"),
      as(STEP, "(cd src && ls)"),
    ]).toEqual([...Array(8).fill("runs"), ...Array(4).fill("refused")]);
  });
}, 30_000);

test("a workflow's agent reaches its project's origin, the hub and the memory repository, whose main no push reaches", () => {
  inProject({ hub: "acme/tracker", memory: "acme/memory" }, (project, policy) => {
    const run = (text: string) => hook(bash(text, project), policy);
    const memory = "https://github.com/acme/memory.git";
    // A rewrite the checkout's config holds, which sends a push to the project's URL to the memory repository.
    execFileSync("git", ["-C", project, "config", `url.${memory}.pushInsteadOf`, "https://github.com/acme/app"]);
    // A pushurl for a remote of the name the guard once used for typed URLs, which would show the allowed URL instead.
    execFileSync("git", ["-C", project, "config", "remote.cedarloom-typed-url.pushurl", "https://github.com/acme/app"]);
    expect([
      run("git status"),
      run("git push -f origin main"),
      run(`git push ${memory} HEAD:refs/heads/memory/worker-20261108`),
      run(`git push ${memory} HEAD:main`),
      run("git push https://github.com/acme/app HEAD:main"),
    ]).toEqual(["runs", "refused", "runs", "refused", "refused"]);
  });
}, 30_000);

test("the hook reads the remotes as the guarded command's git does, a session's GIT_DIR included; the CLI reads the folder's own", () => {
  inProject({ memory: "acme/memory" }, (project, policy) => {
    const memory = mkdtempSync(join(tmpdir(), "guard-memory-"));
    try {
      execFileSync("git", ["init", "-q", memory]);
      execFileSync("git", ["-C", memory, "remote", "add", "origin", "git@github.com:acme/memory.git"]);
      vi.stubEnv("GIT_DIR", join(memory, ".git"));
      const run = (text: string) => hook(bash(text, project), policy);
      expect([
        run("git push origin HEAD:main"),
        run("git push origin HEAD:memory/worker-1"),
        originRepos(project),
        originRepos(project, folderRemotes),
      ]).toEqual(["refused", "runs", ["acme/memory"], ["acme/app"]]);
    } finally {
      vi.unstubAllEnvs();
      rmSync(memory, { recursive: true, force: true });
    }
  });
}, 30_000);

test.skipIf(process.platform === "win32")(
  "the hook runs git from an absolute folder of PATH, never one a session planted",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "guard-path-"));
    try {
      mkdirSync(join(dir, "bin"));
      writeFileSync(join(dir, "bin", "git"), `#!/bin/sh\ntouch "${join(dir, "ran")}"\n`, { mode: 0o755 });
      const env = { ...process.env, PATH: `bin${delimiter}${process.env["PATH"] ?? ""}` };
      spawnSync(process.execPath, [HOOK, PACKAGE], { input: bash("git push origin feature", dir), cwd: dir, env });
      expect(existsSync(join(dir, "ran"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  30_000,
);

const EXIT_HOOK = join(import.meta.dirname, "..", "src", "exit-hook.ts");

test("the exit hook keeps a step script's own exit code whatever the agent adds, and refuses a report that differs", () => {
  const data = mkdtempSync(join(tmpdir(), "exits-"));
  try {
    const run = (mode: string, payload: object) => {
      const ran = spawnSync(process.execPath, [EXIT_HOOK, mode], {
        input: JSON.stringify({ session_id: "s1", agent_id: "a1", ...payload }),
        encoding: "utf8",
        env: { ...process.env, CLAUDE_PLUGIN_DATA: data },
      });
      return ran.status === 0 ? "runs" : `exit ${ran.status}`;
    };
    const script = "sh '/plugin/steps/ship/scripts/run.sh'";
    // The agent appended an echo: Bash exits 0, and the script's own last line says 3.
    const ran = { tool_name: "Bash", tool_input: { command: `${script}; echo "EXIT=$?"` } };
    const report = (exitCode: number, agent = "a1") =>
      run("verify", {
        tool_name: "StructuredOutput",
        tool_input: { cedarloomExitCode: exitCode, output: "" },
        agent_id: agent,
      });
    expect([
      report(3),
      run("record", { ...ran, tool_response: { stdout: "shipping\ncedarloom-exit 3\nEXIT=0", stderr: "" } }),
      report(0),
      report(3),
      // Reading the script runs nothing and keeps the status.
      run("record", { tool_name: "Bash", tool_input: { command: "cat '/plugin/steps/ship/scripts/run.sh'" } }),
      report(3),
      report(3, "a2"),
      report(-1, "a2"),
      run("record", { ...ran, error: "Exit code 1\ncedarloom-exit 1" }),
      report(1),
      // A run again whose output lost the status line (cut short, in the background) leaves no status to report.
      run("record", {
        tool_name: "Bash",
        tool_input: { command: script.replace("sh ", "sh -x ") },
        tool_response: { stdout: "Command running in background", stderr: "" },
      }),
      report(1),
      report(-1),
      // Another workflow's report, and an agent step's verdict, are not the runner's.
      run("verify", { tool_name: "StructuredOutput", tool_input: { exitCode: 0, output: "" } }),
      run("verify", { tool_name: "StructuredOutput", tool_input: { verdict: "agree" } }),
    ]).toEqual("exit 2,runs,exit 2,runs,runs,runs,exit 2,runs,runs,runs,runs,exit 2,runs,runs,runs".split(","));
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
}, 30_000);
