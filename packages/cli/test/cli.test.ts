import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Fetch, Keyring } from "@cedarloom/use-cases";
import { Finding, formatWorkflow, type Plan, WorkflowDefinition } from "@cedarloom/contracts";
import { configDir, describe as text, EXIT, main, stateDir } from "@cedarloom/cli";
import { openRunStore, planHash, sha256 } from "@cedarloom/ledger";
import { expect, test, vi } from "vitest";
import { z } from "zod";

// The keyring in memory: no test reads or writes the OS credential store.
const memoryKeyring = (entries: Map<string, string>): Keyring => ({
  get: async (name) => entries.get(name) ?? null,
  set: async (name, value) => void entries.set(name, value),
});

const setup = (
  // A Git source's fetch. Standard input: a terminal unless a test pipes text in.
  { fetch, stdin = null }: { fetch?: Fetch; stdin?: string | null } = {},
): {
  root: string;
  state: string;
  keyring: Map<string, string>;
  cli: (...argv: string[]) => Promise<{ code: number; out: string; err: string }>;
} => {
  const root = mkdtempSync(join(tmpdir(), "cedarloom-cli-"));
  const state = join(root, "state");
  const keyring = new Map<string, string>();
  const cli = async (...argv: string[]): Promise<{ code: number; out: string; err: string }> => {
    let [out, err] = ["", ""];
    const io = {
      out: (t: string) => (out += t),
      err: (t: string) => (err += t),
      // A Claude Code home of the test's own, so that no command reaches the user's.
      env: {
        CEDARLOOM_STATE_DIR: state,
        CEDARLOOM_CONFIG_DIR: join(root, "config"),
        CLAUDE_CONFIG_DIR: join(root, "claude"),
      },
      untilStopped: () => new Promise<void>(() => undefined),
      // The app's own extensions and the hooks' bundles: none unless a test puts them there.
      bundled: join(root, "app"),
      hooks: join(root, "hooks"),
      ...(fetch === undefined ? {} : { fetch }),
      stdin: async () => stdin,
      keyring: memoryKeyring(keyring),
    };
    return { code: await main(argv, io), out, err };
  };
  return { root, state, keyring, cli };
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
  expect(newer.code).toBe(EXIT.data);
});

test("runs list, show and undo: undo previews without --yes and applies as its own run with --yes", async () => {
  const { root, cli } = setup();
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
  expect((await cli("runs", "undo", "nope")).code).toBe(EXIT.refused);
});

test("doctor reports an interrupted run as a warning with its fix, and a busy store blocks a change", async () => {
  const { root, state, cli } = setup();
  const store = openRunStore(state);
  if (!store.ok) throw new Error(store.finding.code);
  const plan = created(root);
  const id = store.value.begin("apply", plan, planHash(plan));
  expect((await cli("plans", "apply", planFile(root, plan), "--yes")).err).toContain("Another CedarLoom process");
  expect((await cli("doctor", "--json")).out).toContain('"findings":[]');
  store.value.close();
  const report = await cli("doctor", "--json");
  expect([report.code, json(report.out)["findings"]]).toMatchObject([
    EXIT.ok,
    [{ code: "run.interrupted", params: { runId: id.ok ? id.value : "" } }],
  ]);
  expect((await cli("runs", "list")).out).toContain("interrupted");
});

test("a store from a newer CedarLoom makes reads and doctor fail with exit 1", async () => {
  const { state, cli } = setup();
  const store = openRunStore(state);
  if (store.ok) store.value.close();
  const db = new DatabaseSync(join(state, "runs.sqlite"));
  db.exec("PRAGMA user_version = 99");
  db.close();
  expect((await cli("runs", "list")).code).toBe(EXIT.refused);
  expect((await cli("runs", "show", "x")).code).toBe(EXIT.refused);
  const report = await cli("doctor", "--json");
  expect([report.code, report.out.includes("store.newer-schema")]).toEqual([EXIT.refused, true]);
});

test("usage errors exit 64, and help exits 0", async () => {
  const { cli } = setup();
  expect((await cli("frobnicate")).code).toBe(EXIT.usage);
  expect((await cli("runs", "show")).code).toBe(EXIT.usage);
  expect((await cli("--help")).code).toBe(EXIT.ok);
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
  // Only a project's level can be default; a level not in the list is no level.
  expect((await cli("level", "default")).code).toBe(EXIT.usage);
  expect((await cli("level", "fast")).code).toBe(EXIT.usage);
  writeFileSync(join(root, "config", "automation.json"), "{}");
  expect((await cli("level")).code).toBe(EXIT.data);
  expect((await cli("level", "auto")).code).toBe(EXIT.data);
});

test("a project folder with shell syntax in its name is one quoted argument, so pasting the command runs none of it", () => {
  const project = "/work/it's $(id) `x`;";
  const approval = Finding.parse({
    code: "profile.target-approval",
    params: { part: "project.dc", title: "dc", project, source: null, programs: ["scripts/dc"], configs: [] },
  });
  expect(text(approval)).toContain(`--project '/work/it'\\''s $(id) \`x\`;' --allow project.dc`);
});

// Two Node processes each strip and load the whole CLI: together past 5 s under full-suite load.
test("the installed command runs the same program and sets the process exit code", () => {
  const { state } = setup();
  const bin = join(import.meta.dirname, "..", "src", "bin.ts");
  const listed = spawnSync(process.execPath, [bin, "--state", state, "runs", "list"], { encoding: "utf8" });
  expect([listed.status, listed.stdout]).toEqual([EXIT.ok, "No runs yet.\n"]);
  expect(spawnSync(process.execPath, [bin, "nope"], { encoding: "utf8" }).status).toBe(EXIT.usage);
}, 30_000);

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
  expect(broken.code).toBe(EXIT.internal);
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
  expect([json((await cli("--json", "doctor")).out)["findings"], existsSync(path)]).toEqual([[], false]);
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
    stdin: async () => null,
    keyring: memoryKeyring(new Map()),
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
  const local = await setup().cli("--json", "extensions", "add", "file:///srv/jira.git");
  writeFileSync(join(state, "extensions.json"), '{"schemaVersion":2}');
  const newer = await cli("extensions", "list");
  expect([shown.out.includes("license none stated"), shown.out.includes("  asks for no capabilities\n")]).toEqual([
    true,
    true,
  ]);
  expect([listed.out, newer.code]).toEqual([`acme.jira  1.0.0  community  ${SOURCE}  ${"c".repeat(12)}\n`, EXIT.data]);
  expect([local.code, json(local.out)["findings"]]).toEqual([
    EXIT.refused,
    [{ code: "git.refused-source", params: { field: "url" } }],
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

// The corpus workflow `name` with `more` nodes as the draft w in `state`; store commits carry the Git identity of a home
// folder of the test's own.
const drafted = (root: string, state: string, name: string, more: object[] = []): WorkflowDefinition => {
  writeFileSync(join(root, ".gitconfig"), "[user]\n\tname = Ada\n\temail = ada@example.org\n");
  vi.stubEnv("HOME", root);
  vi.stubEnv("XDG_CONFIG_HOME", root);
  const corpus = join(import.meta.dirname, "..", "..", "contracts", "corpus", "WorkflowDefinition", "1");
  const sample = JSON.parse(readFileSync(join(corpus, name), "utf8"));
  const nodes = [...sample.nodes, ...more];
  const draft = WorkflowDefinition.parse({ ...sample, metadata: { ...sample.metadata, id: "w" }, nodes });
  mkdirSync(join(state, "drafts"), { recursive: true });
  writeFileSync(join(state, "drafts", "workflow-w.json"), formatWorkflow(draft));
  return draft;
};

// The codes of a command's findings, from its --json output.
const codes = (out: string): unknown =>
  Finding.array()
    .parse(json(out)["findings"])
    .map(({ code }) => code);

test("workflows install refuses without the hooks' bundles, and installs only once approved by the plugin's name, which a warning does not hold back", async () => {
  const { root, state, cli } = setup();
  drafted(root, state, "valid-build-and-review.json");
  await cli("workflows", "save", "w", "--yes");
  const bundleless = await cli("workflows", "install", "w", "--allow", "w", "--yes", "--json");
  mkdirSync(join(root, "hooks"));
  for (const name of ["guard.mjs", "exits.mjs"]) writeFileSync(join(root, "hooks", name), "// bundle\n");
  const unapproved = await cli("workflows", "install", "w", "--yes", "--json");
  const settings = join(root, "claude", "settings.json");
  const untouched = existsSync(settings);
  const approved = await cli("workflows", "install", "w", "--allow", "w", "--yes");
  expect([bundleless.code, codes(bundleless.out), unapproved.code, codes(unapproved.out), untouched]).toEqual([
    EXIT.refused,
    ["package.hooks-missing"],
    EXIT.refused,
    ["package.approval-needed"],
    false,
  ]);
  expect([approved.code, JSON.parse(readFileSync(settings, "utf8")).enabledPlugins]).toEqual([
    EXIT.ok,
    { "w@cedarloom-workflows": true },
  ]);
  // Another package below Auto: its warning leaves an approved install to go ahead.
  const other = join(state, "workflow-packages", "v", ".claude-plugin");
  mkdirSync(other, { recursive: true });
  const description = "The CedarLoom workflow v, at the automation level supervised.";
  writeFileSync(join(other, "plugin.json"), JSON.stringify({ name: "v", description }));
  const mixed = await cli("workflows", "install", "w", "--level", "auto", "--allow", "w", "--yes", "--json");
  expect([mixed.code, codes(mixed.out)]).toEqual([EXIT.ok, ["package.levels-mixed"]]);
});

test("workflows save stores a draft as a version, history lists it, export writes it, import stores it elsewhere, and an id that is none, --yes from Git at a moving ref and --ref with a folder exit 64", async () => {
  const { root, state, cli } = setup();
  const draft = drafted(root, state, "valid-build-and-review.json");
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

test("an import's review shows a command line by line, so a comment never hides the line sh runs next", async () => {
  const { root, state, cli } = setup();
  drafted(root, state, "valid-minimal.json", [
    { id: "two", type: "command.run", with: { command: "echo ok #\necho second" } },
  ]);
  await cli("workflows", "save", "w", "--yes");
  await cli("workflows", "export", "w", "--to", join(root, "shared"), "--yes");
  const review = await setup().cli("import", join(root, "shared"));
  vi.unstubAllEnvs();
  expect(review.out).toContain("  w two  command: echo ok #\n      echo second\n");
});

// The fixture extension as the app's `id`, contributing `contributes`.
const ship = (root: string, id: string, contributes: Record<string, unknown>): string => {
  const folder = join(root, "app", id);
  mkdirSync(folder, { recursive: true });
  const manifest = { ...MANIFEST, id, platforms: undefined, capabilities: undefined, contributes };
  writeFileSync(join(folder, "cedarloom-extension.json"), JSON.stringify(manifest));
  copyFileSync(
    join(import.meta.dirname, "..", "..", "use-cases", "test", "fixtures", "doctor", "main.mjs"),
    join(folder, "main.mjs"),
  );
  return folder;
};

test("a verb the app's own extension contributes runs its action with the inputs given as flags and prints its outputs, and is refused while off", async () => {
  const { root, cli } = setup();
  const inputs = { name: { type: "string" } };
  ship(root, "cedarloom.example", { actions: { status: { title: "Status", inputs } }, commands: ["status"] });
  const ran = await cli("example", "status", "--name", "Ada");
  const asJson = json((await cli("example", "status", "--json")).out);
  await cli("components", "switch", "cedarloom.example", "off", "--yes");
  const off = await cli("example", "status", "--json");
  expect([ran.code, ran.out, asJson, off.code, json(off.out)["findings"]]).toEqual([
    EXIT.ok,
    "ready: true\nname: Ada\n",
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

test("work-items token stores the piped hub-issues token without printing it, and refuses a terminal", async () => {
  const piped = setup({ stdin: "github_pat_11FAKE_0123\n" });
  const stored = await piped.cli("work-items", "token");
  expect([stored.code, piped.keyring.get("hub-issues")]).toEqual([EXIT.ok, "github_pat_11FAKE_0123"]);
  expect(`${stored.out}${stored.err}`).not.toContain("FAKE");
  const terminal = setup();
  const refused = await terminal.cli("--json", "work-items", "token");
  expect([refused.code, json(refused.out)["findings"], terminal.keyring.size]).toEqual([
    EXIT.usage,
    [{ code: "secret.no-input", params: { name: "hub-issues" } }],
    0,
  ]);
});

test("a token typed on the command line instead of piped in is never repeated in a usage error", async () => {
  const { cli, keyring } = setup();
  for (const argv of [
    ["work-items", "token", "github_pat_11FAKE_0123"],
    ["work-items", "token", "--token=github_pat_11FAKE_0123"],
    // A token's end without its prefix, as a paste that missed its start.
    ["work-items", "token", "11FAKE_0123"],
    ["work-items", "github_pat_11FAKE_0123"],
    ["--token=github_pat_11FAKE_0123", "work-items", "token"],
  ]) {
    const typed = await cli(...argv);
    expect([typed.code, `${typed.out}${typed.err}`.includes("FAKE")]).toEqual([EXIT.usage, false]);
  }
  expect(keyring.size).toBe(0);
});
