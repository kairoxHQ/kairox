CREATE TABLE IF NOT EXISTS domain_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  account_id TEXT,
  portfolio_id TEXT,
  source_service TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  immutable_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_domain_events_portfolio_time
  ON domain_events(portfolio_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_domain_events_type_time
  ON domain_events(event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_domain_events_correlation
  ON domain_events(correlation_id, occurred_at ASC);

CREATE TABLE IF NOT EXISTS domain_event_subscriptions (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  handler_name TEXT NOT NULL,
  handler_mode TEXT NOT NULL CHECK (handler_mode IN ('synchronous', 'asynchronous', 'scheduled')),
  target_service TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  retry_limit INTEGER NOT NULL DEFAULT 3,
  schedule_hint TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(event_type, handler_name)
);

CREATE TABLE IF NOT EXISTS domain_event_delivery_attempts (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  handler_name TEXT NOT NULL,
  handler_mode TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'delivered', 'retry_scheduled', 'dead_lettered', 'skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_attempt_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES domain_events(id),
  FOREIGN KEY (subscription_id) REFERENCES domain_event_subscriptions(id),
  UNIQUE(event_id, subscription_id)
);

CREATE TABLE IF NOT EXISTS domain_event_dead_letters (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  handler_name TEXT NOT NULL,
  failure_reason TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  failed_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution_note TEXT,
  FOREIGN KEY (event_id) REFERENCES domain_events(id),
  FOREIGN KEY (subscription_id) REFERENCES domain_event_subscriptions(id),
  UNIQUE(event_id, subscription_id)
);

CREATE TABLE IF NOT EXISTS domain_event_replay_requests (
  id TEXT PRIMARY KEY,
  requested_by TEXT NOT NULL,
  event_type TEXT,
  portfolio_id TEXT,
  from_timestamp TEXT,
  to_timestamp TEXT,
  status TEXT NOT NULL CHECK (status IN ('requested', 'running', 'completed', 'failed')),
  replayed_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  requested_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS domain_event_observability (
  id TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  event_type TEXT NOT NULL,
  published_count INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  dead_letter_count INTEGER NOT NULL DEFAULT 0,
  average_attempts REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(window_start, window_end, event_type)
);

INSERT OR IGNORE INTO domain_event_subscriptions (
  id, event_type, handler_name, handler_mode, target_service, retry_limit, schedule_hint
) VALUES
  ('sub_portfolio_valuation_completed_journey', 'PortfolioValuation.Completed', 'journey.timeline.portfolio_valuation', 'asynchronous', 'Journey', 3, NULL),
  ('sub_daily_management_completed_decision', 'DailyManagement.Completed', 'decision.evaluate_daily_management', 'asynchronous', 'Decision Engine', 3, NULL),
  ('sub_decision_generated_briefing', 'PortfolioDecision.Generated', 'briefing.explain_decision', 'asynchronous', 'Briefings', 3, NULL),
  ('sub_benchmark_updated_dashboard', 'Benchmark.Updated', 'dashboard.benchmark_observability', 'synchronous', 'Dashboard', 1, NULL),
  ('sub_research_completed_strategy', 'Research.Completed', 'strategy.consume_research_scores', 'scheduled', 'Strategy Lab', 3, 'after_research_refresh'),
  ('sub_strategy_lab_ranked_decision', 'StrategyLab.Ranked', 'decision.observe_strategy_lab', 'scheduled', 'Decision Engine', 3, 'daily_after_lab'),
  ('sub_market_intelligence_completed_research', 'MarketIntelligence.Completed', 'research.observe_market_intelligence', 'asynchronous', 'Research', 3, NULL),
  ('sub_journey_event_recorded_timeline', 'Journey.EventRecorded', 'journey.timeline.audit', 'synchronous', 'Journey', 1, NULL),
  ('sub_market_data_refreshed_valuation', 'MarketData.Refreshed', 'valuation.observe_market_data', 'asynchronous', 'Portfolio Valuation', 3, NULL);
