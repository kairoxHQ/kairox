CREATE TABLE IF NOT EXISTS forward_test_benchmark_versions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  constituents_json TEXT NOT NULL DEFAULT '[]',
  target_weights_json TEXT NOT NULL DEFAULT '{}',
  rebalancing_method TEXT NOT NULL,
  rebalancing_frequency TEXT NOT NULL,
  dividend_treatment TEXT NOT NULL,
  expense_assumptions_json TEXT NOT NULL DEFAULT '{}',
  cash_rate_assumptions_json TEXT NOT NULL DEFAULT '{}',
  effective_date TEXT NOT NULL,
  change_notes TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(name, version)
);

CREATE TABLE IF NOT EXISTS forward_test_programs (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  strategy_name TEXT NOT NULL,
  strategy_version_id TEXT,
  start_date TEXT NOT NULL,
  starting_capital_usd REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'retired')),
  evidence_stage_config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_forward_test_programs_portfolio_strategy
  ON forward_test_programs(portfolio_id, strategy_name, status)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS forward_test_runs (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL,
  portfolio_id TEXT NOT NULL,
  market_date TEXT NOT NULL,
  trigger_source TEXT NOT NULL CHECK (trigger_source IN ('manual', 'scheduled')),
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'skipped', 'failed')),
  daily_review_id TEXT,
  market_data_snapshot_id TEXT,
  skip_reason TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (program_id) REFERENCES forward_test_programs(id),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  UNIQUE(program_id, market_date, trigger_source, status, started_at)
);

CREATE INDEX IF NOT EXISTS idx_forward_test_runs_program_date
  ON forward_test_runs(program_id, market_date DESC, started_at DESC);

CREATE TABLE IF NOT EXISTS forward_test_daily_valuations (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL,
  portfolio_id TEXT NOT NULL,
  tracked_portfolio_key TEXT NOT NULL,
  benchmark_version_id TEXT,
  market_date TEXT NOT NULL,
  portfolio_value_usd REAL NOT NULL,
  cash_value_usd REAL NOT NULL,
  invested_value_usd REAL NOT NULL,
  daily_return REAL,
  cumulative_return REAL NOT NULL,
  drawdown REAL NOT NULL,
  high_water_mark_usd REAL NOT NULL,
  contributions_usd REAL NOT NULL DEFAULT 0,
  withdrawals_usd REAL NOT NULL DEFAULT 0,
  dividends_usd REAL NOT NULL DEFAULT 0,
  simulated_fees_usd REAL NOT NULL DEFAULT 0,
  market_data_snapshot_id TEXT,
  data_quality_status TEXT NOT NULL,
  assumptions_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (program_id) REFERENCES forward_test_programs(id),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  UNIQUE(program_id, tracked_portfolio_key, market_date)
);

CREATE INDEX IF NOT EXISTS idx_forward_test_valuations_program_date
  ON forward_test_daily_valuations(program_id, market_date DESC, tracked_portfolio_key);

CREATE TABLE IF NOT EXISTS forward_test_decision_evaluations (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL,
  portfolio_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  strategy_version_id TEXT NOT NULL,
  decision_timestamp TEXT NOT NULL,
  market_data_snapshot_id TEXT,
  recommended_action TEXT NOT NULL,
  symbol TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  investment_score REAL NOT NULL,
  rationale TEXT NOT NULL,
  proposal_created INTEGER NOT NULL CHECK (proposal_created IN (0, 1)),
  proposal_approved INTEGER NOT NULL CHECK (proposal_approved IN (0, 1)),
  trade_executed INTEGER NOT NULL CHECK (trade_executed IN (0, 1)),
  horizon_days INTEGER NOT NULL,
  evaluation_market_date TEXT,
  security_return REAL,
  benchmark_return REAL,
  excess_return REAL,
  max_favorable_movement REAL,
  max_adverse_movement REAL,
  risk_improved INTEGER,
  diversification_improved INTEGER,
  policy_violation_reduced INTEGER,
  rationale_still_valid INTEGER,
  outcome_classification TEXT NOT NULL,
  data_quality_status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (program_id) REFERENCES forward_test_programs(id),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  UNIQUE(program_id, decision_id, horizon_days)
);

CREATE INDEX IF NOT EXISTS idx_forward_test_decision_eval_program
  ON forward_test_decision_evaluations(program_id, created_at DESC);

CREATE TABLE IF NOT EXISTS forward_test_monthly_reports (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL,
  portfolio_id TEXT NOT NULL,
  report_month TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('published', 'revised')),
  report_json TEXT NOT NULL,
  evidence_stage TEXT NOT NULL,
  disclaimer TEXT NOT NULL,
  revision_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (program_id) REFERENCES forward_test_programs(id),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  UNIQUE(program_id, report_month, version)
);

INSERT OR IGNORE INTO forward_test_benchmark_versions (
  id, name, version, constituents_json, target_weights_json, rebalancing_method,
  rebalancing_frequency, dividend_treatment, expense_assumptions_json,
  cash_rate_assumptions_json, effective_date, change_notes
) VALUES
  ('forward_benchmark_cash_v1', 'Cash Baseline', '1.0.0', '["cash"]', '{"cash":1}', 'interest_accrual', 'none', 'interest only; dividends not applicable', '{}', '{"annualRate":0.04,"compounding":"daily simple accrual","source":"configurable assumption"}', '2026-07-13', 'Initial cash baseline for IRA forward testing.'),
  ('forward_benchmark_sp500_v1', 'S&P 500 Benchmark', '1.0.0', '["SPY"]', '{"SPY":1}', 'buy_and_hold', 'none', 'price return unless adjusted total-return data is available', '{"fundExpenseIncludedInMarketPrice":true}', '{}', '2026-07-13', 'Initial broad-market benchmark using SPY as configurable ETF proxy.'),
  ('forward_benchmark_conservative_balanced_v1', 'Conservative Balanced Benchmark', '1.0.0', '["SPY","BND","cash"]', '{"SPY":0.40,"BND":0.40,"cash":0.20}', 'calendar_rebalance', 'monthly', 'price return unless adjusted total-return data is available', '{"fundExpenseIncludedInMarketPrice":true}', '{"annualRate":0.04,"compounding":"daily simple accrual"}', '2026-07-13', 'Initial conservative benchmark with stock, bond, and cash sleeves.'),
  ('forward_benchmark_buy_hold_initial_v1', 'Initial Allocation Buy-and-Hold', '1.0.0', '["first_executed_allocation"]', '{}', 'buy_and_hold', 'none', 'uses actual simulated IRA fills; dividends included only when recorded', '{"simulatedFeesFromPaperFills":true}', '{}', '2026-07-13', 'Uses the IRA first executed allocation and makes no later discretionary trades.');
