import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";

const elkjs = join(import.meta.dirname, "node_modules", "elkjs");

/**
 * elkjs is used unmodified under EPL-2.0 (the owner's choice): its license text and a pointer to its source ship with
 * the bundle, as licenses/elkjs.txt next to the page.
 */
const elkNotice = (): Plugin => ({
  name: "elkjs-notice",
  generateBundle() {
    const pkg: { version: string } = JSON.parse(readFileSync(join(elkjs, "package.json"), "utf8"));
    const { version } = pkg;
    const source = [
      `elkjs ${version}, used unmodified under the Eclipse Public License 2.0 (EPL-2.0).`,
      `Source code: https://github.com/kieler/elkjs/tree/${version} (also https://www.npmjs.com/package/elkjs/v/${version}).`,
      "",
      readFileSync(join(elkjs, "LICENSE.md"), "utf8"),
    ].join("\n");
    this.emitFile({ type: "asset", fileName: "licenses/elkjs.txt", source });
  },
});

// Mantine marks its modules "use client" for React Server Components; a browser bundle has no use for the directive.
export default defineConfig({
  plugins: [elkNotice()],
  build: {
    rolldownOptions: {
      onwarn: (warning, warn) => {
        if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
      },
    },
  },
});
