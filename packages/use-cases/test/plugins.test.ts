import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Result } from "@cedarloom/contracts";
import type { FetchOptions, Source, Tree, TreeFile } from "@cedarloom/git";
import { pluginProblems, WORKFLOW_PLUGIN, workflowPlugin } from "@cedarloom/use-cases";
import { expect, test, vi } from "vitest";

const file = (path: string, text: string, mode: TreeFile["mode"] = "100644"): TreeFile => {
  const content = Buffer.from(text);
  return { path, mode, sha256: createHash("sha256").update(content).digest("hex"), content };
};

// The marketplace's plugins folder at the pinned commit: the workflow plugin, and another plugin beside it.
const WITH_WORKFLOW = [
  file("workflow/.claude-plugin/plugin.json", '{"name":"workflow"}'),
  file("workflow/skills/tier/SKILL.md", "# Tier"),
  file("workflow/hooks/tier.mjs", "export {};", "100755"),
  file("benchkeeper/.claude-plugin/plugin.json", '{"name":"benchkeeper"}'),
];

// A fetch that answers every source with `files` at the commit it was asked for, or with `answer` when given.
const fetching = (files: TreeFile[], answer?: Result<Tree>) =>
  vi.fn<(source: Source, options: FetchOptions) => Promise<Result<Tree>>>(async (source) =>
    answer === undefined ? { ok: true, value: { commit: source.ref, files, digest: "d" } } : answer,
  );

const state = () => mkdtempSync(join(tmpdir(), "cedarloom-plugins-"));

test("the workflow plugin is checked out once per pinned commit, from the marketplace's plugins folder", async () => {
  const dir = state();
  const fetch = fetching(WITH_WORKFLOW);
  const plugin = join(dir, "plugins", WORKFLOW_PLUGIN.commit, "workflow");
  expect(await workflowPlugin(dir, fetch)).toBe(plugin);
  expect(await workflowPlugin(dir, fetch)).toBe(plugin);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]?.[0]).toEqual({ url: WORKFLOW_PLUGIN.url, ref: WORKFLOW_PLUGIN.commit, path: "plugins" });
  expect(readFileSync(join(plugin, "skills", "tier", "SKILL.md"), "utf8")).toBe("# Tier");
  // Read-only, so no process changes the plugin for the next worker; Windows keeps no POSIX mode.
  const modes = ["hooks/tier.mjs", "skills/tier/SKILL.md"].map((path) =>
    process.platform === "win32" ? 0 : statSync(join(plugin, path)).mode & 0o777,
  );
  expect(modes).toEqual(process.platform === "win32" ? [0, 0] : [0o555, 0o444]);
});

test("a commit without the workflow plugin gives none, and that is kept; a failed fetch is tried again", async () => {
  const dir = state();
  const without = fetching([file("benchkeeper/.claude-plugin/plugin.json", "{}")]);
  expect(await workflowPlugin(dir, without)).toBeNull();
  expect(await workflowPlugin(dir, without)).toBeNull();
  expect(without).toHaveBeenCalledTimes(1);
  const other = state();
  const failing = fetching([], {
    ok: false,
    finding: { code: "git.failed", params: { step: "fetch", error: "offline" } },
  });
  expect(await workflowPlugin(other, failing)).toBeNull();
  expect(await workflowPlugin(other, failing)).toBeNull();
  expect(failing).toHaveBeenCalledTimes(2);
  // A tree of another commit than the pinned one is not taken.
  const moved = vi.fn<(source: Source, options: FetchOptions) => Promise<Result<Tree>>>(async () => ({
    ok: true,
    value: { commit: "0".repeat(40), files: WITH_WORKFLOW, digest: "d" },
  }));
  expect(await workflowPlugin(other, moved)).toBeNull();
  expect(existsSync(join(other, "plugins", WORKFLOW_PLUGIN.commit))).toBe(false);
});

test("a checkout whose write fails gives no plugin and leaves no staging folder behind", async () => {
  const dir = state();
  // A file and a folder of the same name: the second file cannot be written.
  const clash = fetching([file("workflow", "x"), file("workflow/skills/tier/SKILL.md", "# Tier")]);
  expect(await workflowPlugin(dir, clash)).toBeNull();
  expect(readdirSync(join(dir, "plugins"))).toEqual([]);
});

test("a workflow plugin that holds a .claude folder is refused, as --add-dir would load that folder too", async () => {
  const dir = state();
  const fetch = fetching([...WITH_WORKFLOW, file("workflow/.claude/settings.json", "{}")]);
  expect(await workflowPlugin(dir, fetch)).toBeNull();
});

test("a checkout another launch placed first stays, and the one fetched meanwhile is dropped", async () => {
  const dir = state();
  const checkout = join(dir, "plugins", WORKFLOW_PLUGIN.commit);
  const racing = vi.fn<(source: Source, options: FetchOptions) => Promise<Result<Tree>>>(async (source) => {
    mkdirSync(join(checkout, "workflow"), { recursive: true });
    return { ok: true, value: { commit: source.ref, files: WITH_WORKFLOW, digest: "d" } };
  });
  expect(await workflowPlugin(dir, racing)).toBe(join(checkout, "workflow"));
  expect(existsSync(join(checkout, "workflow", "skills"))).toBe(false);
  expect(readdirSync(join(dir, "plugins"))).toEqual([WORKFLOW_PLUGIN.commit]);
});

test("the doctor reads the latest init line's plugins: none at the pinned commit, or a plugin that did not load", () => {
  expect(pluginProblems(null)).toEqual([]);
  const loaded = { expected: ["workflow"], loaded: ["workflow"], skills: ["workflow:tier"], errors: [] };
  expect(pluginProblems(loaded)).toEqual([]);
  expect(pluginProblems({ ...loaded, expected: [], loaded: [], skills: [] })).toEqual([
    { code: "doctor.plugin-none", params: { plugin: "workflow", commit: WORKFLOW_PLUGIN.commit } },
  ]);
  // Loaded without its skills counts as not loaded; the load errors go with it.
  expect(pluginProblems({ ...loaded, skills: [], errors: ["workflow: bad skill"] })).toEqual([
    { code: "doctor.plugin-not-loaded", params: { plugin: "workflow", errors: "workflow: bad skill" } },
  ]);
  expect(pluginProblems({ ...loaded, loaded: [] })).toEqual([
    { code: "doctor.plugin-not-loaded", params: { plugin: "workflow", errors: "" } },
  ]);
});
