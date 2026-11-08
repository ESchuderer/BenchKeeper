/** Runs of plans and their steps; store.ts creates these tables and the ones below at once, as the 0.1.0 schema. */
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
  finishedAt TEXT,
  pruned INTEGER NOT NULL DEFAULT 0 CHECK (pruned IN (0, 1))
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

// Hub issue writes the file ledger cannot undo (section 6.4), approved by hash, once per key.
export const OUTBOX_TABLES = `
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  intent TEXT NOT NULL,
  intentHash TEXT NOT NULL,
  approvedHash TEXT NOT NULL CHECK (approvedHash = intentHash),
  approvedBy TEXT NOT NULL CHECK (approvedBy IN ('owner', 'mirroring')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  unchanged INTEGER CHECK (unchanged IN (0, 1)),
  remote TEXT,
  finding TEXT,
  createdAt TEXT NOT NULL,
  settledAt TEXT
) STRICT;
`;
