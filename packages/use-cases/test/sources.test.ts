import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plan } from "@cedarloom/contracts";
import type { Tree } from "@cedarloom/git";
import { sha256 } from "@cedarloom/ledger";
import { applyPlan, type Fetch, planProfile } from "@cedarloom/use-cases";
import { expect, test, vi } from "vitest";
import { ok, testRoot } from "./harness.ts";

const root = testRoot("sources");

// Each repository's commits, newest last: a fetch by branch takes the newest, a fetch by commit that one.
const commits = new Map<string, Tree[]>();
const publish = (url: string, files: Record<string, string>): Tree => {
  const list = commits.get(url) ?? [];
  const content = Object.entries(files).map(([path, text]) => ({
    path,
    mode: "100644" as const,
    sha256: sha256(text),
    content: Buffer.from(text),
  }));
  const tree = {
    commit: sha256(`${url} ${list.length}`).slice(0, 40),
    digest: sha256(JSON.stringify(files)),
    files: content,
  };
  commits.set(url, [...list, tree]);
  return tree;
};
const fetchPublished: Fetch = async ({ url, ref }) => {
  const list = commits.get(url) ?? [];
  const tree = /^[0-9a-f]{40}$/.test(ref) ? list.find((each) => each.commit === ref) : list.at(-1);
  if (tree !== undefined) return { ok: true, value: tree };
  return { ok: false, finding: { code: "git.failed", params: { step: "fetch", error: "no such ref" } } };
};

// A machine whose selection names a local profile with these machine parts and packs.
const machineWith = (machine: object, packs: object = {}) => {
  const [config, state, home, user, files] = ["config-", "state-", "home-", "user-", "files-"].map((name) =>
    mkdtempSync(join(root, name)),
  );
  if (config === undefined || state === undefined || home === undefined || user === undefined || files === undefined)
    throw new Error("no folders");
  const head = { schemaVersion: 1, kind: "cedarloom.profile", id: "acme.mine", version: "1.0.0", name: "Mine" };
  const file = join(files, "mine.json");
  writeFileSync(file, JSON.stringify({ ...head, minApp: "0.0.0", agents: ["claude-code"], packs, machine }));
  const selection = { schemaVersion: 1, kind: "cedarloom.profile-selection", profile: { file }, select: {} };
  writeFileSync(join(config, "profile.json"), JSON.stringify(selection));
  return { state, home, plan: () => planProfile(config, state, { home, user }, { fetch: fetchPublished }) };
};
const skill = (source: object) => ({ "skill.text": { type: "skill", title: "Text", default: "on", source } });
const paths = (plan: Plan | null) => plan?.operations.map((op) => [op.kind, "path" in op ? op.path : null]);

test("a skill that follows a branch takes its first commit at once, and a new one only after 3 days", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const url = "https://git.example.org/acme/wait.git";
    publish(url, { "SKILL.md": "first\n", "notes.md": "old\n" });
    const { state, home, plan } = machineWith(skill({ git: url, ref: "main", path: "skills/text" }));
    const first = ok(await plan()).plan;
    if (first === null) throw new Error("no plan");
    expect(ok(applyPlan(state, first, { yes: true })).status).toBe("applied");
    publish(url, { "SKILL.md": "second\n" });
    const waiting = ok(await plan());
    vi.setSystemTime(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const folder = join(home, "skills", "text");
    expect([waiting.plan, waiting.findings.map(({ code }) => code), paths(ok(await plan()).plan)]).toEqual([
      null,
      ["profile.source-waiting"],
      [
        ["write", join(folder, "SKILL.md")],
        ["delete", join(folder, "notes.md")],
      ],
    ]);
  } finally {
    vi.useRealTimers();
  }
});

test("a source that follows a branch and holds a file that may run is refused", async () => {
  const url = "https://git.example.org/acme/script.git";
  publish(url, { "SKILL.md": "x\n", "run.sh": "echo hi\n" });
  expect(await machineWith(skill({ git: url, ref: "main" })).plan()).toEqual({
    ok: false,
    finding: { code: "profile.pack-unpinned", params: { source: url, path: "run.sh" } },
  });
});

test("a skill entry that may run, reached through a pack that follows a branch, is refused", async () => {
  const url = "https://git.example.org/acme/tools.git";
  const manifest = { schemaVersion: 1, kind: "cedarloom.pack", id: "acme.tools", version: "1.0.0", name: "Tools" };
  publish(url, {
    "cedarloom-pack.json": JSON.stringify({
      ...manifest,
      minApp: "0.0.0",
      entries: { "skills/tool": { kind: "skill" } },
    }),
    "skills/tool/SKILL.md": "x\n",
    "skills/tool/run.sh": "echo hi\n",
  });
  const part = { type: "skill", title: "Tool", default: "on", source: { pack: "acme.tools", path: "skills/tool" } };
  expect(await machineWith({ "skill.tool": part }, { "acme.tools": { git: url, ref: "main" } }).plan()).toEqual({
    ok: false,
    finding: { code: "profile.pack-unpinned", params: { source: url, path: "skills/tool/run.sh" } },
  });
});

test("while a new commit waits and the one in use cannot be fetched, the installed skill stays", async () => {
  const url = "https://git.example.org/acme/gone.git";
  publish(url, { "SKILL.md": "first\n" });
  const { state, plan } = machineWith(skill({ git: url, ref: "main" }));
  const first = ok(await plan()).plan;
  if (first === null) throw new Error("no plan");
  expect(ok(applyPlan(state, first, { yes: true })).status).toBe("applied");
  const second = publish(url, { "SKILL.md": "second\n" });
  commits.set(url, [second]);
  const waiting = ok(await plan());
  expect([waiting.plan, waiting.findings.map(({ code }) => code)]).toEqual([null, ["profile.source-waiting"]]);
});

test("a record of the followed sources CedarLoom cannot read stops the plan", async () => {
  const { state, plan } = machineWith(skill({ git: "https://git.example.org/acme/any.git", ref: "main" }));
  writeFileSync(join(state, "pack-sources.json"), JSON.stringify({ sources: {} }));
  expect(await plan()).toEqual({
    ok: false,
    finding: {
      code: "document.unreadable",
      params: { path: join(state, "pack-sources.json"), error: "not a pack-sources record" },
    },
  });
});

test("a pinned source whose folder has another digest is refused", async () => {
  const url = "https://git.example.org/acme/pinned.git";
  const tree = publish(url, { "SKILL.md": "x\n", "run.sh": "echo hi\n" });
  const source = { git: url, path: "skills/run", commit: tree.commit, digest: "0".repeat(64) };
  expect(await machineWith(skill(source)).plan()).toEqual({
    ok: false,
    finding: {
      code: "profile.source-digest",
      params: { source: `${url} skills/run`, expected: source.digest, found: tree.digest },
    },
  });
});

test("a rules text comes from the folder of a Git pack the profile names", async () => {
  const url = "https://git.example.org/acme/rules.git";
  const manifest = { schemaVersion: 1, kind: "cedarloom.pack", id: "acme.rules", version: "1.0.0", name: "Rules" };
  const entries = { "rules/mine.md": { kind: "rules" } };
  publish(url, {
    "cedarloom-pack.json": JSON.stringify({ ...manifest, minApp: "0.0.0", entries }),
    "rules/mine.md": "- From the pack.\n",
  });
  const part = {
    type: "rules",
    title: "Mine",
    default: "on",
    file: "mine.md",
    text: { pack: "acme.rules", path: "rules/mine.md" },
  };
  const { home, plan } = machineWith({ "rules.mine": part }, { "acme.rules": { git: url, ref: "main" } });
  const write = ok(await plan()).plan?.operations.find((op) => op.kind === "write");
  expect(write).toEqual({
    kind: "write",
    path: join(home, "rules", "mine.md"),
    before: null,
    content: "- From the pack.\n",
  });
});
