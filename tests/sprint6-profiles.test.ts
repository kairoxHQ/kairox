import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import worker from "../src/index.ts";
import { renderDashboardHtml } from "../src/dashboard/service.ts";
import { assessPaperTrade } from "../src/risk/checks.ts";
import type { MarketDataset } from "../src/shared/types.ts";

test("Sprint 6 migration creates three permanent profiles without resetting Tim history", () => {
  const sql = readFileSync("migrations/0009_multi_profile_simulation.sql", "utf8");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS portfolio_profiles/);
  assert.match(sql, /comparison_start_timestamp/);
  assert.match(sql, /comparison_start_equity_usd/);
  assert.match(sql, /'tim_balanced'/);
  assert.match(sql, /'kairox_conservative'/);
  assert.match(sql, /'kairox_high_risk'/);
  assert.match(sql, /watchlist_kairox_conservative_core/);
  assert.match(sql, /watchlist_kairox_high_risk_core/);
  assert.match(sql, /watchlist_kairox_conservative_bnd/);
  assert.match(sql, /watchlist_kairox_high_risk_qqq/);
  assert.match(sql, /normalized_start_index/);
  assert.match(sql, /current_equity,\s*100,\s*parameters_json/i);
  assert.doesNotMatch(sql, /DELETE FROM portfolios|DELETE FROM positions|DELETE FROM trades|UPDATE portfolios\s+SET\s+cash_usd[^;]*portfolio_tim_paper/i);
});

test("profile-specific risk thresholds preserve isolation and different policies", () => {
  const conservative = assessPaperTrade({
    action: "BUY",
    marketData: marketData(),
    portfolioValueUsd: 20,
    cashUsd: 20,
    currentPositionValueUsd: 0,
    proposedTradeValueUsd: 2,
    drawdownPct: 0,
    duplicateSignal: false,
    openedNewPositionThisRun: false,
    hasPosition: false,
    maxNewTradePct: 0.06,
    maxPositionPct: 0.25,
    drawdownBlockPct: 0.06
  });
  const highRisk = assessPaperTrade({
    action: "BUY",
    marketData: marketData(),
    portfolioValueUsd: 20,
    cashUsd: 20,
    currentPositionValueUsd: 0,
    proposedTradeValueUsd: 2,
    drawdownPct: 0,
    duplicateSignal: false,
    openedNewPositionThisRun: false,
    hasPosition: false,
    maxNewTradePct: 0.15,
    maxPositionPct: 0.5,
    drawdownBlockPct: 0.18
  });

  assert.equal(conservative.allowed, false);
  assert.match(conservative.reasons.join(" "), /6%/);
  assert.equal(highRisk.allowed, true);
});

test("profile-scoped idempotency permits the same signal across virtual portfolios", () => {
  const sql = readFileSync("migrations/0011_profile_scoped_idempotency.sql", "utf8");

  assert.match(sql, /DROP INDEX IF EXISTS idx_recommendations_signal_key/);
  assert.match(sql, /DROP INDEX IF EXISTS idx_decision_journal_signal_key/);
  assert.match(sql, /DROP INDEX IF EXISTS idx_trades_signal_key/);
  assert.match(sql, /ON recommendations\(portfolio_id, signal_key\)/);
  assert.match(sql, /ON decision_journal\(portfolio_id, signal_key\)/);
  assert.match(sql, /ON trades\(portfolio_id, signal_key\)/);
});

test("dashboard renders profile comparison as compact account cards", () => {
  const html = renderDashboardHtml({
    settings: { automationPaused: false },
    performance: {
      totalValueUsd: 20,
      cashUsd: 20,
      totalReturnUsd: 0,
      priceReturnUsd: 0,
      dividendReturnUsd: 0,
      tradeCount: 0,
      maxDrawdownPct: 0,
      benchmarkReturns: []
    },
    positions: [],
    recommendations: [],
    journal: [],
    trades: [],
    scheduledRuns: [],
    summaries: [],
    rejectedOpportunities: [],
    profileComparison: {
      comparisonPolicy: {
        normalizedStartIndex: 100,
        explanation: "Profiles are compared from their shared comparison_start_timestamp."
      },
      profiles: [
        {
          portfolioId: "portfolio_kairox_conservative",
          profileKey: "kairox_conservative",
          displayName: "Kairox Conservative",
          philosophy: "Capital preservation",
          riskPosture: "conservative",
          comparisonStartTimestamp: "2026-07-13T01:00:00.000Z",
          comparisonStartEquityUsd: 19.97,
          actualEquityUsd: 19.97,
          cashPct: 1,
          openPositions: 0,
          latestDecision: "DO_NOTHING",
          totalReturnPct: 0,
          maxDrawdownPct: 0,
          volatilityPct: null,
          tradeCount: 0,
          recommendationCount: 1,
          journalEntryCount: 1,
          equityHistoryCount: 1,
          paperOnlyLabel: "VIRTUAL / PAPER ONLY",
          normalizedIndex: 100,
          normalizedReturnPct: 0
        }
      ]
    }
  });

  assert.match(html, /Accounts/);
  assert.match(html, /Kairox Conservative/);
  assert.match(html, /Paper/);
  assert.match(html, /Positions/);
  assert.match(html, /Open account detail/);
  assert.doesNotMatch(html, /Simulation Profiles|Latest decision DO_NOTHING|Volatility Needs more history|Normalized 100\.00/);
});

test("profile and comparison endpoints are public read routes", async () => {
  const env = { DB: {} as D1Database, APP_MODE: "paper", LIVE_TRADING_ENABLED: "false", STARTING_BALANCE_USD: "20", BENCHMARK_ASSET: "BTC" };

  const profiles = await worker.fetch(new Request("https://kairox.test/profiles", { method: "POST" }), env);
  const comparison = await worker.fetch(new Request("https://kairox.test/comparison", { method: "POST" }), env);

  assert.equal(profiles.status, 405);
  assert.equal(comparison.status, 405);
});

function marketData(): MarketDataset {
  return {
    symbol: "VOO",
    assetClass: "etf",
    priceUsd: 100,
    asOf: new Date().toISOString(),
    source: "test",
    validated: true,
    stale: false,
    candles: []
  };
}
