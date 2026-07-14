CREATE TABLE IF NOT EXISTS daily_management_cycle_config (
  id TEXT PRIMARY KEY,
  risk_profile TEXT NOT NULL,
  hold_drift_threshold_pct REAL NOT NULL,
  review_drift_threshold_pct REAL NOT NULL,
  rebalance_drift_threshold_pct REAL NOT NULL,
  drawdown_review_threshold_pct REAL NOT NULL,
  critical_drawdown_threshold_pct REAL NOT NULL,
  stale_price_ms INTEGER NOT NULL,
  target_cash_pct REAL NOT NULL,
  target_equity_pct REAL NOT NULL,
  target_bond_pct REAL NOT NULL,
  target_other_pct REAL NOT NULL,
  auto_create_draft_proposal INTEGER NOT NULL DEFAULT 1 CHECK (auto_create_draft_proposal IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO daily_management_cycle_config (
  id, risk_profile, hold_drift_threshold_pct, review_drift_threshold_pct,
  rebalance_drift_threshold_pct, drawdown_review_threshold_pct,
  critical_drawdown_threshold_pct, stale_price_ms, target_cash_pct,
  target_equity_pct, target_bond_pct, target_other_pct,
  auto_create_draft_proposal
) VALUES (
  'daily_management_conservative_v1',
  'Conservative',
  0.05,
  0.05,
  0.10,
  0.07,
  0.10,
  129600000,
  0.40,
  0.40,
  0.20,
  0.00,
  1
);

CREATE TABLE IF NOT EXISTS daily_management_cycles (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  cycle_date TEXT NOT NULL,
  trigger_source TEXT NOT NULL CHECK (trigger_source IN ('manual', 'scheduled')),
  status TEXT NOT NULL CHECK (status IN ('completed', 'skipped', 'failed')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  data_timestamp TEXT,
  market_data_snapshot_id TEXT,
  market_data_status TEXT NOT NULL,
  provider_summary_json TEXT NOT NULL DEFAULT '[]',
  portfolio_value_usd REAL NOT NULL DEFAULT 0,
  invested_value_usd REAL NOT NULL DEFAULT 0,
  cash_usd REAL NOT NULL DEFAULT 0,
  daily_change_usd REAL NOT NULL DEFAULT 0,
  daily_change_pct REAL NOT NULL DEFAULT 0,
  return_since_start_usd REAL NOT NULL DEFAULT 0,
  return_since_start_pct REAL NOT NULL DEFAULT 0,
  unrealized_gain_loss_usd REAL NOT NULL DEFAULT 0,
  unrealized_gain_loss_pct REAL NOT NULL DEFAULT 0,
  current_allocation_json TEXT NOT NULL DEFAULT '{}',
  target_allocation_json TEXT NOT NULL DEFAULT '{}',
  allocation_drift_json TEXT NOT NULL DEFAULT '{}',
  performance_metrics_json TEXT NOT NULL DEFAULT '{}',
  drawdown_metrics_json TEXT NOT NULL DEFAULT '{}',
  risk_findings_json TEXT NOT NULL DEFAULT '[]',
  policy_findings_json TEXT NOT NULL DEFAULT '[]',
  unresolved_items_json TEXT NOT NULL DEFAULT '[]',
  policy_compliant INTEGER NOT NULL DEFAULT 0 CHECK (policy_compliant IN (0, 1)),
  outcome TEXT NOT NULL CHECK (outcome IN ('Hold', 'Review recommended', 'Rebalance proposal recommended', 'Risk alert', 'Data unavailable', 'Policy violation')),
  recommendation_explanation TEXT NOT NULL,
  daily_review_id TEXT,
  created_proposal_id TEXT,
  error_details TEXT,
  refresh_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (portfolio_id, cycle_date),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  FOREIGN KEY (daily_review_id) REFERENCES daily_portfolio_reviews(id),
  FOREIGN KEY (created_proposal_id) REFERENCES recommendation_proposals(id)
);

CREATE INDEX IF NOT EXISTS idx_daily_management_cycles_portfolio_date
  ON daily_management_cycles(portfolio_id, cycle_date DESC);

CREATE TABLE IF NOT EXISTS daily_management_cycle_events (
  id TEXT PRIMARY KEY,
  cycle_id TEXT,
  portfolio_id TEXT NOT NULL,
  cycle_date TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (cycle_id) REFERENCES daily_management_cycles(id),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

CREATE INDEX IF NOT EXISTS idx_daily_management_cycle_events_portfolio_created
  ON daily_management_cycle_events(portfolio_id, created_at DESC);
