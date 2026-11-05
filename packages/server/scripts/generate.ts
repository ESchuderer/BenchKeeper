import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openapi } from "@cedarloom/server";
import pkg from "../package.json" with { type: "json" };

await writeFile(join(import.meta.dirname, "..", "openapi.json"), await openapi(pkg.version));
