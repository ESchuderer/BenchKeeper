import { z } from "zod";
import { UNSAFE } from "./escape.ts";

/**
 * A text an extension shows, in its manifest or a catalog: plain, and shown as is. No value is formatted into it, so
 * it is no ICU message (coordinator, 2026-11-06); a feature that needs values brings a real ICU compiler.
 */
export const PlainText = z
  .string()
  .regex(new RegExp(`^[^${UNSAFE}]*$`, "u"), "no control character and no bidirectional control");

/**
 * Text of many lines that a workflow runs or a profile writes: tabs and line breaks, but no other control character and
 * no bidirectional control, so a reviewed text cannot show one line and hold another (hub 198).
 */
export const LinedText = z
  .string()
  .regex(new RegExp(`^(?:[\\t\\n]|[^${UNSAFE}])*$`, "u"), "no control character but tab and line break");
