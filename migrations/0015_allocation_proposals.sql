CREATE TABLE IF NOT EXISTS allocation_proposals (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'ready_for_review', 'approved', 'rejected', 'expired', 'executed')),
  generated_at TEXT NOT NULL,
  market_data_timestamp TEXT,
  total_account_value_usd REAL NOT NULL,
  available_cash_usd REAL NOT NULL,
  total_proposed_investment_usd REAL NOT NULL,
  remaining_cash_usd REAL NOT NULL,
  cash_pct REAL NOT NULL,
  equity_pct REAL NOT NULL,
  bond_pct REAL NOT NULL,
  income_pct REAL NOT NULL,
  diversification_score REAL NOT NULL,
  risk_score REAL NOT NULL,
  policy_compliant INTEGER NOT NULL CHECK (policy_compliant IN (0, 1)),
  approval_allowed INTEGER NOT NULL CHECK (approval_allowed IN (0, 1)),
  rationale TEXT NOT NULL,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  policy_validation_json TEXT NOT NULL DEFAULT '{}',
  approved_at TEXT,
  rejected_at TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  UNIQUE(portfolio_id, version)
);

CREATE INDEX IF NOT EXISTS idx_allocation_proposals_portfolio_version
  ON allocation_proposals(portfolio_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_allocation_proposals_portfolio_status
  ON allocation_proposals(portfolio_id, status);

CREATE TABLE IF NOT EXISTS allocation_proposal_lines (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  line_order INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  security_name TEXT NOT NULL,
  asset_category TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  target_allocation_pct REAL NOT NULL,
  target_amount_usd REAL NOT NULL,
  estimated_shares REAL,
  current_price_usd REAL,
  price_timestamp TEXT,
  reason TEXT NOT NULL,
  risk_contribution TEXT NOT NULL,
  expected_role TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  data_timestamp TEXT,
  is_cash_reserve INTEGER NOT NULL DEFAULT 0 CHECK (is_cash_reserve IN (0, 1)),
  policy_compliant INTEGER NOT NULL CHECK (policy_compliant IN (0, 1)),
  validation_reasons_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (proposal_id) REFERENCES allocation_proposals(id)
);

CREATE INDEX IF NOT EXISTS idx_allocation_proposal_lines_proposal_order
  ON allocation_proposal_lines(proposal_id, line_order);
