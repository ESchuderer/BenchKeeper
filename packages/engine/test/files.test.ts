// File moves that no real filesystem in CI produces: a filesystem without hard links (FAT, some network shares), a
// rename that fails, and a file that appears at the path while recovery puts one back.
import { existsSync, linkSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import type { Operation } from "@cedarloom/contracts";
import { asidePath, recover, tempPath, writeAtomic } from "@cedarloom/engine";
import { afterEach, expect, test, vi } from "vitest";
import { hash, interruptedRun, plan, read, run, storeAt, workspace } from "./helpers.ts";

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    linkSync: vi.fn<typeof fs.linkSync>(fs.linkSync),
    renameSync: vi.fn<typeof fs.renameSync>(fs.renameSync),
  };
});
const real = await vi.importActual<typeof import("node:fs")>("node:fs");

const failure = (code: string): Error => Object.assign(new Error(code), { code });

afterEach(() => {
  vi.mocked(linkSync).mockReset().mockImplementation(real.linkSync);
  vi.mocked(renameSync).mockReset().mockImplementation(real.renameSync);
});

/** A file `a.md` with "old\n" next to a run store, and the run's own leftovers there. */
const setup = (): { root: string; state: string; path: string; leftovers: () => string[] } => {
  const { root, state, file } = workspace();
  const leftovers = (): string[] => readdirSync(root).filter((name) => name.includes(".cedarloom-"));
  return { root, state, path: file("a.md", "old\n"), leftovers };
};

const replace = (path: string): Operation => ({ kind: "write", path, before: hash("old\n"), content: "new\n" });
const target = (path: string, before: string | null): Parameters<typeof writeAtomic>[0] => ({
  path,
  before,
  temp: tempPath(path, "r", 0),
});

test("without hard links an existing file is still replaced: a rename puts the new file in once the path is free", () => {
  const { state, path, leftovers } = setup();
  vi.mocked(linkSync).mockImplementation(() => {
    throw failure("EPERM");
  });
  const store = storeAt(state);
  expect(run(store, plan(replace(path)))).toMatchObject({ status: "applied" });
  expect([read(path), leftovers()]).toEqual(["new\n", []]);
  store.close();
});

test("without hard links, a rename that cannot put the new file in puts the old one back", () => {
  const { state, path, leftovers } = setup();
  vi.mocked(linkSync).mockImplementation(() => {
    throw failure("EPERM");
  });
  vi.mocked(renameSync).mockImplementation((from, to) => {
    if (to === path && !String(from).endsWith(".old")) throw failure("EACCES");
    real.renameSync(from, to);
  });
  const store = storeAt(state);
  expect(run(store, plan(replace(path)))).toMatchObject({
    status: "failed",
    findings: [{ code: "apply.write-failed", params: { error: "EACCES" } }],
  });
  expect([read(path), leftovers()]).toEqual(["old\n", []]);
  store.close();
});

test.each(["write", "delete"])("a file the %s step cannot set aside stays in place, and the step fails", (kind) => {
  const { state, path, leftovers } = setup();
  // Windows refuses to move a file another program holds open without sharing it.
  vi.mocked(renameSync).mockImplementation((from, to) => {
    if (from === path) throw failure("EBUSY");
    real.renameSync(from, to);
  });
  const op: Operation = kind === "write" ? replace(path) : { kind: "delete", path, before: hash("old\n") };
  const store = storeAt(state);
  expect(run(store, plan(op))).toMatchObject({
    status: "failed",
    findings: [{ code: "apply.write-failed", params: { error: "EBUSY" } }],
  });
  expect([read(path), leftovers()]).toEqual(["old\n", []]);
  store.close();
});

test("recovery keeps a set-aside file next to one another process put at the empty path while it ran", () => {
  const { state, path } = setup();
  const runId = interruptedRun(state, plan(replace(path)));
  const aside = asidePath(path, runId, 0);
  real.renameSync(path, aside);
  vi.mocked(linkSync).mockImplementationOnce((_, to) => {
    writeFileSync(to, "theirs\n");
    throw failure("EEXIST");
  });
  const store = storeAt(state);
  recover(store);
  expect([read(path), read(aside)]).toEqual(["theirs\n", "old\n"]);
  store.close();
});

test("writeAtomic links a new file in, renames over one that hashes as expected, and refuses a changed one", () => {
  const { root, path, leftovers } = setup();
  const made = `${root}/made.md`;
  writeAtomic(target(made, null), "made\n", 0o600);
  writeAtomic(target(path, hash("old\n")), "new\n", undefined);
  expect([read(made), read(path)]).toEqual(["made\n", "new\n"]);
  expect(() => writeAtomic(target(path, hash("old\n")), "newer\n", undefined)).toThrow("the file changed");
  expect(() => writeAtomic(target(made, null), "again\n", undefined)).toThrow("the file changed");
  expect([read(path), existsSync(made), leftovers()]).toEqual(["new\n", true, []]);
});
