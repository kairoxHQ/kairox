import assert from "node:assert/strict";
import { test } from "node:test";
import { renderPortfolioHtml } from "../src/portfolio/service.ts";

test("portfolio page renders an investor-focused primary view", () => {
  const html = renderPortfolioHtml({
    portfolioId: "portfolio_ira",
    accountName: "Kairox Conservative IRA",
    riskPosture: "conservative",
    generatedAt: "2026-07-17T14:00:00.000Z",
    guardianSummary: "Everything looks healthy. No action is recommended today.",
    valuation: {
      portfolioId: "portfolio_ira",
      valuationTimestamp: "2026-07-17T14:00:00.000Z",
      positions: [],
      availableCashUsd: 958.5594,
      cashUsd: 958.5594,
      portfolioValueUsd: 1440,
      totalPortfolioValueUsd: 1440,
      totalAccountValueUsd: 2398.5594,
      realizedProfitLossUsd: 0,
      unrealizedProfitLossUsd: 12,
      feesUsd: 0,
      todayChangeUsd: 1.25,
      todayChangePct: 0.000521,
      overallReturnUsd: -1.4406,
      overallReturnPct: -0.0006,
      lastSuccessfulMarketDataUpdateTime: "2026-07-17T13:55:00.000Z",
      dataStatus: "delayed",
      dataMode: "paper"
    },
    holdings: [
      {
        symbol: "VTI",
        displayName: "Vanguard Total Stock Market ETF",
        currentValueUsd: 480,
        todayChangeUsd: 1.2,
        todayChangePct: 0.0025,
        allocationPct: 0.2
      },
      {
        symbol: "BND",
        displayName: "Vanguard Total Bond Market ETF",
        currentValueUsd: 480,
        todayChangeUsd: -0.4,
        todayChangePct: -0.0008,
        allocationPct: 0.2
      }
    ],
    recentActivity: [
      {
        kind: "Decision",
        title: "DO_NOTHING",
        detail: "No action was recommended today.",
        createdAt: "2026-07-17T13:30:00.000Z"
      }
    ]
  } as never);

  assert.match(html, /Current account value/);
  assert.match(html, /\$2398\.5594/);
  assert.match(html, /Today&#39;s gain\/loss/);
  assert.match(html, /Lifetime return/);
  assert.match(html, /Cash available/);
  assert.match(html, /Guardian Summary/);
  assert.match(html, /Everything looks healthy\. No action is recommended today\./);
  assert.match(html, /VTI/);
  assert.match(html, /Vanguard Total Stock Market ETF/);
  assert.match(html, /Allocation/);
  assert.match(html, /Recent Activity/);
  assert.match(html, /No action was recommended today\./);
});

test("portfolio page keeps diagnostics and trading controls out of the primary view", () => {
  const html = renderPortfolioHtml({
    portfolioId: "portfolio_tim_paper",
    accountName: "Tim Balanced",
    riskPosture: "moderate",
    generatedAt: "2026-07-17T14:00:00.000Z",
    guardianSummary: "Some market data is not current. Monitoring only until fresh prices are available.",
    valuation: {
      portfolioId: "portfolio_tim_paper",
      valuationTimestamp: "2026-07-17T14:00:00.000Z",
      positions: [],
      availableCashUsd: 20,
      cashUsd: 20,
      portfolioValueUsd: 0,
      totalPortfolioValueUsd: 0,
      totalAccountValueUsd: 20,
      realizedProfitLossUsd: 0,
      unrealizedProfitLossUsd: 0,
      feesUsd: 0,
      todayChangeUsd: 0,
      todayChangePct: 0,
      overallReturnUsd: 0,
      overallReturnPct: 0,
      lastSuccessfulMarketDataUpdateTime: null,
      dataStatus: "unavailable",
      dataMode: "paper"
    },
    holdings: [],
    recentActivity: []
  } as never);

  assert.match(html, /Advanced data and diagnostics/);
  assert.doesNotMatch(html, /data-run-|\/paper\/run|PAPER_RUN_SECRET|API_KEY|Provider Health|Scheduled Runs|raw technical/i);
  assert.doesNotMatch(html, /<button/i);
});
