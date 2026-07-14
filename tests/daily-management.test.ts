import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  calculateAllocationDrift,
  decideDailyManagementCycle,
  DEFAULT_DAILY_MANAGEMENT_CONFIG,
  type AllocationDrift
} from "../src/management/dailyCycle.ts";

const migration = readFileSync("migrations/0025_daily_management_cycles.sql", "utf8");
const serviceSource = readFileSync("src/management/dailyCycle.ts", "utf8");
const dashboardSource = readFileSync("src/dashboard/service.ts", "utf8");
const indexSource = readFileSync("src/index.ts", "utf8");

test("daily management migration stores configurable thresholds and cycle evidence", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS daily_management_cycle_config/);
  assert.match(migration, /hold_drift_threshold_pct REAL NOT NULL/);
  assert.match(migration, /review_drift_threshold_pct REAL NOT NULL/);
  assert.match(migration, /rebalance_drift_threshold_pct REAL NOT NULL/);
  assert.match(migration, /drawdown_review_threshold_pct REAL NOT NULL/);
  assert.match(migration, /critical_drawdown_threshold_pct REAL NOT NULL/);
  assert.match(migration, /target_cash_pct REAL NOT NULL/);
  assert.match(migration, /target_equity_pct REAL NOT NULL/);
  assert.match(migration, /target_bond_pct REAL NOT NULL/);
  assert.match(migration, /UNIQUE \(portfolio_id, cycle_date\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS daily_management_cycle_events/);
});

test("hold result explains why no action is recommended", () => {
  const decision = decideDailyManagementCycle(baseInput());

  assert.equal(decision.outcome, "Hold");
  assert.match(decision.explanation, /No action is recommended/);
});

test("review and rebalance thresholds are separated", () => {
  const review = decideDailyManagementCycle(baseInput({ allocationDrift: drift(0.06) }));
  const rebalance = decideDailyManagementCycle(baseInput({ allocationDrift: drift(0.12) }));

  assert.equal(review.outcome, "Review recommended");
  assert.equal(rebalance.outcome, "Rebalance proposal recommended");
});

test("policy violation and drawdown warnings override normal drift logic", () => {
  const policy = decideDailyManagementCycle(baseInput({ policyFindings: ["Cash allocation is below the policy minimum."] }));
  const warning = decideDailyManagementCycle(baseInput({ riskFindings: ["Drawdown has reached the review threshold."] }));
  const critical = decideDailyManagementCycle(baseInput({ riskFindings: ["Critical drawdown warning: current drawdown reached the stored maximum drawdown target."] }));

  assert.equal(policy.outcome, "Policy violation");
  assert.equal(warning.outcome, "Review recommended");
  assert.equal(critical.outcome, "Risk alert");
});

test("stale or missing market data blocks actionable recommendations", () => {
  const stale = decideDailyManagementCycle(baseInput({ marketDataStatus: "stale", allocationDrift: drift(0.2) }));
  const unavailable = decideDailyManagementCycle(baseInput({ marketDataStatus: "unavailable", allocationDrift: drift(0.2) }));

  assert.equal(stale.outcome, "Data unavailable");
  assert.equal(unavailable.outcome, "Data unavailable");
  assert.match(stale.explanation, /will not recommend an actionable rebalance/);
});

test("existing unresolved proposal or order batch prevents automatic draft creation", () => {
  const decision = decideDailyManagementCycle(baseInput({
    allocationDrift: drift(0.12),
    unresolvedItems: ["Unresolved recommendation proposal review_proposal_1 is Draft."]
  }));

  assert.equal(decision.outcome, "Review recommended");
  assert.match(decision.explanation, /unresolved workflow already exists/);
  assert.match(serviceSource, /getUnresolvedItems/);
  assert.match(serviceSource, /ACTIVE_PROPOSAL_STATUSES/);
  assert.match(serviceSource, /ACTIVE_BATCH_STATUSES/);
});

test("allocation drift records current target differences", () => {
  const driftResult = calculateAllocationDrift(
    { cashPct: 0.39, equityPct: 0.41, bondPct: 0.2, otherPct: 0, largestPositionPct: 0.2, largestSectorPct: 0.2, sectors: { Equity: 0.41 } },
    { cashPct: 0.4, equityPct: 0.4, bondPct: 0.2, otherPct: 0, largestPositionPct: 0.2, largestSectorPct: 0.3, sectors: { Equity: 0.4 } }
  );

  assert.equal(driftResult.cashPct, -0.01);
  assert.equal(driftResult.equityPct, 0.01);
  assert.equal(driftResult.maxAbsoluteDriftPct, 0.01);
});

test("cycle creates draft proposals only through the existing proposal service and never approves them", () => {
  assert.match(serviceSource, /new RecommendationProposalService\(this\.db\)\.createDraftFromReview/);
  assert.match(serviceSource, /decision\.outcome === "Rebalance proposal recommended"/);
  assert.doesNotMatch(serviceSource, /approveAllocationProposal|markPaperOrderBatchReady|stagePaperOrdersForProposal|executePaperOrderBatch/);
  assert.doesNotMatch(serviceSource, /UPDATE allocation_proposals SET status = 'approved'/);
});

test("daily cycle does not create staged orders, fills, trades, positions, or cash movement", () => {
  assert.doesNotMatch(serviceSource, /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+(orders|trades|paper_order_fills|paper_order_executions|paper_cash_ledger)\b/i);
  assert.doesNotMatch(serviceSource, /UPDATE portfolios SET cash_usd/i);
  assert.doesNotMatch(serviceSource, /INSERT INTO positions|UPDATE positions/i);
});

test("daily-cycle idempotency, refresh, snapshots, and journey dedupe are represented", () => {
  assert.match(serviceSource, /Daily management cycle already exists for this market date/);
  assert.match(serviceSource, /ON CONFLICT\(portfolio_id, cycle_date\) DO UPDATE/);
  assert.match(serviceSource, /duplicate_cycle_prevented/);
  assert.match(serviceSource, /DailyPortfolioReviewService/);
  assert.match(serviceSource, /recordMeaningfulJourney/);
  assert.match(serviceSource, /recordJourneyEvent/);
  assert.match(serviceSource, /cycle\.outcome !== "Hold"/);
});

test("scheduler, market holiday handling, and protected manual endpoint are wired", () => {
  assert.match(serviceSource, /shouldRunScheduledDailyReview/);
  assert.match(indexSource, /runScheduledDailyManagementCycles/);
  assert.match(indexSource, /\/daily-management-cycles\/run/);
  assert.match(indexSource, /authorize\(request, env\)/);
  assert.match(indexSource, /runScheduledDailyManagementCycles\(env, scheduledAt\)/);
});

test("dashboard displays daily management cycle and safe manual action", () => {
  assert.match(dashboardSource, /Daily Management/);
  assert.match(dashboardSource, /data-run-daily-management/);
  assert.match(dashboardSource, /will not stage orders, create fills, move cash, or contact a live brokerage/);
  assert.match(dashboardSource, /Allocation drift/);
  assert.match(dashboardSource, /No draft proposal generated/);
});

function baseInput(overrides: Partial<Parameters<typeof decideDailyManagementCycle>[0]> = {}): Parameters<typeof decideDailyManagementCycle>[0] {
  return {
    allocationDrift: drift(0.01),
    policyFindings: [],
    riskFindings: [],
    unresolvedItems: [],
    marketDataStatus: "fresh",
    currentDrawdownPct: 0,
    config: DEFAULT_DAILY_MANAGEMENT_CONFIG,
    ...overrides
  };
}

function drift(value: number): AllocationDrift {
  return {
    cashPct: value,
    equityPct: -value,
    bondPct: 0,
    otherPct: 0,
    maxAbsoluteDriftPct: Math.abs(value),
    sectors: {}
  };
}
