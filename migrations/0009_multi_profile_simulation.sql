CREATE TABLE IF NOT EXISTS portfolio_profiles (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL UNIQUE,
  profile_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  philosophy TEXT NOT NULL,
  risk_posture TEXT NOT NULL,
  comparison_start_timestamp TEXT NOT NULL,
  comparison_start_equity_usd REAL NOT NULL,
  normalized_start_index REAL NOT NULL DEFAULT 100,
  parameters_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_profiles_enabled_key
  ON portfolio_profiles(enabled, profile_key);

INSERT OR IGNORE INTO users (id, name)
VALUES
  ('user_kairox_conservative', 'Kairox Conservative'),
  ('user_kairox_high_risk', 'Kairox High Risk');

INSERT OR IGNORE INTO broker_accounts (
  id, user_id, broker_name, account_type, mode, status
) VALUES
  ('broker_paper_conservative', 'user_kairox_conservative', 'Paper Broker Adapter', 'paper', 'paper', 'disabled'),
  ('broker_paper_high_risk', 'user_kairox_high_risk', 'Paper Broker Adapter', 'paper', 'paper', 'disabled');

INSERT OR IGNORE INTO portfolios (
  id, user_id, broker_account_id, name, cash_usd, starting_balance_usd, currency, mode
)
SELECT
  'portfolio_kairox_conservative',
  'user_kairox_conservative',
  'broker_paper_conservative',
  'Kairox Conservative',
  current_equity,
  current_equity,
  'USD',
  'paper'
FROM (
  SELECT ROUND(p.cash_usd + COALESCE(SUM(pos.market_value_usd), 0), 4) AS current_equity
  FROM portfolios p
  LEFT JOIN positions pos ON pos.portfolio_id = p.id AND pos.quantity > 0
  WHERE p.id = 'portfolio_tim_paper'
);

INSERT OR IGNORE INTO portfolios (
  id, user_id, broker_account_id, name, cash_usd, starting_balance_usd, currency, mode
)
SELECT
  'portfolio_kairox_high_risk',
  'user_kairox_high_risk',
  'broker_paper_high_risk',
  'Kairox High Risk',
  current_equity,
  current_equity,
  'USD',
  'paper'
FROM (
  SELECT ROUND(p.cash_usd + COALESCE(SUM(pos.market_value_usd), 0), 4) AS current_equity
  FROM portfolios p
  LEFT JOIN positions pos ON pos.portfolio_id = p.id AND pos.quantity > 0
  WHERE p.id = 'portfolio_tim_paper'
);

INSERT OR IGNORE INTO portfolio_goals (
  id, portfolio_id, objective, target_description
) VALUES
  ('goal_kairox_conservative', 'portfolio_kairox_conservative', 'capital_preservation_income', 'Preserve capital, seek income, and reduce volatility using diversified ETFs, dividend exposure, bonds, and larger cash reserves.'),
  ('goal_kairox_high_risk', 'portfolio_kairox_high_risk', 'maximum_long_term_growth', 'Maximize long-term growth while accepting larger paper drawdowns without leverage, margin, options, futures, forex, shorting, or negative cash.');

INSERT OR IGNORE INTO risk_profiles (
  id, portfolio_id, risk_level, max_position_pct, max_daily_loss_pct,
  leverage_allowed, options_allowed, futures_allowed, live_trading_allowed
) VALUES
  ('risk_kairox_conservative', 'portfolio_kairox_conservative', 'conservative', 0.25, 0.01, 0, 0, 0, 0),
  ('risk_kairox_high_risk', 'portfolio_kairox_high_risk', 'high_risk_growth', 0.50, 0.04, 0, 0, 0, 0);

INSERT OR IGNORE INTO investment_profiles (
  id, user_id, portfolio_id, primary_goal, risk_level, trading_activity,
  dividend_preference, dividend_handling, leverage_allowed, short_selling_allowed,
  options_allowed, futures_allowed, notes
) VALUES
  (
    'profile_kairox_conservative',
    'user_kairox_conservative',
    'portfolio_kairox_conservative',
    'capital preservation, income, and low volatility',
    'conservative',
    'selective when strongly justified',
    'preferred as a secondary total-return input',
    'reinvest dividends',
    0, 0, 0, 0,
    'Prefers diversified ETFs, dividend ETFs, bond exposure, minimal crypto, smaller positions, larger cash reserve, higher confidence threshold, stronger concentration penalties, and stronger drawdown protection.'
  ),
  (
    'profile_kairox_high_risk',
    'user_kairox_high_risk',
    'portfolio_kairox_high_risk',
    'maximum long-term growth',
    'high risk growth',
    'active when justified',
    'not primary',
    'reinvest dividends',
    0, 0, 0, 0,
    'Prefers growth ETFs, technology exposure, larger crypto allocation, smaller cash reserve, lower but meaningful confidence threshold, larger positions, and greater volatility tolerance. Still prohibits leverage, margin, options, futures, forex, short selling, and negative cash.'
  );

INSERT OR IGNORE INTO portfolio_profiles (
  id, portfolio_id, profile_key, display_name, philosophy, risk_posture,
  comparison_start_timestamp, comparison_start_equity_usd, normalized_start_index,
  parameters_json
)
SELECT
  id,
  portfolio_id,
  profile_key,
  display_name,
  philosophy,
  risk_posture,
  comparison_start_timestamp,
  current_equity,
  100,
  parameters_json
FROM (
  SELECT
    datetime('now') AS comparison_start_timestamp,
    ROUND(p.cash_usd + COALESCE(SUM(pos.market_value_usd), 0), 4) AS current_equity
  FROM portfolios p
  LEFT JOIN positions pos ON pos.portfolio_id = p.id AND pos.quantity > 0
  WHERE p.id = 'portfolio_tim_paper'
) baseline
JOIN (
  SELECT
    'portfolio_profile_tim_balanced' AS id,
    'portfolio_tim_paper' AS portfolio_id,
    'tim_balanced' AS profile_key,
    'Tim Balanced' AS display_name,
    'Long-term wealth, moderate risk, balanced growth, and dividend preference.' AS philosophy,
    'moderate' AS risk_posture,
    '{"minConfidence":0.60,"maxNewTradePct":0.10,"maxPositionPct":0.50,"cashReservePct":0.05,"drawdownBlockPct":0.10,"concentrationMultiplier":1.0,"cryptoPreference":1.0,"dividendPreference":1.0}' AS parameters_json
  UNION ALL
  SELECT
    'portfolio_profile_kairox_conservative',
    'portfolio_kairox_conservative',
    'kairox_conservative',
    'Kairox Conservative',
    'Capital preservation, income, low volatility, diversified ETFs, dividend preference, bond exposure, and minimal crypto.',
    'conservative',
    '{"minConfidence":0.70,"maxNewTradePct":0.06,"maxPositionPct":0.25,"cashReservePct":0.25,"drawdownBlockPct":0.06,"concentrationMultiplier":1.5,"cryptoPreference":0.25,"dividendPreference":1.4}'
  UNION ALL
  SELECT
    'portfolio_profile_kairox_high_risk',
    'portfolio_kairox_high_risk',
    'kairox_high_risk',
    'Kairox High Risk',
    'Maximum long-term growth with tolerance for larger drawdowns, growth ETFs, technology, and larger crypto allocation.',
    'high_risk',
    '{"minConfidence":0.55,"maxNewTradePct":0.15,"maxPositionPct":0.50,"cashReservePct":0.02,"drawdownBlockPct":0.18,"concentrationMultiplier":0.75,"cryptoPreference":1.6,"dividendPreference":0.6}'
) profiles;

INSERT OR IGNORE INTO watchlists (
  id, portfolio_id, name, description, enabled
) VALUES
  (
    'watchlist_kairox_conservative_core',
    'portfolio_kairox_conservative',
    'Kairox Conservative Core Universe',
    'Profile-specific paper universe emphasizing diversified ETFs, dividends, bond exposure, and low volatility.',
    1
  ),
  (
    'watchlist_kairox_high_risk_core',
    'portfolio_kairox_high_risk',
    'Kairox High Risk Core Universe',
    'Profile-specific paper universe emphasizing growth, technology, and larger crypto allocation within paper-only guardrails.',
    1
  );

INSERT OR IGNORE INTO watchlist_assets (
  id, watchlist_id, asset_id, enabled, ranking_priority, notes
) VALUES
  ('watchlist_kairox_conservative_bnd', 'watchlist_kairox_conservative_core', 'asset_bnd', 1, 10, 'Conservative bond ETF anchor.'),
  ('watchlist_kairox_conservative_schd', 'watchlist_kairox_conservative_core', 'asset_schd', 1, 20, 'Dividend ETF preference, still secondary to total return.'),
  ('watchlist_kairox_conservative_voo', 'watchlist_kairox_conservative_core', 'asset_voo', 1, 30, 'Broad diversified equity ETF.'),
  ('watchlist_kairox_conservative_vti', 'watchlist_kairox_conservative_core', 'asset_vti', 1, 40, 'Total-market diversified ETF.'),
  ('watchlist_kairox_conservative_spy', 'watchlist_kairox_conservative_core', 'asset_spy', 1, 50, 'Broad-market benchmark ETF candidate.'),
  ('watchlist_kairox_conservative_o', 'watchlist_kairox_conservative_core', 'asset_o', 1, 60, 'Income-oriented REIT candidate.'),
  ('watchlist_kairox_conservative_btc_usd', 'watchlist_kairox_conservative_core', 'asset_btc_usd', 1, 120, 'Minimal crypto allocation only.'),
  ('watchlist_kairox_high_risk_btc_usd', 'watchlist_kairox_high_risk_core', 'asset_btc_usd', 1, 10, 'Higher crypto allocation within paper-only limits.'),
  ('watchlist_kairox_high_risk_qqq', 'watchlist_kairox_high_risk_core', 'asset_qqq', 1, 20, 'Growth-heavy Nasdaq-100 ETF.'),
  ('watchlist_kairox_high_risk_soxx', 'watchlist_kairox_high_risk_core', 'asset_soxx', 1, 30, 'Semiconductor sector growth ETF.'),
  ('watchlist_kairox_high_risk_msft', 'watchlist_kairox_high_risk_core', 'asset_msft', 1, 40, 'Large-cap technology stock.'),
  ('watchlist_kairox_high_risk_aapl', 'watchlist_kairox_high_risk_core', 'asset_aapl', 1, 50, 'Large-cap technology stock.'),
  ('watchlist_kairox_high_risk_voo', 'watchlist_kairox_high_risk_core', 'asset_voo', 1, 60, 'Broad equity ETF ballast.'),
  ('watchlist_kairox_high_risk_vti', 'watchlist_kairox_high_risk_core', 'asset_vti', 1, 70, 'Total-market equity ETF ballast.'),
  ('watchlist_kairox_high_risk_spy', 'watchlist_kairox_high_risk_core', 'asset_spy', 1, 80, 'Broad-market benchmark ETF candidate.');

INSERT OR IGNORE INTO daily_snapshots (
  id, portfolio_id, snapshot_date, cash_usd, positions_value_usd, total_value_usd
)
SELECT
  'snapshot_' || portfolio_id || '_comparison_start',
  portfolio_id,
  date(comparison_start_timestamp),
  comparison_start_equity_usd,
  0,
  comparison_start_equity_usd
FROM portfolio_profiles
WHERE portfolio_id IN ('portfolio_kairox_conservative', 'portfolio_kairox_high_risk');

INSERT OR IGNORE INTO portfolio_equity_history (
  id, portfolio_id, recorded_at, cash_usd, positions_value_usd,
  realized_pl_usd, unrealized_pl_usd, estimated_transaction_costs_usd,
  dividend_income_usd, price_return_usd, dividend_return_usd,
  total_return_usd, total_value_usd, max_drawdown_pct, benchmark_json
)
SELECT
  'equity_' || portfolio_id || '_comparison_start',
  portfolio_id,
  comparison_start_timestamp,
  comparison_start_equity_usd,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  comparison_start_equity_usd,
  0,
  '[]'
FROM portfolio_profiles
WHERE portfolio_id IN ('portfolio_kairox_conservative', 'portfolio_kairox_high_risk');
