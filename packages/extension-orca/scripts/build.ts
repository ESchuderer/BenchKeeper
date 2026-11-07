import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "rolldown";

// The app ships the extension as its manifest and one entry file, in the CLI package's folder of its own extensions.
const out = join(import.meta.dirname, "..", "..", "cli", "extensions", "cedarloom.orca");
await build({
  input: join(import.meta.dirname, "..", "src", "main.ts"),
  platform: "node",
  output: { dir: out, entryFileNames: "main.mjs", format: "esm" },
});
// Its version is the app's: the release sets the package's.
const read = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, "..", name), "utf8"));
const manifest = { ...read("cedarloom-extension.json"), version: read("package.json").version };
writeFileSync(join(out, "cedarloom-extension.json"), `${JSON.stringify(manifest, null, 2)}\n`);
