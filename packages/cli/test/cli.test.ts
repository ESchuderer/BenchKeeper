import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Fetch, LoginStatus } from "@cedarloom/use-cases";
import { Finding, type Plan } from "@cedarloom/contracts";
import { benchKeeperRegistry, configDir, describe as text, EXIT, main, stateDir } from "@cedarloom/cli";
import { openRunStore, planHash, sha256 } from "@cedarloom/ledger";
import { expect, test } from "vitest";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };

// The agent logins the commands started, each by its environment, the exit code the next one ends with, and the login
// status every home reports; null: logged in, in the folder it was asked about.
interface Logins {
  readonly started: Record<string, string>[];
  code: number;
  status: LoginStatus | null;
}

const setup = (
  fetch?: Fetch,
): {
  root: string;
  state: string;
  logins: Logins;
  cli: (...argv: string[]) => Promise<{ code: number; out: string; err: string }>;
} => {
  const root = mkdtempSync(join(tmpdir(), "cedarloom-cli-"));
  const state = join(root, "state");
  const logins: Logins = { started: [], code: 0, status: null };
  const cli = async (...argv: string[]): Promise<{ code: number; out: string; err: string }> => {
    let [out, err] = ["", ""];
    const io = {
      out: (t: string) => (out += t),
      err: (t: string) => (err += t),
      env: { CEDARLOOM_STATE_DIR: state, CEDARLOOM_CONFIG_DIR: join(root, "config") },
      untilStopped: () => Promise.resolve(),
      login: (env: Record<string, string>) => {
        logins.started.push(env);
        return { code: logins.code };
      },
      authStatus: async (env: Readonly<Record<string, string>>): Promise<LoginStatus> =>
        logins.status ?? {
          kind: "logged-in",
          authMethod: "claude.ai",
          configDirectory: env["CLAUDE_CONFIG_DIR"] ?? null,
        },
      ...(fetch === undefined ? {} : { fetch }),
    };
    return { code: await main(argv, io), out, err };
  };
  return { root, state, logins, cli };
};

const planFile = (root: string, value: unknown, name = "plan.json"): string => {
  writeFileSync(join(root, name), JSON.stringify(value));
  return join(root, name);
};

const json = (out: string): Record<string, unknown> => z.record(z.string(), z.unknown()).parse(JSON.parse(out));

const created = (root: string): Plan => ({
  schemaVersion: 1,
  operations: [{ kind: "write", path: join(root, "notes.md"), before: null, content: "hello\n" }],
});

test("plans show prints the plan and its hash, and writes nothing", async () => {
  const { root, state, cli } = setup();
  const plan = created(root);
  const shown = await cli("plans", "show", planFile(root, plan));
  expect(shown).toMatchObject({ code: EXIT.ok, err: "" });
  expect(shown.out).toContain(`Plan ${planHash(plan)}:`);
  expect(shown.out).toContain("(create, 6 bytes)");
  expect(json((await cli("plans", "show", planFile(root, plan), "--json")).out)).toEqual({
    format: "cedarloom.plan",
    schemaVersion: 1,
    planHash: planHash(plan),
    plan: {
      schemaVersion: 1,
      operations: [{ kind: "write", path: join(root, "notes.md"), before: null, after: sha256("hello\n"), bytes: 6 }],
    },
  });
  expect(existsSync(state)).toBe(false);
});

test("plans apply shows the plan and changes nothing without --yes; with --yes it applies one run", async () => {
  const { root, state, cli } = setup();
  const file = planFile(root, created(root));
  const asked = await cli("plans", "apply", file);
  expect([asked.code, asked.out.includes("--yes"), existsSync(join(root, "notes.md")), existsSync(state)]).toEqual([
    EXIT.ok,
    true,
    false,
    false,
  ]);
  const applied = await cli("--json", "plans", "apply", file, "--yes");
  expect(json(applied.out)).toMatchObject({ format: "cedarloom.run", status: "applied", findings: [] });
  expect(readFileSync(join(root, "notes.md"), "utf8")).toBe("hello\n");
});

test("a stale plan is refused with exit 1; JSON carries the code and parameters only", async () => {
  const { root, cli } = setup();
  writeFileSync(join(root, "notes.md"), "mine\n");
  const refused = await cli("plans", "apply", planFile(root, created(root)), "--yes", "--json");
  expect(refused.code).toBe(EXIT.refused);
  expect(json(refused.out)).toMatchObject({
    status: "refused",
    findings: [{ code: "plan.file-changed", params: { expected: null, actual: sha256("mine\n") } }],
  });
  const human = await cli("plans", "apply", planFile(root, created(root)), "--yes");
  expect(human.err).toContain("error: ");
  expect(human.err).toContain("notes.md changed since the plan was made");
});

test("unreadable, malformed, invalid and newer plan files exit 66 or 65", async () => {
  const { root, cli } = setup();
  expect((await cli("plans", "show", join(root, "missing.json"))).code).toBe(EXIT.noInput);
  const missing = await cli("--json", "plans", "apply", join(root, "missing.json"), "--yes");
  expect([missing.code, json(missing.out)["findings"]]).toEqual([
    EXIT.noInput,
    [{ code: "document.unreadable", params: { path: join(root, "missing.json"), error: "ENOENT" } }],
  ]);
  writeFileSync(join(root, "broken.json"), "{");
  expect((await cli("plans", "show", join(root, "broken.json"))).code).toBe(EXIT.data);
  const invalid = await cli("plans", "show", planFile(root, { schemaVersion: 1, operations: [] }), "--json");
  expect([invalid.code, json(invalid.out)["findings"]]).toEqual([
    EXIT.data,
    [{ code: "document.invalid", params: { issues: [{ path: "operations", code: "too_small" }] } }],
  ]);
  const newer = await cli("plans", "show", planFile(root, { schemaVersion: 9 }));
  expect([newer.code, newer.err]).toEqual([
    EXIT.data,
    "error: The document has schema version 9; this CedarLoom reads up to 1.\n",
  ]);
});

test("runs list, show and undo: undo previews without --yes and applies as its own run with --yes", async () => {
  const { root, cli } = setup();
  expect((await cli("runs", "list")).out).toBe("No runs yet.\n");
  await cli("plans", "apply", planFile(root, created(root)), "--yes");
  const runs = z.array(z.object({ id: z.string() })).parse(json((await cli("runs", "list", "--json")).out)["runs"]);
  const id = runs[0]?.id ?? "";
  expect((await cli("runs", "list")).out).toContain(`${id}  apply  applied`);
  expect((await cli("runs", "show", id)).out).toContain(`done     ${join(root, "notes.md")}`);
  const preview = await cli("runs", "undo", id);
  expect([preview.out.includes("delete"), existsSync(join(root, "notes.md"))]).toEqual([true, true]);
  expect(json((await cli("runs", "undo", id, "--json")).out)).toMatchObject({ format: "cedarloom.plan", findings: [] });
  expect((await cli("runs", "undo", id, "--yes")).code).toBe(EXIT.ok);
  expect(existsSync(join(root, "notes.md"))).toBe(false);
  expect(json((await cli("--json", "runs", "undo", id, "--yes")).out)).toMatchObject({ status: "nothing-to-undo" });
  expect((await cli("runs", "undo", id)).out).toBe("Nothing to undo.\n");
});

test("an unknown run is reported with exit 1 by show and undo", async () => {
  const { root, cli } = setup();
  for (const argv of [
    ["runs", "show", "nope"],
    ["runs", "undo", "nope"],
    ["runs", "undo", "nope", "--yes"],
  ]) {
    expect((await cli(...argv)).code).toBe(EXIT.refused);
  }
  await cli("plans", "apply", planFile(root, created(root)), "--yes");
  expect((await cli("runs", "show", "nope")).err).toBe("error: No run nope in this state folder.\n");
  expect((await cli("runs", "undo", "nope")).code).toBe(EXIT.refused);
});

test("doctor reports an interrupted run as a warning with its fix, and a busy store blocks a change", async () => {
  const { root, state, cli } = setup();
  expect((await cli("doctor")).out).toBe("No problems found.\n");
  const store = openRunStore(state);
  if (!store.ok) throw new Error(store.finding.code);
  const plan = created(root);
  const id = store.value.begin("apply", plan, planHash(plan));
  expect((await cli("plans", "apply", planFile(root, plan), "--yes")).err).toContain("Another CedarLoom process");
  expect((await cli("doctor", "--json")).out).toContain('"findings":[]');
  store.value.close();
  const report = await cli("doctor");
  expect([report.code, report.out]).toEqual([
    EXIT.ok,
    `warning: Run ${id.ok ? id.value : ""} was interrupted. Undo it with: cedarloom runs undo ${id.ok ? id.value : ""} --yes\n`,
  ]);
  expect((await cli("runs", "list")).out).toContain("interrupted");
});

test("a store from a newer CedarLoom makes reads, mode and doctor fail with exit 1", async () => {
  const { state, cli } = setup();
  const store = openRunStore(state);
  if (store.ok) store.value.close();
  const db = new DatabaseSync(join(state, "runs.sqlite"));
  db.exec("PRAGMA user_version = 99");
  db.close();
  expect((await cli("runs", "list")).code).toBe(EXIT.refused);
  expect((await cli("mode")).code).toBe(EXIT.refused);
  const report = await cli("doctor", "--json");
  expect([report.code, report.out.includes("store.newer-schema")]).toEqual([EXIT.refused, true]);
});

test("usage errors exit 64, help exits 0, and both command names point at one program", async () => {
  const { cli } = setup();
  expect((await cli("frobnicate")).code).toBe(EXIT.usage);
  expect((await cli("runs", "show")).code).toBe(EXIT.usage);
  expect((await cli("--help")).code).toBe(EXIT.ok);
  expect(pkg.bin).toEqual({ cedarloom: "./src/bin.ts", cloom: "./src/bin.ts" });
});

test("the state folder comes from CEDARLOOM_STATE_DIR, then XDG_STATE_HOME, then the home folder", () => {
  expect(stateDir({ CEDARLOOM_STATE_DIR: "/s" })).toBe("/s");
  expect(stateDir({ XDG_STATE_HOME: "/x" })).toBe(join("/x", "cedarloom"));
  expect(stateDir({})).toMatch(/[/\\]\.local[/\\]state[/\\]cedarloom$/);
  // Empty and relative values are unset (XDG Base Directory spec), so the store never lands in the current folder.
  for (const env of [
    { CEDARLOOM_STATE_DIR: "", XDG_STATE_HOME: "" },
    { CEDARLOOM_STATE_DIR: "state", XDG_STATE_HOME: "x" },
  ]) {
    expect(stateDir(env)).toBe(stateDir({}));
  }
});

test("the config folder comes from CEDARLOOM_CONFIG_DIR, then XDG_CONFIG_HOME, then ~/.config; BenchKeeper's is fixed", () => {
  expect(configDir({ CEDARLOOM_CONFIG_DIR: "/c", XDG_CONFIG_HOME: "/x" })).toBe("/c");
  expect(configDir({ CEDARLOOM_CONFIG_DIR: "c", XDG_CONFIG_HOME: "/x" })).toBe(join("/x", "cedarloom"));
  expect(configDir({})).toBe(join(homedir(), ".config", "cedarloom"));
  expect(benchKeeperRegistry()).toBe(join(homedir(), ".config", "benchkeeper", "accounts.json"));
});

const host = (name: string, pool?: string) => ({ name, agent: "claude", mode: "host", dir: `/accounts/${name}`, pool });

// A temporary setup with BenchKeeper's registry file: one pooled and one single host account, one container account.
const withBenchKeeper = () => {
  const { root, state, logins, cli } = setup();
  const boxed = { name: "boxed", agent: "claude", mode: "container", volume: "v", mount: "/m" };
  const registry = { accounts: [host("work", "main"), host("solo"), boxed], settings: { autoPick: true } };
  return { root, state, logins, cli, from: planFile(root, registry, "benchkeeper.json") };
};

test("accounts: an account moves into its own home with --yes, and its login runs only there", async () => {
  const { state, logins, cli, from } = withBenchKeeper();
  await cli("accounts", "import", "--from", from, "--yes");
  const home = join(state, "homes", "work");
  const early = await cli("accounts", "login", "work");
  expect([early.code, early.err]).toEqual([
    EXIT.refused,
    expect.stringContaining("cedarloom accounts home work --yes"),
  ]);
  const shown = await cli("accounts", "home", "work");
  expect([shown.code, shown.out]).toEqual([EXIT.ok, expect.stringContaining("Nothing changed")]);
  expect(json((await cli("accounts", "home", "work", "--yes", "--json")).out)).toMatchObject({ status: "applied" });
  expect((await cli("accounts", "list")).out).toContain(
    `work  claude  main (not confirmed)  ${home}  (alias /accounts/work)`,
  );
  expect(json((await cli("accounts", "home", "work", "--json")).out)).toMatchObject({ format: "cedarloom.home", home });
  expect(logins.started).toEqual([]);
  const login = await cli("accounts", "login", "work");
  expect([login.code, login.out]).toEqual([EXIT.ok, `Logged in: account work, in ${home}.\n`]);
  expect(logins.started).toEqual([expect.objectContaining({ CLAUDE_CONFIG_DIR: home })]);
  // The doctor checks the login in each own home and names an account that is not in its own home yet.
  const checked = await cli("doctor");
  expect([checked.code, checked.out]).toEqual([
    EXIT.refused,
    expect.stringContaining("Account solo names /accounts/solo"),
  ]);
  logins.status = { kind: "logged-out" };
  expect((await cli("doctor")).out).toContain(`Account work is not logged in in its own home ${home}`);
  logins.status = null;
  logins.code = 1;
  const failed = await cli("accounts", "login", "work", "--json");
  expect([failed.code, json(failed.out)]).toEqual([
    EXIT.refused,
    expect.objectContaining({
      findings: [{ code: "accounts.login-failed", params: { account: "work", error: "exit code 1" } }],
    }),
  ]);
  expect((await cli("accounts", "home", "nobody")).code).toBe(EXIT.refused);
});

test("accounts: a relative --state is taken from the working folder, so an own home is an absolute folder", async () => {
  const { root, cli, from } = withBenchKeeper();
  await cli("accounts", "import", "--from", from, "--yes");
  const state = relative(process.cwd(), join(root, "elsewhere"));
  const moved = await cli("--state", state, "--json", "accounts", "home", "work", "--yes");
  expect([moved.code, json(moved.out)]).toEqual([EXIT.ok, expect.objectContaining({ status: "applied" })]);
  expect((await cli("accounts", "list")).out).toContain(join(root, "elsewhere", "homes", "work"));
});

test("accounts: the one-time import is shown first and applied with --yes", async () => {
  const { root, cli, from } = withBenchKeeper();
  expect(await cli("accounts", "list")).toMatchObject({
    code: EXIT.ok,
    out: expect.stringContaining("No accounts yet"),
  });
  expect((await cli("accounts", "import", "--from", join(root, "none.json"))).code).toBe(EXIT.noInput);
  const shown = await cli("accounts", "import", "--from", from);
  expect([shown.code, shown.out]).toEqual([
    EXIT.ok,
    expect.stringContaining("not imported: container-account of boxed"),
  ]);
  expect(existsSync(join(root, "config", "accounts.json"))).toBe(false);
  expect(json((await cli("accounts", "import", "--from", from, "--json")).out)).toMatchObject({
    format: "cedarloom.plan",
    left: [
      { account: null, item: "autoPick" },
      { account: "boxed", item: "container-account" },
    ],
  });
  // The applied run's JSON keeps the list of what was not imported.
  expect(json((await cli("accounts", "import", "--from", from, "--yes", "--json")).out)).toMatchObject({
    format: "cedarloom.run",
    status: "applied",
    left: [
      { account: null, item: "autoPick" },
      { account: "boxed", item: "container-account" },
    ],
  });
  expect((await cli("accounts", "list")).out).toBe(
    "work  claude  main (not confirmed)  /accounts/work\nsolo  claude  -  /accounts/solo\n",
  );
  // Once: the default file is never read, as the registry exists.
  expect(await cli("accounts", "import")).toMatchObject({ code: EXIT.refused, err: expect.stringContaining("once") });
  writeFileSync(join(root, "config", "accounts.json"), "{}");
  expect((await cli("accounts", "list", "--json")).code).toBe(EXIT.data);
});

test("accounts: a pool's confirmation carries the terms warning in every output form; Codex pools are refused", async () => {
  const { cli, from } = withBenchKeeper();
  await cli("accounts", "import", "--from", from, "--yes");
  const codex = await cli("accounts", "pool", "confirm", "main", "--agent", "codex");
  expect([codex.code, codex.err]).toEqual([EXIT.refused, expect.stringContaining("OpenAI's terms")]);
  const terms = { code: "accounts.pool-terms", params: { pool: "main" } };
  const preview = await cli("accounts", "pool", "confirm", "main");
  expect([preview.out, preview.err]).toEqual([
    expect.stringContaining("Nothing changed"),
    expect.stringContaining("warning: Confirm pool main only if you hold and pay for every account in it yourself"),
  ]);
  // The Usage Policy in force from November 12, 2026, and the help article on what a subscription's usage is for.
  for (const quote of [
    "create multiple accounts, to avoid detection, circumvent product guardrails",
    "intentionally bypass or interfere with capabilities, restrictions, or guardrails",
    "route requests through consumer subscriptions",
    "ordinary use of native Anthropic applications",
  ])
    expect(preview.err).toContain(quote);
  expect(json((await cli("accounts", "pool", "confirm", "main", "--json")).out)).toMatchObject({
    format: "cedarloom.plan",
    findings: [terms],
  });
  expect(json((await cli("accounts", "pool", "confirm", "main", "--yes", "--json")).out)).toMatchObject({
    format: "cedarloom.run",
    status: "applied",
    findings: [terms],
  });
  expect((await cli("accounts", "list")).out).toContain("main (confirmed)");
  expect(json((await cli("accounts", "list", "--json")).out)).toMatchObject({
    confirmed: [{ agent: "claude", pool: "main" }],
  });
});

test("mode shows the level of running work and switches it with --yes, at each run's next gate", async () => {
  const { root, state, cli } = setup();
  expect((await cli("mode")).out).toContain("follows each project's level; the default is supervised");
  expect((await cli("mode", "auto")).out).toContain(
    "auto for the runs running now, at each run's next gate.\nNothing changed",
  );
  expect(json((await cli("mode", "auto", "--json")).out)).toMatchObject({ format: "cedarloom.mode", level: "auto" });
  expect((await cli("mode", "auto", "--yes")).out).toContain("the switch is in the ledger");
  expect(json((await cli("mode", "--json")).out)).toMatchObject({
    format: "cedarloom.mode",
    running: "auto",
    modeScope: "running",
  });
  expect((await cli("mode")).out).toContain("Running at auto for the runs that were running at");
  expect((await cli("mode", "off", "--yes")).out).toContain("back to each project's level");
  expect((await cli("mode", "fast")).code).toBe(EXIT.usage);
  // Another holder of the store: the switch is refused, not lost silently.
  const holder = openRunStore(state);
  expect((await cli("mode", "auto", "--yes")).code).toBe(EXIT.refused);
  if (holder.ok) holder.value.close();
  // Read problems exit as for the other commands: an invalid file 65, an unreadable one 66, a newer store 1.
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(join(root, "config", "automation.json"), "{}");
  expect((await cli("mode")).code).toBe(EXIT.data);
  rmSync(join(root, "config", "automation.json"));
  mkdirSync(join(root, "config", "automation.json"));
  expect((await cli("mode")).code).toBe(EXIT.noInput);
  expect((await cli("mode", "auto")).code).toBe(EXIT.noInput);
});

test("level shows the default and each project's level, and sets one of them by plan with --yes", async () => {
  const { root, cli } = setup();
  expect((await cli("level")).out).toBe("supervised  (default)\n");
  // --project without a level names nothing to set.
  expect((await cli("level", "--project", root)).code).toBe(EXIT.usage);
  expect((await cli("level", "checkpoint")).out).toContain("Nothing changed");
  expect((await cli("level", "checkpoint", "--yes")).code).toBe(EXIT.ok);
  const app = join(root, "app");
  // A project is a folder that exists, kept by its real path.
  expect((await cli("level", "auto", "--project", app, "--yes")).code).toBe(EXIT.refused);
  mkdirSync(app);
  const real = realpathSync.native(app);
  expect((await cli("level", "auto", "--project", app, "--yes")).code).toBe(EXIT.ok);
  expect(json((await cli("level", "--json")).out)).toMatchObject({
    format: "cedarloom.levels",
    default: "checkpoint",
    projects: { [real]: "auto" },
  });
  expect((await cli("level")).out).toBe(`checkpoint  (default)\nauto        ${real}\n`);
  // A relative folder is taken from the working folder.
  const here = realpathSync.native(process.cwd());
  await cli("level", "supervised", "--project", ".", "--yes");
  expect(json((await cli("level", "--json")).out)).toMatchObject({ projects: { [here]: "supervised" } });
  expect((await cli("level", "default", "--project", app, "--yes")).code).toBe(EXIT.ok);
  expect(json((await cli("level", "--json")).out)["projects"]).toEqual({ [here]: "supervised" });
  // An active switch of running work shows under the levels.
  await cli("mode", "auto", "--yes");
  expect((await cli("level")).out).toContain("Switched: auto for the runs that were running at");
  // Only a project's level can be default; a level not in the list is no level.
  expect((await cli("level", "default")).code).toBe(EXIT.usage);
  expect((await cli("level", "fast")).code).toBe(EXIT.usage);
  writeFileSync(join(root, "config", "automation.json"), "{}");
  expect((await cli("level")).code).toBe(EXIT.data);
  expect((await cli("level", "auto")).code).toBe(EXIT.data);
});

test("every finding code has an English sentence", () => {
  const examples = Finding.options.map((option) => option.shape.code.value);
  const params: Record<string, Record<string, unknown>> = {
    "document.invalid": { issues: [{ path: "", code: "invalid_json" }] },
    "plan.chain-broken": { path: "/a.md", index: 1, expected: sha256("a"), found: null },
    "draft.too-large": { id: "w", bytes: 3_000_000, limit: 2_097_152 },
    "run.input-invalid": { input: "focus", type: "number" },
    "run.event-invalid": { runId: "r", seq: 3, issues: [{ path: "attempt", code: "too_small" }] },
    "run.lease-held": { runId: "r", pid: 4242 },
    "run.node-unsupported": { node: "ask", type: "agent.run" },
    "workflow.duplicate-id": { kind: "node", id: "lint" },
    "workflow.trigger-count": { count: 0 },
    "workflow.invalid-config": { node: "j", issues: [{ path: "", code: "invalid_value" }] },
    "workflow.dangling-edge": { edge: "e1", end: "from", ref: "gone" },
    "workflow.unknown-handle": { edge: "e1", end: "to", handle: "lint.nope" },
    "workflow.incompatible-handles": { edge: "e1", from: "number", to: "string" },
    "workflow.unchecked-handles": { edge: "e1", from: "json", to: "string" },
    "workflow.many-sources": { node: null, handle: "report", count: 2 },
    "workflow.missing-source": { node: "check", handle: "value" },
    "workflow.cycle": { nodes: ["a", "b"] },
    "workflow.join-branches": { node: "j", count: 1 },
    "workflow.stray-entry": { section: "layout", node: "gone" },
    "workflow.exclusive-sources": { node: "notes", handle: "run", from: "gate" },
    "workflow.optional-input": { node: "gate", handle: "value", input: "flag" },
    "workflow.schedule-input": { input: "branch" },
    "launch.account-full": { account: "work", max: 2 },
    "extension.refused": { extension: "acme.jira", reason: "sandbox-unavailable" },
    "extension.failed": { extension: "acme.jira", step: "run", error: "a message over 1048576 bytes" },
    "extension.install-refused": { extension: null, reason: "no-manifest" },
    "git.failed": { step: "fetch", error: "fatal: couldn't find remote ref v9" },
    "git.refused-source": { field: "url" },
    "git.unsafe-entry": { path: "dist/link", kind: "link" },
    "git.too-large": { path: null, found: 2001, limit: 2000, unit: "files" },
  };
  for (const code of examples) {
    const finding = Finding.parse({ code, params: params[code] ?? sampleParams(code) });
    expect(text(finding)).toMatch(/^\S.{20,}/s);
  }
  // The other forms of two git findings: a file name, and one file over its size.
  const name = Finding.parse({ code: "git.unsafe-entry", params: { path: "a b.txt", kind: "name" } });
  const file = Finding.parse({ code: "git.too-large", params: { path: "a.bin", found: 11, limit: 10, unit: "bytes" } });
  expect([text(name), text(file)]).toEqual([
    'a b.txt is not a portable file name (letters, digits, ".", "_" and "-"), so nothing of the fetched tree is used.',
    "a.bin has 11 bytes, more than the 10 a fetched tree may have; nothing of it is used.",
  ]);
});

const sampleParams = (code: string): Record<string, unknown> => {
  const shape = Finding.options.find((option) => option.shape.code.value === code)?.shape.params.shape ?? {};
  return Object.fromEntries(Object.keys(shape).map((key) => [key, /found|known/.test(key) ? 2 : sha256(key)]));
};

test("the installed command runs the same program and sets the process exit code", () => {
  const { state } = setup();
  const bin = join(import.meta.dirname, "..", "src", "bin.ts");
  const listed = spawnSync(process.execPath, [bin, "--state", state, "runs", "list"], { encoding: "utf8" });
  expect([listed.status, listed.stdout]).toEqual([EXIT.ok, "No runs yet.\n"]);
  expect(spawnSync(process.execPath, [bin, "nope"], { encoding: "utf8" }).status).toBe(EXIT.usage);
});

test("a replaced file shows as a replace, and an unreadable store is an internal error (exit 70)", async () => {
  const { root, state, cli } = setup();
  writeFileSync(join(root, "notes.md"), "mine\n");
  const plan: Plan = {
    schemaVersion: 1,
    operations: [{ kind: "write", path: join(root, "notes.md"), before: sha256("mine\n"), content: "ours\n" }],
  };
  expect((await cli("plans", "apply", planFile(root, plan), "--yes")).out).toContain("(replace, 5 bytes)");
  const db = new DatabaseSync(join(state, "runs.sqlite"));
  db.exec(`UPDATE runs SET plan = '{"schemaVersion":1,"operations":[]}'`);
  const id = String(db.prepare("SELECT id FROM runs").get()?.["id"]);
  db.close();
  const broken = await cli("runs", "show", id);
  expect([broken.code, broken.err]).toEqual([
    EXIT.internal,
    `internal error: Error: run ${id}: stored plan unreadable (document.invalid)\n`,
  ]);
});

test("a run that stops midway names itself and the undo; doctor reports it until it is undone", async () => {
  const { root, cli } = setup();
  const [path, binary] = [join(root, "a.md"), join(root, "b.bin")];
  writeFileSync(binary, Buffer.from([0xff, 0x00]));
  // The second operation stops at its backup: CedarLoom changes text files only.
  const stopping: Plan = {
    schemaVersion: 1,
    operations: [
      { kind: "write", path, before: null, content: "1\n" },
      { kind: "write", path: binary, before: sha256(Buffer.from([0xff, 0x00])), content: "3\n" },
    ],
  };
  const stopped = await cli("plans", "apply", planFile(root, stopping), "--yes");
  const runId = /Run (\S+) stopped before its end/.exec(stopped.err)?.[1] ?? "";
  expect([
    stopped.code,
    stopped.err.includes(`cedarloom runs undo ${runId} --yes`),
    readFileSync(path, "utf8"),
  ]).toEqual([EXIT.refused, true, "1\n"]);
  expect(json((await cli("--json", "doctor")).out)).toMatchObject({
    findings: [{ code: "run.failed", params: { runId } }],
  });
  await cli("runs", "undo", runId, "--yes");
  expect([(await cli("doctor")).out, existsSync(path)]).toEqual(["No problems found.\n", false]);
});

test("--approve applies only the plan the preview showed", async () => {
  const { root, cli } = setup();
  const file = planFile(root, created(root));
  const previewed = String(json((await cli("--json", "plans", "apply", file)).out)["planHash"]);
  expect((await cli("plans", "apply", file, "--approve", sha256("another plan"))).err).toContain(
    "error: The approval names plan",
  );
  expect((await cli("plans", "apply", file, "--approve", previewed)).code).toBe(EXIT.ok);
  const runId =
    z.array(z.object({ id: z.string() })).parse(json((await cli("--json", "runs", "list")).out)["runs"])[0]?.id ?? "";
  const undoHash = String(json((await cli("--json", "runs", "undo", runId)).out)["planHash"]);
  expect((await cli("runs", "undo", runId, "--approve", undoHash)).code).toBe(EXIT.ok);
  expect(existsSync(join(root, "notes.md"))).toBe(false);
});

test("with --json, usage and internal errors print a JSON error object", async () => {
  const { cli } = setup();
  expect(json((await cli("--json", "frobnicate")).out)).toEqual({
    format: "cedarloom.error",
    schemaVersion: 1,
    error: "usage",
  });
});

test("JSON previews leave file contents out: a backed-up token never reaches stdout", async () => {
  const { root, cli } = setup();
  const env = join(root, ".env.local");
  writeFileSync(env, "TOKEN=secret-123\n");
  const plan: Plan = {
    schemaVersion: 1,
    operations: [{ kind: "write", path: env, before: sha256("TOKEN=secret-123\n"), content: "TOKEN=secret-456\n" }],
  };
  const file = planFile(root, plan);
  for (const argv of [
    ["plans", "show", file],
    ["plans", "apply", file],
  ]) {
    expect((await cli("--json", ...argv)).out).not.toMatch(/secret/);
  }
  await cli("plans", "apply", file, "--yes");
  const runId =
    z.array(z.object({ id: z.string() })).parse(json((await cli("--json", "runs", "list")).out)["runs"])[0]?.id ?? "";
  const preview = await cli("--json", "runs", "undo", runId);
  expect(preview.out).not.toMatch(/secret/);
  expect(json(preview.out)).toMatchObject({
    plan: { operations: [{ path: env, after: sha256("TOKEN=secret-123\n"), bytes: 17 }] },
  });
});

test("a plan whose chain of edits breaks is refused with exit 1 and writes nothing", async () => {
  const { root, cli } = setup();
  const path = join(root, "a.md");
  const broken: Plan = {
    schemaVersion: 1,
    operations: [
      { kind: "write", path, before: null, content: "1\n" },
      { kind: "write", path, before: sha256("2\n"), content: "3\n" },
    ],
  };
  const refused = await cli("plans", "apply", planFile(root, broken), "--yes");
  expect([
    refused.code,
    refused.err.includes("the plan is inconsistent and nothing was written"),
    existsSync(path),
  ]).toEqual([EXIT.refused, true, false]);
});

test("ui serves the API (and the web UI once built) on 127.0.0.1 until stopped, and prints the one-time link", async () => {
  const { state } = setup();
  const stopped = Promise.withResolvers<void>();
  const printed = Promise.withResolvers<string>();
  const io = {
    out: printed.resolve,
    err: () => undefined,
    env: {},
    untilStopped: () => stopped.promise,
    login: () => ({ code: null }),
    authStatus: async () => ({ kind: "logged-out" }) as const,
  };
  const running = main(["--state", state, "--json", "ui"], io);
  // The link comes once the server listens; the first start also loads the server package, which can take over a
  // second on a slow runner. A failed start prints cedarloom.error instead.
  const out = await printed.promise;
  expect(out).toContain("cedarloom.ui");
  const { url } = z.object({ url: z.string() }).parse(JSON.parse(out));
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#t=[\w-]{43}$/);
  expect((await fetch(`${new URL(url).origin}/api/runs`)).status).toBe(401);
  stopped.resolve();
  expect(await running).toBe(EXIT.ok);
});

const MANIFEST = {
  schemaVersion: 1,
  kind: "cedarloom.extension",
  id: "acme.jira",
  version: "1.0.0",
  name: "Jira",
  license: "MIT",
  api: "1.0",
  platforms: ["darwin", "linux"],
  runtime: { kind: "node", entry: "main.mjs" },
  capabilities: {
    net: ["https://acme.atlassian.net"],
    credentials: {
      "jira-token": { scheme: { type: "http", scheme: "bearer" }, hosts: ["https://acme.atlassian.net"] },
    },
    projectRead: true,
    planWrite: true,
  },
  contributes: { actions: { search: { title: "Search" } } },
};
const fileOf = (path: string, body: string) => ({
  path,
  mode: "100644" as const,
  sha256: sha256(body),
  content: Buffer.from(body),
});
// A Git source as the fetch hands it over, without a network: the folder holds the manifest and its entry.
const treeOf = (manifest: object, commit = "c") => ({
  commit: commit.repeat(40),
  digest: commit.repeat(64),
  files: [fileOf("cedarloom-extension.json", JSON.stringify(manifest)), fileOf("main.mjs", "")],
});
const published =
  (manifest: object): Fetch =>
  () =>
    Promise.resolve({ ok: true, value: treeOf(manifest) });
const SOURCE = "https://git.example.org/acme/jira.git";

// Runs a command with --json: its exit code and the JSON object it printed.
const jsonRun =
  (cli: ReturnType<typeof setup>["cli"]) =>
  async (...argv: string[]): Promise<Record<string, unknown>> => {
    const ran = await cli(...argv, "--json");
    return { code: ran.code, ...json(ran.out) };
  };
test("extensions: add plans the install with its source, trust and capabilities, installs it by --approve, and list shows it", async () => {
  const { cli } = setup(published(MANIFEST));
  const run = jsonRun(cli);
  const none = await run("extensions", "list");
  const add = ["extensions", "add", SOURCE, "--ref", "v1", "--path", "jira"];
  const preview = await run(...add);
  const installed = await run(...add, "--approve", String(preview["planHash"]));
  const listed = await run("extensions", "list");
  const again = await run("extensions", "add", SOURCE, "--yes");
  const pin = { id: "acme.jira", trust: "community", ref: "v1", source: expect.objectContaining({ path: "jira" }) };
  expect([none, preview, installed, listed]).toMatchObject([
    { code: EXIT.ok, extensions: [] },
    { code: EXIT.ok, extension: pin, capabilities: MANIFEST.capabilities },
    { code: EXIT.ok, status: "applied" },
    { code: EXIT.ok, extensions: [expect.objectContaining({ id: "acme.jira", digest: "c".repeat(64) })] },
  ]);
  expect(again).toMatchObject({
    code: EXIT.refused,
    findings: [{ code: "extension.install-refused", params: { extension: "acme.jira", reason: "installed" } }],
  });
});

test("extensions: one without capabilities asks for none; a source the CLI never fetches is refused before Git runs", async () => {
  const { license: _license, platforms: _platforms, capabilities: _capabilities, ...plain } = MANIFEST;
  const { state, cli } = setup(published(plain));
  const shown = await cli("extensions", "add", SOURCE);
  await cli("extensions", "add", SOURCE, "--yes");
  const listed = await cli("extensions", "list");
  const local = await setup().cli("extensions", "add", "file:///srv/jira.git");
  writeFileSync(join(state, "extensions.json"), '{"schemaVersion":2}');
  const newer = await cli("extensions", "list");
  expect([shown.out.includes("license none stated"), shown.out.includes("  asks for no capabilities\n")]).toEqual([
    true,
    true,
  ]);
  expect([listed.out, newer.code]).toEqual([`acme.jira  1.0.0  community  ${SOURCE}  ${"c".repeat(12)}\n`, EXIT.data]);
  expect([local.code, local.err]).toEqual([
    EXIT.refused,
    `error: ${text({ code: "git.refused-source", params: { field: "url" } })}\n`,
  ]);
});

// This machine's record that it first saw the commit at the extension's ref four days ago.
const seenBefore = (state: string, commit: string): void =>
  writeFileSync(
    join(state, "extension-updates.json"),
    JSON.stringify({
      "acme.jira": { commit: commit.repeat(40), seen: new Date(Date.now() - 4 * 864e5).toISOString() },
    }),
  );

const NEEDED = [{ code: "extension.consent-needed", params: { extension: "acme.jira" } }];

test("extensions: what enables capabilities takes --approve only; an update waits 3 days and asks again for what grew", async () => {
  const small = { ...MANIFEST, capabilities: { net: ["https://acme.atlassian.net"] } };
  let tree = treeOf(small);
  const { state, cli } = setup(() => Promise.resolve({ ok: true, value: tree }));
  const run = jsonRun(cli);
  const yes = await run("extensions", "add", SOURCE, "--yes");
  const added = await run(
    "extensions",
    "add",
    SOURCE,
    "--approve",
    String((await run("extensions", "add", SOURCE))["planHash"]),
  );
  const current = await run("extensions", "update", "acme.jira");
  tree = treeOf({ ...MANIFEST, version: "1.1.0" }, "d");
  const waiting = await run("extensions", "update", "acme.jira");
  seenBefore(state, "d");
  const grown = await run("extensions", "update", "acme.jira", "--yes");
  const hash = String((await run("extensions", "update", "acme.jira"))["planHash"]);
  const approved = await run("extensions", "update", "acme.jira", "--approve", hash);
  tree = treeOf({ ...small, version: "1.2.0" }, "e");
  seenBefore(state, "e");
  const shrunk = await run("extensions", "update", "acme.jira", "--yes");
  expect([yes, added]).toMatchObject([
    { code: EXIT.refused, findings: NEEDED },
    { code: EXIT.ok, status: "applied" },
  ]);
  expect([current, waiting]).toMatchObject([
    { code: EXIT.ok, kind: "current", commit: "c".repeat(40) },
    { code: EXIT.ok, kind: "waiting", commit: "d".repeat(40) },
  ]);
  expect([grown, approved, shrunk]).toMatchObject([
    { code: EXIT.refused, findings: NEEDED },
    { code: EXIT.ok, status: "applied", grown: true, added: { projectRead: true, planWrite: true } },
    { code: EXIT.ok, status: "applied", grown: false, added: {}, removed: { projectRead: true, planWrite: true } },
  ]);
});

test("extensions: remove takes an extension out with --yes; one not installed is refused by remove and update", async () => {
  const { capabilities: _capabilities, ...plain } = MANIFEST;
  const run = jsonRun(setup(published(plain)).cli);
  const installed = await run("extensions", "add", SOURCE, "--yes");
  const shown = await run("extensions", "remove", "acme.jira");
  const removed = await run("extensions", "remove", "acme.jira", "--yes");
  const unknown = [{ code: "extension.unknown", params: { extension: "acme.jira" } }];
  expect([installed, shown, removed]).toMatchObject([
    { code: EXIT.ok, status: "applied" },
    { code: EXIT.ok, extension: "acme.jira", planHash: expect.any(String) },
    { code: EXIT.ok, status: "applied" },
  ]);
  expect([await run("extensions", "remove", "acme.jira"), await run("extensions", "update", "acme.jira")]).toEqual([
    { code: EXIT.refused, format: "cedarloom.plan", schemaVersion: 1, findings: unknown },
    { code: EXIT.refused, format: "cedarloom.plan", schemaVersion: 1, findings: unknown },
  ]);
});

test("extensions: a manifest's unknown key reaches the terminal escaped, never as control characters", async () => {
  const key = "\u001b[2K\u001b]8;;https://evil.example\u0007x";
  const { cli } = setup(published({ ...MANIFEST, [key]: 1 }));
  const refused = await cli("extensions", "add", SOURCE);
  expect([refused.code, refused.err.includes("\u001b"), refused.err.includes("\u0007")]).toEqual([
    EXIT.data,
    false,
    false,
  ]);
  expect(refused.err).toContain("\\u001b[2K\\u001b]8;;https://evil.example\\u0007x");
});
