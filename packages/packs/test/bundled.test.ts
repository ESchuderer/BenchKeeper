import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
  isPlainText,
  PACK_SCHEMA_VERSION,
  PackManifest,
  Profile,
  PROFILE_SCHEMA_VERSION,
  readDocument,
  readProfile,
} from "@cedarloom/contracts";
import { BUNDLED } from "@cedarloom/packs";
import { expect, test } from "vitest";

const json = async (path: string): Promise<unknown> => JSON.parse(await readFile(join(BUNDLED, path), "utf8"));
// Each bundled pack: its folder name, manifest, entries and files.
const packs = await Promise.all(
  (await readdir(BUNDLED)).toSorted().map(async (folder) => {
    const root = join(BUNDLED, folder);
    const manifest = PackManifest.parse(await json(join(folder, "cedarloom-pack.json")));
    const files = (await readdir(root, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"));
    return { folder, manifest, entries: Object.keys(manifest.entries), files };
  }),
);
const covers = (entry: string, file: string): boolean => file === entry || file.startsWith(`${entry}/`);

// Each `{ pack, path }` a profile names, at any depth.
const references = (value: unknown): { pack: string; path: string }[] => {
  if (typeof value !== "object" || value === null) return [];
  const pack: unknown = Reflect.get(value, "pack");
  const path: unknown = Reflect.get(value, "path");
  const here = typeof pack === "string" && typeof path === "string" ? [{ pack, path }] : [];
  return [...here, ...Object.values(value).flatMap(references)];
};

test("each bundled pack's manifest, in the folder of its id, lists exactly the files the pack holds", async () => {
  const checked = await Promise.all(
    packs.map(async ({ folder, manifest, entries, files }) => [
      readDocument(PackManifest, PACK_SCHEMA_VERSION, await json(join(folder, "cedarloom-pack.json"))).ok,
      folder,
      manifest.id,
      files.filter((file) => file !== "cedarloom-pack.json" && !entries.some((entry) => covers(entry, file))),
      // An entry with a Git source holds no files here; every other entry holds some.
      entries.filter((entry) => {
        const found = manifest.entries[entry];
        const fromGit = found?.kind === "skill" && found.source !== undefined;
        return fromGit === files.some((file) => covers(entry, file));
      }),
    ]),
  );
  expect(checked).toEqual([
    [true, "cedarloom.core", "cedarloom.core", [], []],
    [true, "cedarloom.mantine", "cedarloom.mantine", [], []],
    [true, "cedarloom.orca", "cedarloom.orca", [], []],
  ]);
});

test("every text a bundled pack ships is plain: tabs and line breaks, no other control or bidirectional character", async () => {
  const paths = packs.flatMap(({ folder, files }) => files.map((file) => join(folder, file)));
  const texts = await Promise.all(paths.map(async (path) => [path, await readFile(join(BUNDLED, path), "utf8")]));
  expect(texts.filter(([, text = ""]) => !isPlainText(text.replaceAll(/[\t\n]/g, ""))).map(([path]) => path)).toEqual(
    [],
  );
});

test("each bundled profile reads whole, and every text it names is an entry of a bundled pack", async () => {
  const entryOf = ({ pack, path }: { pack: string; path: string }): boolean =>
    packs.some(({ manifest, entries }) => manifest.id === pack && entries.includes(path));
  const profiles = packs.flatMap(({ folder, manifest, entries }) =>
    entries.filter((entry) => manifest.entries[entry]?.kind === "profile").map((entry) => join(folder, entry)),
  );
  const results = await Promise.all(
    profiles.map(async (path) => {
      const value = await json(path);
      const named = references(value).filter((ref) => !entryOf(ref));
      return [readProfile(value).ok, readDocument(Profile, PROFILE_SCHEMA_VERSION, value).ok, named];
    }),
  );
  expect([profiles.map((path) => path.split(sep).join("/")), results]).toEqual([
    ["cedarloom.core/profiles/default.json"],
    [[true, true, []]],
  ]);
});
