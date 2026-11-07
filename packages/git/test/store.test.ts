import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Result } from "@cedarloom/contracts";
import { openStore } from "@cedarloom/git";
import { afterAll, afterEach, expect, test, vi } from "vitest";

const root = mkdtempSync(join(process.env["RUNNER_TEMP"] ?? tmpdir(), "cedarloom-store-"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

// A home folder of the test's own, whose Git configuration is `config`: store commits carry the user's identity.
const home = (config: string): void => {
  const folder = mkdtempSync(join(root, "home-"));
  writeFileSync(join(folder, ".gitconfig"), config);
  vi.stubEnv("HOME", folder);
  vi.stubEnv("XDG_CONFIG_HOME", folder);
};
const ok = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(`refused: ${result.finding.code}`);
  return result.value;
};

test("a commit stays inert until the branch moves to it, and the branch moves only from where the caller says", () => {
  // The store is SHA-1 on main whatever the user's init settings say.
  home(
    "[user]\n\tname = Ada\n\temail = ada@example.org\n[init]\n\tdefaultObjectFormat = sha256\n\tdefaultBranch = trunk\n",
  );
  const dir = join(root, "store.git");
  const store = openStore(dir);
  const { commit } = ok(store.commit(null, "workflows/workflow-w.json", "{}\n", "w 1.0.0\n"));
  const inert = store.head();
  const wrong = "1".repeat(40);
  const moved = (after: string | null, before: string | null): boolean => store.move(after, before).ok;
  const moves = [moved(commit, wrong), moved(commit, null), moved(commit, null), moved(null, null)];
  const removals = [store.head(), moved(null, wrong), moved(null, commit), store.head()];
  expect([commit.length, readFileSync(join(dir, "HEAD"), "utf8"), inert, moves, removals]).toEqual([
    40,
    "ref: refs/heads/main\n",
    null,
    [false, true, false, false],
    [commit, false, true, null],
  ]);
});

test("a commit needs the user's Git identity", () => {
  home("[user]\n\temail = ada@example.org\n");
  const store = openStore(join(root, "nameless.git"));
  expect(store.commit(null, "a.json", "{}\n", "a\n")).toEqual({
    ok: false,
    finding: { code: "store.identity-missing", params: { key: "user.name" } },
  });
});
