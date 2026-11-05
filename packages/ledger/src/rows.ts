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

/** Schema 2: the latest reading per account and usage window, and one row per launch-time account choice. */
export const ACCOUNT_TABLES = `
CREATE TABLE readings (
  account TEXT NOT NULL,
  "window" TEXT NOT NULL CHECK ("window" IN ('fiveHour', 'sevenDay')),
  usedPercent REAL NOT NULL,
  resetsAt TEXT NOT NULL,
  readAt TEXT NOT NULL,
  PRIMARY KEY (account, "window")
) STRICT;
CREATE TABLE switches (
  at TEXT NOT NULL,
  task TEXT NOT NULL,
  fromAccount TEXT,
  toAccount TEXT NOT NULL,
  readings TEXT NOT NULL,
  candidates TEXT NOT NULL
) STRICT;
`;
