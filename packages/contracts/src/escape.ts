// Unsafe characters and their escaping, in a module without schemas, so a browser bundle can import them without zod.

// Characters no shown text may hold, but the controls U+0000 to U+001F: docs/agents/cedarloom-rationale.md#unsafe-text
const INVISIBLE =
  "\\u007F-\\u009F\\u00AD\\u061C\\u180E\\u200B\\u200E\\u200F\\u2028-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF\\uFFF9-\\uFFFB";
/** The characters no shown text may hold, as ranges that mean the same with or without the u flag (JSON Schema). */
export const UNSAFE = `\\u0000-\\u001F${INVISIBLE}`;
/** UNSAFE but tab and line feed, for text of many lines. */
export const UNSAFE_LINED = `\\u0000-\\u0008\\u000B-\\u001F${INVISIBLE}`;
/** The tag characters, unsafe too; beyond 16 bits, so a pattern without the u flag cannot name them. */
export const TAGS = "\\u{E0000}-\\u{E007F}";
const unsafe = new RegExp(`[${UNSAFE}${TAGS}]`, "u");
const unsafeAll = new RegExp(`[${UNSAFE}${TAGS}]`, "gu");

/** Whether a text is plain: no control character, bidirectional control or invisible character. */
export const isPlainText = (text: string): boolean => !unsafe.test(text);

/** A character as Unicode names it: `U+202E`. */
export const codePoint = (char: string): string =>
  `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;

const escaped = (char: string): string => {
  const code = char.codePointAt(0) ?? 0;
  return code > 0xffff ? `\\u{${code.toString(16)}}` : `\\u${code.toString(16).padStart(4, "0")}`;
};

/**
 * Text from an extension or another program, for a terminal or a finding: line breaks as spaces, every other unsafe
 * character as a \u escape, at most `max` characters. Letters of any language stay as they are.
 */
export const shown = (text: string, max = 2000): string =>
  text
    .replace(/[\r\n]+/g, " ")
    .replace(unsafeAll, escaped)
    .slice(0, max);
