import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Finding,
  type GitSource,
  PackSources,
  readDocument,
  type Result,
  SOURCES_SCHEMA_VERSION,
} from "@cedarloom/contracts";
import type { Tree } from "@cedarloom/git";
import { sourceKey } from "@cedarloom/profiles";
import { type Fetch, fetchInto, iso, UPDATE_WAIT_MS } from "./extensions.ts";
import { readOptionalJson } from "./use-cases.ts";

type Followed = PackSources["sources"];
type Pinned = Extract<GitSource, { commit: string }>;
type Taken = { tree: Tree; entry?: Followed[string]; waiting?: Finding };

const recordPath = (state: string): string => join(state, "pack-sources.json");

// This machine's record of the followed sources; one CedarLoom cannot read starts every wait again.
const readRecord = (state: string): Followed => {
  const file = readOptionalJson(recordPath(state));
  if (!file.ok || file.value === null) return {};
  const read = readDocument(PackSources, SOURCES_SCHEMA_VERSION, file.value.json);
  return read.ok ? read.value.sources : {};
};

const shown = (source: GitSource): string => (source.path === undefined ? source.git : `${source.git} ${source.path}`);
const fetchable = (source: GitSource, ref: string) => ({
  url: source.git,
  ref,
  ...(source.path === undefined ? {} : { path: source.path }),
});

// A pinned source at its commit, refused unless its digest is the pinned one.
const pinned = async (state: string, source: Pinned, fetch: Fetch): Promise<Result<Taken>> => {
  const tree = await fetchInto(state, fetchable(source, source.commit), fetch);
  if (!tree.ok) return tree;
  if (tree.value.digest === source.digest) return { ok: true, value: { tree: tree.value } };
  const params = { source: shown(source), expected: source.digest, found: tree.value.digest };
  return { ok: false, finding: { code: "profile.source-digest", params } };
};

// A file that may run, in a source that follows a branch or tag: anything but .md and .txt at mode 100644 (Q2 a). A
// pack's own manifest is the one exception: CedarLoom reads it as data, and without it no pack could follow a branch.
const runnable = (tree: Tree): string | undefined =>
  tree.files.find(
    (file) => file.path !== "cedarloom-pack.json" && (file.mode !== "100644" || !/\.(?:md|txt)$/i.test(file.path)),
  )?.path;

// Whether the commit at the ref is taken: the first one at once, the one in use always, a new one 3 days after it was seen.
const due = (known: Followed[string], seen: { commit: string; at: string }, now: number): boolean =>
  known.commit === seen.commit || now - Date.parse(seen.at) >= UPDATE_WAIT_MS;

/**
 * A source that follows a branch or tag: the commit there, taken at once the first time, else once this machine has
 * seen it there for 3 days (A94); until then the commit in use, fetched again by its pin. A commit with a file that may
 * run is refused, as such a source needs a pin. shortcut: only the ref's newest commit is fetched, as for extensions.
 */
const followed = async (state: string, source: GitSource, known: Followed[string] | undefined, fetch: Fetch) => {
  const now = Date.now();
  const tree = await fetchInto(state, fetchable(source, "ref" in source ? source.ref : source.commit), fetch);
  if (!tree.ok) return tree;
  const file = runnable(tree.value);
  if (file !== undefined) {
    return {
      ok: false as const,
      finding: { code: "profile.pack-unpinned" as const, params: { source: shown(source), path: file } },
    };
  }
  const { commit, digest } = tree.value;
  const seen = known?.seen.commit === commit ? known.seen : { commit, at: iso(now) };
  if (known === undefined || due(known, seen, now))
    return { ok: true as const, value: { tree: tree.value, entry: { commit, digest, seen } } };
  const pin = {
    git: source.git,
    ...(source.path === undefined ? {} : { path: source.path }),
    commit: known.commit,
    digest: known.digest,
  };
  const kept = await pinned(state, pin, fetch);
  if (!kept.ok) return kept;
  const offered = iso(Date.parse(seen.at) + UPDATE_WAIT_MS);
  const waiting: Finding = { code: "profile.source-waiting", params: { source: shown(source), commit, offered } };
  return { ok: true as const, value: { tree: kept.value.tree, entry: { ...known, seen }, waiting } };
};

/**
 * Fetches each source once: a pinned one at its commit and digest, one that follows a branch or tag by this machine's
 * record, which it keeps up to date as the extension updates keep theirs. The trees by `sourceKey`, and the waits.
 */
export const fetchSources = async (
  state: string,
  sources: GitSource[],
  fetch: Fetch,
): Promise<Result<{ trees: Map<string, Tree>; findings: Finding[] }>> => {
  const record = readRecord(state);
  const trees = new Map<string, Tree>();
  const findings: Finding[] = [];
  for (const source of sources) {
    const key = sourceKey(source);
    if (trees.has(key)) continue;
    const taken =
      "commit" in source ? await pinned(state, source, fetch) : await followed(state, source, record[key], fetch);
    if (!taken.ok) return taken;
    trees.set(key, taken.value.tree);
    if (taken.value.entry !== undefined) record[key] = taken.value.entry;
    if (taken.value.waiting !== undefined) findings.push(taken.value.waiting);
  }
  const file = { schemaVersion: SOURCES_SCHEMA_VERSION, kind: "cedarloom.pack-sources", sources: record };
  if (Object.keys(record).length > 0)
    writeFileSync(recordPath(state), `${JSON.stringify(PackSources.parse(file), null, 2)}\n`);
  return { ok: true, value: { trees, findings } };
};
