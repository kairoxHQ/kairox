PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE IF NOT EXISTS "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE broker_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  broker_name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode = 'paper'),
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE portfolios (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  broker_account_id TEXT,
  name TEXT NOT NULL,
  cash_usd REAL NOT NULL,
  starting_balance_usd REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  mode TEXT NOT NULL CHECK (mode = 'paper'),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (broker_account_id) REFERENCES broker_accounts(id)
);
CREATE TABLE portfolio_goals (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  target_description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);
CREATE TABLE risk_profiles (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  max_position_pct REAL NOT NULL,
  max_daily_loss_pct REAL NOT NULL,
  leverage_allowed INTEGER NOT NULL DEFAULT 0,
  options_allowed INTEGER NOT NULL DEFAULT 0,
  futures_allowed INTEGER NOT NULL DEFAULT 0,
  live_trading_allowed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);
CREATE TABLE positions (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  quantity REAL NOT NULL,
  avg_entry_price_usd REAL NOT NULL,
  current_price_usd REAL NOT NULL,
  market_value_usd REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  broker_account_id TEXT,
  symbol TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  order_type TEXT NOT NULL,
  quantity REAL NOT NULL,
  limit_price_usd REAL,
  status TEXT NOT NULL,
  paper_only INTEGER NOT NULL DEFAULT 1,
  risk_checked INTEGER NOT NULL DEFAULT 0,
  explanation TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), signal_key TEXT, estimated_fee_usd REAL NOT NULL DEFAULT 0, fill_price_usd REAL, idempotency_key TEXT,
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  FOREIGN KEY (broker_account_id) REFERENCES broker_accounts(id)
);
CREATE TABLE trades (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  portfolio_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity REAL NOT NULL,
  price_usd REAL NOT NULL,
  fees_usd REAL NOT NULL DEFAULT 0,
  paper_only INTEGER NOT NULL DEFAULT 1,
  executed_at TEXT NOT NULL DEFAULT (datetime('now')), signal_key TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);
CREATE TABLE recommendations (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('BUY', 'SELL', 'HOLD', 'DO_NOTHING')),
  explanation TEXT NOT NULL,
  confidence_score REAL NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  risk_score REAL NOT NULL CHECK (risk_score >= 0 AND risk_score <= 1),
  market_data_source TEXT NOT NULL,
  price_usd REAL,
  price_as_of TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), signal_key TEXT, indicators_json TEXT, transaction_cost_estimate_usd REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);
CREATE TABLE decision_journal (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  recommendation_id TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('BUY', 'SELL', 'HOLD', 'DO_NOTHING')),
  explanation TEXT NOT NULL,
  confidence_score REAL NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  risk_score REAL NOT NULL CHECK (risk_score >= 0 AND risk_score <= 1),
  price_data_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), signal_key TEXT,
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  FOREIGN KEY (recommendation_id) REFERENCES recommendations(id)
);
CREATE TABLE daily_snapshots (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  cash_usd REAL NOT NULL,
  positions_value_usd REAL NOT NULL,
  total_value_usd REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);
CREATE TABLE benchmark_snapshots (
  id TEXT PRIMARY KEY,
  benchmark_name TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  starting_value_usd REAL NOT NULL,
  units REAL NOT NULL,
  price_usd REAL NOT NULL,
  value_usd REAL NOT NULL,
  market_data_source TEXT NOT NULL,
  price_as_of TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE market_snapshots (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  source TEXT NOT NULL,
  price_usd REAL,
  price_as_of TEXT,
  volume REAL,
  candles_json TEXT NOT NULL,
  validation_status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE strategy_runs (
  id TEXT PRIMARY KEY,
  run_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE scheduled_runs (
  id TEXT PRIMARY KEY,
  run_key TEXT NOT NULL UNIQUE,
  cron TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
  error_details TEXT,
  summary_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE investment_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  portfolio_id TEXT NOT NULL,
  primary_goal TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  trading_activity TEXT NOT NULL,
  dividend_preference TEXT NOT NULL,
  dividend_handling TEXT NOT NULL,
  leverage_allowed INTEGER NOT NULL DEFAULT 0,
  short_selling_allowed INTEGER NOT NULL DEFAULT 0,
  options_allowed INTEGER NOT NULL DEFAULT 0,
  futures_allowed INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);
CREATE TABLE dividend_events (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  amount_usd REAL NOT NULL,
  amount_per_share_usd REAL,
  quantity REAL,
  ex_dividend_date TEXT,
  payment_date TEXT,
  source TEXT NOT NULL,
  reliability_status TEXT NOT NULL CHECK (reliability_status IN ('recorded', 'unavailable')),
  reinvested INTEGER NOT NULL DEFAULT 0,
  reinvested_quantity REAL NOT NULL DEFAULT 0,
  explanation TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);
CREATE TABLE portfolio_equity_history (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  cash_usd REAL NOT NULL,
  positions_value_usd REAL NOT NULL,
  realized_pl_usd REAL NOT NULL,
  unrealized_pl_usd REAL NOT NULL,
  estimated_transaction_costs_usd REAL NOT NULL,
  dividend_income_usd REAL NOT NULL,
  price_return_usd REAL NOT NULL,
  dividend_return_usd REAL NOT NULL,
  total_return_usd REAL NOT NULL,
  total_value_usd REAL NOT NULL,
  max_drawdown_pct REAL NOT NULL,
  benchmark_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);
CREATE TABLE system_summaries (
  id TEXT PRIMARY KEY,
  summary_type TEXT NOT NULL CHECK (summary_type IN ('morning', 'end_of_day')),
  summary_date TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE market_data_status (
  symbol TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  age_seconds INTEGER NOT NULL,
  is_fresh INTEGER NOT NULL,
  quality TEXT NOT NULL,
  status TEXT NOT NULL,
  user_message TEXT NOT NULL,
  technical_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
DELETE FROM sqlite_sequence;
CREATE INDEX idx_recommendations_portfolio_created_at
  ON recommendations(portfolio_id, created_at DESC);
CREATE INDEX idx_decision_journal_portfolio_created_at
  ON decision_journal(portfolio_id, created_at DESC);
CREATE INDEX idx_benchmark_snapshots_name_date
  ON benchmark_snapshots(benchmark_name, snapshot_date DESC);
CREATE UNIQUE INDEX idx_recommendations_signal_key
  ON recommendations(signal_key)
  WHERE signal_key IS NOT NULL;
CREATE UNIQUE INDEX idx_decision_journal_signal_key
  ON decision_journal(signal_key)
  WHERE signal_key IS NOT NULL;
CREATE UNIQUE INDEX idx_orders_idempotency_key
  ON orders(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX idx_trades_signal_key
  ON trades(signal_key)
  WHERE signal_key IS NOT NULL;
CREATE INDEX idx_market_snapshots_symbol_created_at
  ON market_snapshots(symbol, created_at DESC);
CREATE INDEX idx_scheduled_runs_status_started_at
  ON scheduled_runs(status, started_at DESC);
CREATE INDEX idx_dividend_events_portfolio_created_at
  ON dividend_events(portfolio_id, created_at DESC);
CREATE INDEX idx_portfolio_equity_history_portfolio_recorded_at
  ON portfolio_equity_history(portfolio_id, recorded_at DESC);
CREATE UNIQUE INDEX idx_system_summaries_type_date
  ON system_summaries(summary_type, summary_date);
CREATE INDEX idx_market_data_status_updated_at
  ON market_data_status(updated_at DESC);
