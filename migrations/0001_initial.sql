CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS broker_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  broker_name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode = 'paper'),
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS portfolios (
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

CREATE TABLE IF NOT EXISTS portfolio_goals (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  target_description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

CREATE TABLE IF NOT EXISTS risk_profiles (
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

CREATE TABLE IF NOT EXISTS positions (
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

CREATE TABLE IF NOT EXISTS orders (
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  FOREIGN KEY (broker_account_id) REFERENCES broker_accounts(id)
);

CREATE TABLE IF NOT EXISTS trades (
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
  executed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

CREATE TABLE IF NOT EXISTS recommendations (
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

CREATE TABLE IF NOT EXISTS decision_journal (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  recommendation_id TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('BUY', 'SELL', 'HOLD', 'DO_NOTHING')),
  explanation TEXT NOT NULL,
  confidence_score REAL NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  risk_score REAL NOT NULL CHECK (risk_score >= 0 AND risk_score <= 1),
  price_data_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  FOREIGN KEY (recommendation_id) REFERENCES recommendations(id)
);

CREATE TABLE IF NOT EXISTS daily_snapshots (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  cash_usd REAL NOT NULL,
  positions_value_usd REAL NOT NULL,
  total_value_usd REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

CREATE TABLE IF NOT EXISTS benchmark_snapshots (
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

CREATE INDEX IF NOT EXISTS idx_recommendations_portfolio_created_at
  ON recommendations(portfolio_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decision_journal_portfolio_created_at
  ON decision_journal(portfolio_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_benchmark_snapshots_name_date
  ON benchmark_snapshots(benchmark_name, snapshot_date DESC);

INSERT OR IGNORE INTO users (id, name) VALUES ('user_tim', 'Tim');

INSERT OR IGNORE INTO broker_accounts (
  id, user_id, broker_name, account_type, mode, status
) VALUES (
  'broker_paper_local', 'user_tim', 'Paper Broker Adapter', 'paper', 'paper', 'disabled'
);

INSERT OR IGNORE INTO portfolios (
  id, user_id, broker_account_id, name, cash_usd, starting_balance_usd, currency, mode
) VALUES (
  'portfolio_tim_paper', 'user_tim', 'broker_paper_local', 'Tim Paper Portfolio', 20, 20, 'USD', 'paper'
);

INSERT OR IGNORE INTO portfolio_goals (
  id, portfolio_id, objective, target_description
) VALUES (
  'goal_tim_net_worth', 'portfolio_tim_paper', 'grow_net_worth', 'Grow net worth inside Tim''s selected risk limits without optimizing for trade frequency.'
);

INSERT OR IGNORE INTO risk_profiles (
  id, portfolio_id, risk_level, max_position_pct, max_daily_loss_pct
) VALUES (
  'risk_tim_default', 'portfolio_tim_paper', 'conservative', 0.25, 0.02
);

INSERT OR IGNORE INTO daily_snapshots (
  id, portfolio_id, snapshot_date, cash_usd, positions_value_usd, total_value_usd
) VALUES (
  'snapshot_initial_cash', 'portfolio_tim_paper', date('now'), 20, 0, 20
);

INSERT OR IGNORE INTO benchmark_snapshots (
  id, benchmark_name, snapshot_date, symbol, starting_value_usd, units, price_usd, value_usd, market_data_source, price_as_of
) VALUES
  ('benchmark_cash_initial', 'cash', date('now'), 'USD', 20, 20, 1, 20, 'system_seed', datetime('now')),
  ('benchmark_btc_initial', 'bitcoin_buy_and_hold', date('now'), 'BTC', 20, 0.0003076923, 65000, 20, 'mock_market_data', datetime('now'));

INSERT OR IGNORE INTO recommendations (
  id, portfolio_id, symbol, action, explanation, confidence_score, risk_score, market_data_source, price_usd, price_as_of
) VALUES (
  'recommendation_initial_do_nothing',
  'portfolio_tim_paper',
  'BTC',
  'DO_NOTHING',
  'Initial milestone defaults to DO_NOTHING because no validated live market data provider is configured.',
  0.95,
  0.05,
  'mock_market_data',
  65000,
  datetime('now')
);

INSERT OR IGNORE INTO decision_journal (
  id, portfolio_id, recommendation_id, decision, explanation, confidence_score, risk_score, price_data_json
) VALUES (
  'journal_initial_do_nothing',
  'portfolio_tim_paper',
  'recommendation_initial_do_nothing',
  'DO_NOTHING',
  'No paper trade was placed. The system requires validated market data and risk checks before any BUY or SELL recommendation.',
  0.95,
  0.05,
  '{"symbol":"BTC","priceUsd":65000,"source":"mock_market_data","validated":false,"priceAsOf":"seeded_at_migration_time"}'
);
