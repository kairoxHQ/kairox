CREATE TABLE IF NOT EXISTS strategy_experiments (
  id TEXT PRIMARY KEY,
  experiment_key TEXT NOT NULL UNIQUE,
  source_portfolio_id TEXT NOT NULL,
  name TEXT NOT NULL,
  target_starting_value_usd REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  paper_only INTEGER NOT NULL DEFAULT 1 CHECK (paper_only = 1),
  live_trading_enabled INTEGER NOT NULL DEFAULT 0 CHECK (live_trading_enabled = 0),
  automatic_live_execution_enabled INTEGER NOT NULL DEFAULT 0 CHECK (automatic_live_execution_enabled = 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_portfolio_id) REFERENCES portfolios(id)
);

CREATE TABLE IF NOT EXISTS strategy_experiment_baselines (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL UNIQUE,
  source_portfolio_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  frozen_valuation_timestamp TEXT NOT NULL,
  target_value_usd REAL NOT NULL,
  source_holdings_value_usd REAL NOT NULL,
  scaling_method TEXT NOT NULL,
  initial_cash_usd REAL NOT NULL,
  initial_holdings_value_usd REAL NOT NULL,
  initial_total_value_usd REAL NOT NULL,
  data_quality_status TEXT NOT NULL,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  FOREIGN KEY (experiment_id) REFERENCES strategy_experiments(id),
  FOREIGN KEY (source_portfolio_id) REFERENCES portfolios(id)
);

CREATE TABLE IF NOT EXISTS strategy_experiment_baseline_positions (
  id TEXT PRIMARY KEY,
  baseline_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  source_quantity REAL NOT NULL,
  source_cost_basis_usd REAL NOT NULL,
  source_market_value_usd REAL NOT NULL,
  frozen_price_usd REAL NOT NULL,
  quote_source TEXT,
  quote_origin TEXT,
  quote_status TEXT,
  quote_timestamp TEXT,
  source_data_status TEXT NOT NULL,
  quantity_precision INTEGER NOT NULL,
  scaled_quantity REAL NOT NULL,
  scaled_market_value_usd REAL NOT NULL,
  experiment_cost_basis_usd REAL NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (baseline_id) REFERENCES strategy_experiment_baselines(id),
  UNIQUE (baseline_id, symbol)
);

CREATE TABLE IF NOT EXISTS strategy_experiment_portfolios (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  baseline_id TEXT NOT NULL,
  portfolio_id TEXT NOT NULL UNIQUE,
  strategy_key TEXT NOT NULL,
  strategy_display_name TEXT NOT NULL,
  source_portfolio_id TEXT NOT NULL,
  experiment_start_timestamp TEXT NOT NULL,
  experiment_starting_value_usd REAL NOT NULL,
  parameters_json TEXT NOT NULL,
  profile_enabled INTEGER NOT NULL DEFAULT 0 CHECK (profile_enabled IN (0, 1)),
  paper_only INTEGER NOT NULL DEFAULT 1 CHECK (paper_only = 1),
  live_trading_enabled INTEGER NOT NULL DEFAULT 0 CHECK (live_trading_enabled = 0),
  automatic_live_execution_enabled INTEGER NOT NULL DEFAULT 0 CHECK (automatic_live_execution_enabled = 0),
  status TEXT NOT NULL CHECK (status IN ('initialized', 'active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (experiment_id) REFERENCES strategy_experiments(id),
  FOREIGN KEY (baseline_id) REFERENCES strategy_experiment_baselines(id),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  FOREIGN KEY (source_portfolio_id) REFERENCES portfolios(id),
  UNIQUE (experiment_id, strategy_key)
);

CREATE INDEX IF NOT EXISTS idx_strategy_experiment_portfolios_experiment
  ON strategy_experiment_portfolios(experiment_id, strategy_key);

CREATE INDEX IF NOT EXISTS idx_strategy_experiment_baseline_positions_baseline
  ON strategy_experiment_baseline_positions(baseline_id, symbol);
