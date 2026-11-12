import { readFileSync } from "node:fs";

/** The CedarLoom release this is; the application packages share one version. */
export const APP_VERSION: string = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
