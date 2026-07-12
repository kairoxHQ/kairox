CREATE TABLE IF NOT EXISTS market_snapshots (
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

CREATE TABLE IF NOT EXISTS strategy_runs (
  id TEXT PRIMARY KEY,
  run_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE recommendations ADD COLUMN signal_key TEXT;
ALTER TABLE recommendations ADD COLUMN indicators_json TEXT;
ALTER TABLE recommendations ADD COLUMN transaction_cost_estimate_usd REAL NOT NULL DEFAULT 0;

ALTER TABLE decision_journal ADD COLUMN signal_key TEXT;

ALTER TABLE orders ADD COLUMN signal_key TEXT;
ALTER TABLE orders ADD COLUMN estimated_fee_usd REAL NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN fill_price_usd REAL;
ALTER TABLE orders ADD COLUMN idempotency_key TEXT;

ALTER TABLE trades ADD COLUMN signal_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_recommendations_signal_key
  ON recommendations(signal_key)
  WHERE signal_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_decision_journal_signal_key
  ON decision_journal(signal_key)
  WHERE signal_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key
  ON orders(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_signal_key
  ON trades(signal_key)
  WHERE signal_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_market_snapshots_symbol_created_at
  ON market_snapshots(symbol, created_at DESC);
