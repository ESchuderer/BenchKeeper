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

const root = join(BUNDLED, "cedarloom.core");
const json = async (path: string): Promise<unknown> => JSON.parse(await readFile(join(root, path), "utf8"));
const manifest = PackManifest.parse(await json("cedarloom-pack.json"));
const entries = Object.keys(manifest.entries);
const files = (await readdir(root, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"));
const covers = (entry: string, file: string): boolean => file === entry || file.startsWith(`${entry}/`);

// Each `{ pack, path }` a profile names, at any depth.
const references = (value: unknown): { pack: string; path: string }[] => {
  if (typeof value !== "object" || value === null) return [];
  const pack: unknown = Reflect.get(value, "pack");
  const path: unknown = Reflect.get(value, "path");
  const here = typeof pack === "string" && typeof path === "string" ? [{ pack, path }] : [];
  return [...here, ...Object.values(value).flatMap(references)];
};

test("cedarloom.core's manifest lists exactly the files the pack holds", async () => {
  expect([
    readDocument(PackManifest, PACK_SCHEMA_VERSION, await json("cedarloom-pack.json")).ok,
    manifest.id,
    files.filter((file) => file !== "cedarloom-pack.json" && !entries.some((entry) => covers(entry, file))),
    entries.filter((entry) => !files.some((file) => covers(entry, file))),
  ]).toEqual([true, "cedarloom.core", [], []]);
});

test("every text cedarloom.core ships is plain: tabs and line breaks, no other control or bidirectional character", async () => {
  const texts = await Promise.all(files.map(async (file) => [file, await readFile(join(root, file), "utf8")] as const));
  expect(texts.filter(([, text]) => !isPlainText(text.replaceAll(/[\t\n]/g, ""))).map(([file]) => file)).toEqual([]);
});

test("each profile of cedarloom.core reads whole, and every text it names is an entry of the pack", async () => {
  const profiles = entries.filter((entry) => manifest.entries[entry]?.kind === "profile");
  const results = await Promise.all(
    profiles.map(async (path) => {
      const value = await json(path);
      const named = references(value).filter((ref) => ref.pack !== "cedarloom.core" || !entries.includes(ref.path));
      return [readProfile(value).ok, readDocument(Profile, PROFILE_SCHEMA_VERSION, value).ok, named];
    }),
  );
  expect([profiles, results]).toEqual([["profiles/default.json"], [[true, true, []]]]);
});
