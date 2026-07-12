CREATE TABLE IF NOT EXISTS market_data_status (
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

CREATE INDEX IF NOT EXISTS idx_market_data_status_updated_at
  ON market_data_status(updated_at DESC);
