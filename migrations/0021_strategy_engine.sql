CREATE TABLE IF NOT EXISTS strategy_versions (
  id TEXT PRIMARY KEY,
  strategy_name TEXT NOT NULL,
  strategy_version TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'retired')),
  supported_risk_profiles_json TEXT NOT NULL DEFAULT '[]',
  rules_json TEXT NOT NULL DEFAULT '{}',
  weights_json TEXT NOT NULL DEFAULT '{}',
  thresholds_json TEXT NOT NULL DEFAULT '{}',
  allocation_ranges_json TEXT NOT NULL DEFAULT '{}',
  change_notes TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_strategy_versions_name_version
  ON strategy_versions(strategy_name, strategy_version);

CREATE TABLE IF NOT EXISTS strategy_universe_securities (
  id TEXT PRIMARY KEY,
  strategy_version_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  security_name TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  asset_category TEXT NOT NULL,
  sector TEXT NOT NULL,
  expense_ratio REAL,
  average_volume REAL,
  bid_ask_spread REAL,
  dividend_yield REAL,
  duration REAL,
  credit_quality TEXT,
  volatility REAL,
  maximum_drawdown REAL,
  historical_return REAL,
  data_quality_status TEXT NOT NULL DEFAULT 'configured',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  eligibility_status TEXT NOT NULL DEFAULT 'pending',
  exclusion_reason TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (strategy_version_id) REFERENCES strategy_versions(id),
  UNIQUE(strategy_version_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_strategy_universe_version_enabled
  ON strategy_universe_securities(strategy_version_id, enabled, symbol);

CREATE TABLE IF NOT EXISTS strategy_decision_runs (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  strategy_version_id TEXT NOT NULL,
  market_data_snapshot_id TEXT NOT NULL,
  daily_review_id TEXT,
  current_portfolio_state_json TEXT NOT NULL DEFAULT '{}',
  candidate_universe_json TEXT NOT NULL DEFAULT '[]',
  excluded_candidates_json TEXT NOT NULL DEFAULT '[]',
  security_scores_json TEXT NOT NULL DEFAULT '[]',
  portfolio_analysis_json TEXT NOT NULL DEFAULT '{}',
  final_decisions_json TEXT NOT NULL DEFAULT '[]',
  current_decision TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  portfolio_score REAL NOT NULL,
  risk_score REAL NOT NULL,
  generated_at TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  FOREIGN KEY (strategy_version_id) REFERENCES strategy_versions(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_strategy_decision_runs_snapshot
  ON strategy_decision_runs(portfolio_id, strategy_version_id, market_data_snapshot_id);

CREATE INDEX IF NOT EXISTS idx_strategy_decision_runs_portfolio_created
  ON strategy_decision_runs(portfolio_id, created_at DESC);

CREATE TABLE IF NOT EXISTS strategy_run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  portfolio_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES strategy_decision_runs(id),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

CREATE INDEX IF NOT EXISTS idx_strategy_run_events_portfolio_created
  ON strategy_run_events(portfolio_id, created_at DESC);

ALTER TABLE daily_portfolio_reviews ADD COLUMN strategy_run_id TEXT;
ALTER TABLE recommendation_proposals ADD COLUMN strategy_run_id TEXT;

INSERT OR IGNORE INTO strategy_versions (
  id, strategy_name, strategy_version, objective, status,
  supported_risk_profiles_json, rules_json, weights_json, thresholds_json,
  allocation_ranges_json, change_notes, created_at
) VALUES (
  'strategy_conservative_retirement_v1',
  'Conservative Retirement',
  '1.0.0',
  'Capital preservation, diversification, income, and moderate long-term growth.',
  'active',
  '["Conservative"]',
  '{"prohibited":["options","margin","short_selling","leveraged_etf","inverse_etf","crypto","penny_stock","illiquid","unknown","unclassified","concentrated_speculative"],"preferred":["broad_market_equity_etf","dividend_quality_etf","investment_grade_bond_etf","short_duration_treasury_etf","cash_reserve"]}',
  '{"policyEligibility":0.20,"dataQuality":0.15,"allocationNeed":0.16,"diversificationBenefit":0.12,"volatility":0.10,"maximumDrawdown":0.10,"yield":0.06,"expenseRatio":0.06,"liquidity":0.03,"spread":0.02}',
  '{"minimumBuyScore":70,"minimumConfidence":0.70,"minimumTradeValueUsd":25,"minimumPortfolioImprovement":0.02,"maximumTurnoverPct":0.15,"rebalanceDriftThresholdPct":0.05,"trimThresholdPct":0.02,"sellThreshold":0.65,"cooldownDays":7,"minimumScoreChange":8,"minimumAllocationChangePct":0.02}',
  '{"Broad U.S. equity":{"min":0.20,"target":0.25,"max":0.40},"Dividend or defensive equity":{"min":0.10,"target":0.15,"max":0.25},"Investment-grade bonds":{"min":0.20,"target":0.25,"max":0.40},"Short-term Treasuries or cash equivalents":{"min":0.00,"target":0.10,"max":0.20},"Cash reserve":{"min":0.10,"target":0.25,"max":0.40}}',
  'Initial production Conservative Retirement strategy for paper portfolios. Versioned and database-configured; no live trading support.',
  '2026-07-14T00:00:00.000Z'
);

INSERT OR IGNORE INTO strategy_universe_securities (
  id, strategy_version_id, symbol, security_name, asset_type, asset_category, sector,
  expense_ratio, average_volume, bid_ask_spread, dividend_yield, duration, credit_quality,
  volatility, maximum_drawdown, historical_return, data_quality_status, enabled,
  eligibility_status, exclusion_reason, notes
) VALUES
  ('strategy_universe_cr_v1_vti', 'strategy_conservative_retirement_v1', 'VTI', 'Vanguard Total Stock Market ETF', 'etf', 'Broad U.S. equity', 'U.S. total market', 0.0003, 4000000, 0.0005, 0.012, NULL, NULL, 0.17, 0.34, 0.08, 'configured', 1, 'pending', NULL, 'Broad diversified equity core candidate.'),
  ('strategy_universe_cr_v1_voo', 'strategy_conservative_retirement_v1', 'VOO', 'Vanguard S&P 500 ETF', 'etf', 'Broad U.S. equity', 'U.S. large cap', 0.0003, 5000000, 0.0004, 0.013, NULL, NULL, 0.16, 0.33, 0.08, 'configured', 1, 'pending', NULL, 'Large-cap broad-market candidate.'),
  ('strategy_universe_cr_v1_schd', 'strategy_conservative_retirement_v1', 'SCHD', 'Schwab U.S. Dividend Equity ETF', 'etf', 'Dividend or defensive equity', 'Dividend equity', 0.0006, 3000000, 0.0006, 0.035, NULL, NULL, 0.14, 0.29, 0.07, 'configured', 1, 'pending', NULL, 'Income and quality-oriented equity sleeve.'),
  ('strategy_universe_cr_v1_bnd', 'strategy_conservative_retirement_v1', 'BND', 'Vanguard Total Bond Market ETF', 'bond_fund', 'Investment-grade bonds', 'Investment-grade bonds', 0.0003, 6000000, 0.0005, 0.034, 6.1, 'Investment grade', 0.06, 0.16, 0.03, 'configured', 1, 'pending', NULL, 'Core investment-grade bond exposure.'),
  ('strategy_universe_cr_v1_shy', 'strategy_conservative_retirement_v1', 'SHY', 'iShares 1-3 Year Treasury Bond ETF', 'bond_fund', 'Short-term Treasuries or cash equivalents', 'U.S. Treasuries', 0.0015, 5000000, 0.0004, 0.042, 1.9, 'Treasury', 0.02, 0.05, 0.02, 'configured', 1, 'pending', NULL, 'Short-duration Treasury stabilizer.'),
  ('strategy_universe_cr_v1_spy', 'strategy_conservative_retirement_v1', 'SPY', 'SPDR S&P 500 ETF Trust', 'etf', 'Broad U.S. equity', 'U.S. large cap', 0.000945, 70000000, 0.0002, 0.013, NULL, NULL, 0.16, 0.33, 0.08, 'configured', 1, 'pending', NULL, 'Highly liquid broad-market benchmark ETF.'),
  ('strategy_universe_cr_v1_btc', 'strategy_conservative_retirement_v1', 'BTC-USD', 'Bitcoin', 'crypto', 'Cryptocurrency', 'Crypto', NULL, NULL, NULL, NULL, NULL, NULL, 0.60, 0.75, NULL, 'configured', 1, 'ineligible', 'Cryptocurrency is prohibited by the Conservative Retirement strategy and IRA policy.', 'Included to prove explicit exclusion.'),
  ('strategy_universe_cr_v1_tqqq', 'strategy_conservative_retirement_v1', 'TQQQ', 'ProShares UltraPro QQQ', 'etf', 'Leveraged ETF', 'Technology', 0.0086, 50000000, 0.0008, NULL, NULL, NULL, 0.75, 0.90, NULL, 'configured', 1, 'ineligible', 'Leveraged ETFs are prohibited.', 'Included to prove explicit exclusion.');
