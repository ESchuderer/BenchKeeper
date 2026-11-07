import { type Dirent, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { type Finding, isTree, type Json, type Operation } from "@cedarloom/contracts";
import { hashFile } from "@cedarloom/engine";

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

/**
 * The plugins a settings value enables and the marketplaces it declares that no part that is on names; a marketplace
 * an enabled plugin comes from is not offered, as the plugin would no longer resolve.
 */
export const settingsOffers = (settings: Json, plugins: Named, marketplaces: Named): Offer[] => {
  const enabled = keysOf(settings, "enabledPlugins").flatMap(([id, on]) => (on === true ? [id] : []));
  const used = new Set(enabled.map((id) => id.slice(id.indexOf("@") + 1)));
  return [
    ...enabled.flatMap((id) => offer("plugin", id, plugins)),
    ...keysOf(settings, "extraKnownMarketplaces")
      .filter(([name]) => !used.has(name))
      .flatMap(([name]) => offer("marketplace", name, marketplaces)),
  ];
};

// A folder's entries, at every depth with `deep`; none when it cannot be read, which offers nothing there.
const entries = (folder: string, deep = false): Dirent[] => {
  try {
    return readdirSync(folder, { recursive: deep, withFileTypes: true });
  } catch {
    return [];
  }
};

/**
 * The rules files and skill folders of a Claude Code home that are not `mine` (CedarLoom's wanted files and those
 * its plan removes): the owner's own or another tool's, which the plan offers to remove, each only when named. A skill
 * folder that holds a link is not offered, as removing it takes only files.
 */
export const folderOffers = (home: string, mine: ReadonlySet<string>): Offer[] => {
  const rules = entries(join(home, "rules"))
    .filter((entry) => entry.isFile() && !mine.has(join(home, "rules", entry.name)))
    .map((entry): Offer => ({ item: `rules:${entry.name}`, status: "extra" }));
  const paths = [...mine];
  const skills = entries(join(home, "skills"))
    .filter((entry) => {
      const folder = join(home, "skills", entry.name);
      const plain = entries(folder, true).every((inside) => inside.isFile() || inside.isDirectory());
      return entry.isDirectory() && plain && !paths.some((path) => path.startsWith(folder + sep));
    })
    .map((entry): Offer => ({ item: `skill:${entry.name}`, status: "extra" }));
  return [...rules, ...skills];
};

/** An offer as a plan's line, with the item that `apply --remove` takes. */
export const offerLine = ({ item, status }: Offer): Finding =>
  status === "extra"
    ? { code: "profile.extra", params: { item } }
    : { code: "profile.drift", params: { status, subject: item, remove: item } };

// A file's delete, with the hash it must still have; none when it cannot be read.
const deleteOf = (path: string): Operation[] => {
  try {
    const before = hashFile(path);
    return before === null ? [] : [{ kind: "delete", path, before }];
  } catch {
    return [];
  }
};

/**
 * What removing the named offers takes: the plugin and marketplace keys to drop from the settings, and a delete of a
 * rules file or of each file in a skill folder.
 */
export const removalsOf = (home: string, items: readonly string[]) => {
  const named = (kind: string) =>
    items.filter((item) => item.startsWith(`${kind}:`)).map((item) => item.slice(kind.length + 1));
  const skillFiles = named("skill").flatMap((name) =>
    entries(join(home, "skills", name), true)
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name)),
  );
  const rules = named("rules").map((name) => join(home, "rules", name));
  const files = [...rules, ...skillFiles].flatMap((path) => deleteOf(path));
  return { files, plugins: named("plugin"), marketplaces: named("marketplace") };
};
