import { z } from "zod";
import { type Result, readDocument } from "./documents.ts";
import { description, distinct, GitRef, GitUrl, PortablePath, sized } from "./extension.ts";
import { ProjectPath } from "./nodes.ts";
import { GitSource, PackId } from "./pack.ts";
import { fileFormats } from "./registry.ts";
import { isPlainText, PlainText, shown } from "./text.ts";
import type { Json } from "./json.ts";
import { JsonValue, License, semver } from "./workflow.ts";

/** The profile format (`cedarloom.profile`) this CedarLoom reads; readers refuse a newer one. */
export const PROFILE_SCHEMA_VERSION = 1;
/** The format of this machine's profile selection, `profile.json` in CedarLoom's config folder. */
export const SELECTION_SCHEMA_VERSION = 1;

const title = PlainText.min(1).max(200);
const PART = "[a-z][a-z0-9-]{0,63}(?:\\.[a-z0-9][a-z0-9-]{0,63})?";
const PartId = z.string().regex(new RegExp(`^${PART}$`));
/** A part with its level, as `requires` and the selection name it: `machine.rules.global`, `workspace.hub`. */
const QualifiedPartId = z.string().regex(new RegExp(`^(?:machine|workspace|project)\\.${PART}$`));
const JsonObject = z.record(z.string(), JsonValue);
const Color = z.string().regex(/^[0-9a-f]{6}$/);

/** A pack's entry by its path inside the pack; the pack is one this profile names in `packs`. */
const PackRef = z.strictObject({ pack: PackId, path: PortablePath });
// A rules text or template: a pack's entry, or inline text for a one-file profile, which holds tabs and line breaks
// but no other control character and no bidirectional control.
const Text = z.union([
  PackRef,
  z.strictObject({
    inline: z
      .string()
      .max(16_384)
      .refine((text) => isPlainText(text.replaceAll(/[\t\n]/g, "")), "no control character but tab and line break"),
  }),
]);

// A Claude Code marketplace the user settings declare (`extraKnownMarketplaces`), at a branch or tag; marketplace
// sources take no commit (https://code.claude.com/docs/en/plugins/marketplace-reference#marketplace-sources).
const Name = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const followed = { name: Name, ref: GitRef.optional(), autoUpdate: z.boolean().optional() };
const Marketplace = z.union([
  z.strictObject({ ...followed, github: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/) }),
  z.strictObject({ ...followed, git: GitUrl }),
]);

const common = {
  title,
  description,
  default: z.enum(["on", "auto", "off"]).describe("auto: on when its `when` probe holds"),
  when: z.enum(["orca", "devcontainer", "no-devcontainer"]).optional().describe("The probe an auto part needs"),
  requires: distinct(QualifiedPartId).max(20).optional(),
};
// Each part type twice: whole, as the composed profile needs it, and as a file states it, where every field but
// `type` may be left to a parent.
const part = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) => {
  const whole = z.strictObject({ type: z.literal(type), ...common, ...shape });
  return { whole, layer: whole.partial().required({ type: true }) };
};

const plugin = part("plugin", {
  plugin: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}@[a-z0-9][a-z0-9-]{0,63}$/)
    .describe("`<plugin>@<marketplace>`"),
  marketplace: Marketplace.optional().describe("Declared when Claude Code does not know it; named as in the plugin id"),
  options: z
    .strictObject({ file: PortablePath.describe("Relative to the user's home"), set: JsonObject })
    .optional()
    .describe("The plugin's own config file, merged as a settings `set` is"),
});
const skill = part("skill", { source: z.union([PackRef, GitSource]) });
const rulesFile = part("rules", {
  file: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.md$/)
    .describe("The file's name in the rules folder"),
  text: Text,
});
const userSettings = part("settings", { set: JsonObject.describe("Merged into the agent's user settings") });
const hub = part("hub", {
  labels: sized(
    z.record(PlainText.min(1).max(50), z.strictObject({ color: Color, description: PlainText.max(100).optional() })),
    100,
  ),
  projectLabel: z.strictObject({ prefix: PlainText.min(1).max(40), color: Color }).optional(),
  rules: Text.optional().describe("The question rule, a machine rules file while this part is on"),
});
const memory = part("memory", { scaffold: PackRef, loader: z.boolean() });
const rules = z.array(Text).min(1).max(50);
const manual = part("manual", { rules, claudeImport: z.boolean() });
const localManual = part("local-manual", { rules });
const files = part("files", {
  files: sized(z.record(ProjectPath, Text), 100, 1),
  commit: z.boolean(),
  onlyIfAbsent: z.boolean().optional(),
});
const projectSettings = part("settings", { set: JsonObject, commit: z.boolean() });
const packs = part("packs", { packs: distinct(PackId).max(50) });
const tier = part("tier", { tier: z.enum(["quick", "standard", "full", "research"]).nullable() });
const gates = part("gates", {
  callers: distinct(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/))
    .min(1)
    .max(20),
  dependabotCooldownDays: z.int().min(0).max(90),
});

const level = <T extends z.ZodType>(union: T) => sized(z.record(PartId, union), 100);
const whole = {
  machine: level(z.discriminatedUnion("type", [plugin.whole, skill.whole, rulesFile.whole, userSettings.whole])),
  workspace: level(z.discriminatedUnion("type", [hub.whole, memory.whole])),
  project: level(
    z.discriminatedUnion("type", [
      manual.whole,
      localManual.whole,
      files.whole,
      projectSettings.whole,
      packs.whole,
      tier.whole,
      gates.whole,
    ]),
  ),
};
const layer = {
  machine: level(z.discriminatedUnion("type", [plugin.layer, skill.layer, rulesFile.layer, userSettings.layer])),
  workspace: level(z.discriminatedUnion("type", [hub.layer, memory.layer])),
  project: level(
    z.discriminatedUnion("type", [
      manual.layer,
      localManual.layer,
      files.layer,
      projectSettings.layer,
      packs.layer,
      tier.layer,
      gates.layer,
    ]),
  ),
};

// `cedarloom` packs ship with CedarLoom and nothing else does: trust comes from where content came from.
const PackSource = z.union([z.strictObject({ bundled: z.literal(true) }), GitSource]);
const head = {
  $schema: z.string().optional().describe("Where an editor finds this JSON Schema; readers ignore it"),
  schemaVersion: z.literal(PROFILE_SCHEMA_VERSION),
  kind: z.literal("cedarloom.profile"),
  id: PackId.describe("`publisher.name`, as a pack's"),
  version: semver,
  name: title,
  description,
  license: License.optional(),
  minApp: semver.describe("The oldest CedarLoom version that reads this profile"),
};
const Agents = distinct(z.enum(["claude-code"])).min(1);

const LEVELS = ["machine", "workspace", "project"] as const;
// Each `pack` a value names, at any depth.
const refsIn = (value: unknown, path: (string | number)[]): [(string | number)[], string][] => {
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, item]) => {
    const at = [...path, Array.isArray(value) ? Number(key) : key];
    return key === "pack" && typeof item === "string" ? [[at, item]] : refsIn(item, at);
  });
};
// Each pack a file names, by where: its parents and its parts' fields, never inside a settings `set` or a plugin's
// `options`, which are the agent's and the plugin's own JSON.
const packRefs = (file: ProfileFile): [(string | number)[], string][] => [
  ...refsIn(file.extends ?? [], ["extends"]),
  ...LEVELS.flatMap((name) =>
    Object.entries(file[name] ?? {}).flatMap(([id, each]) =>
      Object.entries(each).flatMap(([key, item]): [(string | number)[], string][] => {
        if (key === "set" || key === "options") return [];
        if (each.type !== "packs" || !Array.isArray(item)) return refsIn(item, [name, id, key]);
        return item.flatMap((pack, index) => (typeof pack === "string" ? [[[name, id, key, index], pack]] : []));
      }),
    ),
  ),
];

/**
 * A profile file: a versioned, public-safe setup in parts on three levels. It may extend other profiles, Renovate-style:
 * parents in list order, each after its own parents, then this file, the later one winning (see `composeProfile`), so
 * a part here may state only what it changes. Every pack it points to is one it names in `packs`.
 */
export const ProfileFile = z
  .strictObject({
    ...head,
    extends: z
      .array(PackRef)
      .min(1)
      .max(10)
      .refine((refs) => new Set(refs.map((ref) => `${ref.pack}/${ref.path}`)).size === refs.length, "no parent twice")
      .meta({ uniqueItems: true })
      .optional()
      .describe("Parent profiles, each a profile entry of a pack named in `packs`"),
    agents: Agents.optional().describe("Claude Code only in schema 1"),
    packs: sized(z.record(PackId, PackSource), 50).optional().describe("Packs of the cedarloom publisher are bundled"),
    machine: layer.machine.optional(),
    workspace: layer.workspace.optional(),
    project: layer.project.optional(),
  })
  .superRefine((file, ctx) => {
    for (const [id, source] of Object.entries(file.packs ?? {})) {
      if (id.startsWith("cedarloom.") !== "bundled" in source) {
        ctx.addIssue({
          code: "custom",
          path: ["packs", id],
          message: "bundled exactly when the publisher is cedarloom",
        });
      }
    }
    for (const [path, pack] of packRefs(file)) {
      if (file.packs?.[pack] === undefined) ctx.addIssue({ code: "custom", path, message: "a pack named in `packs`" });
    }
  })
  .describe("A CedarLoom profile; readers also refuse values nested over 32 levels deep")
  .register(fileFormats, { id: "CedarLoomProfile" });
export type ProfileFile = z.infer<typeof ProfileFile>;

/** A profile with its parents merged in: every part whole, every auto part with its probe. */
export const Profile = z
  .strictObject({
    ...head,
    agents: Agents,
    packs: z.record(PackId, PackSource),
    ...whole,
  })
  .superRefine((profile, ctx) => {
    // A plugin's options file lives in its own config folder, never in an agent's settings or another tool's files.
    for (const [id, each] of Object.entries(profile.machine)) {
      const folder = each.type === "plugin" ? `.config/${each.plugin.slice(0, each.plugin.indexOf("@"))}/` : "";
      if (each.type === "plugin" && each.options !== undefined && !each.options.file.startsWith(folder)) {
        ctx.addIssue({ code: "custom", path: ["machine", id, "options", "file"], message: `inside ${folder}` });
      }
    }
    for (const name of LEVELS) {
      for (const [id, each] of Object.entries(profile[name])) {
        if (each.default === "auto" && each.when === undefined) {
          ctx.addIssue({ code: "custom", path: [name, id, "when"], message: "the probe of an auto part" });
        }
      }
    }
  });
export type Profile = z.infer<typeof Profile>;

/** This machine's choice: the profile it applies and the parts switched away from their default. */
export const ProfileSelection = z
  .strictObject({
    $schema: z.string().optional().describe("Where an editor finds this JSON Schema; readers ignore it"),
    schemaVersion: z.literal(SELECTION_SCHEMA_VERSION),
    kind: z.literal("cedarloom.profile-selection"),
    profile: z.union([
      PackRef,
      z.strictObject({
        file: z
          .string()
          .max(4096)
          .regex(/^(?:\/|[A-Za-z]:[\\/])/, "an absolute path"),
      }),
    ]),
    select: sized(z.record(QualifiedPartId, z.boolean()), 500).describe("On or off against the part's default"),
  })
  .register(fileFormats, { id: "ProfileSelection" });
export type ProfileSelection = z.infer<typeof ProfileSelection>;

// Token shapes by their documented prefixes and lengths (GitHub, npm, Anthropic and OpenAI, GitLab, Slack, AWS,
// Google), and environment names with a credential word; a profile is shared, so neither may sit in it.
const TOKEN =
  /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_\w{22,}|npm_[A-Za-z0-9]{36}|sk-[\w-]{20,}|glpat-[\w-]{20,}|xox[abprs]-[\w-]{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{35})/;
const CREDENTIAL_NAME = /(?:^|_)(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIALS?)(?:_|$)/i;
const secretAt = (value: unknown, path: string[] = []): string | undefined => {
  if (typeof value === "string") return TOKEN.test(value) ? path.join(".") : undefined;
  if (typeof value !== "object" || value === null) return undefined;
  for (const [key, item] of Object.entries(value)) {
    if (path.at(-1) === "env" && CREDENTIAL_NAME.test(key)) return [...path, key].join(".");
    const found = secretAt(item, [...path, key]);
    if (found !== undefined) return found;
  }
  return undefined;
};

// Settings CedarLoom never writes (hub SETTINGS-DEFAULTS; https://code.claude.com/docs/en/settings-reference): each
// removes a guard, stops updates or keeps the owner's choice; and keys that run a command, which a shared profile may
// not bring, as plugins bring no hooks (A30).
const NEVER = ["disableAllHooks", "skipDangerousModePermissionPrompt", "enableAllProjectMcpServers", "apiKeyHelper"];
const COMMANDS = ["hooks", "statusLine", "awsAuthRefresh", "awsCredentialExport", "otelHeadersHelper"];
const UPDATES = ["DISABLE_UPDATES", "DISABLE_AUTOUPDATER"];
type Fields = { [key: string]: Json | undefined };
const fields = (value: Json | undefined): Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
const forbiddenIn = (set: Fields): string | undefined => {
  const updates = Object.keys(fields(set["env"])).find((name) => UPDATES.includes(name));
  const permissions = fields(set["permissions"]);
  return (
    Object.keys(set).find((name) => NEVER.includes(name) || COMMANDS.includes(name)) ??
    (updates === undefined ? undefined : `env.${updates}`) ??
    ("disableBypassPermissionsMode" in permissions ? "permissions.disableBypassPermissionsMode" : undefined) ??
    (permissions["defaultMode"] === "bypassPermissions" ? "permissions.defaultMode" : undefined)
  );
};

const forbiddenSetting = (file: ProfileFile): string | undefined => {
  for (const name of ["machine", "project"] as const) {
    for (const [id, each] of Object.entries(file[name] ?? {})) {
      const key = each.type === "settings" && each.set !== undefined ? forbiddenIn(each.set) : undefined;
      if (key !== undefined) return `${name}.${id}.set.${key}`;
    }
  }
  return undefined;
};

/**
 * Reads a profile file: a file of another kind (BenchKeeper's profiles and presets among them, which CedarLoom never
 * imports) and a newer format are refused first, then the schema, then a credential and a forbidden setting anywhere.
 */
export const readProfile = (value: unknown): Result<ProfileFile> => {
  const kind = z.looseObject({ kind: z.string() }).safeParse(value);
  if (kind.success && kind.data.kind !== "cedarloom.profile") {
    return { ok: false, finding: { code: "profile.foreign-kind", params: { kind: shown(kind.data.kind, 100) } } };
  }
  const read = readDocument(ProfileFile, PROFILE_SCHEMA_VERSION, value);
  if (!read.ok) return read;
  const secret = secretAt(read.value);
  if (secret !== undefined)
    return { ok: false, finding: { code: "profile.secret-like", params: { path: shown(secret) } } };
  const forbidden = forbiddenSetting(read.value);
  if (forbidden !== undefined)
    return { ok: false, finding: { code: "profile.forbidden-setting", params: { path: shown(forbidden) } } };
  return read;
};
