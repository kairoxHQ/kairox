import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  STRATEGY_ENGINE_VERSION,
  analyzePortfolio,
  generateDecisions,
  scoreUniverse,
  type StrategyVersion,
  type UniverseSecurity
} from "../src/strategy/engine.ts";
import type { InvestmentPolicy } from "../src/policies/investmentPolicy.ts";
import type { MarketDataSnapshot, NormalizedQuote } from "../src/market/service.ts";

const strategySource = readFileSync("src/strategy/engine.ts", "utf8");
const proposalSource = readFileSync("src/recommendations/proposalService.ts", "utf8");
const migration = readFileSync("migrations/0021_strategy_engine.sql", "utf8");
const dashboardSource = readFileSync("src/dashboard/service.ts", "utf8");
const indexSource = readFileSync("src/index.ts", "utf8");

test("cash-only conservative portfolio prefers a diversifying buy when category is underweight", async () => {
  const run = await analyzeScenario({ cashUsd: 2400, positions: [] });
  const buy = run.decisions.find((decision) => decision.action === "Buy");
  assert.ok(buy);
  assert.ok(["VTI", "VOO", "SPY", "SCHD", "BND"].includes(buy?.symbol ?? ""));
  assert.equal(buy?.strategyVersion, "1.0.0");
  assert.match(buy?.explanation ?? "", /analysis only/i);
});

test("fully allocated compliant portfolio can hold without churn", async () => {
  const run = await analyzeScenario({
    cashUsd: 960,
    positions: [
      position("VTI", "etf", 480),
      position("SCHD", "etf", 480),
      position("BND", "bond_fund", 480)
    ]
  });
  assert.equal(run.decisions.some((decision) => ["Sell", "Trim"].includes(decision.action)), false);
  assert.equal(run.analysis.policyWarnings.length, 0);
});

test("underweight equity and underweight bonds produce portfolio-aware decisions", async () => {
  const equity = await analyzeScenario({ cashUsd: 2100, positions: [position("BND", "bond_fund", 300)] });
  const bonds = await analyzeScenario({ cashUsd: 1800, positions: [position("VTI", "etf", 300)] });
  assert.equal(equity.decisions.some((decision) => decision.action === "Buy"), true);
  assert.equal(bonds.decisions.some((decision) => decision.action === "Buy"), true);
});

test("excessive single-position concentration and sector concentration trigger risk reduction", async () => {
  const run = await analyzeScenario({ cashUsd: 600, positions: [position("VTI", "etf", 1800)] });
  assert.equal(run.analysis.policyWarnings.some((warning) => /single-position|sector/i.test(warning)), true);
  assert.equal(run.decisions.some((decision) => decision.action === "Trim"), true);
});

test("minimum cash violation is detected by stricter strategy and account policy", async () => {
  const run = await analyzeScenario({
    cashUsd: 100,
    positions: [position("VTI", "etf", 700), position("SCHD", "etf", 700), position("BND", "bond_fund", 900)]
  });
  assert.equal(run.analysis.policyWarnings.some((warning) => /Cash reserve/i.test(warning)), true);
});

test("ineligible, unknown, stale, and conflicting securities are excluded or low confidence", async () => {
  const run = await analyzeScenario({
    cashUsd: 2400,
    positions: [],
    quotes: {
      "BTC-USD": quote("BTC-USD", "crypto", "Valid"),
      TQQQ: quote("TQQQ", "leveraged_etf", "Valid"),
      MYSTERY: quote("MYSTERY", "unknown", "Valid"),
      VTI: quote("VTI", "etf", "Conflicting"),
      BND: quote("BND", "bond_fund", "Stale")
    },
    universe: [...universe(), security("MYSTERY", "unknown", "Broad U.S. equity")]
  });
  const excluded = run.scores.filter((score) => !score.eligibility.allowed).map((score) => score.symbol);
  assert.ok(excluded.includes("BTC-USD"));
  assert.ok(excluded.includes("TQQQ"));
  assert.ok(excluded.includes("MYSTERY"));
  assert.equal(run.scores.find((score) => score.symbol === "VTI")?.quoteStatus, "Conflicting");
  assert.ok((run.scores.find((score) => score.symbol === "BND")?.confidenceScore ?? 1) < 0.75);
});

test("low-confidence candidates are not bought while high-scoring candidates can be selected", async () => {
  const low = await analyzeScenario({ cashUsd: 2400, positions: [], quotes: { VTI: quote("VTI", "etf", "Stale") } });
  const high = await analyzeScenario({ cashUsd: 2400, positions: [] });
  assert.equal(low.decisions.some((decision) => decision.action === "Buy" && decision.symbol === "VTI"), false);
  assert.equal(high.decisions.some((decision) => decision.action === "Buy"), true);
});

test("correlated candidate is ranked behind a diversifying underweight candidate", async () => {
  const run = await analyzeScenario({ cashUsd: 1800, positions: [position("VOO", "etf", 300), position("VTI", "etf", 300)] });
  const bnd = run.scores.find((score) => score.symbol === "BND");
  const spy = run.scores.find((score) => score.symbol === "SPY");
  assert.ok((bnd?.investmentScore ?? 0) > (spy?.investmentScore ?? 0));
});

test("minimum trade threshold and maximum turnover prevent insignificant proposals", async () => {
  const custom = strategy({ thresholds: { minimumTradeValueUsd: 1000, maximumTurnoverPct: 0.01 } });
  const run = await analyzeScenario({ cashUsd: 2400, positions: [], strategy: custom });
  assert.equal(run.decisions.some((decision) => decision.action === "Buy"), false);
});

test("short-term decline does not automatically cause a sell, but policy violation can", async () => {
  const decline = await analyzeScenario({ cashUsd: 960, positions: [position("VTI", "etf", 480)], quotes: { VTI: quote("VTI", "etf", "Valid", 90, 100) } });
  const violation = await analyzeScenario({ cashUsd: 2100, positions: [position("BTC-USD", "crypto", 300)] });
  assert.equal(decline.decisions.some((decision) => decision.action === "Sell"), false);
  assert.equal(violation.decisions.some((decision) => decision.symbol === "BTC-USD" && decision.action === "Sell"), true);
});

test("repeat analysis with identical inputs is deterministic and preserves strategy version", async () => {
  const first = await analyzeScenario({ cashUsd: 2400, positions: [] });
  const second = await analyzeScenario({ cashUsd: 2400, positions: [] });
  assert.deepEqual(second.decisions, first.decisions);
  assert.equal(first.decisions.every((decision) => decision.strategyVersion === "1.0.0"), true);
  assert.equal(STRATEGY_ENGINE_VERSION, "strategy-engine-v1");
});

test("migration stores versioned strategy, configurable universe, immutable runs, and audit events", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS strategy_versions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS strategy_universe_securities/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS strategy_decision_runs/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS strategy_run_events/);
  assert.match(migration, /strategy_conservative_retirement_v1/);
  assert.match(migration, /ALTER TABLE daily_portfolio_reviews ADD COLUMN strategy_run_id/);
  assert.match(migration, /ALTER TABLE recommendation_proposals ADD COLUMN strategy_run_id/);
});

test("protected workflow is analysis only and proposal bridge uses strategy outputs", () => {
  assert.match(indexSource, /"\/strategy\/run"/);
  assert.match(indexSource, /authorize\(request, env\)/);
  assert.match(dashboardSource, /data-run-strategy-analysis/);
  assert.match(proposalSource, /strategyRun\.finalDecisions/);
  assert.doesNotMatch(strategySource, /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+(orders|trades|paper_order_fills|paper_order_executions|paper_cash_ledger|recommendation_proposals)\b/i);
  assert.doesNotMatch(strategySource, /UPDATE\s+(portfolios|positions)\b/i);
});

async function analyzeScenario(overrides: {
  cashUsd: number;
  positions: Array<{ symbol: string; assetClass: "etf" | "bond_fund" | "crypto"; marketValueUsd: number }>;
  strategy?: StrategyVersion;
  universe?: UniverseSecurity[];
  quotes?: Record<string, NormalizedQuote>;
}) {
  const activeStrategy = overrides.strategy ?? strategy();
  const candidates = overrides.universe ?? universe();
  const portfolio = { id: "portfolio_ira", mode: "paper", cashUsd: overrides.cashUsd, startingBalanceUsd: 2400 };
  const positions = overrides.positions.map((item) => position(item.symbol, item.assetClass, item.marketValueUsd));
  const totalValueUsd = overrides.cashUsd + positions.reduce((sum, item) => sum + item.marketValueUsd, 0);
  const analysis = analyzePortfolio({ policy, strategy: activeStrategy, portfolio, positions, universe: candidates, totalValueUsd });
  const snapshot = snapshotFor(candidates, overrides.quotes);
  const scores = await scoreUniverse({ strategy: activeStrategy, policy, universe: candidates, positions, snapshot, portfolioAnalysis: analysis, totalValueUsd });
  const decisions = generateDecisions({ strategy: activeStrategy, portfolio, policy, positions, scores, portfolioAnalysis: analysis, totalValueUsd });
  return { analysis, scores, decisions };
}

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

function strategy(overrides: { thresholds?: Partial<StrategyVersion["thresholds"]> } = {}): StrategyVersion {
  return {
    id: "strategy_conservative_retirement_v1",
    strategyName: "Conservative Retirement",
    strategyVersion: "1.0.0",
    objective: "Capital preservation, diversification, income, and moderate long-term growth.",
    status: "active",
    supportedRiskProfiles: ["Conservative"],
    rules: { prohibited: ["crypto", "leveraged_etf", "inverse_etf", "unknown"] },
    weights: { policyEligibility: 0.2, dataQuality: 0.15, allocationNeed: 0.16, diversificationBenefit: 0.12, volatility: 0.1, maximumDrawdown: 0.1, yield: 0.06, expenseRatio: 0.06, liquidity: 0.03, spread: 0.02 },
    thresholds: { minimumBuyScore: 70, minimumConfidence: 0.7, minimumTradeValueUsd: 25, minimumPortfolioImprovement: 0.02, maximumTurnoverPct: 0.15, rebalanceDriftThresholdPct: 0.05, trimThresholdPct: 0.02, sellThreshold: 0.65, cooldownDays: 7, minimumScoreChange: 8, minimumAllocationChangePct: 0.02, ...overrides.thresholds },
    allocationRanges: {
      "Broad U.S. equity": { min: 0.2, target: 0.25, max: 0.4 },
      "Dividend or defensive equity": { min: 0.1, target: 0.15, max: 0.25 },
      "Investment-grade bonds": { min: 0.2, target: 0.25, max: 0.4 },
      "Short-term Treasuries or cash equivalents": { min: 0, target: 0.1, max: 0.2 },
      "Cash reserve": { min: 0.1, target: 0.25, max: 0.4 }
    },
    changeNotes: "Initial test strategy.",
    createdAt: "2026-07-14T00:00:00.000Z"
  };
}

function universe(): UniverseSecurity[] {
  return [
    security("VTI", "etf", "Broad U.S. equity", { volatility: 0.17, maximumDrawdown: 0.34, dividendYield: 0.012, expenseRatio: 0.0003 }),
    security("VOO", "etf", "Broad U.S. equity", { volatility: 0.16, maximumDrawdown: 0.33, dividendYield: 0.013, expenseRatio: 0.0003 }),
    security("SPY", "etf", "Broad U.S. equity", { volatility: 0.16, maximumDrawdown: 0.33, dividendYield: 0.013, expenseRatio: 0.000945 }),
    security("SCHD", "etf", "Dividend or defensive equity", { volatility: 0.14, maximumDrawdown: 0.29, dividendYield: 0.035, expenseRatio: 0.0006 }),
    security("BND", "bond_fund", "Investment-grade bonds", { volatility: 0.06, maximumDrawdown: 0.16, dividendYield: 0.034, expenseRatio: 0.0003 }),
    security("BTC-USD", "crypto", "Cryptocurrency", { eligibilityStatus: "ineligible", exclusionReason: "Cryptocurrency is prohibited." }),
    security("TQQQ", "etf", "Leveraged ETF", { eligibilityStatus: "ineligible", exclusionReason: "Leveraged ETFs are prohibited.", volatility: 0.75, maximumDrawdown: 0.9 })
  ];
}

function security(symbol: string, assetType: string, assetCategory: string, overrides: Partial<UniverseSecurity> = {}): UniverseSecurity {
  return {
    symbol,
    securityName: symbol,
    assetType,
    assetCategory,
    sector: assetCategory,
    expenseRatio: 0.001,
    averageVolume: 2_000_000,
    bidAskSpread: 0.0005,
    dividendYield: 0.02,
    duration: null,
    creditQuality: null,
    volatility: 0.12,
    maximumDrawdown: 0.25,
    historicalReturn: 0.05,
    dataQualityStatus: "configured",
    eligibilityStatus: "pending",
    exclusionReason: null,
    ...overrides
  };
}

function position(symbol: string, assetClass: "etf" | "bond_fund" | "crypto", marketValueUsd: number) {
  return { symbol, assetClass, quantity: marketValueUsd / 100, avgEntryPriceUsd: 100, currentPriceUsd: 100, marketValueUsd };
}

function snapshotFor(candidates: UniverseSecurity[], overrides: Record<string, NormalizedQuote> = {}): MarketDataSnapshot {
  const quotes = new Map<string, NormalizedQuote>();
  for (const item of candidates) {
    quotes.set(item.symbol, overrides[item.symbol] ?? quote(item.symbol, item.assetType));
  }
  return { id: "mdsnap_test", useCase: "proposal", createdAt: "2026-07-14T00:00:00.000Z", quotes };
}

function quote(symbol: string, assetType: string, status: NormalizedQuote["dataQualityStatus"] = "Valid", price = 100, previousClose = 99): NormalizedQuote {
  const valid = status === "Valid" || status === "Previous Close" || status === "Delayed";
  return {
    symbol,
    securityName: symbol,
    assetType: assetType as never,
    exchange: "US",
    currency: "USD",
    bid: null,
    ask: null,
    lastPrice: price,
    previousClose,
    marketSession: "closed",
    providerTimestamp: "2026-07-13T20:00:00.000Z",
    receivedTimestamp: "2026-07-14T00:00:00.000Z",
    providerName: "test",
    dataQualityStatus: status,
    source: "primary",
    cached: false,
    warnings: [],
    validation: { valid, status, reasons: valid ? [] : [`${status} quote.`], warnings: [] },
    candles: [{ timestamp: "2026-07-13T20:00:00.000Z", open: 99, high: 101, low: 98, close: price, volume: 1000000 }],
    volume: 1000000
  };
}
