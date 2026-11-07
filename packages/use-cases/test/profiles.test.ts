import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plan } from "@cedarloom/contracts";
import { applyPlan, claudeHome, type Fetch, planChoice, planProfile } from "@cedarloom/use-cases";
import { expect, test } from "vitest";
import { ok, testRoot } from "./harness.ts";

const root = testRoot("profiles");
// Every Git source as one commit holding a skill's file, so no test fetches from the network.
const stock: Fetch = async () => {
  const content = Buffer.from("# Skill\n");
  const file = { path: "SKILL.md", mode: "100644" as const, sha256: "3".repeat(64), content };
  return { ok: true, value: { commit: "1".repeat(40), digest: "2".repeat(64), files: [file] } };
};
const applied = (state: string, plan: Plan | null): void => {
  if (plan === null) throw new Error("no plan");
  expect(ok(applyPlan(state, plan, { yes: true })).status).toBe("applied");
};

// The default profile's plugin parts, approved by name.
const PLUGINS = ["machine.plugin.cedarloom", "machine.plugin.ponytail", "machine.plugin.matt-pocock"];
// A machine with its hub named: config, state, Claude Code home and user home folders of its own.
const machine = () => {
  const [config, state, home, user] = ["config-", "state-", "home-", "user-"].map((name) =>
    mkdtempSync(join(root, name)),
  );
  if (config === undefined || state === undefined || home === undefined || user === undefined)
    throw new Error("no folders");
  applied(state, ok(planChoice(config, { hub: "acme/hub" })));
  return {
    config,
    state,
    home,
    user,
    plan: async () => ok(await planProfile(config, state, { home, user }, { allow: PLUGINS, fetch: stock })),
  };
};
const setUp = async () => {
  const box = machine();
  applied(box.state, (await box.plan()).plan);
  return box;
};

test("a second apply has nothing left to do, and the question rule names the hub", async () => {
  const { home, plan } = await setUp();
  const rule = readFileSync(join(home, "rules", "cedarloom-hub.md"), "utf8");
  expect([await plan(), rule.includes("hub repository `acme/hub`")]).toEqual([{ plan: null, findings: [] }, true]);
});

test("a part switched off takes away the file CedarLoom wrote for it, never another file in the folder", async () => {
  const { config, state, home, plan } = await setUp();
  // The owner's own rules file, written by a plan of their own: CedarLoom wrote it, but for no part.
  const mine = { kind: "write" as const, path: join(home, "rules", "mine.md"), before: null, content: "- mine\n" };
  applied(state, { schemaVersion: 1, operations: [mine] });
  applied(state, ok(planChoice(config, { part: "machine.rules.global", on: false })));
  const operations = (await plan()).plan?.operations.map(({ kind, ...rest }) => [
    kind,
    "path" in rest ? rest.path : null,
  ]);
  expect(operations).toEqual([["delete", join(home, "rules", "00-global.md")]]);
});

test("a rules file the owner changed is left as it is and reported", async () => {
  const { home, plan } = await setUp();
  const path = join(home, "rules", "00-global.md");
  writeFileSync(path, "- my own rules\n");
  expect(await plan()).toEqual({ plan: null, findings: [{ code: "profile.owner-changed", params: { path } }] });
});

test("a rules file the owner deleted is written again", async () => {
  const { home, plan } = await setUp();
  const path = join(home, "rules", "00-global.md");
  rmSync(path);
  expect((await plan()).plan?.operations.map((op) => [op.kind, "path" in op ? op.path : null])).toEqual([
    ["write", path],
  ]);
});

test("a part switched off leaves its file when the owner changed it, and reports it", async () => {
  const { config, state, home, plan } = await setUp();
  const path = join(home, "rules", "00-global.md");
  writeFileSync(path, "- my own rules\n");
  applied(state, ok(planChoice(config, { part: "machine.rules.global", on: false })));
  expect(await plan()).toEqual({ plan: null, findings: [{ code: "profile.owner-changed", params: { path } }] });
});

test("a settings file that is no JSON is never rewritten", async () => {
  const { config, state, home } = machine();
  const path = join(home, "settings.json");
  writeFileSync(path, '{ "model": "opus", // mine\n}');
  expect(await planProfile(config, state, { home, user: home }, { fetch: stock })).toEqual({
    ok: false,
    finding: { code: "document.unreadable", params: { path, error: "not JSON" } },
  });
});

test("the selection names only the profile's parts, and a part goes back to its default", () => {
  const { config, state } = machine();
  applied(state, ok(planChoice(config, { part: "workspace.memory", on: false })));
  applied(state, ok(planChoice(config, { part: "workspace.memory", on: null })));
  const selection = JSON.parse(readFileSync(join(config, "profile.json"), "utf8"));
  expect([selection.select, planChoice(config, { part: "machine.rules.gone", on: true })]).toEqual([
    {},
    {
      ok: false,
      finding: { code: "profile.part-unknown", params: { part: "machine.rules.gone", by: "The selection" } },
    },
  ]);
});

test("a Claude Code home not made yet is named as the disk will name it, through a linked folder", () => {
  const folder = mkdtempSync(join(root, "real-"));
  const link = join(root, `link-${folder.slice(-6)}`);
  // A junction on Windows, which needs no extra privilege; a symbolic link elsewhere.
  symlinkSync(folder, link, "junction");
  expect(claudeHome({ CLAUDE_CONFIG_DIR: join(link, "home") })).toBe(join(realpathSync.native(folder), "home"));
});

test("a plugin's options never land in CedarLoom's state, where the worker homes are", async () => {
  const { config, state, home, user } = machine();
  mkdirSync(join(user, ".config"));
  // A junction on Windows, which needs no extra privilege; a symbolic link elsewhere.
  symlinkSync(state, join(user, ".config", "ponytail"), "junction");
  const path = join(user, ".config", "ponytail", "config.json");
  expect(await planProfile(config, state, { home, user }, { allow: PLUGINS, fetch: stock })).toEqual({
    ok: false,
    finding: { code: "profile.options-guarded", params: { part: "machine.plugin.ponytail", path } },
  });
});

// A project folder in Git, as `git init` leaves it for the exclude file, with files of the owner's.
const projectWith = (files: Record<string, string> = {}): string => {
  const project = mkdtempSync(join(root, "project-"));
  mkdirSync(join(project, ".git", "info"), { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(project, path, ".."), { recursive: true });
    writeFileSync(join(project, path), text);
  }
  return project;
};
const projectPlan = async (box: ReturnType<typeof machine>, project: string, allow: string[] = []) =>
  ok(await planProfile(box.config, box.state, { home: box.home, user: box.home }, { fetch: stock, project, allow }));

test("a project gets the manual's block, a CLAUDE.md that only imports AGENTS.md, and its local file ignored by Git", async () => {
  const box = machine();
  const project = projectWith();
  applied(box.state, (await projectPlan(box, project)).plan);
  const read = (path: string) => readFileSync(join(project, path), "utf8");
  expect([
    read("CLAUDE.md"),
    read("AGENTS.md").startsWith("<!-- cedarloom start -->\n"),
    read("CLAUDE.local.md").includes("@AGENTS.md"),
    readFileSync(join(project, ".git", "info", "exclude"), "utf8"),
    (await projectPlan(box, project)).plan,
  ]).toEqual(["@AGENTS.md\n", true, false, "# cedarloom start /\n/CLAUDE.local.md\n# cedarloom end /\n", null]);
});

test("the block goes into the owner's AGENTS.md, which keeps its own lines, and imports it where CLAUDE.md does not", async () => {
  const box = machine();
  // A marker the owner quotes inside a line is text.
  const mine = "# Mine\n\n- Keep <!-- cedarloom start --> lines.\n";
  const project = projectWith({ "AGENTS.md": mine, "CLAUDE.md": "# Notes\n" });
  applied(box.state, (await projectPlan(box, project)).plan);
  const agents = readFileSync(join(project, "AGENTS.md"), "utf8");
  expect([
    agents.startsWith(`${mine}\n<!-- cedarloom start -->\n`) && agents.endsWith("<!-- cedarloom end -->\n"),
    readFileSync(join(project, "CLAUDE.md"), "utf8"),
    readFileSync(join(project, "CLAUDE.local.md"), "utf8").includes("@AGENTS.md\n<!-- cedarloom end -->"),
  ]).toEqual([true, "# Notes\n", true]);
});

const contentOf = (plan: Plan | null, path: string) => {
  const op = plan?.operations.find((each) => "path" in each && each.path === path);
  return op?.kind === "write" ? op.content : null;
};

test("with a dev container, scripts/dc waits for approval with its local line; approved and in place, it stays without", async () => {
  const box = machine();
  const project = projectWith({ ".devcontainer.json": "{}" });
  const waiting = await projectPlan(box, project);
  const approved = (await projectPlan(box, project, ["project.dc-wrapper"])).plan;
  applied(box.state, approved);
  const script = approved?.operations.find((op) => "path" in op && op.path === join(project, "scripts", "dc"));
  expect([
    waiting.findings,
    contentOf(waiting.plan, join(project, "CLAUDE.local.md"))?.includes("scripts/dc"),
    contentOf(approved, join(project, "CLAUDE.local.md"))?.includes("scripts/dc"),
    script?.kind === "write" ? script.mode : null,
    readFileSync(join(project, ".git", "info", "exclude"), "utf8"),
    await projectPlan(box, project),
  ]).toEqual([
    [
      {
        code: "profile.target-approval",
        params: {
          part: "project.dc-wrapper",
          title: "scripts/dc, the dev container command",
          project,
          programs: ["scripts/dc"],
          configs: [],
        },
      },
    ],
    false,
    true,
    0o755,
    "# cedarloom start /\n/CLAUDE.local.md\n/scripts/dc\n# cedarloom end /\n",
    { plan: null, findings: [] },
  ]);
});

test("projects in subfolders of one repository each keep a block of their own, by their paths from its root", async () => {
  const box = machine();
  const repository = projectWith({ "packages/a/README.md": "a\n", "packages/b/README.md": "b\n" });
  for (const name of ["a", "b"]) applied(box.state, (await projectPlan(box, join(repository, "packages", name))).plan);
  expect(readFileSync(join(repository, ".git", "info", "exclude"), "utf8")).toBe(
    "# cedarloom start /packages/a\n/packages/a/CLAUDE.local.md\n# cedarloom end /packages/a\n\n" +
      "# cedarloom start /packages/b\n/packages/b/CLAUDE.local.md\n# cedarloom end /packages/b\n",
  );
});

test("a linked worktree's local file is ignored through its repository's common Git folder", async () => {
  const box = machine();
  const main = projectWith();
  const worktree = mkdtempSync(join(root, "worktree-"));
  const gitdir = join(main, ".git", "worktrees", "wt");
  mkdirSync(gitdir, { recursive: true });
  writeFileSync(join(gitdir, "commondir"), "../..\n");
  writeFileSync(join(worktree, ".git"), `gitdir: ${gitdir}\n`);
  expect(contentOf((await projectPlan(box, worktree)).plan, join(main, ".git", "info", "exclude"))).toBe(
    "# cedarloom start /\n/CLAUDE.local.md\n# cedarloom end /\n",
  );
});

test("a target a linked folder leads outside the project stops the plan", async () => {
  const box = machine();
  const project = projectWith();
  const elsewhere = mkdtempSync(join(root, "elsewhere-"));
  // A junction on Windows, which needs no extra privilege; a symbolic link elsewhere.
  symlinkSync(elsewhere, join(project, "docs"), "junction");
  const path = join(realpathSync.native(elsewhere), "agents", "issue-tracker.md");
  const params = { part: "project.agent-docs", target: "docs/agents/issue-tracker.md", path };
  expect(
    await planProfile(box.config, box.state, { home: box.home, user: box.home }, { fetch: stock, project }),
  ).toEqual({ ok: false, finding: { code: "profile.target-linked", params } });
});

test("an owner's own scripts/dc stays as it is and Git keeps showing it", async () => {
  const box = machine();
  const project = projectWith({ ".devcontainer.json": "{}", "scripts/dc": "#!/bin/sh\necho mine\n" });
  const { plan, findings } = await projectPlan(box, project, ["project.dc-wrapper"]);
  expect([findings, contentOf(plan, join(project, ".git", "info", "exclude"))]).toEqual([
    [{ code: "profile.owner-changed", params: { path: join(project, "scripts", "dc") } }],
    "# cedarloom start /\n/CLAUDE.local.md\n# cedarloom end /\n",
  ]);
});

test("an owner's CLAUDE.md that leaves AGENTS.md unread is reported, not changed", async () => {
  const box = machine();
  applied(box.state, ok(planChoice(box.config, { part: "project.local-manual", on: false })));
  const project = projectWith({ "CLAUDE.md": "# Notes\n" });
  const { plan, findings } = await projectPlan(box, project);
  expect([findings, contentOf(plan, join(project, "CLAUDE.md"))]).toEqual([
    [{ code: "profile.agents-unread", params: { path: join(project, "CLAUDE.md") } }],
    null,
  ]);
});

test("the manual switched off takes its block out, leaving the owner's file as it was", async () => {
  const box = machine();
  const project = projectWith({ "AGENTS.md": "# Mine\n" });
  applied(box.state, (await projectPlan(box, project)).plan);
  applied(box.state, ok(planChoice(box.config, { part: "project.manual", on: false })));
  applied(box.state, (await projectPlan(box, project)).plan);
  expect(readFileSync(join(project, "AGENTS.md"), "utf8")).toBe("# Mine\n");
});

test("a broken block, or a project that is no folder, stops the plan", async () => {
  const box = machine();
  const project = projectWith({ "AGENTS.md": "<!-- cedarloom start -->\n- Mine.\n" });
  const missing = join(root, "no-such-project");
  const plans = [
    await planProfile(box.config, box.state, { home: box.home, user: box.home }, { fetch: stock, project }),
  ];
  plans.push(
    await planProfile(box.config, box.state, { home: box.home, user: box.home }, { fetch: stock, project: missing }),
  );
  expect(plans).toEqual([
    {
      ok: false,
      finding: {
        code: "document.unreadable",
        params: { path: join(project, "AGENTS.md"), error: "a broken cedarloom block" },
      },
    },
    { ok: false, finding: { code: "document.unreadable", params: { path: missing, error: "not a folder" } } },
  ]);
});

test("a project's plan keeps the record of the machine's skills", async () => {
  const box = await setUp();
  const record = () => readFileSync(join(box.state, "pack-sources.json"), "utf8");
  const before = record();
  await projectPlan(box, projectWith());
  expect(record()).toBe(before);
});

test("the project's deny list grows by the profile's rules and keeps the owner's own, first", async () => {
  const box = machine();
  const mine = { model: "opus", permissions: { deny: ["Bash(rm -rf *)"] } };
  const project = projectWith({ ".claude/settings.json": JSON.stringify(mine) });
  applied(box.state, (await projectPlan(box, project)).plan);
  const settings = JSON.parse(readFileSync(join(project, ".claude", "settings.json"), "utf8"));
  expect([settings.model, settings.permissions.deny.slice(0, 2), settings.permissions.deny.length]).toEqual([
    "opus",
    ["Bash(rm -rf *)", "Bash(git commit *--no-verify*)"],
    13,
  ]);
});

test("a .claude folder a link leads outside the project stops the plan, as its settings would land there", async () => {
  const box = machine();
  const project = projectWith();
  const elsewhere = mkdtempSync(join(root, "claude-"));
  // A junction on Windows, which needs no extra privilege; a symbolic link elsewhere.
  symlinkSync(elsewhere, join(project, ".claude"), "junction");
  const params = { part: "project", target: ".claude", path: realpathSync.native(elsewhere) };
  expect(
    await planProfile(box.config, box.state, { home: box.home, user: box.home }, { fetch: stock, project }),
  ).toEqual({ ok: false, finding: { code: "profile.target-linked", params } });
});

// A machine whose selection names a profile file: the default with these project parts and packs added.
const custom = (project: Record<string, unknown>, packs: Record<string, unknown> = {}) => {
  const box = machine();
  const file = join(box.config, "mine.json");
  const profile = { schemaVersion: 1, kind: "cedarloom.profile", id: "acme.mine", version: "1.0.0", name: "Mine" };
  const extend = { extends: [{ pack: "cedarloom.core", path: "profiles/default.json" }], minApp: "0.0.0" };
  writeFileSync(
    file,
    JSON.stringify({ ...profile, ...extend, packs: { "cedarloom.core": { bundled: true }, ...packs }, project }),
  );
  const selection = JSON.parse(readFileSync(join(box.config, "profile.json"), "utf8"));
  writeFileSync(join(box.config, "profile.json"), JSON.stringify({ ...selection, profile: { file } }));
  return box;
};

test("a project's plugin waits for its approval, then goes into the local settings, which Git ignores", async () => {
  const marketplace = { name: "acme", github: "acme/plugins", ref: "v2" };
  const lsp = { type: "plugin", title: "LSP", default: "on", commit: false, plugin: "lsp@acme", marketplace };
  const box = custom({ lsp });
  const project = projectWith();
  const waiting = await projectPlan(box, project);
  applied(box.state, (await projectPlan(box, project, ["project.lsp"])).plan);
  const local = JSON.parse(readFileSync(join(project, ".claude", "settings.local.json"), "utf8"));
  expect([
    waiting.findings,
    local,
    readFileSync(join(project, ".git", "info", "exclude"), "utf8"),
    await projectPlan(box, project),
  ]).toEqual([
    [
      {
        code: "profile.approval-needed",
        params: {
          part: "project.lsp",
          plugin: "lsp@acme",
          source: "acme/plugins",
          ref: "v2",
          autoUpdate: false,
          project,
        },
      },
    ],
    {
      extraKnownMarketplaces: { acme: { source: { source: "github", repo: "acme/plugins", ref: "v2" } } },
      enabledPlugins: { "lsp@acme": true },
    },
    "# cedarloom start /\n/CLAUDE.local.md\n/.claude/settings.local.json\n# cedarloom end /\n",
    { plan: null, findings: [] },
  ]);
});

// The test's packs (`a.git`, `b.git`) as one commit with a manifest that lists these entries and a skill's folder,
// `skills/review`; any other source as `stock`'s.
const packWith =
  (entries: Record<string, unknown>): Fetch =>
  async (source, options) => {
    if (!/\/[ab]\.git$/.test(source.url)) return stock(source, options);
    const manifest = { schemaVersion: 1, kind: "cedarloom.pack", id: "acme.skills", version: "1.0.0", name: "Skills" };
    const text = JSON.stringify({ ...manifest, minApp: "0.1.0", entries });
    const file = (path: string, content: string) => ({
      path,
      mode: "100644" as const,
      sha256: "3".repeat(64),
      content: Buffer.from(content),
    });
    const files = [file("cedarloom-pack.json", text), file("skills/review/SKILL.md", "# Review\n")];
    return { ok: true, value: { commit: "1".repeat(40), digest: "2".repeat(64), files } };
  };
const packs = packWith({ "skills/review": { kind: "skill" } });
const packed = (box: ReturnType<typeof machine>, project: string) =>
  planProfile(box.config, box.state, { home: box.home, user: box.home }, { fetch: packs, project });

test("a project's packs install their skills in the project, and two skills of one name refuse the plan", async () => {
  const sources = { "acme.skills": { git: "https://x.example/a.git", ref: "main" } };
  const one = custom({ packs: { type: "packs", title: "Packs", default: "on", packs: ["acme.skills"] } }, sources);
  const project = projectWith();
  const two = custom(
    { packs: { type: "packs", title: "Packs", default: "on", packs: ["acme.skills", "acme.more"] } },
    { ...sources, "acme.more": { git: "https://x.example/b.git", ref: "main" } },
  );
  const folder = join(project, ".claude", "skills", "review");
  expect([
    contentOf(ok(await packed(one, project)).plan, join(folder, "SKILL.md")),
    await packed(two, project),
  ]).toEqual([
    "# Review\n",
    { ok: false, finding: { code: "profile.skill-twice", params: { part: "project.packs", folder } } },
  ]);
});

test("a machine's plan keeps the record of a project's skill sources, so their wait does not start over", async () => {
  const source = { git: "https://x.example/skill.git", ref: "main" };
  const fetch = packWith({ "skills/review": { kind: "skill", source } });
  const box = custom(
    { packs: { type: "packs", title: "Packs", default: "on", packs: ["acme.skills"] } },
    { "acme.skills": { git: "https://x.example/a.git", ref: "main" } },
  );
  const where = { home: box.home, user: box.user };
  ok(await planProfile(box.config, box.state, where, { fetch, project: projectWith() }));
  // The record's entry for the skill's source, by its `sourceKey`.
  const entry = () =>
    JSON.parse(readFileSync(join(box.state, "pack-sources.json"), "utf8")).sources[
      JSON.stringify([source.git, source.ref, ""])
    ];
  const before = entry();
  ok(await planProfile(box.config, box.state, where, { fetch, allow: PLUGINS }));
  expect([entry(), before?.commit]).toEqual([before, "1".repeat(40)]);
});
