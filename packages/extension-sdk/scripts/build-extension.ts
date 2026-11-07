import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "rolldown";

// Builds the app's own extension whose package folder it runs in (each one's `build` script, which pnpm runs there), so
// every bundled extension builds the same way: its manifest and one entry file, in the CLI package's extensions folder.
const at = process.cwd();
const read = (name: string) => JSON.parse(readFileSync(join(at, name), "utf8"));
const out = join(at, "..", "cli", "extensions", read("cedarloom-extension.json").id);
await build({
  input: join(at, "src", "main.ts"),
  platform: "node",
  output: { dir: out, entryFileNames: "main.mjs", format: "esm" },
});
// Its version is the app's: the release sets the package's.
const manifest = { ...read("cedarloom-extension.json"), version: read("package.json").version };
writeFileSync(join(out, "cedarloom-extension.json"), `${JSON.stringify(manifest, null, 2)}\n`);
