CREATE TABLE IF NOT EXISTS security_research_profiles (
  symbol TEXT PRIMARY KEY,
  company_or_fund TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  sector TEXT,
  industry TEXT,
  market_cap_usd REAL,
  dividend_yield REAL,
  expense_ratio REAL,
  fifty_two_week_high REAL,
  fifty_two_week_low REAL,
  beta REAL,
  average_volume REAL,
  volatility REAL,
  price_history_json TEXT NOT NULL DEFAULT '[]',
  valuation_score REAL NOT NULL,
  quality_score REAL NOT NULL,
  growth_score REAL NOT NULL,
  income_score REAL NOT NULL,
  technical_trend_score REAL NOT NULL,
  momentum_score REAL NOT NULL,
  risk_score REAL NOT NULL,
  diversification_score REAL NOT NULL,
  research_score REAL NOT NULL,
  overall_kairox_score REAL NOT NULL,
  explanation_json TEXT NOT NULL DEFAULT '{}',
  data_quality_status TEXT NOT NULL,
  latest_market_data_snapshot_id TEXT,
  last_scored_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS security_research_score_history (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  period_type TEXT NOT NULL CHECK (period_type IN ('daily', 'weekly', 'monthly')),
  period_key TEXT NOT NULL,
  valuation_score REAL NOT NULL,
  quality_score REAL NOT NULL,
  growth_score REAL NOT NULL,
  income_score REAL NOT NULL,
  technical_trend_score REAL NOT NULL,
  momentum_score REAL NOT NULL,
  risk_score REAL NOT NULL,
  diversification_score REAL NOT NULL,
  research_score REAL NOT NULL,
  overall_kairox_score REAL NOT NULL,
  score_change REAL NOT NULL,
  change_explanation TEXT NOT NULL,
  market_data_snapshot_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (symbol) REFERENCES security_research_profiles(symbol),
  UNIQUE(symbol, period_type, period_key)
);

CREATE TABLE IF NOT EXISTS security_research_watchlist (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Watching', 'Candidate', 'Owned', 'Rejected', 'Archived')),
  reason TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  FOREIGN KEY (symbol) REFERENCES security_research_profiles(symbol),
  UNIQUE(portfolio_id, symbol)
);

CREATE TABLE IF NOT EXISTS security_research_portfolio_fit (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  diversification_contribution REAL NOT NULL,
  income_contribution REAL NOT NULL,
  risk_contribution REAL NOT NULL,
  correlation_score REAL NOT NULL,
  policy_compatibility REAL NOT NULL,
  cash_efficiency REAL NOT NULL,
  fit_score REAL NOT NULL,
  explanation_json TEXT NOT NULL DEFAULT '{}',
  market_data_snapshot_id TEXT,
  calculated_at TEXT NOT NULL,
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  FOREIGN KEY (symbol) REFERENCES security_research_profiles(symbol),
  UNIQUE(portfolio_id, symbol, calculated_at)
);

CREATE TABLE IF NOT EXISTS security_research_candidate_snapshots (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  market_data_snapshot_id TEXT,
  top_candidates_json TEXT NOT NULL DEFAULT '[]',
  top_dividend_etfs_json TEXT NOT NULL DEFAULT '[]',
  top_broad_market_etfs_json TEXT NOT NULL DEFAULT '[]',
  top_bond_etfs_json TEXT NOT NULL DEFAULT '[]',
  top_defensive_positions_json TEXT NOT NULL DEFAULT '[]',
  top_growth_positions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  UNIQUE(portfolio_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS security_research_audit_events (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT,
  symbol TEXT,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_security_research_score
  ON security_research_profiles(overall_kairox_score DESC, symbol ASC);

CREATE INDEX IF NOT EXISTS idx_security_research_history_symbol_period
  ON security_research_score_history(symbol, period_type, period_key DESC);

CREATE INDEX IF NOT EXISTS idx_security_research_watchlist_portfolio
  ON security_research_watchlist(portfolio_id, status, symbol);
