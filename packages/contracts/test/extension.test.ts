import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  EXPORT_SCHEMA_VERSION,
  ExportIndex,
  EXTENSION_SCHEMA_VERSION,
  ExtensionManifest,
  ExtensionUpdates,
  formatInstalled,
  INSTALLED_SCHEMA_VERSION,
  InstalledExtensions,
  PACK_SCHEMA_VERSION,
  PackManifest,
  ProfileSelection,
  readDocument,
  readProfile,
  type Result,
  SELECTION_SCHEMA_VERSION,
  UPDATES_SCHEMA_VERSION,
  WorkflowDefinition,
} from "@cedarloom/contracts";
import { describe, expect, test } from "vitest";
import { published, set } from "./published.ts";

const root = join(import.meta.dirname, "..");
const read = async (path: string): Promise<unknown> => JSON.parse(await readFile(join(root, path), "utf8"));

const formats: Record<string, (value: unknown) => Result<unknown>> = {
  ExtensionManifest: (value) => readDocument(ExtensionManifest, EXTENSION_SCHEMA_VERSION, value),
  ExportIndex: (value) => readDocument(ExportIndex, EXPORT_SCHEMA_VERSION, value),
  InstalledExtensions: (value) => readDocument(InstalledExtensions, INSTALLED_SCHEMA_VERSION, value),
  ExtensionUpdates: (value) => readDocument(ExtensionUpdates, UPDATES_SCHEMA_VERSION, value),
  PackManifest: (value) => readDocument(PackManifest, PACK_SCHEMA_VERSION, value),
  CedarLoomProfile: readProfile,
  ProfileSelection: (value) => readDocument(ProfileSelection, SELECTION_SCHEMA_VERSION, value),
};

const issuePaths = (result: Result<unknown>): string[] =>
  !result.ok && result.finding.code === "document.invalid"
    ? result.finding.params.issues.map((issue) => issue.path)
    : [];

describe.each(Object.keys(formats))(
  "golden corpus of %s: the zod schema and the published document agree",
  async (name) => {
    const files = (await readdir(join(root, "corpus", name), { recursive: true })).filter((file) =>
      file.endsWith(".json"),
    );
    test.each(files)("%s", async (file) => {
      const value = await read(`corpus/${name}/${file}`);
      const result = formats[name]?.(value);
      const newer = !file.startsWith("1");
      expect([result?.ok ? "ok" : result?.finding.code, published(name)(value)]).toEqual(
        newer ? ["document.newer-schema", false] : ["ok", true],
      );
    });
  },
);

const manifest = await read("corpus/ExtensionManifest/1/valid-full.json");
const index = await read("corpus/ExportIndex/1/valid-export.json");

// `count` entries named `<prefix><index>`, each `value`.
const many = (count: number, value: unknown, prefix = "a"): Record<string, unknown> =>
  Object.fromEntries(Array.from({ length: count }, (_, at) => [`${prefix}${at}`, value]));

const credential = ["capabilities", "credentials", "jira-token"];
const report = ["contributes", "actions", "write-report"];
const jira = ["extensions", "acme.jira"];

/**
 * One change to a valid file: where it goes, the value, whether the published JSON Schema refuses it too, and the issue
 * path zod reports when it is not the changed path. Refinements are rules a JSON Schema can't state; their descriptions
 * say them.
 */
type Change = [label: string, path: (string | number)[], value: unknown, schemaToo: boolean, issue?: string];

const manifestChanges: Change[] = [
  ["a command that is none of its actions", ["contributes", "commands"], ["status"], false],
  ["a command twice", ["contributes", "commands"], ["search-issues", "search-issues"], true],
  [
    "a credential host outside net",
    ["capabilities", "credentials", "jira-token", "hosts"],
    ["https://x.example"],
    false,
    "capabilities.credentials.jira-token.hosts.0",
  ],
  ["a credential without its scheme", [...credential, "scheme"], undefined, true],
  [
    "a credential in the query",
    [...credential, "scheme"],
    { type: "apiKey", in: "query", name: "token" },
    true,
    "capabilities.credentials.jira-token.scheme.in",
  ],
  [
    "a credential header that frames the request",
    [...credential, "scheme"],
    { type: "apiKey", in: "header", name: "Content-Length" },
    false,
    "capabilities.credentials.jira-token.scheme.name",
  ],
  [
    "a credential header asking for coded answers",
    [...credential, "scheme"],
    { type: "apiKey", in: "header", name: "Accept-Encoding" },
    false,
    "capabilities.credentials.jira-token.scheme.name",
  ],
  [
    "a credential header for a proxy (hop by hop)",
    [...credential, "scheme"],
    { type: "apiKey", in: "header", name: "Proxy-Authorization" },
    false,
    "capabilities.credentials.jira-token.scheme.name",
  ],
  ["101 actions", ["contributes", "actions"], many(101, { title: "x" }), true],
  ["33 outputs", [...report, "outputs"], many(33, { type: "string" }), true],
  ["a host with a path", ["capabilities", "net", 1], "https://api.acme.example/v2", true],
  ["a host over http", ["capabilities", "net", 1], "http://api.acme.example", true],
  ["a host in upper case", ["capabilities", "net", 1], "https://API.acme.example", true],
  ["a host with its default port", ["capabilities", "net", 1], "https://acme.atlassian.net:443", false],
  ["a host in hexadecimal", ["capabilities", "net", 1], "https://0x7f.1", false],
  ["a host twice", ["capabilities", "net", 1], "https://acme.atlassian.net", true, "capabilities.net"],
  ["an entry outside the folder", ["runtime", "entry"], "../main.js", true],
  ["an entry that is no script", ["runtime", "entry"], "dist/main.ts", true],
  ["a WebAssembly runtime", ["runtime", "kind"], "wasm", true],
  ["hooks (A30)", ["hooks"], { preRun: "x" }, true],
  ["no action", ["contributes", "actions"], {}, true],
  ["an id in upper case", ["id"], "Acme.jira", true],
  ["an id without publisher", ["id"], "jira", true],
  // An id never reads like a built-in node type's namespace.
  ["an id in a built-in namespace", ["id"], "trigger.acme", true],
  ["an id in the join namespace", ["id"], "join.x", true],
  ["a protocol version with a patch", ["api"], "1.0.0", true],
  // A program is found on PATH or in the user's home folder, never outside it or by a path that leads out.
  ...["/usr/bin/tool", "~/../tool"].map((found): Change => {
    const label = found.startsWith("~")
      ? "a program by a path out of the home folder"
      : "a program by an absolute path";
    return [
      label,
      ["capabilities", "programs", "tool"],
      { linux: [found] },
      true,
      "capabilities.programs.tool.linux.0",
    ];
  }),
  ["a catalog that is no PO file", ["catalogs", "de"], "locales/de/messages.json", true],
];

const installed = await read("corpus/InstalledExtensions/1/valid-installed.json");
const installedChanges: Change[] = [
  ["a password in the URL", [...jira, "source", "git"], "https://bot:secret@git.example.org/acme/jira.git", false],
  ["a user over https", [...jira, "source", "git"], "https://bot@git.example.org/acme/jira.git", false],
  ["a local repository", [...jira, "source", "git"], "file:///srv/jira.git", true],
  ["a query in a user@host:path URL", [...jira, "source", "git"], "git@git.example.org:acme/jira.git?t=x", false],
  // The URL parser reads the backslash as "/" and sees no user; git sees user "git.example.org\\" and its password.
  ["a backslash before a password", [...jira, "source", "git"], "https://git.example.org\\:secret@127.0.0.1:1/a", true],
  ["an empty user over https", [...jira, "source", "git"], "https://@git.example.org/acme/jira.git", false],
  ["an encoded line break", [...jira, "source", "git"], "https://git.example.org/acme/jira%0d%0ahost=x", false],
  [
    "501 extensions",
    ["extensions"],
    many(501, InstalledExtensions.parse(installed).extensions["acme.jira"], "acme.p"),
    true,
  ],
  ["a branch for a commit", [...jira, "source", "commit"], "main", true],
  ["a path outside the repository", [...jira, "source", "path"], "../other", false],
  ["a path into .git", [...jira, "source", "path"], "extensions/.git", false],
  ["a path to a Windows device", [...jira, "source", "path"], "extensions/COM1", false],
  ["a path spelled with ./", [...jira, "source", "path"], "./extensions", false],
  ["a path ending in /", [...jira, "source", "path"], "extensions/", true],
  [
    "a digest in upper case",
    [...jira, "digest"],
    "3F0C6D1E2B4A59687A8B9C0D1E2F30415263748596A7B8C9D0E1F2031425364A",
    true,
  ],
  ["a ref with refspec syntax", [...jira, "ref"], "main:refs/heads/x", true],
  ["a ref that climbs", [...jira, "ref"], "release/../main", false],
  ["a ref git keeps for a lock", [...jira, "ref"], "release.lock", false],
  ["a consent that is no hash", [...jira, "consented"], "all", true],
  ["no consent", [...jira, "consented"], undefined, true],
];

test("the installed extensions are written in one form, extensions by id, and read back as they were", () => {
  const parsed = InstalledExtensions.parse(installed);
  const reversed = { ...parsed, extensions: Object.fromEntries(Object.entries(parsed.extensions).toReversed()) };
  const text = formatInstalled(reversed);
  expect([Object.keys(JSON.parse(text).extensions), JSON.parse(text), text.endsWith("}\n")]).toEqual([
    ["acme.jira", "acme.tools"],
    installed,
    true,
  ]);
});

const indexChanges: Change[] = [
  ["a workflow twice in another case", ["workflows"], ["nightly-report", "Nightly-Report"], false],
  ["a workflow twice", ["workflows"], ["nightly-report", "nightly-report"], true],
  ["no workflow", ["workflows"], [], true],
  ["a blank license", ["license"], " ", true],
];

const pack = await read("corpus/PackManifest/1/valid-full.json");
const pinned = ["entries", "skills/browser-checks", "source"];
const packChanges: Change[] = [
  // A key is checked for "..", which its pattern lets through, as every portable path is.
  ["an entry outside the pack folder", ["entries", "../rules/ui.md"], { kind: "rules" }, false],
  ["an entry by an absolute path", ["entries", "/etc/ui.md"], { kind: "rules" }, true],
  ["a rules text that is no Markdown", ["entries", "rules/ui.txt"], { kind: "rules" }, false],
  ["a profile that is no JSON", ["entries", "profiles/web.yaml"], { kind: "profile" }, false],
  ["a skill folder that is no skill name", ["entries", "skills/Frontend_Design"], { kind: "skill" }, false],
  ["a skill name with two hyphens in a row", ["entries", "skills/frontend--design"], { kind: "skill" }, false],
  ["a pinned skill without its digest", [...pinned, "digest"], undefined, true, pinned.join(".")],
  ["a pinned skill that also follows a branch", [...pinned, "ref"], "main", true, pinned.join(".")],
  ["a pin by a short commit", [...pinned, "commit"], "9b2e4c1", true],
  [
    "a commit followed as if it were a branch",
    ["entries", "skills/frontend-design", "source", "ref"],
    "9b2e4c1f0a8d7e6b5c4a3f2e1d0c9b8a7f6e5d4c",
    true,
  ],
  [
    "a Git source for a rules text",
    ["entries", "rules/ui.md", "source"],
    { git: "https://x.example/a.git", ref: "main" },
    true,
  ],
  ["an entry twice in another case", ["entries", "rules/UI.md"], { kind: "rules" }, false],
  ["an entry inside another entry's folder", ["entries", "skills/designing-uis/extra.md"], { kind: "rules" }, false],
  ["a skill name twice", ["entries", "more/designing-uis"], { kind: "skill" }, false],
  ["an entry on the manifest's own path", ["entries", "cedarloom-pack.json"], { kind: "profile" }, false],
  ["no entry", ["entries"], {}, true],
  ["an id without publisher", ["id"], "frontend", true],
  ["no minApp", ["minApp"], undefined, true],
];

describe.each([
  ["ExtensionManifest", manifest, manifestChanges],
  ["ExportIndex", index, indexChanges],
  ["InstalledExtensions", installed, installedChanges],
  ["PackManifest", pack, packChanges],
] as const)("%s refuses one change to a valid file", (name, valid, changes) => {
  test.for(changes)("%s", ([, path, value, schemaToo, issue = path.join(".")]) => {
    const changed = set(valid, path, value);
    const result = formats[name]?.(changed) ?? { ok: true, value };
    // A value can break a pattern and a refinement at once: one path, two issues.
    expect([[...new Set(issuePaths(result))], published(name)(changed)]).toEqual([[issue], !schemaToo]);
  });
});

const git = (url: string): boolean =>
  InstalledExtensions.safeParse(set(installed, [...jira, "source", "git"], url)).success;

test("Git URLs over https and ssh, without a password, an option or a character a terminal or helper reads", () => {
  const taken = [
    "https://github.com/acme/jira.git",
    "https://git.example.org:8443/acme/jira",
    "https://GitHub.com/acme/jira.git",
    "ssh://git@github.com/acme/jira.git",
    "ssh://github.com:2222/acme/jira",
    "git@github.com:acme/jira.git",
    "deploy_key.1@git.example.org:/srv/jira.git",
    "ssh://git@GitHub.com/acme/jira.git",
    "https://dev.azure.com/acme/My%20Project/_git/jira",
  ];
  const refusedUrls = [
    "http://github.com/acme/jira",
    "HTTPS://github.com/acme/jira",
    "file:///srv/jira.git",
    "/srv/jira.git",
    "ext::sh -c touch% /tmp/x",
    "ssh://git:secret@github.com/acme/jira",
    "ssh://-oProxyCommand=touch/acme/jira",
    "-oProxyCommand=touch@github.com:acme/jira",
    "-oX@github.com:acme/jira",
    "git@-oX:acme/jira",
    "git@github.com:-u",
    "https://github.com/",
    "https://github.com/acme/jira?x=1",
    "https://github.com/acme/jira#main",
    "https://github.com/acme/jira\r\nhost=x",
    "https://gïthub.com/acme/jira",
    "https://[::1]/acme/jira",
    "https://git.example.org\\@127.0.0.1/acme/jira",
    "https://:@git.example.org/acme/jira",
    "ssh://:secret@git.example.org/acme/jira",
    "https://git.example.org/acme/jira%7f",
    "https://git.example.org/acme/j%C3%BCra",
    "git@git.example.org:acme/jira%1b[31m",
  ];
  expect([taken.filter((url) => !git(url)), refusedUrls.filter(git)]).toEqual([[], []]);
});

const licensed = (license: string): boolean =>
  WorkflowDefinition.safeParse({
    schemaVersion: 1,
    kind: "cedarloom.workflow",
    metadata: { id: "w", name: "W", version: "1.0.0", license },
    nodes: [{ id: "start", type: "trigger.manual" }],
    edges: [],
  }).success;

test("a workflow names its own license; an SPDX expression is words of its characters one space apart", () => {
  const taken = ["MIT", "MIT OR Apache-2.0", "(MIT AND BSD-3-Clause)", "DocumentRef-spdx:LicenseRef-x"];
  const refused = ["", " ", "MIT  OR Apache-2.0", " MIT", "MIT\n", "MIT/X11"];
  expect([taken.filter((license) => !licensed(license)), refused.filter(licensed)]).toEqual([[], []]);
});
