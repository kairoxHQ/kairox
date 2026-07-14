CREATE TABLE IF NOT EXISTS benchmark_configurations (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  benchmark_key TEXT NOT NULL,
  benchmark_name TEXT NOT NULL,
  benchmark_type TEXT NOT NULL,
  version INTEGER NOT NULL,
  starting_capital_usd REAL NOT NULL,
  start_date TEXT NOT NULL,
  annual_rate REAL,
  apy REAL,
  allocation_json TEXT NOT NULL DEFAULT '{}',
  rebalance_rule TEXT NOT NULL,
  dividend_rule TEXT NOT NULL,
  data_provider TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  UNIQUE(portfolio_id, benchmark_key, version)
);

CREATE INDEX IF NOT EXISTS idx_benchmark_configurations_portfolio
  ON benchmark_configurations(portfolio_id, active, benchmark_key);

CREATE TABLE IF NOT EXISTS benchmark_daily_valuations (
  id TEXT PRIMARY KEY,
  benchmark_id TEXT NOT NULL,
  portfolio_id TEXT NOT NULL,
  valuation_date TEXT NOT NULL,
  cash_value_usd REAL NOT NULL,
  invested_value_usd REAL NOT NULL,
  total_value_usd REAL NOT NULL,
  daily_change_usd REAL,
  daily_change_pct REAL,
  cumulative_return_pct REAL NOT NULL,
  high_water_mark_usd REAL NOT NULL,
  current_drawdown_pct REAL NOT NULL,
  maximum_drawdown_pct REAL NOT NULL,
  market_data_snapshot_id TEXT,
  data_timestamp TEXT,
  pricing_status TEXT NOT NULL,
  unavailable_reason TEXT,
  assumptions_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (benchmark_id) REFERENCES benchmark_configurations(id),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  UNIQUE(benchmark_id, valuation_date)
);

CREATE INDEX IF NOT EXISTS idx_benchmark_daily_valuations_portfolio_date
  ON benchmark_daily_valuations(portfolio_id, valuation_date DESC, benchmark_id);

CREATE TABLE IF NOT EXISTS benchmark_comparison_runs (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  run_date TEXT NOT NULL,
  trigger_source TEXT NOT NULL CHECK (trigger_source IN ('manual', 'scheduled')),
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'skipped', 'failed')),
  market_data_snapshot_id TEXT,
  message TEXT,
  error_details TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

CREATE INDEX IF NOT EXISTS idx_benchmark_comparison_runs_portfolio_date
  ON benchmark_comparison_runs(portfolio_id, run_date DESC, started_at DESC);

CREATE TABLE IF NOT EXISTS benchmark_monthly_reports (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  report_month TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('published', 'revised')),
  report_html TEXT NOT NULL,
  report_csv TEXT NOT NULL,
  report_json TEXT NOT NULL,
  evidence_label TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revision_reason TEXT,
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  UNIQUE(portfolio_id, report_month, version)
);

CREATE INDEX IF NOT EXISTS idx_benchmark_monthly_reports_portfolio_month
  ON benchmark_monthly_reports(portfolio_id, report_month DESC, version DESC);

INSERT OR IGNORE INTO benchmark_configurations (
  id, portfolio_id, benchmark_key, benchmark_name, benchmark_type, version,
  starting_capital_usd, start_date, annual_rate, apy, allocation_json,
  rebalance_rule, dividend_rule, data_provider, active, notes
)
SELECT
  'benchmark_' || p.id || '_cash_v1',
  p.id,
  'cash',
  'Cash benchmark',
  'cash',
  1,
  p.starting_balance_usd,
  substr(COALESCE(pol.simulation_began_at, p.created_at), 1, 10),
  0,
  0,
  '{"cash":1}',
  'none',
  'interest only; no dividends',
  'internal assumption',
  1,
  'Principal-only cash comparison seeded from the account starting capital.'
FROM portfolios p
LEFT JOIN account_investment_policies pol ON pol.portfolio_id = p.id
WHERE p.id = 'portfolio_ira';

INSERT OR IGNORE INTO benchmark_configurations (
  id, portfolio_id, benchmark_key, benchmark_name, benchmark_type, version,
  starting_capital_usd, start_date, annual_rate, apy, allocation_json,
  rebalance_rule, dividend_rule, data_provider, active, notes
)
SELECT
  'benchmark_' || p.id || '_bank_interest_v1',
  p.id,
  'bank_interest',
  'Bank-interest benchmark',
  'interest',
  1,
  p.starting_balance_usd,
  substr(COALESCE(pol.simulation_began_at, p.created_at), 1, 10),
  0.04,
  0.04,
  '{"cash":1}',
  'daily accrual',
  'interest only; no dividends',
  'internal 4% APY assumption',
  1,
  'High-yield savings style comparison using configurable daily accrual.'
FROM portfolios p
LEFT JOIN account_investment_policies pol ON pol.portfolio_id = p.id
WHERE p.id = 'portfolio_ira';

INSERT OR IGNORE INTO benchmark_configurations (
  id, portfolio_id, benchmark_key, benchmark_name, benchmark_type, version,
  starting_capital_usd, start_date, annual_rate, apy, allocation_json,
  rebalance_rule, dividend_rule, data_provider, active, notes
)
SELECT
  'benchmark_' || p.id || '_cd_style_v1',
  p.id,
  'cd_style',
  'CD-style benchmark',
  'interest',
  1,
  p.starting_balance_usd,
  substr(COALESCE(pol.simulation_began_at, p.created_at), 1, 10),
  0.045,
  0.045,
  '{"cash":1}',
  'daily accrual',
  'interest only; no dividends',
  'internal 4.5% APY assumption',
  1,
  'Conservative CD-style comparison; no early-withdrawal penalties are modeled.'
FROM portfolios p
LEFT JOIN account_investment_policies pol ON pol.portfolio_id = p.id
WHERE p.id = 'portfolio_ira';

INSERT OR IGNORE INTO benchmark_configurations (
  id, portfolio_id, benchmark_key, benchmark_name, benchmark_type, version,
  starting_capital_usd, start_date, annual_rate, apy, allocation_json,
  rebalance_rule, dividend_rule, data_provider, active, notes
)
SELECT
  'benchmark_' || p.id || '_vti_buy_hold_v1',
  p.id,
  'vti_buy_hold',
  '100% VTI buy-and-hold',
  'market',
  1,
  p.starting_balance_usd,
  substr(COALESCE(pol.simulation_began_at, p.created_at), 1, 10),
  NULL,
  NULL,
  '{"VTI":1}',
  'buy and hold',
  'dividends included only when reliable adjusted or recorded data is available',
  'MarketDataService',
  1,
  'All-equity benchmark using VTI as the configurable broad-market ETF proxy.'
FROM portfolios p
LEFT JOIN account_investment_policies pol ON pol.portfolio_id = p.id
WHERE p.id = 'portfolio_ira';

INSERT OR IGNORE INTO benchmark_configurations (
  id, portfolio_id, benchmark_key, benchmark_name, benchmark_type, version,
  starting_capital_usd, start_date, annual_rate, apy, allocation_json,
  rebalance_rule, dividend_rule, data_provider, active, notes
)
SELECT
  'benchmark_' || p.id || '_conservative_60_40_v1',
  p.id,
  'conservative_60_40',
  'Conservative 60/40 benchmark',
  'market',
  1,
  p.starting_balance_usd,
  substr(COALESCE(pol.simulation_began_at, p.created_at), 1, 10),
  0,
  0,
  '{"VTI":0.60,"BND":0.40}',
  'buy and hold',
  'dividends included only when reliable adjusted or recorded data is available',
  'MarketDataService',
  1,
  'Stock and bond comparison using VTI and BND with no tactical changes.'
FROM portfolios p
LEFT JOIN account_investment_policies pol ON pol.portfolio_id = p.id
WHERE p.id = 'portfolio_ira';

INSERT OR IGNORE INTO benchmark_configurations (
  id, portfolio_id, benchmark_key, benchmark_name, benchmark_type, version,
  starting_capital_usd, start_date, annual_rate, apy, allocation_json,
  rebalance_rule, dividend_rule, data_provider, active, notes
)
SELECT
  'benchmark_' || p.id || '_kairox_actual_v1',
  p.id,
  'kairox_actual',
  'Kairox IRA paper portfolio',
  'actual',
  1,
  p.starting_balance_usd,
  substr(COALESCE(pol.simulation_began_at, p.created_at), 1, 10),
  NULL,
  NULL,
  '{}',
  'actual paper workflow',
  'uses recorded paper portfolio data',
  'Kairox valuation',
  1,
  'Actual Kairox managed paper portfolio; not live brokerage performance.'
FROM portfolios p
LEFT JOIN account_investment_policies pol ON pol.portfolio_id = p.id
WHERE p.id = 'portfolio_ira';
