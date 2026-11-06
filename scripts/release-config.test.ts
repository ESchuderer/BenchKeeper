// The CedarLoom release config is used by no workflow in this repository; this keeps it in step with the packages.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { z } from "zod";

const Config = z.object({
  plugins: z.array(z.object({ type: z.string(), components: z.array(z.string()).optional() })),
  packages: z.record(z.string(), z.object({ component: z.string() })),
});
const Manifest = z.record(z.string(), z.string());

const json = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));

// Released on their own, with a version of their own (A54 a): the extension SDK, which extension authors depend on.
const OWN_VERSION = ["extension-sdk"];

await test("every CedarLoom package is in the release config and its manifest, and in the linked application group unless it has a version of its own", async () => {
  const entries = await readdir("packages", { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => `packages/${e.name}`).toSorted();
  const config = Config.parse(await json("release-please-config.cedarloom.json"));
  const manifest = Manifest.parse(await json(".release-please-manifest.cedarloom.json"));
  assert.deepEqual(Object.keys(config.packages).toSorted(), dirs);
  assert.deepEqual(Object.keys(manifest).toSorted(), dirs);
  const linked = config.plugins.find((plugin) => plugin.type === "linked-versions");
  const components = Object.values(config.packages)
    .map((entry) => entry.component)
    .filter((component) => !OWN_VERSION.includes(component));
  assert.deepEqual(linked?.components?.toSorted(), components.toSorted());
});
