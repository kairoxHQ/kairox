CREATE TABLE IF NOT EXISTS trusted_quote_cache (
  symbol TEXT PRIMARY KEY,
  normalized_quote_json TEXT NOT NULL,
  provider TEXT NOT NULL,
  quality_status TEXT NOT NULL,
  provider_timestamp TEXT,
  retrieval_timestamp TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  validation_result_json TEXT NOT NULL DEFAULT '{}',
  quote_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_trusted_quote_cache_expires
  ON trusted_quote_cache(expires_at);

CREATE TABLE IF NOT EXISTS historical_price_bars (
  symbol TEXT NOT NULL,
  trading_date TEXT NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  adjusted_close REAL,
  volume REAL,
  dividend_adjustment_status TEXT NOT NULL DEFAULT 'unknown',
  split_adjustment_status TEXT NOT NULL DEFAULT 'unknown',
  provider TEXT NOT NULL,
  retrieval_timestamp TEXT NOT NULL,
  PRIMARY KEY (symbol, trading_date, provider)
);

CREATE INDEX IF NOT EXISTS idx_historical_price_bars_symbol_date
  ON historical_price_bars(symbol, trading_date DESC);

CREATE TABLE IF NOT EXISTS market_data_provider_health (
  provider TEXT PRIMARY KEY,
  successful_requests INTEGER NOT NULL DEFAULT 0,
  failed_requests INTEGER NOT NULL DEFAULT 0,
  timeout_requests INTEGER NOT NULL DEFAULT 0,
  rate_limit_responses INTEGER NOT NULL DEFAULT 0,
  fallback_uses INTEGER NOT NULL DEFAULT 0,
  total_latency_ms REAL NOT NULL DEFAULT 0,
  last_successful_retrieval TEXT,
  circuit_open_until TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS market_data_anomalies (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  provider TEXT NOT NULL,
  quality_status TEXT NOT NULL,
  anomaly_type TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_data_anomalies_created
  ON market_data_anomalies(created_at DESC);

CREATE TABLE IF NOT EXISTS corporate_actions (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('stock_split', 'reverse_split', 'cash_dividend', 'symbol_change')),
  ex_date TEXT,
  effective_date TEXT,
  ratio REAL,
  cash_amount REAL,
  from_symbol TEXT,
  to_symbol TEXT,
  provider TEXT,
  retrieval_timestamp TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_corporate_actions_unique
  ON corporate_actions(symbol, action_type, COALESCE(ex_date, effective_date, ''), COALESCE(to_symbol, ''));

CREATE TABLE IF NOT EXISTS market_data_snapshots (
  id TEXT PRIMARY KEY,
  use_case TEXT NOT NULL,
  symbols_json TEXT NOT NULL DEFAULT '[]',
  quality_summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS market_data_snapshot_quotes (
  snapshot_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  normalized_quote_json TEXT NOT NULL,
  quality_status TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_timestamp TEXT,
  retrieval_timestamp TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, symbol),
  FOREIGN KEY (snapshot_id) REFERENCES market_data_snapshots(id)
);

ALTER TABLE daily_portfolio_reviews ADD COLUMN market_data_snapshot_id TEXT;
ALTER TABLE allocation_proposals ADD COLUMN market_data_snapshot_id TEXT;
ALTER TABLE recommendation_proposals ADD COLUMN market_data_snapshot_id TEXT;
ALTER TABLE paper_order_batches ADD COLUMN market_data_snapshot_id TEXT;
ALTER TABLE paper_order_executions ADD COLUMN market_data_snapshot_id TEXT;
