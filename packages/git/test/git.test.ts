import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Result } from "@cedarloom/contracts";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import {
  type FetchOptions,
  fetchTree,
  fetchTreeOver,
  type Limits,
  type Source,
  type Tree,
  worktreeOf,
} from "@cedarloom/git";

// GitHub's Windows runners keep os.tmpdir() on the slow system drive.
const root = mkdtempSync(join(process.env["RUNNER_TEMP"] ?? tmpdir(), "cedarloom-git-"));
// The fixtures are local repositories, so the tests let git fetch over file:// too; `fetchTree` never does.
const fetchLocal = fetchTreeOver(["https", "ssh", "file"]);

afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const git = (cwd: string, args: string[], input?: string): string =>
  execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.org", ...args], {
    cwd,
    input,
    encoding: "utf8",
  }).trim();

type Entry = string | { mode: "100755" | "120000"; content: string } | { submodule: string };

// `<mode> <type> <object>` of a tree entry.
const object = (dir: string, entry: Entry): string => {
  if (typeof entry === "string") return `100644 blob ${git(dir, ["hash-object", "-w", "--stdin"], entry)}`;
  if ("submodule" in entry) return `160000 commit ${entry.submodule}`;
  return `${entry.mode} blob ${git(dir, ["hash-object", "-w", "--stdin"], entry.content)}`;
};

// A tree of the entries by their paths' parts, written level by level with mktree, which takes any name: the index,
// which Git for Windows guards, would refuse a control character. --missing lets a submodule name a foreign commit.
const mktree = (dir: string, entries: [string[], Entry][]): string => {
  const folders = Map.groupBy(
    entries.filter(([parts]) => parts.length > 1),
    ([[folder = ""]]) => folder,
  );
  const lines = [
    ...entries.filter(([parts]) => parts.length === 1).map(([[name], entry]) => `${object(dir, entry)}\t${name}`),
    ...[...folders].map(([name, inner]) => {
      const sub = mktree(
        dir,
        inner.map(([[, ...rest], entry]) => [rest, entry]),
      );
      return `040000 tree ${sub}\t${name}`;
    }),
  ];
  return git(dir, ["mktree", "-z", "--missing"], lines.map((line) => `${line}\0`).join(""));
};

/** A repository whose `main` and tag `v1` hold exactly `files`, built from objects: no file system links needed. */
const source = (files: Record<string, Entry>): { url: string; commit: string; dir: string } => {
  const dir = mkdtempSync(join(root, "source-"));
  git(dir, ["init", "--quiet"]);
  const top = mktree(
    dir,
    Object.entries(files).map(([path, entry]) => [path.split("/"), entry]),
  );
  const commit = git(dir, ["commit-tree", "-m", "fixture", top]);
  git(dir, ["update-ref", "refs/heads/main", commit]);
  git(dir, ["tag", "v1", commit]);
  return { url: pathToFileURL(dir).href, commit, dir };
};

const parent = (): string => mkdtempSync(join(root, "parent-"));
const codeOf = (result: Result<unknown>): unknown => (result.ok ? "ok" : result.finding);
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const extension = source({
  "README.md": "outside the extension folder\n",
  "extension/cedarloom-extension.json": '{ "id": "acme.jira" }\n',
  "extension/dist/main.js": { mode: "100755", content: "console.log(1);\n" },
});

test("reads the files of a folder at a tag or a commit, with the commit and the digest of their listing", async () => {
  const into = parent();
  const byTag = await fetchLocal({ url: extension.url, ref: "v1", path: "extension" }, { parent: into });
  const byCommit = await fetchLocal({ url: extension.url, ref: extension.commit, path: "extension" }, { parent: into });
  const files: ["100644" | "100755", string, string][] = [
    ["100644", "cedarloom-extension.json", '{ "id": "acme.jira" }\n'],
    ["100755", "dist/main.js", "console.log(1);\n"],
  ];
  const listing = files.map(([mode, path, text]) => `${mode} ${sha256(text)} ${path}\n`).join("");
  const expected: Tree = {
    commit: extension.commit,
    files: files.map(([mode, path, text]) => ({ mode, path, sha256: sha256(text), content: Buffer.from(text) })),
    digest: sha256(listing),
  };
  expect([byTag, byCommit]).toEqual([
    { ok: true, value: expected },
    { ok: true, value: expected },
  ]);
  // Each quarantine is gone once the files are read.
  expect(readdirSync(into)).toEqual([]);
}, 30_000);

test("the whole tree when no folder is named, in path order", async () => {
  const tree = await fetchLocal({ url: extension.url, ref: "main" }, { parent: parent() });
  expect(tree.ok ? tree.value.files.map((file) => file.path) : tree).toEqual([
    "README.md",
    "extension/cedarloom-extension.json",
    "extension/dist/main.js",
  ]);
}, 30_000);

test("a tree with a link, a submodule, a name that is not portable or two names in different case is refused whole", async () => {
  // Beside a file main.js: the entry, the kind and the path the finding names, control characters escaped.
  const trees: [Entry, string, string, string][] = [
    [{ mode: "120000", content: "../../.ssh/id_ed25519" }, "dir/x", "link", "dir/x"],
    [{ submodule: extension.commit }, "dir/x", "submodule", "dir/x"],
    ["text", "dir/a file.txt", "name", "dir/a file.txt"],
    ["text", "ok\u001b[2K\rall-verified.txt", "name", "ok\\u001b[2K all-verified.txt"],
    // Letters of any language stay; a bidirectional control is escaped.
    ["text", "日\u202Eb.txt", "name", "日\\u202eb.txt"],
    ["text", "Main.js", "case", "main.js"],
    ["text", "MAIN.js/x", "case", "main.js"],
  ];
  const results = await Promise.all(
    trees.map(async ([entry, path]) => {
      const repo = source({ "main.js": "ok\n", [path]: entry });
      return codeOf(await fetchLocal({ url: repo.url, ref: "v1" }, { parent: parent() }));
    }),
  );
  expect(results).toEqual(trees.map(([, , kind, path]) => ({ code: "git.unsafe-entry", params: { path, kind } })));
  // A file, then a folder of the same name in another case.
  const folder = source({ X: "file", "x/y": "file in a folder" });
  expect(codeOf(await fetchLocal({ url: folder.url, ref: "v1" }, { parent: parent() }))).toEqual({
    code: "git.unsafe-entry",
    params: { path: "x/y", kind: "case" },
  });
}, 30_000);

const many = (count: number, text = "x"): Record<string, Entry> =>
  Object.fromEntries(Array.from({ length: count }, (_, index) => [`file-${index}.txt`, text]));

test("a tree over a limit is refused whole: files, one file's bytes, all bytes, and a listing too long to read", async () => {
  const cases: [Record<string, Entry>, Limits, unknown][] = [
    [many(3), { files: 2, bytes: 100, fileBytes: 100 }, { path: null, found: 3, limit: 2, unit: "files" }],
    [
      many(1, "12345678901"),
      { files: 9, bytes: 100, fileBytes: 10 },
      { path: "file-0.txt", found: 11, limit: 10, unit: "bytes" },
    ],
    [many(2, "123456"), { files: 9, bytes: 10, fileBytes: 10 }, { path: null, found: 12, limit: 10, unit: "bytes" }],
  ];
  const results = await Promise.all(
    cases.map(async ([files, limits]) =>
      codeOf(await fetchLocal({ url: source(files).url, ref: "v1" }, { parent: parent(), limits })),
    ),
  );
  expect(results).toEqual(cases.map(([, , params]) => ({ code: "git.too-large", params })));
  const listing = await fetchLocal(
    { url: source(many(40)).url, ref: "v1" },
    { parent: parent(), limits: { files: 1, bytes: 9, fileBytes: 9 } },
  );
  expect(codeOf(listing)).toEqual({ code: "git.failed", params: { step: "list", error: "output over 2400 bytes" } });
}, 30_000);

test("a fetch that brings far more than the folder may hold is refused, also when the bulk lies outside the folder", async () => {
  const bulky = source({ "extension/a.txt": "a", "big.bin": randomBytes(2_400_000).toString("base64") });
  const limits = { files: 9, bytes: 1000, fileBytes: 1000 };
  const tree = await fetchLocal({ url: bulky.url, ref: "v1", path: "extension" }, { parent: parent(), limits });
  expect(codeOf(tree)).toEqual({
    code: "git.too-large",
    params: { path: null, found: expect.any(Number), limit: 2000 + 1024 * 1024, unit: "bytes" },
  });
}, 30_000);

test("a source is refused before git runs: a password, a space, an option, refspec syntax, a path out or not portable", async () => {
  const into = parent();
  const urls = [
    "https://bot:token@git.example.org/acme/jira.git",
    "https://git.example.org/a b.git",
    "-oProxyCommand=x",
    "https://git.example.org/acme/jira.git?access_token=x",
    "https://git.example.org/acme/jira.git#x",
    // A carriage return, encoded, reaches a credential helper as a new line on git without CVE-2024-52006's fix.
    "https://%0dhost=github.com@127.0.0.1:1/x",
    "https://bot@git.example.org/acme/jira.git",
    "https://git.example.org\\@127.0.0.1/acme/jira",
  ];
  const refs = ["main:refs/heads/x", "v1^{tree}", "a..b", "main.lock", "-x"];
  const paths = ["../x", ".git/hooks", "extension/.", "CON", "nul.txt", "COM0", "a.", "a\\b", "-x", "a".repeat(256)];
  const sources: [Source, string][] = [
    ...urls.map((url): [Source, string] => [{ url, ref: "v1" }, "url"]),
    ...refs.map((ref): [Source, string] => [{ url: extension.url, ref }, "ref"]),
    ...paths.map((path): [Source, string] => [{ url: extension.url, ref: "v1", path }, "path"]),
  ];
  const results = await Promise.all(sources.map(([from]) => fetchLocal(from, { parent: into })));
  expect(results.map(codeOf)).toEqual(sources.map(([, field]) => ({ code: "git.refused-source", params: { field } })));
  expect(readdirSync(into)).toEqual([]);
});

test("fetchTree takes https and ssh URLs only, by the contracts' rule, and git's messages name no URL", async () => {
  const results = await Promise.all(
    [extension.url, "ext::false", "https://127.0.0.1:1/acme/secret-token.git"].map(async (url) =>
      codeOf(await fetchTree({ url, ref: "v1" }, { parent: parent() })),
    ),
  );
  expect(results).toEqual([
    { code: "git.refused-source", params: { field: "url" } },
    { code: "git.refused-source", params: { field: "url" } },
    {
      code: "git.failed",
      params: { step: "fetch", error: expect.stringMatching(/^(?!.*secret-token).*the repository/) },
    },
  ]);
}, 30_000);

test("no hook runs, not even one the user's own configuration names, and a bare repository needs naming", async () => {
  const home = mkdtempSync(join(root, "home-"));
  const hooks = join(home, "hooks");
  const marker = join(home, "ran").replaceAll("\\", "/");
  mkdirSync(hooks);
  writeFileSync(join(hooks, "reference-transaction"), `#!/bin/sh\necho ran >> '${marker}'\n`, { mode: 0o755 });
  // A hooks folder, a hook defined by name (git 2.54 runs it whatever core.hooksPath says), and the setting that
  // refuses a bare repository found by searching.
  writeFileSync(
    join(home, ".gitconfig"),
    [
      `[core]\n\thooksPath = ${hooks.replaceAll("\\", "/")}`,
      `[hook "spy one"]\n\tevent = reference-transaction\n\tcommand = echo named >> '${marker}'`,
      `[hook "a=b"]\n\tevent = reference-transaction\n\tcommand = echo equals >> '${marker}'`,
      "[safe]\n\tbareRepository = explicit\n",
    ].join("\n"),
  );
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  // Plain git runs that hook on every ref update, and the fetch updates a ref too.
  git(extension.dir, ["update-ref", "refs/heads/hooked", extension.commit]);
  const before = existsSync(marker) ? readFileSync(marker, "utf8") : "";
  const tree = await fetchLocal({ url: extension.url, ref: "v1" }, { parent: parent() });
  expect([before.length > 0, tree.ok, readFileSync(marker, "utf8")]).toEqual([true, true, before]);
}, 30_000);

test("GIT_DIR in CedarLoom's environment does not send git to another repository", async () => {
  const other = source({ "x.txt": "x" });
  vi.stubEnv("GIT_DIR", join(other.dir, ".git"));
  const tree = await fetchLocal({ url: extension.url, ref: "v1", path: "extension" }, { parent: parent() });
  vi.unstubAllEnvs();
  expect([tree.ok, git(other.dir, ["for-each-ref", "refs/cedarloom"])]).toEqual([true, ""]);
}, 30_000);

test("git failures name their step: no git, out of time, an unknown ref, a ref to no commit, a missing folder", async () => {
  const blob = git(extension.dir, ["hash-object", "-w", "--stdin"], "a file, not a commit");
  git(extension.dir, ["tag", "blob-tag", blob]);
  const tries: [Omit<Source, "url">, Omit<FetchOptions, "parent">, string, RegExp][] = [
    [{ ref: "missing" }, {}, "fetch", /missing/],
    [{ ref: "blob-tag" }, {}, "fetch", /expected commit/],
    [{ ref: "v1", path: "nope" }, {}, "list", /nope/],
    [{ ref: "v1" }, { timeoutMs: 0 }, "start", /stopped at the time limit/],
  ];
  const results = await Promise.all(
    tries.map(async ([from, options]) =>
      codeOf(await fetchLocal({ url: extension.url, ...from }, { parent: parent(), ...options })),
    ),
  );
  const noGit = await fetchTreeOver(["file"], "no-such-git")({ url: extension.url, ref: "v1" }, { parent: parent() });
  expect([...results, codeOf(noGit)]).toEqual([
    ...tries.map(([, , step, error]) => ({
      code: "git.failed",
      params: { step, error: expect.stringMatching(error) },
    })),
    { code: "git.failed", params: { step: "start", error: expect.stringMatching(/ENOENT/) } },
  ]);
}, 30_000);

// The ext transport runs a program in git's place; this one hangs on with git's pipes after git is stopped, as ssh can.
test.skipIf(process.platform === "win32")(
  "a stopped git returns at once, though a child of it keeps its pipes open",
  async () => {
    const program = join(mkdtempSync(join(root, "hang-")), "hang.sh");
    writeFileSync(program, "#!/bin/sh\nsleep 5\n", { mode: 0o755 });
    const started = Date.now();
    const tree = await fetchTreeOver(["ext"])(
      { url: `ext::${program}`, ref: "v1" },
      { parent: parent(), timeoutMs: 500 },
    );
    expect([codeOf(tree), Date.now() - started < 3000]).toEqual([
      { code: "git.failed", params: { step: "fetch", error: "stopped at the time limit" } },
      true,
    ]);
  },
  30_000,
);

test("a worktree is added on a new branch from HEAD with no hook run, and found again; no repository is named", async () => {
  const repo = source({ "a.txt": "a" });
  git(repo.dir, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  const marker = join(repo.dir, "ran").replaceAll("\\", "/");
  mkdirSync(join(repo.dir, ".git", "hooks"), { recursive: true });
  writeFileSync(join(repo.dir, ".git", "hooks", "post-checkout"), `#!/bin/sh\necho ran > '${marker}'\n`, {
    mode: 0o755,
  });
  const path = join(parent(), "work");
  expect(await worktreeOf(repo.dir, path, "cedarloom/run-1")).toEqual({ ok: true, value: path });
  expect([
    readFileSync(join(path, "a.txt"), "utf8"),
    git(path, ["branch", "--show-current"]),
    existsSync(marker),
  ]).toEqual(["a", "cedarloom/run-1", false]);
  // The same worktree again: git lists it, so nothing is added.
  writeFileSync(join(path, "b.txt"), "b");
  expect(await worktreeOf(repo.dir, path, "cedarloom/run-1")).toEqual({ ok: true, value: path });
  expect(existsSync(join(path, "b.txt"))).toBe(true);
  // A folder in the way that is no worktree, and a folder that is no repository.
  const busy = join(parent(), "busy");
  mkdirSync(busy);
  writeFileSync(join(busy, "x.txt"), "x");
  const refused = { code: "git.failed", params: { step: "worktree" } };
  expect([
    codeOf(await worktreeOf(repo.dir, busy, "cedarloom/run-3")),
    codeOf(await worktreeOf(parent(), join(parent(), "work"), "cedarloom/run-2")),
  ]).toMatchObject([refused, refused]);
}, 30_000);

test("an add that left its branch behind, or a listed worktree whose folder is gone, is added again", async () => {
  const repo = source({ "a.txt": "a" });
  git(repo.dir, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  // `worktree add -b` makes the branch before its checkout, so a checkout that failed leaves the branch.
  git(repo.dir, ["branch", "cedarloom/run-2"]);
  const left = join(parent(), "left");
  expect(await worktreeOf(repo.dir, left, "cedarloom/run-2")).toEqual({ ok: true, value: left });
  expect(git(left, ["branch", "--show-current"])).toBe("cedarloom/run-2");
  rmSync(left, { recursive: true, force: true });
  expect(await worktreeOf(repo.dir, left, "cedarloom/run-2")).toEqual({ ok: true, value: left });
  expect(readFileSync(join(left, "a.txt"), "utf8")).toBe("a");
}, 30_000);
