import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldRunScheduledDailyOrchestration, validateQuotes } from "../src/orchestration/dailyPortfolioOrchestrator.ts";
import type { NormalizedQuote } from "../src/market/service.ts";

const migration = readFileSync("migrations/0030_daily_orchestration.sql", "utf8");
const serviceSource = readFileSync("src/orchestration/dailyPortfolioOrchestrator.ts", "utf8");
const indexSource = readFileSync("src/index.ts", "utf8");
const dashboardSource = readFileSync("src/dashboard/service.ts", "utf8");

test("orchestration migration stores run status, stages, linked records, reconciliation, and supersession", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS daily_orchestration_runs/);
  assert.match(migration, /stage_results_json/);
  assert.match(migration, /source_market_data_timestamps_json/);
  assert.match(migration, /snapshot_id/);
  assert.match(migration, /benchmark_update_ids_json/);
  assert.match(migration, /daily_cycle_id/);
  assert.match(migration, /decision_id/);
  assert.match(migration, /briefing_id/);
  assert.match(migration, /reconciliation_json/);
  assert.match(migration, /superseding_run_id/);
  assert.match(migration, /UNIQUE\(portfolio_id, market_date, trigger_type, refresh_mode\)/);
});

test("orchestrator runs the required stages in order and classifies criticality", () => {
  const order = [
    "validate_account",
    "refresh_market_data",
    "calculate_valuation",
    "record_daily_snapshot",
    "update_benchmarks",
    "run_daily_management",
    "evaluate_portfolio_decision",
    "generate_portfolio_briefing",
    "journey_events"
  ].map((stage) => serviceSource.indexOf(`"${stage}"`));
  assert.ok(order.every((index) => index > 0), "every stage should be present");
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(serviceSource, /update_benchmarks"[\s\S]*stageResults, false/);
  assert.match(serviceSource, /generate_portfolio_briefing"[\s\S]*stageResults, false/);
  assert.match(serviceSource, /run_daily_management"[\s\S]*stageResults, true/);
});

test("quote validation rejects missing, stale, conflicting, anomalous, and future-dated data", () => {
  const now = new Date("2026-07-14T21:05:00.000Z");
  assert.doesNotThrow(() => validateQuotes([quote({ symbol: "VTI", providerTimestamp: "2026-07-14T21:00:00.000Z" })], now));
  assert.throws(() => validateQuotes([quote({ symbol: "BND", lastPrice: null })], now), /missing trusted price/);
  assert.throws(() => validateQuotes([quote({ symbol: "SCHD", dataQualityStatus: "Stale" })], now), /Stale/);
  assert.throws(() => validateQuotes([quote({ symbol: "VTI", dataQualityStatus: "Conflicting" })], now), /Conflicting/);
  assert.throws(() => validateQuotes([quote({ symbol: "BND", dataQualityStatus: "Anomalous" })], now), /Anomalous/);
  assert.throws(() => validateQuotes([quote({ symbol: "SCHD", providerTimestamp: "2026-07-14T21:10:02.000Z" })], now), /future/);
});

test("scheduler skips weekends, holidays, and pre-close windows", () => {
  assert.equal(shouldRunScheduledDailyOrchestration(new Date("2026-07-18T22:00:00.000Z")).shouldRun, false);
  assert.equal(shouldRunScheduledDailyOrchestration(new Date("2026-07-03T22:00:00.000Z")).shouldRun, false);
  assert.equal(shouldRunScheduledDailyOrchestration(new Date("2026-07-14T19:30:00.000Z")).shouldRun, false);
  assert.equal(shouldRunScheduledDailyOrchestration(new Date("2026-07-14T20:06:00.000Z")).shouldRun, true);
});

test("protected route and scheduler use the coordinated orchestrator instead of separate daily jobs", () => {
  assert.match(indexSource, /daily-orchestration/);
  assert.match(indexSource, /orchestrationMatch/);
  assert.match(indexSource, /const auth = await authorize\(request, env\)/);
  assert.match(indexSource, /runScheduledDailyOrchestrations\(env, scheduledAt\)/);
  assert.doesNotMatch(indexSource, /runScheduledDailyReviews\(env, scheduledAt\)/);
  assert.doesNotMatch(indexSource, /runScheduledDailyManagementCycles\(env, scheduledAt\)/);
  assert.doesNotMatch(indexSource, /runScheduledBenchmarkComparisons\(env, scheduledAt\)/);
});

test("orchestrator implements idempotency, administrative refresh, retry, and failure preservation", () => {
  assert.match(serviceSource, /FINAL_STATUSES/);
  assert.match(serviceSource, /idempotent: true/);
  assert.match(serviceSource, /Administrative refresh/);
  assert.match(serviceSource, /hasNewerTrustedPricing/);
  assert.match(serviceSource, /Administrative refresh rejected because no newer trusted pricing is available/);
  assert.match(serviceSource, /markRetry/);
  assert.match(serviceSource, /persistInitialRun/);
  assert.match(serviceSource, /finalizeRun/);
});

test("reconciliation guards prove no orders, fills, trades, cash, or position quantities changed", () => {
  assert.match(serviceSource, /mutationCounts/);
  assert.match(serviceSource, /cashChanged/);
  assert.match(serviceSource, /positionQuantityChanged/);
  assert.match(serviceSource, /ordersChanged/);
  assert.match(serviceSource, /fillsChanged/);
  assert.match(serviceSource, /tradesChanged/);
  assert.doesNotMatch(serviceSource, /executePaperOrderBatch|stagePaperOrdersForProposal|approveAllocationProposal/);
});

test("dashboard exposes compact portfolio operations panel and protected manual action without secrets", () => {
  assert.match(dashboardSource, /Portfolio Operations/);
  assert.match(dashboardSource, /data-run-daily-orchestration/);
  assert.match(dashboardSource, /Run Daily Orchestration/);
  assert.match(dashboardSource, /No orders or fills/);
  assert.doesNotMatch(dashboardSource, /PAPER_RUN_SECRET/);
});

function quote(overrides: Partial<NormalizedQuote> = {}): NormalizedQuote {
  return {
    symbol: "VTI",
    securityName: "Vanguard Total Stock Market ETF",
    assetType: "etf",
    exchange: "US",
    currency: "USD",
    bid: null,
    ask: null,
    lastPrice: 371.2,
    previousClose: 369.78,
    marketSession: "regular",
    providerTimestamp: "2026-07-14T21:00:00.000Z",
    receivedTimestamp: "2026-07-14T21:00:01.000Z",
    providerName: "test",
    dataQualityStatus: "Valid",
    source: "primary",
    cached: false,
    warnings: [],
    validation: { valid: true, status: "Valid", reasons: [], warnings: [] },
    candles: [],
    volume: null,
    ...overrides
  };
}
