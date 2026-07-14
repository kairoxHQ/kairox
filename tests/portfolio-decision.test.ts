import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildPortfolioDecision,
  type AllocationDrift,
  type AllocationShape,
  type PortfolioDecisionRuleConfig
} from "../src/decisions/portfolioDecision.ts";
import type { BenchmarkComparisonSummary } from "../src/benchmarks/comparison.ts";
import type { InvestmentPolicy } from "../src/policies/investmentPolicy.ts";

const migration = readFileSync("migrations/0027_portfolio_decisions.sql", "utf8");
const serviceSource = readFileSync("src/decisions/portfolioDecision.ts", "utf8");
const dashboardSource = readFileSync("src/dashboard/service.ts", "utf8");
const indexSource = readFileSync("src/index.ts", "utf8");
const managementSource = readFileSync("src/management/dailyCycle.ts", "utf8");

test("portfolio decision rules and audit tables are configurable and versioned", () => {
  assert.match(migration, /portfolio_decision_rule_configs/);
  assert.match(migration, /minimum_allocation_drift_pct/);
  assert.match(migration, /cooldown_days_after_execution/);
  assert.match(migration, /maximum_monthly_turnover_pct/);
  assert.match(migration, /maximum_quarterly_rebalances/);
  assert.match(migration, /portfolio_decisions/);
  assert.match(migration, /input_snapshot_json/);
  assert.match(migration, /UNIQUE\(portfolio_id, source_cycle_id, source_cycle_version_hash\)/);
});

test("hold recommendation is produced when policy, risk, data, and drift are inside limits", () => {
  const decision = buildPortfolioDecision(sampleInput());
  assert.equal(decision.primaryRecommendation, "Hold");
  assert.equal(decision.status, "No action");
  assert.equal(decision.actions.length, 0);
  assert.match(decision.summary, /Confidence reflects data quality/);
});

test("excess cash creates deploy excess cash recommendation without exact quantity", () => {
  const decision = buildPortfolioDecision(sampleInput({
    currentAllocation: allocation({ cashPct: 0.7, equityPct: 0.2, bondPct: 0.1 }),
    drift: drift({ cashPct: 0.3, maxAbsoluteDriftPct: 0.3 }),
    cashUsd: 1700
  }));
  assert.equal(decision.primaryRecommendation, "Deploy excess cash");
  assert.equal(decision.actions[0].symbolOrCategory, "Cash reserve");
  assert.ok(decision.actions[0].suggestedDollarRange.maxUsd > 25);
  assert.equal("estimatedQuantity" in decision.actions[0], false);
});

test("rebalance recommendation requires material drift and minimum trade value", () => {
  const decision = buildPortfolioDecision(sampleInput({
    drift: drift({ equityPct: 0.12, maxAbsoluteDriftPct: 0.12 }),
    currentAllocation: allocation({ equityPct: 0.52, cashPct: 0.3, bondPct: 0.18 })
  }));
  assert.equal(decision.primaryRecommendation, "Rebalance");
  assert.match(decision.triggeredRules.join(" "), /rebalance threshold/);
});

test("increase cash recommendation is triggered by defensive drawdown", () => {
  const decision = buildPortfolioDecision(sampleInput({
    drawdown: { currentDrawdownPct: 0.08, maximumDrawdownPct: 0.08 }
  }));
  assert.equal(decision.primaryRecommendation, "Increase cash");
  assert.equal(decision.urgency, "High");
});

test("policy violation and critical drawdown trigger risk intervention", () => {
  const decision = buildPortfolioDecision(sampleInput({
    policyFindings: ["Cash allocation is below the policy minimum."],
    drawdown: { currentDrawdownPct: 0.11, maximumDrawdownPct: 0.11 },
    currentAllocation: allocation({ cashPct: 0.05, equityPct: 0.7, bondPct: 0.25 })
  }));
  assert.equal(decision.primaryRecommendation, "Risk intervention");
  assert.equal(decision.status, "Blocked by policy");
});

test("missing or stale market data blocks actionable recommendation", () => {
  const decision = buildPortfolioDecision(sampleInput({ marketDataStatus: "stale" }));
  assert.equal(decision.primaryRecommendation, "Data unavailable");
  assert.equal(decision.status, "Blocked by data");
});

test("existing unresolved proposal or order batch requires review", () => {
  const decision = buildPortfolioDecision(sampleInput({
    unresolvedItems: ["Unresolved recommendation proposal x is Draft."]
  }));
  assert.equal(decision.primaryRecommendation, "Review required");
  assert.match(decision.suppressedRules.join(" "), /duplicate workflow/);
});

test("cooldown after execution suppresses churn", () => {
  const decision = buildPortfolioDecision(sampleInput({ cooldownActive: true }));
  assert.equal(decision.primaryRecommendation, "Review required");
  assert.match(decision.suppressedRules.join(" "), /Anti-churn/);
});

test("minimum trade threshold suppresses trivial rebalance", () => {
  const decision = buildPortfolioDecision(sampleInput({
    portfolioValueUsd: 240,
    drift: drift({ equityPct: 0.081, maxAbsoluteDriftPct: 0.081 })
  }));
  assert.equal(decision.primaryRecommendation, "Review required");
  assert.match(decision.suppressedRules.join(" "), /minimum trade threshold/);
});

test("confidence score uses data freshness, policy clarity, rule agreement, and evidence quality", () => {
  const fresh = buildPortfolioDecision(sampleInput()).confidenceScore;
  const stale = buildPortfolioDecision(sampleInput({ marketDataStatus: "unavailable", policy: null })).confidenceScore;
  assert.ok(fresh > stale);
  assert.ok(fresh <= 0.95);
  assert.ok(stale >= 0.1);
});

test("recommendation expiration and supersession are represented", () => {
  assert.match(migration, /expires_at/);
  assert.match(migration, /superseding_decision_id/);
  assert.match(serviceSource, /expireOutdated/);
  assert.match(serviceSource, /supersedeActive/);
});

test("accept for proposal delegates to existing proposal workflow and prevents duplicate acceptance", () => {
  assert.match(serviceSource, /createDraftFromReview/);
  assert.match(serviceSource, /resultingProposalId/);
  assert.match(serviceSource, /idempotent: true/);
  assert.doesNotMatch(serviceSource, /approveAllocationProposal|stagePaperOrdersForProposal|executePaperOrderBatch/);
});

test("reject, defer, and mark reviewed status transitions are stored as decision events", () => {
  assert.match(serviceSource, /decision_rejected/);
  assert.match(serviceSource, /decision_deferred/);
  assert.match(serviceSource, /decision_reviewed/);
  assert.match(migration, /portfolio_decision_events/);
});

test("journey events are meaningful and deduplicated for repetitive hold decisions", () => {
  assert.match(serviceSource, /recordMeaningfulJourney/);
  assert.match(serviceSource, /primaryRecommendation === "Hold"/);
  assert.match(serviceSource, /priorHold/);
});

test("manual and daily-management operation are wired", () => {
  assert.match(indexSource, /"\/portfolio-decisions\/run"/);
  assert.match(indexSource, /"\/portfolio-decisions"/);
  assert.match(indexSource, /accept\|reject\|defer\|review/);
  assert.match(managementSource, /PortfolioDecisionService/);
  assert.match(managementSource, /evaluateCycle\(cycle\.id/);
});

test("dashboard exposes recommendation, review controls, history, and safe warnings", () => {
  assert.match(dashboardSource, /Portfolio Decision/);
  assert.match(dashboardSource, /data-run-portfolio-decision/);
  assert.match(dashboardSource, /data-portfolio-decision-action="accept"/);
  assert.match(dashboardSource, /Recommendation history/);
  assert.match(dashboardSource, /will not approve, stage, execute, or move cash/);
});

test("benchmark context informs explanations but cannot directly force trades", () => {
  const decision = buildPortfolioDecision(sampleInput({
    benchmarkSummary: benchmarkSummary("Strong", "VTI is far ahead today.")
  }));
  assert.equal(decision.primaryRecommendation, "Hold");
  assert.match(decision.suppressedRules.join(" "), /Benchmark context is informational/);
});

test("portfolio decision service does not create orders, fills, trades, cash, or position changes", () => {
  assert.doesNotMatch(serviceSource, /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+(trades|paper_order_fills|paper_order_executions|paper_cash_ledger|orders|paper_order_batches)\b/i);
  assert.doesNotMatch(serviceSource, /UPDATE\s+(portfolios|positions|trades|paper_order_batches)\b/i);
});

function sampleInput(overrides: {
  currentAllocation?: AllocationShape;
  targetAllocation?: AllocationShape;
  drift?: AllocationDrift;
  drawdown?: { currentDrawdownPct: number; maximumDrawdownPct: number };
  marketDataStatus?: "fresh" | "stale" | "unavailable";
  unresolvedItems?: string[];
  policyFindings?: string[];
  riskFindings?: string[];
  cashUsd?: number;
  portfolioValueUsd?: number;
  policy?: InvestmentPolicy | null;
  config?: PortfolioDecisionRuleConfig;
  benchmarkSummary?: BenchmarkComparisonSummary;
  cooldownActive?: boolean;
} = {}) {
  const currentAllocation = overrides.currentAllocation ?? allocation({});
  const targetAllocation = overrides.targetAllocation ?? allocation({});
  const cycle = {
    id: "daily_management_portfolio_ira_2026-07-14",
    portfolioId: "portfolio_ira",
    cycleDate: "2026-07-14",
    status: "completed",
    completedAt: "2026-07-14T21:00:00.000Z",
    dataTimestamp: "2026-07-14T20:00:00.000Z",
    marketDataSnapshotId: "mdsnap",
    marketDataStatus: overrides.marketDataStatus ?? "fresh",
    portfolioValueUsd: overrides.portfolioValueUsd ?? 2400,
    investedValueUsd: 1440,
    cashUsd: overrides.cashUsd ?? 960,
    currentAllocationJson: JSON.stringify(currentAllocation),
    targetAllocationJson: JSON.stringify(targetAllocation),
    allocationDriftJson: JSON.stringify(overrides.drift ?? drift({})),
    drawdownMetricsJson: JSON.stringify(overrides.drawdown ?? { currentDrawdownPct: 0.01, maximumDrawdownPct: 0.02 }),
    riskFindingsJson: JSON.stringify(overrides.riskFindings ?? []),
    policyFindingsJson: JSON.stringify(overrides.policyFindings ?? []),
    unresolvedItemsJson: JSON.stringify(overrides.unresolvedItems ?? []),
    policyCompliant: (overrides.policyFindings ?? []).length ? 0 : 1,
    outcome: "Hold",
    recommendationExplanation: "No action.",
    dailyReviewId: "daily_review_portfolio_ira_2026-07-14",
    refreshReason: null,
    updatedAt: "2026-07-14T21:00:00.000Z"
  };
  return {
    cycle,
    policy: overrides.policy === undefined ? policy() : overrides.policy,
    config: overrides.config ?? config(),
    benchmarkSummary: overrides.benchmarkSummary ?? benchmarkSummary("Preliminary", "Comparison period is short."),
    cooldownActive: overrides.cooldownActive ?? false,
    now: new Date("2026-07-14T21:01:00.000Z")
  };
}

function allocation(overrides: Partial<AllocationShape>): AllocationShape {
  return { cashPct: 0.4, equityPct: 0.4, bondPct: 0.2, otherPct: 0, largestPositionPct: 0.2, largestSectorPct: 0.25, sectors: {}, ...overrides };
}

function drift(overrides: Partial<AllocationDrift>): AllocationDrift {
  return { cashPct: 0, equityPct: 0, bondPct: 0, otherPct: 0, maxAbsoluteDriftPct: 0, sectors: {}, ...overrides };
}

function policy(): InvestmentPolicy {
  return {
    id: "policy_ira",
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
    allowedInvestmentTypes: [],
    prohibitedInvestmentTypes: ["crypto", "options", "margin"],
    simulationBeganAt: "2026-07-13T21:00:00.000Z"
  };
}

function config(): PortfolioDecisionRuleConfig {
  return {
    id: "portfolio_decision_conservative_retirement_v1",
    riskProfile: "Conservative",
    strategyName: "Conservative Retirement",
    version: 1,
    minimumAllocationDriftPct: 0.03,
    rebalanceDriftThresholdPct: 0.08,
    deployCashExcessPct: 0.08,
    defensiveDrawdownPct: 0.07,
    criticalDrawdownPct: 0.1,
    minimumTradeValueUsd: 25,
    minimumExpectedImprovementPct: 0.02,
    cooldownDaysAfterExecution: 7,
    maximumMonthlyTurnoverPct: 0.2,
    maximumQuarterlyRebalances: 2,
    minimumConfidence: 0.65,
    stalePriceMs: 36 * 60 * 60 * 1000,
    expirationHours: 24,
    rules: {}
  };
}

function benchmarkSummary(label: BenchmarkComparisonSummary["evidence"]["label"], proofSummary: string): BenchmarkComparisonSummary {
  return {
    portfolioId: "portfolio_ira",
    startDate: "2026-07-13",
    startingCapitalUsd: 2400,
    evidence: { label, days: label === "Preliminary" ? 1 : 260, description: "test" },
    proofSummary,
    configurations: [],
    benchmarks: [
      { benchmarkKey: "kairox_actual", benchmarkName: "Kairox", currentValueUsd: 2400, totalGainLossUsd: 0, returnPct: 0, annualizedReturnPct: null, volatilityPct: null, maximumDrawdownPct: 0.01, currentDrawdownPct: 0, bestDayPct: null, worstDayPct: null, positiveDayPct: null, downsideDeviationPct: null, sharpeRatio: null, sortinoRatio: null, returnPerDrawdown: null, daysSinceStart: 1, differenceVsKairoxUsd: 0, differenceVsKairoxPct: 0, aheadBehind: "even", riskLevel: "Moderate", pricingStatus: "complete", dataTimestamp: "2026-07-14T20:00:00.000Z", unavailableReason: null },
      { benchmarkKey: "vti_buy_hold", benchmarkName: "100% VTI buy-and-hold", currentValueUsd: 2420, totalGainLossUsd: 20, returnPct: 0.008333, annualizedReturnPct: null, volatilityPct: null, maximumDrawdownPct: 0.02, currentDrawdownPct: 0, bestDayPct: null, worstDayPct: null, positiveDayPct: null, downsideDeviationPct: null, sharpeRatio: null, sortinoRatio: null, returnPerDrawdown: null, daysSinceStart: 1, differenceVsKairoxUsd: -20, differenceVsKairoxPct: -0.008264, aheadBehind: "behind", riskLevel: "Equity", pricingStatus: "complete", dataTimestamp: "2026-07-14T20:00:00.000Z", unavailableReason: null }
    ],
    history: [],
    monthlyReport: { status: "insufficient_history", reportMonth: "2026-07", latestVersion: 0, previewUrl: "", csvUrl: "" },
    warnings: []
  };
}
