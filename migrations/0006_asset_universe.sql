CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN (
    'stock',
    'etf',
    'mutual_fund',
    'crypto',
    'reit',
    'bond_fund',
    'money_market'
  )),
  market TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  provider_symbol TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  tradable INTEGER NOT NULL DEFAULT 0 CHECK (tradable IN (0, 1)),
  fractional_supported INTEGER NOT NULL DEFAULT 0 CHECK (fractional_supported IN (0, 1)),
  dividend_capable INTEGER NOT NULL DEFAULT 0 CHECK (dividend_capable IN (0, 1)),
  expense_ratio REAL,
  minimum_investment REAL,
  market_hours_mode TEXT NOT NULL CHECK (market_hours_mode IN (
    'continuous',
    'us_regular',
    'fund_end_of_day',
    'cash_equivalent',
    'disabled'
  )),
  price_precision INTEGER NOT NULL DEFAULT 2 CHECK (price_precision >= 0 AND price_precision <= 12),
  quantity_precision INTEGER NOT NULL DEFAULT 6 CHECK (quantity_precision >= 0 AND quantity_precision <= 12),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assets_enabled_type
  ON assets(enabled, asset_type, symbol);

CREATE TABLE IF NOT EXISTS watchlists (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  UNIQUE(portfolio_id, name)
);

CREATE TABLE IF NOT EXISTS watchlist_assets (
  id TEXT PRIMARY KEY,
  watchlist_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  ranking_priority INTEGER NOT NULL DEFAULT 100,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (watchlist_id) REFERENCES watchlists(id),
  FOREIGN KEY (asset_id) REFERENCES assets(id),
  UNIQUE(watchlist_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_assets_watchlist_priority
  ON watchlist_assets(watchlist_id, enabled, ranking_priority);

INSERT OR IGNORE INTO assets (
  id, symbol, display_name, asset_type, market, currency, provider_symbol,
  enabled, tradable, fractional_supported, dividend_capable,
  expense_ratio, minimum_investment, market_hours_mode, price_precision, quantity_precision
) VALUES
  (
    'asset_btc_usd',
    'BTC-USD',
    'Bitcoin',
    'crypto',
    'crypto',
    'USD',
    'BTC-USD',
    1,
    1,
    1,
    0,
    NULL,
    NULL,
    'continuous',
    2,
    8
  ),
  (
    'asset_spy',
    'SPY',
    'SPDR S&P 500 ETF Trust',
    'etf',
    'US',
    'USD',
    'SPY',
    1,
    1,
    1,
    1,
    NULL,
    NULL,
    'us_regular',
    2,
    6
  );

INSERT OR IGNORE INTO watchlists (
  id, portfolio_id, name, description, enabled
) VALUES (
  'watchlist_tim_core',
  'portfolio_tim_paper',
  'Tim Core Paper Universe',
  'Initial database-driven paper-trading universe for Kairox.',
  1
);

INSERT OR IGNORE INTO watchlist_assets (
  id, watchlist_id, asset_id, enabled, ranking_priority, notes
) VALUES
  (
    'watchlist_tim_core_btc_usd',
    'watchlist_tim_core',
    'asset_btc_usd',
    1,
    10,
    'Crypto benchmark and current paper-trading candidate.'
  ),
  (
    'watchlist_tim_core_spy',
    'watchlist_tim_core',
    'asset_spy',
    1,
    20,
    'Broad-market ETF benchmark and current paper-trading candidate.'
  );
