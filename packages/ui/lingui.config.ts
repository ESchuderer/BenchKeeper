import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";

// The PO catalog is the source: messages carry explicit ids and are written there, not extracted from code by a macro.
// `pnpm run catalog` compiles it to locales/en/messages.json, from which TypeScript takes the message ids.
export default defineConfig({
  locales: ["en"],
  sourceLocale: "en",
  catalogs: [{ path: "<rootDir>/locales/{locale}/messages", include: [] }],
  format: formatter({ lineNumbers: false }),
});
