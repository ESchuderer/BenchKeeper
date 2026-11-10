import { isDeepStrictEqual } from "node:util";
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

/** The text with the table added after a blank line, its own lines left as they are. */
export const withTable = (text: string, table: string): string =>
  text === "" ? `${table}\n` : `${text.endsWith("\n") ? text : `${text}\n`}\n${table}\n`;

/** Whether the text holds the server's table as `table` does, none that the table would add as it is, or another. */
export const tomlState = (text: string, server: string, table: string): "equal" | "absent" | "differs" => {
  const [current, entry] = [entryIn(text, server), entryIn(table, server)];
  if (current === undefined) return verified(text, withTable(text, table), server, entry) ? "absent" : "differs";
  return isDeepStrictEqual(current, entry) ? "equal" : "differs";
};

const TABLE_END = /^[ \t]*(?:\[|#|\r?$)/;
/**
 * The text without the server's table: its header line, the lines up to a blank, `[` or `#` line, and one blank line
 * before it; null when there is no such header or the cut would change any other value.
 */
export const withoutTable = (text: string, server: string): string | null => {
  const lines = text.split("\n");
  const header = `[mcp_servers.${server}]`;
  const at = lines.findIndex((line) => line === header || line === `${header}\r`);
  if (at === -1) return null;
  const end = lines.findIndex((line, index) => index > at && TABLE_END.test(line));
  const from = at > 0 && lines[at - 1]?.trim() === "" ? at - 1 : at;
  const next = [...lines.slice(0, from), ...lines.slice(end === -1 ? lines.length : end)].join("\n");
  return verified(text, next, server, undefined) ? next : null;
};
