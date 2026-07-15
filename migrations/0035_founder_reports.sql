CREATE TABLE IF NOT EXISTS founder_reports (
  id TEXT PRIMARY KEY,
  run_key TEXT NOT NULL UNIQUE,
  report_date TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  facts_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_founder_reports_date
  ON founder_reports(report_date DESC, created_at DESC);
