// Runs as a plain script, outside the type-checked projects: openapi-typescript's declarations name type packages it
// does not install, which tsc with skipLibCheck off would report.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import openapiTS, { astToString } from "openapi-typescript";

const root = join(import.meta.dirname, "..");
const target = join(root, "schema", "api.d.ts");
const document = await readFile(join(root, "..", "server", "openapi.json"), "utf8");
const header =
  "// Generated from packages/server/openapi.json by `pnpm --filter @cedarloom/client generate`; do not edit.\n";
const text = header + astToString(await openapiTS(document));

if (!process.argv.includes("--check")) await writeFile(target, text);
else if ((await readFile(target, "utf8")) !== text) {
  process.stderr.write(
    "schema/api.d.ts is not what the server's OpenAPI document generates: run the generate script\n",
  );
  process.exitCode = 1;
}
