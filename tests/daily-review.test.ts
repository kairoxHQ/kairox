import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  DEFAULT_DAILY_REVIEW_CONFIG,
  calculateAllocation,
  decideDailyReview,
  evaluatePolicyWarnings,
  isUsMarketHoliday,
  shouldRunScheduledDailyReview
} from "../src/reviews/dailyReview.ts";
import type { InvestmentPolicy } from "../src/policies/investmentPolicy.ts";
import type { PortfolioValuation } from "../src/portfolio/valuation.ts";

const serviceSource = readFileSync("src/reviews/dailyReview.ts", "utf8");
const migration = readFileSync("migrations/0018_daily_portfolio_reviews.sql", "utf8");
const indexSource = readFileSync("src/index.ts", "utf8");
const dashboardSource = readFileSync("src/dashboard/service.ts", "utf8");

const policy: InvestmentPolicy = {
  id: "policy_portfolio_ira_conservative_retirement",
  portfolioId: "portfolio_ira",
  status: "active",
  riskProfile: "Conservative",
  primaryObjective: "Capital preservation with moderate long-term growth",
  timeHorizon: "Long term",
  incomeNeed: "Low",
  liquidityRequirement: "Moderate",
  maxDrawdownPct: 0.1,
  minCashAllocationPct: 0.1,
  maxSinglePositionPct: 0.2,
  maxSectorAllocationPct: 0.3,
  allowedAssetTypes: ["stock", "etf", "bond_fund", "money_market"],
  allowedInvestmentTypes: ["Broad-market ETFs", "Dividend ETFs", "Bond ETFs", "Treasury ETFs"],
  prohibitedInvestmentTypes: ["options", "margin", "leveraged_etf", "inverse_etf", "crypto", "penny_stock", "short_selling", "futures", "concentrated_single_stock"],
  simulationBeganAt: "2026-07-13T21:00:00.000Z"
};

test("empty and cash-only paper portfolios produce a hold decision", () => {
  const allocation = calculateAllocation(valuation(2400, 2400), []);
  const warnings = evaluatePolicyWarnings(policy, allocation, analytics(0));
  const decision = decideDailyReview({ allocation, policy, policyWarnings: warnings, dataFreshnessStatus: "fresh", currentDrawdownPct: 0, maximumDrawdownPct: 0, config: DEFAULT_DAILY_REVIEW_CONFIG });

  assert.equal(allocation.cashPct, 1);
  assert.equal(warnings.length, 0);
  assert.equal(decision.recommendation, "Hold");
});

test("fully invested portfolio below cash reserve is a risk-reduction warning", () => {
  const allocation = calculateAllocation(valuation(2400, 0), [
    position("VTI", "etf", 480),
    position("SCHD", "etf", 480),
    position("BND", "bond_fund", 1440)
  ]);
  const warnings = evaluatePolicyWarnings(policy, allocation, analytics(0));
  const decision = decideDailyReview({ allocation, policy, policyWarnings: warnings, dataFreshnessStatus: "fresh", currentDrawdownPct: 0, maximumDrawdownPct: 0, config: DEFAULT_DAILY_REVIEW_CONFIG });

  assert.match(warnings.join(" "), /cash allocation/i);
  assert.equal(decision.recommendation, "Risk Reduction Suggested");
});

test("positive and negative days are reflected in daily decision inputs", () => {
  const positive = valuation(2410, 960, 10, 0.004167);
  const negative = valuation(2380, 960, -20, -0.008333);

  assert.equal(positive.todayChangeUsd, 10);
  assert.equal(negative.todayChangeUsd, -20);
});

test("missing or stale market data returns Data Incomplete", () => {
  const allocation = calculateAllocation(valuation(2400, 960), [position("VTI", "etf", 480)]);
  const stale = decideDailyReview({ allocation, policy, policyWarnings: [], dataFreshnessStatus: "stale", currentDrawdownPct: 0, maximumDrawdownPct: 0, config: DEFAULT_DAILY_REVIEW_CONFIG });
  const unavailable = decideDailyReview({ allocation, policy, policyWarnings: [], dataFreshnessStatus: "unavailable", currentDrawdownPct: 0, maximumDrawdownPct: 0, config: DEFAULT_DAILY_REVIEW_CONFIG });

  assert.equal(stale.recommendation, "Data Incomplete");
  assert.equal(unavailable.recommendation, "Data Incomplete");
});

test("policy compliant conservative allocation can hold", () => {
  const allocation = calculateAllocation(valuation(2400, 1200), [
    position("VTI", "etf", 390),
    position("SCHD", "etf", 390),
    position("BND", "bond_fund", 390)
  ]);
  const warnings = evaluatePolicyWarnings(policy, allocation, analytics(0));
  const decision = decideDailyReview({ allocation, policy, policyWarnings: warnings, dataFreshnessStatus: "fresh", currentDrawdownPct: 0, maximumDrawdownPct: 0, config: DEFAULT_DAILY_REVIEW_CONFIG });

  assert.equal(allocation.largestPositionPct < 0.2, true);
  assert.equal(warnings.length, 0);
  assert.equal(decision.recommendation, "Hold");
});

test("position concentration and sector concentration warnings are detected", () => {
  const positionConcentration = calculateAllocation(valuation(2400, 960), [position("VTI", "etf", 600)]);
  const sectorConcentration = calculateAllocation(valuation(2400, 960), [position("VTI", "etf", 360), position("VOO", "etf", 360), position("SPY", "etf", 360)]);

  assert.match(evaluatePolicyWarnings(policy, positionConcentration, analytics(0)).join(" "), /single-position/i);
  assert.match(evaluatePolicyWarnings(policy, sectorConcentration, analytics(0)).join(" "), /sector/i);
});

test("allocation drift and drawdown warnings trigger deterministic recommendations", () => {
  const allocation = calculateAllocation(valuation(2400, 1200), [position("VTI", "etf", 480)]);
  const drift = decideDailyReview({ allocation, policy, policyWarnings: [], dataFreshnessStatus: "fresh", currentDrawdownPct: 0, maximumDrawdownPct: 0, config: DEFAULT_DAILY_REVIEW_CONFIG });
  const drawdown = decideDailyReview({ allocation, policy, policyWarnings: ["Current drawdown exceeds the policy drawdown target."], dataFreshnessStatus: "fresh", currentDrawdownPct: 0.12, maximumDrawdownPct: 0.12, config: DEFAULT_DAILY_REVIEW_CONFIG });

  assert.equal(drift.recommendation, "Rebalance Suggested");
  assert.equal(drawdown.recommendation, "Risk Reduction Suggested");
});

test("scheduler skips weekends, market holidays, and pre-close runs", () => {
  assert.equal(shouldRunScheduledDailyReview(new Date("2026-07-11T22:00:00.000Z")).shouldRun, false);
  assert.equal(isUsMarketHoliday("2026-07-03"), true);
  assert.equal(shouldRunScheduledDailyReview(new Date("2026-07-03T22:00:00.000Z")).reason, "Market holiday; U.S. equity market closed.");
  assert.equal(shouldRunScheduledDailyReview(new Date("2026-07-13T19:00:00.000Z")).reason, "Before regular U.S. market close review window.");
  assert.equal(shouldRunScheduledDailyReview(new Date("2026-07-13T20:10:00.000Z")).shouldRun, true);
});

test("manual and scheduled runs use the same DailyPortfolioReviewService", () => {
  assert.match(indexSource, /DailyPortfolioReviewService/);
  assert.match(indexSource, /service\.run\([\s\S]*"manual"/);
  assert.match(serviceSource, /runScheduledDailyReviews/);
  assert.match(serviceSource, /service\.run\(profile\.portfolioId, "scheduled"/);
});

test("duplicate daily review prevention and audit schema are present", () => {
  assert.match(serviceSource, /Daily review already exists for this market date/);
  assert.match(migration, /UNIQUE \(portfolio_id, market_date\)/);
  assert.match(migration, /daily_review_runs/);
  assert.match(migration, /daily_review_events/);
});

test("daily review does not create orders, trades, fills, or strategy records", () => {
  assert.doesNotMatch(serviceSource, /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+(orders|trades|paper_order_fills|paper_order_executions|strategy_runs|recommendations|decision_journal)\b/i);
  assert.match(serviceSource, /recordValuationSnapshot/);
  assert.match(serviceSource, /completeDailySnapshot/);
  assert.match(serviceSource, /recordEquityHistory/);
});

test("dashboard exposes review panel, chart, and protected manual action", () => {
  assert.match(dashboardSource, /Daily Review/);
  assert.match(dashboardSource, /Run Daily Review Now/);
  assert.match(dashboardSource, /data-run-daily-review/);
  assert.match(dashboardSource, /x-cryptolab-paper-secret/);
  assert.match(dashboardSource, /Performance Comparison/);
});

function valuation(total: number, cash: number, todayChangeUsd = 0, todayChangePct = 0): PortfolioValuation {
  return {
    portfolioId: "portfolio_ira",
    valuationTimestamp: "2026-07-13T20:10:00.000Z",
    positions: [],
    availableCashUsd: cash,
    cashUsd: cash,
    portfolioValueUsd: total - cash,
    totalPortfolioValueUsd: total - cash,
    totalAccountValueUsd: total,
    realizedProfitLossUsd: 0,
    unrealizedProfitLossUsd: 0,
    feesUsd: 0,
    todayChangeUsd,
    todayChangePct,
    overallReturnUsd: total - 2400,
    overallReturnPct: (total - 2400) / 2400,
    lastSuccessfulMarketDataUpdateTime: "2026-07-13T20:00:00.000Z",
    dataStatus: "delayed",
    dataMode: "paper"
  };
}

function position(symbol: string, assetClass: "etf" | "bond_fund", marketValueUsd: number) {
  const price = marketValueUsd;
  return { symbol, assetClass, quantity: 1, avgEntryPriceUsd: price, currentPriceUsd: price, marketValueUsd };
}

function analytics(currentDrawdownPct: number) {
  return { currentDrawdownPct, maximumDrawdownPct: currentDrawdownPct } as never;
}
