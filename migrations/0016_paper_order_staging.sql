ALTER TABLE allocation_proposals ADD COLUMN revision_required INTEGER NOT NULL DEFAULT 0 CHECK (revision_required IN (0, 1));
ALTER TABLE allocation_proposals ADD COLUMN revision_reason TEXT;

CREATE TABLE IF NOT EXISTS paper_order_batches (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  proposal_version INTEGER NOT NULL,
  total_estimated_purchase_usd REAL NOT NULL,
  estimated_remaining_cash_usd REAL NOT NULL,
  order_count INTEGER NOT NULL,
  validation_status TEXT NOT NULL CHECK (validation_status IN ('passed', 'failed')),
  validation_report_json TEXT NOT NULL DEFAULT '{}',
  price_deviation_status TEXT NOT NULL CHECK (price_deviation_status IN ('none', 'warning')),
  price_deviation_threshold_pct REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Pending Review', 'Ready to Execute', 'Rejected', 'Cancelled', 'Expired', 'Executing', 'Partially Filled', 'Filled', 'Failed')),
  rejection_reason TEXT,
  cancelled_reason TEXT,
  reviewed_at TEXT,
  rejected_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  FOREIGN KEY (proposal_id) REFERENCES allocation_proposals(id),
  UNIQUE(proposal_id)
);

CREATE INDEX IF NOT EXISTS idx_paper_order_batches_portfolio_created
  ON paper_order_batches(portfolio_id, created_at DESC);

CREATE TABLE IF NOT EXISTS paper_order_batch_orders (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  portfolio_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  proposal_version INTEGER NOT NULL,
  line_order INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  security_name TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side = 'Buy'),
  order_type TEXT NOT NULL,
  estimated_quantity REAL NOT NULL,
  estimated_dollar_amount_usd REAL NOT NULL,
  reference_price_usd REAL NOT NULL,
  latest_reference_price_usd REAL NOT NULL,
  market_data_timestamp TEXT NOT NULL,
  asset_category TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  investment_rationale TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  policy_validation_json TEXT NOT NULL DEFAULT '{}',
  price_deviation_pct REAL NOT NULL DEFAULT 0,
  price_deviation_warning INTEGER NOT NULL DEFAULT 0 CHECK (price_deviation_warning IN (0, 1)),
  fractional_quantity_supported INTEGER NOT NULL DEFAULT 0 CHECK (fractional_quantity_supported IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('Pending Review', 'Ready to Execute', 'Rejected', 'Cancelled', 'Expired', 'Executing', 'Partially Filled', 'Filled', 'Failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (batch_id) REFERENCES paper_order_batches(id),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  FOREIGN KEY (proposal_id) REFERENCES allocation_proposals(id),
  UNIQUE(batch_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_paper_order_batch_orders_batch_order
  ON paper_order_batch_orders(batch_id, line_order);

CREATE TABLE IF NOT EXISTS paper_order_batch_events (
  id TEXT PRIMARY KEY,
  batch_id TEXT,
  portfolio_id TEXT NOT NULL,
  proposal_id TEXT,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES paper_order_batches(id),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  FOREIGN KEY (proposal_id) REFERENCES allocation_proposals(id)
);

CREATE INDEX IF NOT EXISTS idx_paper_order_batch_events_portfolio_created
  ON paper_order_batch_events(portfolio_id, created_at DESC);
