CREATE TABLE IF NOT EXISTS valuation_snapshots (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  valuation_timestamp TEXT NOT NULL,
  account_timezone TEXT NOT NULL DEFAULT 'America/New_York',
  cash_usd REAL NOT NULL,
  portfolio_value_usd REAL NOT NULL,
  total_account_value_usd REAL NOT NULL,
  realized_pl_usd REAL NOT NULL DEFAULT 0,
  unrealized_pl_usd REAL NOT NULL DEFAULT 0,
  overall_return_usd REAL NOT NULL DEFAULT 0,
  overall_return_pct REAL NOT NULL DEFAULT 0,
  today_change_usd REAL,
  today_change_pct REAL,
  data_status TEXT NOT NULL CHECK (data_status IN ('live', 'delayed', 'stale', 'unavailable')),
  last_market_data_at TEXT,
  positions_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

CREATE INDEX IF NOT EXISTS idx_valuation_snapshots_portfolio_time
  ON valuation_snapshots(portfolio_id, valuation_timestamp DESC);

CREATE TABLE IF NOT EXISTS account_daily_snapshots (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  account_timezone TEXT NOT NULL DEFAULT 'America/New_York',
  starting_cash_usd REAL NOT NULL,
  starting_portfolio_value_usd REAL NOT NULL,
  starting_total_account_value_usd REAL NOT NULL,
  holdings_start_json TEXT NOT NULL,
  open_positions_start INTEGER NOT NULL DEFAULT 0,
  start_data_timestamp TEXT,
  ending_cash_usd REAL,
  ending_portfolio_value_usd REAL,
  ending_total_account_value_usd REAL,
  daily_pl_usd REAL,
  daily_return_pct REAL,
  realized_pl_usd REAL,
  unrealized_pl_usd REAL,
  trade_count INTEGER NOT NULL DEFAULT 0,
  winning_trades INTEGER NOT NULL DEFAULT 0,
  losing_trades INTEGER NOT NULL DEFAULT 0,
  best_trade_json TEXT,
  largest_losing_trade_json TEXT,
  fees_usd REAL NOT NULL DEFAULT 0,
  highest_account_value_usd REAL,
  lowest_account_value_usd REAL,
  max_daily_drawdown_pct REAL,
  reconciled INTEGER NOT NULL DEFAULT 0,
  reconciliation_status TEXT NOT NULL DEFAULT 'paper_only',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  UNIQUE(portfolio_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_account_daily_snapshots_portfolio_date
  ON account_daily_snapshots(portfolio_id, snapshot_date DESC);

CREATE TABLE IF NOT EXISTS milestone_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  badge_id TEXT NOT NULL,
  condition_type TEXT NOT NULL,
  threshold REAL,
  comparison_operator TEXT NOT NULL CHECK (comparison_operator IN ('gte', 'lte', 'eq', 'exists')),
  repeatable INTEGER NOT NULL DEFAULT 0,
  display_message TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS milestone_awards (
  id TEXT PRIMARY KEY,
  award_key TEXT NOT NULL UNIQUE,
  milestone_id TEXT NOT NULL,
  portfolio_id TEXT NOT NULL,
  progress_value REAL NOT NULL DEFAULT 0,
  earned_at TEXT NOT NULL,
  related_account_id TEXT,
  related_trade_id TEXT,
  related_event_id TEXT,
  display_message TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (milestone_id) REFERENCES milestone_definitions(id),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

CREATE INDEX IF NOT EXISTS idx_milestone_awards_portfolio_time
  ON milestone_awards(portfolio_id, earned_at DESC);

CREATE TABLE IF NOT EXISTS journey_events (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  portfolio_id TEXT,
  event_type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  technical_details TEXT,
  related_asset TEXT,
  related_trade_id TEXT,
  related_milestone_id TEXT,
  account_value_usd REAL,
  portfolio_value_usd REAL,
  cash_value_usd REAL,
  kairox_version TEXT NOT NULL DEFAULT '0.1.0',
  strategy_version TEXT,
  source TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

CREATE INDEX IF NOT EXISTS idx_journey_events_portfolio_time
  ON journey_events(portfolio_id, timestamp DESC);

INSERT OR IGNORE INTO milestone_definitions (
  id, name, description, category, badge_id, condition_type, threshold,
  comparison_operator, repeatable, display_message, enabled, version
) VALUES
  ('account_first_deposit', 'First deposit', 'The account has starting capital or a deposit record.', 'account_growth', 'seed-capital', 'account_value', 0.01, 'gte', 0, 'Kairox has capital to track.', 1, 1),
  ('account_value_25', 'First $25 account value', 'Total account value reached at least $25.', 'account_growth', 'value-25', 'account_value', 25, 'gte', 0, 'Account value reached $25.', 1, 1),
  ('account_value_50', 'First $50 account value', 'Total account value reached at least $50.', 'account_growth', 'value-50', 'account_value', 50, 'gte', 0, 'Account value reached $50.', 1, 1),
  ('account_value_100', 'First $100 account value', 'Total account value reached at least $100.', 'account_growth', 'value-100', 'account_value', 100, 'gte', 0, 'Account value reached $100.', 1, 1),
  ('account_value_250', 'First $250 account value', 'Total account value reached at least $250.', 'account_growth', 'value-250', 'account_value', 250, 'gte', 0, 'Account value reached $250.', 1, 1),
  ('account_value_500', 'First $500 account value', 'Total account value reached at least $500.', 'account_growth', 'value-500', 'account_value', 500, 'gte', 0, 'Account value reached $500.', 1, 1),
  ('account_value_1000', 'First $1,000 account value', 'Total account value reached at least $1,000.', 'account_growth', 'value-1000', 'account_value', 1000, 'gte', 0, 'Account value reached $1,000.', 1, 1),
  ('account_new_all_time_high', 'New all-time-high account value', 'Total account value reached a new high.', 'account_growth', 'all-time-high', 'all_time_high', NULL, 'exists', 1, 'New all-time-high account value recorded.', 1, 1),
  ('trade_first_completed', 'First completed trade', 'The first completed paper trade was recorded.', 'trading', 'first-trade', 'trade_count', 1, 'gte', 0, 'First completed paper trade recorded.', 1, 1),
  ('trade_first_profitable', 'First profitable trade', 'A trade closed with positive realized profit.', 'trading', 'first-profit', 'winning_trades', 1, 'gte', 0, 'First profitable trade recorded.', 1, 1),
  ('day_first_winning', 'First winning day', 'A daily snapshot ended with positive daily return.', 'trading', 'winning-day', 'winning_days', 1, 'gte', 0, 'First winning day recorded.', 1, 1),
  ('trades_10_completed', '10 completed trades', 'Ten completed trades were recorded.', 'trading', 'trades-10', 'trade_count', 10, 'gte', 0, 'Ten completed trades recorded.', 1, 1),
  ('trades_100_completed', '100 completed trades', 'One hundred completed trades were recorded.', 'trading', 'trades-100', 'trade_count', 100, 'gte', 0, 'One hundred completed trades recorded.', 1, 1),
  ('risk_stale_data_avoided', 'Avoided stale-data trade', 'Kairox avoided opening a trade because market data was stale or unavailable.', 'risk_management', 'stale-data-guard', 'stale_data_rejection', 1, 'gte', 1, 'Kairox avoided a stale-data trade.', 1, 1),
  ('system_first_live_price', 'First successful live-price update', 'At least one market price was validated by the market-data layer.', 'system_reliability', 'live-price', 'live_price_update', 1, 'gte', 0, 'First validated market-data update recorded.', 1, 1),
  ('system_100_strategy_evaluations', '100 successful strategy evaluations', 'One hundred strategy evaluations completed.', 'system_reliability', 'evals-100', 'strategy_evaluations', 100, 'gte', 0, 'One hundred strategy evaluations completed.', 1, 1),
  ('system_1000_strategy_evaluations', '1,000 successful strategy evaluations', 'One thousand strategy evaluations completed.', 'system_reliability', 'evals-1000', 'strategy_evaluations', 1000, 'gte', 0, 'One thousand strategy evaluations completed.', 1, 1);
