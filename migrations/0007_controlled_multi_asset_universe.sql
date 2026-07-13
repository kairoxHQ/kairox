ALTER TABLE recommendations ADD COLUMN asset_type TEXT;
ALTER TABLE recommendations ADD COLUMN screen_eligible INTEGER;
ALTER TABLE recommendations ADD COLUMN screen_score REAL;
ALTER TABLE recommendations ADD COLUMN screen_rank INTEGER;
ALTER TABLE recommendations ADD COLUMN screen_reason TEXT;
ALTER TABLE recommendations ADD COLUMN data_freshness TEXT;
ALTER TABLE recommendations ADD COLUMN current_exposure_pct REAL;

INSERT OR IGNORE INTO assets (
  id, symbol, display_name, asset_type, market, currency, provider_symbol,
  enabled, tradable, fractional_supported, dividend_capable,
  expense_ratio, minimum_investment, market_hours_mode, price_precision, quantity_precision
) VALUES
  ('asset_voo', 'VOO', 'Vanguard S&P 500 ETF', 'etf', 'US', 'USD', 'VOO', 1, 1, 1, 1, 0.0003, NULL, 'us_regular', 2, 6),
  ('asset_vti', 'VTI', 'Vanguard Total Stock Market ETF', 'etf', 'US', 'USD', 'VTI', 1, 1, 1, 1, 0.0003, NULL, 'us_regular', 2, 6),
  ('asset_qqq', 'QQQ', 'Invesco QQQ Trust', 'etf', 'US', 'USD', 'QQQ', 1, 1, 1, 1, 0.0018, NULL, 'us_regular', 2, 6),
  ('asset_schd', 'SCHD', 'Schwab U.S. Dividend Equity ETF', 'etf', 'US', 'USD', 'SCHD', 1, 1, 1, 1, 0.0006, NULL, 'us_regular', 2, 6),
  ('asset_soxx', 'SOXX', 'iShares Semiconductor ETF', 'etf', 'US', 'USD', 'SOXX', 1, 1, 1, 1, 0.0035, NULL, 'us_regular', 2, 6),
  ('asset_bnd', 'BND', 'Vanguard Total Bond Market ETF', 'bond_fund', 'US', 'USD', 'BND', 1, 1, 1, 1, 0.0003, NULL, 'us_regular', 2, 6),
  ('asset_msft', 'MSFT', 'Microsoft Corporation', 'stock', 'US', 'USD', 'MSFT', 1, 1, 1, 1, NULL, NULL, 'us_regular', 2, 6),
  ('asset_aapl', 'AAPL', 'Apple Inc.', 'stock', 'US', 'USD', 'AAPL', 1, 1, 1, 1, NULL, NULL, 'us_regular', 2, 6),
  ('asset_o', 'O', 'Realty Income Corporation', 'reit', 'US', 'USD', 'O', 1, 1, 1, 1, NULL, NULL, 'us_regular', 2, 6),
  ('asset_fxaix', 'FXAIX', 'Fidelity 500 Index Fund', 'mutual_fund', 'US', 'USD', 'FXAIX', 1, 0, 1, 1, 0.00015, NULL, 'fund_end_of_day', 2, 6);

UPDATE assets SET
  display_name = CASE symbol
    WHEN 'BTC-USD' THEN 'Bitcoin'
    WHEN 'SPY' THEN 'SPDR S&P 500 ETF Trust'
    ELSE display_name
  END,
  enabled = 1,
  updated_at = datetime('now')
WHERE symbol IN ('BTC-USD', 'SPY');

INSERT OR IGNORE INTO watchlist_assets (
  id, watchlist_id, asset_id, enabled, ranking_priority, notes
) VALUES
  ('watchlist_tim_core_voo', 'watchlist_tim_core', 'asset_voo', 1, 30, 'Low-cost S&P 500 ETF candidate.'),
  ('watchlist_tim_core_vti', 'watchlist_tim_core', 'asset_vti', 1, 40, 'Low-cost total US stock market ETF candidate.'),
  ('watchlist_tim_core_qqq', 'watchlist_tim_core', 'asset_qqq', 1, 50, 'Nasdaq-100 growth ETF candidate.'),
  ('watchlist_tim_core_schd', 'watchlist_tim_core', 'asset_schd', 1, 60, 'Dividend-quality ETF candidate; total return remains primary.'),
  ('watchlist_tim_core_soxx', 'watchlist_tim_core', 'asset_soxx', 1, 70, 'Semiconductor ETF candidate with sector concentration risk.'),
  ('watchlist_tim_core_bnd', 'watchlist_tim_core', 'asset_bnd', 1, 80, 'Bond ETF candidate for defensive allocation.'),
  ('watchlist_tim_core_msft', 'watchlist_tim_core', 'asset_msft', 1, 90, 'Large-cap stock candidate.'),
  ('watchlist_tim_core_aapl', 'watchlist_tim_core', 'asset_aapl', 1, 100, 'Large-cap stock candidate.'),
  ('watchlist_tim_core_o', 'watchlist_tim_core', 'asset_o', 1, 110, 'REIT candidate; dividend preference is secondary to total return.'),
  ('watchlist_tim_core_fxaix', 'watchlist_tim_core', 'asset_fxaix', 1, 120, 'Mutual fund tracked by daily NAV; production paper execution disabled until NAV assumptions are verified.');

UPDATE watchlist_assets SET
  ranking_priority = CASE asset_id
    WHEN 'asset_btc_usd' THEN 10
    WHEN 'asset_spy' THEN 20
    WHEN 'asset_voo' THEN 30
    WHEN 'asset_vti' THEN 40
    WHEN 'asset_qqq' THEN 50
    WHEN 'asset_schd' THEN 60
    WHEN 'asset_soxx' THEN 70
    WHEN 'asset_bnd' THEN 80
    WHEN 'asset_msft' THEN 90
    WHEN 'asset_aapl' THEN 100
    WHEN 'asset_o' THEN 110
    WHEN 'asset_fxaix' THEN 120
    ELSE ranking_priority
  END,
  enabled = 1,
  updated_at = datetime('now')
WHERE watchlist_id = 'watchlist_tim_core';
