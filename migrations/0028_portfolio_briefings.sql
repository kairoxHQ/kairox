CREATE TABLE IF NOT EXISTS portfolio_briefings (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  briefing_type TEXT NOT NULL,
  evaluation_date TEXT NOT NULL,
  source_cycle_id TEXT,
  source_decision_id TEXT,
  source_version_hash TEXT NOT NULL,
  version INTEGER NOT NULL,
  facts_schema_version TEXT NOT NULL,
  facts_snapshot_json TEXT NOT NULL,
  headline TEXT NOT NULL,
  summary TEXT NOT NULL,
  key_changes_json TEXT NOT NULL DEFAULT '[]',
  recommendation TEXT NOT NULL,
  supporting_reasons_json TEXT NOT NULL DEFAULT '[]',
  risks_json TEXT NOT NULL DEFAULT '[]',
  benchmark_context_json TEXT NOT NULL DEFAULT '{}',
  data_limitations_json TEXT NOT NULL DEFAULT '[]',
  disclosure TEXT NOT NULL,
  model_provider TEXT NOT NULL,
  model_identifier TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  validation_version TEXT NOT NULL,
  validation_status TEXT NOT NULL,
  validation_errors_json TEXT NOT NULL DEFAULT '[]',
  narrative_source TEXT NOT NULL,
  display_text TEXT NOT NULL,
  review_status TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  regeneration_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  FOREIGN KEY (source_decision_id) REFERENCES portfolio_decisions(id),
  UNIQUE(portfolio_id, briefing_type, source_version_hash, version)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_briefings_portfolio_date
  ON portfolio_briefings(portfolio_id, evaluation_date DESC, briefing_type, version DESC);

CREATE TABLE IF NOT EXISTS portfolio_briefing_events (
  id TEXT PRIMARY KEY,
  briefing_id TEXT,
  portfolio_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (briefing_id) REFERENCES portfolio_briefings(id),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_briefing_events_briefing
  ON portfolio_briefing_events(briefing_id, created_at DESC);
