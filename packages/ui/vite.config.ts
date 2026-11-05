import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";

const elkjs = join(import.meta.dirname, "node_modules", "elkjs");

const pkg: { version: string } = JSON.parse(readFileSync(join(elkjs, "package.json"), "utf8"));
const source = `https://github.com/kieler/elkjs/tree/${pkg.version}`;
// The copyright notices of elkjs's source, which a copy we ship has to keep (EPL-2.0, section 3.3).
const copyrights = [
  ...new Set(readFileSync(join(elkjs, "lib", "elk-api.js"), "utf8").match(/Copyright \(c\) [^\n]+/g) ?? []),
];

/**
 * elkjs is used under EPL-2.0 (the owner's choice). The minifier drops the comments of elk-api.js, so its chunk gets
 * the copyright notices back as a first line, and licenses/elkjs.txt next to the page holds them with the license
 * text and where the source is (section 3.1).
 */
const elkNotice = (): Plugin => ({
  name: "elkjs-notice",
  // After minification, which drops every comment of elk-api.js.
  generateBundle(_options, bundle) {
    for (const chunk of Object.values(bundle)) {
      if (chunk.type === "chunk" && chunk.moduleIds.some((id) => /elkjs[\\/]lib[\\/]elk-api\.js$/.test(id)))
        chunk.code = `/*! elkjs ${pkg.version} | ${copyrights.join(" | ")} | EPL-2.0, source: ${source} */\n${chunk.code}`;
    }
    const text = [
      `elkjs ${pkg.version} is used under the Eclipse Public License 2.0 (EPL-2.0).`,
      `Its source code is available under the EPL-2.0 at ${source} (also https://www.npmjs.com/package/elkjs/v/${pkg.version}).`,
      "elk-worker.min.js ships unmodified; elk-api.js ships bundled and minified from the unmodified source.",
      "",
      ...copyrights,
      "",
      readFileSync(join(elkjs, "LICENSE.md"), "utf8"),
    ].join("\n");
    this.emitFile({ type: "asset", fileName: "licenses/elkjs.txt", source: text });
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
