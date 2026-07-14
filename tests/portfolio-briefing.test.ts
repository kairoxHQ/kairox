import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  DeterministicBriefingNarrativeProvider,
  FailingBriefingNarrativeProvider,
  validateBriefingNarrative,
  type BriefingNarrative,
  type PortfolioBriefingFacts
} from "../src/briefings/portfolioBriefing.ts";

const migration = readFileSync("migrations/0028_portfolio_briefings.sql", "utf8");
const serviceSource = readFileSync("src/briefings/portfolioBriefing.ts", "utf8");
const dashboardSource = readFileSync("src/dashboard/service.ts", "utf8");
const indexSource = readFileSync("src/index.ts", "utf8");
const managementSource = readFileSync("src/management/dailyCycle.ts", "utf8");

test("briefing migration stores structured facts, narrative, prompt versions, validation, and history", () => {
  assert.match(migration, /portfolio_briefings/);
  assert.match(migration, /facts_snapshot_json/);
  assert.match(migration, /model_provider/);
  assert.match(migration, /prompt_version/);
  assert.match(migration, /validation_version/);
  assert.match(migration, /display_text/);
  assert.match(migration, /UNIQUE\(portfolio_id, briefing_type, source_version_hash, version\)/);
  assert.match(migration, /portfolio_briefing_events/);
});

test("deterministic provider creates a daily hold briefing with exact numbers and disclosure", async () => {
  const narrative = await new DeterministicBriefingNarrativeProvider().generate(facts({ recommendation: "Hold" }), { length: "standard", tone: "plain" });
  assert.match(narrative.displayText, /IRA closed at \$2401\.2500/);
  assert.match(narrative.displayText, /\$958\.5594 in cash/);
  assert.match(narrative.displayText, /Kairox recommendation: Hold/);
  assert.match(narrative.displayText, /paper simulation/i);
  assert.equal(validateBriefingNarrative(facts({ recommendation: "Hold" }), narrative).valid, true);
});

test("review-required, rebalance, risk-alert, and data-unavailable briefings preserve recommendation fidelity", async () => {
  for (const recommendation of ["Review required", "Rebalance", "Risk intervention", "Data unavailable"]) {
    const currentFacts = facts({ recommendation });
    const narrative = await new DeterministicBriefingNarrativeProvider().generate(currentFacts, { length: "compact" });
    assert.equal(narrative.recommendation, recommendation);
    assert.match(narrative.summary, new RegExp(recommendation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(validateBriefingNarrative(currentFacts, narrative).valid, true);
  }
});

test("validator rejects unsupported symbols, fabricated prices, fabricated market causes, and missing disclosure", () => {
  const base = facts({});
  assert.equal(validateBriefingNarrative(base, narrative("IRA update mentions NVDA without verified holdings. " + base.disclosure)).valid, false);
  assert.equal(validateBriefingNarrative(base, narrative("IRA closed at $9999.0000 with $1.0000 cash. " + base.disclosure)).valid, false);
  assert.equal(validateBriefingNarrative(base, narrative("IRA moved because of an earnings surprise. " + base.disclosure)).valid, false);
  assert.equal(validateBriefingNarrative(base, narrative("IRA closed at $2401.2500 with $958.5594 cash and 0.05% daily change.")).valid, false);
});

test("validator rejects prohibited performance claims and unsupported action verbs", () => {
  const base = facts({ recommendation: "Hold" });
  assert.equal(validateBriefingNarrative(base, narrative("Kairox will outperform and guarantees returns. " + base.disclosure)).valid, false);
  assert.equal(validateBriefingNarrative(base, narrative("Kairox says buy VTI today. IRA closed at $2401.2500 with $958.5594 cash and 0.05% daily change. " + base.disclosure)).valid, false);
});

test("AI provider failure and validation failure fallback paths are represented", async () => {
  await assert.rejects(() => new FailingBriefingNarrativeProvider().generate());
  assert.match(serviceSource, /fallbackProvider/);
  assert.match(serviceSource, /Fallback used/);
  assert.match(serviceSource, /validationErrors/);
});

test("prompt, facts schema, validation version, and provider abstraction are stored", () => {
  assert.match(serviceSource, /BriefingNarrativeProvider/);
  assert.match(serviceSource, /portfolio-briefing-facts-v1/);
  assert.match(serviceSource, /portfolio-briefing-template-v1/);
  assert.match(serviceSource, /portfolio-briefing-validation-v1/);
  assert.match(serviceSource, /modelIdentifier/);
});

test("briefing idempotency and regeneration audit history are implemented", () => {
  assert.match(serviceSource, /getExisting/);
  assert.match(serviceSource, /idempotent: true/);
  assert.match(serviceSource, /nextVersion/);
  assert.match(serviceSource, /regenerationReason/);
});

test("weekly, monthly, risk, hold, rebalance, and public progress types are supported", () => {
  assert.match(serviceSource, /weekly_summary/);
  assert.match(serviceSource, /monthly_report/);
  assert.match(serviceSource, /risk_alert/);
  assert.match(serviceSource, /rebalance_explanation/);
  assert.match(serviceSource, /hold_explanation/);
  assert.match(serviceSource, /public_progress/);
  assert.match(indexSource, /portfolio-briefings\/public-summary/);
});

test("public summary is privacy-safe", () => {
  assert.match(serviceSource, /publicSummary/);
  assert.match(serviceSource, /Paper simulation/);
  assert.match(serviceSource, /Conservative strategy/);
  assert.doesNotMatch(serviceSource, /mother|family ownership|retirement account owner|personal retirement/i);
});

test("dashboard and protected route integration are wired", () => {
  assert.match(indexSource, /"\/portfolio-briefings"/);
  assert.match(indexSource, /"\/portfolio-briefings\/run"/);
  assert.match(dashboardSource, /Daily Briefing/);
  assert.match(dashboardSource, /data-run-portfolio-briefing/);
  assert.match(dashboardSource, /Share-safe summary/);
  assert.match(managementSource, /PortfolioBriefingService/);
});

test("briefing layer cannot approve proposals, stage orders, create fills, or move cash", () => {
  assert.doesNotMatch(serviceSource, /approveAllocationProposal|stagePaperOrdersForProposal|executePaperOrderBatch/);
  assert.doesNotMatch(serviceSource, /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+(trades|paper_order_fills|paper_order_executions|paper_cash_ledger|orders|paper_order_batches|recommendation_proposals)\b/i);
  assert.doesNotMatch(serviceSource, /UPDATE\s+(portfolios|positions|trades|paper_order_batches|recommendation_proposals)\b/i);
});

function facts(overrides: Partial<PortfolioBriefingFacts> & { recommendation?: string } = {}): PortfolioBriefingFacts {
  return {
    factsSchemaVersion: "portfolio-briefing-facts-v1",
    portfolioId: "portfolio_ira",
    publicAccountName: "IRA",
    accountMode: "Paper",
    strategy: "Conservative strategy",
    briefingType: "daily_close",
    evaluationDate: "2026-07-14",
    sourceCycleId: "cycle_1",
    sourceDecisionId: "decision_1",
    sourceTimestamps: { decisionCreatedAt: "2026-07-14T21:00:00.000Z" },
    dataQualityStatus: "fresh",
    marketDataTimestamp: "2026-07-14T20:00:00.000Z",
    portfolioValueUsd: 2401.25,
    dailyChangeUsd: 1.25,
    dailyChangePct: 0.0005,
    returnSinceStartUsd: 1.25,
    returnSinceStartPct: 0.0005,
    cashUsd: 958.5594,
    cashPct: 0.3992,
    positions: [{ symbol: "VTI", valueUsd: 480, quantity: 1.29 }, { symbol: "SCHD", valueUsd: 480, quantity: 14.7 }, { symbol: "BND", valueUsd: 480, quantity: 6.6 }],
    largestPositiveContributor: null,
    largestNegativeContributor: null,
    currentAllocation: { cashPct: 0.4, equityPct: 0.4, bondPct: 0.2 },
    targetAllocation: { cashPct: 0.4, equityPct: 0.4, bondPct: 0.2 },
    policyStatus: "Within policy",
    policyFindings: [],
    currentDrawdownPct: 0.01,
    maximumDrawdownPct: 0.02,
    benchmarkContext: { evidenceLabel: "Preliminary", summary: "Comparison period is short.", bestReturnBenchmark: "Kairox", lowestDrawdownBenchmark: "Cash benchmark" },
    recommendation: overrides.recommendation ?? "Hold",
    recommendationStatus: "No action",
    urgency: "Low",
    decisionSummary: `${overrides.recommendation ?? "Hold"}: no action is recommended.`,
    triggeredRules: ["No policy violation is present."],
    supportingReasons: ["Cash is inside target range."],
    risks: [],
    dataLimitations: ["Position-level daily attribution is unavailable."],
    unavailableFacts: ["Position-level daily attribution is unavailable."],
    approvedComparisonStatements: ["Comparison period is short."],
    verifiedIntelligenceFacts: [],
    disclosure: "This is a Kairox IRA paper simulation, not live brokerage activity or financial advice. No brokerage order was placed by this briefing.",
    ...overrides
  };
}

function narrative(text: string): BriefingNarrative {
  return {
    headline: text,
    summary: text,
    displayText: text,
    keyChanges: [],
    recommendation: "Hold",
    supportingReasons: [],
    risks: [],
    benchmarkContext: {},
    dataLimitations: [],
    disclosure: text.includes("paper simulation") ? "This is a Kairox IRA paper simulation, not live brokerage activity or financial advice. No brokerage order was placed by this briefing." : ""
  };
}
