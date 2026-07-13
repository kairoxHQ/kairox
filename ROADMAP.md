# Roadmap

## Milestone 1: Safe Paper Foundation

- Cloudflare Worker in TypeScript.
- D1 schema and seed data for Tim's `$20` paper portfolio.
- Paper-only broker adapter boundary.
- Mock market data provider boundary.
- Status, portfolio, recommendation, journal, and benchmark endpoints.
- Bitcoin buy-and-hold and cash benchmarks.

## Milestone 2: Public Market Data

- Add a free public market-data provider behind `MarketDataProvider`.
- Persist validated price snapshots.
- Add guarded paper-run execution with deterministic indicators, risk checks, and idempotent simulated fills.
- Keep default recommendation as `DO_NOTHING` when data is stale, missing, or contradictory.

## Milestone 3: Scheduled Automation And Dashboard

- Add Cloudflare scheduled events for automated paper strategy runs.
- Add pause/resume controls for scheduled paper execution.
- Enforce US market hours for stock and ETF simulated execution.
- Add mobile-friendly dashboard views for portfolio, positions, trades, journal, performance, scheduled runs, and settings.
- Add dividend-aware total-return accounting without making yield the primary objective.
- Add morning and end-of-day summaries stored in D1.

## Milestone 5A: Universal Asset Foundation

- Add a D1-backed asset registry for stocks, ETFs, mutual funds, crypto, REITs, bond funds, and money-market or cash-equivalent funds.
- Add portfolio watchlists and watchlist assets for database-driven symbol selection.
- Keep BTC-USD and SPY enabled as seed records instead of hardcoded trading-loop constants.
- Keep options, futures, forex, leverage, short selling, and live execution out of scope.

## Milestone 7B: Valuation, Journey, And Milestones

- Add live paper valuation from existing holdings and validated public market snapshots.
- Add idempotent daily account snapshots with account-timezone boundaries.
- Add reusable historical performance metrics that separate trading return from deposits and withdrawals.
- Add a normalized beginner/intermediate/advanced dashboard data contract.
- Add configurable milestone definitions, idempotent awards, and the permanent Kairox Journey timeline.

## Milestone 4: Broker Adapter Prototypes

- Add disabled-by-default broker adapters.
- Store no live credentials in source control.
- Require explicit user configuration, risk checks, and paper-trading soak time before any live execution work.

## Out of Scope For Now

- Live brokerage connections.
- Automated real-money trading.
- Leverage, margin, options execution, or futures execution.
- Paid AI API calls.
