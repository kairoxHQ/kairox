CREATE TABLE IF NOT EXISTS linked_portfolio_accounts (
  portfolio_id TEXT PRIMARY KEY,
  account_type TEXT NOT NULL CHECK (account_type IN ('paper', 'read_only_watchlist', 'paper_portfolio_twin')),
  linked_portfolio_id TEXT,
  relationship_label TEXT,
  manual_entry_enabled INTEGER NOT NULL DEFAULT 0 CHECK (manual_entry_enabled IN (0, 1)),
  managed_by_kairox INTEGER NOT NULL DEFAULT 1 CHECK (managed_by_kairox IN (0, 1)),
  read_only INTEGER NOT NULL DEFAULT 0 CHECK (read_only IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (account_type = 'paper' AND linked_portfolio_id IS NULL AND manual_entry_enabled = 0 AND managed_by_kairox = 1 AND read_only = 0)
    OR (account_type = 'read_only_watchlist' AND linked_portfolio_id IS NULL AND manual_entry_enabled = 1 AND managed_by_kairox = 0 AND read_only = 1)
    OR (account_type = 'paper_portfolio_twin' AND portfolio_id <> COALESCE(linked_portfolio_id, '') AND manual_entry_enabled = 0 AND managed_by_kairox = 1 AND read_only = 0)
  ),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  FOREIGN KEY (linked_portfolio_id) REFERENCES portfolios(id)
);

CREATE INDEX IF NOT EXISTS idx_linked_portfolio_accounts_type
  ON linked_portfolio_accounts(account_type, read_only, managed_by_kairox);

CREATE INDEX IF NOT EXISTS idx_linked_portfolio_accounts_link
  ON linked_portfolio_accounts(linked_portfolio_id);

CREATE TRIGGER IF NOT EXISTS trg_linked_portfolio_twin_source_insert
BEFORE INSERT ON linked_portfolio_accounts
WHEN NEW.account_type = 'paper_portfolio_twin'
  AND NEW.linked_portfolio_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM linked_portfolio_accounts source
    WHERE source.portfolio_id = NEW.linked_portfolio_id
      AND source.account_type = 'read_only_watchlist'
      AND source.read_only = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'Paper Portfolio Twin must link to a Read Only watchlist.');
END;

CREATE TRIGGER IF NOT EXISTS trg_linked_portfolio_twin_source_update
BEFORE UPDATE OF account_type, linked_portfolio_id ON linked_portfolio_accounts
WHEN NEW.account_type = 'paper_portfolio_twin'
  AND NEW.linked_portfolio_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM linked_portfolio_accounts source
    WHERE source.portfolio_id = NEW.linked_portfolio_id
      AND source.account_type = 'read_only_watchlist'
      AND source.read_only = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'Paper Portfolio Twin must link to a Read Only watchlist.');
END;

INSERT OR IGNORE INTO linked_portfolio_accounts (
  portfolio_id, account_type, relationship_label, manual_entry_enabled, managed_by_kairox, read_only
)
SELECT id, 'paper', 'Standalone paper portfolio', 0, 1, 0
FROM portfolios
WHERE mode = 'paper';
