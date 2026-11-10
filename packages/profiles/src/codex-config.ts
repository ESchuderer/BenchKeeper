import { isDeepStrictEqual } from "node:util";
import type { Json } from "@cedarloom/contracts";
import { parse, type TomlTable, type TomlValue } from "smol-toml";

/** A TOML text's values; undefined when it is no TOML. */
export const tomlOf = (text: string): TomlTable | undefined => {
  try {
    return parse(text);
  } catch {
    return undefined;
  }
};

const isTable = (value: TomlValue | undefined): value is TomlTable =>
  typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);

const entryIn = (text: string, server: string): TomlValue | undefined => {
  const servers = tomlOf(text)?.["mcp_servers"];
  return isTable(servers) && Object.hasOwn(servers, server) ? servers[server] : undefined;
};

// The values but the server's entry, an emptied server table dropped; the parsed table is changed in place.
const rest = (table: TomlTable, server: string): TomlTable => {
  const servers = table["mcp_servers"];
  if (!isTable(servers)) return table;
  delete servers[server];
  if (Object.keys(servers).length === 0) delete table["mcp_servers"];
  return table;
};

// Whether `after` holds `entry` as the server's (undefined: none) and every other value as `before` does.
const verified = (before: string, after: string, server: string, entry: TomlValue | undefined): boolean => {
  const [was, now] = [tomlOf(before), tomlOf(after)];
  if (was === undefined || now === undefined) return false;
  return isDeepStrictEqual(entryIn(after, server), entry) && isDeepStrictEqual(rest(was, server), rest(now, server));
};

// A profile's values hold no character that a JSON string and a TOML basic string write apart.
const tomlValue = (item: string | readonly string[]) =>
  typeof item === "string" ? JSON.stringify(item) : `[${item.map((each) => JSON.stringify(each)).join(", ")}]`;

/** A server's table as Codex reads it, one `key = value` line each. */
export const tomlTable = (server: string, pairs: readonly (readonly [string, string | readonly string[]])[]): string =>
  [`[mcp_servers.${server}]`, ...pairs.map(([key, item]) => `${key} = ${tomlValue(item)}`)].join("\n");

/**
 * The text with the table added after a blank line, in the line ending of `like` (the text before a cut), its own
 * lines left as they are.
 */
export const withTable = (text: string, table: string, like = text): string => {
  const eol = like.includes("\r\n") ? "\r\n" : "\n";
  const lines = `${table.replaceAll("\n", eol)}${eol}`;
  return text === "" ? lines : `${text.endsWith("\n") ? text : `${text}${eol}`}${eol}${lines}`;
};

const TABLE_END = /^[ \t]*(?:\[|#|\r?$)/;
// Where the table at `at` ends, and the lines a cut takes out: from the blank line before it (after it, at the top of
// the file) to that end.
const cutLines = (lines: readonly string[], at: number) => {
  const found = lines.findIndex((line, index) => index > at && TABLE_END.test(line));
  const end = found === -1 ? lines.length : found;
  const from = at > 0 && lines[at - 1]?.trim() === "" ? at - 1 : at;
  const after = at === 0 && lines[end]?.trim() === "" ? end + 1 : end;
  return { end, from, after };
};
/**
 * The text without the server's table, and the table's lines from its header without CR: its header line, the lines up
 * to a blank, `[` or `#` line, and one blank line before it (after it, at the top of the file); null when there is no
 * such header, a line of the table holds a comment, or the cut would change any other value.
 */
export const withoutTable = (text: string, server: string): { text: string; table: string } | null => {
  const lines = text.split("\n");
  const header = `[mcp_servers.${server}]`;
  const at = lines.findIndex((line) => line === header || line === `${header}\r`);
  if (at === -1) return null;
  const { end, from, after } = cutLines(lines, at);
  // No value CedarLoom writes holds `#`, so one there is the owner's comment, which a cut would drop unseen.
  if (lines.slice(at + 1, end).some((line) => line.includes("#"))) return null;
  // A CRLF file without a final break would keep the CR before the cut table on its own.
  const next = [...lines.slice(0, from), ...lines.slice(after)].join("\n").replace(/\r$/, "");
  const table = lines.slice(at, end).map((line) => line.replace(/\r$/, ""));
  return verified(text, next, server, undefined) ? { text: next, table: table.join("\n") } : null;
};

/** The server's entry as JSON, a date as its text; undefined when the text holds none. */
export const tomlEntryOf = (text: string, server: string): Json | undefined => {
  const entry = entryIn(text, server);
  return entry === undefined ? undefined : JSON.parse(JSON.stringify(entry));
};

/**
 * Whether the text holds the server's table as `table` does, none that the table would add as it is, another that the
 * table can take the place of, or one it cannot cut alone.
 */
export const tomlState = (text: string, server: string, table: string): "equal" | "absent" | "differs" | "stuck" => {
  const [current, entry] = [entryIn(text, server), entryIn(table, server)];
  if (current === undefined) return verified(text, withTable(text, table), server, entry) ? "absent" : "stuck";
  if (isDeepStrictEqual(current, entry)) return "equal";
  const cut = withoutTable(text, server);
  return cut !== null && tomlState(cut.text, server, table) === "absent" ? "differs" : "stuck";
};
