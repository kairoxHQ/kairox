CREATE TABLE IF NOT EXISTS ira_alternative_comparisons (
  id TEXT PRIMARY KEY,
  baseline_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  starting_value_usd REAL NOT NULL CHECK (starting_value_usd = 2400),
  start_timestamp TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'initialized',
  paper_only INTEGER NOT NULL DEFAULT 1 CHECK (paper_only = 1),
  live_trading_enabled INTEGER NOT NULL DEFAULT 0 CHECK (live_trading_enabled = 0),
  automatic_live_execution_enabled INTEGER NOT NULL DEFAULT 0 CHECK (automatic_live_execution_enabled = 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ira_alternative_baselines (
  id TEXT PRIMARY KEY,
  comparison_id TEXT NOT NULL UNIQUE,
  starting_value_usd REAL NOT NULL CHECK (starting_value_usd = 2400),
  start_timestamp TEXT NOT NULL,
  accrual_convention TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (comparison_id) REFERENCES ira_alternative_comparisons(id)
);

CREATE TABLE IF NOT EXISTS ira_alternative_benchmarks (
  id TEXT PRIMARY KEY,
  comparison_id TEXT NOT NULL,
  alternative_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  benchmark_type TEXT NOT NULL,
  starting_value_usd REAL NOT NULL CHECK (starting_value_usd = 2400),
  apy REAL NOT NULL,
  source_label TEXT NOT NULL,
  liquidity_classification TEXT NOT NULL,
  lock_term_months INTEGER,
  early_withdrawal_penalty_status TEXT NOT NULL,
  early_withdrawal_penalty_json TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (comparison_id) REFERENCES ira_alternative_comparisons(id),
  UNIQUE (comparison_id, alternative_key)
);

CREATE TABLE IF NOT EXISTS ira_alternative_strategy_portfolios (
  id TEXT PRIMARY KEY,
  comparison_id TEXT NOT NULL,
  portfolio_id TEXT NOT NULL UNIQUE,
  strategy_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  starting_value_usd REAL NOT NULL CHECK (starting_value_usd = 2400),
  start_timestamp TEXT NOT NULL,
  parameters_json TEXT NOT NULL,
  asset_universe_json TEXT NOT NULL,
  profile_enabled INTEGER NOT NULL DEFAULT 0 CHECK (profile_enabled = 0),
  paper_only INTEGER NOT NULL DEFAULT 1 CHECK (paper_only = 1),
  live_trading_enabled INTEGER NOT NULL DEFAULT 0 CHECK (live_trading_enabled = 0),
  automatic_live_execution_enabled INTEGER NOT NULL DEFAULT 0 CHECK (automatic_live_execution_enabled = 0),
  status TEXT NOT NULL DEFAULT 'initialized',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (comparison_id) REFERENCES ira_alternative_comparisons(id),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  UNIQUE (comparison_id, strategy_key)
);

CREATE TABLE IF NOT EXISTS ira_alternative_daily_snapshots (
  id TEXT PRIMARY KEY,
  comparison_id TEXT NOT NULL,
  alternative_id TEXT NOT NULL,
  alternative_key TEXT NOT NULL,
  alternative_type TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  snapshot_timestamp TEXT NOT NULL,
  starting_value_usd REAL NOT NULL,
  current_value_usd REAL NOT NULL,
  return_pct REAL NOT NULL,
  diff_vs_share_usd REAL,
  diff_vs_certificate_usd REAL,
  cash_usd REAL,
  holdings_value_usd REAL,
  fees_usd REAL,
  drawdown_pct REAL,
  trade_count INTEGER NOT NULL DEFAULT 0,
  data_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (comparison_id) REFERENCES ira_alternative_comparisons(id),
  UNIQUE (comparison_id, alternative_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_ira_alternative_benchmarks_comparison
  ON ira_alternative_benchmarks(comparison_id, active);

CREATE INDEX IF NOT EXISTS idx_ira_alternative_strategy_portfolios_comparison
  ON ira_alternative_strategy_portfolios(comparison_id, status);

CREATE INDEX IF NOT EXISTS idx_ira_alternative_daily_snapshots_lookup
  ON ira_alternative_daily_snapshots(comparison_id, snapshot_date, alternative_key);
