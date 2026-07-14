ALTER TABLE paper_order_batches ADD COLUMN execution_id TEXT;
ALTER TABLE paper_order_batches ADD COLUMN execution_started_at TEXT;
ALTER TABLE paper_order_batches ADD COLUMN filled_at TEXT;
ALTER TABLE paper_order_batches ADD COLUMN failure_reason TEXT;

ALTER TABLE paper_order_batch_orders ADD COLUMN fill_price_usd REAL;
ALTER TABLE paper_order_batch_orders ADD COLUMN gross_amount_usd REAL;
ALTER TABLE paper_order_batch_orders ADD COLUMN simulated_fees_usd REAL;
ALTER TABLE paper_order_batch_orders ADD COLUMN net_amount_usd REAL;
ALTER TABLE paper_order_batch_orders ADD COLUMN slippage_amount_usd REAL;
ALTER TABLE paper_order_batch_orders ADD COLUMN slippage_pct REAL;
ALTER TABLE paper_order_batch_orders ADD COLUMN filled_at TEXT;

CREATE TABLE IF NOT EXISTS paper_order_executions (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL UNIQUE,
  portfolio_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  proposal_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Executing', 'Filled', 'Failed')),
  paper_only INTEGER NOT NULL DEFAULT 1 CHECK (paper_only IN (0, 1)),
  simulated INTEGER NOT NULL DEFAULT 1 CHECK (simulated IN (0, 1)),
  order_count INTEGER NOT NULL,
  total_gross_amount_usd REAL NOT NULL,
  total_fees_usd REAL NOT NULL,
  total_net_amount_usd REAL NOT NULL,
  cash_before_usd REAL NOT NULL,
  cash_after_usd REAL NOT NULL,
  portfolio_value_after_usd REAL,
  total_account_value_after_usd REAL,
  slippage_pct REAL NOT NULL,
  validation_report_json TEXT NOT NULL DEFAULT '{}',
  failure_reason TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (batch_id) REFERENCES paper_order_batches(id),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  FOREIGN KEY (proposal_id) REFERENCES allocation_proposals(id)
);

CREATE INDEX IF NOT EXISTS idx_paper_order_executions_portfolio_created
  ON paper_order_executions(portfolio_id, created_at DESC);

CREATE TABLE IF NOT EXISTS paper_order_fills (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  staged_order_id TEXT NOT NULL UNIQUE,
  execution_order_id TEXT NOT NULL UNIQUE,
  trade_id TEXT NOT NULL UNIQUE,
  portfolio_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  proposal_version INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side = 'Buy'),
  quantity REAL NOT NULL,
  reference_price_usd REAL NOT NULL,
  fill_price_usd REAL NOT NULL,
  slippage_amount_usd REAL NOT NULL,
  slippage_pct REAL NOT NULL,
  gross_amount_usd REAL NOT NULL,
  simulated_fees_usd REAL NOT NULL,
  net_amount_usd REAL NOT NULL,
  market_data_timestamp TEXT NOT NULL,
  rationale TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  policy_validation_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status = 'Filled'),
  paper_only INTEGER NOT NULL DEFAULT 1 CHECK (paper_only IN (0, 1)),
  simulated INTEGER NOT NULL DEFAULT 1 CHECK (simulated IN (0, 1)),
  filled_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (execution_id) REFERENCES paper_order_executions(id),
  FOREIGN KEY (batch_id) REFERENCES paper_order_batches(id),
  FOREIGN KEY (staged_order_id) REFERENCES paper_order_batch_orders(id),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

CREATE INDEX IF NOT EXISTS idx_paper_order_fills_portfolio_filled
  ON paper_order_fills(portfolio_id, filled_at DESC);

CREATE TABLE IF NOT EXISTS paper_cash_ledger (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  execution_id TEXT,
  batch_id TEXT,
  fill_id TEXT,
  transaction_type TEXT NOT NULL,
  amount_usd REAL NOT NULL,
  cash_before_usd REAL NOT NULL,
  cash_after_usd REAL NOT NULL,
  description TEXT NOT NULL,
  paper_only INTEGER NOT NULL DEFAULT 1 CHECK (paper_only IN (0, 1)),
  simulated INTEGER NOT NULL DEFAULT 1 CHECK (simulated IN (0, 1)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  FOREIGN KEY (execution_id) REFERENCES paper_order_executions(id),
  FOREIGN KEY (batch_id) REFERENCES paper_order_batches(id),
  FOREIGN KEY (fill_id) REFERENCES paper_order_fills(id)
);

CREATE INDEX IF NOT EXISTS idx_paper_cash_ledger_portfolio_created
  ON paper_cash_ledger(portfolio_id, created_at DESC);

CREATE TABLE IF NOT EXISTS portfolio_transactions (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  execution_id TEXT,
  batch_id TEXT,
  fill_id TEXT,
  symbol TEXT,
  transaction_type TEXT NOT NULL,
  quantity REAL,
  price_usd REAL,
  gross_amount_usd REAL NOT NULL,
  fees_usd REAL NOT NULL DEFAULT 0,
  net_amount_usd REAL NOT NULL,
  description TEXT NOT NULL,
  paper_only INTEGER NOT NULL DEFAULT 1 CHECK (paper_only IN (0, 1)),
  simulated INTEGER NOT NULL DEFAULT 1 CHECK (simulated IN (0, 1)),
  transaction_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  FOREIGN KEY (execution_id) REFERENCES paper_order_executions(id),
  FOREIGN KEY (batch_id) REFERENCES paper_order_batches(id),
  FOREIGN KEY (fill_id) REFERENCES paper_order_fills(id)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_transactions_portfolio_time
  ON portfolio_transactions(portfolio_id, transaction_at DESC);
