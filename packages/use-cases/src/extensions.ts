import { existsSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  canonicalJson,
  EXTENSION_SCHEMA_VERSION,
  ExtensionManifest,
  type Finding,
  formatInstalled,
  INSTALLED_SCHEMA_VERSION,
  InstalledExtensions,
  type Plan,
  type Result,
  readDocument,
} from "@cedarloom/contracts";
import { speaks } from "@cedarloom/extension-host";
import { type FetchOptions, fetchTree, type Source, type Tree } from "@cedarloom/git";
import { sha256 } from "@cedarloom/ledger";
import { parseDocument, readOptionalJson } from "./use-cases.ts";

/** How a Git source is fetched: over https and ssh, unless a test names another way. */
export type Fetch = (source: Source, options: FetchOptions) => Promise<Result<Tree>>;
type Pin = InstalledExtensions["extensions"][string];

const MANIFEST = "cedarloom-extension.json";
const installedPath = (state: string): string => join(state, "extensions.json");
const NONE: InstalledExtensions = {
  schemaVersion: INSTALLED_SCHEMA_VERSION,
  kind: "cedarloom.extensions",
  extensions: {},
};

const refusal = (extension: string | null, reason: "no-manifest" | "entry" | "protocol" | "installed"): Finding => ({
  code: "extension.install-refused",
  params: { extension, reason },
});

// The installed set and the text it was read from; none yet is an empty set.
const readInstalled = (state: string): Result<{ text: string | null; installed: InstalledExtensions }> => {
  const file = readOptionalJson(installedPath(state));
  if (!file.ok) return file;
  if (file.value === null) return { ok: true, value: { text: null, installed: NONE } };
  const installed = readDocument(InstalledExtensions, INSTALLED_SCHEMA_VERSION, file.value.json);
  return installed.ok ? { ok: true, value: { text: file.value.text, installed: installed.value } } : installed;
};

// The manifest at the root of the fetched folder, read as data: nothing of the extension runs.
const manifestOf = (tree: Tree): Result<ExtensionManifest> => {
  const file = tree.files.find((each) => each.path === MANIFEST);
  if (file === undefined) return { ok: false, finding: refusal(null, "no-manifest") };
  return parseDocument(file.content.toString("utf8"), (json) =>
    readDocument(ExtensionManifest, EXTENSION_SCHEMA_VERSION, json),
  );
};

const installable = (manifest: ExtensionManifest, tree: Tree, installed: InstalledExtensions): Finding | undefined => {
  const { id } = manifest;
  if (Object.hasOwn(installed.extensions, id)) return refusal(id, "installed");
  if (!tree.files.some((file) => file.path === manifest.runtime.entry)) return refusal(id, "entry");
  return speaks(manifest.api) ? undefined : refusal(id, "protocol");
};

/**
 * Writes the files to `<state>/extensions/<id>/<digest>/`, read-only. The folder is named by its content and inert
 * while no installed entry points to it, so it needs no undo; a folder there already holds the same files.
 */
const stage = (state: string, id: string, tree: Tree): void => {
  const parent = join(state, "extensions", id);
  const folder = join(parent, tree.digest);
  if (existsSync(folder)) return;
  mkdirSync(parent, { recursive: true });
  const staging = mkdtempSync(join(parent, "staging-"));
  for (const file of tree.files) {
    // The git package passed only portable paths inside the folder: no "..", no absolute path, no link.
    const path = join(staging, ...file.path.split("/"));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.content, { mode: file.mode === "100755" ? 0o555 : 0o444 });
  }
  renameSync(staging, folder);
};

export type InstallPlan = { plan: Plan; manifest: ExtensionManifest; pin: Pin };

/**
 * Plans the install of the extension at a Git source (P2 a: Git only, no npm and no install script; pending owner
 * decision): fetches the ref into a throwaway bare repository, pins the commit and the digest of the folder's files,
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
  const parent = join(state, "fetch");
  mkdirSync(parent, { recursive: true });
  const tree = await fetch(source, { parent });
  if (!tree.ok) return tree;
  const manifest = manifestOf(tree.value);
  if (!manifest.ok) return manifest;
  const { text, installed } = read.value;
  const finding = installable(manifest.value, tree.value, installed);
  if (finding !== undefined) return { ok: false, finding };
  const { id, version, capabilities = {} } = manifest.value;
  stage(state, id, tree.value);
  const { commit, digest } = tree.value;
  const at = source.path === undefined ? {} : { path: source.path };
  const pin: Pin = {
    version,
    source: { git: source.url, commit, ...at },
    digest,
    ref: source.ref,
    consented: sha256(canonicalJson(capabilities)),
  };
  const content = formatInstalled({ ...installed, extensions: { ...installed.extensions, [id]: pin } });
  const before = text === null ? null : sha256(text);
  const plan: Plan = { schemaVersion: 1, operations: [{ kind: "write", path: installedPath(state), before, content }] };
  return { ok: true, value: { plan, manifest: manifest.value, pin } };
};

/**
 * The installed extensions by id. Each came from Git, so each is community code: its trust comes from where its code
 * came from, never from its manifest (bundled extensions ship inside CedarLoom and are never installed).
 */
export const installedExtensions = (state: string): Result<(Pin & { id: string; trust: "community" })[]> => {
  const read = readInstalled(state);
  if (!read.ok) return read;
  const entries = Object.entries(read.value.installed.extensions);
  return { ok: true, value: entries.map(([id, pin]) => ({ id, ...pin, trust: "community" as const })) };
};
