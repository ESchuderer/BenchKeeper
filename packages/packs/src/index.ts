import { fileURLToPath } from "node:url";

/** The packs that ship with CedarLoom, a folder each, named by pack id; the same place from `src` and from `dist`. */
export const BUNDLED = fileURLToPath(new URL("../bundled/", import.meta.url));
