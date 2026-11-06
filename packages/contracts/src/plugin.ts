import { z } from "zod";
import { ProjectPath } from "./nodes.ts";
import { Sha256 } from "./plan.ts";
import { fileFormats } from "./registry.ts";
import { DataType, HandleName, JsonValue, semver, WorkflowId } from "./workflow.ts";

/** The plugin manifest format (`cedarloom-plugin.json`) this CedarLoom reads; readers refuse a newer one. */
export const PLUGIN_SCHEMA_VERSION = 1;
/** The lockfile format (`cedarloom.lock.json`) this CedarLoom writes and reads. */
export const LOCK_SCHEMA_VERSION = 1;
/** The export folder's index format (`cedarloom-export.json`) this CedarLoom writes and reads. */
export const EXPORT_SCHEMA_VERSION = 1;

const unique = (items: readonly string[]): boolean => new Set(items).size === items.length;
// A list without repeats, in zod and in the JSON Schema document.
const distinct = <T extends z.ZodType<string>>(item: T) =>
  z.array(item).refine(unique, "no entry twice").meta({ uniqueItems: true });
const description = z.string().max(2000).optional();
// zod checks a record's size by a refinement, which the JSON Schema document gets from this.
const atLeastOne = { minProperties: 1 };

/** A plugin's id: `publisher.name` in lower case, the form of a VS Code extension id. Its actions are node types `<id>/<action>`. */
export const PluginId = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,63}\.[a-z][a-z0-9-]{0,63}$/)
  .register(fileFormats, { id: "PluginId" });

// Lower case, so a node type `<plugin id>/<action>` matches the workflow's type pattern.
const ActionId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const CredentialId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
// SPDX license expression characters (`MIT`, `MIT OR Apache-2.0`, `LicenseRef-x`); the reader shows it, never parses it.
const License = z
  .string()
  .regex(/^[A-Za-z0-9.+() -]{1,200}$/)
  .describe("SPDX license expression");
const LanguageTag = z.string().regex(/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|[0-9]{3}))?$/);

// The URL parser decides: an origin is canonical when it is its own `origin` (lower case, no default port, no path,
// user or password), so `https://Example.com`, `https://a.com:443` and `https://0x7f.1` are refused.
const isOrigin = (value: string): boolean => URL.canParse(value) && new URL(value).origin === value;
// An https origin a plugin reaches through the host; it has no network of its own (pending owner decision).
const Origin = z
  .string()
  .max(300)
  .regex(/^https:\/\/[a-z0-9][a-z0-9.-]*(?::[1-9][0-9]{0,4})?$/)
  .refine(isOrigin, "an https origin: lower case, no path, no default port");

const Credential = z.strictObject({
  description,
  hosts: distinct(Origin)
    .min(1)
    .max(32)
    .describe("The host adds the credential to requests to these hosts only; each is in `net`"),
});

// The host fetches for the plugin and adds its credentials, which the plugin never sees (pending owner decision).

const Capabilities = z.strictObject({
  net: distinct(Origin)
    .max(32)
    .optional()
    .describe("Hosts the plugin may call through the host's fetch, and no others"),
  credentials: z
    .record(CredentialId, Credential)
    .optional()
    .describe("Credential types the plugin uses; it never receives their values"),
  projectRead: z.boolean().optional().describe("Reads project files through the host"),
  planWrite: z.boolean().optional().describe("Proposes file writes, which apply only through a plan the user approves"),
});

// A reference that leaves the document would make the validator load a schema from elsewhere. A key named `$ref`
// can also be a property's name, whose value is a schema to look into.
const remoteRef = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  Object.entries(value).some(
    ([key, item]) =>
      (["$ref", "$dynamicRef"].includes(key) && typeof item === "string" && !item.startsWith("#")) || remoteRef(item),
  );

// `run` starts every action node and `done` or `failed` ends it, so data handles take other names.
const notControl = (names: readonly string[]) => (handles: Record<string, unknown>) =>
  Object.keys(handles).every((handle) => !names.includes(handle));

const PluginAction = z.strictObject({
  title: z.string().min(1).max(200),
  description,
  config: z
    .record(z.string(), JsonValue)
    .refine((schema) => !remoteRef(schema), "a `$ref` inside this schema only (`#...`)")
    .optional()
    .describe("JSON Schema 2020-12 of the node's `with`; a `$ref` points inside it only"),
  inputs: z
    .record(HandleName, z.strictObject({ type: DataType, required: z.boolean().optional(), description }))
    .refine(notControl(["run"]), "`run` is the action's control input")
    .optional(),
  outputs: z
    .record(HandleName, z.strictObject({ type: DataType, description }))
    .refine(notControl(["done", "failed"]), "`done` and `failed` are the action's control outputs")
    .optional(),
});

// A credential bound to a host the plugin may not reach would never be used, or widen `net` behind the user's back.
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
 * A plugin's manifest, `cedarloom-plugin.json` at the root of its folder: what it is, the protocol version it speaks,
 * how it starts, the capabilities it asks for, and its actions. Reading it runs nothing. Hooks, triggers, providers and
 * UI contributions are no part of version 1.
 */
export const PluginManifest = z
  .strictObject({
    $schema: z.string().optional().describe("Where an editor finds this JSON Schema; readers ignore it"),
    schemaVersion: z.literal(PLUGIN_SCHEMA_VERSION),
    kind: z.literal("cedarloom.plugin"),
    id: PluginId,
    version: semver,
    name: z.string().min(1).max(200),
    description,
    license: License.optional(),
    api: z
      .string()
      .regex(/^[0-9]{1,4}\.[0-9]{1,4}$/)
      .describe("The plugin protocol version it needs: the same major version, at least this minor one"),
    runtime: z.strictObject({
      kind: z.literal("node"),
      entry: ProjectPath.refine((path) => /\.[cm]?js$/.test(path), "a .js, .mjs or .cjs file").describe(
        "The script the host starts, inside the plugin's folder",
      ),
    }),
    platforms: distinct(z.enum(["darwin", "linux", "win32"]))
      .min(1)
      .optional()
      .describe("Where it runs; every platform when absent"),
    capabilities: Capabilities.optional().describe("None when absent"),
    contributes: z.strictObject({
      actions: z
        .record(ActionId, PluginAction)
        .refine((actions) => Object.keys(actions).length > 0, "at least one action")
        .meta(atLeastOne),
    }),
    catalogs: z
      .record(
        LanguageTag,
        ProjectPath.refine((path) => path.endsWith(".po"), "a .po file"),
      )
      .optional()
      .describe("Translations of its texts by language; English is the manifest's own"),
  })
  .superRefine((manifest, ctx) => credentialHosts(manifest.capabilities, ctx))
  .describe("A CedarLoom plugin manifest; readers also refuse values nested over 32 levels deep")
  .register(fileFormats, { id: "PluginManifest" });
export type PluginManifest = z.infer<typeof PluginManifest>;

// The URL forms Git fetches over https and ssh, without a password and without a character a shell, a terminal or a
// credential helper reads specially (control characters, spaces, non-ASCII); a user or host never starts with `-`,
// which ssh would read as an option.
const user = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const host = /^[a-z0-9][a-z0-9.-]*$/;
const scpLike = /^[A-Za-z0-9_][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9.-]*:(?!-)[!-~]+$/;
const plain = (url: URL): boolean =>
  url.password === "" && host.test(url.hostname) && url.pathname.length > 1 && url.search === "" && url.hash === "";
const isGitUrl = (value: string): boolean => {
  if (!/^[!-~]+$/.test(value)) return false;
  if (scpLike.test(value)) return true;
  // Git matches the scheme in lower case only.
  if (!/^(?:https|ssh):\/\//.test(value) || !URL.canParse(value)) return false;
  const url = new URL(value);
  // No user over https, where it would be a credential.
  const named = url.protocol === "https:" ? url.username === "" : url.username === "" || user.test(url.username);
  return named && plain(url);
};

/** Where Git fetches a plugin: an https or ssh URL, or `user@host:path`. */
const GitUrl = z.string().max(2048).refine(isGitUrl, "an https or ssh Git URL without a password, or user@host:path");

const PluginPin = z.strictObject({
  version: semver,
  source: z.strictObject({
    git: GitUrl,
    commit: z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .describe("The commit, never a branch or tag that can move"),
    path: ProjectPath.optional().describe("The plugin's folder inside the repository; its root when absent"),
  }),
  digest: Sha256.describe(
    "SHA-256 of the plugin folder's listing at the commit: one line `<mode> <SHA-256 of the file> <path>` per file, sorted by path",
  ),
});

/**
 * The plugins a set of workflows needs, each pinned to a commit and the digest of its files (A29 b), so an import
 * fetches the code the exporter ran or refuses it. Git is the only source in 0.1.0 (pending owner decision).
 */
export const PluginLock = z
  .strictObject({
    $schema: z.string().optional().describe("Where an editor finds this JSON Schema; readers ignore it"),
    schemaVersion: z.literal(LOCK_SCHEMA_VERSION),
    kind: z.literal("cedarloom.lock"),
    plugins: z.record(PluginId, PluginPin),
  })
  .register(fileFormats, { id: "PluginLock" });
export type PluginLock = z.infer<typeof PluginLock>;

/**
 * The index of an export folder: each workflow at `workflows/<id in lower case>/workflow.json` and the plugins they
 * need in `cedarloom.lock.json` beside this file. The workflow store keeps the same layout (pending owner decision).
 */
export const ExportIndex = z
  .strictObject({
    $schema: z.string().optional().describe("Where an editor finds this JSON Schema; readers ignore it"),
    schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
    kind: z.literal("cedarloom.export"),
    name: z.string().min(1).max(200),
    description,
    license: License.optional(),
    workflows: z
      .array(WorkflowId)
      .min(1)
      .max(1000)
      // Workflow files are named in lower case (the drafts too), so ids that differ in case only would share a file.
      .refine((ids) => unique(ids.map((id) => id.toLowerCase())), "no workflow twice, also in another case"),
  })
  .register(fileFormats, { id: "ExportIndex" });
export type ExportIndex = z.infer<typeof ExportIndex>;
