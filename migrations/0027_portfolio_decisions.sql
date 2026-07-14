CREATE TABLE IF NOT EXISTS portfolio_decision_rule_configs (
  id TEXT PRIMARY KEY,
  risk_profile TEXT NOT NULL,
  strategy_name TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  minimum_allocation_drift_pct REAL NOT NULL,
  rebalance_drift_threshold_pct REAL NOT NULL,
  deploy_cash_excess_pct REAL NOT NULL,
  defensive_drawdown_pct REAL NOT NULL,
  critical_drawdown_pct REAL NOT NULL,
  minimum_trade_value_usd REAL NOT NULL,
  minimum_expected_improvement_pct REAL NOT NULL,
  cooldown_days_after_execution INTEGER NOT NULL,
  maximum_monthly_turnover_pct REAL NOT NULL,
  maximum_quarterly_rebalances INTEGER NOT NULL,
  minimum_confidence REAL NOT NULL,
  stale_price_ms INTEGER NOT NULL,
  expiration_hours INTEGER NOT NULL,
  rules_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(risk_profile, strategy_name, version)
);

CREATE TABLE IF NOT EXISTS portfolio_decisions (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  source_cycle_id TEXT NOT NULL,
  source_cycle_version_hash TEXT NOT NULL,
  evaluation_date TEXT NOT NULL,
  primary_recommendation TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  urgency TEXT NOT NULL,
  summary TEXT NOT NULL,
  detailed_explanation TEXT NOT NULL,
  supporting_facts_json TEXT NOT NULL DEFAULT '[]',
  triggered_rules_json TEXT NOT NULL DEFAULT '[]',
  suppressed_rules_json TEXT NOT NULL DEFAULT '[]',
  policy_compliance_json TEXT NOT NULL DEFAULT '{}',
  current_allocation_json TEXT NOT NULL DEFAULT '{}',
  target_allocation_json TEXT NOT NULL DEFAULT '{}',
  allocation_drift_json TEXT NOT NULL DEFAULT '{}',
  actions_json TEXT NOT NULL DEFAULT '[]',
  cash_level_json TEXT NOT NULL DEFAULT '{}',
  drawdown_json TEXT NOT NULL DEFAULT '{}',
  risk_score REAL NOT NULL,
  benchmark_context_json TEXT NOT NULL DEFAULT '{}',
  input_snapshot_json TEXT NOT NULL DEFAULT '{}',
  data_timestamp TEXT,
  data_quality_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_response TEXT,
  user_response_reason TEXT,
  responded_at TEXT,
  resulting_proposal_id TEXT,
  superseding_decision_id TEXT,
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  FOREIGN KEY (resulting_proposal_id) REFERENCES recommendation_proposals(id),
  UNIQUE(portfolio_id, source_cycle_id, source_cycle_version_hash)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_decisions_portfolio_created
  ON portfolio_decisions(portfolio_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_portfolio_decisions_status
  ON portfolio_decisions(portfolio_id, status, evaluation_date DESC);

CREATE TABLE IF NOT EXISTS portfolio_decision_events (
  id TEXT PRIMARY KEY,
  decision_id TEXT,
  portfolio_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (decision_id) REFERENCES portfolio_decisions(id),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_decision_events_decision
  ON portfolio_decision_events(decision_id, created_at DESC);

INSERT OR IGNORE INTO portfolio_decision_rule_configs (
  id, risk_profile, strategy_name, version, status,
  minimum_allocation_drift_pct, rebalance_drift_threshold_pct, deploy_cash_excess_pct,
  defensive_drawdown_pct, critical_drawdown_pct, minimum_trade_value_usd,
  minimum_expected_improvement_pct, cooldown_days_after_execution,
  maximum_monthly_turnover_pct, maximum_quarterly_rebalances, minimum_confidence,
  stale_price_ms, expiration_hours, rules_json
) VALUES (
  'portfolio_decision_conservative_retirement_v1',
  'Conservative',
  'Conservative Retirement',
  1,
  'active',
  0.03,
  0.08,
  0.08,
  0.07,
  0.10,
  25,
  0.02,
  7,
  0.20,
  2,
  0.65,
  129600000,
  24,
  '{
    "principles": [
      "Policy compliance",
      "Capital preservation",
      "Risk control",
      "Allocation discipline",
      "Long-term strategy consistency",
      "Cost and turnover control",
      "Return optimization"
    ],
    "benchmarkUse": "Context only; benchmark outperformance does not directly force trades.",
    "antiChurn": "Small daily price moves alone cannot trigger an actionable trade recommendation."
  }'
);
