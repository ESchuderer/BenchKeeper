import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { repositoryOf } from "@cedarloom/git";

// GitHub's Windows runners keep os.tmpdir() on the slow system drive.
const root = mkdtempSync(join(process.env["RUNNER_TEMP"] ?? tmpdir(), "cedarloom-repository-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("a .git file over 1 MiB ends the walk as git stops there: no repository, not the parent one", () => {
  const repository = join(root, "repository");
  const nested = join(repository, "unpacked");
  mkdirSync(join(repository, ".git"), { recursive: true });
  mkdirSync(nested);
  writeFileSync(join(nested, ".git"), `gitdir: ${join(root, "elsewhere")}\n${"x".repeat(1024 * 1024)}`);
  expect(repositoryOf(nested)).toBeNull();
});
