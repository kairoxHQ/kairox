CREATE TABLE IF NOT EXISTS paper_observation_runs (
  id TEXT PRIMARY KEY,
  run_key TEXT NOT NULL UNIQUE,
  observation_window TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'no_action', 'failed', 'partial_failure', 'abandoned')),
  market_data_snapshot_id TEXT,
  profiles_total INTEGER NOT NULL DEFAULT 0,
  profiles_completed INTEGER NOT NULL DEFAULT 0,
  profiles_no_action INTEGER NOT NULL DEFAULT 0,
  profiles_failed INTEGER NOT NULL DEFAULT 0,
  request_budget_json TEXT NOT NULL DEFAULT '{}',
  error_category TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_paper_observation_runs_status_window
  ON paper_observation_runs(status, observation_window DESC);

CREATE TABLE IF NOT EXISTS paper_observation_profile_runs (
  id TEXT PRIMARY KEY,
  parent_run_id TEXT NOT NULL,
  portfolio_id TEXT NOT NULL,
  profile_key TEXT NOT NULL,
  run_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'no_action', 'failed', 'abandoned')),
  summary_json TEXT,
  request_budget_json TEXT NOT NULL DEFAULT '{}',
  error_category TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT NOT NULL UNIQUE,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (parent_run_id) REFERENCES paper_observation_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_paper_observation_profile_runs_parent_status
  ON paper_observation_profile_runs(parent_run_id, status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_paper_observation_profile_runs_portfolio
  ON paper_observation_profile_runs(portfolio_id, created_at DESC);
