CREATE TABLE IF NOT EXISTS scheduled_runs (
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

CREATE INDEX IF NOT EXISTS idx_scheduled_runs_status_started_at
  ON scheduled_runs(status, started_at DESC);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS investment_profiles (
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

CREATE TABLE IF NOT EXISTS dividend_events (
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

CREATE INDEX IF NOT EXISTS idx_dividend_events_portfolio_created_at
  ON dividend_events(portfolio_id, created_at DESC);

CREATE TABLE IF NOT EXISTS portfolio_equity_history (
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

CREATE INDEX IF NOT EXISTS idx_portfolio_equity_history_portfolio_recorded_at
  ON portfolio_equity_history(portfolio_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS system_summaries (
  id TEXT PRIMARY KEY,
  summary_type TEXT NOT NULL CHECK (summary_type IN ('morning', 'end_of_day')),
  summary_date TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_system_summaries_type_date
  ON system_summaries(summary_type, summary_date);

INSERT OR IGNORE INTO system_settings (key, value, description)
VALUES
  ('automation_paused', 'false', 'When true, scheduled runs may collect market data but cannot execute paper trades.'),
  ('automation_schedule', '*/30 13-21 * * 1-5,15 */2 * * 0,6', 'Worker cron triggers for active weekday checks and weekend BTC monitoring.'),
  ('live_trading_enabled', 'false', 'Live brokerage execution remains disabled by default and is not supported in this project.');

INSERT OR IGNORE INTO investment_profiles (
  id, user_id, portfolio_id, primary_goal, risk_level, trading_activity,
  dividend_preference, dividend_handling, leverage_allowed, short_selling_allowed,
  options_allowed, futures_allowed, notes
) VALUES (
  'profile_tim_initial',
  'user_tim',
  'portfolio_tim_paper',
  'maximize long-term net worth',
  'moderate growth',
  'active when justified',
  'preferred when expected total return is otherwise comparable',
  'reinvest dividends',
  0,
  0,
  0,
  0,
  'Rank investments primarily by expected risk-adjusted total return. Dividend quality and expected dividend return are secondary tie-breakers only.'
);

INSERT OR IGNORE INTO benchmark_snapshots (
  id, benchmark_name, snapshot_date, symbol, starting_value_usd, units,
  price_usd, value_usd, market_data_source, price_as_of
) VALUES (
  'benchmark_spy_initial',
  'spy_buy_and_hold',
  date('now'),
  'SPY',
  20,
  0,
  0,
  20,
  'unavailable_until_validated_market_data',
  datetime('now')
);
