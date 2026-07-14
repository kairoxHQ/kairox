import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildDashboardContract } from "../src/dashboard/contract.ts";
import { journeyEventKey } from "../src/journey/service.ts";
import { evaluateMilestone, milestoneAwardKey, type MilestoneDefinition, type MilestoneContext } from "../src/milestones/service.ts";
import { calculateTradeResults } from "../src/portfolio/dailySnapshots.ts";
import { calculateStreak } from "../src/portfolio/historicalMetrics.ts";
import { accountDate, calculatePortfolioValuation, getPortfolioValuation, PortfolioNotFoundError, valuePosition, type PortfolioValuation } from "../src/portfolio/valuation.ts";
import { buildDailySummary } from "../src/summaries/service.ts";
import { addMoney, multiplyMoney, pctChange } from "../src/shared/money.ts";
import worker from "../src/index.ts";

test("position valuation calculates cost basis and unrealized profit/loss", () => {
  const position = valuePosition({
    symbol: "SPY",
    assetClass: "etf",
    quantity: 2,
    avgEntryPriceUsd: 100,
    fallbackPriceUsd: 100,
    fallbackMarketValueUsd: 200,
    latestPriceUsd: 125,
    latestPriceAsOf: "2026-07-13T14:00:00.000Z",
    latestDataStatus: "delayed"
  });

  assert.equal(position.currentPositionValueUsd, 250);
  assert.equal(position.unrealizedProfitLossUsd, 50);
  assert.equal(position.unrealizedProfitLossPct, 0.25);
  assert.equal(position.dataStatus, "delayed");
});

test("portfolio valuation calculates daily and total profit/loss without inventing prices", () => {
  const valuation = calculatePortfolioValuation({
    portfolioId: "portfolio_tim_paper",
    startingBalanceUsd: 20,
    availableCashUsd: 5,
    realizedProfitLossUsd: 1,
    feesUsd: 0.02,
    todayStartingTotalAccountValueUsd: 20,
    valuationTimestamp: "2026-07-13T15:00:00.000Z",
    positions: [
      {
        symbol: "BTC-USD",
        assetClass: "crypto",
        quantity: 0.01,
        avgEntryPriceUsd: 1000,
        fallbackPriceUsd: 1000,
        fallbackMarketValueUsd: 10,
        latestPriceUsd: 1500,
        latestPriceAsOf: "2026-07-13T15:00:00.000Z",
        latestDataStatus: "live"
      }
    ]
  });

  assert.equal(valuation.portfolioValueUsd, 15);
  assert.equal(valuation.totalAccountValueUsd, 20);
  assert.equal(valuation.todayChangeUsd, 0);
  assert.equal(valuation.overallReturnUsd, 0);
  assert.equal(valuation.unrealizedProfitLossUsd, 5);
  assert.equal(valuation.realizedProfitLossUsd, 1);
  assert.equal(valuation.dataStatus, "live");
});

test("stale or missing market data uses last valid position price and marks status", () => {
  const stale = valuePosition({
    symbol: "AAPL",
    assetClass: "stock",
    quantity: 1.5,
    avgEntryPriceUsd: 100,
    fallbackPriceUsd: 101,
    fallbackMarketValueUsd: 151.5,
    latestPriceUsd: null,
    latestPriceAsOf: null,
    latestDataStatus: "unavailable"
  });

  assert.equal(stale.currentMarketPriceUsd, 101);
  assert.equal(stale.currentPositionValueUsd, 151.5);
  assert.equal(stale.dataStatus, "stale");
});

test("portfolio valuation uses trusted quote cache when market timestamp is fresher than stored position prices", async () => {
  const now = new Date("2026-07-14T15:00:00.000Z");
  const quote = {
    symbol: "BND",
    lastPrice: 72.72,
    providerTimestamp: "2026-07-14T14:56:53.000Z",
    receivedTimestamp: "2026-07-14T14:56:55.000Z",
    dataQualityStatus: "Delayed",
    warnings: []
  };
  const db = fakeValuationDb({
    trustedQuoteJson: JSON.stringify(quote),
    now
  });

  const valuation = await getPortfolioValuation(db, "portfolio_ira", now);

  assert.equal(valuation.positions[0].currentMarketPriceUsd, 72.72);
  assert.equal(valuation.positions[0].currentPositionValueUsd, 145.44);
  assert.equal(valuation.positions[0].dataStatus, "delayed");
  assert.equal(valuation.portfolioValueUsd, 145.44);
  assert.equal(valuation.totalAccountValueUsd, 245.44);
});

test("daily snapshot migration is idempotent and stores opening and closing fields", () => {
  const sql = readFileSync("migrations/0012_journey_valuation_milestones.sql", "utf8");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS account_daily_snapshots/);
  assert.match(sql, /UNIQUE\(portfolio_id, snapshot_date\)/);
  assert.match(sql, /starting_total_account_value_usd/);
  assert.match(sql, /ending_total_account_value_usd/);
  assert.match(sql, /max_daily_drawdown_pct/);
});

function fakeValuationDb(input: { trustedQuoteJson: string; now: Date }): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return statementFor(sql, params, input);
        },
        ...statementFor(sql, [], input)
      };
    }
  } as unknown as D1Database;
}

function statementFor(sql: string, _params: unknown[], input: { trustedQuoteJson: string; now: Date }) {
  return {
    async first() {
      if (/FROM portfolios WHERE id/i.test(sql)) {
        return { id: "portfolio_ira", cashUsd: 100, startingBalanceUsd: 240 };
      }
      if (/SUM\(fees_usd\)/i.test(sql)) {
        return { fees: 0 };
      }
      if (/FROM account_daily_snapshots/i.test(sql)) {
        return { startingTotalAccountValueUsd: 240 };
      }
      return null;
    },
    async all() {
      if (/FROM positions/i.test(sql)) {
        return {
          results: [{
            id: "pos_bnd",
            symbol: "BND",
            assetClass: "bond_fund",
            quantity: 2,
            avgEntryPriceUsd: 70,
            currentPriceUsd: 72.5,
            marketValueUsd: 145
          }]
        };
      }
      if (/FROM market_snapshots/i.test(sql)) {
        return {
          results: [{
            symbol: "BND",
            priceUsd: 72.5,
            priceAsOf: "2026-07-13T20:00:01.000Z",
            validationStatus: "validated",
            createdAt: "2026-07-14T15:03:58.000Z"
          }]
        };
      }
      if (/FROM trusted_quote_cache/i.test(sql)) {
        return {
          results: [{
            symbol: "BND",
            normalizedQuoteJson: input.trustedQuoteJson,
            qualityStatus: "Delayed",
            providerTimestamp: "2026-07-14T14:56:53.000Z",
            retrievalTimestamp: input.now.toISOString(),
            expiresAt: new Date(input.now.getTime() + 30 * 60 * 1000).toISOString()
          }]
        };
      }
      return { results: [] };
    }
  };
}

test("trade result helper handles empty, open, and closed trade rows", () => {
  assert.deepEqual(calculateTradeResults([]), []);
  const rows = calculateTradeResults([
    { id: "trade_buy", symbol: "BTC-USD", side: "BUY", quantity: 1, priceUsd: 10, feesUsd: 0.01, executedAt: "2026-07-13T14:00:00.000Z" },
    { id: "trade_sell", symbol: "BTC-USD", side: "SELL", quantity: 1, priceUsd: 12, feesUsd: 0.01, executedAt: "2026-07-13T15:00:00.000Z" }
  ]);

  assert.equal(rows[0].profitLossUsd, -0.01);
  assert.equal(rows[1].profitLossUsd, -0.01);
});

test("valuation endpoints reject malformed portfolio IDs before querying data", async () => {
  const env = { DB: {} as D1Database, APP_MODE: "paper", LIVE_TRADING_ENABLED: "false", STARTING_BALANCE_USD: "20", BENCHMARK_ASSET: "BTC" };
  const response = await worker.fetch(new Request("https://kairox.test/valuation?portfolioId=../secret"), env);
  const body = await response.json() as { error: string };

  assert.equal(response.status, 400);
  assert.equal(body.error, "Invalid portfolio identifier.");
});

test("unknown portfolios fail closed instead of falling back to another profile", async () => {
  const db = {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return null;
            }
          };
        }
      };
    }
  } as unknown as D1Database;

  await assert.rejects(() => getPortfolioValuation(db, "portfolio_missing"), PortfolioNotFoundError);
});

test("portfolio-scoped read routes return 404 for unknown portfolio IDs", async () => {
  const db = {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return null;
            }
          };
        }
      };
    }
  } as unknown as D1Database;
  const env = { DB: db, APP_MODE: "paper", LIVE_TRADING_ENABLED: "false", STARTING_BALANCE_USD: "20", BENCHMARK_ASSET: "BTC" };

  for (const route of ["/daily-snapshots", "/milestones", "/journey"]) {
    const response = await worker.fetch(new Request(`https://kairox.test${route}?portfolioId=portfolio_missing`), env);
    assert.equal(response.status, 404, route);
  }
});

test("milestone qualification and duplicate prevention use configurable definitions", () => {
  const definition: MilestoneDefinition = {
    id: "account_value_25",
    name: "First $25 account value",
    description: "Value reached 25.",
    category: "account_growth",
    badgeId: "value-25",
    conditionType: "account_value",
    threshold: 25,
    comparisonOperator: "gte",
    repeatable: false,
    displayMessage: "Account value reached $25.",
    enabled: true,
    version: 1
  };
  const context = milestoneContext(30);
  const awardKey = milestoneAwardKey("portfolio_tim_paper", definition, context);
  const first = evaluateMilestone(definition, context, new Set(), "portfolio_tim_paper");
  const duplicate = evaluateMilestone(definition, context, new Set([awardKey]), "portfolio_tim_paper");

  assert.equal(first.qualified, true);
  assert.equal(first.earnedAt, null);
  assert.equal(duplicate.qualified, true);
  assert.equal(duplicate.earnedAt, context.timestamp);
});

test("journey event keys are append-safe and account-created is permanent once", () => {
  const once = journeyEventKey("portfolio_tim_paper", {
    eventType: "account_created",
    timestamp: "2026-07-13T14:00:00.000Z",
    title: "Created",
    description: "Created",
    source: "system"
  });
  const trade = journeyEventKey("portfolio_tim_paper", {
    eventType: "trade_opened",
    timestamp: "2026-07-13T14:00:00.000Z",
    title: "Trade opened",
    description: "Opened",
    relatedTradeId: "trade_1",
    source: "strategy"
  });

  assert.equal(once, "portfolio_tim_paper:account_created:once");
  assert.match(trade, /trade_1/);
});

test("daily summary reports zero trades and unavailable information honestly", () => {
  const valuation = sampleValuation();
  const summary = buildDailySummary(valuation, {
    portfolioId: valuation.portfolioId,
    snapshotDate: "2026-07-13",
    startingCashUsd: 20,
    startingPortfolioValueUsd: 0,
    startingTotalAccountValueUsd: 20,
    endingCashUsd: null,
    endingPortfolioValueUsd: null,
    endingTotalAccountValueUsd: null,
    dailyProfitLossUsd: 0,
    dailyReturnPct: 0,
    realizedProfitLossUsd: 0,
    unrealizedProfitLossUsd: 0,
    tradeCount: 0,
    winningTrades: 0,
    losingTrades: 0,
    bestTrade: null,
    largestLosingTrade: null,
    feesUsd: 0,
    highestAccountValueUsd: 20,
    lowestAccountValueUsd: 20,
    maximumDailyDrawdownPct: 0,
    reconciled: true,
    reconciliationStatus: "paper_reconciled"
  }, []);

  assert.equal(summary.tradesTaken, 0);
  assert.match(summary.beginnerSummary, /made no trades/);
  assert.equal(summary.marketDataHealth[0].message, "No market-data status records are available yet.");
});

test("beginner and advanced dashboard views share identical source valuation values", () => {
  const valuation = sampleValuation();
  const contract = buildDashboardContract({
    valuation,
    metrics: [],
    marketStatuses: [],
    explanation: {
      action: "HOLD",
      plainLanguageSummary: "Kairox is holding.",
      detailedTechnicalExplanation: "No exit signal.",
      supportingIndicators: { shortMovingAverage: 10, longMovingAverage: 9, rsi: 55, momentumPct: 0.01 },
      riskFactors: [],
      reasonsForEntering: [],
      reasonsForWaiting: ["No exit signal."],
      reasonsForRejectingTrade: [],
      confidenceScore: 0.7,
      dataTimestamp: "2026-07-13T14:00:00.000Z",
      strategyVersion: "paper-strategy-v1",
      generatedBy: "rules",
      certaintyDisclaimer: "No certainty."
    }
  });

  assert.equal(contract.beginner.currentValue, contract.shared.valuation.totalAccountValueUsd);
  assert.equal(contract.advanced.positionSizingCalculation.valueUsd, contract.shared.valuation.positions[0].currentPositionValueUsd);
});

test("decimal-safe money helpers avoid common floating point drift", () => {
  assert.equal(addMoney(0.1, 0.2), 0.3);
  assert.equal(multiplyMoney(0.1, 3), 0.3);
  assert.equal(pctChange(20, 25), 0.25);
});

test("account date respects configured timezone boundaries", () => {
  assert.equal(accountDate(new Date("2026-07-13T03:30:00.000Z"), "America/New_York"), "2026-07-12");
  assert.equal(accountDate(new Date("2026-07-13T04:30:00.000Z"), "America/New_York"), "2026-07-13");
});

test("empty portfolios remain valid valuations", () => {
  const valuation = calculatePortfolioValuation({
    portfolioId: "empty",
    startingBalanceUsd: 20,
    availableCashUsd: 20,
    positions: [],
    realizedProfitLossUsd: 0,
    feesUsd: 0,
    todayStartingTotalAccountValueUsd: 20,
    valuationTimestamp: "2026-07-13T14:00:00.000Z"
  });

  assert.equal(valuation.positions.length, 0);
  assert.equal(valuation.portfolioValueUsd, 0);
  assert.equal(valuation.totalAccountValueUsd, 20);
  assert.equal(valuation.dataStatus, "unavailable");
});

test("current streak detects losing and flat sequences", () => {
  assert.deepEqual(calculateStreak([-0.01, -0.02]), { type: "losing", count: 2 });
  assert.deepEqual(calculateStreak([]), { type: "flat", count: 0 });
});

function sampleValuation(): PortfolioValuation {
  return calculatePortfolioValuation({
    portfolioId: "portfolio_tim_paper",
    startingBalanceUsd: 20,
    availableCashUsd: 10,
    realizedProfitLossUsd: 0,
    feesUsd: 0,
    todayStartingTotalAccountValueUsd: 20,
    valuationTimestamp: "2026-07-13T14:00:00.000Z",
    positions: [{
      symbol: "SPY",
      assetClass: "etf",
      quantity: 0.01,
      avgEntryPriceUsd: 500,
      fallbackPriceUsd: 500,
      fallbackMarketValueUsd: 5,
      latestPriceUsd: 500,
      latestPriceAsOf: "2026-07-13T14:00:00.000Z",
      latestDataStatus: "delayed"
    }]
  });
}

function milestoneContext(value: number): MilestoneContext {
  return {
    valuation: calculatePortfolioValuation({
      portfolioId: "portfolio_tim_paper",
      startingBalanceUsd: 20,
      availableCashUsd: value,
      positions: [],
      realizedProfitLossUsd: 0,
      feesUsd: 0,
      valuationTimestamp: "2026-07-13T14:00:00.000Z"
    }),
    tradeCount: 0,
    winningTrades: 0,
    winningDays: 0,
    staleDataRejections: 0,
    livePriceUpdates: 0,
    strategyEvaluations: 0,
    allTimeHighValueUsd: value,
    timestamp: "2026-07-13T14:00:00.000Z"
  };
}
