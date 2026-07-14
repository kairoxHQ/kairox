import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHomeSummary, renderHomeHtml } from "../src/home/service.ts";
import type { PerformanceMetrics } from "../src/portfolio/performance.ts";

test("home page renders conversation-first greeting, input, quick actions, and summary", () => {
  const html = renderHomeHtml({
    userName: "Tim",
    portfolioId: "portfolio_ira",
    portfolioName: "IRA",
    summary: {
      portfolioHealth: "Healthy",
      todaysRecommendation: "Hold",
      portfolioValueUsd: 2400,
      explanation: "Your retirement plan remains on track. No action is recommended today."
    }
  });

  assert.match(html, /<title>Kairox Home<\/title>/);
  assert.match(html, /Good Evening<\/span>, Tim\./);
  assert.match(html, /How can I help you today\?/);
  assert.match(html, /Ask Kairox anything about your portfolio\.\.\./);
  assert.match(html, /Help me retire comfortably/);
  assert.match(html, /Grow my investments/);
  assert.match(html, /Generate income/);
  assert.match(html, /Review my portfolio/);
  assert.match(html, /Find opportunities/);
  assert.match(html, /Learn about investing/);
  assert.match(html, /Today&#39;s Summary|Today's Summary/);
  assert.match(html, /Portfolio Health/);
  assert.match(html, /Today&#39;s Recommendation|Today's Recommendation/);
  assert.match(html, /Portfolio Value/);
  assert.match(html, /\$2,400\.00/);
  assert.match(html, /Your retirement plan remains on track\. No action is recommended today\./);
});

test("home page keeps existing navigation functional without dashboard overload", () => {
  const html = renderHomeHtml({
    userName: "Tim",
    portfolioId: "portfolio_ira",
    portfolioName: "IRA",
    summary: {
      portfolioHealth: "Healthy",
      todaysRecommendation: "Hold",
      portfolioValueUsd: 2397.36,
      explanation: "No action is recommended today."
    }
  });

  assert.match(html, /href="\/dashboard\?portfolioId=portfolio_ira"/);
  assert.match(html, /href="\/portfolio\?portfolioId=portfolio_ira"/);
  assert.match(html, /href="\/research\?portfolioId=portfolio_ira"/);
  assert.match(html, /href="\/strategy-runs\?portfolioId=portfolio_ira"/);
  assert.match(html, /href="\/journey\?portfolioId=portfolio_ira"/);
  assert.doesNotMatch(html, /<table/i);
  assert.doesNotMatch(html, /ticker-strip|market-ticker|live news|Portfolio History/i);
  assert.doesNotMatch(html, /<svg/i);
});

test("home page includes responsive calm design hooks", () => {
  const html = renderHomeHtml({
    userName: "Tim",
    portfolioId: "portfolio_ira",
    portfolioName: "IRA",
    summary: {
      portfolioHealth: "Healthy",
      todaysRecommendation: "Hold",
      portfolioValueUsd: 2400,
      explanation: "No action is recommended today."
    }
  });

  assert.match(html, /grid-template-columns: minmax\(0, 1\.25fr\) minmax\(280px, 0\.75fr\)/);
  assert.match(html, /@media \(max-width: 860px\)/);
  assert.match(html, /@media \(max-width: 560px\)/);
  assert.match(html, /box-shadow: var\(--shadow\)/);
});

test("home summary uses latest decision and flags risk or data issues", () => {
  const basePerformance: PerformanceMetrics = {
    startingBalanceUsd: 2400,
    cashUsd: 900,
    positionsValueUsd: 1500,
    totalValueUsd: 2400,
    realizedProfitLossUsd: 0,
    unrealizedProfitLossUsd: 0,
    estimatedTransactionCostsUsd: 0,
    dividendIncomeUsd: 0,
    priceReturnUsd: 0,
    dividendReturnUsd: 0,
    totalReturnUsd: 0,
    totalReturnPct: 0,
    maxDrawdownPct: 0,
    tradeCount: 0,
    benchmarkReturns: []
  };

  assert.deepEqual(buildHomeSummary(basePerformance, null), {
    portfolioHealth: "Healthy",
    todaysRecommendation: "Hold",
    portfolioValueUsd: 2400,
    explanation: "Your retirement plan remains on track. No action is recommended today."
  });

  const dataSummary = buildHomeSummary(basePerformance, { primaryRecommendation: "Data unavailable", summary: "Market data is incomplete." } as never);
  assert.equal(dataSummary.portfolioHealth, "Data Incomplete");
  assert.equal(dataSummary.todaysRecommendation, "Data unavailable");
  assert.equal(dataSummary.explanation, "Market data is incomplete.");

  const riskSummary = buildHomeSummary({ ...basePerformance, maxDrawdownPct: 0.12 }, null);
  assert.equal(riskSummary.portfolioHealth, "Review Needed");
});
