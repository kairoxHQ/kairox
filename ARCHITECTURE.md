# Architecture

Kairox runs as a Cloudflare Worker with Cloudflare D1 for durable paper-trading state.

## Runtime

- `src/index.ts` handles HTTP routing.
- `wrangler.jsonc` defines the Worker, preview environment, and D1 binding.
- `migrations/0001_initial.sql` creates the initial schema and seeds Tim's paper portfolio.
- `migrations/0002_sprint2_paper_execution.sql` adds market snapshots, strategy runs, and idempotency columns.
- `migrations/0003_scheduled_dashboard.sql` adds scheduled runs, settings, investment profiles, dividend events, equity history, and stored summaries.

## Modules

- `src/market/`: market data providers and benchmark reads.
- `src/portfolio/`: portfolio read models.
- `src/strategy/`: recommendation generation.
- `src/risk/`: pre-execution risk checks.
- `src/journal/`: recommendation and decision-journal reads.
- `src/brokers/`: broker adapter interfaces only.
- `src/paper/`: deterministic paper strategy execution and performance reads.
- `src/scheduler/`: Cloudflare scheduled-run orchestration, overlap protection, and cron idempotency helpers.
- `src/settings/`: system pause state and Tim's investment profile.
- `src/dashboard/`: dashboard data aggregation and HTML rendering.
- `src/dividends/`: dividend accounting and dividend-quality availability checks.
- `src/shared/`: shared HTTP, database, and type utilities.

Internal Cloudflare resource names remain `cryptolab-ai` for the Worker and `cryptolab-ai-db` for D1. The canonical GitHub repository is `kairoxHQ/kairox`.

## Data Flow

1. A request enters the Worker.
2. The route reads from D1 or builds a current paper recommendation.
3. Market data comes through `MarketDataProvider`.
4. Strategy chooses `DO_NOTHING` unless market data is validated.
5. Risk checks block unsafe execution paths.
6. Recommendations and decisions returned as records are stored in D1.
7. Scheduled runs add an outer idempotency record in `scheduled_runs`.
8. Equity history, summaries, and benchmark comparisons are updated after strategy runs.

## Scheduled Runs

Cloudflare cron triggers call the Worker `scheduled` handler. The handler checks for an existing scheduled run key and any recent running job before invoking the paper strategy. Scheduled execution respects the `automation_paused` setting. A paused scheduled run may still collect data and log decisions but cannot execute simulated paper trades.

Stock and ETF simulated executions are blocked outside regular US market hours. BTC-USD evaluation is allowed outside stock-market hours.

## Performance And Dividends

Performance reporting separates realized profit/loss, unrealized profit/loss, transaction costs, dividend income, price return, dividend return, total return, maximum drawdown, and benchmark returns. Dividend events are recorded only from reliable known amounts and dates; otherwise they are stored as unavailable and excluded from return calculations.

## Broker Boundary

Broker integrations must implement `BrokerAdapter`. No concrete live broker adapter exists in this milestone. Any future adapter must keep live trading disabled by default and pass risk checks before execution.
