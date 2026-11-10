import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import type { Finding, Plan } from "@cedarloom/contracts";
import { createHash } from "node:crypto";
import {
  applyPlan,
  checkProfile,
  claudeHome,
  type Fetch,
  type PlanOptions,
  planChoice,
  planProfile,
  planSwitch,
  profileDoctor,
  showProfile,
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
// A fresh machine: config, state, Claude Code home and user home folders of its own.
const folders = () => {
  const [config, state, home, user] = ["config-", "state-", "home-", "user-"].map((name) =>
    mkdtempSync(join(root, name)),
  );
  if (config === undefined || state === undefined || home === undefined || user === undefined)
    throw new Error("no folders");
  return { config, state, home, user };
};
// A machine with its hub named.
const machine = () => {
  const { config, state, home, user } = folders();
  applied(state, ok(planChoice(config, { hub: "acme/hub" })));
  // The gates, off here so a plan carries no line about their source, are switched back by the tests of them.
  applied(state, ok(planChoice(config, { part: "project.gates", on: false })));
  // find-skills, off by default, is the machine's one Git source, which the tests of fetched sources need.
  applied(state, ok(planChoice(config, { part: "machine.skill.find-skills", on: true })));
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
    { "project.gates": false, "machine.skill.find-skills": true },
    {
      ok: false,
      finding: { code: "profile.part-unknown", params: { part: "machine.rules.gone", by: "The selection" } },
    },
  ]);
});

test("the view names the probe of an auto part the selection leaves to it, and none once the selection names it", async () => {
  const { config, state, home, user } = machine();
  const { parts } = ok(await showProfile(config, state, { home, user }, { fetch: stock }));
  const shown = parts.filter((part) =>
    ["project.dc-wrapper", "project.gates", "machine.rules.global"].includes(part.id),
  );
  expect(shown.map(({ id, on, when }) => ({ id, on, when }))).toEqual([
    { id: "machine.rules.global", on: true, when: null },
    { id: "project.dc-wrapper", on: false, when: "devcontainer" },
    { id: "project.gates", on: false, when: null },
  ]);
});

test("a machine without its hub's binding gets a view held back, as profiles apply refuses its plan", async () => {
  const { config, state, home, user } = folders();
  const { held, plan, findings } = ok(await showProfile(config, state, { home, user }, { fetch: stock }));
  expect({ held, plan, codes: findings.map(({ code }) => code) }).toEqual({
    held: true,
    plan: null,
    codes: ["profile.binding-missing"],
  });
});

test("a Claude Code home not made yet is named as the disk will name it, through a linked folder", () => {
  const folder = mkdtempSync(join(root, "real-"));
  const link = join(root, `link-${folder.slice(-6)}`);
  // A junction on Windows, which needs no extra privilege; a symbolic link elsewhere.
  symlinkSync(folder, link, "junction");
  expect(claudeHome({ CLAUDE_CONFIG_DIR: join(link, "home") })).toBe(join(realpathSync.native(folder), "home"));
});

test("a plugin's options never land in CedarLoom's state", async () => {
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

test("a .cedarloom folder a link leads outside the project stops the plan, as the record of its files would land there", async () => {
  const box = machine();
  const project = projectWith();
  const path = join(linkedAt(project, ".cedarloom"), "profile-files.json");
  const params = { part: "project", target: ".cedarloom/profile-files.json", path };
  expect(await planned(box, project)).toEqual({ ok: false, finding: { code: "profile.target-linked", params } });
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

const mcpPart = (server: string, source: object) => ({ type: "mcp", title: server, default: "on", server, source });
const docsServer = mcpPart("docs", { url: "https://mcp.example.com/mcp", bearer: "DOCS_TOKEN" });
const fetchServer = mcpPart("fetch", { pypi: "mcp-server-fetch", version: "2025.4.7" });
const MINE = { mine: { type: "stdio", command: "mine" } };
// The owner's files in formats of their own: tabs without a final line break, and CRLF lines.
const OWNERS = {
  ".mcp.json": JSON.stringify({ mcpServers: MINE }, null, "\t"),
  ".codex/config.toml": 'model = "o3" # mine\r\n',
};
const DOCS_JSON = {
  type: "http",
  url: "https://mcp.example.com/mcp",
  headers: { Authorization: "Bearer ${DOCS_TOKEN}" },
};
const DOCS_TOML = '[mcp_servers.docs]\nurl = "https://mcp.example.com/mcp"\nbearer_token_env_var = "DOCS_TOKEN"';
const FETCH_NEXT = mcpPart("fetch", { pypi: "mcp-server-fetch", version: "2025.5.0" });
const FETCH_NEXT_JSON = '"fetch": {"type":"stdio","command":"uvx","args":["mcp-server-fetch@2025.5.0"]}';
const FETCH_NEXT_TOML = '[mcp_servers.fetch]\ncommand = "uvx"\nargs = ["mcp-server-fetch@2025.5.0"]';
const sha = (text: string | Buffer): string => createHash("sha256").update(text).digest("hex");
// The record's entries of the docs and the newer fetch servers: the hashes of their values' canonical JSON.
const DOCS_RECORD = {
  ".mcp.json": {
    docs: {
      sha256: sha(
        '{"headers":{"Authorization":"Bearer ${DOCS_TOKEN}"},"type":"http","url":"https://mcp.example.com/mcp"}',
      ),
    },
  },
  ".codex/config.toml": {
    docs: { sha256: sha('{"bearer_token_env_var":"DOCS_TOKEN","url":"https://mcp.example.com/mcp"}') },
  },
};
const FETCH_NEXT_RECORD = {
  ".mcp.json": { fetch: { sha256: sha('{"args":["mcp-server-fetch@2025.5.0"],"command":"uvx","type":"stdio"}') } },
  ".codex/config.toml": { fetch: { sha256: sha('{"args":["mcp-server-fetch@2025.5.0"],"command":"uvx"}') } },
};
const fetchConflict = (file: string) => ({
  code: "profile.mcp-conflict",
  params: { part: "project.fetch", server: "fetch", file },
});
// The MCP server entries the project's record names.
const recordedServers = (project: string) =>
  JSON.parse(readFileSync(join(project, ".cedarloom", "profile-files.json"), "utf8")).servers;
// The line of an MCP entry the plan adds, puts in place of CedarLoom's, or takes out, for the part named as its server.
const entryLine = (server: string, change: string, file: string, entry: string) => ({
  code: "profile.mcp-entry",
  params: { part: `project.${server}`, server, change, file, entry },
});

test("an MCP server waits for its approval by name with the parts that require it, then joins the owner's servers in their files' formats", async () => {
  const line = { inline: "- Ask the docs server.\n" };
  const box = custom({
    docs: docsServer,
    "docs-line": { type: "local-manual", title: "Docs line", default: "on", requires: ["project.docs"], rules: [line] },
  });
  const project = projectWith(OWNERS);
  const waiting = await projectPlan(box, project);
  const approved = (await projectPlan(box, project, ["project.docs"])).plan;
  applied(box.state, approved);
  const local = join(project, "CLAUDE.local.md");
  expect([
    waiting.findings,
    contentOf(waiting.plan, join(project, ".mcp.json")),
    [waiting.plan, approved].map((plan) => contentOf(plan, local)?.includes("Ask the docs server")),
    readFileSync(join(project, ".mcp.json"), "utf8"),
    readFileSync(join(project, ".codex", "config.toml"), "utf8"),
    recordedServers(project),
    await projectPlan(box, project),
  ]).toEqual([
    [
      {
        code: "profile.mcp-approval",
        params: {
          part: "project.docs",
          title: "docs",
          project,
          server: "docs",
          transport: "http",
          runs: "https://mcp.example.com/mcp",
          variables: ["DOCS_TOKEN"],
          entries: [
            { file: ".mcp.json", change: "add", entry: `"docs": ${JSON.stringify(DOCS_JSON)}` },
            { file: ".codex/config.toml", change: "add", entry: DOCS_TOML },
          ],
          codex: true,
          unpinned: false,
          installed: null,
        },
      },
    ],
    null,
    [false, true],
    JSON.stringify({ mcpServers: { ...MINE, docs: DOCS_JSON } }, null, "\t"),
    'model = "o3" # mine\r\n\r\n[mcp_servers.docs]\r\nurl = "https://mcp.example.com/mcp"\r\nbearer_token_env_var = "DOCS_TOKEN"\r\n',
    DOCS_RECORD,
    { plan: null, findings: [] },
  ]);
});

test("each kind of MCP source runs its exact package, a devDependency only from the project's own install at an exact version", async () => {
  const box = custom({
    context7: mcpPart("context7", { npm: "@upstash/context7-mcp", version: "1.0.31", env: ["CONTEXT7_API_KEY"] }),
    mantine: mcpPart("mantine", { devDependency: "@mantine/mcp-server" }),
    fetch: fetchServer,
  });
  const allow = ["project.context7", "project.mantine", "project.fetch"];
  const project = projectWith({
    "package.json": JSON.stringify({ devDependencies: { "@mantine/mcp-server": "1.2.0" } }),
  });
  mkdirSync(join(project, ".codex"));
  const bare = projectWith({ "package.json": "{}" });
  const ranged = projectWith({
    "package.json": JSON.stringify({ devDependencies: { "@mantine/mcp-server": "^1.2.0" } }),
  });
  const [listed, unlisted] = [(await projectPlan(box, project, allow)).plan, await projectPlan(box, bare, allow)];
  const servers = (plan: Plan | null, at: string) =>
    JSON.parse(contentOf(plan, join(at, ".mcp.json")) ?? "{}").mcpServers;
  expect([
    servers(listed, project),
    contentOf(listed, join(project, ".codex", "config.toml")),
    Object.keys(servers(unlisted.plan, bare)),
    unlisted.findings.filter(({ code }) => code === "profile.mcp-dependency"),
    (await projectPlan(box, ranged, allow)).findings.filter(({ code }) => code === "profile.mcp-dependency"),
  ]).toEqual([
    {
      context7: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp@1.0.31"],
        env: { CONTEXT7_API_KEY: "${CONTEXT7_API_KEY}" },
      },
      mantine: { type: "stdio", command: "node", args: ["-e", expect.stringContaining('n="@mantine/mcp-server"')] },
      fetch: { type: "stdio", command: "uvx", args: ["mcp-server-fetch@2025.4.7"] },
    },
    expect.stringMatching(
      /^\[mcp_servers\.context7\]\ncommand = "npx"\nargs = \["-y", "@upstash\/context7-mcp@1\.0\.31"\]\nenv_vars = \["CONTEXT7_API_KEY"\]\n\n\[mcp_servers\.mantine\]\ncommand = "node"\nargs = \["-e", "[^\n]*n=\\"@mantine\/mcp-server\\",[^\n]*"\]\n\n\[mcp_servers\.fetch\]\ncommand = "uvx"\nargs = \["mcp-server-fetch@2025\.4\.7"\]\n$/,
    ),
    ["context7", "fetch"],
    [{ code: "profile.mcp-dependency", params: { part: "project.mantine", package: "@mantine/mcp-server" } }],
    [{ code: "profile.mcp-dependency", params: { part: "project.mantine", package: "@mantine/mcp-server" } }],
  ]);
});

test("a devDependency server started in a workspace member folder runs the install of the project that lists it, never one past a repository's root", async () => {
  const box = custom({ srv: mcpPart("srv", { devDependency: "@acme/srv" }) });
  const project = projectWith({
    "package.json": JSON.stringify({ devDependencies: { "@acme/srv": "1.2.3" } }),
    // Its exports hold no package.json, as @mantine/mcp-server's do not; the bin named like the package wins, and it
    // starts only as the main module, as npx runs it.
    "node_modules/@acme/srv/package.json": JSON.stringify({
      exports: { ".": "./index.js" },
      bin: { other: "bin/other.cjs", srv: "bin/srv.cjs" },
    }),
    "node_modules/@acme/srv/bin/srv.cjs":
      '#!/usr/bin/env node\nif (require.main === module) process.stdout.write("srv started\\n");\n',
    // A member that lists it too, with the install hoisted to the root, as npm workspaces do.
    "packages/ui/package.json": JSON.stringify({ name: "ui", devDependencies: { "@acme/srv": "1.2.3" } }),
    // A repository of its own inside the project, whose sessions must not reach the outer install.
    "vendor/lib/.git/HEAD": "ref: refs/heads/main\n",
    "vendor/lib/src/.keep": "",
  });
  applied(box.state, (await projectPlan(box, project, ["project.srv"])).plan);
  const { command, args } = JSON.parse(readFileSync(join(project, ".mcp.json"), "utf8")).mcpServers.srv;
  const from = (...folder: string[]) => {
    const run = spawnSync(command, args, { cwd: join(project, ...folder), encoding: "utf8" });
    return [run.status, run.stdout];
  };
  expect([from("packages", "ui"), from("vendor", "lib", "src")]).toEqual([
    [0, "srv started\n"],
    [1, ""],
  ]);
});

test("a devDependency MCP part in a project outside Git adds nothing, as its install's walk up would have no end", async () => {
  const box = custom({ srv: mcpPart("srv", { devDependency: "@acme/srv" }) });
  const project = mkdtempSync(join(root, "plain-"));
  writeFileSync(join(project, "package.json"), JSON.stringify({ devDependencies: { "@acme/srv": "1.2.3" } }));
  const { plan, findings } = await projectPlan(box, project, ["project.srv"]);
  expect([findings, contentOf(plan, join(project, ".mcp.json"))]).toEqual([
    [{ code: "profile.mcp-outside-git", params: { part: "project.srv", package: "@acme/srv" } }],
    null,
  ]);
});

test("an MCP server whose name the owner's file holds with another entry is written to no file", async () => {
  const box = custom({ docs: docsServer });
  const theirs = { mcpServers: { docs: { type: "http", url: "https://docs.example.org/mcp" } } };
  const project = projectWith({ ...OWNERS, ".mcp.json": JSON.stringify(theirs) });
  const { plan, findings } = await projectPlan(box, project, ["project.docs"]);
  const files = [join(project, ".mcp.json"), join(project, ".codex", "config.toml")];
  expect([findings, files.map((path) => contentOf(plan, path))]).toEqual([
    [{ code: "profile.mcp-conflict", params: { part: "project.docs", server: "docs", file: ".mcp.json" } }],
    [null, null],
  ]);
});

test("a profile's new pin replaces the MCP entries CedarLoom wrote, reformatted or not, once approved by name", async () => {
  const rules = [{ inline: "- Fetch pages.\n" }];
  const line = { type: "local-manual", title: "Fetch line", default: "on", requires: ["project.fetch"], rules };
  const box = custom({ fetch: fetchServer, "fetch-line": line });
  const project = projectWith(OWNERS);
  applied(box.state, (await projectPlan(box, project, ["project.fetch"])).plan);
  // An editor's indent and a Windows checkout's CRLF; the Codex file has CRLF lines from the start.
  const json = join(project, ".mcp.json");
  writeFileSync(json, JSON.stringify(JSON.parse(readFileSync(json, "utf8")), null, 4).replaceAll("\n", "\r\n"));
  profileFile(box.file, { fetch: FETCH_NEXT, "fetch-line": line });
  const waiting = await projectPlan(box, project);
  const approved = await projectPlan(box, project, ["project.fetch"]);
  applied(box.state, approved.plan);
  expect([
    waiting.findings,
    waiting.plan,
    approved.findings,
    JSON.parse(readFileSync(json, "utf8")).mcpServers,
    readFileSync(join(project, ".codex", "config.toml"), "utf8"),
    recordedServers(project),
  ]).toEqual([
    [
      {
        code: "profile.mcp-approval",
        params: expect.objectContaining({
          entries: [
            { file: ".mcp.json", change: "replace", entry: FETCH_NEXT_JSON },
            { file: ".codex/config.toml", change: "replace", entry: FETCH_NEXT_TOML },
          ],
        }),
      },
    ],
    null,
    [
      entryLine("fetch", "replace", ".mcp.json", FETCH_NEXT_JSON),
      entryLine("fetch", "replace", ".codex/config.toml", FETCH_NEXT_TOML),
    ],
    { ...MINE, fetch: { type: "stdio", command: "uvx", args: ["mcp-server-fetch@2025.5.0"] } },
    'model = "o3" # mine\r\n\r\n[mcp_servers.fetch]\r\ncommand = "uvx"\r\nargs = ["mcp-server-fetch@2025.5.0"]\r\n',
    FETCH_NEXT_RECORD,
  ]);
});

test("an MCP entry the owner changed after CedarLoom wrote it, by a value or a comment at a line's end, stays a conflict when the pin moves", async () => {
  const box = custom({ fetch: fetchServer });
  const project = projectWith(OWNERS);
  applied(box.state, (await projectPlan(box, project, ["project.fetch"])).plan);
  const json = join(project, ".mcp.json");
  const { mcpServers } = JSON.parse(readFileSync(json, "utf8"));
  const changed = { ...mcpServers.fetch, env: { PROXY: "on" } };
  writeFileSync(json, JSON.stringify({ mcpServers: { ...mcpServers, fetch: changed } }));
  const toml = join(project, ".codex", "config.toml");
  const pinned = 'args = ["mcp-server-fetch@2025.4.7"]';
  writeFileSync(toml, readFileSync(toml, "utf8").replace(pinned, `${pinned} # keep until upstream fixes it`));
  profileFile(box.file, { fetch: FETCH_NEXT });
  const { plan, findings } = await projectPlan(box, project, ["project.fetch"]);
  expect([findings, [json, toml].map((path) => contentOf(plan, path))]).toEqual([
    [fetchConflict(".mcp.json"), fetchConflict(".codex/config.toml")],
    [null, null],
  ]);
});

test("MCP parts switched off take out the entries CedarLoom wrote, say once that one the owner changed stays, and leave the owner's own", async () => {
  const ctx = { type: "http", url: "https://ctx.example.com/mcp" };
  const lib = { type: "http", url: "https://lib.example.com/mcp" };
  const box = custom({
    docs: docsServer,
    fetch: fetchServer,
    ctx: mcpPart("ctx", { url: ctx.url }),
    lib: { ...mcpPart("lib", { url: lib.url }), default: "off" },
  });
  // The owner's own entry, as the ctx part writes it, which no plan wrote.
  const project = projectWith({ ...OWNERS, ".mcp.json": JSON.stringify({ mcpServers: { ...MINE, ctx } }) });
  applied(box.state, ok(planChoice(box.config, { part: "project.ctx", on: false })));
  applied(box.state, ok(planChoice(box.config, { part: "project.lib", on: true })));
  applied(box.state, (await projectPlan(box, project, ["project.docs", "project.fetch", "project.lib"])).plan);
  // Back to its default, off: no explicit off, so the entries CedarLoom wrote for it stay for the other clones.
  applied(box.state, ok(planChoice(box.config, { part: "project.lib", on: null })));
  const changed = { ...DOCS_JSON, url: "https://docs.example.org/mcp" };
  const json = join(project, ".mcp.json");
  const { mcpServers } = JSON.parse(readFileSync(json, "utf8"));
  writeFileSync(json, JSON.stringify({ mcpServers: { ...mcpServers, docs: changed } }));
  for (const part of ["project.docs", "project.fetch"])
    applied(box.state, ok(planChoice(box.config, { part, on: false })));
  const { plan, findings } = await projectPlan(box, project);
  applied(box.state, plan);
  const fetchJson = '"fetch": {"type":"stdio","command":"uvx","args":["mcp-server-fetch@2025.4.7"]}';
  const fetchToml = '[mcp_servers.fetch]\ncommand = "uvx"\nargs = ["mcp-server-fetch@2025.4.7"]';
  expect([
    findings,
    JSON.parse(readFileSync(json, "utf8")),
    readFileSync(join(project, ".codex", "config.toml"), "utf8"),
    recordedServers(project),
    await projectPlan(box, project),
  ]).toEqual([
    [
      { code: "profile.mcp-kept", params: { part: "project.docs", server: "docs", file: ".mcp.json" } },
      entryLine("docs", "remove", ".codex/config.toml", DOCS_TOML),
      entryLine("fetch", "remove", ".mcp.json", fetchJson),
      entryLine("fetch", "remove", ".codex/config.toml", fetchToml),
    ],
    { mcpServers: { ...MINE, ctx, docs: changed, lib } },
    'model = "o3" # mine\r\n\r\n[mcp_servers.lib]\r\nurl = "https://lib.example.com/mcp"\r\n',
    {
      ".mcp.json": { lib: { sha256: sha('{"type":"http","url":"https://lib.example.com/mcp"}') } },
      ".codex/config.toml": { lib: { sha256: sha('{"url":"https://lib.example.com/mcp"}') } },
    },
    { plan: null, findings: [] },
  ]);
});

test("a .mcp.json the plan cannot read stops no plan while every MCP part is off", async () => {
  const box = custom({
    docs: docsServer,
    rest: { type: "local-manual", title: "Rest", default: "on", rules: [{ inline: "- Plan the rest.\n" }] },
  });
  applied(box.state, ok(planChoice(box.config, { part: "project.docs", on: false })));
  const project = projectWith({ ".mcp.json": "{ nope" });
  const { plan } = await projectPlan(box, project);
  expect(contentOf(plan, join(project, "CLAUDE.local.md"))?.includes("- Plan the rest.")).toBe(true);
});

test("a project folder that is the user's home is refused, as its Claude Code and Codex files would be the user's", async () => {
  const box = machine();
  const project = projectWith();
  const machineAt = { home: box.home, user: project };
  expect(await planProfile(box.config, box.state, machineAt, { fetch: stock, project })).toEqual({
    ok: false,
    finding: { code: "profile.project-is-home", params: { project } },
  });
});

test("a .codex folder a link leads outside the project stops the plan, as Codex's config would land there", async () => {
  const project = projectWith();
  const path = join(linkedAt(project, ".codex"), "config.toml");
  const params = { part: "project", target: ".codex/config.toml", path };
  expect(await planned(custom({ docs: docsServer }), project)).toEqual({
    ok: false,
    finding: { code: "profile.target-linked", params },
  });
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
  const record = join(project, ".cedarloom", "profile-files.json");
  const pack = JSON.parse(contentOf(plan, record) ?? "{}").files[".claude/skills/review/SKILL.md"].pack;
  expect([contentOf(plan, path), pack, after]).toEqual([
    "# Review\n",
    "acme.skills@1.0.0",
    [
      ["delete", path],
      ["write", record],
    ],
  ]);
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

const skillMd = (project: string, name: string) => join(project, ".claude", "skills", name, "SKILL.md");
test("a workspace package on @mantine/core brings both Mantine skills from this release's pack", async () => {
  const box = machine();
  const web = JSON.stringify({ dependencies: { "@mantine/core": "9.0.0" } });
  const [mantine, plain] = [projectWith({ "packages/web/package.json": web }), projectWith({ "package.json": "{}" })];
  const [plan, none] = [ok(await planned(box, mantine)).plan, ok(await planned(box, plain)).plan];
  expect([
    contentOf(plan, skillMd(mantine, "mantine-family"))?.startsWith("---\nname: mantine-family\n"),
    contentOf(plan, skillMd(mantine, "mantine-form"))?.startsWith("---\nname: mantine-form\n"),
    contentOf(none, skillMd(plain, "mantine-family")),
  ]).toEqual([true, true, null]);
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

// The drift lines as [status, subject], an extra as ["extra", item], other findings by their code.
const driftLines = (findings: Finding[]) =>
  findings.map((finding) => {
    if (finding.code === "profile.drift") return [finding.params.status, finding.params.subject];
    return finding.code === "profile.extra" ? ["extra", finding.params.item] : [finding.code];
  });

test("a check reports each drift of an applied home and reads only, and an applied home has none", async () => {
  const box = await setUp();
  const where = { home: box.home, user: box.user };
  const check = async () => driftLines(ok(await checkProfile(box.config, box.state, where, { fetch: stock })));
  const clean = await check();
  const [global, hub, skill] = [
    join(box.home, "rules", "00-global.md"),
    join(box.home, "rules", "cedarloom-hub.md"),
    join(box.home, "skills", "find-skills", "SKILL.md"),
  ];
  // CedarLoom's own older text, a file deleted, an owner's change, the owner's own rules and plugin, a part switched off.
  const before = createHash("sha256").update(readFileSync(global)).digest("hex");
  applied(box.state, { schemaVersion: 1, operations: [{ kind: "write", path: global, before, content: "- old\n" }] });
  rmSync(hub);
  writeFileSync(skill, "# Mine\n");
  writeFileSync(join(box.home, "rules", "mine.md"), "- mine\n");
  const settings = JSON.parse(readFileSync(join(box.home, "settings.json"), "utf8"));
  writeFileSync(
    join(box.home, "settings.json"),
    JSON.stringify({ ...settings, enabledPlugins: { ...settings.enabledPlugins, "x@y": true } }),
  );
  applied(box.state, ok(planChoice(box.config, { part: "machine.plugin.ponytail", on: false })));
  const settingsText = readFileSync(join(box.home, "settings.json"), "utf8");
  expect([clean, await check(), readFileSync(join(box.home, "settings.json"), "utf8")]).toEqual([
    [],
    [
      ["outdated", global],
      ["missing", hub],
      ["profile.owner-changed"],
      ["deselected-present", "plugin:ponytail@ponytail"],
      ["extra", "plugin:x@y"],
      ["extra", "rules:mine.md"],
    ],
    settingsText,
  ]);
});

// Every Git source as unreachable.
const failing: Fetch = async () => ({
  ok: false,
  finding: { code: "git.failed", params: { step: "fetch", error: "offline" } },
});

test("a part switched off is reported as present, and a check without its Git sources did not run", async () => {
  const box = await setUp();
  const where = { home: box.home, user: box.user };
  applied(box.state, ok(planChoice(box.config, { part: "machine.rules.global", on: false })));
  // Offline is no problem of the machine: the doctor keeps the line and drops the error.
  const doctor = driftLines(await profileDoctor(box.config, box.state, where, { fetch: failing }));
  expect([
    driftLines(ok(await checkProfile(box.config, box.state, where, { fetch: stock }))),
    driftLines(ok(await checkProfile(box.config, box.state, where, { fetch: failing }))),
  ]).toEqual([
    [["deselected-present", join(box.home, "rules", "00-global.md")]],
    [["not-run", box.home], ["git.failed"]],
  ]);
  expect(doctor).toEqual([["not-run", box.home]]);
});

test("an offered removal is taken only when named, once however often, and offered again when it comes back", async () => {
  const box = await setUp();
  const where = { home: box.home, user: box.user };
  const mine = join(box.home, "rules", "mine.md");
  writeFileSync(mine, "- mine\n");
  const plan = (remove: string[]) =>
    planProfile(box.config, box.state, where, { allow: PLUGINS, fetch: stock, remove });
  applied(box.state, ok(await plan(["rules:mine.md", "rules:mine.md"])).plan);
  const removed = readdirSync(join(box.home, "rules")).includes("mine.md");
  writeFileSync(mine, "- mine again\n");
  expect([removed, ok(await plan([])).findings, await plan(["rules:other.md"])]).toEqual([
    false,
    [{ code: "profile.extra", params: { item: "rules:mine.md" } }],
    { ok: false, finding: { code: "profile.remove-unknown", params: { item: "rules:other.md" } } },
  ]);
});

test("a check writes nothing, not even the record of the followed sources", async () => {
  const box = machine();
  ok(await checkProfile(box.config, box.state, { home: box.home, user: box.user }, { fetch: stock }));
  expect(existsSync(join(box.state, "pack-sources.json"))).toBe(false);
});

test("an owner's plugin and its marketplace go in one run, the marketplace only along with the plugin", async () => {
  const box = await setUp();
  const where = { home: box.home, user: box.user };
  const path = join(box.home, "settings.json");
  const settings = JSON.parse(readFileSync(path, "utf8"));
  const enabledPlugins = { ...settings.enabledPlugins, "x@y": true };
  const extraKnownMarketplaces = {
    ...settings.extraKnownMarketplaces,
    y: { source: { source: "github", repo: "a/y" } },
  };
  writeFileSync(path, JSON.stringify({ ...settings, enabledPlugins, extraKnownMarketplaces }));
  const plan = (remove: string[]) =>
    planProfile(box.config, box.state, where, { allow: PLUGINS, fetch: stock, remove });
  const offered = driftLines(ok(await plan([])).findings);
  applied(box.state, ok(await plan(["plugin:x@y", "marketplace:y"])).plan);
  const after = JSON.parse(readFileSync(path, "utf8"));
  expect([offered, "x@y" in after.enabledPlugins, "y" in after.extraKnownMarketplaces]).toEqual([
    [["extra", "plugin:x@y"]],
    false,
    false,
  ]);
});

test("an owner's skill folder goes when named and is offered again when it comes back; a binary file stops it", async () => {
  const box = await setUp();
  const where = { home: box.home, user: box.user };
  const folder = join(box.home, "skills", "mine");
  mkdirSync(join(folder, "assets"), { recursive: true });
  writeFileSync(join(folder, "SKILL.md"), "# Mine\n");
  const plan = (remove: string[]) =>
    planProfile(box.config, box.state, where, { allow: PLUGINS, fetch: stock, remove });
  applied(box.state, ok(await plan(["skill:mine"])).plan);
  const left = readdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "SKILL.md"), "# Mine again\n");
  const offered = ok(await plan([])).findings;
  writeFileSync(join(folder, "assets", "logo.png"), Buffer.from([0xff, 0xfe, 0x00]));
  expect([left, offered, await plan(["skill:mine"])]).toEqual([
    ["assets"],
    [{ code: "profile.extra", params: { item: "skill:mine" } }],
    { ok: false, finding: { code: "apply.not-text", params: { path: join(folder, "assets", "logo.png") } } },
  ]);
});

test("a project's check tells CedarLoom's older text there from a deleted file by the project's own record", async () => {
  const box = machine();
  const project = projectWith();
  applied(box.state, (await projectPlan(box, project)).plan);
  const docs = join(realpathSync.native(project), "docs", "agents");
  const labels = join(docs, "triage-labels.md");
  const domain = join(docs, "domain.md");
  const before = createHash("sha256").update(readFileSync(domain)).digest("hex");
  applied(box.state, { schemaVersion: 1, operations: [{ kind: "write", path: domain, before, content: "- old\n" }] });
  rmSync(labels);
  const where = { home: box.home, user: box.home };
  expect(driftLines(ok(await checkProfile(box.config, box.state, where, { fetch: stock, project })))).toEqual([
    ["missing", labels],
    ["outdated", domain],
  ]);
});

test("a project's record names each committed file CedarLoom wrote, and stays as it is when the owner changes one", async () => {
  const box = machine();
  // The dev container's wrapper, a file Git ignores, is no file of the record.
  const project = projectWith({ ".devcontainer.json": "{}" });
  applied(box.state, (await projectPlan(box, project, ["project.dc-wrapper"])).plan);
  const domain = join(realpathSync.native(project), "docs", "agents", "domain.md");
  const record = () => JSON.parse(readFileSync(join(project, ".cedarloom", "profile-files.json"), "utf8")).files;
  const [written, hash] = [record(), sha(readFileSync(domain))];
  // Checked out with CRLF line endings, as Git's core.autocrlf does on Windows.
  const path = join(project, ".cedarloom", "profile-files.json");
  writeFileSync(path, readFileSync(path, "utf8").replaceAll("\n", "\r\n"));
  writeFileSync(domain, "- mine\n");
  const after = await projectPlan(box, project, ["project.dc-wrapper"]);
  const scripts = readdirSync(join(project, "scripts"));
  expect([scripts, Object.keys(written), written["docs/agents/domain.md"], after.plan, record()]).toEqual([
    ["dc"],
    ["docs/agents/domain.md", "docs/agents/issue-tracker.md", "docs/agents/triage-labels.md"],
    { sha256: hash, pack: expect.stringMatching(/^cedarloom\.core@\d/) },
    null,
    written,
  ]);
});

test("another clone takes a committed file as CedarLoom's by the project's record, CRLF or not: its older text is outdated", async () => {
  const project = projectWith();
  const first = machine();
  applied(first.state, (await projectPlan(first, project)).plan);
  const [domain, path] = [
    join(realpathSync.native(project), "docs", "agents", "domain.md"),
    join(realpathSync.native(project), ".cedarloom", "profile-files.json"),
  ];
  const record = JSON.parse(readFileSync(path, "utf8"));
  record.files["docs/agents/domain.md"].sha256 = sha("- old\n");
  writeFileSync(path, JSON.stringify(record));
  writeFileSync(domain, "- old\r\n");
  // A machine with a run store of its own, as a teammate's clone has.
  const other = machine();
  const { plan, findings } = await projectPlan(other, project);
  const where = { home: other.home, user: other.home };
  const drift = driftLines(ok(await checkProfile(other.config, other.state, where, { fetch: stock, project })));
  expect([plan?.operations.map((op) => "path" in op && op.path), findings, drift]).toEqual([
    [domain, path],
    [],
    [
      ["outdated", domain],
      ["missing", path],
    ],
  ]);
});

const deletes = (plan: Plan | null) => (plan?.operations ?? []).filter((op) => op.kind === "delete");

test("committed files another machine's profile wrote and recorded stay where a profile lacks them", async () => {
  const project = projectWith();
  const first = custom(packsPart(["acme.skills"]), SKILLS);
  applied(first.state, ok(await planned(first, project, packs)).plan);
  // Machines whose profile has no such pack, or the agent docs switched off, as each machine selects its own.
  const off = machine();
  applied(off.state, ok(planChoice(off.config, { part: "project.agent-docs", on: false })));
  expect([
    ok(await planned(custom(packsPart([]), SKILLS), project, packs)).plan,
    deletes((await projectPlan(off, project)).plan),
  ]).toEqual([null, []]);
});

test("a clone on an older pack leaves files a newer one recorded, and says so where their text differs", async () => {
  const project = projectWith();
  const first = machine();
  applied(first.state, (await projectPlan(first, project)).plan);
  const domain = join(realpathSync.native(project), "docs", "agents", "domain.md");
  const path = join(project, ".cedarloom", "profile-files.json");
  const record = JSON.parse(readFileSync(path, "utf8"));
  record.files["docs/agents/domain.md"] = { sha256: sha("- newer\n"), pack: "cedarloom.core@99.0.0" };
  // A file the newer pack left as this machine's pack has it: held, but nothing to report.
  record.files["docs/agents/issue-tracker.md"].pack = "cedarloom.core@99.0.0";
  writeFileSync(path, JSON.stringify(record));
  writeFileSync(domain, "- newer\n");
  const local = expect.stringMatching(/^cedarloom\.core@0\./);
  const params = { path: domain, recorded: "cedarloom.core@99.0.0", local };
  const { plan, findings } = await projectPlan(machine(), project);
  expect([plan, findings]).toEqual([null, [{ code: "profile.newer-pack", params }]]);
});

// The test's packs with the review skill's text as given, in CRLF line endings, as a pack written on Windows may have.
const crlf =
  (text: string): Fetch =>
  async (source, options) => {
    const fetched = await packs(source, options);
    if (!fetched.ok) return fetched;
    const files = fetched.value.files.map((file) =>
      file.path === "skills/review/SKILL.md" ? treeFile(file.path, text.replaceAll("\n", "\r\n")) : file,
    );
    return { ok: true, value: { ...fetched.value, files } };
  };

test("a CedarLoom text with CRLF line endings is CedarLoom's on another machine by the record, so it is updated", async () => {
  const project = projectWith();
  const first = custom(packsPart(["acme.skills"]), SKILLS);
  applied(first.state, ok(await planned(first, project, crlf("# Review\n"))).plan);
  const other = custom(packsPart(["acme.skills"]), SKILLS);
  const { plan, findings } = ok(await planned(other, project, crlf("# Review, newer\n")));
  const [skill, record] = [
    join(realpathSync.native(project), ".claude", "skills", "review", "SKILL.md"),
    join(realpathSync.native(project), ".cedarloom", "profile-files.json"),
  ];
  expect([plan?.operations.map((op) => "path" in op && op.path), findings]).toEqual([[skill, record], []]);
});

test("a record a Git conflict left unreadable, one that does not fit its schema or a newer one stops the plan, named", async () => {
  const box = machine();
  const refusal = async (text: string, code: string, params: Record<string, unknown>) => {
    const project = projectWith({ ".cedarloom/profile-files.json": text });
    const path = join(realpathSync.native(project), ".cedarloom", "profile-files.json");
    return [await planned(box, project), { ok: false, finding: { code, params: { ...params, path } } }];
  };
  const results = [
    await refusal("<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> theirs\n", "document.invalid", { issues: expect.any(Array) }),
    await refusal("{}\n", "document.invalid", { issues: expect.any(Array) }),
    await refusal('{ "schemaVersion": 2 }\n', "document.newer-schema", { found: 2, known: 1 }),
  ];
  expect(results.map(([actual]) => actual)).toEqual(results.map(([, expected]) => expected));
});
