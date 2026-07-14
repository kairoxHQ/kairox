CREATE TABLE IF NOT EXISTS recommendation_proposals (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  source_daily_review_id TEXT NOT NULL,
  review_market_date TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'Draft',
    'Ready for Review',
    'Approved',
    'Rejected',
    'Expired',
    'Superseded',
    'Orders Staged',
    'Executed',
    'No Actionable Proposal'
  )),
  recommendation_type TEXT NOT NULL,
  triggered_rules_json TEXT NOT NULL DEFAULT '[]',
  current_allocation_json TEXT NOT NULL DEFAULT '{}',
  target_allocation_json TEXT NOT NULL DEFAULT '{}',
  expected_allocation_json TEXT NOT NULL DEFAULT '{}',
  proposed_buys_json TEXT NOT NULL DEFAULT '[]',
  proposed_sells_json TEXT NOT NULL DEFAULT '[]',
  estimated_trade_amount_usd REAL NOT NULL,
  estimated_remaining_cash_usd REAL NOT NULL,
  policy_validation_json TEXT NOT NULL DEFAULT '{}',
  risk_score_before REAL NOT NULL,
  risk_score_after REAL NOT NULL,
  diversification_score_before REAL NOT NULL,
  diversification_score_after REAL NOT NULL,
  estimated_turnover_pct REAL NOT NULL,
  rationale TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  market_data_timestamp TEXT,
  generated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  regeneration_reason TEXT,
  no_action_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  FOREIGN KEY (source_daily_review_id) REFERENCES daily_portfolio_reviews(id),
  UNIQUE (portfolio_id, source_daily_review_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recommendation_proposals_active_review
  ON recommendation_proposals(portfolio_id, source_daily_review_id)
  WHERE status IN ('Draft', 'Ready for Review', 'Approved', 'Orders Staged');

CREATE INDEX IF NOT EXISTS idx_recommendation_proposals_portfolio_created
  ON recommendation_proposals(portfolio_id, created_at DESC);

CREATE TABLE IF NOT EXISTS recommendation_proposal_lines (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  line_order INTEGER NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('Buy', 'Sell')),
  symbol TEXT NOT NULL,
  security_name TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  asset_category TEXT NOT NULL,
  estimated_quantity REAL NOT NULL,
  estimated_amount_usd REAL NOT NULL,
  reference_price_usd REAL NOT NULL,
  market_data_timestamp TEXT NOT NULL,
  reason TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  policy_validation_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (proposal_id) REFERENCES recommendation_proposals(id)
);

CREATE INDEX IF NOT EXISTS idx_recommendation_proposal_lines_proposal
  ON recommendation_proposal_lines(proposal_id, line_order);

CREATE TABLE IF NOT EXISTS recommendation_proposal_events (
  id TEXT PRIMARY KEY,
  proposal_id TEXT,
  portfolio_id TEXT NOT NULL,
  source_daily_review_id TEXT,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (proposal_id) REFERENCES recommendation_proposals(id),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  FOREIGN KEY (source_daily_review_id) REFERENCES daily_portfolio_reviews(id)
);

CREATE INDEX IF NOT EXISTS idx_recommendation_proposal_events_portfolio_created
  ON recommendation_proposal_events(portfolio_id, created_at DESC);
