// Writes schema/messages.d.ts from the compiled catalog: the message ids for Lingui's Register and, per id, the values
// its placeholders take, so `t()` checks both. `pnpm run catalog` runs it after `lingui compile`; CI compares the result.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ICU argument types as TypeScript types; a plain {name} takes a string or a number.
const TYPES: Record<string, string> = { plural: "number", selectordinal: "number", number: "number", select: "string" };

/** Collects the placeholders of a compiled message: arrays of text and [name, type?, branches?] tokens. */
const placeholders = (message: unknown, found: Map<string, string>): void => {
  if (!Array.isArray(message)) return;
  for (const token of message) {
    if (!Array.isArray(token)) continue;
    const [name, type, branches]: unknown[] = token;
    // The first use names the type: a select's own {name} inside its branches stays a select.
    if (!found.has(String(name))) found.set(String(name), TYPES[String(type)] ?? "string | number");
    if (typeof branches === "object" && branches !== null)
      for (const branch of Object.values(branches)) placeholders(branch, found);
  }
};

const root = join(import.meta.dirname, "..");
const catalog: unknown = JSON.parse(await readFile(join(root, "locales", "en", "messages.json"), "utf8"));
const messages = typeof catalog === "object" && catalog !== null && "messages" in catalog ? catalog.messages : {};
const entries = Object.entries(messages ?? {}).map(([id, message]) => {
  const found = new Map<string, string>();
  placeholders(message, found);
  const values = [...found].map(([name, type]) => `${name}: ${type}`).join("; ");
  return `  ${JSON.stringify(id)}: ${values === "" ? "Record<never, never>" : `{ ${values} }`};`;
});
const text = `// Generated from locales/en/messages.po by \`pnpm run catalog\`; do not edit.
declare module "@lingui/core" {
  interface Register {
    messageIds: keyof MessageValues;
  }
}

/** The values each message of the catalog takes, by id. */
export interface MessageValues {
${entries.join("\n")}
}
`;
await writeFile(join(root, "schema", "messages.d.ts"), text);
