# Kairox Migration Backup Verification - Checkpoint 1

Created: 2026-07-12

## Scope

This checkpoint performed inventory, SQL export, and local restore verification only.

No new Cloudflare resources were created. No deployment was performed as part of backup creation. No DNS, scheduler, secret, D1 production data, trading logic, strategy, risk, or market-data provider changes were made.

## Commands Run

Cloudflare/account and inventory:

```powershell
.\node_modules\.bin\wrangler.CMD whoami
.\node_modules\.bin\wrangler.CMD secret list --name cryptolab-ai
.\node_modules\.bin\wrangler.CMD d1 info cryptolab-ai-db
.\node_modules\.bin\wrangler.CMD deployments status --name cryptolab-ai
.\node_modules\.bin\wrangler.CMD d1 execute cryptolab-ai-db --remote --command "SELECT name, type FROM sqlite_master WHERE type IN ('table','index','trigger') ORDER BY type, name;"
```

D1 exports:

```powershell
.\node_modules\.bin\wrangler.CMD d1 export cryptolab-ai-db --remote --output migration-backup\d1-full-backup.sql -y
.\node_modules\.bin\wrangler.CMD d1 export cryptolab-ai-db --remote --no-data --output migration-backup\d1-schema.sql -y
.\node_modules\.bin\wrangler.CMD d1 export cryptolab-ai-db --remote --no-schema --output migration-backup\d1-data.sql -y
```

Restore verification:

```powershell
.\node_modules\.bin\wrangler.CMD d1 execute cryptolab-ai-db --local --persist-to migration-backup\restore-test-state --file migration-backup\d1-full-backup.sql -y
```

The temporary local restore state was removed after verification and is not part of the committed backup.

## Export Results

| File | Purpose | Result |
| --- | --- | --- |
| `d1-schema.sql` | Schema-only export | Created successfully |
| `d1-data.sql` | Data-only export | Created successfully |
| `d1-full-backup.sql` | Schema plus data export | Created successfully |

The full restore test executed `284` SQL commands successfully against a local D1 persistence directory.

## Restored Row Checks

The following key restored table counts were verified from the local restore:

| Table | Restored rows |
| --- | ---: |
| `portfolios` | 1 |
| `positions` | 2 |
| `trades` | 2 |
| `decision_journal` | 32 |
| `scheduled_runs` | 22 |
| `system_summaries` | 2 |
| `system_settings` | 3 |
| `market_data_status` | 2 |
| `portfolio_equity_history` | 38 |
| `dividend_events` | 0 |

## SQL Parse/Restore Status

- `d1-full-backup.sql`: parsed and restored successfully into local D1.
- `d1-schema.sql`: exported successfully.
- `d1-data.sql`: exported successfully.

## Sensitive Data Checks

The backup SQL files were scanned for obvious secret/export URL patterns, including:

- `X-Amz`
- `Signature`
- `Credential`
- `BEGIN PRIVATE`
- `PAPER_RUN_SECRET`
- `secret`
- `token`
- `password`
- `api_key`

No matches were found in `migration-backup/*.sql`.

Secret inventory records names only. Secret values are not present in these backup files.

## Validation Results

- TypeScript check: passed with `tsc --noEmit`.
- Unit tests: passed, `25/25`.
- Worker dry-run build: passed with `wrangler deploy --dry-run --outdir dist`; no deployment was performed.
- Secret-pattern scan: completed.
  - Repo-wide scan found expected documentation/code references to secret names and placeholders.
  - SQL-specific scan of `migration-backup/*.sql` found no matches for signed export URLs, private keys, `PAPER_RUN_SECRET`, `secret`, `token`, `password`, or `api_key`.
  - One SQL row containing the phrase `risk-adjusted` matched the broad `sk-...` pattern as a false positive.
- Git status before commit: only `migration-backup/` was untracked.

## Notes

- `sqlite3` was not installed on PATH, so Wrangler local D1 was used for SQL restore validation.
- A large compound `UNION ALL` row-count query hit D1's compound SELECT limit; row counts were collected with individual read-only `COUNT(*)` queries instead.
- A Wrangler/Node Windows async assertion appeared after the row-count loop had already printed counts. It did not affect the exported SQL files or the local restore test.
