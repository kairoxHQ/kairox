# Market Open Checklist

Kairox production app: https://app.kairoxhq.com

Worker: `kairox`

Database: `kairox-production-db`

Mode: virtual paper trading only. Live trading must remain disabled.

## Before Open

- Verify `GET /health` returns `ok: true`.
- Verify `GET /status` reports `paperTradingOnly: true` and `liveTradingEnabled: false`.
- Verify `GET /dashboard` loads and shows all three profiles:
  - Kairox Conservative
  - Tim Balanced
  - Kairox High Risk
- Verify each profile is labeled `VIRTUAL / PAPER ONLY`.
- Verify `GET /dashboard/data` shows isolated cash, positions, trades, recommendations, decision journal, equity history, and risk posture for each profile.
- Verify `GET /assets` contains exactly the controlled 12-asset universe.
- Verify `GET /watchlists` shows the expected profile watchlists.
- Verify `GET /scheduled-runs` shows the latest scheduler status and audit summary.
- Verify Worker binding remains `DB -> kairox-production-db`.
- Verify cron remains `*/30 * * * *`.
- Verify no secrets are visible in dashboard, API responses, or logs.

## During Session

- Confirm the first regular-market-hours run finishes with `status: completed`.
- Confirm BTC-USD continues to evaluate outside stock-market hours.
- Confirm stocks, ETFs, REITs, and bond ETFs only execute simulated trades during regular U.S. market hours.
- Confirm FXAIX remains excluded from intraday execution unless reliable NAV behavior is supported.
- Check provider freshness in `GET /market` and the dashboard Market Data Status section.
- Review `GET /opportunities` for eligibility, ranking, skip reasons, confidence, and current exposure.
- Review `GET /scheduled-runs` audit fields:
  - assets attempted
  - assets evaluated successfully
  - assets skipped
  - provider failures
  - stale-data rejections
  - recommendations by portfolio
  - trades by portfolio
  - duplicate prevention
  - final status
- Confirm one-symbol data failures do not stop other assets or portfolios.
- Confirm any profile differences are explainable by each profile's risk settings.
- Confirm no duplicate scheduled invocation creates duplicate trades.
- Investigate any unexpected `failed` or long-running scheduler status before the next run.

## After Close

- Review total scheduled runs for the session.
- Review trades and confirm every trade is paper-only.
- Compare profile equity, normalized performance, cash percentage, total return, maximum drawdown, and volatility where enough history exists.
- Review provider failures and stale-data rejections by symbol.
- Review deferred opportunities and risk guardrail reasons.
- Confirm no unexpected trades, duplicate trades, or cross-profile contamination occurred.
- Confirm summaries were generated and displayed.
- Record anomalies and fixes needed before the next market session.

## Capital-Preservation Readiness Notes

The current architecture can support normal, defensive, and capital-preservation modes because profiles already have separate risk parameters, cash reserves, drawdown blocks, watchlists, and per-profile execution isolation.

Missing future work before automatic capital-preservation reallocation:

- A system or profile setting that explicitly selects normal, defensive, or capital-preservation mode.
- Deterministic triggers for entering and exiting defensive modes.
- Reliable handling for BND, money-market funds, cash-equivalent funds, and mutual-fund NAV timing.
- A tested reallocation policy that moves toward cash equivalents without violating paper-only risk limits.
- Dashboard controls and audit records for mode changes.
