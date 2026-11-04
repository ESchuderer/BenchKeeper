import { z } from "zod";

export const Run = z.object({
  id: z.string(),
  kind: z.enum(["apply", "undo"]),
  undoes: z.string().nullable(),
  planHash: z.string(),
  status: z.enum(["running", "applied", "failed", "interrupted"]),
  epoch: z.int(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type Run = z.infer<typeof Run>;

/** One operation of a run as the journal records it; `after` is null for a delete. */
export const Step = z.object({
  index: z.int(),
  path: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  state: z.enum(["pending", "running", "done", "skipped"]),
  mode: z.int().nullable(),
});
export type Step = z.infer<typeof Step>;

export const TABLES = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL) STRICT;
INSERT INTO meta VALUES ('epoch', 0);
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('apply', 'undo')),
  undoes TEXT REFERENCES runs (id),
  plan TEXT NOT NULL,
  planHash TEXT NOT NULL,
  approvedHash TEXT NOT NULL CHECK (approvedHash = planHash),
  status TEXT NOT NULL CHECK (status IN ('running', 'applied', 'failed', 'interrupted')),
  epoch INTEGER NOT NULL,
  startedAt TEXT NOT NULL,
  finishedAt TEXT
) STRICT;
CREATE TABLE steps (
  runId TEXT NOT NULL REFERENCES runs (id),
  "index" INTEGER NOT NULL,
  path TEXT NOT NULL,
  before TEXT,
  after TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'done', 'skipped')),
  mode INTEGER,
  PRIMARY KEY (runId, "index")
) STRICT;
`;
