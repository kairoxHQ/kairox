CREATE TABLE IF NOT EXISTS daily_portfolio_reviews (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  market_date TEXT NOT NULL,
  trigger_source TEXT NOT NULL CHECK (trigger_source IN ('manual', 'scheduled')),
  status TEXT NOT NULL CHECK (status IN ('completed', 'skipped', 'failed')),
  portfolio_value_usd REAL NOT NULL,
  daily_change_usd REAL NOT NULL,
  daily_change_pct REAL NOT NULL,
  total_return_usd REAL NOT NULL,
  total_return_pct REAL NOT NULL,
  cash_usd REAL NOT NULL,
  allocation_json TEXT NOT NULL DEFAULT '{}',
  benchmark_json TEXT NOT NULL DEFAULT '[]',
  risk_score REAL NOT NULL,
  diversification_score REAL NOT NULL,
  current_drawdown_pct REAL NOT NULL,
  maximum_drawdown_pct REAL NOT NULL,
  largest_positive_contributor_json TEXT,
  largest_negative_contributor_json TEXT,
  policy_compliant INTEGER NOT NULL CHECK (policy_compliant IN (0, 1)),
  policy_warnings_json TEXT NOT NULL DEFAULT '[]',
  data_freshness_status TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  supporting_reasons_json TEXT NOT NULL DEFAULT '[]',
  confidence_score REAL NOT NULL,
  triggered_rules_json TEXT NOT NULL DEFAULT '[]',
  relevant_metrics_json TEXT NOT NULL DEFAULT '{}',
  market_data_timestamp TEXT,
  generated_at TEXT NOT NULL,
  rule_engine_version TEXT NOT NULL,
  summary_explanation TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (portfolio_id, market_date),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

CREATE INDEX IF NOT EXISTS idx_daily_portfolio_reviews_portfolio_date
  ON daily_portfolio_reviews(portfolio_id, market_date DESC);

CREATE TABLE IF NOT EXISTS daily_review_runs (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT,
  market_date TEXT NOT NULL,
  trigger_source TEXT NOT NULL CHECK (trigger_source IN ('manual', 'scheduled')),
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'skipped', 'failed')),
  skip_reason TEXT,
  error_message TEXT,
  review_id TEXT,
  scheduled_at TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  FOREIGN KEY (review_id) REFERENCES daily_portfolio_reviews(id)
);

CREATE INDEX IF NOT EXISTS idx_daily_review_runs_portfolio_date
  ON daily_review_runs(portfolio_id, market_date DESC, started_at DESC);

CREATE TABLE IF NOT EXISTS daily_review_events (
  id TEXT PRIMARY KEY,
  review_id TEXT,
  portfolio_id TEXT NOT NULL,
  market_date TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (review_id) REFERENCES daily_portfolio_reviews(id),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

CREATE INDEX IF NOT EXISTS idx_daily_review_events_portfolio_created
  ON daily_review_events(portfolio_id, created_at DESC);
