import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  canonicalJson,
  EXPORT_SCHEMA_VERSION,
  ExportIndex,
  ExtensionLock,
  type ExtensionManifest,
  type Finding,
  formatLock,
  type ImportReview,
  isExtensionType,
  LOCK_SCHEMA_VERSION,
  PLAN_SCHEMA_VERSION,
  type Plan,
  type Result,
  readDocument,
  STORE_REF,
  WORKFLOW_SCHEMA_VERSION,
  WorkflowDefinition,
} from "@cedarloom/contracts";
import { errorCode } from "@cedarloom/engine";
import { fetchTree, type Store, type Tree } from "@cedarloom/git";
import { DRAFT_LIMIT } from "./drafts.ts";
import { type Fetch, installedExtensions, manifestOf } from "./extensions.ts";
import { fileOf, linkIn, readStored } from "./store.ts";
import { parseDocument, storeOf } from "./use-cases.ts";

const INDEX = "cedarloom-export.json";
const LOCK = "cedarloom.lock.json";
// Where the store keeps the blob each workflow had when it was last imported: an update replaces only that one.
const IMPORTED = "cedarloom-imports.json";
const NO_LOCK: ExtensionLock = { schemaVersion: LOCK_SCHEMA_VERSION, kind: "cedarloom.lock", extensions: {} };

const refuse = (finding: Finding): Result<never> => ({ ok: false, finding });
type Read = (path: string) => Result<string>;
type Source = ImportReview["source"];
type Incoming = { source: Source; index: ExportIndex; lock: ExtensionLock; texts: Map<string, string> };

/** Where to import from: an export folder, or a Git URL at a ref. */
export type From = { folder: string } | { git: string; ref: string };

// A file of an export folder, read within the draft limit and never through a link on the way: a clone's link could
// lead anywhere on this machine.
const inFolder =
  (folder: string): Read =>
  (path) => {
    const file = join(folder, ...path.split("/"));
    try {
      const link = linkIn(folder, path);
      if (link !== undefined) return refuse({ code: "apply.symlink", params: { path: link } });
      if (statSync(file).size > DRAFT_LIMIT)
        return refuse({ code: "document.unreadable", params: { path: file, error: "EFBIG" } });
      return { ok: true, value: readFileSync(file, "utf8") };
    } catch (error) {
      return refuse({ code: "document.unreadable", params: { path: file, error: errorCode(error) } });
    }
  };

// A file of a fetched tree, which the git package read within its limits.
const inTree =
  (tree: Tree): Read =>
  (path) => {
    const file = tree.files.find((each) => each.path === path);
    return file === undefined
      ? refuse({ code: "document.unreadable", params: { path, error: "ENOENT" } })
      : { ok: true, value: file.content.toString("utf8") };
  };

/** The index, the lock and each workflow's text the index names, refused when a workflow is not of its file's id. */
const incomingOf = (read: Read, source: Source): Result<Incoming> => {
  const indexText = read(INDEX);
  const index = indexText.ok
    ? parseDocument(indexText.value, (json) => readDocument(ExportIndex, EXPORT_SCHEMA_VERSION, json))
    : indexText;
  if (!index.ok) return index;
  const lockText = read(LOCK);
  const lock = lockText.ok
    ? parseDocument(lockText.value, (json) => readDocument(ExtensionLock, LOCK_SCHEMA_VERSION, json))
    : lockText;
  if (!lock.ok) return lock;
  const texts = new Map<string, string>();
  for (const id of index.value.workflows) {
    const text = read(fileOf(id));
    const workflow = text.ok
      ? parseDocument(text.value, (json) => readDocument(WorkflowDefinition, WORKFLOW_SCHEMA_VERSION, json))
      : text;
    if (!workflow.ok) return workflow;
    if (workflow.value.metadata.id.toLowerCase() !== id.toLowerCase()) {
      return refuse({ code: "document.invalid", params: { issues: [{ path: "metadata.id", code: "custom" }] } });
    }
    texts.set(workflow.value.metadata.id, text.ok ? text.value : "");
  }
  return { ok: true, value: { source, index: index.value, lock: lock.value, texts } };
};

const fetched = async (state: string, source: { url: string; ref: string; path?: string }, fetch: Fetch) => {
  const parent = join(state, "fetch");
  mkdirSync(parent, { recursive: true });
  return fetch(source, { parent });
};

const readIncoming = async (state: string, from: From, fetch: Fetch): Promise<Result<Incoming>> => {
  if ("folder" in from) return incomingOf(inFolder(from.folder), { folder: from.folder });
  const tree = await fetched(state, { url: from.git, ref: from.ref }, fetch);
  if (!tree.ok) return tree;
  return incomingOf(inTree(tree.value), { git: from.git, ref: from.ref, commit: tree.value.commit });
};

// Git's blob id of a text: what the store would hold for it (a SHA-1 store, P3 a).
const blobOf = (text: string): string =>
  createHash("sha1")
    .update(`blob ${Buffer.byteLength(text)}\0`)
    .update(text)
    .digest("hex");

type Stored = { store: Store; head: string | null; imported: Record<string, string>; lock: ExtensionLock };

const storedJson = <T>(
  at: Pick<Stored, "store" | "head">,
  path: string,
  read: (json: unknown) => Result<T>,
  none: T,
): Result<T> => {
  const blob = at.head === null ? null : at.store.blob(at.head, path);
  if (blob === null) return { ok: true, value: none };
  const bytes = at.store.read(blob);
  return bytes.ok ? parseDocument(bytes.value.toString("utf8"), read) : bytes;
};

// The record of the last imports: workflow ids to blob ids, nothing else.
const asImported = (json: unknown): Result<Record<string, string>> => {
  const entries = typeof json === "object" && json !== null && !Array.isArray(json) ? Object.entries(json) : null;
  const valid = entries?.every(([, blob]) => typeof blob === "string" && /^[0-9a-f]{40}$/.test(blob)) === true;
  if (entries === null || !valid)
    return refuse({ code: "document.invalid", params: { issues: [{ path: IMPORTED, code: "custom" }] } });
  return { ok: true, value: Object.fromEntries(entries.map(([id, blob]) => [id, String(blob)])) };
};

const storedOf = (state: string): Result<Stored> => {
  const store = storeOf(state);
  const head = store.head();
  const imported = storedJson({ store, head }, IMPORTED, asImported, {});
  if (!imported.ok) return imported;
  const lock = storedJson(
    { store, head },
    LOCK,
    (json) => readDocument(ExtensionLock, LOCK_SCHEMA_VERSION, json),
    NO_LOCK,
  );
  return lock.ok ? { ok: true, value: { store, head, imported: imported.value, lock: lock.value } } : lock;
};

type Unit = ImportReview["units"][number];
type Node = WorkflowDefinition["nodes"][number];

const changesOf = (before: Node[], after: Node[]): Unit["changes"] => {
  const old = new Map(before.map((node) => [node.id, canonicalJson(node)]));
  const now = new Map(after.map((node) => [node.id, canonicalJson(node)]));
  return {
    added: [...now.keys()].filter((id) => !old.has(id)),
    removed: [...old.keys()].filter((id) => !now.has(id)),
    changed: [...now.keys()].filter((id) => old.has(id) && old.get(id) !== now.get(id)),
  };
};

const statusOf = (stored: string | null, incoming: string, imported: string | undefined): Unit["status"] => {
  if (stored === null) return "new";
  if (stored === incoming) return "same";
  return stored === imported ? "update" : "conflict";
};

const storedWorkflow = (store: Store, blob: string | null): WorkflowDefinition | null => {
  const read = blob === null ? null : readStored(store, blob);
  return read?.ok === true ? read.value.workflow : null;
};

/** A workflow's status against the store: never replaced when edited here since its last import, or never imported. */
const unitOf = (stored: Stored, index: ExportIndex, text: string): Unit => {
  const workflow = WorkflowDefinition.parse(JSON.parse(text));
  const { id, version, license } = workflow.metadata;
  const blob = stored.head === null ? null : stored.store.blob(stored.head, fileOf(id));
  const before = storedWorkflow(stored.store, blob);
  return {
    id,
    status: statusOf(blob, blobOf(text), stored.imported[id.toLowerCase()]),
    version,
    stored: before?.metadata.version ?? null,
    license: license ?? index.license ?? null,
    changes: changesOf(before?.nodes ?? [], workflow.nodes),
  };
};

type Risk = ImportReview["risks"][number];
const text = (node: Node, key: string): string | undefined => {
  const value: unknown = Reflect.get(Object(node.with), key);
  return typeof value === "string" ? value : undefined;
};
// Each line a node runs or writes, by its type: every command and task in full (a workflow is code in effect).
const LINES: Record<string, (node: Node) => [Risk["kind"], string | undefined][]> = {
  "trigger.schedule": (node) => [
    ["schedule", `${text(node, "cron")}${text(node, "timezone") === undefined ? "" : ` (${text(node, "timezone")})`}`],
    ["precheck", text(node, "precheck")],
  ],
  "trigger.manual": (node) => [["precheck", text(node, "precheck")]],
  "command.run": (node) => [["command", text(node, "command")]],
  "agent.run": (node) => [["agent", text(node, "task")]],
  "file.write": (node) => [["write", text(node, "path")]],
  "workflow.run": (node) => [["workflow", text(node, "workflow")]],
};
const risksOf = (workflow: WorkflowDefinition): Risk[] =>
  workflow.nodes.flatMap((node) => {
    const extension: [Risk["kind"], string][] = isExtensionType(node.type) ? [["extension", node.type]] : [];
    const lines = LINES[node.type]?.(node) ?? extension;
    return lines.flatMap(([kind, line]) =>
      line === undefined ? [] : [{ workflow: workflow.metadata.id, node: node.id, kind, text: line }],
    );
  });

type Extension = ImportReview["extensions"][number];

const treeStatus = (tree: Result<Tree>, digest: string): Extension["status"] => {
  if (!tree.ok) return "unreachable";
  return tree.value.digest === digest ? "verified" : "mismatch";
};
// What an extension may reach, from its manifest at the pinned commit; nothing when unread.
const reach = (manifest: Result<ExtensionManifest> | undefined): Pick<Extension, "net" | "credentials"> => {
  const read = manifest?.ok === true ? manifest.value : undefined;
  return {
    net: read?.capabilities?.net ?? [],
    credentials: Object.keys(read?.capabilities?.credentials ?? {}),
  };
};

/** Each extension the lock pins, fetched at its commit as data only (nothing runs) and checked against its digest. */
const extensionsOf = async (state: string, lock: ExtensionLock, fetch: Fetch): Promise<Extension[]> => {
  const installed = installedExtensions(state);
  const pins = installed.ok ? installed.value : [];
  return Promise.all(
    Object.entries(lock.extensions).map(async ([id, pin]): Promise<Extension> => {
      const at = pin.source.path === undefined ? {} : { path: pin.source.path };
      const tree = await fetched(state, { url: pin.source.git, ref: pin.source.commit, ...at }, fetch);
      const status = treeStatus(tree, pin.digest);
      const manifest = tree.ok && status === "verified" ? manifestOf(tree.value) : undefined;
      const here = pins.some(
        (each) => each.id === id && each.source.commit === pin.source.commit && each.digest === pin.digest,
      );
      const { git, commit } = pin.source;
      return {
        id,
        version: pin.version,
        git,
        commit,
        ...at,
        digest: pin.digest,
        status,
        installed: here,
        ...reach(manifest),
      };
    }),
  );
};

/**
 * The plan of an import: one store.update to a commit with the new and updated workflows byte for byte, the store's
 * lock with the import's entries, and the blob each was imported as. Null when nothing is new or updated.
 */
const planOf = (stored: Stored, from: Incoming, units: Unit[]): Result<Plan | null> => {
  const chosen = units.filter((unit) => unit.status === "new" || unit.status === "update");
  if (chosen.length === 0) return { ok: true, value: null };
  const textOf = (id: string): string => from.texts.get(id) ?? "";
  const imported = {
    ...stored.imported,
    ...Object.fromEntries(chosen.map(({ id }) => [id.toLowerCase(), blobOf(textOf(id))])),
  };
  const lock = { ...stored.lock, extensions: { ...stored.lock.extensions, ...from.lock.extensions } };
  const files: [string, string][] = [
    ...chosen.map(({ id }): [string, string] => [fileOf(id), textOf(id)]),
    [LOCK, formatLock(lock)],
    [IMPORTED, `${JSON.stringify(JSON.parse(canonicalJson(imported)), null, 2)}\n`],
  ];
  const message = chosen.map(({ id, version }) => `${id} ${version}\n`).join("");
  const made = stored.store.commit(stored.head, files, message);
  if (!made.ok) return made;
  const operations: Plan["operations"] = [
    { kind: "store.update", ref: STORE_REF, before: stored.head, after: made.value.commit },
  ];
  return { ok: true, value: { schemaVersion: PLAN_SCHEMA_VERSION, operations } };
};

/** An import's review and, when anything is new or updated, its plan. */
export type ImportPlan = { review: ImportReview; plan: Plan | null };

/**
 * Plans an import (P6 a): reads the export folder or fetches the Git ref as data, nothing checked out or run, and builds
 * the review. Its plan stores the new and updated workflows as one store.update; a workflow in conflict is never
 * replaced, and no extension is installed.
 */
export const planImport = async (state: string, from: From, fetch: Fetch = fetchTree): Promise<Result<ImportPlan>> => {
  const read = await readIncoming(state, from, fetch);
  if (!read.ok) return read;
  const stored = storedOf(state);
  if (!stored.ok) return stored;
  const texts = [...read.value.texts.values()];
  const units = texts.map((each) => unitOf(stored.value, read.value.index, each));
  const risks = texts.flatMap((each) => risksOf(WorkflowDefinition.parse(JSON.parse(each))));
  const extensions = await extensionsOf(state, read.value.lock, fetch);
  const plan = planOf(stored.value, read.value, units);
  if (!plan.ok) return plan;
  return { ok: true, value: { review: { source: read.value.source, units, risks, extensions }, plan: plan.value } };
};
