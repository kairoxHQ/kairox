CREATE TABLE IF NOT EXISTS daily_orchestration_runs (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  market_date TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('Scheduled', 'Manual protected', 'Recovery retry', 'Administrative refresh')),
  refresh_mode TEXT NOT NULL DEFAULT 'normal',
  actor TEXT NOT NULL DEFAULT 'system',
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Running', 'Completed', 'Completed with warnings', 'Data unavailable', 'Failed', 'Superseded')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  current_stage TEXT NOT NULL,
  stage_results_json TEXT NOT NULL DEFAULT '[]',
  source_market_data_timestamps_json TEXT NOT NULL DEFAULT '{}',
  valuation_json TEXT NOT NULL DEFAULT '{}',
  snapshot_id TEXT,
  benchmark_update_ids_json TEXT NOT NULL DEFAULT '[]',
  daily_cycle_id TEXT,
  decision_id TEXT,
  briefing_id TEXT,
  journey_event_ids_json TEXT NOT NULL DEFAULT '[]',
  reconciliation_json TEXT NOT NULL DEFAULT '{}',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  error_details TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  superseding_run_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  UNIQUE(portfolio_id, market_date, trigger_type, refresh_mode)
);

CREATE INDEX IF NOT EXISTS idx_daily_orchestration_runs_portfolio_date
  ON daily_orchestration_runs(portfolio_id, market_date DESC, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_daily_orchestration_runs_status
  ON daily_orchestration_runs(status, started_at DESC);
