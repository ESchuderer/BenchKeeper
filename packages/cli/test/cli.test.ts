import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Finding, type Plan } from "@cedarloom/contracts";
import { benchKeeperRegistry, configDir, describe as text, EXIT, main, stateDir } from "@cedarloom/cli";
import { openRunStore, planHash, sha256 } from "@cedarloom/ledger";
import { expect, test } from "vitest";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };

const setup = (): {
  root: string;
  state: string;
  cli: (...argv: string[]) => Promise<{ code: number; out: string; err: string }>;
} => {
  const root = mkdtempSync(join(tmpdir(), "cedarloom-cli-"));
  const state = join(root, "state");
  const cli = async (...argv: string[]): Promise<{ code: number; out: string; err: string }> => {
    let [out, err] = ["", ""];
    const io = {
      out: (t: string) => (out += t),
      err: (t: string) => (err += t),
      env: { CEDARLOOM_STATE_DIR: state, CEDARLOOM_CONFIG_DIR: join(root, "config") },
      untilStopped: () => Promise.resolve(),
    };
    return { code: await main(argv, io), out, err };
  };
  return { root, state, cli };
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

test("a store from a newer CedarLoom makes reads and doctor fail with exit 1", async () => {
  const { state, cli } = setup();
  const store = openRunStore(state);
  if (store.ok) store.value.close();
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(join(state, "runs.sqlite"));
  db.exec("PRAGMA user_version = 5");
  db.close();
  expect((await cli("runs", "list")).code).toBe(EXIT.refused);
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
  const { root, cli } = setup();
  const boxed = { name: "boxed", agent: "claude", mode: "container", volume: "v", mount: "/m" };
  const registry = { accounts: [host("work", "main"), host("solo"), boxed], settings: { autoPick: true } };
  return { root, cli, from: planFile(root, registry, "benchkeeper.json") };
};

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

test("every finding code has an English sentence", () => {
  const examples = Finding.options.map((option) => option.shape.code.value);
  const params: Record<string, Record<string, unknown>> = {
    "document.invalid": { issues: [{ path: "", code: "invalid_json" }] },
    "plan.chain-broken": { path: "/a.md", index: 1, expected: sha256("a"), found: null },
    "draft.too-large": { id: "w", bytes: 3_000_000, limit: 2_097_152 },
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
  };
  for (const code of examples) {
    const finding = Finding.parse({ code, params: params[code] ?? sampleParams(code) });
    expect(text(finding)).toMatch(/^\S.{20,}/s);
  }
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
  const { DatabaseSync } = await import("node:sqlite");
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
  const io = { out: printed.resolve, err: () => undefined, env: {}, untilStopped: () => stopped.promise };
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
