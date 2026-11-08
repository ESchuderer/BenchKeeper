import { join } from "node:path";
import { build } from "rolldown";

// The guard and exit hooks as one file each, which a workflow package carries in its hooks folder: a package runs where
// no CedarLoom is installed. They go into the CLI package, as the app's extensions do.
const at = join(import.meta.dirname, "..");
for (const [entry, name] of [
  ["guard-hook.ts", "guard.mjs"],
  ["exit-hook.ts", "exits.mjs"],
]) {
  await build({
    input: join(at, "src", entry),
    platform: "node",
    output: { file: join(at, "..", "cli", "hooks", name), format: "esm" },
  });
}
