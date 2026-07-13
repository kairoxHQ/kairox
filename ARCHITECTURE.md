# Architecture

Kairox runs as a Cloudflare Worker with Cloudflare D1 for durable paper-trading state.

## Runtime

- `src/index.ts` handles HTTP routing.
- `wrangler.jsonc` defines the Worker, preview environment, and D1 binding.
- `migrations/0001_initial.sql` creates the initial schema and seeds Tim's paper portfolio.
- `migrations/0002_sprint2_paper_execution.sql` adds market snapshots, strategy runs, and idempotency columns.
- `migrations/0003_scheduled_dashboard.sql` adds scheduled runs, settings, investment profiles, dividend events, equity history, and stored summaries.
- `migrations/0006_asset_universe.sql` adds the asset registry and portfolio watchlists, then seeds BTC-USD and SPY as database-driven assets.
- `migrations/0012_journey_valuation_milestones.sql` adds valuation snapshots, daily account snapshots, milestone definitions and awards, and the append-only Journey timeline.

## Modules

- `src/market/`: asset registry reads, market-hours rules, market data providers, and benchmark reads.
- `src/portfolio/`: portfolio read models.
- `src/portfolio/valuation.ts`: live paper valuation using existing positions and validated market snapshots.
- `src/portfolio/dailySnapshots.ts`: idempotent account-day start/end snapshots and daily trade statistics.
- `src/portfolio/historicalMetrics.ts`: reusable period performance metrics for today, week, month, year, account lifetime, and automation lifetime.
- `src/strategy/`: recommendation generation.
- `src/risk/`: pre-execution risk checks.
- `src/journal/`: recommendation and decision-journal reads.
- `src/brokers/`: broker adapter interfaces only.
- `src/paper/`: deterministic paper strategy execution and performance reads.
- `src/scheduler/`: Cloudflare scheduled-run orchestration, overlap protection, and cron idempotency helpers.
- `src/settings/`: system pause state and Tim's investment profile.
- `src/dashboard/`: dashboard data aggregation and HTML rendering.
- `src/dashboard/contract.ts`: normalized beginner/intermediate/advanced dashboard data contract.
- `src/milestones/`: configurable milestone progress and idempotent award engine.
- `src/journey/`: append-only Kairox Journey event records.
- `src/dividends/`: dividend accounting and dividend-quality availability checks.
- `src/shared/`: shared HTTP, database, and type utilities.

Production Cloudflare resources are Worker `kairox` and D1 database `kairox-production-db`. The canonical GitHub repository is `kairoxHQ/kairox`.

## Data Flow

1. A request enters the Worker.
2. The route reads from D1 or builds a current paper recommendation.
3. The paper runner loads enabled assets from `watchlists`, `watchlist_assets`, and `assets`.
4. Market data comes through `MarketDataProvider` using each asset's provider symbol and registry metadata.
5. Strategy chooses `DO_NOTHING` unless market data is validated.
6. Risk checks and asset-specific execution gates block unsafe paths before simulated execution.
7. Recommendations and decisions returned as records are stored in D1.
8. Scheduled runs add an outer idempotency record in `scheduled_runs`.
9. Equity history, summaries, and benchmark comparisons are updated after strategy runs.
10. Valuation snapshots, daily snapshots, milestones, and Journey events are updated from the same paper portfolio data.

## Scheduled Runs

Cloudflare cron triggers call the Worker `scheduled` handler. The handler checks for an existing scheduled run key and any recent running job before invoking the paper strategy. Scheduled execution respects the `automation_paused` setting. A paused scheduled run may still collect data and log decisions but cannot execute simulated paper trades.

Asset-specific market-hours modes determine execution windows. Crypto assets can be continuous, stock/ETF/REIT/bond-fund assets can use regular US market hours, mutual funds can be constrained to fund pricing windows, and cash-equivalent assets can be tracked without being opened by the paper strategy.

## Asset Universe

`assets` is the registry for stocks, ETFs, mutual funds, cryptocurrencies, REITs, bond funds, and money-market or cash-equivalent funds. It stores display names, provider symbols, asset type, tradability, fractional support, dividend capability, expense/minimum metadata, precision, and market-hours mode.

`watchlists` and `watchlist_assets` select which enabled assets a portfolio evaluates. BTC-USD and SPY remain enabled as initial records, but the trading loop no longer owns a permanent symbol list.

## Performance And Dividends

Performance reporting separates realized profit/loss, unrealized profit/loss, transaction costs, dividend income, price return, dividend return, total return, maximum drawdown, and benchmark returns. Dividend events are recorded only from reliable known amounts and dates; otherwise they are stored as unavailable and excluded from return calculations.

## Valuation And Snapshot Model

Valuations use D1 portfolio cash, open positions, average cost basis, and the latest validated market snapshots. The calculation layer uses scaled integer helpers before returning rounded dollar and ratio values. If a quote is missing or stale, Kairox keeps the last valid stored position price, marks the result stale or unavailable, and includes the timestamp.

`account_daily_snapshots` stores one idempotent row per portfolio and account date. It records opening cash, opening portfolio value, opening account value, holdings, and data timestamp, then updates end-of-day or rolling end fields with realized/unrealized P/L, trade counts, win/loss counts, fees, high/low account values, drawdown, and reconciliation status. Account-date boundaries use the configured account timezone, currently `America/New_York`; stored timestamps remain UTC.

`GET /dashboard/contract` returns one normalized source object plus beginner, intermediate, and advanced views. These views do not maintain separate calculations; they project the same valuation, decision, market status, and performance data into different levels of detail.

## Milestones And Journey

`milestone_definitions` stores configurable milestone rules, thresholds, categories, badge identifiers, repeatability, enabled state, and version. `milestone_awards` stores earned milestones with unique award keys so retries cannot duplicate one-time achievements.

`journey_events` stores permanent timeline events such as account creation, trade opened/closed, skipped/rejected trade, milestone earned, risk limit reached, version changes, and manual intervention. Event keys prevent duplicate records for retried system events while preserving append-only history for distinct events.

## Broker Boundary

Broker integrations must implement `BrokerAdapter`. No concrete live broker adapter exists in this milestone. Any future adapter must keep live trading disabled by default and pass risk checks before execution.
