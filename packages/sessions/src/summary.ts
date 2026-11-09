import { z } from "zod";

const count = z.number().min(0);

// What the cache keeps of a log.
export const Summary = z.strictObject({
  id: z.string(),
  folder: z.string().nullable(),
  project: z.string().nullable(),
  title: z.string().nullable(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  busyMs: count.nullable(),
  tokens: count,
  costUSD: count.nullable(),
  tests: z.enum(["pass", "fail"]).nullable(),
});
export type Summary = z.infer<typeof Summary>;
