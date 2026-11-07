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

/** The latest reading per account and usage window, from any source, and one row per launch-time account choice. */
export const ACCOUNT_TABLES = `
CREATE TABLE readings (
  account TEXT NOT NULL,
  "window" TEXT NOT NULL CHECK ("window" IN ('fiveHour', 'sevenDay') OR "window" GLOB 'sevenDay:[a-z]*'),
  usedPercent REAL NOT NULL,
  resetsAt TEXT,
  readAt TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('worker', 'cswap')),
  PRIMARY KEY (account, "window")
) STRICT;
CREATE TABLE switches (
  at TEXT NOT NULL,
  task TEXT NOT NULL,
  fromAccount TEXT,
  toAccount TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('most-headroom', 'soonest-weekly-reset', 'highest-tier', 'no-readings')),
  trigger TEXT NOT NULL CHECK (trigger IN ('launch', 'line', 'at-limit')),
  readings TEXT NOT NULL,
  candidates TEXT NOT NULL
) STRICT;
`;

/** One contract check per agent CLI version; a check of the same version again replaces it. */
export const CHECK_TABLES = `
CREATE TABLE contract_checks (
  agent TEXT NOT NULL,
  version TEXT NOT NULL,
  missing TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (agent, version)
) STRICT;
`;

/**
 * One row per worker launch; a row without finishedAt is a lease on its account. Each keeps the settings it ran with
 * (A90), and the plugins its init line named (canonical JSON; null before the line).
 */
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
  verdict TEXT CHECK (verdict IN ('pass', 'findings', 'not-run', 'failed', 'interrupted')),
  labels TEXT NOT NULL,
  plugins TEXT,
  totals TEXT
) STRICT;
CREATE INDEX launches_running ON launches (account) WHERE finishedAt IS NULL;
`;

/** The switches of the automation level for running work, in order; level NULL ends the switch. */
export const MODE_TABLES = `
CREATE TABLE mode_switches (
  at TEXT NOT NULL,
  level TEXT CHECK (level IN ('supervised', 'checkpoint', 'auto'))
) STRICT;
`;

/** Every usage window a session reported, as history (A84); readings keeps the latest per quota. */
export const USAGE_TABLES = `
CREATE TABLE usage_samples (
  account TEXT NOT NULL,
  agent TEXT NOT NULL,
  agentVersion TEXT NOT NULL,
  "window" TEXT NOT NULL,
  quota TEXT CHECK (quota IN ('fiveHour', 'sevenDay') OR quota GLOB 'sevenDay:[a-z]*'),
  usedPercent REAL CHECK (usedPercent BETWEEN 0 AND 100),
  resetsAt TEXT,
  readAt TEXT NOT NULL,
  runId TEXT,
  raw TEXT NOT NULL
) STRICT;
CREATE INDEX usage_samples_by_account ON usage_samples (account, readAt);
`;

/**
 * Graph runs (M6), each in the real path of its project folder. The events are the source of truth; a run's status
 * and its attempts are projections, written in the same transaction as their event. A run's runner holds it by its
 * lease lock, as a launch does.
 */
export const GRAPH_TABLES = `
CREATE TABLE graph_runs (
  id TEXT PRIMARY KEY,
  workflowId TEXT NOT NULL,
  definition TEXT NOT NULL,
  definitionHash TEXT NOT NULL,
  inputs TEXT NOT NULL,
  "trigger" TEXT NOT NULL CHECK ("trigger" IN ('manual', 'schedule')),
  mode TEXT NOT NULL CHECK (mode IN ('act', 'report')),
  status TEXT NOT NULL CHECK (status IN ('running', 'waiting', 'succeeded', 'failed', 'cancelled', 'skipped')),
  parentRun TEXT REFERENCES graph_runs (id),
  parentNode TEXT,
  project TEXT NOT NULL,
  pid INTEGER NOT NULL,
  epoch INTEGER NOT NULL,
  startedAt TEXT NOT NULL,
  finishedAt TEXT
) STRICT;
CREATE TABLE node_attempts (
  runId TEXT NOT NULL REFERENCES graph_runs (id),
  nodeId TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  state TEXT NOT NULL
    CHECK (state IN ('ready', 'running', 'waiting', 'done', 'failed', 'timed-out', 'cancelled', 'interrupted')),
  outputs TEXT,
  finding TEXT,
  sessionId TEXT,
  pid INTEGER,
  applyRun TEXT REFERENCES runs (id),
  startedAt TEXT NOT NULL,
  finishedAt TEXT,
  PRIMARY KEY (runId, nodeId, attempt)
) STRICT;
CREATE TABLE run_events (
  runId TEXT NOT NULL REFERENCES graph_runs (id),
  seq INTEGER NOT NULL,
  at TEXT NOT NULL,
  type TEXT NOT NULL,
  nodeId TEXT,
  attempt INTEGER,
  payload TEXT NOT NULL,
  PRIMARY KEY (runId, seq)
) STRICT;
CREATE TABLE gates (
  id TEXT PRIMARY KEY,
  runId TEXT NOT NULL REFERENCES graph_runs (id),
  nodeId TEXT NOT NULL,
  point TEXT NOT NULL CHECK (point IN ('before-node', 'before-apply', 'human.approval')),
  level TEXT CHECK (level IN ('supervised', 'checkpoint', 'auto')),
  requestedAt TEXT NOT NULL,
  decidedAt TEXT,
  decision TEXT CHECK (decision IN ('approved', 'rejected')),
  "by" TEXT
) STRICT;
`;
