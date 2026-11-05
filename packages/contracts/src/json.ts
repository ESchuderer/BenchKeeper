/** A JSON value; an `undefined` property is absent, as in `JSON.stringify`. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json | undefined };

// An object's present entries, keys sorted by UTF-16 code units.
const sortedEntries = (value: { [key: string]: Json | undefined }): (readonly [string, Json])[] =>
  Object.entries(value)
    .flatMap(([key, item]) => (item === undefined ? [] : [[key, item] as const]))
    .toSorted(([a], [b]) => (a < b ? -1 : 1));

/** JSON with object keys sorted by UTF-16 code units and no whitespace: equal values give equal text (RFC 8785 for the values CedarLoom stores). */
export const canonicalJson = (value: Json): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  return `{${sortedEntries(value)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
};

/** A copy with each object's keys sorted, which `JSON.stringify` keeps (integer-like keys always come first in JS). */
export const sortKeys = (value: Json): Json => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(sortedEntries(value).map(([key, item]) => [key, sortKeys(item)]));
};
