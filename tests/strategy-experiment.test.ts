import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  EXPECTED_EXPERIMENT_SYMBOLS,
  FIVE_STRATEGY_BASELINE_ID,
  FIVE_STRATEGY_DEFINITIONS,
  FIVE_STRATEGY_EXPERIMENT_ID,
  FIVE_STRATEGY_SOURCE_PORTFOLIO_ID,
  FIVE_STRATEGY_TARGET_VALUE_USD,
  initializeFiveStrategyExperiment,
  renderFiveStrategyExperimentHtml,
  renderComparisonHtml,
  scaleFrozenBaseline,
  type FrozenBaselineInput,
  type StrategyExperimentComparison
} from "../src/experiments/fiveStrategyExperiment.ts";

const migration = readFileSync("migrations/0039_five_strategy_experiments.sql", "utf8");
const serviceSource = readFileSync("src/experiments/fiveStrategyExperiment.ts", "utf8");

test("five-strategy experiment migration stores immutable baseline and paper-only strategy portfolios", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS strategy_experiments/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS strategy_experiment_baselines/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS strategy_experiment_baseline_positions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS strategy_experiment_portfolios/);
  assert.match(migration, /paper_only INTEGER NOT NULL DEFAULT 1 CHECK \(paper_only = 1\)/);
  assert.match(migration, /live_trading_enabled INTEGER NOT NULL DEFAULT 0 CHECK \(live_trading_enabled = 0\)/);
  assert.match(migration, /automatic_live_execution_enabled INTEGER NOT NULL DEFAULT 0 CHECK \(automatic_live_execution_enabled = 0\)/);
  assert.match(migration, /UNIQUE \(experiment_id, strategy_key\)/);
});

test("strategy definitions are materially different and include the five requested strategies", () => {
  assert.deepEqual(FIVE_STRATEGY_DEFINITIONS.map((strategy) => strategy.key), [
    "guardian",
    "balanced",
    "growth",
    "aggressive",
    "hyperactive"
  ]);

  const uniqueRisk = new Set(FIVE_STRATEGY_DEFINITIONS.map((strategy) => [
    strategy.parameters.minConfidence,
    strategy.parameters.maxNewTradePct,
    strategy.parameters.maxPositionPct,
    strategy.parameters.drawdownBlockPct,
    strategy.parameters.turnoverLimitPct,
    strategy.parameters.decisionCadence
  ].join("|")));
  assert.equal(uniqueRisk.size, 5);

  const guardian = FIVE_STRATEGY_DEFINITIONS[0];
  const hyperactive = FIVE_STRATEGY_DEFINITIONS[4];
  assert.ok(guardian.parameters.minConfidence > hyperactive.parameters.minConfidence);
  assert.ok(guardian.parameters.turnoverLimitPct < hyperactive.parameters.turnoverLimitPct);
  assert.ok(guardian.parameters.drawdownBlockPct < hyperactive.parameters.drawdownBlockPct);
});

test("baseline scaling creates nine symbols and exactly 400 dollars without using source cost basis", () => {
  const baseline = scaleFrozenBaseline(sampleBaselineInput(), {
    experimentId: FIVE_STRATEGY_EXPERIMENT_ID,
    baselineId: FIVE_STRATEGY_BASELINE_ID,
    experimentStartTimestamp: "2026-07-27T18:40:33.996Z",
    targetValueUsd: FIVE_STRATEGY_TARGET_VALUE_USD
  });

  assert.equal(baseline.sourcePortfolioId, FIVE_STRATEGY_SOURCE_PORTFOLIO_ID);
  assert.equal(baseline.positions.length, 9);
  assert.deepEqual(baseline.positions.map((position) => position.symbol), [...EXPECTED_EXPERIMENT_SYMBOLS].sort());
  assert.equal(baseline.initialTotalValueUsd, 400);
  assert.equal(baseline.initialHoldingsValueUsd + baseline.initialCashUsd, 400);
  assert.ok(baseline.initialCashUsd >= 0);
  assert.ok(baseline.initialCashUsd < 1);
  assert.ok(baseline.positions.every((position) => position.experimentCostBasisUsd === position.scaledMarketValueUsd));

  const copiedSourceCostBasis = baseline.positions.reduce((sum, position) => sum + position.sourceCostBasisUsd, 0);
  assert.notEqual(Math.round(copiedSourceCostBasis * 100) / 100, 400);
  assert.equal((baseline.initialTotalValueUsd - 400) / 400, 0);
});

test("baseline records quote timestamps, stale/NAV warnings, and preserves frozen prices", () => {
  const baseline = scaleFrozenBaseline(sampleBaselineInput(), {
    experimentId: FIVE_STRATEGY_EXPERIMENT_ID,
    baselineId: FIVE_STRATEGY_BASELINE_ID,
    experimentStartTimestamp: "2026-07-27T18:40:33.996Z",
    targetValueUsd: 400
  });

  const fxaix = baseline.positions.find((position) => position.symbol === "FXAIX");
  assert.equal(fxaix?.frozenPriceUsd, 257.65);
  assert.equal(fxaix?.quoteTimestamp, "2026-07-25T00:08:19.000Z");
  assert.equal(fxaix?.quoteSource, "yahoo_finance_chart");
  assert.equal(fxaix?.quoteOrigin, "trusted_quote_cache");
  assert.match(baseline.warnings.join(" "), /FXAIX uses the latest available published NAV/);

  const changedQuotes = sampleBaselineInput();
  changedQuotes.holdings.find((holding) => holding.symbol === "GEN")!.frozenPriceUsd = 99;
  assert.equal(baseline.positions.find((position) => position.symbol === "GEN")?.frozenPriceUsd, 26.845);
});

test("initializer creates exactly five paper portfolios from the same baseline and is idempotent", async () => {
  const db = experimentDb();
  const first = await initializeFiveStrategyExperiment(db, {
    now: new Date("2026-07-27T18:40:33.996Z"),
    baselineInput: sampleBaselineInput()
  });
  const second = await initializeFiveStrategyExperiment(db, {
    now: new Date("2026-07-27T18:45:00.000Z"),
    baselineInput: sampleBaselineInput()
  });

  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(first.portfolios.length, 5);
  assert.deepEqual(first.portfolios.map((portfolio) => portfolio.strategyKey), ["guardian", "balanced", "growth", "aggressive", "hyperactive"]);
  assert.ok(first.portfolios.every((portfolio) => portfolio.experimentId === FIVE_STRATEGY_EXPERIMENT_ID));
  assert.ok(first.portfolios.every((portfolio) => portfolio.baselineId === FIVE_STRATEGY_BASELINE_ID));
  assert.ok(first.portfolios.every((portfolio) => portfolio.experimentStartTimestamp === "2026-07-27T18:40:33.996Z"));
  assert.ok(first.portfolios.every((portfolio) => portfolio.experimentStartingValueUsd === 400));
  assert.ok(first.portfolios.every((portfolio) => portfolio.initialCashUsd === first.baseline.initialCashUsd));
  assert.ok(first.portfolios.every((portfolio) => portfolio.initialTradeCount === 0));
  assert.equal(db.state.portfolios.length, 5);
  assert.equal(db.state.tradesInserted, 0);
  assert.equal(db.state.ordersInserted, 0);
  assert.equal(db.state.positions.length, 45);
  assert.equal(new Set(db.state.positions.map((position) => position.symbol)).has("BTC-USD"), true);
  assert.ok(db.state.profileEnabled.every((enabled) => enabled === 0));
});

test("comparison page uses experiment wording and 400 dollar denominator", () => {
  const html = renderComparisonHtml(sampleComparison());
  assert.match(html, /Experiment starting value/);
  assert.match(html, /Gain\/loss since experiment start/);
  assert.match(html, /Return since experiment start/);
  assert.match(html, /Experiment start timestamp/);
  assert.match(html, /Trade/);
  assert.match(html, /baseline_tim_real_five_strategy_400_v1/);
  assert.doesNotMatch(html, /since account funding/i);
  assert.match(html, /\$400\.00/);
  assert.match(html, /\+\$20\.00/);
  assert.match(html, /\+5\.00%/);
});

test("comparison page states clearly when the experiment has not been initialized", async () => {
  const response = await renderFiveStrategyExperimentHtml(experimentDb());
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /No active five-strategy experiment has been initialized yet/);
  assert.match(html, /Initialization is a separate protected operation/);
  assert.match(html, /No strategy portfolios, frozen prices, scaled quantities, or experiment baseline values exist yet/);
});

test("experiment source does not create initialization trades or alter protected Tim Real portfolios", () => {
  assert.doesNotMatch(serviceSource, /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+trades\b/i);
  assert.doesNotMatch(serviceSource, /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+orders\b/i);
  assert.doesNotMatch(serviceSource, /portfolio_tim_real_portfolio/);
  assert.match(serviceSource, /portfolio_tim_real_watchlist/);
  assert.match(serviceSource, /enabled, created_at, updated_at[\s\S]*\?, 0, \?, \?/);
});

function sampleBaselineInput(): FrozenBaselineInput {
  return {
    sourcePortfolioId: FIVE_STRATEGY_SOURCE_PORTFOLIO_ID,
    valuationTimestamp: "2026-07-27T18:40:33.996Z",
    dataStatus: "stale",
    holdings: [
      holding("BTC-USD", "crypto", 0.000061, 77754, 64134.6, "coinbase_public_market_data", "provider_refresh", "Valid", "2026-07-27T18:40:30.000Z", "delayed", 8),
      holding("ETH-USD", "crypto", 0.0024, 2122.79, 1928.1, "yahoo_finance_chart", "trusted_quote_cache", "Valid", "2026-07-27T18:40:30.000Z", "delayed", 8),
      holding("FXAIX", "mutual_fund", 0.411, 252.40513381995137, 257.65, "yahoo_finance_chart", "trusted_quote_cache", "Previous Close", "2026-07-25T00:08:19.000Z", "stale", 6),
      holding("GEN", "stock", 7.606, 17.925, 26.845, "yahoo_finance_chart", "trusted_quote_cache", "Valid", "2026-07-27T18:40:12.000Z", "delayed", 6),
      holding("KO", "stock", 0.128205, 78, 84.073, "yahoo_finance_chart", "trusted_quote_cache", "Valid", "2026-07-27T18:40:30.000Z", "delayed", 6),
      holding("MSFT", "stock", 0.060762, 411.44, 392.855, "yahoo_finance_chart", "trusted_quote_cache", "Valid", "2026-07-27T18:40:34.000Z", "delayed", 6),
      holding("SOXX", "etf", 0.05069, 591.8036654172421, 506.42, "yahoo_finance_chart", "trusted_quote_cache", "Valid", "2026-07-27T18:40:30.000Z", "delayed", 6),
      holding("VOO", "etf", 0.022436, 669.0143682920307, 677.13, "yahoo_finance_chart", "trusted_quote_cache", "Valid", "2026-07-27T18:40:31.000Z", "delayed", 6),
      holding("VOOG", "etf", 0.1228, 81.53, 79.185, "yahoo_finance_chart", "trusted_quote_cache", "Valid", "2026-07-27T18:40:17.000Z", "delayed", 6)
    ]
  };
}

function holding(
  symbol: string,
  assetClass: string,
  sourceQuantity: number,
  sourceAverageCostUsd: number,
  frozenPriceUsd: number,
  quoteSource: string,
  quoteOrigin: string,
  quoteStatus: string,
  quoteTimestamp: string,
  dataStatus: string,
  quantityPrecision: number
) {
  return { symbol, assetClass, sourceQuantity, sourceAverageCostUsd, frozenPriceUsd, quoteSource, quoteOrigin, quoteStatus, quoteTimestamp, dataStatus, quantityPrecision };
}

function sampleComparison(): StrategyExperimentComparison {
  return {
    experiment: {
      id: FIVE_STRATEGY_EXPERIMENT_ID,
      key: "tim_real_five_strategy_400_v1",
      sourcePortfolioId: FIVE_STRATEGY_SOURCE_PORTFOLIO_ID,
      name: "Tim Real Five-Strategy $400 Paper Experiment",
      targetStartingValueUsd: 400,
      status: "active",
      paperOnly: true,
      liveTradingEnabled: false,
      automaticLiveExecutionEnabled: false,
      createdAt: "2026-07-27T18:40:33.996Z"
    },
    baseline: {
      experimentId: FIVE_STRATEGY_EXPERIMENT_ID,
      baselineId: FIVE_STRATEGY_BASELINE_ID,
      sourcePortfolioId: FIVE_STRATEGY_SOURCE_PORTFOLIO_ID,
      experimentStartTimestamp: "2026-07-27T18:40:33.996Z",
      frozenValuationTimestamp: "2026-07-27T18:40:33.996Z",
      targetValueUsd: 400,
      sourceHoldingsValueUsd: 403.84,
      scalingMethod: "proportional",
      initialCashUsd: 0.001,
      initialHoldingsValueUsd: 399.999,
      initialTotalValueUsd: 400,
      dataQualityStatus: "stale",
      warnings: ["FXAIX uses latest NAV."],
      initialSymbols: [...EXPECTED_EXPERIMENT_SYMBOLS]
    },
    portfolios: [{
      portfolioId: "portfolio_experiment_tim_real_five_strategy_400_v1_guardian",
      strategyKey: "guardian",
      strategyName: "Guardian",
      currentAccountValueUsd: 420,
      experimentStartingValueUsd: 400,
      experimentGainLossUsd: 20,
      experimentReturnPct: 0.05,
      experimentStartTimestamp: "2026-07-27T18:40:33.996Z",
      holdingsCount: 9,
      tradeCount: 0,
      cashUsd: 0,
      holdingsValueUsd: 420,
      realizedGainLossUsd: 0,
      unrealizedGainLossUsd: 20,
      feesUsd: 0,
      dataStatus: "delayed"
    }]
  };
}

function experimentDb() {
  const state: {
    experiment: Record<string, unknown> | null;
    baseline: Record<string, unknown> | null;
    baselinePositions: Record<string, unknown>[];
    strategyPortfolios: Record<string, unknown>[];
    portfolios: Record<string, unknown>[];
    positions: Record<string, unknown>[];
    profileEnabled: number[];
    tradesInserted: number;
    ordersInserted: number;
  } = {
    experiment: null,
    baseline: null,
    baselinePositions: [],
    strategyPortfolios: [],
    portfolios: [],
    positions: [],
    profileEnabled: [],
    tradesInserted: 0,
    ordersInserted: 0
  };

  const db = {
    state,
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return statement(sql, params, state);
        }
      };
    },
    async batch(statements: Array<{ sql: string; params: unknown[] }>) {
      for (const item of statements) {
        applyStatement(item.sql, item.params, state);
      }
      return statements.map(() => ({ success: true }));
    }
  };
  return db as unknown as D1Database & { state: typeof state };
}

function statement(sql: string, params: unknown[], state: ReturnType<typeof experimentDb>["state"]) {
  return {
    sql,
    params,
    async first() {
      if (/FROM strategy_experiments/i.test(sql)) return state.experiment;
      if (/FROM strategy_experiment_baselines/i.test(sql)) return state.baseline;
      return null;
    },
    async all() {
      if (/FROM strategy_experiment_baseline_positions/i.test(sql)) return { results: state.baselinePositions };
      if (/FROM strategy_experiment_portfolios/i.test(sql)) return { results: state.strategyPortfolios };
      return { results: [] };
    },
    async run() {
      applyStatement(sql, params, state);
      return { success: true, meta: { changes: 1 } };
    }
  };
}

function applyStatement(sql: string, params: unknown[], state: ReturnType<typeof experimentDb>["state"]) {
  if (/INSERT OR IGNORE INTO strategy_experiments/i.test(sql) && !state.experiment) {
    state.experiment = {
      id: params[0],
      experimentKey: params[1],
      sourcePortfolioId: params[2],
      name: params[3],
      targetStartingValueUsd: params[4],
      status: "active",
      paperOnly: 1,
      liveTradingEnabled: 0,
      automaticLiveExecutionEnabled: 0,
      createdAt: params[5]
    };
  } else if (/INSERT OR IGNORE INTO strategy_experiment_baselines/i.test(sql) && !state.baseline) {
    state.baseline = {
      id: params[0],
      experimentId: params[1],
      sourcePortfolioId: params[2],
      createdAt: params[3],
      frozenValuationTimestamp: params[4],
      targetValueUsd: params[5],
      sourceHoldingsValueUsd: params[6],
      scalingMethod: params[7],
      initialCashUsd: params[8],
      initialHoldingsValueUsd: params[9],
      initialTotalValueUsd: params[10],
      dataQualityStatus: params[11],
      warningsJson: params[12]
    };
  } else if (/INSERT OR IGNORE INTO strategy_experiment_baseline_positions/i.test(sql)) {
    const symbol = String(params[2]);
    if (!state.baselinePositions.some((position) => position.symbol === symbol)) {
      state.baselinePositions.push({
        symbol,
        assetClass: params[3],
        sourceQuantity: params[4],
        sourceCostBasisUsd: params[5],
        sourceMarketValueUsd: params[6],
        frozenPriceUsd: params[7],
        quoteSource: params[8],
        quoteOrigin: params[9],
        quoteStatus: params[10],
        quoteTimestamp: params[11],
        sourceDataStatus: params[12],
        quantityPrecision: params[13],
        scaledQuantity: params[14],
        scaledMarketValueUsd: params[15],
        experimentCostBasisUsd: params[16]
      });
    }
  } else if (/INSERT OR IGNORE INTO strategy_experiment_portfolios/i.test(sql)) {
    const portfolioId = String(params[3]);
    if (!state.strategyPortfolios.some((portfolio) => portfolio.portfolioId === portfolioId)) {
      state.strategyPortfolios.push({
        portfolioId,
        strategyKey: params[4],
        strategyDisplayName: params[5],
        experimentStartTimestamp: params[7],
        experimentStartingValueUsd: params[8]
      });
    }
  } else if (/INSERT OR IGNORE INTO portfolios/i.test(sql)) {
    const portfolioId = String(params[0]);
    if (!state.portfolios.some((portfolio) => portfolio.id === portfolioId)) state.portfolios.push({ id: portfolioId, cashUsd: params[2], startingBalanceUsd: params[3] });
  } else if (/INSERT OR IGNORE INTO positions/i.test(sql)) {
    state.positions.push({ portfolioId: params[1], symbol: params[2], quantity: params[4], price: params[6], marketValue: params[7] });
  } else if (/INSERT OR IGNORE INTO portfolio_profiles/i.test(sql)) {
    state.profileEnabled.push(0);
  } else if (/INSERT/i.test(sql) && /\btrades\b/i.test(sql)) {
    state.tradesInserted += 1;
  } else if (/INSERT/i.test(sql) && /\borders\b/i.test(sql)) {
    state.ordersInserted += 1;
  }
}
