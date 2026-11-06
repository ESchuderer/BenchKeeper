import { z } from "zod";
import { Commit, FolderDigest, GitRef, GitUrl, PortablePath, sized } from "./extension.ts";
import { fileFormats } from "./registry.ts";
import { PlainText } from "./text.ts";
import { License, semver } from "./workflow.ts";

/** The pack manifest format (`cedarloom-pack.json`) this CedarLoom reads; readers refuse a newer one. */
export const PACK_SCHEMA_VERSION = 1;

const description = PlainText.max(2000).optional();

/** A pack's id: `publisher.name` in lower case, as an extension's. Packs of the `cedarloom` publisher ship with CedarLoom. */
const PackId = z.string().regex(/^[a-z][a-z0-9-]{0,63}\.[a-z][a-z0-9-]{0,63}$/);

/**
 * Where Git fetches a folder (A29 b): a text-only one follows a branch or tag, taking a new commit once CedarLoom has
 * seen it there for 3 days (A94); one with a file that runs is pinned by commit and digest, as an extension is.
 */
const GitSource = z
  .union([
    z.strictObject({
      git: GitUrl,
      path: PortablePath.optional().describe("The folder inside the repository; its root when absent"),
      ref: GitRef.describe("The branch or tag it follows; HEAD for the default branch. Refused when a file in it runs"),
    }),
    z.strictObject({
      git: GitUrl,
      path: PortablePath.optional().describe("The folder inside the repository; its root when absent"),
      commit: Commit,
      digest: FolderDigest,
    }),
  ])
  .describe("A branch or tag it follows, or a commit and digest it is pinned to; never both");

const Entry = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.enum(["rules", "template", "profile"]), description }),
  z.strictObject({
    kind: z.literal("skill"),
    description,
    source: GitSource.optional().describe(
      "Where Git fetches the skill; this pack's folder at the entry's path when absent",
    ),
  }),
]);

// A skill's folder is its name: 1 to 64 of a-z, 0-9 and "-", no "-" at either end or twice in a row
// (https://agentskills.io/specification). Claude Code reads rules from Markdown files only.
const skillName = (name: string): boolean => /^[a-z0-9-]{1,64}$/.test(name) && !/^-|-$|--/.test(name);
const fits = (path: string, kind: z.infer<typeof Entry>["kind"]): boolean => {
  if (kind === "skill") return skillName(path.slice(path.lastIndexOf("/") + 1));
  if (kind === "template") return true;
  return path.endsWith(kind === "rules" ? ".md" : ".json");
};

/**
 * A pack's manifest, `cedarloom-pack.json` at the root of its folder: what it is and the index of its entries, the
 * rules texts, templates, profiles and skills a profile points to by `{ pack, path }`. Reading it fetches nothing.
 */
export const PackManifest = z
  .strictObject({
    $schema: z.string().optional().describe("Where an editor finds this JSON Schema; readers ignore it"),
    schemaVersion: z.literal(PACK_SCHEMA_VERSION),
    kind: z.literal("cedarloom.pack"),
    id: PackId,
    version: semver,
    name: PlainText.min(1).max(200),
    description,
    license: License.optional(),
    minApp: semver.describe("The oldest CedarLoom version that reads this pack"),
    entries: sized(z.record(PortablePath, Entry), 500, 1).describe(
      "Each entry by its path inside the pack: a rules text ends in .md, a profile in .json, a skill's last part is its name",
    ),
  })
  .superRefine((manifest, ctx) => {
    for (const [path, entry] of Object.entries(manifest.entries)) {
      if (!fits(path, entry.kind))
        ctx.addIssue({ code: "custom", path: ["entries", path], message: "a path for its kind" });
    }
  })
  .describe("A CedarLoom pack manifest; readers also refuse values nested over 32 levels deep")
  .register(fileFormats, { id: "PackManifest" });
export type PackManifest = z.infer<typeof PackManifest>;
