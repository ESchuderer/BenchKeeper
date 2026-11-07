import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  FILES_SCHEMA_VERSION,
  type Finding,
  type Operation,
  ProfileFiles,
  type Result,
  readDocument,
} from "@cedarloom/contracts";
import { hashFile } from "@cedarloom/engine";
import { sha256 } from "@cedarloom/ledger";
import { onDisk } from "./machine.ts";
import type { LevelPlan, Wanted } from "./owned.ts";
import { jsonFile } from "./resolve.ts";

type Written = ReadonlyMap<string, string | null>;
type Entry = ProfileFiles["files"][string];
/** A project's committed record of the files CedarLoom wrote there, by path on disk. */
export type FilesRecord = ReadonlyMap<string, Entry>;

// A record that does not parse (a Git conflict in it) or fit its schema, named, so the owner knows which file to mend.
const named = (finding: Finding, path: string): Finding =>
  finding.code === "document.invalid" ? { ...finding, params: { ...finding.params, path } } : finding;

/** The record at `path` (`.cedarloom/profile-files.json` on disk) by the files' paths on disk; empty without one. */
export const recordOf = (project: string, path: string): Result<FilesRecord> => {
  const file = jsonFile(path);
  if (!file.ok) return { ok: false, finding: named(file.finding, path) };
  if (file.value === null) return { ok: true, value: new Map() };
  const read = readDocument(ProfileFiles, FILES_SCHEMA_VERSION, file.value.json);
  if (!read.ok) return { ok: false, finding: named(read.finding, path) };
  const files = Object.entries(read.value.files);
  return { ok: true, value: new Map(files.map(([at, entry]) => [onDisk(join(project, ...at.split("/"))), entry])) };
};

/** A file's hash; null when it is absent or cannot be read. */
export const hashOrNull = (path: string): string | null => {
  try {
    return hashFile(path);
  } catch {
    return null;
  }
};

// A text's hash with its line endings as LF, on both sides of the record, so a checkout that turned them into CRLF
// (Git's `core.autocrlf` on Windows) or a CedarLoom text that has CRLF itself still matches.
const textDigest = (text: string): string => sha256(text.replaceAll("\r\n", "\n"));

const textHash = (path: string): string | null => {
  try {
    return textDigest(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

/**
 * What CedarLoom last left at each path of a project: the run store's `written`, and the current hash of each file
 * that holds what the record names, as CedarLoom wrote it there from another clone.
 */
export const withRecord = (written: Written, record: FilesRecord): Written => {
  const known = new Map(written);
  for (const [path, entry] of record) if (textHash(path) === entry.sha256) known.set(path, hashOrNull(path));
  return known;
};

/** The paths of a plan's files the owner changed, which stay as they are. */
export const ownerChanged = (plan: LevelPlan): Set<string> =>
  new Set(plan.findings.flatMap((finding) => (finding.code === "profile.owner-changed" ? [finding.params.path] : [])));

// The record's entries by their paths from the project, sorted, as the file holds them.
const entriesOf = (project: string, files: FilesRecord): [string, Entry][] =>
  [...files]
    .map(([at, entry]): [string, Entry] => [relative(project, at).split(sep).join("/"), entry])
    .toSorted(([a], [b]) => (a < b ? -1 : 1));

/**
 * The record after a plan: each committed file the plan leaves holding CedarLoom's text set to it, each file it deletes
 * taken out, any other entry kept (a part held back, a file left as it is, another clone's profile). Written only when
 * its entries change, so a checkout's line endings never rewrite it.
 */
export const recordWrite = (
  { project, path }: { project: string; path: string },
  record: FilesRecord,
  { committed, plan }: { committed: ReadonlyMap<string, Wanted>; plan: LevelPlan },
): Operation[] => {
  const theirs = ownerChanged(plan);
  const files = new Map(record);
  for (const [at, { content, pack }] of committed)
    if (!theirs.has(at)) files.set(at, { sha256: textDigest(content), ...(pack === undefined ? {} : { pack }) });
  for (const operation of plan.operations) if (operation.kind === "delete") files.delete(operation.path);
  const entries = entriesOf(project, files);
  if (JSON.stringify(entries) === JSON.stringify(entriesOf(project, record))) return [];
  const document = {
    schemaVersion: FILES_SCHEMA_VERSION,
    kind: "cedarloom.profile-files",
    files: Object.fromEntries(entries),
  };
  return [{ kind: "write", path, before: hashOrNull(path), content: `${JSON.stringify(document, null, 2)}\n` }];
};
