import { type Dirent, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { type Finding, isTree, type Json, type Operation } from "@cedarloom/contracts";
import { errorCode, hashFile } from "@cedarloom/engine";

/** What a home holds that no part that is on names, as `apply --remove` takes it: `plugin:<id>`, `rules:<file>`… */
export type Offer = { item: string; status: "extra" | "deselected-present" };
/** The names the profile's parts give, of the parts that are on and of those that are off. */
export type Named = { on: ReadonlySet<string>; off: ReadonlySet<string> };

const keysOf = (json: Json, key: string): [string, Json | undefined][] => {
  const value = isTree(json) ? json[key] : undefined;
  return isTree(value) ? Object.entries(value) : [];
};

const offer = (kind: string, name: string, named: Named): Offer[] => {
  if (named.on.has(name)) return [];
  return [{ item: `${kind}:${name}`, status: named.off.has(name) ? "deselected-present" : "extra" }];
};

/** The plugins a settings value enables and the marketplaces it declares that no part that is on names. */
export const settingsOffers = (settings: Json, plugins: Named, marketplaces: Named): Offer[] => [
  ...keysOf(settings, "enabledPlugins").flatMap(([id, on]) => (on === true ? offer("plugin", id, plugins) : [])),
  ...keysOf(settings, "extraKnownMarketplaces").flatMap(([name]) => offer("marketplace", name, marketplaces)),
];

// A folder's entries; none when it is not there.
const entries = (folder: string): Dirent[] => {
  try {
    return readdirSync(folder, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
};

/**
 * The rules files and skill folders of a Claude Code home that CedarLoom neither wants there nor wrote: the owner's
 * own or another tool's, which the plan offers to remove, each only when named.
 */
export const folderOffers = (home: string, mine: ReadonlySet<string>): Offer[] => {
  const rules = entries(join(home, "rules"))
    .filter((entry) => entry.isFile() && !mine.has(join(home, "rules", entry.name)))
    .map((entry): Offer => ({ item: `rules:${entry.name}`, status: "extra" }));
  const paths = [...mine];
  const skills = entries(join(home, "skills"))
    .filter((entry) => {
      const root = join(home, "skills", entry.name) + sep;
      return entry.isDirectory() && !paths.some((path) => path.startsWith(root));
    })
    .map((entry): Offer => ({ item: `skill:${entry.name}`, status: "extra" }));
  return [...rules, ...skills];
};

/** An offer as a plan's line, with the item that `apply --remove` takes. */
export const offerLine = ({ item, status }: Offer): Finding => ({
  code: "profile.drift",
  params: { status, subject: item, remove: item },
});

// A file's delete, with the hash it must still have.
const deleteOf = (path: string): Operation[] => {
  const before = hashFile(path);
  return before === null ? [] : [{ kind: "delete", path, before }];
};

/**
 * What removing the named offers takes: the plugin and marketplace keys to drop from the settings, and a delete of a
 * rules file or of each file in a skill folder (links are not followed).
 */
export const removalsOf = (home: string, items: readonly string[]) => {
  const named = (kind: string) =>
    items.filter((item) => item.startsWith(`${kind}:`)).map((item) => item.slice(kind.length + 1));
  const skillFiles = named("skill").flatMap((name) =>
    readdirSync(join(home, "skills", name), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name)),
  );
  const files = [...named("rules").map((name) => join(home, "rules", name)), ...skillFiles].flatMap((path) => deleteOf(path));
  return { files, plugins: named("plugin"), marketplaces: named("marketplace") };
};
