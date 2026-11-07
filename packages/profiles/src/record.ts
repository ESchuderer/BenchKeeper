import { join, relative, sep } from "node:path";
import { FILES_SCHEMA_VERSION, type Operation, ProfileFiles, type Result, readDocument } from "@cedarloom/contracts";
import { hashFile } from "@cedarloom/engine";
import { sha256 } from "@cedarloom/ledger";
import { onDisk } from "./machine.ts";
import type { LevelPlan, Wanted } from "./owned.ts";
import { jsonFile } from "./resolve.ts";

type Written = ReadonlyMap<string, string | null>;
type Entry = ProfileFiles["files"][string];
/** A project's committed record of the files CedarLoom wrote there, by path on disk. */
export type FilesRecord = ReadonlyMap<string, Entry>;

/** The record at `path` (`.cedarloom/profile-files.json` on disk) by the files' paths on disk; empty without one. */
export const recordOf = (project: string, path: string): Result<FilesRecord> => {
  const file = jsonFile(path);
  if (!file.ok) return file;
  if (file.value === null) return { ok: true, value: new Map() };
  const read = readDocument(ProfileFiles, FILES_SCHEMA_VERSION, file.value.json);
  if (!read.ok) return read;
  const files = Object.entries(read.value.files);
  return { ok: true, value: new Map(files.map(([at, entry]) => [onDisk(join(project, ...at.split("/"))), entry])) };
};

const hashOf = (path: string): string | null => {
  try {
    return hashFile(path);
  } catch {
    return null;
  }
};

/**
 * What CedarLoom last left at each path of a project: the run store's `written`, or the record's hash where the file
 * holds what the record names or the store knows nothing of it, as CedarLoom wrote it from another clone.
 */
export const withRecord = (written: Written, record: FilesRecord): Written => {
  const known = new Map(written);
  for (const [path, entry] of record)
    if (!known.has(path) || hashOf(path) === entry.sha256) known.set(path, entry.sha256);
  return known;
};

/**
 * The record after a plan, written only when it changes: each committed file the plan leaves holding CedarLoom's text,
 * by its path from the project, and as recorded each file the owner changed.
 */
export const recordWrite = (
  { project, path }: { project: string; path: string },
  record: FilesRecord,
  { committed, plan }: { committed: ReadonlyMap<string, Wanted>; plan: LevelPlan },
): Operation[] => {
  const theirs = new Set(
    plan.findings.flatMap((finding) => (finding.code === "profile.owner-changed" ? [finding.params.path] : [])),
  );
  const files = new Map([...record].filter(([at]) => theirs.has(at)));
  for (const [at, { content, pack }] of committed)
    if (!theirs.has(at)) files.set(at, { sha256: sha256(content), ...(pack === undefined ? {} : { pack }) });
  const before = hashOf(path);
  if (files.size === 0 && before === null) return [];
  const sorted = [...files]
    .map(([at, entry]): [string, Entry] => [relative(project, at).split(sep).join("/"), entry])
    .toSorted(([a], [b]) => (a < b ? -1 : 1));
  const document = {
    schemaVersion: FILES_SCHEMA_VERSION,
    kind: "cedarloom.profile-files",
    files: Object.fromEntries(sorted),
  };
  const content = `${JSON.stringify(document, null, 2)}\n`;
  return sha256(content) === before ? [] : [{ kind: "write", path, before, content }];
};
