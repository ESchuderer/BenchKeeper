import { claudeRuntime } from "@cedarloom/adapter-claude";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Fetch, LoginStatus } from "@cedarloom/use-cases";
import { Finding, formatRegistry, formatWorkflow, type Plan, WorkflowDefinition } from "@cedarloom/contracts";
import { configDir, describe as text, EXIT, main, stateDir } from "@cedarloom/cli";
import { openGraphStore, openRunStore, planHash, sha256 } from "@cedarloom/ledger";
import { expect, test, vi } from "vitest";
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
  // When the program is to stop (Ctrl+C), which cancels a graph run: never, unless a test says so. A Git source's fetch.
  { stopped = new Promise<void>(() => undefined), fetch }: { stopped?: Promise<void>; fetch?: Fetch } = {},
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
      untilStopped: () => stopped,
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
      // No test starts an agent.
      agent: claudeRuntime(["false"]),
      // The app's own extensions: none unless a test puts one there.
      bundled: join(root, "app"),
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

test("runs show names a worker run's totals as its session's result reported them", async () => {
  const { state, cli } = setup();
  const runId = "0b9f4c1e-8d2a-4c6b-9f3e-1a2b3c4d5e61";
  const labels = {
    phase: "implement",
    model: "claude-opus-5-5",
    subagentModel: "claude-opus-5-5",
    effort: "high",
    permissionMode: "dontAsk",
    review: false,
    level: "supervised",
    tier: null,
  } as const;
  const lease = {
    runId,
    task: "t",
    agent: "claude",
    account: "work",
    version: "2.1.316",
    pid: process.pid,
    labels,
  } as const;
  const totals = {
    inputTokens: 2,
    outputTokens: 70,
    cacheReadTokens: 11687,
    cacheCreationTokens: 12674,
    costUsd: 0.105,
  };
  const store = openRunStore(state);
  if (!store.ok) throw new Error(store.finding.code);
  store.value.leaseAccount({ ...lease, startedAt: "2026-11-07T08:00:00.000Z" }, 2)?.release();
  store.value.recordTotals(runId, totals);
  store.value.close();
  expect(json((await cli("runs", "show", runId, "--json")).out)).toMatchObject({
    launch: { runId, account: "work", totals },
  });
  expect((await cli("runs", "show", runId)).code).toBe(EXIT.ok);
});

test("a store from a newer CedarLoom makes reads, mode and doctor fail with exit 1", async () => {
  const { state, cli } = setup();
  const store = openRunStore(state);
  if (store.ok) store.value.close();
  const db = new DatabaseSync(join(state, "runs.sqlite"));
  db.exec("PRAGMA user_version = 99");
  db.close();
  expect((await cli("runs", "list")).code).toBe(EXIT.refused);
  expect((await cli("runs", "show", "x")).code).toBe(EXIT.refused);
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

test("the config folder comes from CEDARLOOM_CONFIG_DIR, then XDG_CONFIG_HOME, then ~/.config", () => {
  expect(configDir({ CEDARLOOM_CONFIG_DIR: "/c", XDG_CONFIG_HOME: "/x" })).toBe("/c");
  expect(configDir({ CEDARLOOM_CONFIG_DIR: "c", XDG_CONFIG_HOME: "/x" })).toBe(join("/x", "cedarloom"));
  expect(configDir({})).toBe(join(homedir(), ".config", "cedarloom"));
});

// A Claude Code account in /accounts.
const account = (name: string, pool: string | null) => {
  return { name, agent: "claude" as const, home: `/accounts/${name}`, pool, added: "2026-11-05T12:00:00.000Z" };
};

// A temporary setup with a registry: work in the unconfirmed pool main, solo in none.
const withRegistry = () => {
  const { root, state, logins, cli } = setup();
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(
    join(root, "config", "accounts.json"),
    formatRegistry({
      schemaVersion: 1,
      accounts: [account("work", "main"), account("solo", null)],
      pools: { claude: { main: { confirmedAt: null, confirmedFor: [] } } },
    }),
  );
  return { root, state, logins, cli };
};

test("accounts: an account moves into its own home with --yes, and its login runs only there", async () => {
  const { state, logins, cli } = withRegistry();
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
  const { root, cli } = withRegistry();
  const state = relative(process.cwd(), join(root, "elsewhere"));
  const moved = await cli("--state", state, "--json", "accounts", "home", "work", "--yes");
  expect([moved.code, json(moved.out)]).toEqual([EXIT.ok, expect.objectContaining({ status: "applied" })]);
  expect((await cli("accounts", "list")).out).toContain(join(root, "elsewhere", "homes", "work"));
});

test("accounts: an account is added with its own home by a plan, and its login runs there", async () => {
  const { state, logins, cli } = setup();
  // The preview changes nothing: still no registry.
  expect((await cli("accounts", "add", "work", "--pool", "main")).code).toBe(EXIT.ok);
  expect(json((await cli("accounts", "list", "--json")).out)).toMatchObject({ registry: null });
  expect(json((await cli("accounts", "add", "work", "--pool", "main", "--yes", "--json")).out)).toMatchObject({
    format: "cedarloom.run",
    status: "applied",
  });
  const home = join(state, "homes", "work");
  expect((await cli("accounts", "list")).out).toBe(`work  claude  main (not confirmed)  ${home}\n`);
  expect((await cli("accounts", "login", "work")).code).toBe(EXIT.ok);
  expect(logins.started).toEqual([expect.objectContaining({ CLAUDE_CONFIG_DIR: home })]);
  const again = await cli("accounts", "add", "work", "--json");
  expect(again.code).toBe(EXIT.refused);
  expect(json(again.out)).toMatchObject({ findings: [{ code: "accounts.name-taken", params: { account: "work" } }] });
});

test("accounts: the list shows each account with its pool, says when there are none, and refuses a broken registry", async () => {
  // No registry yet: no accounts, checked in the JSON form rather than the text.
  expect(json((await setup().cli("accounts", "list", "--json")).out)).toMatchObject({ registry: null, confirmed: [] });
  const { root, cli } = withRegistry();
  expect((await cli("accounts", "list")).out).toBe(
    "work  claude  main (not confirmed)  /accounts/work\nsolo  claude  -  /accounts/solo\n",
  );
  writeFileSync(join(root, "config", "accounts.json"), "{}");
  expect((await cli("accounts", "list", "--json")).code).toBe(EXIT.data);
});

test("accounts: a pool's confirmation carries the terms warning in every output form; Codex pools are refused", async () => {
  const { cli } = withRegistry();
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

test("a profile with a problem is refused, never shown as a machine with nothing to change", async () => {
  const { cli } = setup();
  const { code, out } = await cli("--json", "profiles", "apply");
  expect([code, json(out)["findings"]]).toEqual([
    EXIT.refused,
    [{ code: "profile.binding-missing", params: { part: "workspace.hub", binding: "hub" } }],
  ]);
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
    "profile.parent-cycle": { chain: ["acme.x/a.json", "acme.x/b.json", "acme.x/a.json"] },
    "profile.parent-limit": { chain: ["acme.x/a.json", "acme.x/b.json"], limit: 50 },
    "profile.pack-sources": { pack: "acme.x", files: ["acme.a", "acme.b"] },
    "store.version-not-higher": { id: "w", stored: "1.9.0", found: "1.9.0" },
    "store.identity-missing": { key: "user.email" },
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

test("a project folder with shell syntax in its name is one quoted argument, so pasting the command runs none of it", () => {
  const project = "/work/it's $(id) `x`;";
  const approval = Finding.parse({
    code: "profile.target-approval",
    params: { part: "project.dc", title: "dc", project, source: null, programs: ["scripts/dc"], configs: [] },
  });
  expect(text(approval)).toContain(`--project '/work/it'\\''s $(id) \`x\`;' --allow project.dc`);
});

// An enum's first option, a count for found and known, else a string.
const sampleValue = (key: string, schema: unknown): unknown => {
  if (schema instanceof z.ZodEnum) return schema.options[0];
  if (schema instanceof z.ZodBoolean) return true;
  if (schema instanceof z.ZodString) return sha256(key);
  if (schema instanceof z.ZodArray) return [sha256(key)];
  return /found|known/.test(key) ? 2 : sha256(key);
};
const sampleParams = (code: string): Record<string, unknown> => {
  const shape = Finding.options.find((option) => option.shape.code.value === code)?.shape.params.shape ?? {};
  return Object.fromEntries(Object.entries(shape).map(([key, schema]) => [key, sampleValue(key, schema)]));
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
    agent: claudeRuntime(["false"]),
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

// A setup at the Checkpoint level, as these tests run: a node goes, and a plan a run built waits for the owner. Written
// as a file, since `level --yes` would add an apply run to the ones the tests count.
const atCheckpoint = (...options: Parameters<typeof setup>): ReturnType<typeof setup> => {
  const at = setup(...options);
  mkdirSync(join(at.root, "config"), { recursive: true });
  const settings = { schemaVersion: 1, default: "checkpoint", projects: {} };
  writeFileSync(join(at.root, "config", "automation.json"), JSON.stringify(settings));
  return at;
};

// t -> a, a command that greets the input `name`.
const workflow = WorkflowDefinition.parse({
  schemaVersion: 1,
  kind: "cedarloom.workflow",
  metadata: { id: "greet", name: "Greet", version: "1.0.0" },
  inputs: { name: { type: "string" } },
  nodes: [
    { id: "t", type: "trigger.manual" },
    { id: "a", type: "command.run", with: { command: 'printf "hello %s" "$CEDARLOOM_INPUT_name"' } },
  ],
  edges: [{ id: "e1", from: { node: "t", handle: "start" }, to: { node: "a", handle: "run" } }],
});

test("on a fresh install, Supervised, workflows run waits before its command for the owner", async () => {
  const { root, cli } = setup();
  const file = planFile(root, workflow, "greet.json");
  const ran = json((await cli("--json", "workflows", "run", file, "--input", "name=Ada", "--project", root)).out);
  expect(ran).toMatchObject({ format: "cedarloom.run", status: "waiting" });
});

test("workflows run runs a graph run; runs list and show show it with its attempts beside apply runs", async () => {
  const { root, cli } = atCheckpoint();
  const file = planFile(root, workflow, "greet.json");
  const ran = json((await cli("--json", "workflows", "run", file, "--input", "name=Ada", "--project", root)).out);
  expect(ran).toMatchObject({ format: "cedarloom.run", status: "succeeded" });
  const runId = String(ran["runId"]);
  expect((await cli("runs", "list")).out).toContain(`${runId}  graph  succeeded`);
  expect((await cli("runs", "show", runId)).out).toMatch(
    /^Run .*: graph greet, succeeded,.*\n {2}a#1 +done +pid \d+\n$/,
  ); // A report run runs no command outside an OS sandbox.
  const report = await cli("--json", "workflows", "run", file, "--input", "name=Ada", "--project", root, "--report");
  expect([report.code, json(report.out)]).toMatchObject([
    EXIT.refused,
    { findings: [{ code: "run.sandbox-unavailable", params: { node: "a" } }] },
  ]);
});

test("runs approve shows what a waiting node waits for, and with --yes approves it and runs the run on", async () => {
  const { root, cli } = atCheckpoint();
  const asking = WorkflowDefinition.parse({
    ...workflow,
    nodes: [...workflow.nodes, { id: "go", type: "human.approval", with: { message: "Greet?" } }],
    edges: [
      { id: "e1", from: { node: "t", handle: "start" }, to: { node: "go", handle: "run" } },
      { id: "e2", from: { node: "go", handle: "approved" }, to: { node: "a", handle: "run" } },
    ],
  });
  const file = planFile(root, asking, "ask.json");
  const ran = json((await cli("--json", "workflows", "run", file, "--input", "name=Ada", "--project", root)).out);
  const runId = String(ran["runId"]);
  const shown = json((await cli("--json", "runs", "approve", runId, "go")).out);
  const other = await cli("--json", "runs", "reject", runId, "a");
  const approved = json((await cli("--json", "runs", "approve", runId, "go", "--yes", "--project", root)).out);
  expect([ran["status"], shown["wait"], other.code, approved["status"]]).toEqual([
    "waiting",
    { node: "go", point: "human.approval", planHash: null, content: null },
    EXIT.refused,
    "succeeded",
  ]);
});

test("runs approve shows a write's content with its control characters escaped, so none of it rewrites the prompt", async () => {
  const { root, cli } = atCheckpoint();
  const writing = WorkflowDefinition.parse({
    ...workflow,
    nodes: [
      { id: "t", type: "trigger.manual" },
      { id: "say", type: "command.run", with: { command: "printf '\\033[2Jkept\\tline\\nnext'" } },
      { id: "out", type: "file.write", with: { path: "out.txt" } },
    ],
    edges: [
      { id: "e1", from: { node: "t", handle: "start" }, to: { node: "say", handle: "run" } },
      { id: "e2", from: { node: "say", handle: "done" }, to: { node: "out", handle: "run" } },
      { id: "e3", from: { node: "say", handle: "stdout" }, to: { node: "out", handle: "content" } },
    ],
  });
  const file = planFile(root, writing, "write.json");
  const ran = json((await cli("--json", "workflows", "run", file, "--input", "name=Ada", "--project", root)).out);
  const { out } = await cli("runs", "approve", String(ran["runId"]), "out");
  expect([out.includes("\u001b"), out]).toEqual([false, expect.stringContaining("\\u001b[2Jkept\tline\nnext")]);
});

test("runs resume and cancel take over a graph run no process runs, and Ctrl+C cancels one this process runs", async () => {
  const { root, state, cli } = atCheckpoint();
  const file = planFile(root, workflow, "greet.json");
  // Two runs whose runner died while a ran with pid 4242: a resume counts the attempt as failed, a cancel ends the run.
  const store = openGraphStore(state);
  if (!store.ok) throw new Error(store.finding.code);
  const [one = "", two = ""] = [1, 2].map(() => {
    const lease = store.value.create({
      definition: workflow,
      inputs: {},
      trigger: "manual",
      mode: "act",
      parentRun: null,
      parentNode: null,
      project: realpathSync(root),
    });
    store.value.append(lease.runId, 1, { type: "started", node: "a", attempt: 1, pid: 4242 });
    lease.release();
    return lease.runId;
  });
  store.value.close();
  // Without --yes a resume or a cancel lists the attempts it would end, and changes nothing.
  expect((await cli("runs", "resume", one, "--project", root)).out).toContain("\n  a#1  pid 4242\n");
  expect((await cli("runs", "cancel", two)).out).toContain("\n  a#1  pid 4242\n");
  expect(await cli("runs", "resume", one, "--project", root, "--yes")).toEqual({
    code: EXIT.refused,
    out: `Run ${one}: failed.\n`,
    err: "",
  });
  expect((await cli("runs", "show", one)).out).toMatch(/a#1 +interrupted +pid 4242/);
  // The plan refuses what --yes would: a run that has ended.
  expect((await cli("runs", "resume", one)).err).toContain("has ended (failed)");
  // A resume or cancel runs only in the run's own folder.
  expect((await cli("runs", "cancel", two, "--project", state)).err).toContain(`runs in ${realpathSync(root)}, not in`);
  expect((await cli("runs", "cancel", two, "--yes")).out).toBe(`Run ${two}: cancelled.\n`);
  expect((await cli("runs", "list")).out.trim().split("\n")).toHaveLength(2);
  // Ctrl+C while a run runs cancels it.
  const slow = planFile(
    root,
    { ...workflow, nodes: [workflow.nodes[0], { id: "a", type: "command.run", with: { command: "sleep 30" } }] },
    "slow.json",
  );
  const stopping = atCheckpoint({ stopped: new Promise((resolve) => setTimeout(resolve, 500)) });
  expect((await stopping.cli("workflows", "run", slow, "--project", root)).out).toMatch(/: cancelled\.\n$/);
  expect((await cli("runs", "resume", "nope")).code).toBe(EXIT.refused);
  expect((await cli("runs", "resume", "nope", "--yes")).code).toBe(EXIT.refused);
  expect((await cli("workflows", "run", file, "--input", "Ada")).code).toBe(EXIT.usage);
  expect((await cli("workflows", "run", join(root, "none.json"))).code).toBe(EXIT.noInput);
});

test("a cancel's plan of a run its runner holds says the runner ends the attempts cancelled", async () => {
  const { root, state, cli } = setup();
  const store = openGraphStore(state);
  if (!store.ok) throw new Error(store.finding.code);
  const run = { inputs: {}, trigger: "manual", mode: "act", parentRun: null, parentNode: null } as const;
  // Held by this process, with a folder that is gone: a cancel starts nothing, so it needs none.
  const lease = store.value.create({ ...run, definition: workflow, project: join(root, "gone") });
  store.value.append(lease.runId, 1, { type: "started", node: "a", attempt: 1, pid: 4242 });
  const plan = await cli("runs", "cancel", lease.runId);
  expect(plan.out).toContain(`graph greet, running.\nRunning now; its runner ends them cancelled:\n  a#1  pid 4242\n`);
  lease.release();
  store.value.close();
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
  const { cli } = setup({ fetch: published(MANIFEST) });
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
  const { state, cli } = setup({ fetch: published(plain) });
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
      schemaVersion: 1,
      kind: "cedarloom.extension-updates",
      extensions: { "acme.jira": { commit: commit.repeat(40), seen: new Date(Date.now() - 4 * 864e5).toISOString() } },
    }),
  );

const NEEDED = [{ code: "extension.consent-needed", params: { extension: "acme.jira" } }];

test("extensions: what enables capabilities takes --approve only; an update waits 3 days and asks again for what grew", async () => {
  const small = { ...MANIFEST, capabilities: { net: ["https://acme.atlassian.net"] } };
  let tree = treeOf(small);
  const { state, cli } = setup({ fetch: () => Promise.resolve({ ok: true, value: tree }) });
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
    { code: EXIT.ok, status: "applied", added: { projectRead: true, planWrite: true } },
    { code: EXIT.ok, status: "applied", added: {}, removed: { projectRead: true, planWrite: true } },
  ]);
});

test("extensions: remove takes an extension out with --yes; one not installed is refused by remove and update", async () => {
  const { capabilities: _capabilities, ...plain } = MANIFEST;
  const run = jsonRun(setup({ fetch: published(plain) }).cli);
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
  const { cli } = setup({ fetch: published({ ...MANIFEST, [key]: 1 }) });
  const refused = await cli("extensions", "add", SOURCE);
  expect([refused.code, refused.err.includes("\u001b"), refused.err.includes("\u0007")]).toEqual([
    EXIT.data,
    false,
    false,
  ]);
  expect(refused.err).toContain("\\u001b[2K\\u001b]8;;https://evil.example\\u0007x");
});

test("workflows save stores a draft as a version, history lists it, export writes it, import stores it elsewhere, and an id that is none, --yes from Git at a moving ref and --ref with a folder exit 64", async () => {
  const { root, state, cli } = setup();
  // Store commits carry the user's Git identity, from a home folder of the test's own.
  writeFileSync(join(root, ".gitconfig"), "[user]\n\tname = Ada\n\temail = ada@example.org\n");
  vi.stubEnv("HOME", root);
  vi.stubEnv("XDG_CONFIG_HOME", root);
  const corpus = join(import.meta.dirname, "..", "..", "contracts", "corpus", "WorkflowDefinition", "1");
  const sample = JSON.parse(readFileSync(join(corpus, "valid-build-and-review.json"), "utf8"));
  const draft = WorkflowDefinition.parse({ ...sample, metadata: { ...sample.metadata, id: "w" } });
  mkdirSync(join(state, "drafts"), { recursive: true });
  writeFileSync(join(state, "drafts", "workflow-w.json"), formatWorkflow(draft));
  const saved = await cli("workflows", "save", "w", "--yes", "--json");
  const history = json((await cli("workflows", "history", "w", "--json")).out);
  const none = await cli("workflows", "history", "9w");
  const exported = await cli("workflows", "export", "w", "--to", join(root, "shared"), "--yes", "--json");
  const index = JSON.parse(readFileSync(join(root, "shared", "cedarloom-export.json"), "utf8"));
  const badId = await cli("workflows", "export", "9w", "--to", join(root, "other"));
  // Another machine imports the export folder and stores the version.
  const other = setup();
  const imported = await other.cli("import", join(root, "shared"), "--yes", "--json");
  const there = json((await other.cli("workflows", "history", "w", "--json")).out);
  // --yes stores only what the review showed: from Git that is a commit, never a ref that can move.
  const unpinned = await other.cli("import", "https://example.org/flows.git", "--ref", "main", "--yes");
  const folderRef = await other.cli("import", join(root, "shared"), "--ref", "main");
  // A URL with a password is no Git source and no folder, and the password is not shown.
  const secret = await other.cli("import", "https://ada:hunter2@example.org/flows.git");
  vi.unstubAllEnvs();
  const refusals = [unpinned.code, folderRef.code, secret.code, `${secret.out}${secret.err}`.includes("hunter2")];
  const stored = [imported.code, Reflect.get(Object(there["versions"]), "length"), ...refusals];
  expect([saved.code, history["versions"], none.code, exported.code, index["workflows"], badId.code, stored]).toEqual([
    EXIT.ok,
    [
      {
        commit: expect.stringMatching(/^[0-9a-f]{40}$/),
        savedAt: expect.any(String),
        author: "Ada",
        version: draft.metadata.version,
      },
    ],
    EXIT.usage,
    EXIT.ok,
    ["w"],
    EXIT.usage,
    [EXIT.ok, 1, EXIT.usage, EXIT.usage, EXIT.usage, false],
  ]);
});

test("a verb the app's own extension contributes runs its action and prints its outputs, and is refused while off", async () => {
  const { root, cli } = setup();
  const folder = join(root, "app", "cedarloom.example");
  mkdirSync(folder, { recursive: true });
  const contributes = { actions: { status: { title: "Status" } }, commands: ["status"] };
  const manifest = { ...MANIFEST, id: "cedarloom.example", platforms: undefined, capabilities: undefined, contributes };
  writeFileSync(join(folder, "cedarloom-extension.json"), JSON.stringify(manifest));
  const fixture = join(import.meta.dirname, "..", "..", "use-cases", "test", "fixtures", "doctor", "main.mjs");
  copyFileSync(fixture, join(folder, "main.mjs"));
  const ran = await cli("example", "status");
  const asJson = json((await cli("example", "status", "--json")).out);
  await cli("components", "switch", "cedarloom.example", "off", "--yes");
  const off = await cli("example", "status", "--json");
  expect([ran.code, ran.out, asJson, off.code, json(off.out)["findings"]]).toEqual([
    EXIT.ok,
    "ready: true\n",
    {
      format: "cedarloom.extension",
      schemaVersion: 1,
      extension: "cedarloom.example",
      action: "status",
      outputs: { ready: true },
    },
    EXIT.refused,
    [{ code: "extension.refused", params: { extension: "cedarloom.example", reason: "off" } }],
  ]);
});

test("components switch turns the app's own extension off as one run, which extensions list shows", async () => {
  const { root, cli } = setup();
  const folder = join(root, "app", "cedarloom.example");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "cedarloom-extension.json"), JSON.stringify({ ...MANIFEST, id: "cedarloom.example" }));
  const switched = await cli("components", "switch", "cedarloom.example", "off", "--yes", "--json");
  const listed = json((await cli("extensions", "list", "--json")).out);
  const wrong = await cli("components", "switch", "cedarloom.example", "on");
  expect([switched.code, listed["extensions"], wrong.code]).toEqual([
    EXIT.ok,
    [{ id: "cedarloom.example", version: "1.0.0", trust: "bundled", state: "off" }],
    EXIT.usage,
  ]);
});
