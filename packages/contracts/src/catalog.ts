import type { Result } from "./documents.ts";

/** A plugin's catalog for one language: each English text of its manifest to the text in that language. */
export type Catalog = ReadonlyMap<string, string>;
/** A read catalog, and the English texts whose translation names other placeholders, which stay English. */
export type CatalogRead = { messages: Catalog; mismatched: string[] };

/** Bounds for a catalog from elsewhere: its size, its entries, and the length of one text. */
export const CATALOG_LIMITS = { bytes: 256 * 1024, entries: 2000, text: 2000 };

type Entry = { msgid?: string; msgstr?: string; skip: boolean };
type Field = "msgid" | "msgstr" | "other";
type Problem = { line: number; code: string };

const refused = ({ line, code }: Problem): Result<never> => ({
  ok: false,
  finding: { code: "document.invalid", params: { issues: [{ path: `line ${line}`, code }] } },
});

const ESCAPES = new Map([
  ["n", "\n"],
  ["t", "\t"],
  ["r", "\r"],
  ['"', '"'],
  ["\\", "\\"],
]);

/** The text of a quoted PO string with its escapes, or the code of what is wrong with it. */
const unquote = (quoted: string): string | { code: string } => {
  if (!/^"(?:[^"\\]|\\.)*"$/.test(quoted)) return { code: "bad_string" };
  const body = quoted.slice(1, -1);
  // Escape pairs read left to right, so `\\n` is a backslash and an n.
  const escaped = [...body.matchAll(/\\(.)/g)].map(([, char]) => char ?? "");
  if (escaped.some((char) => !ESCAPES.has(char))) return { code: "bad_escape" };
  const text = body.replace(/\\(.)/g, (_, char: string) => ESCAPES.get(char) ?? char);
  return text.length > CATALOG_LIMITS.text ? { code: "too_big" } : text;
};

// The placeholders of a message, `{name}` and the head of `{count, plural, ...}`.
const placeholders = (text: string): Set<string | undefined> =>
  new Set([...text.matchAll(/\{([A-Za-z0-9_]+)/g)].map(([, name]) => name));
const samePlaceholders = (english: string, translated: string): boolean => {
  const [mine, theirs] = [placeholders(english), placeholders(translated)];
  return mine.size === theirs.size && [...mine].every((name) => theirs.has(name));
};

/** Keeps a finished entry: a translated message, not the header, not fuzzy, plural or in a context. */
const keep = (entry: Entry, messages: Map<string, string>, mismatched: string[]): string | undefined => {
  const { msgid = "", msgstr = "" } = entry;
  if (entry.skip || msgid === "" || msgstr === "") return undefined;
  if (messages.has(msgid) || mismatched.includes(msgid)) return "duplicate_msgid";
  if (samePlaceholders(msgid, msgstr)) messages.set(msgid, msgstr);
  else mismatched.push(msgid);
  return undefined;
};

// A line's keyword and quoted rest: `msgid "x"`, `msgstr "x"`, a continuation `"x"`, or another gettext keyword.
const KEYWORD = /^(msgid|msgstr|msgctxt|msgid_plural|msgstr\[\d+\])?[ \t]*("[\s\S]*)$/;

/**
 * Reads a plugin's PO catalog, the gettext format Lingui reads too
 * (https://www.gnu.org/software/gettext/manual/html_node/PO-Files.html): entries of a `msgid`, the English text, and a
 * `msgstr`, its translation, each a quoted string that more quoted lines continue. As gettext does, the header entry,
 * fuzzy entries (`#, fuzzy`) and empty translations are not used; entries in a context or with plural forms name no
 * manifest text and are skipped too. A file over the bounds, or with a line that is none of these, is refused whole.
 */
export const readCatalog = (text: string): Result<CatalogRead> => {
  if (new TextEncoder().encode(text).length > CATALOG_LIMITS.bytes) return refused({ line: 1, code: "too_big" });
  const messages = new Map<string, string>();
  const mismatched: string[] = [];
  let entry: Entry = { skip: false };
  let field: Field = "other";
  const lines = [...text.split(/\r?\n/), ""];
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    const next = step(line, entry, field);
    if ("code" in next) return refused({ line: index + 1, code: next.code });
    if (next.ended) {
      const problem = keep(entry, messages, mismatched);
      if (problem !== undefined) return refused({ line: index + 1, code: problem });
      if (messages.size + mismatched.length > CATALOG_LIMITS.entries)
        return refused({ line: index + 1, code: "too_big" });
    }
    ({ entry, field } = next);
  }
  return { ok: true, value: { messages, mismatched } };
};

type Step = { entry: Entry; field: Field; ended: boolean } | { code: string };

// A comment, or the flags of the entry: a fuzzy translation is not used.
const comment = (line: string, entry: Entry, field: Field): Step => {
  const fuzzy = line.startsWith("#,") && /\bfuzzy\b/.test(line);
  return { entry: fuzzy ? { ...entry, skip: true } : entry, field, ended: false };
};

// msgid and msgstr set their field; a context or plural forms mark an entry that names no manifest text. Entries are
// separated by blank lines, as gettext writes them, so a second msgid in one entry is refused.
const keyworded = (keyword: string, part: string, entry: Entry): Step => {
  if (keyword === "msgid" && entry.msgid !== undefined) return { code: "unexpected_line" };
  if (keyword === "msgid" || keyword === "msgstr") {
    return { entry: { ...entry, [keyword]: part }, field: keyword, ended: false };
  }
  return { entry: { ...entry, skip: true }, field: "other", ended: false };
};

/** One line read into the entry: a blank line that ends it, a comment or flag, a keyword, or a continuation. */
const step = (line: string, entry: Entry, field: Field): Step => {
  if (line === "") return { entry: { skip: false }, field: "other", ended: true };
  if (line.startsWith("#")) return comment(line, entry, field);
  const match = KEYWORD.exec(line);
  if (match === null) return { code: "unexpected_line" };
  const [, keyword, quoted = ""] = match;
  const part = unquote(quoted);
  if (typeof part !== "string") return part;
  return keyword === undefined ? continued(entry, field, part) : keyworded(keyword, part, entry);
};

// A quoted line that continues the msgid or msgstr before it; after anything else it has nothing to continue.
const continued = (entry: Entry, field: Field, part: string): Step => {
  if (field === "other") return entry.skip ? { entry, field, ended: false } : { code: "unexpected_line" };
  const joined = `${entry[field] ?? ""}${part}`;
  return joined.length > CATALOG_LIMITS.text
    ? { code: "too_big" }
    : { entry: { ...entry, [field]: joined }, field, ended: false };
};

/**
 * A text in the user's language: its translation for the locale, then for the locale without its last part (`pt-BR`,
 * then `pt`), else the English text itself.
 */
export const translate = (english: string, locale: string, catalogs: ReadonlyMap<string, Catalog>): string => {
  const parts = locale.split("-");
  for (let count = parts.length; count > 0; count -= 1) {
    const text = catalogs.get(parts.slice(0, count).join("-"))?.get(english);
    if (text !== undefined) return text;
  }
  return english;
};
