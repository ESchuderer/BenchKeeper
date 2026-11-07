import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  canonicalJson,
  EXTENSION_SCHEMA_VERSION,
  ExtensionManifest,
  type Finding,
  ExtensionUpdates,
  formatInstalled,
  INSTALLED_SCHEMA_VERSION,
  InstalledExtensions,
  type Plan,
  type Result,
  readDocument,
  UPDATES_SCHEMA_VERSION,
} from "@cedarloom/contracts";
import { speaks } from "@cedarloom/extension-host";
import { type FetchOptions, fetchTree, type Source, type Tree } from "@cedarloom/git";
import { errorCode } from "@cedarloom/engine";
import { sha256 } from "@cedarloom/ledger";
import type { Approval } from "./use-cases.ts";
import { parseDocument, readJson, readOptionalJson } from "./use-cases.ts";

/** How a Git source is fetched: over https and ssh, unless a test names another way. */
export type Fetch = (source: Source, options: FetchOptions) => Promise<Result<Tree>>;
type Pin = InstalledExtensions["extensions"][string];
type Read = { text: string | null; installed: InstalledExtensions };
/** What an extension may do, as its manifest asks for it. */
export type Capabilities = NonNullable<ExtensionManifest["capabilities"]>;

/** The manifest's file name at the root of an extension's folder. */
export const MANIFEST = "cedarloom-extension.json";
const installedPath = (state: string): string => join(state, "extensions.json");
const NONE: InstalledExtensions = {
  schemaVersion: INSTALLED_SCHEMA_VERSION,
  kind: "cedarloom.extensions",
  extensions: {},
};
// An update is offered once this machine has seen its commit for 3 days, A94's wait. A commit's own date is whatever
// its author wrote, so the clock starts when CedarLoom first fetched it here. An add never waits: it is a new choice
// with full consent, so a remove and an add install the newest commit at once.
// shortcut: only the ref's newest commit is fetched, so a ref that moves more often than every 3 days never offers an
// update; follow a tag or release branch (--ref) there. Upgrade: remember each commit seen and offer the newest one
// that has waited, fetched by its SHA where the server allows that.
const UPDATE_WAIT_MS = 3 * 24 * 60 * 60 * 1000;
// A quarantine older than any fetch can take (the git package's 5 minutes, twice over) was left behind, for example by
// a Windows process holding one of its files when the fetch removed it.
const SWEEP_MS = 10 * 60 * 1000;
// A staging folder an hour old belongs to a stage that broke off, not to an add or update running now.
const STAGING_MS = 60 * 60 * 1000;

const refusal = (
  extension: string | null,
  reason: "no-manifest" | "entry" | "protocol" | "installed" | "id" | "reserved",
): Finding => ({
  code: "extension.install-refused",
  params: { extension, reason },
});
const unknown = (extension: string): Result<never> => ({
  ok: false,
  finding: { code: "extension.unknown", params: { extension } },
});

// The installed set and the text it was read from; none yet is an empty set.
const readInstalled = (state: string): Result<Read> => {
  const file = readOptionalJson(installedPath(state));
  if (!file.ok) return file;
  if (file.value === null) return { ok: true, value: { text: null, installed: NONE } };
  const installed = readDocument(InstalledExtensions, INSTALLED_SCHEMA_VERSION, file.value.json);
  return installed.ok ? { ok: true, value: { text: file.value.text, installed: installed.value } } : installed;
};

// Best effort: a folder that cannot be read or removed now (a file held open, another CedarLoom sweeping at once) is
// left for a later fetch.
const removeOlder = (path: string, ms: number): void => {
  try {
    if (Date.now() - statSync(path).mtimeMs > ms) rmSync(path, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Left for a later fetch.
  }
};

// The folders under `folder` named `prefix*`, that is, ones nothing pins.
const leftovers = (folder: string, prefix: string): string[] =>
  existsSync(folder)
    ? readdirSync(folder)
        .filter((name) => name.startsWith(prefix))
        .map((name) => join(folder, name))
    : [];

// Removes what earlier fetches and stages left behind: quarantines and staging folders, which nothing pins. Version
// folders stay, pinned or not, since the undo of a remove or an update pins one again.
// shortcut: the disk grows by one folder per version; collect versions once the ledger tells which runs can still be
// undone.
const sweep = (state: string): void => {
  const staged = join(state, "extensions");
  const entries = existsSync(staged) ? readdirSync(staged, { withFileTypes: true }) : [];
  const ids = entries.filter((entry) => entry.isDirectory()).map((entry) => join(staged, entry.name));
  for (const path of leftovers(join(state, "fetch"), "quarantine-")) removeOlder(path, SWEEP_MS);
  for (const path of ids.flatMap((id) => leftovers(id, "staging-"))) removeOlder(path, STAGING_MS);
};

// Fetches into `<state>/fetch`, after the sweep.
const fetchInto = async (state: string, source: Source, fetch: Fetch): Promise<Result<Tree>> => {
  sweep(state);
  const parent = join(state, "fetch");
  mkdirSync(parent, { recursive: true });
  return fetch(source, { parent });
};

// The manifest at the root of the fetched folder, read as data: nothing of the extension runs.
export const manifestOf = (tree: Tree): Result<ExtensionManifest> => {
  const file = tree.files.find((each) => each.path === MANIFEST);
  if (file === undefined) return { ok: false, finding: refusal(null, "no-manifest") };
  return parseDocument(file.content.toString("utf8"), (json) =>
    readDocument(ExtensionManifest, EXTENSION_SCHEMA_VERSION, json),
  );
};

const runnable = (manifest: ExtensionManifest, tree: Tree): Finding | undefined => {
  // The app ships its own extensions: from Git one would pass for first-party.
  if (manifest.id.startsWith("cedarloom.")) return refusal(manifest.id, "reserved");
  if (!tree.files.some((file) => file.path === manifest.runtime.entry)) return refusal(manifest.id, "entry");
  return speaks(manifest.api) ? undefined : refusal(manifest.id, "protocol");
};

/**
 * Writes the files to `<state>/extensions/<id>/<digest>/`, read-only. The folder is named by its content and inert
 * while no installed entry points to it, so it needs no undo; a folder there already holds the same files. A write
 * that fails (a full disk, a path the file system cannot take) leaves no staging folder and is a finding with its
 * error code only: the message would hold the extension's own paths.
 */
const stage = (state: string, id: string, tree: Tree): Finding | undefined => {
  const parent = join(state, "extensions", id);
  const folder = join(parent, tree.digest);
  if (existsSync(folder)) return undefined;
  try {
    mkdirSync(parent, { recursive: true });
    const staging = mkdtempSync(join(parent, "staging-"));
    try {
      for (const file of tree.files) {
        // The git package passed only portable paths inside the folder: no "..", no absolute path, no link.
        const path = join(staging, ...file.path.split("/"));
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, file.content, { mode: file.mode === "100755" ? 0o555 : 0o444 });
      }
      renameSync(staging, folder);
    } finally {
      // Gone after the rename; after a failure, partly written.
      rmSync(staging, { recursive: true, force: true, maxRetries: 3 });
    }
    return undefined;
  } catch (error) {
    // Another install of the same files may have staged them first.
    const failure: Finding = {
      code: "extension.failed",
      params: { extension: id, step: "stage", error: errorCode(error) },
    };
    return existsSync(folder) ? undefined : failure;
  }
};

// One write of the installed set, as it was read.
const writeOf = (state: string, { text }: Read, installed: InstalledExtensions): Plan => {
  const before = text === null ? null : sha256(text);
  const content = formatInstalled(installed);
  return { schemaVersion: 1, operations: [{ kind: "write", path: installedPath(state), before, content }] };
};

/** An install's plan, its manifest and pin, and the capabilities its approval enables. */
export type InstallPlan = { plan: Plan; manifest: ExtensionManifest; pin: Pin; added: Capabilities };

// A fetched extension: the installed set as read, where the files came from, the files, and their manifest.
type Fetched = { read: Read; source: Source; tree: Tree; manifest: ExtensionManifest };

// Stages the tree and plans the installed set with the extension pinned to it; the pin keeps the digest of the
// capabilities the plan's approval consents to.
const pinned = (state: string, { read, source, tree, manifest }: Fetched): Result<InstallPlan> => {
  const { id, version, capabilities = {} } = manifest;
  const failed = stage(state, id, tree);
  if (failed !== undefined) return { ok: false, finding: failed };
  const at = source.path === undefined ? {} : { path: source.path };
  const pin: Pin = {
    version,
    source: { git: source.url, commit: tree.commit, ...at },
    digest: tree.digest,
    ref: source.ref,
    consented: sha256(canonicalJson(capabilities)),
  };
  const { installed } = read;
  const plan = writeOf(state, read, { ...installed, extensions: { ...installed.extensions, [id]: pin } });
  return { ok: true, value: { plan, manifest, pin, added: beyond({}, capabilities) } };
};

/**
 * Plans the install of the extension at a Git source (P2 a: Git only, no npm and no install script): fetches the ref into a throwaway bare repository, pins the commit and the digest of the folder's files,
 * reads the manifest, stages the files, and plans one write of the installed set. Its approval is the user's consent
 * to the manifest's capabilities, whose digest the entry keeps. Nothing of the extension runs.
 */
export const planInstall = async (
  state: string,
  source: Source,
  fetch: Fetch = fetchTree,
): Promise<Result<InstallPlan>> => {
  const read = readInstalled(state);
  if (!read.ok) return read;
  const tree = await fetchInto(state, source, fetch);
  if (!tree.ok) return tree;
  const manifest = manifestOf(tree.value);
  if (!manifest.ok) return manifest;
  const { id } = manifest.value;
  const installed = Object.hasOwn(read.value.installed.extensions, id) ? refusal(id, "installed") : undefined;
  const finding = installed ?? runnable(manifest.value, tree.value);
  if (finding !== undefined) return { ok: false, finding };
  return pinned(state, { read: read.value, source, tree: tree.value, manifest: manifest.value });
};

/** An installed extension: its pin, id and trust, which is `community` for every one from Git. */
export type Installed = Pin & { id: string; trust: "community" };

/**
 * The installed extensions by id. Each came from Git, so each is community code: its trust comes from where its code
 * came from, never from its manifest (bundled extensions ship inside CedarLoom and are never installed).
 */
export const installedExtensions = (state: string): Result<Installed[]> => {
  const read = readInstalled(state);
  if (!read.ok) return read;
  const entries = Object.entries(read.value.installed.extensions);
  return { ok: true, value: entries.map(([id, pin]) => ({ id, ...pin, trust: "community" as const })) };
};

/** Plans the installed set without the extension. Its staged files stay, inert, so the run's undo puts it back. */
export const planRemove = (state: string, id: string): Result<Plan> => {
  const read = readInstalled(state);
  if (!read.ok) return read;
  const { installed } = read.value;
  if (!Object.hasOwn(installed.extensions, id)) return unknown(id);
  const extensions = Object.fromEntries(Object.entries(installed.extensions).filter(([other]) => other !== id));
  return { ok: true, value: writeOf(state, read.value, { ...installed, extensions }) };
};

const seenPath = (state: string): string => join(state, "extension-updates.json");

const iso = (ms: number): string => new Date(ms).toISOString();

// A commit at an extension's ref, and the commit the extension is installed at.
type Sighting = { id: string; commit: string; installed: string };

// When this machine first saw `commit` at the extension's ref, and whether the ref held another new commit when last
// checked (the wait started again); the installed commit is no such restart. A record CedarLoom cannot read counts as
// none: every wait starts again.
const firstSeen = (
  state: string,
  { id, commit, installed }: Sighting,
  now: number,
): { seen: number; moved: boolean } => {
  const file = readOptionalJson(seenPath(state));
  const read = readDocument(ExtensionUpdates, UPDATES_SCHEMA_VERSION, file.ok ? file.value?.json : undefined);
  const all = read.ok ? read.value.extensions : {};
  const known = Object.hasOwn(all, id) ? all[id] : undefined;
  if (known?.commit === commit) return { seen: Date.parse(known.seen), moved: false };
  const next: ExtensionUpdates = {
    schemaVersion: UPDATES_SCHEMA_VERSION,
    kind: "cedarloom.extension-updates",
    extensions: { ...all, [id]: { commit, seen: iso(now) } },
  };
  writeFileSync(seenPath(state), `${JSON.stringify(ExtensionUpdates.parse(next), null, 2)}\n`);
  return { seen: now, moved: known !== undefined && known.commit !== installed };
};

// What `after` asks for that `before` did not: an origin, a credential that is new or bound otherwise, project reads,
// proposed writes.
const beyond = (before: Capabilities, after: Capabilities): Capabilities => {
  const net = (after.net ?? []).filter((origin) => !(before.net ?? []).includes(origin));
  const old = before.credentials ?? {};
  const credentials = Object.entries(after.credentials ?? {}).filter(
    ([id, credential]) => JSON.stringify(Object.hasOwn(old, id) ? old[id] : null) !== JSON.stringify(credential),
  );
  const flags = (["projectRead", "planWrite"] as const).filter((flag) => after[flag] === true && before[flag] !== true);
  return {
    ...(net.length > 0 ? { net } : {}),
    ...(credentials.length > 0 ? { credentials: Object.fromEntries(credentials) } : {}),
    ...Object.fromEntries(flags.map((flag) => [flag, true])),
  };
};

// The capabilities the user approved: those of the installed version's staged manifest while they match the digest
// its entry keeps. Otherwise none are known, and everything the update asks for counts as new.
const approvedOf = (state: string, id: string, pin: Pin): Capabilities => {
  const file = readJson(join(state, "extensions", id, pin.digest, MANIFEST));
  const manifest = ExtensionManifest.safeParse(file.ok ? file.value.json : undefined);
  const capabilities = manifest.success ? (manifest.data.capabilities ?? {}) : {};
  return sha256(canonicalJson(capabilities)) === pin.consented ? capabilities : {};
};

// Where an installed extension's updates come from: its repository and folder, at the ref it follows.
const sourceOf = (pin: Pin): Source => ({
  url: pin.source.git,
  ref: pin.ref,
  ...(pin.source.path === undefined ? {} : { path: pin.source.path }),
});

// The manifest of an update's tree: still the same extension, and one this CedarLoom can run.
const updatable = (id: string, tree: Tree): Result<ExtensionManifest> => {
  const manifest = manifestOf(tree);
  if (!manifest.ok) return manifest;
  const finding = manifest.value.id === id ? runnable(manifest.value, tree) : refusal(manifest.value.id, "id");
  return finding === undefined ? manifest : { ok: false, finding };
};

export type UpdatePlan =
  | { kind: "current"; commit: string }
  | { kind: "waiting"; commit: string; seen: string; offered: string; moved: boolean }
  | (InstallPlan & { kind: "planned"; from: Pin; removed: Capabilities });

// The installed extension's update to the fetched tree, once it has waited, with what it asks for anew.
const updateOf = (state: string, from: Pin, fetched: Fetched): Result<UpdatePlan> => {
  const { manifest } = fetched;
  const next = pinned(state, fetched);
  if (!next.ok) return next;
  const approved = approvedOf(state, manifest.id, from);
  const capabilities = manifest.capabilities ?? {};
  const added = beyond(approved, capabilities);
  const removed = beyond(capabilities, approved);
  return { ok: true, value: { ...next.value, kind: "planned", from, added, removed } };
};

// The update once this machine has seen its commit for 3 days, or until when it still waits.
const afterWait = (state: string, from: Pin, fetched: Fetched, now: number): Result<UpdatePlan> => {
  const { commit } = fetched.tree;
  const { seen, moved } = firstSeen(state, { id: fetched.manifest.id, commit, installed: from.source.commit }, now);
  if (now - seen >= UPDATE_WAIT_MS) return updateOf(state, from, fetched);
  return { ok: true, value: { kind: "waiting", commit, seen: iso(seen), offered: iso(seen + UPDATE_WAIT_MS), moved } };
};

/**
 * Plans the update of an installed extension to the commit now at its ref. The same commit, or one with the same files,
 * is current. A new one is offered once this machine has seen it for 3 days: until then it is waiting, and another new
 * commit starts the wait again (`moved`). The plan pins the new commit and digest and names the capabilities that grew
 * and shrank; grown ones need the user's consent again (`approvalOf`).
 */
export const planUpdate = async (
  state: string,
  id: string,
  fetch: Fetch = fetchTree,
  now: number = Date.now(),
): Promise<Result<UpdatePlan>> => {
  const read = readInstalled(state);
  if (!read.ok) return read;
  const { extensions } = read.value.installed;
  const from = Object.hasOwn(extensions, id) ? extensions[id] : undefined;
  if (from === undefined) return unknown(id);
  const source = sourceOf(from);
  const tree = await fetchInto(state, source, fetch);
  if (!tree.ok) return tree;
  // A commit that leaves the extension's files as they are (a change elsewhere in the repository) updates nothing.
  const { commit, digest } = tree.value;
  if (commit === from.source.commit || digest === from.digest) return { ok: true, value: { kind: "current", commit } };
  const manifest = updatable(id, tree.value);
  if (!manifest.ok) return manifest;
  const fetched = { read: read.value, source, tree: tree.value, manifest: manifest.value };
  return afterWait(state, from, fetched, now);
};

/**
 * The approval a plan takes: one that enables capabilities (an install that asks for any, an update that asks for more
 * than the user approved) needs the user's consent, which only an approval of its exact plan gives, never `yes`.
 */
export const approvalOf = (added: Capabilities, approval: Approval): Approval =>
  Object.keys(added).length > 0 ? { approve: approval.approve } : approval;
