import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/** Calls `each` with every line of a JSON Lines file, streamed: one session log can be hundreds of megabytes. */
export const eachLine = async (file: string, each: (line: string) => void): Promise<void> => {
  const lines = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) each(line);
};

/** The line's JSON value; undefined for a torn line, as the last one is while the agent writes it. */
export const jsonOf = (line: string): unknown => {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
};

/** An ISO time as the contracts write it, or null for a value that is no time or lies past year 9999. */
export const isoOf = (value: string | null | undefined): string | null => {
  const time = value == null ? Number.NaN : Date.parse(value);
  const iso = Number.isNaN(time) ? null : new Date(time).toISOString();
  // A six-digit year (+010000-...) would sort before every other time.
  return iso !== null && /^\d{4}-/.test(iso) ? iso : null;
};

const STAMP = /"timestamp":"([^"]+)"/g;

// The line's own time: a nested one, as a tool's input can hold, may come first, so a line with several is parsed.
const stampOf = (line: string): string | undefined => {
  const stamps = [...line.matchAll(STAMP)];
  if (stamps.length < 2) return stamps[0]?.[1];
  const json = jsonOf(line);
  const own = typeof json === "object" && json !== null && "timestamp" in json ? json.timestamp : undefined;
  return typeof own === "string" ? own : undefined;
};

/** A log's start and end: the times of its first and its last line that has one. */
export class Span {
  first: string | null = null;
  last: string | null = null;

  at(line: string): void {
    const stamp = stampOf(line);
    if (stamp === undefined || Number.isNaN(Date.parse(stamp))) return;
    this.first ??= stamp;
    this.last = stamp;
  }
}
