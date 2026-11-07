import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import type { Plan } from "@cedarloom/contracts";
import {
  applyPlan,
  claudeHome,
  type Fetch,
  type PlanOptions,
  planChoice,
  planProfile,
  planSwitch,
} from "@cedarloom/use-cases";
import { expect, test, vi } from "vitest";
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
  // The gates, off here so a plan carries no line about their source, are switched back by the tests of them.
  applied(state, ok(planChoice(config, { part: "project.gates", on: false })));
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
    { "project.gates": false },
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
          source: null,
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

// A folder outside the project, linked at `name` inside it (a junction on Windows, which needs no extra privilege; a
// symbolic link elsewhere), by its real path.
const linkedAt = (project: string, name: string): string => {
  const elsewhere = mkdtempSync(join(root, "elsewhere-"));
  mkdirSync(join(project, name, ".."), { recursive: true });
  symlinkSync(elsewhere, join(project, name), "junction");
  return realpathSync.native(elsewhere);
};
const planned = (box: ReturnType<typeof machine>, project: string, fetch: Fetch = stock) =>
  planProfile(box.config, box.state, { home: box.home, user: box.home }, { fetch, project });

test("a target a linked folder leads outside the project stops the plan", async () => {
  const box = machine();
  const project = projectWith();
  const path = join(linkedAt(project, "docs"), "agents", "issue-tracker.md");
  const params = { part: "project.agent-docs", target: "docs/agents/issue-tracker.md", path };
  expect(await planned(box, project)).toEqual({ ok: false, finding: { code: "profile.target-linked", params } });
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

// An app folder shipping cedarloom.orca, whose program is a file in `bin` of a name no PATH holds.
const orcaApp = () => {
  const at = mkdtempSync(join(root, "orca-"));
  const [extension, bin] = [join(at, "app", "cedarloom.orca"), join(at, "bin")];
  mkdirSync(extension, { recursive: true });
  mkdirSync(bin);
  const name = ["cedarloom-test-orca"];
  const manifest = {
    schemaVersion: 1,
    kind: "cedarloom.extension",
    id: "cedarloom.orca",
    version: "1.0.0",
    name: "Orca",
    api: "1.0",
    runtime: { kind: "node", entry: "main.mjs" },
    capabilities: { programs: { orca: { darwin: name, linux: name, win32: name } } },
    contributes: { actions: { status: { title: "Status" } } },
  };
  writeFileSync(join(extension, "cedarloom-extension.json"), JSON.stringify(manifest));
  writeFileSync(join(bin, process.platform === "win32" ? "cedarloom-test-orca.exe" : "cedarloom-test-orca"), "", {
    mode: 0o755,
  });
  return { app: join(at, "app"), bin };
};

test("Orca's worktree files are planned only while its extension is not switched off and its program is found, also when selected", async () => {
  const box = machine();
  const { app, bin } = orcaApp();
  const project = projectWith();
  // The findings about the orca part; on, it waits for its approval, as its files configure a tool.
  const orcaFindings = async () => {
    const result = ok(
      await planProfile(box.config, box.state, { home: box.home, user: box.home }, { app, fetch: stock, project }),
    );
    return result.findings
      .filter((finding) => "part" in finding.params && finding.params.part === "project.orca")
      .map(({ code }) => code);
  };
  const missing = await orcaFindings();
  vi.stubEnv("PATH", `${bin}${delimiter}${process.env["PATH"] ?? ""}`);
  try {
    const found = await orcaFindings();
    applied(box.state, ok(planSwitch(app, box.config, "cedarloom.orca", "off")));
    const off = await orcaFindings();
    applied(box.state, ok(planChoice(box.config, { part: "project.orca", on: true })));
    expect([missing, found, off, await orcaFindings()]).toEqual([
      [],
      ["profile.target-approval"],
      [],
      ["profile.when-unmet"],
    ]);
  } finally {
    vi.unstubAllEnvs();
  }
});

test("a project's plan keeps the record of the machine's skills", async () => {
  const box = await setUp();
  const record = () => readFileSync(join(box.state, "pack-sources.json"), "utf8");
  const before = record();
  await projectPlan(box, projectWith());
  expect(record()).toBe(before);
});

// A profile file: the default with these project parts and packs added.
const profileFile = (file: string, project: Record<string, unknown>, packs: Record<string, unknown> = {}) => {
  const profile = { schemaVersion: 1, kind: "cedarloom.profile", id: "acme.mine", version: "1.0.0", name: "Mine" };
  const extend = { extends: [{ pack: "cedarloom.core", path: "profiles/default.json" }], minApp: "0.0.0" };
  const all = { "cedarloom.core": { bundled: true }, ...packs };
  writeFileSync(file, JSON.stringify({ ...profile, ...extend, packs: all, project }));
};
// A machine whose selection names a profile file of its own.
const custom = (project: Record<string, unknown>, packs: Record<string, unknown> = {}) => {
  const box = machine();
  const file = join(box.config, "mine.json");
  profileFile(file, project, packs);
  const selection = JSON.parse(readFileSync(join(box.config, "profile.json"), "utf8"));
  writeFileSync(join(box.config, "profile.json"), JSON.stringify({ ...selection, profile: { file } }));
  return { ...box, file };
};

test("a project's deny list grows by the profile's rules, the owner's own kept first and each rule once", async () => {
  const set = { permissions: { deny: ["Bash(sudo *)", "Bash(curl *)"] } };
  const box = custom({
    guards: { type: "settings", default: "off" },
    deny: { type: "settings", title: "Deny", default: "on", commit: true, set },
  });
  const mine = { model: "opus", permissions: { deny: ["Bash(rm -rf *)", "Bash(sudo *)"] } };
  const project = projectWith({ ".claude/settings.json": JSON.stringify(mine) });
  applied(box.state, (await projectPlan(box, project)).plan);
  expect(JSON.parse(readFileSync(join(project, ".claude", "settings.json"), "utf8"))).toEqual({
    model: "opus",
    permissions: { deny: ["Bash(rm -rf *)", "Bash(sudo *)", "Bash(curl *)"] },
  });
});

test("a .claude folder a link leads outside the project stops the plan, as its settings would land there", async () => {
  const box = machine();
  const project = projectWith();
  const path = join(linkedAt(project, ".claude"), "settings.json");
  const params = { part: "project", target: ".claude/settings.json", path };
  expect(await planned(box, project)).toEqual({ ok: false, finding: { code: "profile.target-linked", params } });
});

test("a project's plugin waits for its approval with the rules that require it, then goes into the local settings", async () => {
  const marketplace = { name: "acme", github: "acme/plugins", ref: "v2" };
  const lsp = { type: "plugin", title: "LSP", default: "on", commit: false, plugin: "lsp@acme", marketplace };
  const line = { inline: "- Use the LSP.\n" };
  const box = custom({
    lsp,
    "lsp-line": { type: "local-manual", title: "LSP line", default: "on", requires: ["project.lsp"], rules: [line] },
  });
  const project = projectWith();
  const waiting = await projectPlan(box, project);
  const approved = (await projectPlan(box, project, ["project.lsp"])).plan;
  applied(box.state, approved);
  const local = join(project, "CLAUDE.local.md");
  expect([
    waiting.findings,
    [waiting.plan, approved].map((plan) => contentOf(plan, local)?.includes("Use the LSP")),
    JSON.parse(readFileSync(join(project, ".claude", "settings.local.json"), "utf8")),
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
    [false, true],
    {
      extraKnownMarketplaces: { acme: { source: { source: "github", repo: "acme/plugins", ref: "v2" } } },
      enabledPlugins: { "lsp@acme": true },
    },
    "# cedarloom start /\n/CLAUDE.local.md\n/.claude/settings.local.json\n# cedarloom end /\n",
    { plan: null, findings: [] },
  ]);
});

const treeFile = (path: string, content: string) => ({
  path,
  mode: "100644" as const,
  sha256: "3".repeat(64),
  content: Buffer.from(content),
});
// The test's packs (`a.git`, `b.git`) as one commit with a manifest that lists these entries and a skill's folder,
// `skills/review`, with these files more; any other source as `stock`'s.
const packWith =
  (entries: Record<string, unknown>, more: string[] = []): Fetch =>
  async (source, options) => {
    if (!/\/[ab]\.git$/.test(source.url)) return stock(source, options);
    const manifest = { schemaVersion: 1, kind: "cedarloom.pack", id: "acme.skills", version: "1.0.0", name: "Skills" };
    const text = JSON.stringify({ ...manifest, minApp: "0.1.0", entries });
    const extra = more.map((path) => treeFile(path, "{}\n"));
    const files = [treeFile("cedarloom-pack.json", text), treeFile("skills/review/SKILL.md", "# Review\n"), ...extra];
    return { ok: true, value: { commit: "1".repeat(40), digest: "2".repeat(64), files } };
  };
const REVIEW = { "skills/review": { kind: "skill" } };
const packs = packWith(REVIEW);
const SKILLS = { "acme.skills": { git: "https://x.example/a.git", ref: "main" } };
const packsPart = (list: string[], more: Record<string, unknown> = {}) => ({
  packs: { type: "packs", title: "Packs", default: "on", packs: list, ...more },
});

test("a project's packs install their skills in the project, and a pack taken out of the list takes them away", async () => {
  const box = custom(packsPart(["acme.skills"]), SKILLS);
  const project = projectWith();
  const plan = ok(await planned(box, project, packs)).plan;
  applied(box.state, plan);
  profileFile(box.file, packsPart([]), SKILLS);
  const path = join(project, ".claude", "skills", "review", "SKILL.md");
  const after = ok(await planned(box, project, packs)).plan?.operations.map((op) => [op.kind, "path" in op && op.path]);
  expect([contentOf(plan, path), after]).toEqual(["# Review\n", [["delete", path]]]);
});

test("two skills of one name, or a skills folder a link leads elsewhere, stop the plan", async () => {
  const more = { ...SKILLS, "acme.more": { git: "https://x.example/b.git", ref: "main" } };
  const [project, linked] = [projectWith(), projectWith()];
  const elsewhere = linkedAt(linked, ".claude/skills");
  const skills = ["acme.skills/skills/review", "acme.more/skills/review"];
  const twice = { folder: join(project, ".claude", "skills", "review"), skills };
  const path = join(elsewhere, "review", "SKILL.md");
  expect([
    await planned(custom(packsPart(["acme.skills", "acme.more"]), more), project, packs),
    await planned(custom(packsPart(["acme.skills"]), SKILLS), linked, packs),
  ]).toEqual([
    { ok: false, finding: { code: "profile.skill-twice", params: twice } },
    {
      ok: false,
      finding: {
        code: "profile.target-linked",
        params: { part: "project", target: ".claude/skills/review/SKILL.md", path },
      },
    },
  ]);
});

test("a machine's plan keeps the record of a project's skill sources, even of a part a project's probe switches on", async () => {
  const source = { git: "https://x.example/skill.git", ref: "main" };
  const fetch = packWith({ "skills/review": { kind: "skill", source } });
  const box = custom(packsPart(["acme.skills"], { default: "auto", when: "devcontainer" }), SKILLS);
  const where = { home: box.home, user: box.user };
  ok(await planProfile(box.config, box.state, where, { fetch, project: projectWith({ ".devcontainer.json": "{}" }) }));
  // The record's entry for the skill's source, by its `sourceKey`.
  const entry = () =>
    JSON.parse(readFileSync(join(box.state, "pack-sources.json"), "utf8")).sources[
      JSON.stringify([source.git, source.ref, ""])
    ];
  const before = entry();
  ok(await planProfile(box.config, box.state, where, { fetch, allow: PLUGINS }));
  expect([entry(), before?.commit]).toEqual([before, "1".repeat(40)]);
});

test("gates wait for their approval by name, so --yes alone never writes a CI file, and need their workflow source", async () => {
  const box = custom({
    ci: { type: "gates", title: "CI", default: "on", callers: ["lint"], dependabotCooldownDays: 5 },
  });
  const project = projectWith();
  const unbound = await planned(box, project);
  applied(box.state, ok(planChoice(box.config, { gates: `acme/workflows@${"a".repeat(40)}` })));
  const waiting = await projectPlan(box, project);
  const approved = (await projectPlan(box, project, ["project.ci"])).plan;
  const [caller, dependabot] = [".github/workflows/lint.yml", ".github/dependabot.yml"];
  const configs = [caller, dependabot];
  expect([
    unbound,
    waiting.findings,
    configs.map((target) => contentOf(waiting.plan, join(project, target))),
    configs.map((target) => contentOf(approved, join(project, target))),
  ]).toEqual([
    { ok: false, finding: { code: "profile.binding-missing", params: { part: "project.ci", binding: "gates" } } },
    [
      {
        code: "profile.target-approval",
        params: {
          part: "project.ci",
          title: "CI",
          project,
          source: `acme/workflows@${"a".repeat(40)}`,
          programs: [],
          configs,
        },
      },
    ],
    [null, null],
    [
      `name: lint\non:\n  pull_request:\n  merge_group:\npermissions: {}\njobs:\n  lint:\n    uses: acme/workflows/.github/workflows/lint.yml@${"a".repeat(40)}\n    permissions:\n      contents: read\n`,
      'version: 2\nupdates:\n  - package-ecosystem: github-actions\n    directory: /\n    schedule:\n      interval: weekly\n    cooldown:\n      default-days: 5\n    ignore:\n      - dependency-name: "acme/workflows"\n      - dependency-name: "acme/workflows/*"\n',
    ],
  ]);
});
test("the default gates stay off with one line until this machine binds their source, then wait for approval", async () => {
  const box = machine();
  applied(box.state, ok(planChoice(box.config, { part: "project.gates", on: null })));
  const project = projectWith();
  const unbound = await projectPlan(box, project);
  applied(box.state, ok(planChoice(box.config, { gates: `acme/workflows@${"a".repeat(40)}` })));
  const bound = (await projectPlan(box, project)).findings.map(({ code, params }) => [
    code,
    "part" in params && params.part,
  ]);
  expect([unbound.findings, bound]).toEqual([
    [{ code: "profile.binding-waiting", params: { part: "project.gates", binding: "gates" } }],
    [["profile.target-approval", "project.gates"]],
  ]);
});

test("two parts that write one file stop the plan", async () => {
  const gate = { type: "gates", title: "CI", default: "on", dependabotCooldownDays: 5 };
  const box = custom({ ci: { ...gate, callers: ["lint"] }, more: { ...gate, callers: ["test"] } });
  applied(box.state, ok(planChoice(box.config, { gates: `acme/workflows@${"a".repeat(40)}` })));
  const params = { part: "project.more", target: ".github/dependabot.yml" };
  expect(
    await planProfile(
      box.config,
      box.state,
      { home: box.home, user: box.home },
      {
        fetch: stock,
        project: projectWith(),
        allow: ["project.ci", "project.more"],
      },
    ),
  ).toEqual({ ok: false, finding: { code: "profile.target-twice", params } });
});

// A Template as one image in `.devcontainer/` and a Dependabot file; the request it was last asked for.
let asked: unknown;
const template: PlanOptions["template"] = async (folder, request) => {
  asked = request;
  mkdirSync(join(folder, ".devcontainer"));
  writeFileSync(join(folder, ".devcontainer", "devcontainer.json"), '{ "image": "alpine" }\n');
  mkdirSync(join(folder, ".github"));
  writeFileSync(join(folder, ".github", "dependabot.yml"), "version: 2\n");
  return null;
};
const REQUEST = {
  template: `ghcr.io/devcontainers/templates/alpine@sha256:${"0".repeat(64)}`,
  args: { imageVariant: "3.20" },
  features: { "ghcr.io/devcontainers/features/node:1": { version: "lts" } },
};

test("a dev container part is approved before its Template runs, and writes only the dev container it made", async () => {
  asked = undefined;
  const box = custom({ dc: { type: "devcontainer", title: "Alpine", default: "on", ...REQUEST } });
  const [fresh, existing] = [projectWith(), projectWith({ ".devcontainer.json": "{}" })];
  const run = (project: string, allow: string[], apply = template) =>
    planProfile(
      box.config,
      box.state,
      { home: box.home, user: box.home },
      { fetch: stock, project, allow, template: apply },
    );
  // A project with a dev container runs no Template and asks for no approval of one.
  const keptFindings = ok(await run(existing, [])).findings;
  const keptPlan = ok(await run(existing, ["project.dc"])).plan;
  const waiting = ok(await run(fresh, []));
  const unasked = asked;
  const approved = ok(await run(fresh, ["project.dc"])).plan;
  const params = { part: "project.dc", template: REQUEST.template, error: "unauthorized" };
  const configs = [".devcontainer/"];
  const source = `${REQUEST.template} with the Features ghcr.io/devcontainers/features/node:1`;
  expect([
    waiting.findings,
    [unasked, asked],
    [".devcontainer/devcontainer.json", ".github/dependabot.yml"].map((target) =>
      contentOf(approved, join(fresh, target)),
    ),
    [
      keptFindings.some((finding) => "part" in finding.params && finding.params.part === "project.dc"),
      keptPlan?.operations.some((op) => "path" in op && op.path.includes(".devcontainer")),
    ],
    ok(await run(fresh, ["project.dc"], async () => "unauthorized")).findings,
  ]).toEqual([
    [
      {
        code: "profile.target-approval",
        params: { part: "project.dc", title: "Alpine", project: fresh, source, programs: [], configs },
      },
    ],
    [undefined, REQUEST],
    ['{ "image": "alpine" }\n', null],
    [false, false],
    [{ code: "profile.template-failed", params }],
  ]);
});

const plugin = (path: string) => ({ skill: "acme.skills/skills/review", path });

test("a skill's file a link leads onto a sealed name, or a skill that is a plugin, stops the plan", async () => {
  const pinned = { "acme.skills": { git: "https://x.example/a.git", commit: "1".repeat(40), digest: "2".repeat(64) } };
  const box = custom(packsPart(["acme.skills"]), pinned);
  const linked = projectWith();
  mkdirSync(join(linked, ".claude", "skills"), { recursive: true });
  // A junction on Windows, which needs no extra privilege; a symbolic link elsewhere.
  symlinkSync(join(linked, ".claude"), join(linked, ".claude", "skills", "review"), "junction");
  const target = ".claude/skills/review/settings.json";
  const params = { part: "project", target, path: join(linked, ".claude", "settings.json") };
  expect([
    await planned(box, linked, packWith(REVIEW, ["skills/review/settings.json"])),
    await planned(box, projectWith(), packWith(REVIEW, ["skills/review/.claude-plugin/plugin.json"])),
    await planned(box, projectWith(), packWith(REVIEW, ["skills/review/.Claude-Plugin/plugin.json"])),
  ]).toEqual([
    { ok: false, finding: { code: "profile.target-linked", params } },
    { ok: false, finding: { code: "profile.skill-plugin", params: plugin(".claude-plugin/plugin.json") } },
    { ok: false, finding: { code: "profile.skill-plugin", params: plugin(".Claude-Plugin/plugin.json") } },
  ]);
});

test("a files target in the skills folder goes when its part is switched off", async () => {
  const files = { ".claude/skills/foo/SKILL.md": { inline: "# Foo\n" } };
  const box = custom({ notes: { type: "files", title: "Notes", default: "on", commit: true, files } });
  const project = projectWith();
  applied(box.state, (await projectPlan(box, project, ["project.notes"])).plan);
  applied(box.state, ok(planChoice(box.config, { part: "project.notes", on: false })));
  applied(box.state, (await projectPlan(box, project)).plan);
  expect(existsSync(join(project, ".claude", "skills", "foo", "SKILL.md"))).toBe(false);
});
