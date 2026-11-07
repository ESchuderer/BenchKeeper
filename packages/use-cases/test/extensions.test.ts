import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { type Finding, InstalledExtensions } from "@cedarloom/contracts";
import { fetchTreeOver } from "@cedarloom/git";
import {
  applyPlan,
  type Fetch,
  installedExtensions,
  planInstall,
  planRemove,
  planUpdate,
  approvalOf,
  undoRun,
} from "@cedarloom/use-cases";
import { afterAll, expect, test } from "vitest";

// GitHub's Windows runners keep os.tmpdir() on the slow system drive.
const root = mkdtempSync(join(process.env["RUNNER_TEMP"] ?? tmpdir(), "cedarloom-install-"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const git = (cwd: string, args: string[]): string =>
  execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.org", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();

// Each published URL is a local repository: the tests let git fetch over file://, which the CLI never does.
const repositories = new Map<string, string>();
const fetchLocal: Fetch = (source, options) => {
  const folder = repositories.get(source.url);
  return fetchTreeOver(["file"])(
    { ...source, url: folder === undefined ? source.url : pathToFileURL(folder).href },
    options,
  );
};
// Publishes the files as the newest commit of the repository `name`, a new one or the next commit of one published before.
const publish = (name: string, files: Record<string, string>): string => {
  const url = `https://git.example.org/acme/${name}.git`;
  const known = repositories.get(url);
  const dir = known ?? mkdtempSync(join(root, "repository-"));
  if (known === undefined) git(dir, ["init", "--quiet", "--initial-branch=main"]);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  git(dir, ["add", "--all"]);
  // Shell scripts are executable in the commit, also where the file system has no such bit.
  for (const path of Object.keys(files).filter((file) => file.endsWith(".sh"))) {
    git(dir, ["update-index", "--chmod=+x", path]);
  }
  git(dir, ["commit", "--quiet", "--message=publish"]);
  repositories.set(url, dir);
  return url;
};

const manifest = (more: object = {}): string =>
  JSON.stringify({
    schemaVersion: 1,
    kind: "cedarloom.extension",
    id: "acme.jira",
    version: "1.0.0",
    name: "Jira",
    api: "1.0",
    runtime: { kind: "node", entry: "main.mjs" },
    capabilities: { net: ["https://acme.atlassian.net"] },
    contributes: { actions: { search: { title: "Search" } } },
    ...more,
  });
// Run, the entry would leave a marker in its folder; an install never runs it.
const ENTRY = 'import { writeFileSync } from "node:fs";\nwriteFileSync(new URL("ran", import.meta.url), "x");\n';
const state = (): string => mkdtempSync(join(root, "state-"));
const findingOf = (result: { ok: boolean; finding?: Finding }): unknown => (result.ok ? "planned" : result.finding);

test("an install pins the commit and digest, stages the files read-only by digest, and plans one write; nothing runs", async () => {
  const at = state();
  const url = publish("jira", { "cedarloom-extension.json": manifest(), "main.mjs": ENTRY });
  const planned = await planInstall(at, { url, ref: "main" }, fetchLocal);
  if (!planned.ok) throw new Error(planned.finding.code);
  const { plan, pin } = planned.value;
  const [write] = plan.operations;
  const folder = join(at, "extensions", "acme.jira", pin.digest);
  const staged = readdirSync(folder).toSorted();
  expect([plan.operations.length, write?.kind, write?.kind === "write" && write.path, write?.before]).toEqual([
    1,
    "write",
    join(at, "extensions.json"),
    null,
  ]);
  expect(InstalledExtensions.parse(JSON.parse(write?.kind === "write" ? write.content : "")).extensions).toEqual({
    "acme.jira": {
      version: "1.0.0",
      source: { git: url, commit: expect.stringMatching(/^[0-9a-f]{40}$/) },
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      ref: "main",
      consented: expect.stringMatching(/^[0-9a-f]{64}$/),
    },
  });
  expect([staged, statSync(join(folder, "main.mjs")).mode & 0o222, existsSync(join(folder, "ran"))]).toEqual([
    ["cedarloom-extension.json", "main.mjs"],
    0,
    false,
  ]);
});

test("an applied install is listed as community code, and its undo restores the installed set", async () => {
  const at = state();
  const url = publish("tools", {
    "README.md": "not part of the extension",
    "extensions/tools/cedarloom-extension.json": manifest({ id: "acme.tools" }),
    "extensions/tools/main.mjs": ENTRY,
    "extensions/tools/bin/run.sh": "#!/bin/sh\n",
  });
  const tools = { url, ref: "HEAD", path: "extensions/tools" };
  const planned = await planInstall(at, tools, fetchLocal);
  if (!planned.ok) throw new Error(planned.finding.code);
  const run = applyPlan(at, planned.value.plan, { yes: true });
  const listed = installedExtensions(at);
  const again = await planInstall(at, tools, fetchLocal);
  const runId = run.ok ? String(run.value.runId) : "";
  const undone = undoRun(at, runId, { yes: true });
  // The staged folder outlives the undo, inert, and a new install takes it as it is.
  const reinstalled = await planInstall(at, tools, fetchLocal);
  const script = join(at, "extensions", "acme.tools", planned.value.pin.digest, "bin", "run.sh");
  expect([listed.ok ? listed.value.map(({ id, trust, source }) => [id, trust, source.path]) : listed]).toEqual([
    [["acme.tools", "community", "extensions/tools"]],
  ]);
  expect([findingOf(again), undone.ok && undone.value.status, existsSync(join(at, "extensions.json"))]).toEqual([
    { code: "extension.install-refused", params: { extension: "acme.tools", reason: "installed" } },
    "applied",
    false,
  ]);
  expect([findingOf(reinstalled), statSync(script).mode & 0o222]).toEqual(["planned", 0]);
});

test("a second extension joins the installed set; the plan replaces the file it read", async () => {
  const at = state();
  const first = await planInstall(
    at,
    { url: publish("one", { "cedarloom-extension.json": manifest(), "main.mjs": ENTRY }), ref: "main" },
    fetchLocal,
  );
  if (first.ok) applyPlan(at, first.value.plan, { yes: true });
  const text = readFileSync(join(at, "extensions.json"), "utf8");
  const second = await planInstall(
    at,
    {
      url: publish("two", { "cedarloom-extension.json": manifest({ id: "acme.two" }), "main.mjs": ENTRY }),
      ref: "main",
    },
    fetchLocal,
  );
  if (!second.ok) throw new Error(second.finding.code);
  const [write] = second.value.plan.operations;
  const content = write?.kind === "write" ? write.content : "";
  expect([
    write?.before === null,
    Object.keys(InstalledExtensions.parse(JSON.parse(content)).extensions),
    text.length > 0,
  ]).toEqual([false, ["acme.jira", "acme.two"], true]);
});

test("no install without a manifest, with an invalid one (the cedarloom publisher), without its entry, for another protocol, or from a refused source", async () => {
  const at = state();
  const sources = [
    publish("bare", { "main.mjs": ENTRY }),
    publish("first-party", { "cedarloom-extension.json": manifest({ id: "cedarloom.jira" }), "main.mjs": ENTRY }),
    publish("no-entry", { "cedarloom-extension.json": manifest() }),
    publish("future", { "cedarloom-extension.json": manifest({ api: "2.0" }), "main.mjs": ENTRY }),
  ];
  const results = await Promise.all([
    ...sources.map((url) => planInstall(at, { url, ref: "main" }, fetchLocal)),
    planInstall(at, { url: sources[0] ?? "", ref: "-x" }, fetchLocal),
  ]);
  expect([...results.map(findingOf), existsSync(join(at, "extensions"))]).toEqual([
    { code: "extension.install-refused", params: { extension: null, reason: "no-manifest" } },
    { code: "document.invalid", params: { issues: [expect.objectContaining({ path: "id" })] } },
    { code: "extension.install-refused", params: { extension: "acme.jira", reason: "entry" } },
    { code: "extension.install-refused", params: { extension: "acme.jira", reason: "protocol" } },
    { code: "git.refused-source", params: { field: "ref" } },
    false,
  ]);
});

test("an installed set CedarLoom cannot read refuses installs and the list alike", async () => {
  const [newer, folder] = [state(), state()];
  writeFileSync(join(newer, "extensions.json"), '{"schemaVersion":2}');
  mkdirSync(join(folder, "extensions.json"));
  const url = publish("blocked", { "cedarloom-extension.json": manifest(), "main.mjs": ENTRY });
  expect([
    findingOf(await planInstall(newer, { url, ref: "main" }, fetchLocal)),
    findingOf(installedExtensions(newer)),
    findingOf(installedExtensions(folder)),
  ]).toEqual([
    { code: "document.newer-schema", params: { found: 2, known: 1 } },
    { code: "document.newer-schema", params: { found: 2, known: 1 } },
    { code: "document.unreadable", params: { path: join(folder, "extensions.json"), error: expect.any(String) } },
  ]);
});

const NOW = Date.parse("2026-11-06T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (ms: number): string => new Date(ms).toISOString();
const A = "https://acme.atlassian.net";
const B = "https://api.example.org";
// An extension installed from the repository `name`, with the manifest's other fields.
const installed = async (name: string, more: object = {}): Promise<{ state: string; url: string }> => {
  const folder = state();
  const url = publish(name, { "cedarloom-extension.json": manifest(more), "main.mjs": ENTRY });
  const planned = await planInstall(folder, { url, ref: "main" }, fetchLocal);
  if (!planned.ok) throw new Error(planned.finding.code);
  applyPlan(folder, planned.value.plan, { yes: true });
  return { state: folder, url };
};
const outcome = (result: Awaited<ReturnType<typeof planUpdate>>): unknown => {
  if (!result.ok) return result.finding;
  const { value } = result;
  if (value.kind !== "planned") return { ...value, commit: "c" };
  const { plan, manifest: next, pin, from, added, removed } = value;
  return {
    kind: value.kind,
    writes: plan.operations.length,
    versions: [from.version, next.version, pin.version],
    added,
    removed,
  };
};

test("an update is offered once this machine has seen the new commit for 3 days, and names what it asks for anew", async () => {
  const { state: folder } = await installed("moving");
  const current = await planUpdate(folder, "acme.jira", fetchLocal, NOW);
  publish("moving", {
    "cedarloom-extension.json": manifest({ version: "1.1.0", capabilities: { net: [A, B], projectRead: true } }),
  });
  const first = await planUpdate(folder, "acme.jira", fetchLocal, NOW);
  const later = await planUpdate(folder, "acme.jira", fetchLocal, NOW + 2 * DAY);
  const due = await planUpdate(folder, "acme.jira", fetchLocal, NOW + 3 * DAY);
  const waiting = { kind: "waiting", commit: "c", seen: at(NOW), offered: at(NOW + 3 * DAY), moved: false };
  expect([outcome(current), outcome(first), outcome(later), outcome(due)]).toEqual([
    { kind: "current", commit: "c" },
    waiting,
    waiting,
    {
      kind: "planned",
      writes: 1,
      versions: ["1.0.0", "1.1.0", "1.1.0"],
      added: { net: [B], projectRead: true },
      removed: {},
    },
  ]);
  if (due.ok && due.value.kind === "planned") applyPlan(folder, due.value.plan, { yes: true });
  const listed = installedExtensions(folder);
  // The first new commit after an applied update starts a wait, not a restart of one.
  publish("moving", { "cedarloom-extension.json": manifest({ version: "1.2.0" }) });
  const next = await planUpdate(folder, "acme.jira", fetchLocal, NOW + 4 * DAY);
  expect([listed.ok && listed.value.map(({ version }) => version), outcome(next)]).toEqual([
    ["1.1.0"],
    { kind: "waiting", commit: "c", seen: at(NOW + 4 * DAY), offered: at(NOW + 7 * DAY), moved: false },
  ]);
});

test("a newer commit during the wait starts it again, and capabilities that shrink ask for no new consent", async () => {
  const { state: folder } = await installed("shrinking", { capabilities: { net: [A], projectRead: true } });
  publish("shrinking", { "cedarloom-extension.json": manifest({ version: "1.1.0" }) });
  const first = await planUpdate(folder, "acme.jira", fetchLocal, NOW);
  publish("shrinking", { "cedarloom-extension.json": manifest({ version: "1.2.0" }) });
  const restarted = await planUpdate(folder, "acme.jira", fetchLocal, NOW + 2 * DAY);
  const still = await planUpdate(folder, "acme.jira", fetchLocal, NOW + 4 * DAY);
  const due = await planUpdate(folder, "acme.jira", fetchLocal, NOW + 5 * DAY);
  expect([outcome(first), outcome(restarted), outcome(still), outcome(due)]).toEqual([
    { kind: "waiting", commit: "c", seen: at(NOW), offered: at(NOW + 3 * DAY), moved: false },
    { kind: "waiting", commit: "c", seen: at(NOW + 2 * DAY), offered: at(NOW + 5 * DAY), moved: true },
    { kind: "waiting", commit: "c", seen: at(NOW + 2 * DAY), offered: at(NOW + 5 * DAY), moved: false },
    {
      kind: "planned",
      writes: 1,
      versions: ["1.0.0", "1.2.0", "1.2.0"],
      added: {},
      removed: { projectRead: true },
    },
  ]);
});

test("remove plans the installed set without the extension and its undo puts it back; an unknown id is refused", async () => {
  const { state: folder } = await installed("removed");
  const planned = planRemove(folder, "acme.jira");
  const run = planned.ok ? applyPlan(folder, planned.value, { yes: true }) : planned;
  const after = installedExtensions(folder);
  const runId = run.ok ? String(run.value.runId) : "";
  undoRun(folder, runId, { yes: true });
  const back = installedExtensions(folder);
  const unknown = { code: "extension.unknown", params: { extension: "acme.none" } };
  expect([after.ok && after.value.length, back.ok && back.value.map(({ id }) => id)]).toEqual([0, ["acme.jira"]]);
  expect([
    findingOf(planRemove(folder, "acme.none")),
    outcome(await planUpdate(folder, "acme.none", fetchLocal, NOW)),
  ]).toEqual([unknown, unknown]);
});

test("an update whose folder now holds another extension is refused at once; a fetch sweeps old quarantines and staging folders, never a version", async () => {
  const { state: folder } = await installed("taken");
  publish("taken", { "cedarloom-extension.json": manifest({ id: "acme.other" }) });
  const listed = installedExtensions(folder);
  const pinned = listed.ok ? String(listed.value[0]?.digest) : "";
  const [parent, staged] = [join(folder, "fetch"), join(folder, "extensions")];
  const old = [
    join(parent, "quarantine-old"),
    join(parent, "kept-old"),
    join(staged, "acme.jira", pinned),
    join(staged, "acme.jira", "f".repeat(64)),
    join(staged, "acme.jira", "staging-old"),
    join(staged, "acme.gone", "e".repeat(64)),
  ];
  const fresh = [join(parent, "quarantine-new"), join(staged, "acme.jira", "staging-new")];
  for (const path of [...old, ...fresh]) mkdirSync(path, { recursive: true });
  const hourAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  for (const path of old) utimesSync(path, hourAgo, hourAgo);
  const refused = await planUpdate(folder, "acme.jira", fetchLocal, NOW);
  expect([
    outcome(refused),
    readdirSync(parent).toSorted(),
    readdirSync(join(staged, "acme.jira")).toSorted(),
    readdirSync(join(staged, "acme.gone")),
  ]).toEqual([
    { code: "extension.install-refused", params: { extension: "acme.other", reason: "id" } },
    ["kept-old", "quarantine-new"],
    // Every version stays, pinned or not: a run's undo may pin it again.
    [pinned, "f".repeat(64), "staging-new"].toSorted(),
    ["e".repeat(64)],
  ]);
});

const BEARER = { type: "http", scheme: "bearer" };
// An extension in the folder ext of its repository.
const inFolder = (more: object) => ({ "ext/cedarloom-extension.json": manifest(more), "ext/main.mjs": ENTRY });

test("a credential bound to more hosts is asked for anew and one unchanged is not, also for an extension in a folder", async () => {
  const folder = state();
  const credentials = { kept: { scheme: BEARER, hosts: [A] }, moved: { scheme: BEARER, hosts: [A] } };
  const url = publish("credentials", inFolder({ capabilities: { net: [A], credentials } }));
  const planned = await planInstall(folder, { url, ref: "main", path: "ext" }, fetchLocal);
  if (planned.ok) applyPlan(folder, planned.value.plan, { yes: true });
  // A commit outside the extension's folder leaves its files as they are.
  publish("credentials", { "README.md": "notes" });
  const elsewhere = await planUpdate(folder, "acme.jira", fetchLocal, NOW);
  const moved = { scheme: BEARER, hosts: [A, B] };
  const fresh = { scheme: BEARER, hosts: [B] };
  publish(
    "credentials",
    inFolder({ version: "1.1.0", capabilities: { net: [A, B], credentials: { ...credentials, moved, fresh } } }),
  );
  await planUpdate(folder, "acme.jira", fetchLocal, NOW);
  const due = await planUpdate(folder, "acme.jira", fetchLocal, NOW + 3 * DAY);
  expect([outcome(elsewhere), outcome(due)]).toMatchObject([
    { kind: "current" },
    { added: { net: [B], credentials: { moved, fresh } }, removed: {} },
  ]);
});

test("approved capabilities that cannot be read count as none, and a record of first sight that cannot be read starts the wait", async () => {
  const { state: folder } = await installed("unread", { capabilities: { net: [A], planWrite: true } });
  const pin = installedExtensions(folder);
  const digest = pin.ok ? String(pin.value[0]?.digest) : "";
  rmSync(join(folder, "extensions", "acme.jira", digest), { recursive: true, force: true });
  writeFileSync(join(folder, "extension-updates.json"), "{not json");
  publish("unread", {
    "cedarloom-extension.json": manifest({ version: "1.1.0", capabilities: { net: [A], planWrite: true } }),
  });
  const first = await planUpdate(folder, "acme.jira", fetchLocal, NOW);
  const due = await planUpdate(folder, "acme.jira", fetchLocal, NOW + 3 * DAY);
  expect([outcome(first), outcome(due)]).toEqual([
    { kind: "waiting", commit: "c", seen: at(NOW), offered: at(NOW + 3 * DAY), moved: false },
    {
      kind: "planned",
      writes: 1,
      versions: ["1.0.0", "1.1.0", "1.1.0"],
      added: { net: [A], planWrite: true },
      removed: {},
    },
  ]);
  // Capabilities the plan enables take an approval of the exact plan only.
  expect([approvalOf({ net: [A] }, { yes: true, approve: "h" }), approvalOf({}, { yes: true })]).toEqual([
    { approve: "h" },
    { yes: true },
  ]);
});

test("update and remove report an installed set they cannot read, a manifest that broke, and a source gone", async () => {
  const newer = state();
  writeFileSync(join(newer, "extensions.json"), '{"schemaVersion":2}');
  const { state: folder, url } = await installed("broken");
  publish("broken", { "cedarloom-extension.json": "{" });
  const broke = await planUpdate(folder, "acme.jira", fetchLocal, NOW);
  repositories.delete(url);
  const gone = await planUpdate(folder, "acme.jira", fetchLocal, NOW);
  const unreadable = { code: "document.newer-schema", params: { found: 2, known: 1 } };
  expect([
    findingOf(planRemove(newer, "acme.jira")),
    outcome(await planUpdate(newer, "acme.jira", fetchLocal, NOW)),
    outcome(broke),
    outcome(gone),
  ]).toEqual([
    unreadable,
    unreadable,
    { code: "document.invalid", params: { issues: [{ path: "", code: "invalid_json" }] } },
    { code: "git.failed", params: expect.objectContaining({ step: "fetch" }) },
  ]);
});

test("an extension that asked for nothing is asked anew for what an update adds, and for nothing once it drops it", async () => {
  const { state: folder } = await installed("bare", { capabilities: undefined });
  const update = async (version: string, more: object = {}) => {
    publish("bare", { "cedarloom-extension.json": manifest({ version, ...more }) });
    await planUpdate(folder, "acme.jira", fetchLocal, NOW);
    return planUpdate(folder, "acme.jira", fetchLocal, NOW + 3 * DAY);
  };
  const grown = await update("1.1.0");
  if (grown.ok && grown.value.kind === "planned") applyPlan(folder, grown.value.plan, { yes: true });
  const dropped = await update("1.2.0", { capabilities: undefined });
  expect([outcome(grown), outcome(dropped)]).toMatchObject([
    { added: { net: [A] }, removed: {} },
    { added: {}, removed: { net: [A] } },
  ]);
});

// A file of a tree handed over without Git, and the finding of a stage that failed.
const fileOf = (path: string, text: string) => ({
  path,
  mode: "100644" as const,
  sha256: "0".repeat(64),
  content: Buffer.from(text),
});

const stageFailed = (error: unknown) => ({
  code: "extension.failed",
  params: { extension: expect.any(String), step: "stage", error },
});

test("a failure to stage the files is a finding, and leaves no staging folder behind", async () => {
  const folder = state();
  // A name longer than any file system takes: the write fails after the staging folder exists.
  const tooLong: Fetch = () =>
    Promise.resolve({
      ok: true,
      value: {
        commit: "a".repeat(40),
        digest: "b".repeat(64),
        files: [
          fileOf("cedarloom-extension.json", manifest()),
          fileOf("main.mjs", ENTRY),
          fileOf(`${"x".repeat(300)}.txt`, ""),
        ],
      },
    });
  const failed = await planInstall(folder, { url: "https://git.example.org/acme/long.git", ref: "main" }, tooLong);
  mkdirSync(join(folder, "extensions"), { recursive: true });
  writeFileSync(join(folder, "extensions", "acme.two"), "a file where its folder goes");
  const blocked = await planInstall(
    folder,
    {
      url: publish("blocked-folder", { "cedarloom-extension.json": manifest({ id: "acme.two" }), "main.mjs": ENTRY }),
      ref: "main",
    },
    fetchLocal,
  );
  expect([findingOf(failed), findingOf(blocked), readdirSync(join(folder, "extensions", "acme.jira"))]).toEqual([
    // The error code only (ENAMETOOLONG; Windows says ENOENT), never a message with the extension's paths.
    stageFailed(expect.stringMatching(/^E[A-Z]+$/)),
    stageFailed(expect.stringMatching(/^E[A-Z]+$/)),
    [],
  ]);
});

// A newer commit whose files no file system can take.
const unstageable: Fetch = () =>
  Promise.resolve({
    ok: true,
    value: {
      commit: "a".repeat(40),
      digest: "b".repeat(64),
      files: [
        fileOf("cedarloom-extension.json", manifest({ version: "1.1.0" })),
        fileOf("main.mjs", ENTRY),
        fileOf(`${"x".repeat(300)}.txt`, ""),
      ],
    },
  });

test("an update whose files cannot be staged plans nothing, so no entry pins a folder that is not there", async () => {
  const { state: folder } = await installed("unstaged");
  await planUpdate(folder, "acme.jira", unstageable, NOW);
  const due = await planUpdate(folder, "acme.jira", unstageable, NOW + 3 * DAY);
  expect(outcome(due)).toEqual(stageFailed(expect.stringMatching(/^E[A-Z]+$/)));
});

test("the undo of a removal finds the extension's files where they were, also after later fetches", async () => {
  const { state: folder } = await installed("undone");
  const listed = installedExtensions(folder);
  const version = join(folder, "extensions", "acme.jira", listed.ok ? String(listed.value[0]?.digest) : "");
  const removal = planRemove(folder, "acme.jira");
  const run = removal.ok ? applyPlan(folder, removal.value, { yes: true }) : removal;
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  utimesSync(version, dayAgo, dayAgo);
  const other = publish("other", { "cedarloom-extension.json": manifest({ id: "acme.other" }), "main.mjs": ENTRY });
  await planInstall(folder, { url: other, ref: "main" }, fetchLocal);
  undoRun(folder, run.ok ? String(run.value.runId) : "", { yes: true });
  expect(readdirSync(version).toSorted()).toEqual(["cedarloom-extension.json", "main.mjs"]);
});

test.skipIf(process.platform === "win32")(
  "a quarantine the sweep cannot read or remove is left for a later fetch, and the install goes on",
  async () => {
    const folder = state();
    mkdirSync(join(folder, "fetch"), { recursive: true });
    // A link to nothing: stat fails on it, as on a folder another CedarLoom process removed a moment before.
    symlinkSync(join(folder, "nowhere"), join(folder, "fetch", "quarantine-gone"));
    const url = publish("swept", { "cedarloom-extension.json": manifest(), "main.mjs": ENTRY });
    expect(findingOf(await planInstall(folder, { url, ref: "main" }, fetchLocal))).toBe("planned");
  },
);
