import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  type Finding,
  type GitSource,
  PackSources,
  readDocument,
  type Result,
  SOURCES_SCHEMA_VERSION,
} from "@cedarloom/contracts";
import { hashFile, tempPath, writeAtomic } from "@cedarloom/engine";
import type { Tree } from "@cedarloom/git";
import { sourceKey } from "@cedarloom/profiles";
import { type Fetch, fetchInto, iso, UPDATE_WAIT_MS } from "./extensions.ts";
import { readOptionalJson } from "./use-cases.ts";

type Followed = PackSources["sources"];
type Pinned = Extract<GitSource, { commit: string }>;
type Taken = { tree: Tree; entry?: Followed[string]; waiting?: Finding };
type ByRef = Extract<GitSource, { ref: string }>;
/** A source a plan needs, and whether it is a pack's folder rather than a skill's. */
export type Wanted = { source: GitSource; pack: boolean };

const refuse = (finding: Finding): Result<never> => ({ ok: false, finding });
const taken = (value: Taken): Result<Taken> => ({ ok: true, value });

const recordPath = (state: string): string => join(state, "pack-sources.json");

// The followed sources' record; an unreadable or newer one stops the plan; deleting it takes each newest commit now.
export const readRecord = (state: string): Result<Followed> => {
  const path = recordPath(state);
  const file = readOptionalJson(path);
  if (file.ok && file.value === null) return { ok: true, value: {} };
  const read = file.ok ? readDocument(PackSources, SOURCES_SCHEMA_VERSION, file.value?.json) : file;
  if (read.ok) return { ok: true, value: read.value.sources };
  if (read.finding.code === "document.newer-schema" || read.finding.code === "document.unreadable") return read;
  return { ok: false, finding: { code: "document.unreadable", params: { path, error: "not a pack-sources record" } } };
};

/** Keeps the record of the sources this plan followed, and only those, as an extension's remove and add starts over. */
export const writeRecord = (state: string, sources: Followed): void => {
  const path = recordPath(state);
  const file = { schemaVersion: SOURCES_SCHEMA_VERSION, kind: "cedarloom.pack-sources", sources };
  const temp = tempPath(path, randomUUID(), 0);
  writeAtomic({ path, before: hashFile(path), temp }, `${JSON.stringify(PackSources.parse(file), null, 2)}\n`, 0o600);
};

const shown = (source: GitSource): string => (source.path === undefined ? source.git : `${source.git} ${source.path}`);
const fetchable = (source: GitSource, ref: string) => ({
  url: source.git,
  ref,
  ...(source.path === undefined ? {} : { path: source.path }),
});

// A pinned source at its commit, refused unless its digest is the pinned one.
const pinned = async (state: string, source: Pinned, fetch: Fetch): Promise<Result<{ tree: Tree }>> => {
  const tree = await fetchInto(state, fetchable(source, source.commit), fetch);
  if (!tree.ok) return tree;
  if (tree.value.digest === source.digest) return { ok: true, value: { tree: tree.value } };
  const params = { source: shown(source), expected: source.digest, found: tree.value.digest };
  return { ok: false, finding: { code: "profile.source-digest", params } };
};

// A file that may run in a branch or tag source: not .md or .txt at 100644 (Q2 a); a pack's own manifest is data.
const runnable = (tree: Tree, pack: boolean): string | undefined =>
  tree.files.find(
    (file) =>
      file.mode !== "100644" || !(/\.(?:md|txt)$/i.test(file.path) || (pack && file.path === "cedarloom-pack.json")),
  )?.path;

// Whether the ref's commit is taken: the first one at once, the one in use always, a new one 3 days after it was seen.
const due = (known: Followed[string], seen: { commit: string; at: string }, now: number): boolean =>
  known.commit === seen.commit || now - Date.parse(seen.at) >= UPDATE_WAIT_MS;

// A branch or tag source: its commit at once the first time, else after 3 days here (A94); runnable files need a pin.
// shortcut: only the ref's newest commit is fetched, as for extensions.
const followed = async (
  state: string,
  { source, pack }: { source: ByRef; pack: boolean },
  known: Followed[string] | undefined,
  fetch: Fetch,
) => {
  const now = Date.now();
  const at = shown(source);
  const tree = await fetchInto(state, fetchable(source, source.ref), fetch);
  if (!tree.ok) return tree;
  const file = runnable(tree.value, pack);
  if (file !== undefined) return refuse({ code: "profile.pack-unpinned", params: { source: at, path: file } });
  const { commit, digest } = tree.value;
  const seen = known?.seen.commit === commit ? known.seen : { commit, at: iso(now) };
  if (known === undefined || due(known, seen, now)) return taken({ tree: tree.value, entry: { commit, digest, seen } });
  const path = source.path === undefined ? {} : { path: source.path };
  const kept = await pinned(state, { git: source.git, ...path, commit: known.commit, digest: known.digest }, fetch);
  if (!kept.ok) return refuse({ code: "profile.source-unavailable", params: { source: at, commit: known.commit } });
  const offered = iso(Date.parse(seen.at) + UPDATE_WAIT_MS);
  const waiting: Finding = { code: "profile.source-waiting", params: { source: at, commit, offered } };
  return taken({ tree: kept.value.tree, entry: { ...known, seen }, waiting });
};

// Fetches each source once, pinned by commit and digest or followed by this machine's record: trees, record and waits.
export const fetchSources = async (state: string, sources: Wanted[], fetch: Fetch, record: Followed) => {
  const trees = new Map<string, Tree>();
  const entries: Followed = {};
  const findings: Finding[] = [];
  for (const wanted of sources) {
    const { source } = wanted;
    const key = sourceKey(source);
    const got: Result<Taken> =
      "commit" in source
        ? await pinned(state, source, fetch)
        : await followed(state, { ...wanted, source }, record[key], fetch);
    if (!got.ok) return got;
    trees.set(key, got.value.tree);
    if (got.value.entry !== undefined) entries[key] = got.value.entry;
    if (got.value.waiting !== undefined) findings.push(got.value.waiting);
  }
  return { ok: true as const, value: { trees, entries, findings } };
};
