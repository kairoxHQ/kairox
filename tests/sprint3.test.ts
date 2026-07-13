import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDashboardTimestamp, relativeAge, renderDashboardHtml } from "../src/dashboard/service.ts";
import { assessDividendQuality, calculateReinvestedQuantity } from "../src/dividends/service.ts";
import { canExecuteAt, isRegularUsMarketHours } from "../src/market/hours.ts";
import { calculateMaxDrawdownFromSeries, compareBenchmark } from "../src/portfolio/performance.ts";
import { buildScheduledRunKey, hasOverlappingRun, shouldAllowScheduledExecution, summarizeScheduledRun } from "../src/scheduler/service.ts";

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
    journal: [{ symbol: "BTC-USD", decision: "HOLD", explanation: "No deterministic exit signal.", confidenceScore: 0.72, createdAt: "2026-07-13T14:00:00.000Z" }],
    trades: [{ symbol: "BTC-USD", side: "BUY", quantity: 0.00003111916041121339, priceUsd: 64000, executedAt: "2026-07-13T14:00:00.000Z" }],
    scheduledRuns: [{ runKey: "scheduled:test", status: "completed", startedAt: "2026-07-13T14:00:00.000Z" }],
    scheduledRunAudits: [
      {
        runKey: "scheduled:test",
        scheduledAt: "2026-07-13T14:00:00.000Z",
        startedAt: "2026-07-13T14:00:00.000Z",
        finishedAt: "2026-07-13T14:00:02.000Z",
        status: "completed",
        durationMs: 2000,
        finalStatus: "completed",
        profileCount: 1,
        assetsAttempted: 2,
        assetsEvaluatedSuccessfully: 1,
        assetsSkipped: 1,
        providerFailures: 0,
        staleDataRejections: 1,
        tradesCreated: 0,
        duplicatePrevention: false,
        errorDetails: null,
        skipReason: null,
        profiles: [{
          displayName: "Tim Balanced",
          profileKey: "tim_balanced",
          assetsAttempted: 2,
          assetsEvaluatedSuccessfully: 1,
          assetsSkipped: 1,
          providerFailures: 0,
          staleDataRejections: 1,
          recommendations: { HOLD: 1, DO_NOTHING: 1 },
          tradesCreated: 0,
          duplicatePrevention: false,
          safeguardsTriggered: []
        }]
      }
    ],
    summaries: [{ summaryType: "morning", summaryDate: "2026-07-13", title: "Morning", body: "Watching BTC-USD and SPY." }],
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
  assert.match(html, /Assets attempted/);
  assert.match(html, /Provider failures/);
  assert.match(html, /Tim Balanced/);
  assert.match(html, /0\.00003112 BTC/);
  assert.match(html, /class="badge badge-buy">BUY/);
  assert.match(html, /class="badge status-cached">Cached/);
  assert.match(html, /data-kairox-time="2026-07-13T14:00:00.000Z"/);
  assert.match(html, /data-kairox-time-mode="cached"/);
  assert.match(html, /Portfolio History/);
  assert.doesNotMatch(html, /PAPER_RUN_SECRET/);
});

test("dashboard layout uses one centered shell and predictable grid breakpoints", () => {
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
    rejectedOpportunities: []
  });

  assert.match(html, /--page-max: 1360px/);
  assert.match(html, /<div class="page-shell header-inner">/);
  assert.match(html, /<main class="page-shell">/);
  assert.match(html, /margin-inline: auto/);
  assert.match(html, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(html, /@media \(max-width: 1100px\)/);
  assert.match(html, /@media \(max-width: 640px\)/);
  assert.match(html, /nav \{ display: flex; justify-content: center; flex-wrap: wrap/);
  assert.match(html, /a:focus-visible/);
});

test("dashboard timestamp formatter converts UTC to Eastern with daylight saving label", () => {
  const formatted = formatDashboardTimestamp(
    "2026-07-13T06:33:00.000Z",
    new Date("2026-07-13T10:33:00.000Z"),
    "America/New_York"
  );

  assert.equal(formatted.status, "ok");
  assert.match(formatted.text, /Jul 13, 2:33 AM EDT/);
  assert.match(formatted.text, /Updated 4 hours ago/);
});

test("dashboard timestamp formatter handles standard time in Eastern", () => {
  const formatted = formatDashboardTimestamp(
    "2026-01-13T07:33:00.000Z",
    new Date("2026-01-13T08:33:00.000Z"),
    "America/New_York"
  );

  assert.equal(formatted.status, "ok");
  assert.match(formatted.text, /Jan 13, 2:33 AM EST/);
});

test("dashboard timestamp formatter supports browser-local timezone formatting", () => {
  const formatted = formatDashboardTimestamp(
    "2026-07-13T06:33:00.000Z",
    new Date("2026-07-13T06:37:00.000Z"),
    "America/Los_Angeles"
  );

  assert.equal(formatted.status, "ok");
  assert.match(formatted.text, /Jul 12, 11:33 PM PDT/);
  assert.match(formatted.text, /Updated 4 minutes ago/);
});

test("dashboard timestamp formatter protects against future clock skew", () => {
  const formatted = formatDashboardTimestamp(
    "2026-07-13T06:40:01.000Z",
    new Date("2026-07-13T06:35:00.000Z"),
    "America/New_York"
  );

  assert.deepEqual(formatted, { text: "Timestamp unavailable", status: "clock_skew" });
});

test("relative age distinguishes cached market status copy", () => {
  const age = relativeAge(new Date("2026-07-13T02:33:00.000Z"), new Date("2026-07-13T10:33:00.000Z"), "cached");

  assert.equal(age, "Cached from 8 hours ago");
});

test("scheduled run audit summarizes production-safe operational health", () => {
  const audit = summarizeScheduledRun({
    id: "scheduled_1",
    runKey: "scheduled:*/30 * * * *:2026-07-13T14:00",
    cron: "*/30 * * * *",
    scheduledAt: "2026-07-13T14:00:00.000Z",
    startedAt: "2026-07-13T14:00:00.000Z",
    finishedAt: "2026-07-13T14:00:05.000Z",
    status: "completed",
    errorDetails: null,
    createdAt: "2026-07-13T14:00:00.000Z",
    summaryJson: JSON.stringify({
      runKey: "scheduled:*/30 * * * *:2026-07-13T14:00",
      status: "completed",
      automationPaused: false,
      profiles: [
        {
          profile: { portfolioId: "portfolio_tim_paper", profileKey: "tim_balanced", displayName: "Tim Balanced" },
          symbols: [
            { symbol: "BTC-USD", action: "HOLD", executed: false, reason: "No deterministic exit signal." },
            { symbol: "FXAIX", action: "DO_NOTHING", executed: false, reason: "Market data is unavailable, stale, or malformed." }
          ]
        }
      ]
    })
  });

  assert.equal(audit.durationMs, 5000);
  assert.equal(audit.profileCount, 1);
  assert.equal(audit.assetsAttempted, 2);
  assert.equal(audit.providerFailures, 1);
  assert.equal(audit.staleDataRejections, 1);
  assert.equal(audit.tradesCreated, 0);
  assert.equal(audit.profiles[0].recommendations.HOLD, 1);
});
