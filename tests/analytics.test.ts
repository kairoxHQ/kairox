import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../src/index.ts";
import {
  calculateDailyStreaks,
  calculateMaximumDrawdown,
  calculatePerformanceAnalytics,
  type AnalyticsDailySnapshot,
  type AnalyticsValuationSnapshot
} from "../src/analytics/performance.ts";

const now = new Date("2026-07-13T16:00:00.000Z");

test("analytics handles an empty portfolio without historical data", () => {
  const analytics = calculatePerformanceAnalytics({
    portfolioId: "portfolio_empty",
    valuations: [],
    dailySnapshots: [],
    portfolioFallback: { id: "portfolio_empty", cashUsd: 20, startingBalanceUsd: 20 },
    now
  });

  assert.equal(analytics.summary.dataStatus, "empty");
  assert.equal(analytics.summary.currentPortfolioValueUsd, 20);
  assert.equal(analytics.summary.investedCapitalUsd, 20);
  assert.equal(analytics.summary.unrealizedGainLossUsd, 0);
  assert.equal(analytics.summary.daysInvested, 0);
  assert.equal(analytics.history.length, 0);
  assert.equal(analytics.records.length, 0);
});

test("analytics handles a single valuation snapshot gracefully", () => {
  const analytics = calculatePerformanceAnalytics({
    portfolioId: "portfolio_tim_paper",
    valuations: [valuation("2026-07-13T15:00:00.000Z", 20, 0)],
    dailySnapshots: [],
    now
  });

  assert.equal(analytics.summary.dataStatus, "partial");
  assert.equal(analytics.summary.currentPortfolioValueUsd, 20);
  assert.equal(analytics.summary.allTimeReturn.amountUsd, 0);
  assert.equal(analytics.summary.maximumDrawdownPct, 0);
  assert.equal(analytics.summary.daysInvested, 1);
});

test("analytics calculates growth, best day, and positive streaks", () => {
  const analytics = calculatePerformanceAnalytics({
    portfolioId: "portfolio_tim_paper",
    valuations: [
      valuation("2026-07-11T16:00:00.000Z", 20, 0),
      valuation("2026-07-12T16:00:00.000Z", 21, 0.2),
      valuation("2026-07-13T16:00:00.000Z", 23, 0.5, 2)
    ],
    dailySnapshots: [
      daily("2026-07-12", 20, 21),
      daily("2026-07-13", 21, 23)
    ],
    now
  });

  assert.equal(analytics.summary.dataStatus, "ready");
  assert.equal(analytics.summary.currentPortfolioValueUsd, 23);
  assert.equal(analytics.summary.unrealizedGainLossUsd, 0.5);
  assert.equal(analytics.summary.dailyChange.amountUsd, 2);
  assert.equal(analytics.summary.weeklyChange.amountUsd, 3);
  assert.equal(analytics.summary.monthlyChange.amountUsd, 3);
  assert.equal(analytics.summary.yearToDateChange.amountUsd, 3);
  assert.equal(analytics.summary.allTimeReturn.amountUsd, 3);
  assert.equal(analytics.summary.highestPortfolioValueUsd, 23);
  assert.equal(analytics.summary.lowestPortfolioValueUsd, 20);
  assert.equal(analytics.summary.bestDay?.date, "2026-07-13");
  assert.equal(analytics.summary.consecutivePositiveDays, 2);
  assert.equal(analytics.summary.consecutiveNegativeDays, 0);
});

test("analytics calculates decline, worst day, drawdown, and negative streaks", () => {
  const analytics = calculatePerformanceAnalytics({
    portfolioId: "portfolio_tim_paper",
    valuations: [
      valuation("2026-07-10T16:00:00.000Z", 20, 0),
      valuation("2026-07-11T16:00:00.000Z", 25, 1),
      valuation("2026-07-12T16:00:00.000Z", 22, -1, -3),
      valuation("2026-07-13T16:00:00.000Z", 18, -2, -4)
    ],
    dailySnapshots: [
      daily("2026-07-11", 20, 25),
      daily("2026-07-12", 25, 22),
      daily("2026-07-13", 22, 18)
    ],
    now
  });

  assert.equal(analytics.summary.currentPortfolioValueUsd, 18);
  assert.equal(analytics.summary.allTimeReturn.amountUsd, -2);
  assert.equal(analytics.summary.highestPortfolioValueUsd, 25);
  assert.equal(analytics.summary.lowestPortfolioValueUsd, 18);
  assert.equal(analytics.summary.worstDay?.date, "2026-07-13");
  assert.equal(analytics.summary.maximumDrawdownPct, 0.28);
  assert.equal(analytics.summary.currentDrawdownPct, 0.28);
  assert.equal(analytics.summary.consecutivePositiveDays, 0);
  assert.equal(analytics.summary.consecutiveNegativeDays, 2);
});

test("maximum drawdown and daily streak helpers cover edge cases", () => {
  assert.equal(calculateMaximumDrawdown([20, 25, 22, 18]), 0.28);
  assert.equal(calculateMaximumDrawdown([]), 0);
  assert.deepEqual(calculateDailyStreaks([record("2026-07-11", 1), record("2026-07-12", 2)]), { positive: 2, negative: 0 });
  assert.deepEqual(calculateDailyStreaks([record("2026-07-11", 1), record("2026-07-12", -2)]), { positive: 0, negative: 1 });
  assert.deepEqual(calculateDailyStreaks([]), { positive: 0, negative: 0 });
});

test("analytics API namespace is read-only", async () => {
  const env = { DB: {} as D1Database, APP_MODE: "paper", LIVE_TRADING_ENABLED: "false", STARTING_BALANCE_USD: "20", BENCHMARK_ASSET: "BTC" };

  const response = await worker.fetch(new Request("https://kairox.test/api/analytics/summary", { method: "POST" }), env);

  assert.equal(response.status, 405);
});

function valuation(timestamp: string, total: number, unrealized: number, todayChange: number | null = null): AnalyticsValuationSnapshot {
  return {
    portfolioId: "portfolio_tim_paper",
    valuationTimestamp: timestamp,
    cashUsd: 5,
    portfolioValueUsd: total - 5,
    totalAccountValueUsd: total,
    realizedProfitLossUsd: 0,
    unrealizedProfitLossUsd: unrealized,
    overallReturnUsd: total - 20,
    overallReturnPct: (total - 20) / 20,
    todayChangeUsd: todayChange,
    todayChangePct: todayChange === null ? null : todayChange / (total - todayChange),
    dataStatus: "delayed"
  };
}

function daily(date: string, start: number, end: number): AnalyticsDailySnapshot {
  return {
    portfolioId: "portfolio_tim_paper",
    snapshotDate: date,
    startingTotalAccountValueUsd: start,
    endingTotalAccountValueUsd: end,
    dailyProfitLossUsd: end - start,
    dailyReturnPct: (end - start) / start,
    highestAccountValueUsd: Math.max(start, end),
    lowestAccountValueUsd: Math.min(start, end),
    maximumDailyDrawdownPct: Math.max(0, (Math.max(start, end) - Math.min(start, end)) / Math.max(start, end)),
    tradeCount: 0
  };
}

function record(date: string, changeUsd: number) {
  return {
    date,
    startingValueUsd: 20,
    endingValueUsd: 20 + changeUsd,
    changeUsd,
    changePct: changeUsd / 20,
    highestValueUsd: Math.max(20, 20 + changeUsd),
    lowestValueUsd: Math.min(20, 20 + changeUsd),
    maximumDrawdownPct: 0,
    tradeCount: 0
  };
}
