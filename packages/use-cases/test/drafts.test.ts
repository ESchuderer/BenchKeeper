import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatWorkflow, type WorkflowDefinition } from "@cedarloom/contracts";
import { sha256 } from "@cedarloom/ledger";
import { DRAFT_LIMIT, deleteDraft, listDrafts, readDraft, saveDraft } from "@cedarloom/use-cases";
import { expect, test } from "vitest";

const corpus = join(import.meta.dirname, "..", "..", "contracts", "corpus", "WorkflowDefinition", "1");
const base = JSON.parse(readFileSync(join(corpus, "valid-build-and-review.json"), "utf8"));
const sample = (id = "w"): WorkflowDefinition => ({ ...base, metadata: { ...base.metadata, id } });
const otherId = { code: "document.invalid", params: { issues: [{ path: "metadata.id", code: "custom" }] } };
const state = (): string => join(mkdtempSync(join(tmpdir(), "cedarloom-drafts-")), "state");
const drafts = (at: string): string => join(at, "drafts");

type Outcome<T> = { ok: true; value: T } | { ok: false; finding: { code: string; params: unknown } };
const ok = <T>(result: Outcome<T>): T => {
  if (!result.ok) throw new Error(`refused: ${result.finding.code}`);
  return result.value;
};
const refused = <T>(result: Outcome<T>): unknown => (result.ok ? "ok" : result.finding);

test("a draft is saved in the canonical file form, listed without contents, and read back with its hash", () => {
  const at = state();
  expect(listDrafts(at)).toEqual([]);
  const saved = ok(saveDraft(at, "Build-And-Review", sample("build-and-review"), null));
  const file = join(drafts(at), "workflow-build-and-review.json");
  const text = readFileSync(file, "utf8");
  expect(text).toBe(formatWorkflow(sample("build-and-review")));
  expect(saved).toEqual({
    id: "build-and-review",
    savedAt: statSync(file).mtime.toISOString(),
    hash: sha256(text),
    bytes: Buffer.byteLength(text),
    overwrote: false,
  });
  expect(listDrafts(at)).toEqual([{ id: "build-and-review", savedAt: saved.savedAt, bytes: saved.bytes }]);
  // An id that differs in case only names the same draft, on every file system.
  expect(ok(readDraft(at, "BUILD-and-review"))).toEqual({
    id: "build-and-review",
    savedAt: saved.savedAt,
    hash: saved.hash,
    workflow: sample("build-and-review"),
  });
  // Only the draft is left in the folder: the temporary file of the write is gone.
  expect(readdirSync(drafts(at))).toEqual(["workflow-build-and-review.json"]);
});

test.skipIf(process.platform === "win32")("the drafts folder and its files are for the user alone", () => {
  const at = state();
  ok(saveDraft(at, "w", sample(), null));
  expect(statSync(drafts(at)).mode & 0o777).toBe(0o700);
  expect(statSync(join(drafts(at), "workflow-w.json")).mode & 0o777).toBe(0o600);
});

test("the last save wins, and says when it replaced a version other than the one it names", () => {
  const at = state();
  const first = ok(saveDraft(at, "w", sample(), null));
  const second = ok(saveDraft(at, "w", { ...sample(), metadata: { ...sample().metadata, name: "Two" } }, first.hash));
  expect(second.overwrote).toBe(false);
  // Another tab saves on top of `first`, which it saw last, while `second` is the current version.
  const other = ok(saveDraft(at, "w", sample(), first.hash));
  expect(other.overwrote).toBe(true);
  expect(ok(saveDraft(at, "w", sample(), null)).overwrote).toBe(true);
  expect(ok(readDraft(at, "w")).workflow).toEqual(sample());
});

test("a save is refused for no workflow, a value nested too deep, or a file over the limit", () => {
  const at = state();
  expect(refused(saveDraft(at, "w", { ...sample(), nodes: [] }, null))).toMatchObject({ code: "document.invalid" });
  let deep: unknown = "x";
  for (let level = 0; level < 2000; level += 1) deep = [deep];
  const nested = { ...sample(), metadata: { ...sample().metadata, deep } };
  expect(refused(saveDraft(at, "w", nested, null))).toMatchObject({ code: "document.invalid" });
  const big = { ...sample(), metadata: { ...sample().metadata, notes: "x".repeat(DRAFT_LIMIT) } };
  expect(refused(saveDraft(at, "w", big, null))).toMatchObject({
    code: "draft.too-large",
    params: { id: "w", limit: DRAFT_LIMIT },
  });
  // A draft holds the workflow of its own id only.
  expect(refused(saveDraft(at, "foo", sample(), null))).toEqual(otherId);
  expect(listDrafts(at)).toEqual([]);
});

test("a draft that is missing, over the limit, not JSON, no workflow or no file is refused with its finding", () => {
  const at = state();
  mkdirSync(drafts(at), { recursive: true });
  const put = (id: string, text: string): void => writeFileSync(join(drafts(at), `workflow-${id}.json`), text);
  put("big", " ".repeat(DRAFT_LIMIT + 1));
  put("text", "not json");
  put("old", JSON.stringify({ ...sample(), schemaVersion: 2 }));
  put("odd", JSON.stringify({ ...sample(), kind: "other" }));
  put("foo", JSON.stringify(sample()));
  mkdirSync(join(drafts(at), "workflow-folder.json"));
  expect(refused(readDraft(at, "none"))).toEqual({ code: "draft.not-found", params: { id: "none" } });
  expect(refused(readDraft(at, "big"))).toEqual({
    code: "draft.too-large",
    params: { id: "big", bytes: DRAFT_LIMIT + 1, limit: DRAFT_LIMIT },
  });
  expect(refused(readDraft(at, "text"))).toEqual({
    code: "document.invalid",
    params: { issues: [{ path: "", code: "invalid_json" }] },
  });
  expect(refused(readDraft(at, "old"))).toMatchObject({ code: "document.newer-schema" });
  expect(refused(readDraft(at, "odd"))).toMatchObject({ code: "document.invalid" });
  expect(refused(readDraft(at, "foo"))).toEqual(otherId);
  expect(refused(readDraft(at, "folder"))).toEqual({
    code: "document.unreadable",
    params: { path: join("drafts", "workflow-folder.json"), error: "EISDIR" },
  });
});

test("the list holds the drafts' files only, newest first, and a delete removes one", () => {
  const at = state();
  ok(saveDraft(at, "older", sample("older"), null));
  ok(saveDraft(at, "newer", sample("newer"), null));
  utimesSync(join(drafts(at), "workflow-older.json"), new Date("2026-01-01"), new Date("2026-01-01"));
  // Neither a temporary file, a file of another name nor a folder is a draft.
  writeFileSync(join(drafts(at), ".workflow-x.json.cedarloom-1-0"), "{}");
  writeFileSync(join(drafts(at), "notes.txt"), "");
  mkdirSync(join(drafts(at), "workflow-folder.json"));
  expect(listDrafts(at).map((draft) => draft.id)).toEqual(["newer", "older"]);
  expect(ok(deleteDraft(at, "Newer"))).toBeNull();
  expect(refused(deleteDraft(at, "newer"))).toEqual({ code: "draft.not-found", params: { id: "newer" } });
  expect(listDrafts(at).map((draft) => draft.id)).toEqual(["older"]);
  // Other errors of the file system are no finding: they go up to the caller (the server logs them).
  expect(() => deleteDraft(at, "folder")).toThrow(/EISDIR|EPERM/);
  const flat = state();
  mkdirSync(flat, { recursive: true });
  writeFileSync(join(flat, "drafts"), "");
  expect(() => listDrafts(flat)).toThrow(/ENOTDIR/);
  // An id that is no workflow id names no file, inside the folder or outside it.
  for (const id of ["../runs", "a/b", "", "1x", "\u212a"]) {
    expect(() => readDraft(at, id)).toThrow(/not a workflow id/);
  }
  expect(() => saveDraft(at, "..", sample(), null)).toThrow(/not a workflow id/);
});
