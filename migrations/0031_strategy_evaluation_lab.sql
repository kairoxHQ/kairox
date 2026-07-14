CREATE TABLE IF NOT EXISTS strategy_lab_programs (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  name TEXT NOT NULL,
  starting_capital_usd REAL NOT NULL,
  start_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'retired')),
  evidence_thresholds_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  UNIQUE(portfolio_id, name, status)
);

CREATE TABLE IF NOT EXISTS strategy_lab_strategies (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL,
  strategy_name TEXT NOT NULL,
  strategy_version TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'retired')),
  target_weights_json TEXT NOT NULL,
  rules_json TEXT NOT NULL DEFAULT '{}',
  rebalance_frequency TEXT NOT NULL,
  change_notes TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (program_id) REFERENCES strategy_lab_programs(id),
  UNIQUE(program_id, strategy_name, strategy_version)
);

CREATE TABLE IF NOT EXISTS strategy_lab_daily_valuations (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL,
  portfolio_id TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  market_date TEXT NOT NULL,
  starting_capital_usd REAL NOT NULL,
  portfolio_value_usd REAL NOT NULL,
  cash_usd REAL NOT NULL,
  invested_value_usd REAL NOT NULL,
  daily_return REAL,
  cumulative_return REAL NOT NULL,
  drawdown REAL NOT NULL,
  high_water_mark_usd REAL NOT NULL,
  volatility REAL,
  sharpe_ratio REAL,
  sortino_ratio REAL,
  win_rate REAL,
  turnover REAL NOT NULL DEFAULT 0,
  allocation_json TEXT NOT NULL DEFAULT '{}',
  risk_metrics_json TEXT NOT NULL DEFAULT '{}',
  market_data_snapshot_id TEXT,
  data_quality_status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (program_id) REFERENCES strategy_lab_programs(id),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  FOREIGN KEY (strategy_id) REFERENCES strategy_lab_strategies(id),
  UNIQUE(program_id, strategy_id, market_date)
);

CREATE TABLE IF NOT EXISTS strategy_lab_virtual_positions (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  market_date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  quantity REAL NOT NULL,
  average_cost_usd REAL NOT NULL,
  market_value_usd REAL NOT NULL,
  allocation_pct REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (program_id) REFERENCES strategy_lab_programs(id),
  FOREIGN KEY (strategy_id) REFERENCES strategy_lab_strategies(id),
  UNIQUE(program_id, strategy_id, market_date, symbol)
);

CREATE TABLE IF NOT EXISTS strategy_lab_virtual_trades (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  market_date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity REAL NOT NULL,
  price_usd REAL NOT NULL,
  notional_usd REAL NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (program_id) REFERENCES strategy_lab_programs(id),
  FOREIGN KEY (strategy_id) REFERENCES strategy_lab_strategies(id)
);

CREATE TABLE IF NOT EXISTS strategy_lab_monthly_rankings (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL,
  ranking_month TEXT NOT NULL,
  rankings_json TEXT NOT NULL,
  evidence_status TEXT NOT NULL,
  outperformance_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (program_id) REFERENCES strategy_lab_programs(id),
  UNIQUE(program_id, ranking_month)
);

CREATE TABLE IF NOT EXISTS strategy_lab_audit_events (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL,
  portfolio_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (program_id) REFERENCES strategy_lab_programs(id),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

CREATE INDEX IF NOT EXISTS idx_strategy_lab_valuations_program_date
  ON strategy_lab_daily_valuations(program_id, market_date DESC, strategy_id);

CREATE INDEX IF NOT EXISTS idx_strategy_lab_trades_program_date
  ON strategy_lab_virtual_trades(program_id, market_date DESC, strategy_id);
