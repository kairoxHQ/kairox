INSERT OR IGNORE INTO broker_accounts (
  id, user_id, broker_name, account_type, mode, status
) VALUES (
  'broker_paper_ira',
  'user_tim',
  'Paper Broker Adapter',
  'paper',
  'paper',
  'active'
);

INSERT OR IGNORE INTO portfolios (
  id, user_id, broker_account_id, name, cash_usd, starting_balance_usd, currency, mode
) VALUES (
  'portfolio_ira',
  'user_tim',
  'broker_paper_ira',
  'IRA',
  2400,
  2400,
  'USD',
  'paper'
);

INSERT OR IGNORE INTO portfolio_goals (
  id, portfolio_id, objective, target_description
) VALUES (
  'goal_ira_long_term',
  'portfolio_ira',
  'long_term_simulation',
  'Long-term paper simulation and development testing with standard portfolio behavior.'
);

INSERT OR IGNORE INTO risk_profiles (
  id, portfolio_id, risk_level, max_position_pct, max_daily_loss_pct,
  leverage_allowed, options_allowed, futures_allowed, live_trading_allowed
) VALUES (
  'risk_ira_default',
  'portfolio_ira',
  'moderate',
  0.50,
  0.04,
  0,
  0,
  0,
  0
);

INSERT OR IGNORE INTO investment_profiles (
  id, user_id, portfolio_id, primary_goal, risk_level, trading_activity,
  dividend_preference, dividend_handling, leverage_allowed, short_selling_allowed,
  options_allowed, futures_allowed, notes
) VALUES (
  'profile_ira',
  'user_tim',
  'portfolio_ira',
  'long-term investment simulation',
  'moderate',
  'standard paper simulation cadence',
  'neutral',
  'reinvest dividends',
  0,
  0,
  0,
  0,
  'Seeded sample IRA account for long-term simulation and development testing. Paper-only; no live trading.'
);

INSERT OR IGNORE INTO portfolio_profiles (
  id, portfolio_id, profile_key, display_name, philosophy, risk_posture,
  comparison_start_timestamp, comparison_start_equity_usd, normalized_start_index,
  parameters_json
) VALUES (
  'portfolio_profile_ira',
  'portfolio_ira',
  'ira',
  'IRA',
  'Long-term paper investment simulation with standard portfolio behavior.',
  'moderate',
  datetime('now'),
  2400,
  100,
  '{"minConfidence":0.60,"maxNewTradePct":0.10,"maxPositionPct":0.50,"cashReservePct":0.05,"drawdownBlockPct":0.10,"concentrationMultiplier":1.0,"cryptoPreference":1.0,"dividendPreference":1.0}'
);

INSERT OR IGNORE INTO watchlists (
  id, portfolio_id, name, description, enabled
) VALUES (
  'watchlist_ira_core',
  'portfolio_ira',
  'IRA Core Paper Universe',
  'Standard long-term paper universe for the sample IRA account.',
  1
);

INSERT OR IGNORE INTO watchlist_assets (
  id, watchlist_id, asset_id, enabled, ranking_priority, notes
) VALUES
  ('watchlist_ira_core_btc_usd', 'watchlist_ira_core', 'asset_btc_usd', 1, 10, 'Crypto candidate for long-term paper simulation.'),
  ('watchlist_ira_core_spy', 'watchlist_ira_core', 'asset_spy', 1, 20, 'Broad-market ETF candidate.'),
  ('watchlist_ira_core_voo', 'watchlist_ira_core', 'asset_voo', 1, 30, 'Low-cost S&P 500 ETF candidate.'),
  ('watchlist_ira_core_vti', 'watchlist_ira_core', 'asset_vti', 1, 40, 'Total US stock market ETF candidate.'),
  ('watchlist_ira_core_schd', 'watchlist_ira_core', 'asset_schd', 1, 50, 'Dividend-quality ETF candidate.'),
  ('watchlist_ira_core_bnd', 'watchlist_ira_core', 'asset_bnd', 1, 60, 'Bond ETF candidate for defensive allocation.');

INSERT OR IGNORE INTO daily_snapshots (
  id, portfolio_id, snapshot_date, cash_usd, positions_value_usd, total_value_usd
) VALUES (
  'snapshot_portfolio_ira_initial_cash',
  'portfolio_ira',
  date('now'),
  2400,
  0,
  2400
);

INSERT OR IGNORE INTO portfolio_equity_history (
  id, portfolio_id, recorded_at, cash_usd, positions_value_usd,
  realized_pl_usd, unrealized_pl_usd, estimated_transaction_costs_usd,
  dividend_income_usd, price_return_usd, dividend_return_usd,
  total_return_usd, total_value_usd, max_drawdown_pct, benchmark_json
) VALUES (
  'equity_portfolio_ira_initial_funding',
  'portfolio_ira',
  datetime('now'),
  2400,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  2400,
  0,
  '[]'
);

INSERT OR IGNORE INTO valuation_snapshots (
  id, portfolio_id, valuation_timestamp, account_timezone, cash_usd,
  portfolio_value_usd, total_account_value_usd, realized_pl_usd,
  unrealized_pl_usd, overall_return_usd, overall_return_pct,
  today_change_usd, today_change_pct, data_status, last_market_data_at,
  positions_json
) VALUES (
  'valuation_portfolio_ira_initial_funding',
  'portfolio_ira',
  datetime('now'),
  'America/New_York',
  2400,
  0,
  2400,
  0,
  0,
  0,
  0,
  0,
  0,
  'unavailable',
  NULL,
  '[]'
);

INSERT OR IGNORE INTO account_daily_snapshots (
  id, portfolio_id, snapshot_date, account_timezone,
  starting_cash_usd, starting_portfolio_value_usd,
  starting_total_account_value_usd, holdings_start_json,
  open_positions_start, start_data_timestamp,
  ending_cash_usd, ending_portfolio_value_usd,
  ending_total_account_value_usd, daily_pl_usd, daily_return_pct,
  realized_pl_usd, unrealized_pl_usd, trade_count, winning_trades,
  losing_trades, fees_usd, highest_account_value_usd,
  lowest_account_value_usd, max_daily_drawdown_pct, reconciled,
  reconciliation_status
) VALUES (
  'daily_portfolio_ira_initial_funding',
  'portfolio_ira',
  date('now'),
  'America/New_York',
  2400,
  0,
  2400,
  '[]',
  0,
  datetime('now'),
  2400,
  0,
  2400,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  2400,
  2400,
  0,
  1,
  'initial_funding'
);

INSERT OR IGNORE INTO journey_events (
  id, event_key, portfolio_id, event_type, timestamp, title, description,
  account_value_usd, portfolio_value_usd, cash_value_usd, source, severity,
  metadata_json
) VALUES
  (
    'journey_portfolio_ira_account_created',
    'portfolio_ira:account_created:once',
    'portfolio_ira',
    'account_created',
    datetime('now'),
    'IRA account opened',
    'IRA sample investment account opened with paper-only tracking.',
    2400,
    0,
    2400,
    'system',
    'info',
    '{"seed":"0013_seed_ira_account","paperOnly":true}'
  ),
  (
    'journey_portfolio_ira_initial_funding',
    'portfolio_ira:first_deposit:initial_funding',
    'portfolio_ira',
    'first_deposit',
    datetime('now'),
    'IRA initial funding',
    'Initial paper funding of $2,400.00 was recorded.',
    2400,
    0,
    2400,
    'system',
    'info',
    '{"amountUsd":2400,"currency":"USD","seed":"0013_seed_ira_account"}'
  );
