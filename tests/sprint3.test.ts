import assert from "node:assert/strict";
import { test } from "node:test";
import { renderDashboardHtml } from "../src/dashboard/service.ts";
import { assessDividendQuality, calculateReinvestedQuantity } from "../src/dividends/service.ts";
import { canExecuteAt, isRegularUsMarketHours } from "../src/market/hours.ts";
import { calculateMaxDrawdownFromSeries, compareBenchmark } from "../src/portfolio/performance.ts";
import { buildScheduledRunKey, hasOverlappingRun, shouldAllowScheduledExecution } from "../src/scheduler/service.ts";

test("scheduled run keys are idempotent within the same cron minute", () => {
  const first = buildScheduledRunKey("*/30 13-21 * * 1-5", new Date("2026-07-13T14:00:05.000Z"));
  const retry = buildScheduledRunKey("*/30 13-21 * * 1-5", new Date("2026-07-13T14:00:59.000Z"));
  const next = buildScheduledRunKey("*/30 13-21 * * 1-5", new Date("2026-07-13T14:01:00.000Z"));

  assert.equal(first, retry);
  assert.notEqual(first, next);
});

test("overlapping scheduled runs are detected inside the protection window", () => {
  assert.equal(hasOverlappingRun("2026-07-13T14:00:00.000Z", new Date("2026-07-13T14:10:00.000Z")), true);
  assert.equal(hasOverlappingRun("2026-07-13T14:00:00.000Z", new Date("2026-07-13T14:20:00.000Z")), false);
  assert.equal(hasOverlappingRun(null, new Date("2026-07-13T14:10:00.000Z")), false);
});

test("pause and resume behavior controls scheduled execution", () => {
  assert.equal(shouldAllowScheduledExecution(true), false);
  assert.equal(shouldAllowScheduledExecution(false), true);
});

test("stock-market-hours enforcement blocks SPY outside regular US hours", () => {
  assert.equal(isRegularUsMarketHours(new Date("2026-07-13T14:00:00.000Z")), true);
  assert.equal(canExecuteAt("etf", new Date("2026-07-13T22:00:00.000Z")).allowed, false);
});

test("BTC evaluation remains available outside stock-market hours", () => {
  assert.equal(canExecuteAt("crypto", new Date("2026-07-12T03:00:00.000Z")).allowed, true);
});

test("dividend accounting excludes unavailable quality data and calculates reinvestment", () => {
  assert.equal(calculateReinvestedQuantity(1, 100, true), 0.01);
  assert.equal(calculateReinvestedQuantity(1, 100, false), 0);

  const quality = assessDividendQuality({});
  assert.equal(quality.available, false);
  assert.match(quality.explanation, /unavailable/);
});

test("total-return support calculates maximum drawdown", () => {
  assert.equal(calculateMaxDrawdownFromSeries([20, 22, 18, 21]), 0.1818);
});

test("benchmark comparison uses the same period start and latest value", () => {
  assert.deepEqual(compareBenchmark(20, 22), { returnUsd: 2, returnPct: 0.1 });
});

test("dashboard HTML contains portfolio sections without exposing secrets", () => {
  const html = renderDashboardHtml({
    settings: { automationPaused: false },
    performance: {
      totalValueUsd: 20,
      cashUsd: 10,
      todayGainLossUsd: 0.25,
      totalReturnUsd: 0,
      priceReturnUsd: 0,
      dividendReturnUsd: 0,
      tradeCount: 0,
      maxDrawdownPct: 0,
      benchmarkReturns: [{ benchmarkName: "cash", returnPct: 0, latestValueUsd: 20 }]
    },
    positions: [{ symbol: "BTC-USD", assetClass: "crypto", quantity: 0.00003111916041121339, marketValueUsd: 10 }],
    recommendations: [{ symbol: "SPY", action: "DO_NOTHING", explanation: "No deterministic buy signal met the threshold." }],
    journal: [{ symbol: "BTC-USD", decision: "HOLD", explanation: "No deterministic exit signal.", confidenceScore: 0.72 }],
    trades: [{ symbol: "BTC-USD", side: "BUY", quantity: 0.00003111916041121339, priceUsd: 64000, executedAt: "2026-07-13T14:00:00.000Z" }],
    scheduledRuns: [{ runKey: "scheduled:test", status: "completed", startedAt: "2026-07-13T14:00:00.000Z" }],
    summaries: [{ summaryType: "morning", title: "Morning", body: "Watching BTC-USD and SPY." }],
    rejectedOpportunities: [{ symbol: "SPY", explanation: "US market is closed." }],
    marketDataStatus: [{ symbol: "SPY", source: "cache", fetchedAt: "2026-07-13T14:00:00.000Z", isFresh: false, status: "cached", userMessage: "Using a recent cached market snapshot." }],
    equityHistory: [
      { recordedAt: "2026-07-13T13:00:00.000Z", totalValueUsd: 19.5 },
      { recordedAt: "2026-07-13T14:00:00.000Z", totalValueUsd: 20 }
    ]
  });

  assert.match(html, /Overview/);
  assert.match(html, /Positions/);
  assert.match(html, /Decision Journal/);
  assert.match(html, /Latest Recommendations/);
  assert.match(html, /Scheduled Runs/);
  assert.match(html, /0\.00003112 BTC/);
  assert.match(html, /class="badge badge-buy">BUY/);
  assert.match(html, /class="badge status-cached">Cached/);
  assert.match(html, /Portfolio History/);
  assert.doesNotMatch(html, /PAPER_RUN_SECRET/);
});
