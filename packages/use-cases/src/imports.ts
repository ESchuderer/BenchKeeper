import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  canonicalJson,
  EXPORT_SCHEMA_VERSION,
  ExportIndex,
  type Finding,
  type ImportReview,
  PLAN_SCHEMA_VERSION,
  type Plan,
  type Result,
  readDocument,
  Sha256,
  STORE_REF,
  WORKFLOW_SCHEMA_VERSION,
  WorkflowDefinition,
} from "@cedarloom/contracts";
import { errorCode } from "@cedarloom/engine";
import { fetchTree, type Store, type Tree } from "@cedarloom/git";
import { sha256 } from "@cedarloom/ledger";
import { DRAFT_LIMIT, load } from "./drafts.ts";
import type { Fetch } from "./extensions.ts";
import { fileOf, linkIn, readStored, unstorable } from "./store.ts";
import { parseDocument, storeOf } from "./use-cases.ts";

const INDEX = "cedarloom-export.json";
// Where the store keeps the SHA-256 of each workflow's text as it was last imported: an update replaces only that.
const IMPORTED = "cedarloom-imports.json";

const refuse = (finding: Finding): Result<never> => ({ ok: false, finding });
type Read = (path: string) => Result<string>;
type Source = ImportReview["source"];
type Workflow = { text: string; workflow: WorkflowDefinition };
type Incoming = { source: Source; index: ExportIndex; workflows: Workflow[] };

/** Where to import from: an export folder, or a Git URL at a ref. */
export type From = { folder: string } | { git: string; ref: string };

const unreadable = (path: string, error: string): Result<never> =>
  refuse({ code: "document.unreadable", params: { path, error } });

// Text only as valid UTF-8: a replaced byte would store other bytes than the source's.
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const decoded = (path: string, bytes: Buffer): Result<string> => {
  try {
    return { ok: true, value: UTF8.decode(bytes) };
  } catch (error) {
    return unreadable(path, errorCode(error));
  }
};

// A file of an export folder, read capped from one open file through no link: a clone's link could lead anywhere.
const inFolder =
  (folder: string): Read =>
  (path) => {
    const file = join(folder, ...path.split("/"));
    try {
      const link = path.includes("/") ? linkIn(folder, path.slice(0, path.lastIndexOf("/"))) : undefined;
      if (link !== undefined) return refuse({ code: "apply.symlink", params: { path: link } });
      const found = load(file);
      if (found === undefined) return unreadable(file, "ENOENT");
      if (found === null) return unreadable(file, "not a file");
      return found.bytes === null ? unreadable(file, "EFBIG") : decoded(file, found.bytes);
    } catch (error) {
      return unreadable(file, errorCode(error));
    }
  };

// A file of a fetched tree, which the git package read within its limits, and within the draft limit.
const inTree =
  (tree: Tree): Read =>
  (path) => {
    const file = tree.files.find((each) => each.path === path);
    if (file === undefined) return unreadable(path, "ENOENT");
    return file.content.length > DRAFT_LIMIT ? unreadable(path, "EFBIG") : decoded(path, file.content);
  };

const documentIn = <T>(read: Read, path: string, as: (json: unknown) => Result<T>): Result<T> => {
  const text = read(path);
  return text.ok ? parseDocument(text.value, as) : text;
};

// A workflow the index names: of its file's id, and none a save would refuse.
const workflowIn = (read: Read, id: string): Result<Workflow> => {
  const text = read(fileOf(id));
  if (!text.ok) return text;
  const workflow = parseDocument(text.value, (json) => readDocument(WorkflowDefinition, WORKFLOW_SCHEMA_VERSION, json));
  if (!workflow.ok) return workflow;
  if (workflow.value.metadata.id.toLowerCase() !== id.toLowerCase()) {
    return refuse({ code: "document.invalid", params: { issues: [{ path: "metadata.id", code: "custom" }] } });
  }
  const error = unstorable(workflow.value);
  return error === undefined ? { ok: true, value: { text: text.value, workflow: workflow.value } } : refuse(error);
};

/** The index and each workflow the index names. */
const incomingOf = (read: Read, source: Source): Result<Incoming> => {
  const index = documentIn(read, INDEX, (json) => readDocument(ExportIndex, EXPORT_SCHEMA_VERSION, json));
  if (!index.ok) return index;
  const workflows: Workflow[] = [];
  for (const id of index.value.workflows) {
    const workflow = workflowIn(read, id);
    if (!workflow.ok) return workflow;
    workflows.push(workflow.value);
  }
  return { ok: true, value: { source, index: index.value, workflows } };
};

const fetched = async (state: string, source: { url: string; ref: string; path?: string }, fetch: Fetch) => {
  const parent = join(state, "fetch");
  mkdirSync(parent, { recursive: true });
  return fetch(source, { parent });
};

const readIncoming = async (state: string, from: From, fetch: Fetch): Promise<Result<Incoming>> => {
  if ("folder" in from) return incomingOf(inFolder(resolve(from.folder)), { folder: resolve(from.folder) });
  const tree = await fetched(state, { url: from.git, ref: from.ref }, fetch);
  if (!tree.ok) return tree;
  return incomingOf(inTree(tree.value), { git: from.git, ref: from.ref, commit: tree.value.commit });
};

type Stored = { store: Store; head: string | null; imported: Record<string, string> };

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

// The record of the last imports: workflow ids to the SHA-256 of their texts, nothing else.
const asImported = (json: unknown): Result<Record<string, string>> => {
  const entries = typeof json === "object" && json !== null && !Array.isArray(json) ? Object.entries(json) : null;
  const valid = entries?.every(([, hash]) => Sha256.safeParse(hash).success) === true;
  if (entries === null || !valid)
    return refuse({ code: "document.invalid", params: { issues: [{ path: IMPORTED, code: "custom" }] } });
  return { ok: true, value: Object.fromEntries(entries.map(([id, hash]) => [id, String(hash)])) };
};

const storedOf = (state: string): Result<Stored> => {
  const store = storeOf(state);
  const head = store.head();
  const imported = storedJson({ store, head }, IMPORTED, asImported, {});
  return imported.ok ? { ok: true, value: { store, head, imported: imported.value } } : imported;
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
  return sha256(stored) === imported ? "update" : "conflict";
};

// What the store holds for `id`: no text when nothing; a file that does not read is no import's, so a conflict.
const storedAt = (stored: Stored, id: string): { text: string | null; version: string | null; nodes: Node[] } => {
  const blob = stored.head === null ? null : stored.store.blob(stored.head, fileOf(id));
  if (blob === null) return { text: null, version: null, nodes: [] };
  const read = readStored(stored.store, blob);
  if (!read.ok) return { text: "", version: null, nodes: [] };
  return { text: read.value.text, version: read.value.workflow.metadata.version, nodes: read.value.workflow.nodes };
};

/** A workflow's status against the store: never replaced when edited here since its last import, or never imported. */
const unitOf = (stored: Stored, index: ExportIndex, { text, workflow }: Workflow): Unit => {
  const { id, version, license } = workflow.metadata;
  const before = storedAt(stored, id);
  return {
    id,
    status: statusOf(before.text, text, stored.imported[id.toLowerCase()]),
    version,
    stored: before.version,
    license: license ?? index.license ?? null,
    changes: changesOf(before.nodes, workflow.nodes),
  };
};

type Risk = ImportReview["risks"][number];
const textOf = (node: Node, key: string): string | undefined => {
  const value: unknown = Reflect.get(Object(node.with), key);
  return typeof value === "string" ? value : undefined;
};
// Each line a node runs or tells an agent, by its type: every command, task and message in full (a workflow is code in
// effect; a gate's message reaches the model that reports the stage).
const LINES: Record<string, (node: Node) => [Risk["kind"], string | undefined][]> = {
  "trigger.schedule": (node) => [
    [
      "schedule",
      `${textOf(node, "cron")}${textOf(node, "timezone") === undefined ? "" : ` (${textOf(node, "timezone")})`}`,
    ],
    ["precheck", textOf(node, "precheck")],
  ],
  "trigger.manual": (node) => [["precheck", textOf(node, "precheck")]],
  "command.run": (node) => [["command", textOf(node, "command")]],
  "agent.run": (node) => [["agent", textOf(node, "task")]],
  "human.approval": (node) => [["approval", textOf(node, "message")]],
  "workflow.run": (node) => [["workflow", textOf(node, "workflow")]],
};
const risksOf = (workflow: WorkflowDefinition): Risk[] =>
  workflow.nodes.flatMap((node) => {
    const lines = LINES[node.type]?.(node) ?? [];
    return lines.flatMap(([kind, line]) =>
      line === undefined ? [] : [{ workflow: workflow.metadata.id, node: node.id, kind, text: line }],
    );
  });

// Byte for byte, with each hash as imported, which tells a later import an update from a local edit; null for none chosen.
const planOf = (stored: Stored, chosen: Workflow[]): Result<Plan | null> => {
  if (chosen.length === 0) return { ok: true, value: null };
  const hashes = chosen.map(({ text, workflow }) => [workflow.metadata.id.toLowerCase(), sha256(text)]);
  const imported = { ...stored.imported, ...Object.fromEntries(hashes) };
  const files: [string, string][] = [
    ...chosen.map(({ text, workflow }): [string, string] => [fileOf(workflow.metadata.id), text]),
    [IMPORTED, `${JSON.stringify(JSON.parse(canonicalJson(imported)), null, 2)}\n`],
  ];
  const message = chosen.map(({ workflow }) => `${workflow.metadata.id} ${workflow.metadata.version}\n`).join("");
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
 * replaced.
 */
export const planImport = async (state: string, from: From, fetch: Fetch = fetchTree): Promise<Result<ImportPlan>> => {
  const read = await readIncoming(state, from, fetch);
  if (!read.ok) return read;
  const stored = storedOf(state);
  if (!stored.ok) return stored;
  const { workflows, index, source } = read.value;
  const units = workflows.map((each) => unitOf(stored.value, index, each));
  const risks = workflows.flatMap(({ workflow }) => risksOf(workflow));
  const chosen = workflows.filter((_, at) => ["new", "update"].includes(units[at]?.status ?? "same"));
  const plan = planOf(stored.value, chosen);
  if (!plan.ok) return plan;
  return { ok: true, value: { review: { source, units, risks }, plan: plan.value } };
};
