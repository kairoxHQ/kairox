-- Corrections and retractions are append-only: never overwrite the original intelligence record.
CREATE TABLE IF NOT EXISTS verified_intelligence_records (
  id TEXT PRIMARY KEY,
  provider_record_id TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  event_category TEXT NOT NULL,
  event_type TEXT NOT NULL,
  headline TEXT NOT NULL,
  verified_summary TEXT NOT NULL,
  related_symbols_json TEXT NOT NULL DEFAULT '[]',
  related_asset_categories_json TEXT NOT NULL DEFAULT '[]',
  event_date TEXT NOT NULL,
  published_at TEXT,
  effective_at TEXT,
  ingested_at TEXT NOT NULL,
  source_timestamp TEXT,
  source_url TEXT,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('Unverified','Single-source verified','Multi-source verified','Primary-source verified','Conflicting','Corrected','Retracted','Stale','Unsupported')),
  confidence_classification TEXT NOT NULL CHECK (confidence_classification IN ('Low','Medium','High')),
  materiality_classification TEXT NOT NULL CHECK (materiality_classification IN ('Low','Medium','High','Material')),
  materiality_score REAL NOT NULL CHECK (materiality_score >= 0 AND materiality_score <= 1),
  duplicate_group_id TEXT NOT NULL,
  correction_status TEXT NOT NULL DEFAULT 'Original' CHECK (correction_status IN ('Original','Correction','Corrected','Retracted')),
  superseding_record_id TEXT,
  raw_reference_json TEXT NOT NULL DEFAULT '{}',
  attribution_json TEXT NOT NULL DEFAULT '{}',
  license_attribution TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider_name, provider_record_id, correction_status)
);

CREATE INDEX IF NOT EXISTS idx_verified_intelligence_records_event
  ON verified_intelligence_records(event_date DESC, event_type, verification_status);

CREATE INDEX IF NOT EXISTS idx_verified_intelligence_records_duplicate
  ON verified_intelligence_records(duplicate_group_id);

CREATE TABLE IF NOT EXISTS portfolio_intelligence_links (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  intelligence_record_id TEXT NOT NULL,
  relevance_classification TEXT NOT NULL CHECK (relevance_classification IN ('Direct holding impact','Benchmark impact','Asset-class impact','Macro relevance','Low relevance','Not relevant')),
  relevance_score REAL NOT NULL CHECK (relevance_score >= 0 AND relevance_score <= 1),
  alert_severity TEXT NOT NULL CHECK (alert_severity IN ('Informational','Monitor','Review recommended','Material risk event','Data conflict','Corporate-action required')),
  related_holdings_json TEXT NOT NULL DEFAULT '[]',
  rationale TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(portfolio_id, intelligence_record_id)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_intelligence_links_portfolio
  ON portfolio_intelligence_links(portfolio_id, relevance_score DESC);

CREATE TABLE IF NOT EXISTS portfolio_intelligence_summaries (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  cycle_id TEXT,
  summary_date TEXT NOT NULL,
  intelligence_version_hash TEXT NOT NULL,
  most_material_record_id TEXT,
  holdings_affected_json TEXT NOT NULL DEFAULT '[]',
  market_wide_events_json TEXT NOT NULL DEFAULT '[]',
  upcoming_events_json TEXT NOT NULL DEFAULT '[]',
  unexplained_movements_json TEXT NOT NULL DEFAULT '[]',
  data_gaps_json TEXT NOT NULL DEFAULT '[]',
  verification_quality TEXT NOT NULL,
  intelligence_timestamp TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(portfolio_id, summary_date, intelligence_version_hash)
);

CREATE TABLE IF NOT EXISTS market_intelligence_provider_health (
  provider_name TEXT PRIMARY KEY,
  provider_type TEXT NOT NULL,
  last_success_at TEXT,
  last_failure_at TEXT,
  average_latency_ms REAL NOT NULL DEFAULT 0,
  rate_limit_status TEXT NOT NULL DEFAULT 'ok',
  records_ingested INTEGER NOT NULL DEFAULT 0,
  records_rejected INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  verification_failures INTEGER NOT NULL DEFAULT 0,
  data_freshness TEXT NOT NULL DEFAULT 'unknown',
  outage_status TEXT NOT NULL DEFAULT 'operational',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS market_intelligence_ingestion_runs (
  id TEXT PRIMARY KEY,
  provider_name TEXT NOT NULL,
  trigger_source TEXT NOT NULL CHECK (trigger_source IN ('manual','scheduled','daily_cycle')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('completed','failed','skipped')),
  records_seen INTEGER NOT NULL DEFAULT 0,
  records_ingested INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS market_intelligence_audit_events (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT,
  intelligence_record_id TEXT,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
