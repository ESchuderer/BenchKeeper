import { z } from "zod";

// Characters no shown text may hold: docs/agents/cedarloom-rationale.md#unsafe-text
export const UNSAFE = "\\p{Cc}\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069";
const unsafe = new RegExp(`[${UNSAFE}]`, "u");
const unsafeAll = new RegExp(`[${UNSAFE}]`, "gu");

/** Whether a text is plain: no control character and no bidirectional control. */
export const isPlainText = (text: string): boolean => !unsafe.test(text);

/**
 * A text an extension shows, in its manifest or a catalog: plain, and shown as is. No value is formatted into it, so
 * it is no ICU message (coordinator, 2026-11-06); a feature that needs values brings a real ICU compiler.
 */
export const PlainText = z
  .string()
  .regex(new RegExp(`^[^${UNSAFE}]*$`, "u"), "no control character and no bidirectional control");

/**
 * Text from an extension or another program, for a terminal or a finding: line breaks as spaces, every other control
 * and bidirectional character as a \u escape, at most `max` characters. Letters of any language stay as they are.
 */
export const shown = (text: string, max = 2000): string =>
  text
    .replace(/[\r\n]+/g, " ")
    .replace(unsafeAll, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`)
    .slice(0, max);
