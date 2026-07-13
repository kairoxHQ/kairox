CREATE TABLE IF NOT EXISTS account_investment_policies (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  risk_profile TEXT NOT NULL,
  primary_objective TEXT NOT NULL,
  time_horizon TEXT NOT NULL,
  income_need TEXT NOT NULL,
  liquidity_requirement TEXT NOT NULL,
  max_drawdown_pct REAL NOT NULL,
  min_cash_allocation_pct REAL NOT NULL,
  max_single_position_pct REAL NOT NULL,
  max_sector_allocation_pct REAL NOT NULL,
  allowed_asset_types_json TEXT NOT NULL,
  allowed_investment_types_json TEXT NOT NULL,
  prohibited_investment_types_json TEXT NOT NULL,
  simulation_began_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

CREATE INDEX IF NOT EXISTS idx_account_investment_policies_portfolio_status
  ON account_investment_policies(portfolio_id, status);

INSERT OR REPLACE INTO account_investment_policies (
  id, portfolio_id, status, risk_profile, primary_objective, time_horizon,
  income_need, liquidity_requirement, max_drawdown_pct, min_cash_allocation_pct,
  max_single_position_pct, max_sector_allocation_pct, allowed_asset_types_json,
  allowed_investment_types_json, prohibited_investment_types_json,
  simulation_began_at, created_at, updated_at
) VALUES (
  'policy_portfolio_ira_conservative_retirement',
  'portfolio_ira',
  'active',
  'Conservative',
  'Capital preservation with moderate long-term growth',
  'Long term',
  'Low',
  'Moderate',
  0.10,
  0.10,
  0.20,
  0.30,
  '["stock","etf","bond_fund","money_market"]',
  '["U.S.-listed stocks","Broad-market ETFs","Dividend ETFs","Bond ETFs","Treasury ETFs","Money-market or cash-equivalent instruments when supported"]',
  '["options","margin","leveraged_etf","inverse_etf","crypto","penny_stock","short_selling","futures","concentrated_single_stock"]',
  COALESCE((SELECT MIN(created_at) FROM portfolios WHERE id = 'portfolio_ira'), datetime('now')),
  COALESCE((SELECT created_at FROM account_investment_policies WHERE id = 'policy_portfolio_ira_conservative_retirement'), datetime('now')),
  datetime('now')
);

UPDATE risk_profiles
SET risk_level = 'conservative',
  max_position_pct = 0.20,
  max_daily_loss_pct = 0.02,
  leverage_allowed = 0,
  options_allowed = 0,
  futures_allowed = 0,
  live_trading_allowed = 0
WHERE portfolio_id = 'portfolio_ira';

UPDATE investment_profiles
SET primary_goal = 'capital preservation with moderate long-term growth',
  risk_level = 'conservative',
  trading_activity = 'conservative long-term simulation',
  dividend_preference = 'preferred',
  dividend_handling = 'reinvest dividends',
  leverage_allowed = 0,
  short_selling_allowed = 0,
  options_allowed = 0,
  futures_allowed = 0,
  notes = 'IRA conservative retirement simulation. Allows U.S.-listed stocks, broad-market ETFs, dividend ETFs, bond ETFs, Treasury ETFs, and supported cash equivalents. Prohibits options, margin, leveraged ETFs, inverse ETFs, cryptocurrency, penny stocks, short selling, futures, and concentrated single-stock strategies.'
WHERE portfolio_id = 'portfolio_ira';

UPDATE portfolio_goals
SET objective = 'capital_preservation_moderate_growth',
  target_description = 'Conservative retirement simulation prioritizing capital preservation with moderate long-term growth.'
WHERE portfolio_id = 'portfolio_ira';

UPDATE portfolio_profiles
SET philosophy = 'Conservative retirement simulation focused on capital preservation, moderate long-term growth, income awareness, and policy-constrained paper trading.',
  risk_posture = 'Conservative',
  parameters_json = '{"minConfidence":0.70,"maxNewTradePct":0.10,"maxPositionPct":0.20,"cashReservePct":0.10,"drawdownBlockPct":0.10,"concentrationMultiplier":1.5,"cryptoPreference":0.0,"dividendPreference":1.4}',
  updated_at = datetime('now')
WHERE portfolio_id = 'portfolio_ira';

UPDATE watchlist_assets
SET enabled = 0,
  notes = 'Disabled by IRA conservative retirement mandate: cryptocurrency is prohibited.',
  updated_at = datetime('now')
WHERE watchlist_id = 'watchlist_ira_core'
  AND asset_id = 'asset_btc_usd';
