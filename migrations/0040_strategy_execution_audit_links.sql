ALTER TABLE recommendations ADD COLUMN scheduler_parent_run_id TEXT;
ALTER TABLE recommendations ADD COLUMN scheduler_child_run_id TEXT;
ALTER TABLE recommendations ADD COLUMN strategy_profile_key TEXT;
ALTER TABLE recommendations ADD COLUMN quote_source TEXT;
ALTER TABLE recommendations ADD COLUMN quote_timestamp TEXT;

ALTER TABLE decision_journal ADD COLUMN scheduler_parent_run_id TEXT;
ALTER TABLE decision_journal ADD COLUMN scheduler_child_run_id TEXT;
ALTER TABLE decision_journal ADD COLUMN strategy_profile_key TEXT;
ALTER TABLE decision_journal ADD COLUMN quote_source TEXT;
ALTER TABLE decision_journal ADD COLUMN quote_timestamp TEXT;

ALTER TABLE orders ADD COLUMN recommendation_id TEXT;
ALTER TABLE orders ADD COLUMN scheduler_parent_run_id TEXT;
ALTER TABLE orders ADD COLUMN scheduler_child_run_id TEXT;
ALTER TABLE orders ADD COLUMN strategy_profile_key TEXT;
ALTER TABLE orders ADD COLUMN decision_confidence REAL;
ALTER TABLE orders ADD COLUMN quote_source TEXT;
ALTER TABLE orders ADD COLUMN quote_timestamp TEXT;

ALTER TABLE trades ADD COLUMN recommendation_id TEXT;
ALTER TABLE trades ADD COLUMN scheduler_parent_run_id TEXT;
ALTER TABLE trades ADD COLUMN scheduler_child_run_id TEXT;
ALTER TABLE trades ADD COLUMN strategy_profile_key TEXT;
ALTER TABLE trades ADD COLUMN decision_confidence REAL;
ALTER TABLE trades ADD COLUMN quote_source TEXT;
ALTER TABLE trades ADD COLUMN quote_timestamp TEXT;

CREATE INDEX IF NOT EXISTS idx_recommendations_scheduler_child
  ON recommendations(scheduler_child_run_id, portfolio_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_scheduler_child
  ON orders(scheduler_child_run_id, portfolio_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trades_scheduler_child
  ON trades(scheduler_child_run_id, portfolio_id, executed_at DESC);
