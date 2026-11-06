import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  EXPORT_SCHEMA_VERSION,
  ExportIndex,
  LOCK_SCHEMA_VERSION,
  EXTENSION_SCHEMA_VERSION,
  ExtensionLock,
  ExtensionManifest,
  type Result,
  isExtensionType,
  readDocument,
  WorkflowDefinition,
} from "@cedarloom/contracts";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const read = async (path: string): Promise<unknown> => JSON.parse(await readFile(join(root, path), "utf8"));

// Every published document, so the extension formats' references resolve; strict mode refuses unknown keywords.
const ajv = new Ajv2020({ strict: true });
for (const name of await readdir(join(root, "schema"))) {
  ajv.addSchema(JSON.parse(await readFile(join(root, "schema", name), "utf8")));
}
const published =
  (name: string) =>
  (value: unknown): boolean =>
    ajv.getSchema(`${name}.schema.json`)?.(value) === true;

const formats: Record<string, (value: unknown) => Result<unknown>> = {
  ExtensionManifest: (value) => readDocument(ExtensionManifest, EXTENSION_SCHEMA_VERSION, value),
  ExtensionLock: (value) => readDocument(ExtensionLock, LOCK_SCHEMA_VERSION, value),
  ExportIndex: (value) => readDocument(ExportIndex, EXPORT_SCHEMA_VERSION, value),
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
const lock = await read("corpus/ExtensionLock/1/valid-pins.json");
const index = await read("corpus/ExportIndex/1/valid-export.json");

// `count` entries named `<prefix><index>`, each `value`.
const many = (count: number, value: unknown, prefix = "a"): Record<string, unknown> =>
  Object.fromEntries(Array.from({ length: count }, (_, at) => [`${prefix}${at}`, value]));

// A copy of `value` with the value at `path` replaced; missing objects on the way are created.
const set = (value: unknown, path: (string | number)[], next: unknown): unknown => {
  const [key, ...rest] = path;
  if (key === undefined) return next;
  const copy: unknown = structuredClone(value ?? {});
  if (typeof copy !== "object" || copy === null) throw new Error(`no object at ${key}`);
  return Object.assign(copy, { [key]: set(Reflect.get(copy, key), rest, next) });
};

const search = ["contributes", "actions", "search-issues"];
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
  [
    "a credential host outside net",
    ["capabilities", "credentials", "jira-token", "hosts"],
    ["https://x.example"],
    false,
    "capabilities.credentials.jira-token.hosts.0",
  ],
  [
    "a remote $ref",
    [...search, "config", "properties", "query", "$ref"],
    "https://x.example/s.json",
    false,
    "contributes.actions.search-issues.config",
  ],
  [
    "a remote $ref under a property named $ref",
    [...search, "config", "properties", "$ref"],
    { $ref: "https://x.example/s.json" },
    false,
    "contributes.actions.search-issues.config",
  ],
  [
    "a remote $dynamicRef",
    [...search, "config", "$dynamicRef"],
    "https://x.example/s",
    false,
    "contributes.actions.search-issues.config",
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
    "another meta-schema",
    [...search, "config", "$schema"],
    "https://x.example/meta",
    false,
    "contributes.actions.search-issues.config",
  ],
  [
    "an $id",
    [...search, "config", "$defs", "jql", "$id"],
    "ExtensionManifest.schema.json",
    false,
    "contributes.actions.search-issues.config",
  ],
  ["an output named done", [...report, "outputs", "done"], { type: "string" }, true],
  ["an input named run", [...report, "inputs", "run"], { type: "string" }, true],
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
  // The engine reserves the built-in namespaces for its own node types.
  ["an id in a built-in namespace", ["id"], "trigger.acme", true],
  ["an id in the join namespace", ["id"], "join.x", true],
  // Nor does an extension pass for first-party.
  ["an id of the cedarloom publisher", ["id"], "cedarloom.jira", true],
  ["a protocol version with a patch", ["api"], "1.0.0", true],
  ["a catalog that is no PO file", ["catalogs", "de"], "locales/de/messages.json", true],
];

const lockChanges: Change[] = [
  ["a password in the URL", [...jira, "source", "git"], "https://bot:secret@git.example.org/acme/jira.git", false],
  ["a user over https", [...jira, "source", "git"], "https://bot@git.example.org/acme/jira.git", false],
  ["a local repository", [...jira, "source", "git"], "file:///srv/jira.git", true],
  ["a query in a user@host:path URL", [...jira, "source", "git"], "git@git.example.org:acme/jira.git?t=x", false],
  // The URL parser reads the backslash as "/" and sees no user; git sees user "git.example.org\\" and its password.
  ["a backslash before a password", [...jira, "source", "git"], "https://git.example.org\\:secret@127.0.0.1:1/a", true],
  ["an empty user over https", [...jira, "source", "git"], "https://@git.example.org/acme/jira.git", false],
  ["an encoded line break", [...jira, "source", "git"], "https://git.example.org/acme/jira%0d%0ahost=x", false],
  ["501 extensions", ["extensions"], many(501, ExtensionLock.parse(lock).extensions["acme.jira"], "acme.p"), true],
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
];

const indexChanges: Change[] = [
  ["a workflow twice in another case", ["workflows"], ["nightly-report", "Nightly-Report"], false],
  ["a workflow twice", ["workflows"], ["nightly-report", "nightly-report"], true],
  ["no workflow", ["workflows"], [], true],
  ["a blank license", ["license"], " ", true],
];

describe.each([
  ["ExtensionManifest", manifest, manifestChanges],
  ["ExtensionLock", lock, lockChanges],
  ["ExportIndex", index, indexChanges],
] as const)("%s refuses one change to a valid file", (name, valid, changes) => {
  test.for(changes)("%s", ([, path, value, schemaToo, issue = path.join(".")]) => {
    const changed = set(valid, path, value);
    const result = formats[name]?.(changed) ?? { ok: true, value };
    // A value can break a pattern and a refinement at once: one path, two issues.
    expect([[...new Set(issuePaths(result))], published(name)(changed)]).toEqual([[issue], !schemaToo]);
  });
});

const git = (url: string): boolean => ExtensionLock.safeParse(set(lock, [...jira, "source", "git"], url)).success;

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

test("each action's configuration schema compiles in Ajv's strict mode, and checks a node's `with`", async () => {
  const parsed = ExtensionManifest.parse(manifest);
  const config = parsed.contributes.actions["search-issues"]?.config ?? {};
  const check = ajv.compile(config);
  expect([check({ query: "project = X", limit: 5 }), check({ query: "" }), check({ limit: 5 })]).toEqual([
    true,
    false,
    false,
  ]);
});

test("a configuration schema may refer to itself, name the 2020-12 meta-schema, hold keywords as data, or be a boolean", () => {
  const config = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      $id: { type: "string" },
      $ref: { type: "string" },
      child: { $ref: "" },
      ticket: { const: { $id: "ticket-1" }, default: { $ref: "x" }, examples: [{ $schema: "y" }] },
      kind: { enum: [{ $id: "a" }] },
    },
  };
  const taken = [config, true, false].map((value) =>
    ExtensionManifest.safeParse(set(manifest, [...search, "config"], value)),
  );
  expect([...taken.map((result) => result.success), ajv.compile(config)({ $id: "x", child: {} })]).toEqual([
    true,
    true,
    true,
    true,
  ]);
});

test("a foreign keyword is found in a subschema whatever the property is called, and in lists of subschemas", () => {
  const configs = [
    { properties: { const: { $ref: "https://x.example/s.json" } } },
    { $defs: { enum: { $id: "other" } } },
    { allOf: [{ type: "string" }, { $ref: "https://x.example/s.json" }] },
    { items: { $schema: "https://x.example/meta" } },
  ];
  expect(
    configs.map((config) => ExtensionManifest.safeParse(set(manifest, [...search, "config"], config)).success),
  ).toEqual([false, false, false, false]);
});

// Every keyword of JSON Schema 2020-12 and draft 7 that holds a subschema, as Ajv compiles them: a map of names to
// schemas (where a property may be named like a data keyword), one schema, or a list of them.
const maps = ["properties", "patternProperties", "dependentSchemas", "dependencies", "$defs", "definitions"];
const single = [
  "additionalProperties",
  "items",
  "additionalItems",
  "contains",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
  "unevaluatedItems",
  "unevaluatedProperties",
  "contentSchema",
];
const lists = ["allOf", "anyOf", "oneOf", "prefixItems"];

test("a reference out of the schema is found under every keyword that holds a subschema", () => {
  // A relative `$ref` resolves into a schema the host registered; a property named const looks like data.
  const ref = { $ref: "host-secret.json" };
  const configs = [
    ...maps.flatMap((keyword) => [{ [keyword]: { const: ref } }, { [keyword]: { default: { $id: "x.json" } } }]),
    ...single.map((keyword) => ({ [keyword]: ref })),
    ...lists.map((keyword) => ({ [keyword]: [{ type: "string" }, ref] })),
  ];
  const taken = configs.filter(
    (config) => ExtensionManifest.safeParse(set(manifest, [...search, "config"], config)).success,
  );
  expect([configs.length, taken]).toEqual([2 * maps.length + single.length + lists.length, []]);
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

test("a node type names an extension action by the manifest's own rules: an extension id, a slash, an action name", () => {
  const types = [
    "acme.jira/search",
    "acme.jira",
    "trigger.acme/go",
    "acme.jira/Search",
    "acme.jira/search/x",
    "/search",
  ];
  expect(types.map(isExtensionType)).toEqual([true, false, false, false, false, false]);
});
