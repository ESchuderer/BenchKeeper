import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { repositoryOf } from "@cedarloom/git";

// GitHub's Windows runners keep os.tmpdir() on the slow system drive.
const root = mkdtempSync(join(process.env["RUNNER_TEMP"] ?? tmpdir(), "cedarloom-repository-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("a .git file over 1 MiB is no link to a worktree's git folder, as git reads it: the parent repository counts", () => {
  const repository = join(root, "repository");
  const nested = join(repository, "unpacked");
  mkdirSync(join(repository, ".git"), { recursive: true });
  mkdirSync(nested);
  writeFileSync(join(nested, ".git"), `gitdir: ${join(root, "elsewhere")}\n${"x".repeat(1024 * 1024)}`);
  const gitDir = join(repository, ".git");
  expect(repositoryOf(nested)).toEqual({ root: repository, gitDir, common: gitDir });
});
