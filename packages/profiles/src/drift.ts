import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { isUtf8 } from "node:buffer";
import { type Finding, isTree, type Json, type Operation, type Result } from "@cedarloom/contracts";
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

// Plugins and marketplaces no on part names; a marketplace in use is offered only with its plugin's removal.
export const settingsOffers = (settings: Json, named: { plugins: Named; marketplaces: Named }, removing: string[]) => {
  const { plugins, marketplaces } = named;
  const enabled = keysOf(settings, "enabledPlugins").flatMap(([id, on]) => (on === true ? [id] : []));
  const kept = enabled.filter((id) => !removing.includes(`plugin:${id}`));
  const used = new Set(kept.map((id) => id.slice(id.indexOf("@") + 1)));
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

// A home's rules files and skill folders that are not `mine`, each offered for removal; a folder with a link is not.
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

// A file's delete with the hash it must still have; a file that is not UTF-8 stops the plan, as only text is backed up.
const deleteOf = (path: string): Result<Operation[]> => {
  try {
    if (!isUtf8(readFileSync(path))) return { ok: false, finding: { code: "apply.not-text", params: { path } } };
    const before = hashFile(path);
    return { ok: true, value: before === null ? [] : [{ kind: "delete", path, before }] };
  } catch {
    return { ok: true, value: [] };
  }
};

type Removals = { files: Operation[]; plugins: string[]; marketplaces: string[] };
// What removing the named offers takes: settings keys to drop, and deletes of a rules file or a skill folder's files.
export const removalsOf = (home: string, items: readonly string[]): Result<Removals> => {
  const named = (kind: string) =>
    items.filter((item) => item.startsWith(`${kind}:`)).map((item) => item.slice(kind.length + 1));
  const skillFiles = named("skill").flatMap((name) =>
    entries(join(home, "skills", name), true)
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name)),
  );
  const rules = named("rules").map((name) => join(home, "rules", name));
  const files: Operation[] = [];
  for (const path of [...rules, ...skillFiles]) {
    const deletes = deleteOf(path);
    if (!deletes.ok) return deletes;
    files.push(...deletes.value);
  }
  return { ok: true, value: { files, plugins: named("plugin"), marketplaces: named("marketplace") } };
};
