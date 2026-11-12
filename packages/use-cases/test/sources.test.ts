import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plan } from "@cedarloom/contracts";
import type { Tree } from "@cedarloom/git";
import { sha256 } from "@cedarloom/ledger";
import { applyPlan, type Fetch, planProfile } from "@cedarloom/use-cases";
import { expect, test, vi } from "vitest";
import { ok, testRoot } from "./harness.ts";

// A released CedarLoom: a development build (0.0.0) loads files for a newer one.
vi.mock("../../profiles/src/version.ts", () => ({ APP_VERSION: "0.1.0" }));

const root = testRoot("sources");

// Each repository's commits, newest last: a fetch by branch takes the newest, a fetch by commit that one.
const commits = new Map<string, Tree[]>();
const publish = (url: string, files: Record<string, string>, executable: string[] = []): Tree => {
  const list = commits.get(url) ?? [];
  const content = Object.entries(files).map(([path, text]) => ({
    path,
    mode: executable.includes(path) ? ("100755" as const) : ("100644" as const),
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

// A machine whose selection names a local profile with these machine parts, packs and project parts.
const machineWith = (machine: object, packs: object = {}, project: object = {}) => {
  const [config, state, home, user, files] = ["config-", "state-", "home-", "user-", "files-"].map((name) =>
    mkdtempSync(join(root, name)),
  );
  if (config === undefined || state === undefined || home === undefined || user === undefined || files === undefined)
    throw new Error("no folders");
  const head = { schemaVersion: 1, kind: "cedarloom.profile", id: "acme.mine", version: "1.0.0", name: "Mine" };
  const file = join(files, "mine.json");
  writeFileSync(file, JSON.stringify({ ...head, minApp: "0.0.0", agents: ["claude-code"], packs, machine, project }));
  const selection = { schemaVersion: 1, kind: "cedarloom.profile-selection", profile: { file }, select: {} };
  writeFileSync(join(config, "profile.json"), JSON.stringify(selection));
  // The machine's level, or a project folder's.
  const plan = (folder?: string) =>
    planProfile(config, state, { home, user }, { fetch: fetchPublished, project: folder });
  return { state, home, plan };
};
const skill = (source: object) => ({ "skill.text": { type: "skill", title: "Text", default: "on", source } });
const paths = (plan: Plan | null) => plan?.operations.map((op) => [op.kind, "path" in op ? op.path : null]);

const DAY = 24 * 60 * 60 * 1000;
test("a followed skill takes its first commit at once, a new one 3 days after it was seen, a moved ref waits anew", async () => {
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
    vi.setSystemTime(Date.now() + 2 * DAY);
    publish(url, { "SKILL.md": "third\n" });
    await plan();
    vi.setSystemTime(Date.now() + DAY);
    const moved = ok(await plan());
    vi.setSystemTime(Date.now() + 2 * DAY);
    const folder = join(home, "skills", "text");
    expect([waiting.plan, waiting.findings.map(({ code }) => code), moved.plan, paths(ok(await plan()).plan)]).toEqual([
      null,
      ["profile.source-waiting"],
      null,
      [
        ["write", join(folder, "SKILL.md")],
        ["delete", join(folder, "notes.md")],
      ],
    ]);
  } finally {
    vi.useRealTimers();
  }
});

const manifestOf = (id: string, entries: object, minApp = "0.0.0") =>
  JSON.stringify({
    schemaVersion: 1,
    kind: "cedarloom.pack",
    id,
    version: "1.0.0",
    name: id,
    minApp,
    entries,
  });
test.for<[string, Record<string, string>, string[], string, boolean]>([
  ["a script", { "SKILL.md": "x\n", "run.sh": "echo hi\n" }, [], "run.sh", false],
  ["a text file that runs", { "SKILL.md": "#!/bin/sh\n" }, ["SKILL.md"], "SKILL.md", false],
  ["a pack manifest in a skill", { "SKILL.md": "x\n", "cedarloom-pack.json": "{}" }, [], "cedarloom-pack.json", false],
  [
    "a pack manifest that runs",
    { "cedarloom-pack.json": manifestOf("acme.run", { "rules/a.md": { kind: "rules" } }) },
    ["cedarloom-pack.json"],
    "cedarloom-pack.json",
    true,
  ],
])("a source that follows a branch with %s is refused", async ([name, files, executable, path, pack]) => {
  const url = `https://git.example.org/acme/${name.replaceAll(" ", "-")}.git`;
  publish(url, files, executable);
  const box = pack
    ? machineWith({}, { "acme.run": { git: url, ref: "main" } })
    : machineWith(skill({ git: url, ref: "main" }));
  expect(await box.plan()).toEqual({
    ok: false,
    finding: { code: "profile.pack-unpinned", params: { source: url, path } },
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

// A skill of the pack acme.newer, whose entry has a Git source of its own: through a project's packs part, or a machine's.
const NEWER = {
  project: [{}, { packs: { type: "packs", title: "Packs", default: "on", packs: ["acme.newer"] } }],
  machine: [skill({ pack: "acme.newer", path: "skills/text" }), {}],
} as const;
test.for(["project", "machine"] as const)(
  "a pack that moves to a manifest for a newer CedarLoom stops the %s's plan, and the record keeps its skill's source",
  async (level) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const [url, own] = [
        `https://git.example.org/acme/${level}.git`,
        `https://git.example.org/acme/${level}-skill.git`,
      ];
      const entries = { "skills/text": { kind: "skill", source: { git: own, ref: "main" } } };
      const used = publish(url, { "cedarloom-pack.json": manifestOf("acme.newer", entries) });
      const text = publish(own, { "SKILL.md": "x\n" });
      const { state, plan } = machineWith(
        NEWER[level][0],
        { "acme.newer": { git: url, ref: "main" } },
        NEWER[level][1],
      );
      const project = level === "project" ? mkdtempSync(join(root, "project-")) : undefined;
      ok(await plan(project));
      const newer = publish(url, { "cedarloom-pack.json": manifestOf("acme.newer", entries, "9.0.0") });
      ok(await plan(project));
      vi.setSystemTime(Date.now() + 3 * DAY);
      expect(await plan(project)).toMatchObject({
        ok: false,
        finding: { code: "profile.app-too-old", params: { minApp: "9.0.0", pack: "acme.newer" } },
      });
      // Each source the record follows, by its `sourceKey`, with the commit in use.
      const followed = () => {
        const record: Record<string, { commit: string }> = JSON.parse(
          readFileSync(join(state, "pack-sources.json"), "utf8"),
        ).sources;
        return Object.fromEntries(Object.entries(record).map(([key, { commit }]) => [key, commit]));
      };
      const [pack, skillSource] = [JSON.stringify([url, "main", ""]), JSON.stringify([own, "main", ""])];
      expect(followed()).toEqual({ [pack]: used.commit, [skillSource]: text.commit });
      if (level === "machine") return;
      // The machine's plan reads no entry of the pack: it goes on, takes the pack's commit, and keeps the skill's source.
      ok(await plan());
      expect(followed()).toEqual({ [pack]: newer.commit, [skillSource]: text.commit });
    } finally {
      vi.useRealTimers();
    }
  },
);

test("while a new commit waits and the one in use cannot be fetched, the plan stops and names the source", async () => {
  const url = "https://git.example.org/acme/gone.git";
  const used = publish(url, { "SKILL.md": "first\n" });
  const { state, plan } = machineWith(skill({ git: url, ref: "main" }));
  const first = ok(await plan()).plan;
  if (first === null) throw new Error("no plan");
  expect(ok(applyPlan(state, first, { yes: true })).status).toBe("applied");
  commits.set(url, [publish(url, { "SKILL.md": "second\n" })]);
  expect(await plan()).toEqual({
    ok: false,
    finding: { code: "profile.source-unavailable", params: { source: url, commit: used.commit } },
  });
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
