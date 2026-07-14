import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  DEFAULT_FORWARD_TEST_CONFIG,
  buildForwardValuations,
  calculatePortfolioMetrics,
  evidenceStageFor,
  type ForwardValuation
} from "../src/forward/forwardTest.ts";
import type { MarketDataSnapshot, NormalizedQuote } from "../src/market/service.ts";

const migration = readFileSync("migrations/0022_forward_testing.sql", "utf8");
const serviceSource = readFileSync("src/forward/forwardTest.ts", "utf8");
const dashboardSource = readFileSync("src/dashboard/service.ts", "utf8");
const indexSource = readFileSync("src/index.ts", "utf8");

test("benchmark definitions are versioned and preserve rules", () => {
  assert.match(migration, /forward_test_benchmark_versions/);
  assert.match(migration, /Cash Baseline/);
  assert.match(migration, /S&P 500 Benchmark/);
  assert.match(migration, /Conservative Balanced Benchmark/);
  assert.match(migration, /Initial Allocation Buy-and-Hold/);
  assert.match(migration, /UNIQUE\(name, version\)/);
});

test("daily valuations use equal starting capital and the same valuation date", () => {
  const valuations = sampleValuations();
  assert.equal(new Set(valuations.map((item) => item.marketDate)).size, 1);
  assert.equal(valuations.length, 5);
  assert.equal(valuations.every((item) => item.cumulativeReturn === Number(((item.portfolioValueUsd - 2400) / 2400).toFixed(6))), true);
  assert.deepEqual(valuations.map((item) => item.marketDataSnapshotId), Array(5).fill("mdsnap_daily_review"));
});

test("cash-only baseline applies documented cash-rate assumption", () => {
  const cash = sampleValuations().find((item) => item.trackedPortfolioKey === "cash_baseline");
  assert.ok(cash);
  assert.equal(cash?.assumptions.annualRate, 0.04);
  assert.ok((cash?.portfolioValueUsd ?? 0) >= 2400);
});

test("buy-and-hold and balanced benchmarks are independent portfolios", () => {
  const valuations = sampleValuations();
  const buyHold = valuations.find((item) => item.trackedPortfolioKey === "initial_allocation_buy_hold");
  const balanced = valuations.find((item) => item.trackedPortfolioKey === "conservative_balanced_benchmark");
  assert.ok(buyHold);
  assert.ok(balanced);
  assert.notEqual(buyHold?.assumptions, balanced?.assumptions);
  assert.equal(buyHold?.assumptions.source, "first_executed_allocation");
});

test("missing historical or total-return data is marked incomplete instead of fabricated", () => {
  const valuations = sampleValuations({ snapshot: null });
  const buyHold = valuations.find((item) => item.trackedPortfolioKey === "initial_allocation_buy_hold");
  const sp500 = valuations.find((item) => item.trackedPortfolioKey === "sp500_benchmark");
  assert.equal(buyHold?.dataQualityStatus, "incomplete");
  assert.equal(sp500?.dataQualityStatus, "incomplete");
});

test("cumulative return, drawdown, volatility, and insufficient-data metrics are calculated safely", () => {
  const rows = series([2400, 2460, 2300, 2500]);
  const metrics = calculatePortfolioMetrics(rows, 2400, 0.04);
  assert.equal(metrics.sinceInceptionReturn, 0.041667);
  assert.equal(metrics.maximumDrawdown, 0.06504065040650407);
  assert.ok((metrics.volatility ?? 0) > 0);
  assert.equal(metrics.annualizedReturn, null);
  assert.equal(metrics.sharpeRatio, null);
});

test("evidence stage progresses without implying profitability too early", () => {
  assert.equal(evidenceStageFor(0).stage, "Initial");
  assert.equal(evidenceStageFor(20).stage, "Early Evidence");
  assert.equal(evidenceStageFor(60).stage, "Developing Evidence");
  assert.equal(evidenceStageFor(120).stage, "Meaningful Forward Test");
  assert.match(evidenceStageFor(19).confidenceLabel, /Preliminary/);
});

test("duplicate daily-update prevention and immutable monthly reports are represented", () => {
  assert.match(migration, /UNIQUE\(program_id, tracked_portfolio_key, market_date\)/);
  assert.match(migration, /forward_test_monthly_reports/);
  assert.match(migration, /UNIQUE\(program_id, report_month, version\)/);
  assert.match(serviceSource, /INSERT OR IGNORE INTO forward_test_daily_valuations/);
  assert.match(serviceSource, /nextVersion/);
});

test("recommendation windows, calibration, and strategy version separation are stored", () => {
  assert.match(migration, /forward_test_decision_evaluations/);
  assert.match(migration, /horizon_days/);
  assert.match(migration, /strategy_version_id/);
  assert.match(serviceSource, /horizons: \[1, 5, 20, 60, 120\]/);
  assert.match(serviceSource, /confidenceCalibration/);
  assert.match(serviceSource, /scoreCalibration/);
  assert.match(serviceSource, /strategyVersionEvaluation/);
});

test("no-look-ahead and same-snapshot constraints are explicit", () => {
  assert.match(serviceSource, /latestCompletedDailyReview/);
  assert.match(serviceSource, /getSnapshot\(review\.marketDataSnapshotId\)/);
  assert.match(serviceSource, /marketDataSnapshotId: input\.review\.marketDataSnapshotId/);
  assert.doesNotMatch(serviceSource, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\).*benchmark/i);
});

test("dashboard and protected routes are wired without live execution", () => {
  assert.match(indexSource, /"\/forward-test\/run"/);
  assert.match(indexSource, /runScheduledForwardTests/);
  assert.match(dashboardSource, /data-run-forward-test/);
  assert.match(dashboardSource, /Decision Quality/);
  assert.match(dashboardSource, /Explain Results/);
  assert.doesNotMatch(serviceSource, /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+(orders|trades|paper_order_fills|paper_order_executions|paper_cash_ledger)\b/i);
  assert.doesNotMatch(serviceSource, /UPDATE\s+(portfolios|positions|orders|trades)\b/i);
});

test("dividend, split, simulated cost, and operational reliability fields are tracked", () => {
  assert.match(migration, /dividends_usd/);
  assert.match(migration, /simulated_fees_usd/);
  assert.match(migration, /cash_rate_assumptions_json/);
  assert.match(serviceSource, /simulatedFeesUsd/);
  assert.match(serviceSource, /operationalReliability/);
});

function sampleValuations(overrides: { snapshot?: MarketDataSnapshot | null } = {}) {
  return buildForwardValuations({
    program: {
      id: "forward_program_portfolio_ira_conservative_retirement",
      portfolioId: "portfolio_ira",
      strategyName: "Conservative Retirement",
      strategyVersionId: "strategy_conservative_retirement_v1",
      startDate: "2026-07-13",
      startingCapitalUsd: 2400,
      status: "active",
      evidenceStageConfigJson: "{}"
    },
    portfolio: { id: "portfolio_ira", mode: "paper", cashUsd: 958.5594, startingBalanceUsd: 2400, createdAt: "2026-07-13T00:00:00.000Z" },
    review: { id: "daily_review_portfolio_ira_2026-07-14", portfolioId: "portfolio_ira", marketDate: "2026-07-14", status: "completed", portfolioValueUsd: 2410, cashUsd: 958.5594, marketDataSnapshotId: "mdsnap_daily_review", dataFreshnessStatus: "fresh" },
    snapshot: overrides.snapshot === undefined ? snapshot() : overrides.snapshot,
    previous: new Map(),
    firstFills: [
      { symbol: "VTI", quantity: 1, netAmountUsd: 370, simulatedFeesUsd: 0, filledAt: "2026-07-13T20:00:00.000Z" },
      { symbol: "SCHD", quantity: 10, netAmountUsd: 326, simulatedFeesUsd: 0, filledAt: "2026-07-13T20:00:00.000Z" },
      { symbol: "BND", quantity: 6, netAmountUsd: 435, simulatedFeesUsd: 0, filledAt: "2026-07-13T20:00:00.000Z" }
    ],
    cashAnnualRate: DEFAULT_FORWARD_TEST_CONFIG.cashAnnualRate
  });
}

function series(values: number[]): ForwardValuation[] {
  return values.map((value, index) => ({
    id: `v${index}`,
    programId: "p",
    portfolioId: "portfolio_ira",
    trackedPortfolioKey: "kairox_managed",
    benchmarkVersionId: null,
    marketDate: `2026-07-${String(13 + index).padStart(2, "0")}`,
    portfolioValueUsd: value,
    cashValueUsd: 0,
    investedValueUsd: value,
    dailyReturn: index === 0 ? null : (value - values[index - 1]) / values[index - 1],
    cumulativeReturn: (value - values[0]) / values[0],
    drawdown: (Math.max(...values.slice(0, index + 1)) - value) / Math.max(...values.slice(0, index + 1)),
    highWaterMarkUsd: Math.max(...values.slice(0, index + 1)),
    contributionsUsd: 0,
    withdrawalsUsd: 0,
    dividendsUsd: 0,
    simulatedFeesUsd: 0,
    marketDataSnapshotId: "snap",
    dataQualityStatus: "complete",
    assumptions: {}
  }));
}

function snapshot(): MarketDataSnapshot {
  return {
    id: "mdsnap_daily_review",
    useCase: "daily_review",
    createdAt: "2026-07-14T20:00:00.000Z",
    quotes: new Map([
      ["VTI", quote("VTI", 372)],
      ["SCHD", quote("SCHD", 33)],
      ["BND", quote("BND", 73)],
      ["SPY", quote("SPY", 560)]
    ])
  };
}

function quote(symbol: string, price: number): NormalizedQuote {
  return {
    symbol,
    securityName: symbol,
    assetType: symbol === "BND" ? "bond_fund" : "etf",
    exchange: "US",
    currency: "USD",
    bid: null,
    ask: null,
    lastPrice: price,
    previousClose: price - 1,
    marketSession: "closed",
    providerTimestamp: "2026-07-14T20:00:00.000Z",
    receivedTimestamp: "2026-07-14T20:01:00.000Z",
    providerName: "test",
    dataQualityStatus: "Valid",
    source: "primary",
    cached: false,
    warnings: [],
    validation: { valid: true, status: "Valid", reasons: [], warnings: [] },
    candles: [],
    volume: 1000000
  };
}
