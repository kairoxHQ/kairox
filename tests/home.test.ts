import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHomeSummary, presentDecision, renderHomeHtml } from "../src/home/service.ts";
import type { PortfolioDecision } from "../src/decisions/portfolioDecision.ts";
import type { PerformanceMetrics } from "../src/portfolio/performance.ts";

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

test("home page renders conversation-first greeting, input, quick actions, and briefing", () => {
  const html = renderHomeHtml(homeData({
    portfolioHealth: "Within strategy",
    todaysRecommendation: "Stay the course",
    internalRecommendation: "Hold",
    portfolioValueUsd: 2400,
    explanation: "Nothing needs attention today. The latest paper-portfolio decision is to stay the course, and no trade has been placed.",
    reassurance: "Your portfolio remains within its current paper strategy.",
    technicalDetails: ["Internal recommendation: Hold", "Confidence score: 75%"]
  }));

  assert.match(html, /<title>Kairox Home<\/title>/);
  assert.match(html, /Good Evening<\/span>, Tim\./);
  assert.match(html, /How can I help you today\?/);
  assert.match(html, /What would you like help with\?/);
  assert.match(html, /aria-label="Ask Kairox what you would like help with about your paper portfolio"/);
  assert.match(html, /Your portfolio remains within its current paper strategy\./);
  assert.match(html, /aria-label="Help me retire comfortably"/);
  assert.match(html, /aria-label="Grow my investments"/);
  assert.match(html, /aria-label="Generate income"/);
  assert.match(html, /aria-label="Review my portfolio"/);
  assert.match(html, /aria-label="Find opportunities"/);
  assert.match(html, /aria-label="Learn about investing"/);
  assert.match(html, /Today&#39;s Briefing|Today's Briefing/);
  assert.doesNotMatch(html, /Today&#39;s Summary|Today's Summary/);
  assert.match(html, /Portfolio Health/);
  assert.match(html, /Today&#39;s Recommendation|Today's Recommendation/);
  assert.match(html, /Portfolio Value/);
  assert.match(html, /\$2,400\.00/);
  assert.match(html, /<details>/);
  assert.match(html, /<summary>View details<\/summary>/);
  assert.match(html, /Kairox remains paper-only/);
});

test("home page keeps existing navigation functional without dashboard overload", () => {
  const html = renderHomeHtml(homeData({
    portfolioHealth: "Within strategy",
    todaysRecommendation: "Stay the course",
    internalRecommendation: "Hold",
    portfolioValueUsd: 2397.36,
    explanation: "Nothing needs attention today.",
    reassurance: "Your portfolio remains within its current paper strategy.",
    technicalDetails: ["Internal recommendation: Hold"]
  }));

  assert.match(html, /href="\/dashboard\?portfolioId=portfolio_ira"/);
  assert.match(html, /href="\/portfolio\?portfolioId=portfolio_ira"/);
  assert.match(html, /href="\/research\?portfolioId=portfolio_ira"/);
  assert.match(html, /href="\/strategy-runs\?portfolioId=portfolio_ira"/);
  assert.match(html, /href="\/journey\?portfolioId=portfolio_ira"/);
  assert.doesNotMatch(html, /<table/i);
  assert.doesNotMatch(html, /ticker-strip|market-ticker|live news|Portfolio History/i);
  assert.doesNotMatch(html, /<svg/i);
});

test("home page includes responsive calm design hooks without mobile overflow", () => {
  const html = renderHomeHtml(homeData({
    portfolioHealth: "Within strategy",
    todaysRecommendation: "Stay the course",
    internalRecommendation: "Hold",
    portfolioValueUsd: 2400,
    explanation: "Nothing needs attention today.",
    reassurance: "Your portfolio remains within its current paper strategy.",
    technicalDetails: ["Internal recommendation: Hold"]
  }));

  assert.match(html, /grid-template-columns: minmax\(0, 1\.25fr\) minmax\(280px, 0\.75fr\)/);
  assert.match(html, /@media \(max-width: 860px\)/);
  assert.match(html, /@media \(max-width: 560px\)/);
  assert.match(html, /h1 \{ max-width: 100%; font-size: 2\.65rem; \}/);
  assert.match(html, /overflow-wrap: anywhere/);
  assert.match(html, /box-shadow: var\(--shadow\)/);
});

test("presentation layer maps internal statuses to calm home labels", () => {
  assert.equal(presentDecision("Hold").label, "Stay the course");
  assert.equal(presentDecision("Review recommended").label, "Review suggested");
  assert.equal(presentDecision("Rebalance proposal recommended").label, "Portfolio adjustment suggested");
  assert.equal(presentDecision("Risk intervention").label, "Attention needed");
  assert.equal(presentDecision("Data unavailable").label, "Waiting for updated information");
  assert.equal(presentDecision("Policy violation").label, "One investment is outside your chosen limits");
});

test("home summary keeps internal decision values unchanged while displaying plain language", () => {
  const summary = buildHomeSummary(basePerformance, decision({
    primaryRecommendation: "Risk intervention",
    status: "Blocked by policy",
    policyCompliance: { compliant: false, reasons: ["Largest position exceeds the chosen single-position limit."] },
    triggeredRules: ["Policy compliance has priority over return optimization."]
  }));

  assert.equal(summary.internalRecommendation, "Risk intervention");
  assert.equal(summary.todaysRecommendation, "One investment is outside your chosen limits");
  assert.equal(summary.portfolioHealth, "Review suggested");
  assert.match(summary.explanation, /One position needs review/);
  assert.match(summary.explanation, /single-position limit/);
  assert.equal(summary.reassurance, "One position needs review, but no trade has been placed.");
  assert.ok(summary.technicalDetails.includes("Internal recommendation: Risk intervention"));
});

test("hold and data-unavailable summaries use factual reassurance", () => {
  const holdSummary = buildHomeSummary(basePerformance, decision({
    primaryRecommendation: "Hold",
    status: "No action",
    policyCompliance: { compliant: true, reasons: [] },
    triggeredRules: ["No policy violation, material drift, stale data, or urgent risk event is present."]
  }));
  assert.equal(holdSummary.internalRecommendation, "Hold");
  assert.equal(holdSummary.todaysRecommendation, "Stay the course");
  assert.equal(holdSummary.reassurance, "Your portfolio remains within its current paper strategy.");
  assert.doesNotMatch(holdSummary.explanation, /retirement plan remains on track/i);

  const dataSummary = buildHomeSummary(basePerformance, decision({
    primaryRecommendation: "Data unavailable",
    status: "Blocked by data",
    dataQualityStatus: "stale",
    triggeredRules: ["Pricing is stale or unavailable."]
  }));
  assert.equal(dataSummary.internalRecommendation, "Data unavailable");
  assert.equal(dataSummary.todaysRecommendation, "Waiting for updated information");
  assert.equal(dataSummary.portfolioHealth, "Waiting for updated information");
  assert.match(dataSummary.explanation, /waiting for updated market information/i);
  assert.equal(dataSummary.reassurance, "I'm waiting for updated market information before making a recommendation.");
});

test("technical confidence details are hidden by default but expandable", () => {
  const summary = buildHomeSummary(basePerformance, decision({
    primaryRecommendation: "Hold",
    confidenceScore: 0.82,
    riskScore: 0.12,
    triggeredRules: ["No policy violation is present."]
  }));
  const html = renderHomeHtml(homeData(summary));

  assert.match(html, /<details>/);
  assert.match(html, /<summary>View details<\/summary>/);
  assert.match(html, /Confidence score: 82%/);
  assert.doesNotMatch(html, /<span class="label">Confidence/);
  assert.doesNotMatch(html, /<span class="label">Risk score/);
});

function homeData(summary: ReturnType<typeof buildHomeSummary>) {
  return {
    userName: "Tim",
    portfolioId: "portfolio_ira",
    portfolioName: "IRA",
    summary
  };
}

function decision(overrides: Partial<PortfolioDecision>): PortfolioDecision {
  return {
    id: "decision_home_test",
    portfolioId: "portfolio_ira",
    sourceCycleId: "cycle_home_test",
    sourceCycleVersionHash: "hash",
    evaluationDate: "2026-07-14",
    primaryRecommendation: "Hold",
    status: "No action",
    confidenceScore: 0.75,
    urgency: "Low",
    summary: "Hold: No material rule was triggered.",
    detailedExplanation: "No actionable rule was triggered.",
    supportingFacts: [],
    triggeredRules: [],
    suppressedRules: [],
    policyCompliance: { compliant: true, reasons: [] },
    currentAllocation: { cashPct: 0, equityPct: 0, bondPct: 0, otherPct: 0, largestPositionPct: 0, largestSectorPct: 0, sectors: {} },
    targetAllocation: { cashPct: 0, equityPct: 0, bondPct: 0, otherPct: 0, largestPositionPct: 0, largestSectorPct: 0, sectors: {} },
    allocationDrift: { cashPct: 0, equityPct: 0, bondPct: 0, otherPct: 0, maxAbsoluteDriftPct: 0, sectors: {} },
    actions: [],
    cashLevel: { cashUsd: 900, cashPct: 0.375, minimumCashPct: 0.1, targetCashPct: 0.2 },
    drawdown: { currentDrawdownPct: 0, maximumDrawdownPct: 0, policyMaxDrawdownPct: 0.1 },
    riskScore: 0.05,
    benchmarkContext: { evidenceLabel: "Preliminary", days: 1, kairoxValueUsd: 2400, bestReturnBenchmark: null, lowestDrawdownBenchmark: null, summary: "Benchmark evidence is preliminary." },
    inputSnapshot: { noTradingMutation: true },
    dataTimestamp: "2026-07-14T20:00:00.000Z",
    dataQualityStatus: "fresh",
    createdAt: "2026-07-14T20:01:00.000Z",
    expiresAt: "2026-07-15T20:01:00.000Z",
    userResponse: null,
    userResponseReason: null,
    respondedAt: null,
    resultingProposalId: null,
    supersedingDecisionId: null,
    ...overrides
  };
}
