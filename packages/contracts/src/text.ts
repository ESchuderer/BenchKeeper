import { z } from "zod";
import { codePoint, TAGS, UNSAFE, UNSAFE_LINED } from "./escape.ts";

const tag = new RegExp(`[${TAGS}]`, "u");

/**
 * A text an extension shows, in its manifest or a catalog: plain, and shown as is. No value is formatted into it, so
 * it is no ICU message (coordinator, 2026-11-06); a feature that needs values brings a real ICU compiler.
 */
export const PlainText = z
  .string()
  .regex(new RegExp(`^[^${UNSAFE}]*$`, "u"), "no control, bidirectional or invisible character")
  .refine((text) => !tag.test(text), "no tag character");

/** Zero width non-joiner and joiner: prose in scripts such as Persian or Devanagari needs them, and no command does. */
const JOINERS = "\\u200C\\u200D";

/** Refuses a text by the first character `refused` matches, named as U+XXXX: a finding says what nobody sees (hub 198). */
export const refusing = (refused: string) => {
  const pattern = new RegExp(`[${refused}]`, "u");
  return (text: string, ctx: z.RefinementCtx): void => {
    const char = pattern.exec(text)?.[0];
    if (char !== undefined) {
      ctx.addIssue({ code: "custom", message: `holds ${codePoint(char)}`, params: { char: codePoint(char) } });
    }
  };
};

// A text of many lines that refuses `refused` and tags, with the pattern of its 16-bit part for the JSON Schema.
const lined = (refused: string) =>
  z
    .string()
    .superRefine(refusing(`${refused}${TAGS}`))
    .meta({ pattern: `^[^${refused}]*$` });

/** Text of many lines a workflow or profile holds for people and agents: tabs, line breaks and joiners, no unsafe one. */
export const LinedText = lined(UNSAFE_LINED);

/** Text of many lines a shell runs: as LinedText, without joiners. */
export const CommandText = lined(`${UNSAFE_LINED}${JOINERS}`);

/** The characters a path may not hold: the unsafe ones, joiners and tags, line breaks and tabs among them. */
export const PATH_REFUSED = `${UNSAFE}${JOINERS}${TAGS}`;
