import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import worker from "../src/index.ts";
import { renderDashboardHtml } from "../src/dashboard/service.ts";
import {
  canUseAsBriefingFact,
  calculateAttribution,
  calculateMaterialityScore,
  FailingMarketIntelligenceProvider,
  IntelligenceVerificationService,
  PrimarySourceSeedIntelligenceProvider,
  scoreRelevance,
  type HoldingContext,
  type ProviderIntelligenceRecord,
  type VerifiedIntelligenceRecord
} from "../src/intelligence/verifiedPipeline.ts";

const migration = readFileSync("migrations/0029_verified_market_intelligence.sql", "utf8");
const serviceSource = readFileSync("src/intelligence/verifiedPipeline.ts", "utf8");
const dashboardSource = readFileSync("src/dashboard/service.ts", "utf8");
const indexSource = readFileSync("src/index.ts", "utf8");
const briefingSource = readFileSync("src/briefings/portfolioBriefing.ts", "utf8");
const managementSource = readFileSync("src/management/dailyCycle.ts", "utf8");

test("migration stores normalized intelligence, portfolio links, summaries, provider health, and audit history", () => {
  assert.match(migration, /verified_intelligence_records/);
  assert.match(migration, /provider_record_id/);
  assert.match(migration, /duplicate_group_id/);
  assert.match(migration, /correction_status/);
  assert.match(migration, /portfolio_intelligence_links/);
  assert.match(migration, /portfolio_intelligence_summaries/);
  assert.match(migration, /market_intelligence_provider_health/);
  assert.match(migration, /market_intelligence_audit_events/);
});

test("provider abstraction includes news, corporate, economic, dividend, and verification interfaces", () => {
  assert.match(serviceSource, /MarketIntelligenceProvider/);
  assert.match(serviceSource, /MarketNewsProvider/);
  assert.match(serviceSource, /CorporateEventsProvider/);
  assert.match(serviceSource, /EconomicCalendarProvider/);
  assert.match(serviceSource, /DividendEventsProvider/);
  assert.match(serviceSource, /IntelligenceVerificationService/);
});

test("primary-source and trusted verification rules gate briefing facts", () => {
  const verifier = new IntelligenceVerificationService();
  assert.equal(verifier.verificationStatus(record({ sourceKind: "primary" })), "Primary-source verified");
  assert.equal(verifier.verificationStatus(record({ sourceKind: "single_trusted" })), "Single-source verified");
  assert.equal(verifier.verificationStatus(record({ sourceKind: "trusted_confirmed" })), "Multi-source verified");
  assert.equal(verifier.verificationStatus(record({ sourceKind: "conflicting" })), "Conflicting");
  assert.equal(verifier.verificationStatus(record({ sourceKind: "unsupported" })), "Unsupported");
  assert.equal(canUseAsBriefingFact({ verificationStatus: "Primary-source verified" }), true);
  assert.equal(canUseAsBriefingFact({ verificationStatus: "Multi-source verified" }), true);
  assert.equal(canUseAsBriefingFact({ verificationStatus: "Single-source verified" }), false);
  assert.equal(canUseAsBriefingFact({ verificationStatus: "Conflicting" }), false);
});

test("corrections and retractions are append-only statuses", () => {
  const verifier = new IntelligenceVerificationService();
  assert.equal(verifier.verificationStatus(record({ correctionStatus: "Correction" })), "Corrected");
  assert.equal(verifier.verificationStatus(record({ correctionStatus: "Retracted" })), "Retracted");
  assert.match(migration, /Never overwrite|correction_status|superseding_record_id/i);
});

test("deduplication uses provider record, event type, symbol, date, and fingerprint", () => {
  assert.match(serviceSource, /provider_name = \? AND provider_record_id = \?/);
  assert.match(serviceSource, /dedupeGroup/);
  assert.match(serviceSource, /eventType/);
  assert.match(serviceSource, /relatedSymbols/);
  assert.match(serviceSource, /fingerprint/);
});

test("materiality and symbol relevance score direct holdings higher than macro context", () => {
  const holdings = iraHoldings();
  const directScore = calculateMaterialityScore(record({ relatedSymbols: ["BND"], eventType: "ETF distribution schedule", severity: 0.7 }), holdings);
  const macroScore = calculateMaterialityScore(record({ relatedSymbols: ["SPY"], eventCategory: "Economic", eventType: "CPI", severity: 0.45 }), holdings);
  assert.ok(directScore > macroScore);
  const relevance = scoreRelevance(verified(record({ relatedSymbols: ["BND"], eventType: "ETF distribution schedule", severity: 0.7 }), directScore), holdings);
  assert.equal(relevance.classification, "Direct holding impact");
  assert.deepEqual(relevance.relatedHoldings, ["BND"]);
});

test("asset-class and macro relevance do not treat every headline as relevant", () => {
  const holdings = iraHoldings();
  assert.equal(scoreRelevance(verified(record({ relatedSymbols: ["XYZ"], eventCategory: "Market" }), 0.4), holdings).classification, "Macro relevance");
  assert.equal(scoreRelevance(verified(record({ relatedSymbols: ["XYZ"], eventCategory: "Corporate" }), 0.2), holdings).classification, "Not relevant");
});

test("attribution distinguishes unavailable, possible, and stronger association without proving causation", () => {
  assert.equal(calculateAttribution(record({ rawReference: {} }), 0.5).status, "No verified attribution");
  assert.equal(calculateAttribution(record({ rawReference: { priceMovePct: 0.004 } }), 0.4).status, "Possible association");
  const strong = calculateAttribution(record({ rawReference: { priceMovePct: -0.03, priceWindow: "same trading day" } }), 0.8);
  assert.equal(strong.status, "Strongly associated");
  assert.match(strong.explanation, /not proof of causation/);
});

test("initial primary-source provider prioritizes IRA holdings and macro calendars", async () => {
  const records = await new PrimarySourceSeedIntelligenceProvider().fetchRecords({ portfolioId: "portfolio_ira", holdings: iraHoldings(), now: new Date("2026-07-14T21:00:00.000Z") });
  assert.ok(records.some((item) => item.relatedSymbols.includes("VTI")));
  assert.ok(records.some((item) => item.relatedSymbols.includes("SCHD")));
  assert.ok(records.some((item) => item.relatedSymbols.includes("BND")));
  assert.ok(records.some((item) => item.sourceUrl?.includes("federalreserve.gov")));
  assert.ok(records.every((item) => item.sourceKind === "primary"));
  assert.ok(records.every((item) => !String(item.rawReference.redistributedFullText).includes("true")));
});

test("provider outage fallback and health paths are represented", async () => {
  await assert.rejects(() => new FailingMarketIntelligenceProvider().fetchRecords({ portfolioId: "portfolio_ira", holdings: [], now: new Date() }));
  assert.match(serviceSource, /provider_failure/);
  assert.match(serviceSource, /outage_status/);
  assert.match(serviceSource, /degraded/);
});

test("upcoming events, alerts, data freshness, and alert deduplication are represented", () => {
  assert.match(serviceSource, /upcomingEvents/);
  assert.match(serviceSource, /alertSeverity/);
  assert.match(serviceSource, /Data conflict/);
  assert.match(serviceSource, /Corporate-action required/);
  assert.match(migration, /UNIQUE\(portfolio_id, intelligence_record_id\)/);
  assert.match(migration, /data_freshness/);
});

test("briefing integration uses verified facts and rejects unverified attribution claims", () => {
  assert.match(briefingSource, /verifiedIntelligenceFacts/);
  assert.match(briefingSource, /canUseAsBriefingFact/);
  assert.match(briefingSource, /No primary-source or multi-source verified/);
  assert.match(briefingSource, /does not yet have enough verified information/);
});

test("decision-engine boundaries remain intact and intelligence cannot trade", () => {
  assert.doesNotMatch(serviceSource, /approveAllocationProposal|stagePaperOrdersForProposal|executePaperOrderBatch|executePaperOrders|createDraftFromReview/);
  assert.doesNotMatch(serviceSource, /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+(trades|paper_order_fills|paper_cash_ledger|positions|recommendation_proposals|paper_order_batches)\b/i);
  assert.doesNotMatch(serviceSource, /UPDATE\s+(portfolios|positions|trades|paper_order_batches|recommendation_proposals)\b/i);
});

test("routes, scheduler, and protected action are wired", async () => {
  const env = { DB: {} as D1Database, APP_MODE: "paper", LIVE_TRADING_ENABLED: "false", STARTING_BALANCE_USD: "20", BENCHMARK_ASSET: "BTC" };
  for (const path of ["/market-intelligence", "/market-intelligence/provider-health"]) {
    const response = await worker.fetch(new Request(`https://kairox.test${path}`, { method: "POST" }), env);
    assert.equal(response.status, 405, path);
  }
  assert.match(indexSource, /"\/market-intelligence\/run"/);
  assert.match(indexSource, /runScheduledMarketIntelligence/);
  assert.match(managementSource, /VerifiedMarketIntelligenceService/);
});

test("dashboard exposes verified intelligence without unrelated news or secrets", () => {
  const html = renderDashboardHtml({
    settings: { automationPaused: false },
    performance: { totalValueUsd: 2400, cashUsd: 958, totalReturnUsd: 0, priceReturnUsd: 0, dividendReturnUsd: 0, tradeCount: 0, maxDrawdownPct: 0, benchmarkReturns: [] },
    positions: [],
    recommendations: [],
    journal: [],
    trades: [],
    scheduledRuns: [],
    summaries: [],
    rejectedOpportunities: [],
    intelligence: {
      story: { title: "Today's Market Story", overallOutlook: "Neutral", keyEvents: [], importantThemes: [], potentialRisks: [], opportunitiesBeingMonitored: [], noRecommendations: true },
      categories: { categories: [] },
      recentEvents: []
    },
    verifiedIntelligence: {
      links: [{
        record: verified(record({ relatedSymbols: ["BND"], headline: "BND distribution schedule", summary: "BND has verified fund-sponsor distribution context." }), 0.62),
        relevanceClassification: "Direct holding impact",
        relevanceScore: 0.8,
        alertSeverity: "Monitor",
        relatedHoldings: ["BND"],
        rationale: "Verified ETF distribution schedule is directly related to BND."
      }],
      summary: { id: "summary", portfolioId: "portfolio_ira", cycleId: null, summaryDate: "2026-07-14", intelligenceVersionHash: "abc", mostMaterialRecordId: "intel", holdingsAffected: ["BND"], marketWideEvents: [], upcomingEvents: ["BND distribution schedule"], unexplainedMovements: [], dataGaps: ["Attribution unavailable"], verificationQuality: "Primary-source verified facts available", intelligenceTimestamp: "2026-07-14T21:00:00.000Z" },
      providerHealth: [{ provider_name: "Kairox primary-source seed", outage_status: "operational", data_freshness: "current", last_success_at: "2026-07-14T21:00:00.000Z" }]
    }
  });
  assert.match(html, /Verified Market Intelligence/);
  assert.match(html, /BND distribution schedule/);
  assert.match(html, /No recommendations/);
  assert.doesNotMatch(html, /PAPER_RUN_SECRET|API_KEY|full article/i);
});

test("privacy-safe sharing and licensing limits are explicit", () => {
  assert.match(serviceSource, /Stores Kairox-generated factual summary and source reference only/);
  assert.match(serviceSource, /redistributedFullText/);
  assert.doesNotMatch(serviceSource, /personal ownership|mother|private owner/i);
});

function iraHoldings(): HoldingContext[] {
  return [
    { symbol: "VTI", assetClass: "etf", quantity: 1.29, marketValueUsd: 480, portfolioWeight: 0.2 },
    { symbol: "SCHD", assetClass: "etf", quantity: 14.7, marketValueUsd: 480, portfolioWeight: 0.2 },
    { symbol: "BND", assetClass: "bond_fund", quantity: 6.6, marketValueUsd: 480, portfolioWeight: 0.2 }
  ];
}

function record(overrides: Partial<ProviderIntelligenceRecord> = {}): ProviderIntelligenceRecord {
  return {
    providerRecordId: "provider_record_1",
    eventCategory: "Fund",
    eventType: "ETF distribution schedule",
    headline: "Verified fund event",
    summary: "A verified fund event is available as factual context only.",
    relatedSymbols: ["BND"],
    relatedAssetCategories: ["Investment-grade bonds"],
    eventDate: "2026-07-14",
    publishedAt: "2026-07-14T12:00:00.000Z",
    effectiveAt: "2026-07-14T12:00:00.000Z",
    sourceTimestamp: "2026-07-14T12:00:00.000Z",
    sourceUrl: "https://example.com/source",
    sourceKind: "primary",
    confidenceClassification: "High",
    severity: 0.5,
    licenseAttribution: "Kairox-generated summary and source reference only.",
    rawReference: { sourceCount: 1, redistributedFullText: false },
    correctionStatus: "Original",
    ...overrides
  };
}

function verified(input: ProviderIntelligenceRecord, materialityScore: number): VerifiedIntelligenceRecord {
  return {
    ...input,
    id: "intel_verified",
    providerName: "Kairox primary-source seed",
    providerType: "primary_source",
    verifiedSummary: input.summary,
    verificationStatus: input.sourceKind === "primary" ? "Primary-source verified" : "Single-source verified",
    materialityClassification: materialityScore >= 0.55 ? "High" : "Medium",
    materialityScore,
    duplicateGroupId: "dedupe",
    attribution: calculateAttribution(input, materialityScore),
    ingestedAt: "2026-07-14T21:00:00.000Z"
  };
}
