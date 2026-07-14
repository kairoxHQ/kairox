import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildCandidateSnapshot,
  compositeScore,
  rankProfiles,
  scoreModules,
  type SecurityResearchProfile
} from "../src/research/engine.ts";
import type { NormalizedQuote } from "../src/market/service.ts";

const migration = readFileSync("migrations/0032_portfolio_research_engine.sql", "utf8");
const serviceSource = readFileSync("src/research/engine.ts", "utf8");
const indexSource = readFileSync("src/index.ts", "utf8");
const dashboardSource = readFileSync("src/dashboard/service.ts", "utf8");

test("research migration stores profiles, history, watchlist, candidates, portfolio fit, and audit", () => {
  assert.match(migration, /security_research_profiles/);
  assert.match(migration, /security_research_score_history/);
  assert.match(migration, /security_research_watchlist/);
  assert.match(migration, /security_research_portfolio_fit/);
  assert.match(migration, /security_research_candidate_snapshots/);
  assert.match(migration, /security_research_audit_events/);
  assert.match(migration, /CHECK \(status IN \('Watching', 'Candidate', 'Owned', 'Rejected', 'Archived'\)\)/);
  assert.match(migration, /CHECK \(period_type IN \('daily', 'weekly', 'monthly'\)\)/);
});

test("scoring modules return normalized valuation, quality, growth, income, trend, momentum, risk, and diversification scores", () => {
  const scores = scoreModules({
    security: {
      symbol: "SCHD",
      companyOrFund: "Schwab U.S. Dividend Equity ETF",
      assetType: "etf",
      sector: "Dividend equity",
      industry: "Dividend or defensive equity",
      expenseRatio: 0.0006,
      dividendCapable: true,
      averageVolume: 3_000_000,
      volatility: 0.14,
      maximumDrawdown: 0.29,
      historicalReturn: 0.07,
      dividendYield: 0.035,
      tradable: true
    },
    quote: quote("SCHD", 32, 31.5),
    priceHistory: [29, 30, 31, 31.5, 32],
    volatility: 0.14
  });
  assert.deepEqual(Object.keys(scores).sort(), ["diversification", "growth", "income", "momentum", "quality", "risk", "technicalTrend", "valuation"]);
  for (const value of Object.values(scores)) {
    assert.ok(value >= 0 && value <= 100);
  }
  assert.ok(compositeScore(scores) >= 0);
});

test("rankings support overall, income, growth, quality, risk, and momentum views", () => {
  const profiles = sampleProfiles();
  assert.equal(rankProfiles(profiles, "overall")[0].symbol, "VTI");
  assert.equal(rankProfiles(profiles, "income")[0].symbol, "SCHD");
  assert.equal(rankProfiles(profiles, "growth")[0].symbol, "QQQ");
  assert.equal(rankProfiles(profiles, "quality")[0].symbol, "BND");
  assert.equal(rankProfiles(profiles, "risk")[0].symbol, "BND");
  assert.equal(rankProfiles(profiles, "momentum")[0].symbol, "QQQ");
});

test("candidate engine creates top lists for broad market, dividends, bonds, defensive, and growth", () => {
  const snapshot = buildCandidateSnapshot("portfolio_ira", "2026-07-14", sampleProfiles());
  assert.equal(snapshot.topCandidates.length, 4);
  assert.equal(snapshot.topDividendEtfs[0].symbol, "SCHD");
  assert.equal(snapshot.topBroadMarketEtfs.some((item) => item.symbol === "VTI"), true);
  assert.equal(snapshot.topBondEtfs[0].symbol, "BND");
  assert.equal(snapshot.topDefensivePositions.some((item) => item.symbol === "BND"), true);
  assert.equal(snapshot.topGrowthPositions[0].symbol, "QQQ");
});

test("research explanations and score-change history are explicit", () => {
  assert.match(serviceSource, /scoreChange/);
  assert.match(serviceSource, /rankReason/);
  assert.match(serviceSource, /strengths/);
  assert.match(serviceSource, /weaknesses/);
  assert.match(serviceSource, /mainRisks/);
  assert.match(serviceSource, /periods = \[/);
  assert.match(serviceSource, /"daily"/);
  assert.match(serviceSource, /"weekly"/);
  assert.match(serviceSource, /"monthly"/);
});

test("research endpoints, scheduler, and dashboard center are wired", () => {
  assert.match(indexSource, /"\/research"/);
  assert.match(indexSource, /"\/research\/run"/);
  assert.match(indexSource, /"\/research\/rankings"/);
  assert.match(indexSource, /runScheduledResearch/);
  assert.match(dashboardSource, /Research Center/);
  assert.match(dashboardSource, /data-run-research/);
  assert.match(dashboardSource, /Top 10 candidates/);
  assert.match(dashboardSource, /Research only/);
});

test("research engine is research-only and cannot mutate trading records", () => {
  assert.doesNotMatch(serviceSource, /executePaperOrderBatch|stagePaperOrdersForProposal|approveAllocationProposal|createDraftFromReview/);
  assert.doesNotMatch(serviceSource, /from "\.\.\/orders\/(?:staging|execution)\.ts"/);
  assert.doesNotMatch(serviceSource, /\bUPDATE\s+(?:portfolios|positions|orders|trades)\b/i);
  assert.doesNotMatch(serviceSource, /\bINSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+(?:positions|orders|trades|paper_order_fills|paper_cash_ledger|paper_order_executions)\b/i);
  assert.match(serviceSource, /Research only; no proposals, orders, trades, fills, or cash changes/);
});

function sampleProfiles(): SecurityResearchProfile[] {
  return [
    profile("VTI", "Vanguard Total Stock Market ETF", "etf", "Broad U.S. equity", { overall: 82, income: 40, growth: 74, quality: 82, risk: 72, momentum: 68 }),
    profile("SCHD", "Schwab U.S. Dividend Equity ETF", "etf", "Dividend or defensive equity", { overall: 80, income: 88, growth: 62, quality: 78, risk: 76, momentum: 60 }),
    profile("BND", "Vanguard Total Bond Market ETF", "bond_fund", "Investment-grade bonds", { overall: 76, income: 70, growth: 35, quality: 90, risk: 92, momentum: 55 }),
    profile("QQQ", "Invesco QQQ Trust", "etf", "Growth equity", { overall: 78, income: 20, growth: 91, quality: 74, risk: 48, momentum: 90 })
  ];
}

function profile(symbol: string, companyOrFund: string, assetType: string, industry: string, scores: { overall: number; income: number; growth: number; quality: number; risk: number; momentum: number }): SecurityResearchProfile {
  return {
    symbol,
    companyOrFund,
    assetType,
    sector: industry,
    industry,
    marketCapUsd: null,
    dividendYield: scores.income / 2000,
    expenseRatio: 0.001,
    fiftyTwoWeekHigh: 100,
    fiftyTwoWeekLow: 80,
    beta: 1,
    averageVolume: 1_000_000,
    volatility: 0.1,
    priceHistory: [80, 85, 90],
    scores: {
      valuation: 60,
      quality: scores.quality,
      growth: scores.growth,
      income: scores.income,
      technicalTrend: 60,
      momentum: scores.momentum,
      risk: scores.risk,
      diversification: 70,
      research: scores.overall
    },
    overallKairoxScore: scores.overall,
    explanation: { scoreChange: "changed", rankReason: "ranked", strengths: [], weaknesses: [], mainRisks: [], moduleExplanations: {} },
    dataQualityStatus: "Valid",
    latestMarketDataSnapshotId: "mdsnap",
    lastScoredAt: "2026-07-14T16:00:00.000Z"
  };
}

function quote(symbol: string, lastPrice: number, previousClose: number): NormalizedQuote {
  return {
    symbol,
    securityName: symbol,
    assetType: "etf",
    exchange: "NYSE",
    currency: "USD",
    bid: lastPrice - 0.01,
    ask: lastPrice + 0.01,
    lastPrice,
    previousClose,
    marketSession: "regular",
    providerTimestamp: "2026-07-14T16:00:00.000Z",
    receivedTimestamp: "2026-07-14T16:00:10.000Z",
    providerName: "test",
    dataQualityStatus: "Valid",
    source: "primary",
    cached: false,
    warnings: [],
    validation: { valid: true, status: "Valid", reasons: [], warnings: [] },
    candles: [],
    volume: 1000000
  };
}
