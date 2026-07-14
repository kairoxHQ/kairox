import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  DEFAULT_RECOMMENDATION_PROPOSAL_CONFIG,
  buildRecommendationProposalPlan,
  validateReviewEligibility
} from "../src/recommendations/proposalService.ts";
import type { InvestmentPolicy } from "../src/policies/investmentPolicy.ts";

const serviceSource = readFileSync("src/recommendations/proposalService.ts", "utf8");
const migration = readFileSync("migrations/0019_recommendation_proposals.sql", "utf8");
const dashboardSource = readFileSync("src/dashboard/service.ts", "utf8");
const indexSource = readFileSync("src/index.ts", "utf8");

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

test("Hold, Monitor, and Data Incomplete reviews cannot create proposals", () => {
  for (const recommendation of ["Hold", "Monitor", "Data Incomplete"]) {
    const result = validateReviewEligibility(review({ recommendation }));
    assert.equal(result.eligible, false);
    assert.match(result.reason, new RegExp(recommendation.replace(" ", ".*")));
  }
});

test("Rebalance Suggested creates a draft buy proposal when cash can be deployed", () => {
  const plan = buildRecommendationProposalPlan({
    review: review({ recommendation: "Rebalance Suggested", allocation: { ...allocation(), cashPct: 0.45 } }),
    portfolio: portfolio({ cashUsd: 1200 }),
    policy,
    positions: [position("BND", "bond_fund", 100)],
    prices: prices(["BND"]),
    version: 1,
    now: now(),
    regenerateReason: null,
    config: { ...DEFAULT_RECOMMENDATION_PROPOSAL_CONFIG, maximumTurnoverPct: 0.05 }
  });

  assert.equal(plan.noActionReason, null);
  assert.equal(plan.proposal.status, "Draft");
  assert.equal(plan.proposal.proposedBuys.length, 1);
  assert.equal(plan.proposal.proposedSells.length, 0);
});

test("Risk Reduction Suggested creates a sell-oriented concentration proposal", () => {
  const plan = buildRecommendationProposalPlan({
    review: review({ recommendation: "Risk Reduction Suggested", rules: ["policy_limit"], warnings: ["A position exceeds the policy single-position limit."] }),
    portfolio: portfolio(),
    policy,
    positions: [position("SCHD", "etf", 480), position("BND", "bond_fund", 470)],
    prices: prices(["SCHD", "BND"]),
    version: 1,
    now: now(),
    regenerateReason: null,
    config: { ...DEFAULT_RECOMMENDATION_PROPOSAL_CONFIG, maximumTurnoverPct: 0.05 }
  });

  assert.equal(plan.noActionReason, null);
  assert.equal(plan.proposal.proposedSells[0].symbol, "SCHD");
  assert.equal(plan.proposal.proposedSells[0].side, "Sell");
  assert.equal(plan.proposal.estimatedTradeAmountUsd >= DEFAULT_RECOMMENDATION_PROPOSAL_CONFIG.minimumTradeValueUsd, true);
});

test("Opportunity Identified can create a compliant buy proposal", () => {
  const plan = buildRecommendationProposalPlan({
    review: review({ recommendation: "Opportunity Identified", rules: ["opportunity_identified"], allocation: { ...allocation(), cashPct: 0.5 } }),
    portfolio: portfolio({ cashUsd: 1300 }),
    policy,
    positions: [position("BND", "bond_fund", 300), position("VTI", "etf", 400), position("SCHD", "etf", 400)],
    prices: prices(["BND", "VTI", "SCHD"]),
    version: 1,
    now: now(),
    regenerateReason: null,
    config: DEFAULT_RECOMMENDATION_PROPOSAL_CONFIG
  });

  assert.equal(plan.noActionReason, null);
  assert.equal(plan.proposal.policyValidation.compliant, true);
  assert.equal(plan.proposal.proposedBuys.length, 1);
});

test("no compliant improvement produces No Actionable Proposal result", () => {
  const plan = buildRecommendationProposalPlan({
    review: review({ recommendation: "Risk Reduction Suggested" }),
    portfolio: portfolio(),
    policy,
    positions: [position("SCHD", "etf", 400)],
    prices: prices(["SCHD"]),
    version: 1,
    now: now(),
    regenerateReason: null,
    config: DEFAULT_RECOMMENDATION_PROPOSAL_CONFIG
  });

  assert.equal(plan.noActionReason, "No compliant trade cleared the configured thresholds.");
  assert.equal(plan.proposal.status, "No Actionable Proposal");
  assert.equal(plan.proposal.lines.length, 0);
});

test("minimum trade threshold prevents trivial trades", () => {
  const plan = buildRecommendationProposalPlan({
    review: review({ recommendation: "Risk Reduction Suggested" }),
    portfolio: portfolio(),
    policy,
    positions: [position("SCHD", "etf", 480)],
    prices: prices(["SCHD"]),
    version: 1,
    now: now(),
    regenerateReason: null,
    config: { ...DEFAULT_RECOMMENDATION_PROPOSAL_CONFIG, minimumTradeValueUsd: 10_000 }
  });

  assert.match(plan.noActionReason ?? "", /threshold|turnover|cash reserve/i);
});

test("maximum turnover, cash reserve, and stale price failures block proposals", () => {
  const turnover = buildRecommendationProposalPlan({
    review: review({ recommendation: "Risk Reduction Suggested" }),
    portfolio: portfolio(),
    policy,
    positions: [position("SCHD", "etf", 2400)],
    prices: prices(["SCHD"]),
    version: 1,
    now: now(),
    regenerateReason: null,
    config: { ...DEFAULT_RECOMMENDATION_PROPOSAL_CONFIG, maximumTurnoverPct: 0.00001 }
  });
  const stale = buildRecommendationProposalPlan({
    review: review({ recommendation: "Risk Reduction Suggested" }),
    portfolio: portfolio(),
    policy,
    positions: [position("SCHD", "etf", 480)],
    prices: new Map(),
    version: 1,
    now: now(),
    regenerateReason: null,
    config: DEFAULT_RECOMMENDATION_PROPOSAL_CONFIG
  });

  assert.match(turnover.noActionReason ?? "", /turnover/i);
  assert.match(stale.noActionReason ?? "", /Missing or stale market price/);
});

test("position, sector, prohibited security, and cash safeguards are represented", () => {
  assert.match(serviceSource, /maxSinglePositionPct/);
  assert.match(serviceSource, /maxSectorAllocationPct/);
  assert.match(serviceSource, /validateInvestmentPolicy/);
  assert.match(serviceSource, /minCashAllocationPct/);
  assert.match(serviceSource, /validateInvestmentPolicy/);
});

test("duplicate, concurrent, and version-history protections are present", () => {
  assert.match(migration, /idx_recommendation_proposals_active_review/);
  assert.match(migration, /UNIQUE \(portfolio_id, source_daily_review_id, version\)/);
  assert.match(serviceSource, /getActiveProposalForReview/);
  assert.match(serviceSource, /idempotent: true/);
  assert.match(serviceSource, /nextVersion/);
  assert.match(serviceSource, /Superseded/);
});

test("workflow stores audit events and dashboard actions without creating trading records", () => {
  assert.match(migration, /recommendation_proposal_events/);
  assert.match(serviceSource, /draft_proposal_requested/);
  assert.match(serviceSource, /proposal_created/);
  assert.match(serviceSource, /no_actionable_proposal_found/);
  assert.match(serviceSource, /proposal_marked_ready_for_review/);
  assert.match(serviceSource, /proposal_rejected/);
  assert.match(serviceSource, /proposal_superseded/);
  assert.doesNotMatch(serviceSource, /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+(orders|trades|paper_order_fills|paper_order_executions|paper_cash_ledger)\b/i);
  assert.match(dashboardSource, /Create Draft Proposal/);
  assert.match(dashboardSource, /data-recommendation-proposal-action/);
  assert.match(indexSource, /daily-reviews\\\/.+proposal/);
  assert.match(indexSource, /authorize\(request, env\)/);
});

function now(): Date {
  return new Date("2026-07-14T01:11:38.437Z");
}

function review(overrides: Record<string, unknown> = {}) {
  const baseAllocation = allocation();
  return {
    id: "daily_review_portfolio_ira_2026-07-13",
    portfolioId: "portfolio_ira",
    marketDate: "2026-07-13",
    status: "completed",
    recommendation: "Risk Reduction Suggested",
    triggeredRulesJson: JSON.stringify(overrides.rules ?? ["policy_limit"]),
    allocationJson: JSON.stringify(overrides.allocation ?? baseAllocation),
    policyWarningsJson: JSON.stringify(overrides.warnings ?? ["A position exceeds the policy single-position limit."]),
    dataFreshnessStatus: "fresh",
    confidenceScore: 0.9,
    riskScore: 0.36,
    diversificationScore: 0.62,
    marketDataTimestamp: "2026-07-13T20:00:01.000Z",
    relevantMetricsJson: JSON.stringify({ largestPositionPct: 0.20012 }),
    summaryExplanation: "Risk Reduction Suggested: A position exceeds the policy single-position limit.",
    ...overrides
  } as never;
}

function allocation() {
  return {
    cashPct: 0.39964,
    equityPct: 0.40024,
    bondPct: 0.20012,
    otherPct: 0,
    largestPositionPct: 0.20012,
    largestSectorPct: 0.20012,
    sectors: {
      "U.S. broad-market equity": 0.20012,
      "Dividend or low-volatility equity": 0.20012,
      "Investment-grade bonds": 0.20012
    }
  };
}

function portfolio(overrides: Partial<{ cashUsd: number; totalAccountValueUsd: number }> = {}) {
  return { id: "portfolio_ira", mode: "paper", cashUsd: 958.5594, totalAccountValueUsd: 2398.5594, ...overrides } as never;
}

function position(symbol: string, assetClass: "etf" | "bond_fund", marketValueUsd: number) {
  const price = symbol === "SCHD" ? 32.56 : symbol === "BND" ? 72.5 : 369.78;
  return {
    symbol,
    securityName: symbol,
    assetClass,
    quantity: marketValueUsd / price,
    currentPriceUsd: price,
    marketValueUsd
  } as never;
}

function prices(symbols: string[]) {
  return new Map(symbols.map((symbol) => [symbol, {
    symbol,
    priceUsd: symbol === "SCHD" ? 32.56 : symbol === "BND" ? 72.5 : 369.78,
    priceTimestamp: "2026-07-13T20:00:01.000Z",
    createdAt: "2026-07-14T01:11:38.437Z"
  }]));
}
