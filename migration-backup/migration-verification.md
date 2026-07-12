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

# Kairox Production D1 Restore Verification - Checkpoint 3

Restored and verified: 2026-07-12

## Scope

Checkpoint 3 restored the validated Checkpoint 1 D1 backup into the new dedicated Kairox production D1 database and verified the migrated data through direct D1 checks and read-only Worker endpoints.

No DNS changes were made. `app.kairoxhq.com` was not attached. The old `cryptolab-ai` Worker and old `cryptolab-ai-db` database were not modified. Live trading remains disabled. No trading strategy, risk, scheduler, broker, or market-data logic was changed.

## Source And Destination

| Role | Database | Database ID |
| --- | --- | --- |
| Source backup origin | `cryptolab-ai-db` | `09480454-a133-4f0d-b5fe-c45c59dc0ef8` |
| Destination restore target | `kairox-production-db` | `2e2d17c7-80ec-4ea4-b792-10377085dd87` |

The destination Worker is `kairox`, served from `https://kairox.kairoxtradingbot.workers.dev`.

## Restore Command

```powershell
.\node_modules\.bin\wrangler.CMD d1 execute kairox-production-db --remote --file migration-backup\d1-full-backup.sql -y
```

The restore executed `284` SQL statements against the remote destination database. Wrangler reported `894` rows written and `667` rows read. The destination database reported `22` tables after restoration.

## Row Count Comparison

| Table | Source backup rows | Destination rows | Status |
| --- | ---: | ---: | --- |
| `d1_migrations` | 5 | 5 | Match |
| `users` | 1 | 1 | Match |
| `broker_accounts` | 1 | 1 | Match |
| `portfolios` | 1 | 1 | Match |
| `portfolio_goals` | 1 | 1 | Match |
| `risk_profiles` | 1 | 1 | Match |
| `positions` | 2 | 2 | Match |
| `orders` | 2 | 2 | Match |
| `trades` | 2 | 2 | Match |
| `recommendations` | 32 | 32 | Match |
| `decision_journal` | 32 | 32 | Match |
| `daily_snapshots` | 2 | 2 | Match |
| `benchmark_snapshots` | 6 | 6 | Match |
| `strategy_runs` | 30 | 30 | Match |
| `market_snapshots` | 60 | 60 | Match |
| `scheduled_runs` | 22 | 22 | Match |
| `system_settings` | 3 | 3 | Match |
| `investment_profiles` | 1 | 1 | Match |
| `dividend_events` | 0 | 0 | Match |
| `portfolio_equity_history` | 38 | 38 | Match |
| `system_summaries` | 2 | 2 | Match |
| `market_data_status` | 2 | 2 | Match |
| `_cf_KV` | 2 | 2 | Match |
| `sqlite_sequence` | 1 | 1 | Match |

No row-count discrepancies were found.

## Integrity Checks

- `PRAGMA foreign_key_check` returned no violations.
- Duplicate trade `signal_key` count was `0`.
- Duplicate scheduled run `run_key` count was `0`.
- Portfolio `portfolio_tim_paper` restored with `cash_usd=16.0015`, `starting_balance_usd=20`, and `mode=paper`.
- Positions restored for `BTC-USD` and `SPY`.
- `system_settings` restored with `automation_paused=false`, `automation_schedule=*/30 * * * *`, and `live_trading_enabled=false`.
- Risk profile restored with live trading, leverage, options, and futures all disabled.
- Tim's investment profile restored with primary goal `maximize long-term net worth`, risk level `moderate growth`, and dividend handling `reinvest dividends`.

## Worker Binding And Scheduler

The production Worker configuration now binds:

```text
DB -> kairox-production-db
```

The Worker name is `kairox`. The deployed version verified during this checkpoint was `fe71e74d-d64b-4c64-8d29-3b0000e87728`.

No cron triggers are present in `wrangler.jsonc` for this checkpoint, so the new production scheduler remains disabled until cutover approval.

## Endpoint Verification

Read-only endpoints were verified on `https://kairox.kairoxtradingbot.workers.dev`:

| Endpoint | Result |
| --- | --- |
| `/health` | HTTP 200; database reachable |
| `/status` | HTTP 200; paper trading only and live trading disabled |
| `/dashboard` | HTTP 200; shows migrated portfolio, positions, trades, scheduled runs, summaries, and settings |
| `/dashboard/data` | HTTP 200; includes migrated cash, positions, trades, scheduled runs, summaries, and settings |
| `/market` | HTTP 200; shows migrated market status for `BTC-USD` and `SPY` |
| `/trades` | HTTP 200; shows migrated BUY trades |
| `/performance` | HTTP 200; shows restored performance history and benchmark returns |
| `/scheduled-runs` | HTTP 200; shows migrated scheduled run history |
| `/summaries` | HTTP 200; shows migrated morning and end-of-day summaries |
| `/settings` | HTTP 200; shows `automationPaused=false` and `liveTradingEnabled=false` |

Protected state-changing endpoints were not invoked during this checkpoint.
