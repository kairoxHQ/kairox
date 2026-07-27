import { getPortfolioValuation, type PortfolioValuation, type ValuedPosition } from "../portfolio/valuation.ts";
import { resolvePaperCandidateUniverse, type AssetRegistryRecord } from "../market/assets.ts";
import { canExecuteAt } from "../market/hours.ts";
import { calculateIndicators } from "../strategy/indicators.ts";
import { decidePaperAction, type StrategyDecision } from "../strategy/paperStrategy.ts";
import { assessPaperTrade } from "../risk/checks.ts";
import { getPortfolioProfile, type PortfolioProfile } from "../portfolio/profiles.ts";
import { calculatePortfolioState, exposureForAsset } from "../paper/service.ts";
import { screenAsset } from "../strategy/screener.ts";
import { getInvestmentPolicy } from "../policies/investmentPolicy.ts";
import { listRows } from "../shared/db.ts";
import { formatCurrency, formatPercent, formatSignedCurrency, formatSignedPercent } from "../shared/displayFormat.ts";
import { addMoney, multiplyMoney, roundMoney, roundRatio, subtractMoney } from "../shared/money.ts";
import type { MarketCandle, MarketDataset } from "../shared/types.ts";

export const FIVE_STRATEGY_EXPERIMENT_KEY = "tim_real_five_strategy_400_v1";
export const FIVE_STRATEGY_EXPERIMENT_ID = "experiment_tim_real_five_strategy_400_v1";
export const FIVE_STRATEGY_BASELINE_ID = "baseline_tim_real_five_strategy_400_v1";
export const FIVE_STRATEGY_SOURCE_PORTFOLIO_ID = "portfolio_tim_real_watchlist";
export const FIVE_STRATEGY_TARGET_VALUE_USD = 400;

export const EXPECTED_EXPERIMENT_SYMBOLS = [
  "BTC-USD",
  "ETH-USD",
  "FXAIX",
  "GEN",
  "KO",
  "MSFT",
  "SOXX",
  "VOO",
  "VOOG"
] as const;

export type ExperimentStrategyKey = "guardian" | "balanced" | "growth" | "aggressive" | "hyperactive";

export interface ExperimentStrategyDefinition {
  key: ExperimentStrategyKey;
  displayName: string;
  riskPosture: string;
  philosophy: string;
  riskLevel: "conservative" | "moderate" | "high";
  maxPositionPct: number;
  maxDailyLossPct: number;
  parameters: {
    minConfidence: number;
    buyThreshold: number;
    sellThreshold: number;
    maxNewTradePct: number;
    maxPositionPct: number;
    cashReservePct: number;
    drawdownBlockPct: number;
    rebalanceThresholdPct: number;
    concentrationMultiplier: number;
    cryptoPreference: number;
    dividendPreference: number;
    turnoverLimitPct: number;
    decisionCadence: string;
    maxTradesPerCycle: number;
    maxTradesPerDay: number;
    cooldownMinutes: number;
    feeRate: number;
    slippageBps: number;
    volatilityWeight: number;
    momentumWeight: number;
    trendWeight: number;
    macroWeight: number;
    geopoliticalWeight: number;
  };
}

export const FIVE_STRATEGY_DEFINITIONS: ExperimentStrategyDefinition[] = [
  {
    key: "guardian",
    displayName: "Guardian",
    riskPosture: "capital_preservation",
    philosophy: "Capital preservation, lower turnover, stronger evidence requirements, and tighter concentration control.",
    riskLevel: "conservative",
    maxPositionPct: 0.18,
    maxDailyLossPct: 0.015,
    parameters: {
      minConfidence: 0.78,
      buyThreshold: 0.78,
      sellThreshold: 0.72,
      maxNewTradePct: 0.04,
      maxPositionPct: 0.18,
      cashReservePct: 0.12,
      drawdownBlockPct: 0.04,
      rebalanceThresholdPct: 0.12,
      concentrationMultiplier: 0.65,
      cryptoPreference: 0.35,
      dividendPreference: 1.45,
      turnoverLimitPct: 0.08,
      decisionCadence: "low",
      maxTradesPerCycle: 1,
      maxTradesPerDay: 1,
      cooldownMinutes: 1440,
      feeRate: 0.001,
      slippageBps: 25,
      volatilityWeight: 0.55,
      momentumWeight: 0.55,
      trendWeight: 0.7,
      macroWeight: 0.35,
      geopoliticalWeight: 0.15
    }
  },
  {
    key: "balanced",
    displayName: "Balanced",
    riskPosture: "moderate",
    philosophy: "Long-term growth with moderate risk, diversified positioning, and measured rotation.",
    riskLevel: "moderate",
    maxPositionPct: 0.28,
    maxDailyLossPct: 0.025,
    parameters: {
      minConfidence: 0.64,
      buyThreshold: 0.64,
      sellThreshold: 0.6,
      maxNewTradePct: 0.08,
      maxPositionPct: 0.28,
      cashReservePct: 0.06,
      drawdownBlockPct: 0.08,
      rebalanceThresholdPct: 0.08,
      concentrationMultiplier: 0.9,
      cryptoPreference: 0.8,
      dividendPreference: 1.1,
      turnoverLimitPct: 0.18,
      decisionCadence: "moderate",
      maxTradesPerCycle: 1,
      maxTradesPerDay: 2,
      cooldownMinutes: 720,
      feeRate: 0.001,
      slippageBps: 25,
      volatilityWeight: 0.8,
      momentumWeight: 0.85,
      trendWeight: 1,
      macroWeight: 0.45,
      geopoliticalWeight: 0.25
    }
  },
  {
    key: "growth",
    displayName: "Growth",
    riskPosture: "growth",
    philosophy: "Higher long-term return with more momentum emphasis and wider risk bands than Balanced.",
    riskLevel: "moderate",
    maxPositionPct: 0.36,
    maxDailyLossPct: 0.035,
    parameters: {
      minConfidence: 0.56,
      buyThreshold: 0.56,
      sellThreshold: 0.54,
      maxNewTradePct: 0.12,
      maxPositionPct: 0.36,
      cashReservePct: 0.035,
      drawdownBlockPct: 0.12,
      rebalanceThresholdPct: 0.055,
      concentrationMultiplier: 1.1,
      cryptoPreference: 1,
      dividendPreference: 0.8,
      turnoverLimitPct: 0.32,
      decisionCadence: "normal",
      maxTradesPerCycle: 2,
      maxTradesPerDay: 4,
      cooldownMinutes: 240,
      feeRate: 0.001,
      slippageBps: 25,
      volatilityWeight: 1.1,
      momentumWeight: 1.25,
      trendWeight: 1.2,
      macroWeight: 0.55,
      geopoliticalWeight: 0.35
    }
  },
  {
    key: "aggressive",
    displayName: "Aggressive",
    riskPosture: "aggressive",
    philosophy: "Return maximization with faster rotation, higher concentration tolerance, and larger drawdown tolerance.",
    riskLevel: "high",
    maxPositionPct: 0.48,
    maxDailyLossPct: 0.055,
    parameters: {
      minConfidence: 0.48,
      buyThreshold: 0.48,
      sellThreshold: 0.48,
      maxNewTradePct: 0.18,
      maxPositionPct: 0.48,
      cashReservePct: 0.015,
      drawdownBlockPct: 0.18,
      rebalanceThresholdPct: 0.035,
      concentrationMultiplier: 1.35,
      cryptoPreference: 1.25,
      dividendPreference: 0.55,
      turnoverLimitPct: 0.55,
      decisionCadence: "fast",
      maxTradesPerCycle: 3,
      maxTradesPerDay: 8,
      cooldownMinutes: 90,
      feeRate: 0.001,
      slippageBps: 25,
      volatilityWeight: 1.35,
      momentumWeight: 1.55,
      trendWeight: 1.45,
      macroWeight: 0.75,
      geopoliticalWeight: 0.55
    }
  },
  {
    key: "hyperactive",
    displayName: "Hyperactive",
    riskPosture: "system_stress_test",
    philosophy: "Paper-only stress test of decision and execution systems with rapid cadence but still reasoned, guarded decisions.",
    riskLevel: "high",
    maxPositionPct: 0.65,
    maxDailyLossPct: 0.09,
    parameters: {
      minConfidence: 0.38,
      buyThreshold: 0.38,
      sellThreshold: 0.4,
      maxNewTradePct: 0.3,
      maxPositionPct: 0.65,
      cashReservePct: 0,
      drawdownBlockPct: 0.3,
      rebalanceThresholdPct: 0.02,
      concentrationMultiplier: 1.8,
      cryptoPreference: 1.5,
      dividendPreference: 0.25,
      turnoverLimitPct: 4,
      decisionCadence: "very_fast",
      maxTradesPerCycle: 5,
      maxTradesPerDay: 25,
      cooldownMinutes: 30,
      feeRate: 0.001,
      slippageBps: 25,
      volatilityWeight: 1.8,
      momentumWeight: 2,
      trendWeight: 1.7,
      macroWeight: 1,
      geopoliticalWeight: 0.8
    }
  }
];

export interface FrozenSourceHoldingInput {
  symbol: string;
  assetClass: string;
  sourceQuantity: number;
  sourceAverageCostUsd: number;
  frozenPriceUsd: number;
  quoteSource: string | null;
  quoteOrigin: string | null;
  quoteStatus: string | null;
  quoteTimestamp: string | null;
  dataStatus: string;
  quantityPrecision: number;
}

export interface FrozenBaselineInput {
  sourcePortfolioId: string;
  valuationTimestamp: string;
  holdings: FrozenSourceHoldingInput[];
  dataStatus: string;
}

export interface ScaledBaselinePosition extends FrozenSourceHoldingInput {
  sourceMarketValueUsd: number;
  sourceCostBasisUsd: number;
  scaledQuantity: number;
  scaledMarketValueUsd: number;
  experimentCostBasisUsd: number;
}

export interface ScaledBaseline {
  experimentId: string;
  baselineId: string;
  sourcePortfolioId: string;
  experimentStartTimestamp: string;
  frozenValuationTimestamp: string;
  targetValueUsd: number;
  sourceHoldingsValueUsd: number;
  scalingMethod: string;
  initialCashUsd: number;
  initialHoldingsValueUsd: number;
  initialTotalValueUsd: number;
  dataQualityStatus: string;
  warnings: string[];
  positions: ScaledBaselinePosition[];
}

export interface StrategyPortfolioInitialization {
  portfolioId: string;
  strategyKey: ExperimentStrategyKey;
  strategyDisplayName: string;
  experimentId: string;
  baselineId: string;
  experimentStartTimestamp: string;
  experimentStartingValueUsd: number;
  initialCashUsd: number;
  initialHoldingsValueUsd: number;
  initialTotalValueUsd: number;
  initialTradeCount: number;
}

export interface FiveStrategyExperimentResult {
  idempotent: boolean;
  experiment: {
    id: string;
    key: string;
    sourcePortfolioId: string;
    name: string;
    targetStartingValueUsd: number;
    status: string;
    paperOnly: boolean;
    liveTradingEnabled: boolean;
    automaticLiveExecutionEnabled: boolean;
    createdAt: string;
  };
  baseline: ScaledBaseline;
  portfolios: StrategyPortfolioInitialization[];
}

export interface StrategyExperimentComparison {
  experiment: FiveStrategyExperimentResult["experiment"];
  baseline: Omit<ScaledBaseline, "positions"> & { initialSymbols: string[] };
  portfolios: Array<{
    portfolioId: string;
    strategyKey: string;
    strategyName: string;
    currentAccountValueUsd: number;
    experimentStartingValueUsd: number;
    experimentGainLossUsd: number;
    experimentReturnPct: number;
    experimentStartTimestamp: string;
    holdingsCount: number;
    tradeCount: number;
    cashUsd: number;
    holdingsValueUsd: number;
    realizedGainLossUsd: number;
    unrealizedGainLossUsd: number;
    feesUsd: number;
    dataStatus: string;
  }>;
}

export interface FiveStrategyDryRunResult {
  generatedAt: string;
  experimentId: string;
  baselineId: string;
  mutating: false;
  portfolios: Array<{
    portfolioId: string;
    strategyKey: string;
    strategyName: string;
    profileKey: string;
    policy: ExperimentStrategyDefinition["parameters"];
    valuationStatus: string;
    marketDataTimestamp: string | null;
    decisions: Array<{
      symbol: string;
      action: string;
      side: "BUY" | "SELL" | null;
      proposedTradeValueUsd: number;
      proposedQuantity: number | null;
      confidence: number;
      reason: string;
      riskAllowed: boolean;
      riskChecks: string[];
      wouldPassExecutionSafeguards: boolean;
      quoteTimestamp: string | null;
      quoteSource: string | null;
      dataFreshness: string;
      marketHoursAllowed: boolean;
    }>;
  }>;
}

interface ExperimentRow {
  id: string;
  experimentKey: string;
  sourcePortfolioId: string;
  name: string;
  targetStartingValueUsd: number;
  status: string;
  paperOnly: number;
  liveTradingEnabled: number;
  automaticLiveExecutionEnabled: number;
  createdAt: string;
}

interface BaselineRow {
  id: string;
  experimentId: string;
  sourcePortfolioId: string;
  createdAt: string;
  frozenValuationTimestamp: string;
  targetValueUsd: number;
  sourceHoldingsValueUsd: number;
  scalingMethod: string;
  initialCashUsd: number;
  initialHoldingsValueUsd: number;
  initialTotalValueUsd: number;
  dataQualityStatus: string;
  warningsJson: string;
}

interface BaselinePositionRow {
  symbol: string;
  assetClass: string;
  sourceQuantity: number;
  sourceCostBasisUsd: number;
  sourceMarketValueUsd: number;
  frozenPriceUsd: number;
  quoteSource: string | null;
  quoteOrigin: string | null;
  quoteStatus: string | null;
  quoteTimestamp: string | null;
  sourceDataStatus: string;
  quantityPrecision: number;
  scaledQuantity: number;
  scaledMarketValueUsd: number;
  experimentCostBasisUsd: number;
}

interface StrategyPortfolioRow {
  portfolioId: string;
  strategyKey: ExperimentStrategyKey;
  strategyDisplayName: string;
  experimentStartTimestamp: string;
  experimentStartingValueUsd: number;
}

interface ExperimentPortfolioStateRow {
  id: string;
  cashUsd: number;
  startingBalanceUsd: number;
}

interface ReadOnlyMarketRow {
  symbol: string;
  assetClass: string;
  source: string;
  priceUsd: number;
  priceAsOf: string;
  volume: number | null;
  candlesJson: string | null;
  createdAt: string;
}

interface AssetPrecisionRow {
  symbol: string;
  quantityPrecision: number | null;
}

export async function initializeFiveStrategyExperiment(
  db: D1Database,
  options: { now?: Date; baselineInput?: FrozenBaselineInput } = {}
): Promise<FiveStrategyExperimentResult> {
  const existing = await getActiveExperiment(db);
  if (existing) {
    return experimentInitializationResult(db, existing, true);
  }

  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const baselineInput = options.baselineInput ?? await frozenBaselineInputFromSource(db, now);
  const baseline = scaleFrozenBaseline(baselineInput, {
    experimentId: FIVE_STRATEGY_EXPERIMENT_ID,
    baselineId: FIVE_STRATEGY_BASELINE_ID,
    experimentStartTimestamp: nowIso,
    targetValueUsd: FIVE_STRATEGY_TARGET_VALUE_USD
  });

  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT OR IGNORE INTO strategy_experiments (
        id, experiment_key, source_portfolio_id, name, target_starting_value_usd,
        status, paper_only, live_trading_enabled, automatic_live_execution_enabled,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'active', 1, 0, 0, ?, ?)`
    ).bind(
      FIVE_STRATEGY_EXPERIMENT_ID,
      FIVE_STRATEGY_EXPERIMENT_KEY,
      baseline.sourcePortfolioId,
      "Tim Real Five-Strategy $400 Paper Experiment",
      baseline.targetValueUsd,
      nowIso,
      nowIso
    ),
    db.prepare(
      `INSERT OR IGNORE INTO strategy_experiment_baselines (
        id, experiment_id, source_portfolio_id, created_at, frozen_valuation_timestamp,
        target_value_usd, source_holdings_value_usd, scaling_method, initial_cash_usd,
        initial_holdings_value_usd, initial_total_value_usd, data_quality_status, warnings_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      baseline.baselineId,
      baseline.experimentId,
      baseline.sourcePortfolioId,
      nowIso,
      baseline.frozenValuationTimestamp,
      baseline.targetValueUsd,
      baseline.sourceHoldingsValueUsd,
      baseline.scalingMethod,
      baseline.initialCashUsd,
      baseline.initialHoldingsValueUsd,
      baseline.initialTotalValueUsd,
      baseline.dataQualityStatus,
      JSON.stringify(baseline.warnings)
    )
  ];

  for (const position of baseline.positions) {
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO strategy_experiment_baseline_positions (
        id, baseline_id, symbol, asset_class, source_quantity, source_cost_basis_usd,
        source_market_value_usd, frozen_price_usd, quote_source, quote_origin,
        quote_status, quote_timestamp, source_data_status, quantity_precision,
        scaled_quantity, scaled_market_value_usd, experiment_cost_basis_usd, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      `baseline_pos_${baseline.baselineId}_${sanitizeId(position.symbol)}`,
      baseline.baselineId,
      position.symbol,
      position.assetClass,
      position.sourceQuantity,
      position.sourceCostBasisUsd,
      position.sourceMarketValueUsd,
      position.frozenPriceUsd,
      position.quoteSource,
      position.quoteOrigin,
      position.quoteStatus,
      position.quoteTimestamp,
      position.dataStatus,
      position.quantityPrecision,
      position.scaledQuantity,
      position.scaledMarketValueUsd,
      position.experimentCostBasisUsd,
      nowIso
    ));
  }

  for (const strategy of FIVE_STRATEGY_DEFINITIONS) {
    const portfolioId = strategyPortfolioId(strategy.key);
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO portfolios (
          id, user_id, broker_account_id, name, cash_usd, starting_balance_usd,
          currency, mode, created_at, updated_at
        ) VALUES (?, 'user_tim', NULL, ?, ?, ?, 'USD', 'paper', ?, ?)`
      ).bind(portfolioId, `${strategy.displayName} Strategy Experiment`, baseline.initialCashUsd, baseline.targetValueUsd, nowIso, nowIso),
      db.prepare(
        `INSERT OR IGNORE INTO linked_portfolio_accounts (
          portfolio_id, account_type, linked_portfolio_id, relationship_label,
          manual_entry_enabled, managed_by_kairox, read_only, created_at, updated_at
        ) VALUES (?, 'paper', NULL, ?, 0, 1, 0, ?, ?)`
      ).bind(portfolioId, "Five-strategy paper experiment portfolio", nowIso, nowIso),
      db.prepare(
        `INSERT OR IGNORE INTO portfolio_profiles (
          id, portfolio_id, profile_key, display_name, philosophy, risk_posture,
          comparison_start_timestamp, comparison_start_equity_usd, normalized_start_index,
          parameters_json, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 100, ?, 0, ?, ?)`
      ).bind(
        `portfolio_profile_${sanitizeId(portfolioId)}`,
        portfolioId,
        `${FIVE_STRATEGY_EXPERIMENT_KEY}_${strategy.key}`,
        strategy.displayName,
        strategy.philosophy,
        strategy.riskPosture,
        baseline.experimentStartTimestamp,
        baseline.targetValueUsd,
        JSON.stringify(strategy.parameters),
        nowIso,
        nowIso
      ),
      db.prepare(
        `INSERT OR IGNORE INTO risk_profiles (
          id, portfolio_id, risk_level, max_position_pct, max_daily_loss_pct,
          leverage_allowed, options_allowed, futures_allowed, live_trading_allowed, created_at
        ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?)`
      ).bind(
        `risk_${sanitizeId(portfolioId)}`,
        portfolioId,
        strategy.riskLevel,
        strategy.maxPositionPct,
        strategy.maxDailyLossPct,
        nowIso
      ),
      db.prepare(
        `INSERT OR IGNORE INTO portfolio_goals (id, portfolio_id, objective, target_description, created_at)
         VALUES (?, ?, 'strategy_experiment', ?, ?)`
      ).bind(
        `goal_${sanitizeId(portfolioId)}_strategy_experiment`,
        portfolioId,
        `Compare ${strategy.displayName} against the same frozen $400 source baseline. Initialization is paper-only and trading activation is separate.`,
        nowIso
      ),
      db.prepare(
        `INSERT OR IGNORE INTO strategy_experiment_portfolios (
          id, experiment_id, baseline_id, portfolio_id, strategy_key,
          strategy_display_name, source_portfolio_id, experiment_start_timestamp,
          experiment_starting_value_usd, parameters_json, profile_enabled,
          paper_only, live_trading_enabled, automatic_live_execution_enabled,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 0, 0, 'initialized', ?, ?)`
      ).bind(
        `strategy_experiment_portfolio_${sanitizeId(strategy.key)}`,
        baseline.experimentId,
        baseline.baselineId,
        portfolioId,
        strategy.key,
        strategy.displayName,
        baseline.sourcePortfolioId,
        baseline.experimentStartTimestamp,
        baseline.targetValueUsd,
        JSON.stringify(strategy.parameters),
        nowIso,
        nowIso
      )
    );

    for (const position of baseline.positions) {
      statements.push(db.prepare(
        `INSERT OR IGNORE INTO positions (
          id, portfolio_id, symbol, asset_class, quantity, avg_entry_price_usd,
          current_price_usd, market_value_usd, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        `${sanitizeId(portfolioId)}_${sanitizeId(position.symbol)}`,
        portfolioId,
        position.symbol,
        position.assetClass,
        position.scaledQuantity,
        position.frozenPriceUsd,
        position.frozenPriceUsd,
        position.scaledMarketValueUsd,
        nowIso
      ));
    }
  }

  await db.batch(statements);
  return experimentInitializationResult(db, await getActiveExperiment(db) as ExperimentRow, false);
}

export function scaleFrozenBaseline(input: FrozenBaselineInput, options: {
  experimentId: string;
  baselineId: string;
  experimentStartTimestamp: string;
  targetValueUsd: number;
}): ScaledBaseline {
  const expected = new Set(EXPECTED_EXPERIMENT_SYMBOLS);
  const symbols = new Set(input.holdings.map((holding) => holding.symbol));
  const missing = [...expected].filter((symbol) => !symbols.has(symbol));
  const extra = [...symbols].filter((symbol) => !expected.has(symbol as typeof EXPECTED_EXPERIMENT_SYMBOLS[number]));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`Experiment source holdings must contain exactly the expected nine symbols. Missing: ${missing.join(", ") || "none"}. Extra: ${extra.join(", ") || "none"}.`);
  }

  const sourceHoldingsValueUsd = roundMoney(input.holdings.reduce((sum, holding) => {
    validateHolding(holding);
    return addMoney(sum, multiplyMoney(holding.frozenPriceUsd, holding.sourceQuantity));
  }, 0));
  if (sourceHoldingsValueUsd <= 0) {
    throw new Error("Experiment source holdings value must be positive.");
  }

  const scaleFactor = options.targetValueUsd / sourceHoldingsValueUsd;
  const positions = input.holdings
    .slice()
    .sort((left, right) => left.symbol.localeCompare(right.symbol))
    .map((holding) => {
      const scaledQuantity = roundQuantity(holding.sourceQuantity * scaleFactor, holding.quantityPrecision);
      const scaledMarketValueUsd = multiplyMoney(holding.frozenPriceUsd, scaledQuantity);
      return {
        ...holding,
        sourceMarketValueUsd: multiplyMoney(holding.frozenPriceUsd, holding.sourceQuantity),
        sourceCostBasisUsd: multiplyMoney(holding.sourceAverageCostUsd, holding.sourceQuantity),
        scaledQuantity,
        scaledMarketValueUsd,
        experimentCostBasisUsd: scaledMarketValueUsd
      };
    });
  const initialHoldingsValueUsd = roundMoney(positions.reduce((sum, position) => addMoney(sum, position.scaledMarketValueUsd), 0));
  const initialCashUsd = cleanZero(subtractMoney(options.targetValueUsd, initialHoldingsValueUsd));
  const initialTotalValueUsd = addMoney(initialHoldingsValueUsd, initialCashUsd);
  const warnings = baselineWarnings(input, initialCashUsd);
  if (initialCashUsd < 0 || initialTotalValueUsd !== roundMoney(options.targetValueUsd)) {
    throw new Error("Scaled experiment initialization did not produce the exact target account value.");
  }

  return {
    experimentId: options.experimentId,
    baselineId: options.baselineId,
    sourcePortfolioId: input.sourcePortfolioId,
    experimentStartTimestamp: options.experimentStartTimestamp,
    frozenValuationTimestamp: input.valuationTimestamp,
    targetValueUsd: roundMoney(options.targetValueUsd),
    sourceHoldingsValueUsd,
    scalingMethod: "proportional_source_holdings_scaled_to_target_with_precision_cash_residual",
    initialCashUsd,
    initialHoldingsValueUsd,
    initialTotalValueUsd,
    dataQualityStatus: input.dataStatus,
    warnings,
    positions
  };
}

export async function getFiveStrategyExperimentComparison(db: D1Database): Promise<StrategyExperimentComparison> {
  const experiment = await getActiveExperiment(db);
  if (!experiment) {
    throw new Error("No active five-strategy experiment has been initialized.");
  }
  const [baseline, positions, strategyRows] = await Promise.all([
    getBaseline(db, experiment.id),
    getBaselinePositions(db, FIVE_STRATEGY_BASELINE_ID),
    getStrategyPortfolioRows(db, experiment.id)
  ]);
  const portfolios = await Promise.all(strategyRows.map(async (row) => {
    const [valuation, counts] = await Promise.all([
      getPortfolioValuation(db, row.portfolioId),
      db.prepare(
        `SELECT
          (SELECT COUNT(*) FROM positions WHERE portfolio_id = ? AND quantity > 0) AS holdingsCount,
          (SELECT COUNT(*) FROM trades WHERE portfolio_id = ?) AS tradeCount`
      ).bind(row.portfolioId, row.portfolioId).first<{ holdingsCount: number; tradeCount: number }>()
    ]);
    const gainLoss = subtractMoney(valuation.totalAccountValueUsd, row.experimentStartingValueUsd);
    return {
      portfolioId: row.portfolioId,
      strategyKey: row.strategyKey,
      strategyName: row.strategyDisplayName,
      currentAccountValueUsd: valuation.totalAccountValueUsd,
      experimentStartingValueUsd: row.experimentStartingValueUsd,
      experimentGainLossUsd: gainLoss,
      experimentReturnPct: row.experimentStartingValueUsd > 0 ? roundRatio(gainLoss / row.experimentStartingValueUsd) : 0,
      experimentStartTimestamp: row.experimentStartTimestamp,
      holdingsCount: counts?.holdingsCount ?? 0,
      tradeCount: counts?.tradeCount ?? 0,
      cashUsd: valuation.cashUsd,
      holdingsValueUsd: valuation.totalPortfolioValueUsd,
      realizedGainLossUsd: valuation.realizedProfitLossUsd,
      unrealizedGainLossUsd: valuation.unrealizedProfitLossUsd,
      feesUsd: valuation.feesUsd,
      dataStatus: valuation.dataStatus
    };
  }));

  return {
    experiment: mapExperimentRow(experiment),
    baseline: {
      ...mapBaselineRow(baseline, positions),
      initialSymbols: positions.map((position) => position.symbol)
    },
    portfolios
  };
}

export async function getFiveStrategyExperimentDryRun(db: D1Database, now = new Date()): Promise<FiveStrategyDryRunResult> {
  const experiment = await getActiveExperiment(db);
  if (!experiment) {
    throw new Error("No active five-strategy experiment has been initialized.");
  }
  const strategyRows = await getStrategyPortfolioRows(db, experiment.id);
  const portfolios = [];
  for (const row of strategyRows) {
    const profile = await getPortfolioProfile(db, row.portfolioId);
    const valuation = await getPortfolioValuation(db, row.portfolioId, now);
    const universe = await resolvePaperCandidateUniverse(db, row.portfolioId);
    const portfolioRow = await getExperimentPortfolioRow(db, row.portfolioId);
    const policy = await getInvestmentPolicy(db, row.portfolioId);
    const decisions = [];
    for (const asset of universe.assets) {
      const marketData = await latestReadOnlyMarketData(db, asset, now);
      const position = valuation.positions.find((item) => item.symbol === asset.symbol);
      const prices = marketData.validated ? new Map([[asset.symbol, marketData.priceUsd]]) : new Map<string, number>();
      const portfolioState = await calculatePortfolioState(db, portfolioRow, prices, row.portfolioId);
      const exposure = exposureForAsset(asset, valuation.positions.map((item) => ({
        id: `dry_run_${row.portfolioId}_${item.symbol}`,
        symbol: item.symbol,
        assetClass: item.assetClass,
        quantity: item.quantity,
        avgEntryPriceUsd: item.averageCostBasisUsd,
        currentPriceUsd: item.currentMarketPriceUsd ?? item.averageCostBasisUsd,
        marketValueUsd: item.currentPositionValueUsd
      })), portfolioState.totalValueUsd, portfolioState.drawdownPct);
      const screen = screenAsset({ asset, marketData, now, exposure });
      const baseDecision = screen.eligible
        ? applyDryRunProfilePolicy(decidePaperAction({ marketData, hasPosition: !!position && position.quantity > 0 }), profile)
        : dryRunScreenedOutDecision(marketData, screen.reason);
      const side = baseDecision.action === "BUY" || baseDecision.action === "SELL" ? baseDecision.action : null;
      const proposedTradeValueUsd = baseDecision.action === "BUY"
        ? Math.min(portfolioState.totalValueUsd * profile.parameters.maxNewTradePct, Math.max(0, portfolioState.cashUsd - portfolioState.totalValueUsd * profile.parameters.cashReservePct))
        : baseDecision.action === "SELL" ? position?.currentPositionValueUsd ?? 0 : 0;
      const marketHours = canExecuteAt(asset.assetType, now, asset.marketHoursMode);
      const executionGateReasons = [];
      if (side && !marketHours.allowed && marketHours.reason) executionGateReasons.push(marketHours.reason);
      if (side && !asset.tradable) executionGateReasons.push(`${asset.symbol} is tracked but not enabled for production paper execution.`);
      const risk = assessPaperTrade({
        action: baseDecision.action,
        marketData,
        portfolioValueUsd: portfolioState.totalValueUsd,
        cashUsd: portfolioState.cashUsd,
        currentPositionValueUsd: position?.currentPositionValueUsd ?? 0,
        proposedTradeValueUsd,
        drawdownPct: portfolioState.drawdownPct,
        duplicateSignal: await hasDryRunProcessedSignal(db, row.portfolioId, baseDecision.signalKey),
        openedNewPositionThisRun: false,
        hasPosition: !!position && position.quantity > 0,
        maxNewTradePct: profile.parameters.maxNewTradePct,
        maxPositionPct: profile.parameters.maxPositionPct,
        drawdownBlockPct: profile.parameters.drawdownBlockPct,
        investmentPolicy: policy,
        orderIntent: baseDecision.action === "SELL" ? "long_sell" : "long_buy"
      });
      const riskChecks = [...risk.reasons, ...executionGateReasons];
      const riskAllowed = risk.allowed && executionGateReasons.length === 0;
      decisions.push({
        symbol: asset.symbol,
        action: riskAllowed ? baseDecision.action : "DO_NOTHING",
        side,
        proposedTradeValueUsd: roundMoney(proposedTradeValueUsd),
        proposedQuantity: side && marketData.priceUsd > 0 ? roundRatio(proposedTradeValueUsd / marketData.priceUsd) : null,
        confidence: baseDecision.confidenceScore,
        reason: riskAllowed ? baseDecision.explanation : `Risk checks blocked execution: ${riskChecks.join(" ")}`,
        riskAllowed,
        riskChecks,
        wouldPassExecutionSafeguards: riskAllowed && side !== null,
        quoteTimestamp: marketData.asOf,
        quoteSource: marketData.source,
        dataFreshness: marketData.quality ?? (marketData.stale ? "stale" : "fresh"),
        marketHoursAllowed: marketHours.allowed
      });
    }
    portfolios.push({
      portfolioId: row.portfolioId,
      strategyKey: row.strategyKey,
      strategyName: row.strategyDisplayName,
      profileKey: profile.profileKey,
      policy: profile.parameters as ExperimentStrategyDefinition["parameters"],
      valuationStatus: valuation.dataStatus,
      marketDataTimestamp: latestTimestamp(decisions.map((decision) => decision.quoteTimestamp)),
      decisions
    });
  }
  return {
    generatedAt: now.toISOString(),
    experimentId: experiment.id,
    baselineId: FIVE_STRATEGY_BASELINE_ID,
    mutating: false,
    portfolios
  };
}

export async function renderFiveStrategyExperimentHtml(db: D1Database): Promise<Response> {
  const experiment = await getActiveExperiment(db);
  if (!experiment) {
    return new Response(renderUninitializedExperimentHtml(), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }
  const comparison = await getFiveStrategyExperimentComparison(db);
  return new Response(renderComparisonHtml(comparison), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

async function frozenBaselineInputFromSource(db: D1Database, now: Date): Promise<FrozenBaselineInput> {
  const valuation = await getPortfolioValuation(db, FIVE_STRATEGY_SOURCE_PORTFOLIO_ID, now);
  const precision = await quantityPrecisionBySymbol(db);
  return frozenBaselineInputFromValuation(valuation, precision);
}

export function frozenBaselineInputFromValuation(valuation: PortfolioValuation, precision: Map<string, number>): FrozenBaselineInput {
  return {
    sourcePortfolioId: valuation.portfolioId,
    valuationTimestamp: valuation.valuationTimestamp,
    dataStatus: valuation.dataStatus,
    holdings: valuation.positions.map((position) => sourceHoldingFromValuedPosition(position, precision.get(position.symbol) ?? defaultPrecision(position.assetClass)))
  };
}

function sourceHoldingFromValuedPosition(position: ValuedPosition, quantityPrecision: number): FrozenSourceHoldingInput {
  if (!position.currentMarketPriceUsd || position.currentMarketPriceUsd <= 0) {
    throw new Error(`${position.symbol} does not have a usable baseline price.`);
  }
  if (!position.priceTimestamp || !position.priceSource) {
    throw new Error(`${position.symbol} does not have a quote timestamp and source for frozen baseline creation.`);
  }
  return {
    symbol: position.symbol,
    assetClass: position.assetClass,
    sourceQuantity: position.quantity,
    sourceAverageCostUsd: position.averageCostBasisUsd,
    frozenPriceUsd: position.currentMarketPriceUsd,
    quoteSource: position.priceSource,
    quoteOrigin: position.quoteOrigin,
    quoteStatus: position.quoteStatus,
    quoteTimestamp: position.priceTimestamp,
    dataStatus: position.dataStatus,
    quantityPrecision
  };
}

async function quantityPrecisionBySymbol(db: D1Database): Promise<Map<string, number>> {
  const rows = await listRows<AssetPrecisionRow>(
    db.prepare("SELECT symbol, quantity_precision AS quantityPrecision FROM assets")
  );
  return new Map(rows.map((row) => [row.symbol, row.quantityPrecision ?? defaultPrecision("stock")]));
}

async function getActiveExperiment(db: D1Database): Promise<ExperimentRow | null> {
  return db.prepare(
    `SELECT id, experiment_key AS experimentKey, source_portfolio_id AS sourcePortfolioId,
      name, target_starting_value_usd AS targetStartingValueUsd, status,
      paper_only AS paperOnly, live_trading_enabled AS liveTradingEnabled,
      automatic_live_execution_enabled AS automaticLiveExecutionEnabled,
      created_at AS createdAt
     FROM strategy_experiments
     WHERE experiment_key = ? AND status = 'active'
     LIMIT 1`
  ).bind(FIVE_STRATEGY_EXPERIMENT_KEY).first<ExperimentRow>();
}

async function getBaseline(db: D1Database, experimentId: string): Promise<BaselineRow> {
  const baseline = await db.prepare(
    `SELECT id, experiment_id AS experimentId, source_portfolio_id AS sourcePortfolioId,
      created_at AS createdAt, frozen_valuation_timestamp AS frozenValuationTimestamp,
      target_value_usd AS targetValueUsd, source_holdings_value_usd AS sourceHoldingsValueUsd,
      scaling_method AS scalingMethod, initial_cash_usd AS initialCashUsd,
      initial_holdings_value_usd AS initialHoldingsValueUsd,
      initial_total_value_usd AS initialTotalValueUsd, data_quality_status AS dataQualityStatus,
      warnings_json AS warningsJson
     FROM strategy_experiment_baselines
     WHERE experiment_id = ?
     LIMIT 1`
  ).bind(experimentId).first<BaselineRow>();
  if (!baseline) {
    throw new Error("Strategy experiment baseline is missing.");
  }
  return baseline;
}

async function getBaselinePositions(db: D1Database, baselineId: string): Promise<BaselinePositionRow[]> {
  return listRows<BaselinePositionRow>(
    db.prepare(
      `SELECT symbol, asset_class AS assetClass, source_quantity AS sourceQuantity,
        source_cost_basis_usd AS sourceCostBasisUsd, source_market_value_usd AS sourceMarketValueUsd,
        frozen_price_usd AS frozenPriceUsd, quote_source AS quoteSource,
        quote_origin AS quoteOrigin, quote_status AS quoteStatus, quote_timestamp AS quoteTimestamp,
        source_data_status AS sourceDataStatus, quantity_precision AS quantityPrecision,
        scaled_quantity AS scaledQuantity, scaled_market_value_usd AS scaledMarketValueUsd,
        experiment_cost_basis_usd AS experimentCostBasisUsd
       FROM strategy_experiment_baseline_positions
       WHERE baseline_id = ?
       ORDER BY symbol`
    ).bind(baselineId)
  );
}

async function getStrategyPortfolioRows(db: D1Database, experimentId: string): Promise<StrategyPortfolioRow[]> {
  return listRows<StrategyPortfolioRow>(
    db.prepare(
      `SELECT portfolio_id AS portfolioId, strategy_key AS strategyKey,
        strategy_display_name AS strategyDisplayName,
        experiment_start_timestamp AS experimentStartTimestamp,
        experiment_starting_value_usd AS experimentStartingValueUsd
       FROM strategy_experiment_portfolios
       WHERE experiment_id = ?
       ORDER BY CASE strategy_key
         WHEN 'guardian' THEN 1
         WHEN 'balanced' THEN 2
         WHEN 'growth' THEN 3
         WHEN 'aggressive' THEN 4
         WHEN 'hyperactive' THEN 5
         ELSE 99
       END`
    ).bind(experimentId)
  );
}

async function getExperimentPortfolioRow(db: D1Database, portfolioId: string): Promise<ExperimentPortfolioStateRow> {
  const row = await db.prepare(
    `SELECT id, cash_usd AS cashUsd, starting_balance_usd AS startingBalanceUsd
     FROM portfolios
     WHERE id = ?`
  ).bind(portfolioId).first<ExperimentPortfolioStateRow>();
  if (!row) {
    throw new Error(`Experiment portfolio is missing: ${portfolioId}`);
  }
  return row;
}

async function latestReadOnlyMarketData(db: D1Database, asset: AssetRegistryRecord, now: Date): Promise<MarketDataset> {
  const row = await db.prepare(
    `SELECT symbol, asset_class AS assetClass, source, price_usd AS priceUsd,
      price_as_of AS priceAsOf, volume, candles_json AS candlesJson, created_at AS createdAt
     FROM market_snapshots
     WHERE symbol = ? AND validation_status = 'validated' AND price_usd > 0
     ORDER BY created_at DESC
     LIMIT 1`
  ).bind(asset.symbol).first<ReadOnlyMarketRow>();
  if (!row) {
    return {
      symbol: asset.symbol,
      assetClass: asset.assetType,
      priceUsd: 0,
      asOf: nullTimestamp(now),
      source: "none",
      validated: false,
      stale: true,
      candles: [],
      status: "unavailable",
      quality: "invalid",
      userMessage: "No trusted read-only market snapshot is available for dry-run evaluation.",
      error: "No trusted read-only market snapshot is available for dry-run evaluation."
    };
  }
  const ageSeconds = Math.max(0, Math.floor((now.getTime() - new Date(row.createdAt).getTime()) / 1000));
  const maxAgeSeconds = asset.assetType === "crypto" ? 30 * 60 : 4 * 24 * 60 * 60;
  const stale = ageSeconds > maxAgeSeconds;
  return {
    symbol: asset.symbol,
    assetClass: asset.assetType,
    priceUsd: row.priceUsd,
    asOf: row.priceAsOf,
    source: row.source,
    validated: !stale,
    stale,
    volume: row.volume ?? undefined,
    candles: parseCandles(row.candlesJson),
    status: stale ? "deferred" : "cached",
    quality: stale ? "stale" : "acceptable_cached",
    userMessage: stale ? "Trusted snapshot is too old for dry-run execution approval." : "Using trusted read-only market snapshot for dry-run evaluation.",
    error: stale ? "Trusted snapshot is too old for dry-run execution approval." : undefined
  };
}

function applyDryRunProfilePolicy(decision: StrategyDecision, profile: PortfolioProfile): StrategyDecision {
  const threshold = decision.action === "SELL" ? profile.parameters.sellThreshold : profile.parameters.buyThreshold;
  if ((decision.action !== "BUY" && decision.action !== "SELL") || decision.confidenceScore >= threshold) {
    return decision;
  }
  return {
    ...decision,
    action: "DO_NOTHING",
    confidenceScore: Math.max(decision.confidenceScore, 0.75),
    riskScore: 0.05,
    explanation: `${profile.displayName} requires at least ${Math.round(threshold * 100)}% confidence for ${decision.action}.`
  };
}

function dryRunScreenedOutDecision(marketData: MarketDataset, reason: string): StrategyDecision {
  return {
    symbol: marketData.symbol,
    action: "DO_NOTHING",
    confidenceScore: 0.9,
    riskScore: 0.05,
    indicators: calculateIndicators(marketData.candles),
    explanation: reason,
    signalKey: `${marketData.symbol}:DO_NOTHING:dry-run:${marketData.asOf}:${reason.slice(0, 48)}`,
    transactionCostEstimateUsd: 0
  };
}

async function hasDryRunProcessedSignal(db: D1Database, portfolioId: string, signalKey: string): Promise<boolean> {
  const row = await db.prepare("SELECT id FROM trades WHERE portfolio_id = ? AND signal_key = ? LIMIT 1").bind(portfolioId, signalKey).first<{ id: string }>();
  return !!row;
}

function latestTimestamp(values: Array<string | null>): string | null {
  return values.filter(Boolean).sort().at(-1) ?? null;
}

function parseCandles(value: string | null): MarketCandle[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as MarketCandle[] : [];
  } catch {
    return [];
  }
}

function nullTimestamp(now: Date): string {
  return now.toISOString();
}

async function experimentInitializationResult(db: D1Database, experiment: ExperimentRow, idempotent: boolean): Promise<FiveStrategyExperimentResult> {
  const [baselineRow, baselinePositions, strategyRows] = await Promise.all([
    getBaseline(db, experiment.id),
    getBaselinePositions(db, FIVE_STRATEGY_BASELINE_ID),
    getStrategyPortfolioRows(db, experiment.id)
  ]);
  const baseline = mapBaselineRow(baselineRow, baselinePositions);
  return {
    idempotent,
    experiment: mapExperimentRow(experiment),
    baseline,
    portfolios: strategyRows.map((row) => ({
      portfolioId: row.portfolioId,
      strategyKey: row.strategyKey,
      strategyDisplayName: row.strategyDisplayName,
      experimentId: experiment.id,
      baselineId: baseline.baselineId,
      experimentStartTimestamp: row.experimentStartTimestamp,
      experimentStartingValueUsd: row.experimentStartingValueUsd,
      initialCashUsd: baseline.initialCashUsd,
      initialHoldingsValueUsd: baseline.initialHoldingsValueUsd,
      initialTotalValueUsd: baseline.initialTotalValueUsd,
      initialTradeCount: 0
    }))
  };
}

function mapExperimentRow(row: ExperimentRow): FiveStrategyExperimentResult["experiment"] {
  return {
    id: row.id,
    key: row.experimentKey,
    sourcePortfolioId: row.sourcePortfolioId,
    name: row.name,
    targetStartingValueUsd: row.targetStartingValueUsd,
    status: row.status,
    paperOnly: row.paperOnly === 1,
    liveTradingEnabled: row.liveTradingEnabled === 1,
    automaticLiveExecutionEnabled: row.automaticLiveExecutionEnabled === 1,
    createdAt: row.createdAt
  };
}

function mapBaselineRow(row: BaselineRow, positions: BaselinePositionRow[]): ScaledBaseline {
  return {
    experimentId: row.experimentId,
    baselineId: row.id,
    sourcePortfolioId: row.sourcePortfolioId,
    experimentStartTimestamp: row.createdAt,
    frozenValuationTimestamp: row.frozenValuationTimestamp,
    targetValueUsd: row.targetValueUsd,
    sourceHoldingsValueUsd: row.sourceHoldingsValueUsd,
    scalingMethod: row.scalingMethod,
    initialCashUsd: row.initialCashUsd,
    initialHoldingsValueUsd: row.initialHoldingsValueUsd,
    initialTotalValueUsd: row.initialTotalValueUsd,
    dataQualityStatus: row.dataQualityStatus,
    warnings: parseJsonArray(row.warningsJson),
    positions: positions.map((position) => ({
      symbol: position.symbol,
      assetClass: position.assetClass,
      sourceQuantity: position.sourceQuantity,
      sourceAverageCostUsd: position.sourceQuantity > 0 ? roundMoney(position.sourceCostBasisUsd / position.sourceQuantity) : 0,
      frozenPriceUsd: position.frozenPriceUsd,
      quoteSource: position.quoteSource,
      quoteOrigin: position.quoteOrigin,
      quoteStatus: position.quoteStatus,
      quoteTimestamp: position.quoteTimestamp,
      dataStatus: position.sourceDataStatus,
      quantityPrecision: position.quantityPrecision,
      sourceMarketValueUsd: position.sourceMarketValueUsd,
      sourceCostBasisUsd: position.sourceCostBasisUsd,
      scaledQuantity: position.scaledQuantity,
      scaledMarketValueUsd: position.scaledMarketValueUsd,
      experimentCostBasisUsd: position.experimentCostBasisUsd
    }))
  };
}

function renderUninitializedExperimentHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Five-Strategy Experiment - Kairox</title>
  <style>
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; background: #f7f8fa; color: #17202a; }
    header { background: #101827; color: #fff; padding: 22px 24px; }
    main { max-width: 860px; margin: 0 auto; padding: 22px 18px 48px; }
    .panel { background: #fff; border: 1px solid #dde4ec; border-radius: 8px; padding: 16px; }
    .label { color: #667488; font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; }
    .value { font-size: 1.1rem; font-weight: 760; margin-top: 4px; }
  </style>
</head>
<body>
  <header>
    <h1>Five-Strategy Experiment</h1>
    <p>Paper-only comparison from one frozen source baseline.</p>
  </header>
  <main>
    <section class="panel">
      <div class="label">Experiment status</div>
      <div class="value">No active five-strategy experiment has been initialized yet.</div>
      <p>Initialization is a separate protected operation. No strategy portfolios, frozen prices, scaled quantities, or experiment baseline values exist yet.</p>
    </section>
  </main>
</body>
</html>`;
}

function baselineWarnings(input: FrozenBaselineInput, cashUsd: number): string[] {
  const warnings: string[] = [];
  for (const holding of input.holdings) {
    if (holding.dataStatus !== "live" && holding.dataStatus !== "delayed") {
      warnings.push(`${holding.symbol} baseline quote status is ${holding.dataStatus}.`);
    }
    if (holding.assetClass === "mutual_fund") {
      warnings.push(`${holding.symbol} uses the latest available published NAV and should not be treated as intraday pricing.`);
    }
    if (!holding.quoteTimestamp) {
      warnings.push(`${holding.symbol} baseline quote timestamp is unavailable.`);
    }
  }
  if (cashUsd >= 0.005) {
    warnings.push(`Quantity precision left ${formatCurrency(cashUsd)} as initial cash.`);
  }
  return [...new Set(warnings)];
}

function validateHolding(holding: FrozenSourceHoldingInput): void {
  if (!Number.isFinite(holding.sourceQuantity) || holding.sourceQuantity <= 0) {
    throw new Error(`${holding.symbol} must have a positive source quantity.`);
  }
  if (!Number.isFinite(holding.frozenPriceUsd) || holding.frozenPriceUsd <= 0) {
    throw new Error(`${holding.symbol} must have a positive frozen price.`);
  }
}

function strategyPortfolioId(strategyKey: string): string {
  return `portfolio_experiment_${FIVE_STRATEGY_EXPERIMENT_ID.replace(/^experiment_/, "")}_${strategyKey}`;
}

function roundQuantity(value: number, precision: number): number {
  const scale = 10 ** Math.max(0, Math.min(12, precision));
  return Math.floor(value * scale) / scale;
}

function cleanZero(value: number): number {
  return Math.abs(value) < 0.00005 ? 0 : roundMoney(value);
}

function defaultPrecision(assetClass: string): number {
  return assetClass === "crypto" ? 8 : 6;
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function sanitizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96) || "item";
}

export function renderComparisonHtml(comparison: StrategyExperimentComparison): string {
  const rows = comparison.portfolios.map((portfolio) => `<tr>
    <td>${escapeHtml(portfolio.strategyName)}</td>
    <td>${escapeHtml(formatCurrency(portfolio.currentAccountValueUsd))}</td>
    <td>${escapeHtml(formatCurrency(portfolio.experimentStartingValueUsd))}</td>
    <td>${escapeHtml(formatSignedCurrency(portfolio.experimentGainLossUsd))}</td>
    <td>${escapeHtml(formatSignedPercent(portfolio.experimentReturnPct))}</td>
    <td>${escapeHtml(portfolio.experimentStartTimestamp)}</td>
    <td>${portfolio.holdingsCount}</td>
    <td>${portfolio.tradeCount}</td>
    <td>${escapeHtml(formatCurrency(portfolio.cashUsd))}</td>
    <td>${escapeHtml(formatCurrency(portfolio.holdingsValueUsd))}</td>
    <td>${escapeHtml(formatSignedCurrency(portfolio.realizedGainLossUsd))}</td>
    <td>${escapeHtml(formatSignedCurrency(portfolio.unrealizedGainLossUsd))}</td>
    <td>${escapeHtml(formatCurrency(portfolio.feesUsd))}</td>
    <td>${escapeHtml(portfolio.dataStatus)}</td>
  </tr>`).join("");
  const warnings = comparison.baseline.warnings.length
    ? `<ul>${comparison.baseline.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`
    : "<p>No baseline warnings recorded.</p>";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Five-Strategy Experiment - Kairox</title>
  <style>
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; background: #f7f8fa; color: #17202a; }
    header { background: #101827; color: #fff; padding: 22px 24px; }
    main { max-width: 1180px; margin: 0 auto; padding: 22px 18px 48px; display: grid; gap: 16px; }
    h1, h2 { margin: 0 0 10px; }
    .panel { background: #fff; border: 1px solid #dde4ec; border-radius: 8px; padding: 16px; overflow-x: auto; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(170px, 1fr)); gap: 12px; }
    .metric { border: 1px solid #edf1f5; border-radius: 8px; padding: 12px; }
    .label { color: #667488; font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; }
    .value { font-size: 1.15rem; font-weight: 760; overflow-wrap: anywhere; }
    table { width: 100%; border-collapse: collapse; min-width: 980px; }
    th, td { text-align: left; border-bottom: 1px solid #edf1f5; padding: 10px 8px; vertical-align: top; }
    th { color: #3b4758; font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; }
    .muted { color: #667488; }
    @media (max-width: 780px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <h1>Five-Strategy Experiment</h1>
    <p>Paper-only comparison from one frozen source baseline. Trading activation is separate from initialization.</p>
  </header>
  <main>
    <section class="panel">
      <h2>Shared Experiment Baseline</h2>
      <div class="grid">
        ${metric("Experiment ID", comparison.experiment.id)}
        ${metric("Source portfolio", comparison.experiment.sourcePortfolioId)}
        ${metric("Baseline ID", comparison.baseline.baselineId)}
        ${metric("Frozen baseline timestamp", comparison.baseline.frozenValuationTimestamp)}
        ${metric("Initial symbols", String(comparison.baseline.initialSymbols.length))}
        ${metric("Experiment starting value", formatCurrency(comparison.baseline.targetValueUsd))}
        ${metric("Initial cash", formatCurrency(comparison.baseline.initialCashUsd))}
        ${metric("Paper-only status", comparison.experiment.paperOnly && !comparison.experiment.liveTradingEnabled && !comparison.experiment.automaticLiveExecutionEnabled ? "Paper only" : "Unsafe")}
      </div>
    </section>
    <section class="panel">
      <h2>Strategy Comparison</h2>
      <table>
        <thead><tr><th>Strategy</th><th>Current value</th><th>Experiment starting value</th><th>Gain/loss since experiment start</th><th>Return since experiment start</th><th>Experiment start timestamp</th><th>Holdings</th><th>Trades</th><th>Cash</th><th>Holdings value</th><th>Realized</th><th>Unrealized</th><th>Fees</th><th>Data</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
    <section class="panel">
      <h2>Baseline Data Quality</h2>
      ${warnings}
      <p class="muted">Frozen baseline prices are immutable experiment inputs; later quote refreshes affect current valuation only.</p>
    </section>
  </main>
</body>
</html>`;
}

function metric(label: string, value: string): string {
  return `<div class="metric"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char] ?? char));
}
