# Kairox Cloudflare Inventory - Checkpoint 1

Created: 2026-07-12

This inventory captures the current Kairox deployment before moving from the old Cloudflare account to the dedicated Kairox Cloudflare account. It is read-only documentation plus SQL exports. No new Cloudflare resources were created.

## Cloudflare Account

- Account name: `Aprilfamilycookbook@gmail.com's Account`
- Account ID: `51f44d3e22965edbc0bb25b228810055`
- Authenticated Wrangler user email: `aprilfamilycookbook@gmail.com`

## GitHub Repository

- Canonical repository: `https://github.com/kairoxHQ/kairox`
- Local branch at backup time: `main`

## Worker

- Worker name: `cryptolab-ai`
- Main entrypoint: `src/index.ts`
- Current Worker URL: `https://cryptolab-ai.aprilfamilycookbook.workers.dev`
- Future production domain: `https://app.kairoxhq.com`
- Latest observed deployment version: `27f0f40d-0501-46d8-91f8-3697554b23f5`
- Latest observed deployment timestamp: `2026-07-12T19:47:54.883Z`

## Runtime Configuration

- Compatibility date: `2026-07-11`
- Compatibility flags: none configured
- Observability: enabled
- `workers_dev`: `true`
- Preview URLs: not explicitly configured

## Routes

Configured in `wrangler.jsonc`:

```jsonc
[
  {
    "pattern": "app.kairoxhq.com",
    "custom_domain": true
  }
]
```

Note: at this checkpoint, `app.kairoxhq.com` did not resolve in DNS. The `workers.dev` URL remained functional and must be preserved during migration.

## Cron Triggers

- Production cron: `*/30 * * * *`
- Preview cron: `*/30 * * * *`

## Environment Variables

Production non-secret vars:

| Name | Value |
| --- | --- |
| `APP_MODE` | `paper` |
| `LIVE_TRADING_ENABLED` | `false` |
| `STARTING_BALANCE_USD` | `20` |
| `BENCHMARK_ASSET` | `BTC` |

Preview non-secret vars:

| Name | Value |
| --- | --- |
| `APP_MODE` | `paper` |
| `LIVE_TRADING_ENABLED` | `false` |
| `STARTING_BALANCE_USD` | `20` |
| `BENCHMARK_ASSET` | `BTC` |

## Secrets

Secret names only:

- `PAPER_RUN_SECRET`

Secret values were not printed, exported, copied, or committed.

## D1 Binding

Production binding:

| Binding | Database name | Database ID | Migrations dir |
| --- | --- | --- | --- |
| `DB` | `cryptolab-ai-db` | `09480454-a133-4f0d-b5fe-c45c59dc0ef8` | `migrations` |

Preview binding:

| Binding | Database name | Database ID | Migrations dir |
| --- | --- | --- | --- |
| `DB` | `cryptolab-ai-db` | `09480454-a133-4f0d-b5fe-c45c59dc0ef8` | `migrations` |

## D1 Database Metadata

- Database name: `cryptolab-ai-db`
- Database ID: `09480454-a133-4f0d-b5fe-c45c59dc0ef8`
- Created at: `2026-07-12T00:06:33.187Z`
- Number of tables reported by Wrangler: `22`
- Running region: `ENAM`
- Jurisdiction: `null`
- Size at inventory time: `856 kB`
- Read replication mode: disabled

## D1 Tables And Row Counts

| Table | Rows |
| --- | ---: |
| `d1_migrations` | 5 |
| `users` | 1 |
| `broker_accounts` | 1 |
| `portfolios` | 1 |
| `portfolio_goals` | 1 |
| `risk_profiles` | 1 |
| `positions` | 2 |
| `orders` | 2 |
| `trades` | 2 |
| `recommendations` | 32 |
| `decision_journal` | 32 |
| `daily_snapshots` | 2 |
| `benchmark_snapshots` | 6 |
| `strategy_runs` | 30 |
| `market_snapshots` | 60 |
| `scheduled_runs` | 22 |
| `system_settings` | 3 |
| `investment_profiles` | 1 |
| `dividend_events` | 0 |
| `portfolio_equity_history` | 38 |
| `system_summaries` | 2 |
| `market_data_status` | 2 |
| `_cf_KV` | 2 |
| `sqlite_sequence` | 1 |

## D1 Indexes

Application indexes observed:

- `idx_benchmark_snapshots_name_date`
- `idx_decision_journal_portfolio_created_at`
- `idx_decision_journal_signal_key`
- `idx_dividend_events_portfolio_created_at`
- `idx_market_data_status_updated_at`
- `idx_market_snapshots_symbol_created_at`
- `idx_orders_idempotency_key`
- `idx_portfolio_equity_history_portfolio_recorded_at`
- `idx_recommendations_portfolio_created_at`
- `idx_recommendations_signal_key`
- `idx_scheduled_runs_status_started_at`
- `idx_system_summaries_type_date`
- `idx_trades_signal_key`

SQLite autoindexes are present for table primary keys and unique constraints. They are included in the SQL schema export when applicable.

## D1 Triggers

No triggers were observed in `sqlite_master`.

## Export Files

- `migration-backup/d1-schema.sql`
- `migration-backup/d1-data.sql`
- `migration-backup/d1-full-backup.sql`

The full backup includes schema and data for all current D1 tables, including portfolios, positions, trades, decision journal, scheduled runs, summaries, settings, market data status, performance history, dividends, migrations, and internal D1 tables present in the export.

## Not Exported

- Secret values were intentionally not exported.
- Cloudflare OAuth token values were intentionally not exported.
- One-hour Wrangler export download URLs were intentionally not recorded in repository files.
