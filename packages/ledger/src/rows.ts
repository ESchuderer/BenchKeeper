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
  reason TEXT NOT NULL CHECK (reason IN ('most-headroom', 'no-readings')),
  readings TEXT NOT NULL,
  candidates TEXT NOT NULL
) STRICT;
`;

/** Schema 3: one contract check per agent CLI version; a check of the same version again replaces it. */
export const CHECK_TABLES = `
CREATE TABLE contract_checks (
  agent TEXT NOT NULL,
  version TEXT NOT NULL,
  missing TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (agent, version)
) STRICT;
`;

/** Schema 4: one row per worker launch; a row without finishedAt is a lease on its account. */
export const LAUNCH_TABLES = `
CREATE TABLE launches (
  runId TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  agent TEXT NOT NULL,
  account TEXT NOT NULL,
  version TEXT NOT NULL,
  pid INTEGER NOT NULL,
  startedAt TEXT NOT NULL,
  finishedAt TEXT,
  verdict TEXT CHECK (verdict IN ('pass', 'findings', 'not-run', 'failed', 'interrupted'))
) STRICT;
CREATE INDEX launches_running ON launches (account) WHERE finishedAt IS NULL;
`;

/** Schema 5: the switches of the automation level for running work, in order; level NULL ends the switch. */
export const MODE_TABLES = `
CREATE TABLE mode_switches (
  at TEXT NOT NULL,
  level TEXT CHECK (level IN ('supervised', 'checkpoint', 'auto'))
) STRICT;
`;
