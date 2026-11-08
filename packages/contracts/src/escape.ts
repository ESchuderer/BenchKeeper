// Unsafe characters and their escaping, in a module without schemas, so a browser bundle can import them without zod.

// Characters no shown text may hold: docs/agents/cedarloom-rationale.md#unsafe-text
// The controls (\p{Cc}) as their two ranges: a JSON Schema pattern then means the same with or without the u flag.
export const UNSAFE = "\\u0000-\\u001F\\u007F-\\u009F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069";
const unsafe = new RegExp(`[${UNSAFE}]`, "u");
const unsafeAll = new RegExp(`[${UNSAFE}]`, "gu");

/** Whether a text is plain: no control character and no bidirectional control. */
export const isPlainText = (text: string): boolean => !unsafe.test(text);

/**
 * Text from an extension or another program, for a terminal or a finding: line breaks as spaces, every other control
 * and bidirectional character as a \u escape, at most `max` characters. Letters of any language stay as they are.
 */
export const shown = (text: string, max = 2000): string =>
  text
    .replace(/[\r\n]+/g, " ")
    .replace(unsafeAll, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`)
    .slice(0, max);
