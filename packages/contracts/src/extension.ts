import { z } from "zod";
import { sortKeys } from "./json.ts";
import { NODE_CONFIGS, ProjectPath } from "./nodes.ts";
import { Sha256 } from "./plan.ts";
import { fileFormats } from "./registry.ts";
import { PlainText } from "./text.ts";
import { DataType, HandleName, JsonValue, License, semver, WorkflowId } from "./workflow.ts";

/** The extension manifest format (`cedarloom-extension.json`) this CedarLoom reads; readers refuse a newer one. */
export const EXTENSION_SCHEMA_VERSION = 1;
/** The lockfile format (`cedarloom.lock.json`) this CedarLoom writes and reads. */
export const LOCK_SCHEMA_VERSION = 1;
/** The export folder's index format (`cedarloom-export.json`) this CedarLoom writes and reads. */
export const EXPORT_SCHEMA_VERSION = 1;
/** The format of the installed extensions (`extensions.json` in the state folder) this CedarLoom writes and reads. */
export const INSTALLED_SCHEMA_VERSION = 1;
/** The format of the record of update sightings (`extension-updates.json` in the state folder). */
export const UPDATES_SCHEMA_VERSION = 1;

const unique = (items: readonly string[]): boolean => new Set(items).size === items.length;
// A list without repeats, in zod and in the JSON Schema document.
export const distinct = <T extends z.ZodType<string>>(item: T) =>
  z.array(item).refine(unique, "no entry twice").meta({ uniqueItems: true });
// The texts a manifest shows, which its catalogs translate: plain text.
export const description = PlainText.max(2000).optional();
// A record of `min` to `max` entries; zod checks it by a refinement, the JSON Schema document by these keywords.
export const sized = <T extends z.ZodType<Record<string, unknown>>>(record: T, max: number, min = 0): T =>
  record
    .refine((entries) => {
      const count = Object.keys(entries).length;
      return count >= min && count <= max;
    }, `${min} to ${max} entries`)
    .meta(min > 0 ? { minProperties: min, maxProperties: max } : { maxProperties: max });

/** An extension's id: `publisher.name` in lower case, the form of a VS Code extension id. Its actions are node types `<id>/<action>`. */
// Publishers no extension takes: the first parts of the built-in node types (trigger, agent, command, file, human,
// workflow, condition, join), so `trigger.acme/go` never counts as a trigger, and `cedarloom`, so no extension passes
// for first-party.
const RESERVED = [...new Set(Object.keys(NODE_CONFIGS).map((type) => type.split(".")[0])), "cedarloom"];
export const ExtensionId = z
  .string()
  .regex(new RegExp(`^(?!(?:${RESERVED.join("|")})\\.)[a-z][a-z0-9-]{0,63}\\.[a-z][a-z0-9-]{0,63}$`))
  .register(fileFormats, { id: "ExtensionId" });

// An action's name in its extension, lower case, so a node type `<extension id>/<action>` matches the workflow's pattern.
const ActionId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);

/**
 * Whether a node type names an extension action, `<extension id>/<action>` by the manifest's own rules, so a manifest and a
 * node type never disagree; any other type is built in or unknown.
 */
export const isExtensionType = (type: string): boolean => {
  const [extension = "", action = "", ...rest] = type.split("/");
  return rest.length === 0 && ExtensionId.safeParse(extension).success && ActionId.safeParse(action).success;
};
const CredentialId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const LanguageTag = z.string().regex(/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|[0-9]{3}))?$/);

// The URL parser decides: an origin is canonical when it is its own `origin` (lower case, no default port, no path,
// user or password), so `https://Example.com`, `https://a.com:443` and `https://0x7f.1` are refused.
const isOrigin = (value: string): boolean => URL.canParse(value) && new URL(value).origin === value;
// An https origin an extension reaches through the host; it has no network of its own (P7 a).
const Origin = z
  .string()
  .max(300)
  .regex(/^https:\/\/[a-z0-9][a-z0-9.-]*(?::[1-9][0-9]{0,4})?$/)
  .refine(isOrigin, "an https origin: lower case, no path, no default port");

/**
 * Headers neither a credential nor an extension's request sets, in lower case: those that frame the request, the
 * hop-by-hop ones of RFC 9110 section 7.6.1 (https://www.rfc-editor.org/rfc/rfc9110#section-7.6.1), which a proxy
 * reads and removes, and Accept-Encoding, since the host takes identity-coded answers only.
 */
export const FORBIDDEN_HEADERS: readonly string[] = [
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "proxy-connection",
  "te",
  "trailer",
  "upgrade",
  "proxy-authorization",
  "accept-encoding",
];

// A header the host sets for a credential.
const HeaderName = z
  .string()
  .regex(/^[A-Za-z0-9-]{1,64}$/)
  .refine((name) => !FORBIDDEN_HEADERS.includes(name.toLowerCase()), "not a header of the request's framing or coding");

// How the host adds a credential to a request, after the OpenAPI Security Scheme Object
// (https://spec.openapis.org/oas/v3.1.0#security-scheme-object), headers only: `Authorization: Bearer <value>`,
// `Authorization: Basic <user:value>` with the user part the user enters, or a header of its own. It comes from the
// manifest, never from the request, so an extension cannot place the value where a host would store and return it.
const CredentialScheme = z
  .discriminatedUnion("type", [
    z.strictObject({ type: z.literal("http"), scheme: z.enum(["bearer", "basic"]) }),
    z.strictObject({ type: z.literal("apiKey"), in: z.literal("header"), name: HeaderName }),
  ])
  .describe("The host refuses a request in which the extension sets this header itself");

// The host fetches for the extension and adds its credentials, which the extension never sees (P8 a).
const Credential = z.strictObject({
  description,
  scheme: CredentialScheme,
  hosts: distinct(Origin)
    .min(1)
    .max(32)
    .describe("The host adds the credential to requests to these hosts only; each is in `net`"),
});

// A program's name for the extension, and where the host looks for it on each platform, in order: a file name on PATH
// (on Windows its .exe or .com, which run without a shell), or `~/` and a path in the user's home folder, such as
// ~/.local/bin, which a desktop app's PATH often lacks.
const ProgramId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
// Each part of a home path starts with a letter, a digit or `_`, after one optional dot, so no part is `.` or `..`.
const Candidate = z
  .string()
  .regex(/^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,63}|~(?:\/\.?[A-Za-z0-9_][A-Za-z0-9._-]{0,63}){1,16})$/);
const candidates = z.array(Candidate).min(1).max(8);
const Program = z
  .strictObject({ darwin: candidates.optional(), linux: candidates.optional(), win32: candidates.optional() })
  .describe("Where the host looks for the program on each platform; none listed: not on that platform");

const Capabilities = z.strictObject({
  net: distinct(Origin)
    .max(32)
    .optional()
    .describe("Hosts the extension may call through the host's fetch, and no others"),
  credentials: sized(z.record(CredentialId, Credential), 16)
    .optional()
    .describe("Credential types the extension uses; it never receives their values"),
  projectRead: z.boolean().optional().describe("Reads project files through the host"),
  planWrite: z.boolean().optional().describe("Proposes file writes, which apply only through a plan the user approves"),
  programs: sized(z.record(ProgramId, Program), 8)
    .optional()
    .describe(
      "Programs the host runs for the extension (host/exec), found from these candidates; bundled extensions only",
    ),
});

const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";
// A keyword whose text would make a validator load or register a schema from elsewhere: a reference out of this
// schema, another meta-schema, or an `$id`, which could also clash with a schema of the host or of another extension.
const foreign = (key: string, item: unknown): boolean => {
  if (typeof item !== "string") return false;
  if (key === "$ref" || key === "$dynamicRef") return item !== "" && !item.startsWith("#");
  return key === "$id" || (key === "$schema" && item !== DRAFT_2020_12);
};
// Keywords whose values are data, not schemas, and keywords whose values map any names (a property called `$ref`)
// to schemas.
const LITERALS = new Set(["const", "enum", "default", "examples"]);
// `dependencies` is draft 7's, which Ajv still compiles: a map to schemas (or to lists of names, which hold no text).
const SCHEMA_MAPS = new Set([
  "properties",
  "patternProperties",
  "dependentSchemas",
  "dependencies",
  "$defs",
  "definitions",
]);
/** Whether a schema, or a list of schemas, holds a foreign keyword anywhere. */
const outside = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(outside);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(([key, item]) => {
    if (LITERALS.has(key)) return false;
    if (SCHEMA_MAPS.has(key)) return typeof item === "object" && item !== null && Object.values(item).some(outside);
    return foreign(key, item) || outside(item);
  });
};

const ExtensionAction = z.strictObject({
  title: PlainText.min(1).max(200),
  description,
  // JSON Schema 2020-12 allows `true` (any value) and `false` (none) as schemas too.
  config: z
    .union([z.boolean(), z.record(z.string(), JsonValue)])
    .refine((schema) => !outside(schema), "a schema that stays inside itself")
    .optional()
    .describe(
      "JSON Schema 2020-12 of the node's `with`: a `$ref` points inside it (`#...`), no `$id`, no other `$schema`",
    ),
  // `run` starts every action node and `done` or `failed` ends it, so data handles take other names.
  inputs: sized(
    z.record(
      HandleName.regex(/^(?!run$)/, "not `run`, the action's control input"),
      z.strictObject({ type: DataType, required: z.boolean().optional(), description }),
    ),
    32,
  ).optional(),
  outputs: sized(
    z.record(
      HandleName.regex(/^(?!(?:done|failed)$)/, "not `done` or `failed`, the action's control outputs"),
      z.strictObject({ type: DataType, description }),
    ),
    32,
  ).optional(),
});

// A credential bound to a host the extension may not reach would never be used, or widen `net` behind the user's back.
const credentialHosts = (capabilities: z.infer<typeof Capabilities> | undefined, ctx: z.RefinementCtx): void => {
  const net = new Set(capabilities?.net);
  for (const [id, credential] of Object.entries(capabilities?.credentials ?? {})) {
    credential.hosts.forEach((host, index) => {
      if (!net.has(host)) {
        ctx.addIssue({
          code: "custom",
          path: ["capabilities", "credentials", id, "hosts", index],
          message: "a host listed in `net`",
        });
      }
    });
  }
};

/**
 * An extension's manifest, `cedarloom-extension.json` at the root of its folder: what it is, the protocol version it speaks,
 * how it starts, the capabilities it asks for, and its actions. Reading it runs nothing. Hooks, triggers, providers and
 * UI contributions are no part of version 1.
 */
export const ExtensionManifest = z
  .strictObject({
    $schema: z.string().optional().describe("Where an editor finds this JSON Schema; readers ignore it"),
    schemaVersion: z.literal(EXTENSION_SCHEMA_VERSION),
    kind: z.literal("cedarloom.extension"),
    id: ExtensionId,
    version: semver,
    name: PlainText.min(1).max(200),
    description,
    license: License.optional(),
    api: z
      .string()
      .regex(/^[0-9]{1,4}\.[0-9]{1,4}$/)
      .describe("The extension protocol version it needs: the same major version, at least this minor one"),
    runtime: z.strictObject({
      kind: z.literal("node"),
      entry: ProjectPath.regex(/\.[cm]?js$/, "a .js, .mjs or .cjs file").describe(
        "The script the host starts, inside the extension's folder",
      ),
    }),
    platforms: distinct(z.enum(["darwin", "linux", "win32"]))
      .min(1)
      .optional()
      .describe("Where it runs; every platform when absent"),
    capabilities: Capabilities.optional().describe("None when absent"),
    contributes: z.strictObject({ actions: sized(z.record(ActionId, ExtensionAction), 100, 1) }),
    catalogs: sized(z.record(LanguageTag, ProjectPath.regex(/\.po$/, "a .po file")), 100)
      .optional()
      .describe("Translations of its texts by language; English is the manifest's own"),
  })
  .superRefine((manifest, ctx) => credentialHosts(manifest.capabilities, ctx))
  .describe("A CedarLoom extension manifest; readers also refuse values nested over 32 levels deep")
  .register(fileFormats, { id: "ExtensionManifest" });
export type ExtensionManifest = z.infer<typeof ExtensionManifest>;

// A name of the POSIX portable file name characters, not starting with "-", up to 255 of them; no `.git` in any case,
// nothing Windows would rename or open as a device (a trailing dot, which also refuses `.` and `..`; CON, NUL, COM0).
const portable = (part: string): boolean =>
  !/^\.git$|\.$/i.test(part) && !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part);

/**
 * A path inside a fetched tree that every platform can write, in one spelling: portable names joined by "/", no
 * empty, `.` or `..` part. Git reads and stages trees only with such names.
 */
export const PortablePath = z
  .string()
  .max(1024)
  .regex(/^[A-Za-z0-9._][A-Za-z0-9._-]{0,254}(?:\/[A-Za-z0-9._][A-Za-z0-9._-]{0,254})*$/)
  .refine((path) => path.split("/").every(portable), "no .git, no trailing dot, no Windows device name")
  .describe("Portable names joined by /: no .git, no trailing dot, no Windows device name such as CON or COM1");

// The URL forms Git fetches over https and ssh, without a password and without a character a shell, a terminal or a
// credential helper reads specially (control characters, spaces, non-ASCII); a user or host never starts with `-`,
// which ssh would read as an option.
const user = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const host = /^[a-z0-9][a-z0-9.-]*$/;
const scpLike = /^[A-Za-z0-9_][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9.-]*:(?!-)[!-~]+$/;
// Printable ASCII without a backslash, which the URL parser reads as "/" and git as part of the user or host.
const printable = /^[!-[\]-~]+$/;
// Percent-encoded control characters and bytes above ASCII: git decodes them for credential helpers and prompts.
const encodedControl = /%(?:[01][0-9a-f]|7f|[89a-f][0-9a-f])/i;
// The user part as git reads it: what comes before the last "@" of the authority.
const userInfo = (value: string): string | undefined => {
  const [authority = ""] = value.slice(value.indexOf("//") + 2).split("/");
  const at = authority.lastIndexOf("@");
  return at < 0 ? undefined : authority.slice(0, at);
};
const plain = (url: URL): boolean => host.test(url.hostname.toLowerCase()) && url.pathname.length > 1;
const isGitUrl = (value: string): boolean => {
  // A query or fragment is no part of a Git URL, and a token there would escape git's own redaction.
  if (!printable.test(value) || encodedControl.test(value) || /[?#]/.test(value)) return false;
  if (scpLike.test(value)) return true;
  // Git matches the scheme in lower case only.
  if (!/^(?:https|ssh):\/\//.test(value) || !URL.canParse(value)) return false;
  // No user over https, where it would be a credential; over ssh a user name, never a password.
  const named = userInfo(value);
  const userOk = value.startsWith("https:") ? named === undefined : named === undefined || user.test(named);
  return userOk && plain(new URL(value));
};

/**
 * A ref Git fetches as `<ref>:<local ref>`: a branch, a tag, HEAD or a commit, with no refspec syntax (`:`, `+`, `*`,
 * `^`, `~`), no `@{`, no `..` and no `.lock` at its end, which Git keeps for its lock files.
 */
export const GitRef = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/)
  .refine((ref) => !ref.includes("..") && !ref.endsWith(".lock"), "no .. and no .lock at the end");

/** Where Git fetches an extension or a workflow folder: an https or ssh URL, or `user@host:path`. */
export const GitUrl = z
  .string()
  .max(2048)
  // What a pattern can say: the scheme or user@host form, and printable ASCII without a backslash.
  .regex(/^(?:https:\/\/|ssh:\/\/|[A-Za-z0-9_][A-Za-z0-9._-]*@[A-Za-z0-9])[!-[\]-~]*$/)
  .refine(isGitUrl, "an https or ssh Git URL without a password, or user@host:path")
  .describe(
    "An https or ssh Git URL, or user@host:path; no password, no user over https, no user or host starting with -, no query or fragment, nothing percent-encoded below space or above ~",
  );

/** A pin's commit: the full hash, never a branch or tag that can move. */
export const Commit = z
  .string()
  .regex(/^[0-9a-f]{40}$/)
  .describe("The commit, never a branch or tag that can move");

/** A pin's digest: what the git package's `fetchTree` computes for a folder at a commit. */
export const FolderDigest = Sha256.describe(
  "SHA-256 of the folder's listing at the commit: per file one line `<mode> <SHA-256 of the file> <path>` ending in \\n, the mode 100644 or 100755, the path relative to the folder; the lines in the byte order of the paths",
);

const ExtensionPin = z.strictObject({
  version: semver,
  source: z.strictObject({
    git: GitUrl,
    commit: Commit,
    path: PortablePath.optional().describe("The extension's folder inside the repository; its root when absent"),
  }),
  digest: FolderDigest,
});

/**
 * The extensions a set of workflows needs, each pinned to a commit and the digest of its files (A29 b), so an import
 * fetches the code the exporter ran or refuses it. Git is the only source in 0.1.0 (P2 a).
 */
export const ExtensionLock = z
  .strictObject({
    $schema: z.string().optional().describe("Where an editor finds this JSON Schema; readers ignore it"),
    schemaVersion: z.literal(LOCK_SCHEMA_VERSION),
    kind: z.literal("cedarloom.lock"),
    extensions: sized(z.record(ExtensionId, ExtensionPin), 500),
  })
  .register(fileFormats, { id: "ExtensionLock" });
export type ExtensionLock = z.infer<typeof ExtensionLock>;

/**
 * The extensions installed on this machine, each pinned like a lock entry, with the ref an update follows and the
 * capabilities the user approved. Git is the only source in 0.1.0 (P2 a), so each is a community
 * extension: its trust comes from where its code came from, never from a field of its manifest or of this file.
 */
export const InstalledExtensions = z
  .strictObject({
    $schema: z.string().optional().describe("Where an editor finds this JSON Schema; readers ignore it"),
    schemaVersion: z.literal(INSTALLED_SCHEMA_VERSION),
    kind: z.literal("cedarloom.extensions"),
    extensions: sized(
      z.record(
        ExtensionId,
        ExtensionPin.extend({
          // The ref forms Git fetches as `<ref>:<local ref>`, as the git package checks them.
          ref: GitRef.describe("The branch or tag an update follows; HEAD for the repository's default branch"),
          consented: Sha256.describe(
            "SHA-256 of the canonical JSON of the capabilities the user approved; an update that asks for more asks again",
          ),
        }),
      ),
      500,
    ),
  })
  .register(fileFormats, { id: "InstalledExtensions" });
export type InstalledExtensions = z.infer<typeof InstalledExtensions>;

/**
 * When this machine first saw the commit now at each installed extension's ref: its update is offered 3 days later,
 * since a commit's own date is whatever its author wrote. CedarLoom's own record: one it cannot read starts every wait
 * again.
 */
export const ExtensionUpdates = z
  .strictObject({
    $schema: z.string().optional().describe("Where an editor finds this JSON Schema; readers ignore it"),
    schemaVersion: z.literal(UPDATES_SCHEMA_VERSION),
    kind: z.literal("cedarloom.extension-updates"),
    extensions: sized(
      z.record(
        ExtensionId,
        z.strictObject({
          commit: Commit,
          seen: z.iso.datetime().describe("When this machine first fetched that commit at the ref"),
        }),
      ),
      500,
    ),
  })
  .register(fileFormats, { id: "ExtensionUpdates" });
export type ExtensionUpdates = z.infer<typeof ExtensionUpdates>;

/** The file text of the installed extensions: keys sorted, two spaces, a final line break. */
export const formatInstalled = (installed: InstalledExtensions): string =>
  `${JSON.stringify(InstalledExtensions.parse(sortKeys(installed)), null, 2)}\n`;

/**
 * The index of an export folder: each workflow at `workflows/workflow-<id in lower case>.json`, named like a draft so
 * no id becomes a Windows device name, and the extensions they need in `cedarloom.lock.json` beside this file. The
 * workflow store keeps the same layout (P3 a).
 */
export const ExportIndex = z
  .strictObject({
    $schema: z.string().optional().describe("Where an editor finds this JSON Schema; readers ignore it"),
    schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
    kind: z.literal("cedarloom.export"),
    name: PlainText.min(1).max(200),
    description,
    license: License.optional().describe("The license of each workflow here that names none in its metadata"),
    workflows: z
      .array(WorkflowId)
      .min(1)
      .max(1000)
      .meta({ uniqueItems: true })
      // Workflow files are named in lower case (the drafts too), so ids that differ in case only would share a file.
      .refine((ids) => unique(ids.map((id) => id.toLowerCase())), "no workflow twice, also in another case"),
  })
  .register(fileFormats, { id: "ExportIndex" });
export type ExportIndex = z.infer<typeof ExportIndex>;
