-- Multi-profile readiness fix:
-- Signal idempotency must be scoped to each virtual portfolio so one profile's
-- recommendation, journal entry, or trade does not suppress another profile.

DROP INDEX IF EXISTS idx_recommendations_signal_key;
DROP INDEX IF EXISTS idx_decision_journal_signal_key;
DROP INDEX IF EXISTS idx_trades_signal_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_recommendations_portfolio_signal_key
  ON recommendations(portfolio_id, signal_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_decision_journal_portfolio_signal_key
  ON decision_journal(portfolio_id, signal_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_portfolio_signal_key
  ON trades(portfolio_id, signal_key);
