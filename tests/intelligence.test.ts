import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import worker from "../src/index.ts";
import { renderDashboardHtml } from "../src/dashboard/service.ts";
import { calculateEvidenceScore, INTELLIGENCE_CATEGORIES, validateIntelligenceEvent } from "../src/intelligence/service.ts";

test("intelligence event validation rejects unsupported categories and bad scores", () => {
  const result = validateIntelligenceEvent({
    title: "",
    summary: "Missing category support.",
    category: "Rumor",
    sourceReliability: 1.2,
    verificationCount: -1,
    severity: 0.5,
    marketImpact: 0.5,
    freshness: 0.5
  });

  assert.equal(result.valid, false);
  assert.match(result.reasons.join(" "), /Title is required/);
  assert.match(result.reasons.join(" "), /Category is not supported/);
  assert.match(result.reasons.join(" "), /source reliability/);
});

test("intelligence category mapping includes Sprint 7 categories", () => {
  for (const category of [
    "Economic",
    "Monetary Policy",
    "Corporate",
    "Earnings",
    "Dividend",
    "Commodity",
    "Energy",
    "Geopolitical",
    "Regulatory",
    "Supply Chain",
    "Technology",
    "Healthcare",
    "Financial",
    "Natural Disaster"
  ]) {
    assert.ok(INTELLIGENCE_CATEGORIES.includes(category as never), `${category} missing`);
  }
});

test("source reliability and relationship mappings are stored in migration fixtures", () => {
  const sql = readFileSync("migrations/0010_intelligence_engine_phase1.sql", "utf8");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS event_sources/);
  assert.match(sql, /reliability_score/);
  assert.match(sql, /source_federal_reserve/);
  assert.match(sql, /source_anonymous_social_media/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS intelligence_relationships/);
  assert.match(sql, /rel_oil_energy/);
  assert.match(sql, /rel_semiconductor_demand_chip_manufacturers/);
});

test("evidence scoring is deterministic and bounded", () => {
  const score = calculateEvidenceScore({
    sourceReliability: 0.9,
    verificationCount: 2,
    severity: 0.6,
    marketImpact: 0.5,
    freshness: 0.8
  });

  assert.equal(score, 0.7033);
  assert.equal(calculateEvidenceScore({ sourceReliability: 2, verificationCount: 9, severity: -1, marketImpact: 0.5, freshness: 0.5 }), 0.65);
});

test("sample intelligence fixtures are clearly marked and do not fabricate current news", () => {
  const sql = readFileSync("migrations/0010_intelligence_engine_phase1.sql", "utf8");

  assert.match(sql, /Sample Fixture:/);
  assert.match(sql, /This is not current news/);
  assert.match(sql, /sample_data/);
  assert.doesNotMatch(sql, /BUY recommendation|SELL recommendation/i);
});

test("intelligence endpoints are public read routes", async () => {
  const env = { DB: {} as D1Database, APP_MODE: "paper", LIVE_TRADING_ENABLED: "false", STARTING_BALANCE_USD: "20", BENCHMARK_ASSET: "BTC" };
  for (const path of ["/intelligence", "/intelligence/today", "/intelligence/events", "/intelligence/categories", "/market-story"]) {
    const response = await worker.fetch(new Request(`https://kairox.test${path}`, { method: "POST" }), env);
    assert.equal(response.status, 405, path);
  }
});

test("dashboard renders intelligence section without raw technical errors", () => {
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
    rejectedOpportunities: [],
    intelligence: {
      story: {
        title: "Today's Market Story",
        overallOutlook: "Neutral",
        keyEvents: [{ title: "Sample Fixture: Event", category: "Technology", evidenceScore: 0.61, sampleData: true }],
        importantThemes: ["Technology"],
        potentialRisks: ["Rate sensitivity"],
        opportunitiesBeingMonitored: ["QQQ"],
        noRecommendations: true,
        sampleDataNotice: "Includes deterministic sample fixtures for development and testing."
      },
      categories: { categories: [{ name: "Technology", enabled: true }] },
      recentEvents: [{
        title: "Sample Fixture: Event",
        category: "Technology",
        evidenceScore: 0.61,
        affectedSymbols: ["QQQ"],
        affectedAssetClasses: ["etf"],
        sampleData: true,
        summary: "Illegal invocation: raw provider diagnostic"
      }]
    }
  });

  assert.match(html, /Intelligence/);
  assert.match(html, /Today&#39;s Market Story/);
  assert.match(html, /61\.0% evidence/);
  assert.doesNotMatch(html, /Illegal invocation/);
});
