# Kairox

Kairox is a Cloudflare Workers-based personal paper-trading agent foundation. The current system is deliberately safe: broker-agnostic paper trading, D1 persistence, public market data, scheduled evaluation, and no live order execution.

Canonical repository: `kairoxHQ/kairox`

## Project Philosophy

Kairox is guided by the belief that individual investors deserve clear, evidence-driven investment research built from public information, transparent reasoning, and disciplined risk management. See [The Kairox Manifesto](MANIFESTO.md).

## Project Documentation

- [The Kairox Manifesto](MANIFESTO.md)
- [Architecture](ARCHITECTURE.md)
- [Deployment](DEPLOYMENT.md)
- [Domain Migration](DOMAIN_MIGRATION.md)
- [Roadmap](ROADMAP.md)
- [Principles](PRINCIPLES.md)
- [Development Log](DEVELOPMENT_LOG.md)

## Current Status

- Cloudflare Worker written in TypeScript.
- Cloudflare D1 schema for paper portfolios, recommendations, decisions, trades, and benchmarks.
- One local user: Tim.
- Simulated starting portfolio: `$20`.
- Benchmarks: Bitcoin buy-and-hold and cash.
- Scheduled automated paper runs through Cloudflare cron triggers on the production `kairox` Worker.
- Database-driven asset registry and watchlists for stocks, ETFs, mutual funds, crypto, REITs, bond funds, and money-market or cash-equivalent funds.
- Mobile-friendly dashboard at `/dashboard`.
- Live paper-portfolio valuation, daily account snapshots, milestone awards, and an append-only Kairox Journey timeline.
- Paper trading only.
- No brokerage credentials, live orders, leverage, options execution, futures execution, or paid AI API calls.

## Endpoints

- `GET /health`
- `GET /status`
- `GET /portfolio`
- `GET /recommendations`
- `GET /journal`
- `GET /benchmarks`
- `GET /market`
- `GET /trades`
- `GET /performance`
- `GET /dashboard`
- `GET /dashboard/data`
- `GET /dashboard/contract`
- `GET /valuation`
- `GET /daily-snapshots`
- `GET /historical-performance`
- `GET /daily-summary`
- `GET /milestones`
- `GET /journey`
- `GET /scheduled-runs`
- `GET /summaries`
- `GET /settings`
- `POST /paper/run`
- `POST /settings/pause`
- `POST /settings/resume`

Recommendations default to `DO_NOTHING` unless validated market data and risk checks support a different action.

`POST /paper/run` is protected by the `PAPER_RUN_SECRET` Cloudflare secret and the `x-cryptolab-paper-secret` request header. It remains paper-only and never connects to a broker.

`POST /settings/pause` and `POST /settings/resume` use the same secret header. When paused, scheduled runs may still collect market data and produce decisions, but they must not execute simulated paper trades.

## Sprint 3 Automation

Cloudflare scheduled events run the strategy every 30 minutes:

- `*/30 * * * *`

Only one production scheduler may be active at a time. The legacy `cryptolab-ai` scheduler must remain disabled now that the dedicated `kairox` production scheduler is active.

SPY and future stock/ETF assets are blocked from simulated execution outside regular US market hours. BTC-USD may be evaluated outside stock-market hours. Overlapping scheduled runs and duplicate cron deliveries are blocked with D1 run keys.

## Asset Universe

Kairox evaluates enabled assets from D1 watchlists rather than a hardcoded symbol list. The initial `Tim Core Paper Universe` watchlist enables BTC-USD and SPY. The registry can represent stocks, ETFs, mutual funds, cryptocurrencies, REITs, bond funds, and money-market or cash-equivalent funds with provider symbols, tradability, fractional support, dividend capability, precision, and market-hours metadata.

Options, futures, forex, leverage, short selling, and live brokerage execution remain out of scope.

## Dashboard

Open the current deployed app:

```text
https://app.kairoxhq.com/dashboard
```

The dashboard shows portfolio value, cash, positions, gain/loss, price return, dividend return, trade count, scheduled runs, automation status, recommendations, rejected opportunities, benchmarks, summaries, and settings. It does not expose `PAPER_RUN_SECRET`.

`GET /dashboard/contract` returns one normalized data contract for beginner, intermediate, and advanced dashboard views. All views share the same valuation, performance, market-data, trade, and decision source values.

The fallback legacy Worker URL remains `https://cryptolab-ai.aprilfamilycookbook.workers.dev`. Current production Cloudflare resources in the dedicated Kairox account are Worker `kairox` and D1 database `kairox-production-db`. See `DOMAIN_MIGRATION.md`.

## Dividends

Dividend support is accounting-first. The system separates price return, dividend return, and total return. It records simulated dividend events only when reliable amount and payment-date data is available. If dividend data is unavailable, it is marked unavailable and excluded from dividend-return calculations. Dividend yield is not a primary objective; it is a secondary preference when expected risk-adjusted total return is otherwise comparable.

## Valuation, Snapshots, And Journey

Kairox calculates live paper valuations from stored positions and the latest validated public market snapshots. If current market data is unavailable, the valuation keeps the last valid position price, marks the data stale or unavailable, and includes the market-data timestamp. Values are never invented by an AI model.

Daily snapshots are stored in `account_daily_snapshots` with one row per portfolio and account-date. The account timezone defaults to `America/New_York`; timestamps are stored in UTC and converted only for account-date boundaries or display. Snapshot creation is idempotent and does not reset the day's starting value.

Milestones are defined in `milestone_definitions` and awarded in `milestone_awards`. Definitions include ID, category, badge, condition type, threshold, comparison operator, repeatability, enabled state, and version. One-time milestones use unique award keys so retries cannot award them twice.

The Kairox Journey timeline is stored in `journey_events`. It is append-only wherever practical and records important account, trade, risk, milestone, system, and manual-intervention events.

## Local Development

This Windows workspace may not have `node` on PATH. In Codex, use the bundled runtime path if needed:

```powershell
$env:Path='C:\Users\timbo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:Path
C:\Users\timbo\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd install
C:\Users\timbo\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd run typecheck
```

Normal environments can use:

```bash
pnpm install
pnpm run dev
pnpm run typecheck
pnpm test
```

## Cloudflare D1

The Worker expects a dedicated D1 database bound as `DB`.

```bash
wrangler d1 list
wrangler d1 create kairox-production-db
```

Update `wrangler.jsonc` with the returned `database_id`, then apply:

```bash
wrangler d1 migrations apply kairox-production-db --remote
```

Do not bind any April Family Cookbook or BingeKeeper database to this project.

The production D1 binding is currently `DB -> kairox-production-db`.

## Deploy

Validate and deploy the configured Worker:

```bash
wrangler deploy --dry-run --outdir dist
wrangler deploy
```

Production and live trading remain disabled by default.

## Safety

Secrets must never be committed. Use Cloudflare dashboard secrets or local `.dev.vars` for future private configuration. This milestone does not require brokerage or AI-provider secrets.

Set the paper-run secret outside source control:

```bash
wrangler secret put PAPER_RUN_SECRET
```
