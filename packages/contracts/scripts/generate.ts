import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { documents } from "./documents.ts";

const root = join(import.meta.dirname, "..");
const docs = documents();
for (const name of await readdir(join(root, "schema")).catch(() => [])) {
  if (!docs.has(`schema/${name}`)) await rm(join(root, "schema", name));
}
for (const [path, text] of docs) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
}
