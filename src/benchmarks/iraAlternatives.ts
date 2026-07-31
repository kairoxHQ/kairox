import { canExecuteAt } from "../market/hours.ts";
import type { AssetRegistryRecord } from "../market/assets.ts";
import { listRows, TIM_USER_ID } from "../shared/db.ts";
import type { MarketCandle, MarketDataset } from "../shared/types.ts";
import type { NormalizedQuote } from "../market/service.ts";
import { getInvestmentPolicy } from "../policies/investmentPolicy.ts";
import { getPortfolioProfile, type PortfolioProfile } from "../portfolio/profiles.ts";
import { assessPaperTrade } from "../risk/checks.ts";
import { decidePaperAction, type StrategyDecision } from "../strategy/paperStrategy.ts";
import { calculateIndicators } from "../strategy/indicators.ts";
import { rankOpportunities, screenAsset, type RankedOpportunity, type ScreenResult } from "../strategy/screener.ts";

export const IRA_ALTERNATIVES_COMPARISON_ID = "ira_alternatives_2400_v1";
export const IRA_ALTERNATIVES_BASELINE_ID = "ira_alternatives_2400_baseline_v1";
export const IRA_ALTERNATIVES_STARTING_VALUE_USD = 2400;

export const IRA_ALTERNATIVE_BENCHMARKS = [
  {
    id: "benchmark_ira_share_150apy_2400_v1",
    key: "ira_share_150apy",
    displayName: "Actual IRA Share Account",
    type: "bank_share",
    apy: 0.015,
    liquidityClassification: "cash_share_account",
    lockTermMonths: null,
    earlyWithdrawalPenaltyStatus: "not_applicable",
    summary: "Modeled cash benchmark using 1.50% APY. This benchmark does not trade."
  },
  {
    id: "benchmark_ira_certificate_370apy_2400_v1",
    key: "ira_certificate_370apy",
    displayName: "12-Month IRA Certificate",
    type: "bank_certificate",
    apy: 0.037,
    liquidityClassification: "locked_certificate",
    lockTermMonths: 12,
    earlyWithdrawalPenaltyStatus: "unknown",
    summary: "Modeled 12-month IRA certificate benchmark using 3.70% APY. Early-withdrawal penalty is unknown and unconfigured."
  }
] as const;

export const IRA_ALTERNATIVE_STRATEGIES = [
  {
    key: "conservative",
    displayName: "Conservative IRA Strategy",
    portfolioId: "portfolio_ira_alternatives_2400_v1_conservative",
    philosophy: "Prioritize capital preservation, cautious income, low turnover, and retirement-account practicality.",
    riskPosture: "conservative",
    riskLevel: "low",
    maxPositionPct: 0.2,
    maxDailyLossPct: 0.015,
    parameters: {
      minConfidence: 0.72,
      maxNewTradePct: 0.08,
      maxPositionPct: 0.2,
      cashReservePct: 0.1,
      drawdownBlockPct: 0.05,
      concentrationMultiplier: 0.6,
      cryptoPreference: 0,
      dividendPreference: 1.35,
      turnoverLimitPct: 0.06,
      decisionCadence: "low",
      buyThreshold: 0.72,
      sellThreshold: 0.7,
      rebalanceThresholdPct: 0.08,
      maxTradesPerCycle: 1,
      maxTradesPerDay: 1,
      cooldownMinutes: 1440,
      feeRate: 0.001,
      slippageBps: 15,
      volatilityWeight: 1.4,
      momentumWeight: 0.45,
      trendWeight: 0.6,
      macroWeight: 0.8,
      geopoliticalWeight: 0.3
    },
    assetUniverse: {
      currentlySupportedAllowlist: ["BND", "SCHD", "VTI", "VOO", "SPY"],
      futureTreasuryWatchlist: ["SGOV", "BIL", "SHV", "VGSH", "SCHO"],
      futureTreasurySupportStatus: "not_activated_without_registry_and_provider_verification"
    }
  },
  {
    key: "guardian",
    displayName: "Guardian Strategy",
    portfolioId: "portfolio_ira_alternatives_2400_v1_guardian",
    philosophy: "Favor defensive decisions, high confidence, and limited trade size before taking risk.",
    riskPosture: "defensive",
    riskLevel: "low",
    maxPositionPct: 0.18,
    maxDailyLossPct: 0.0125,
    parameters: {
      minConfidence: 0.8,
      maxNewTradePct: 0.05,
      maxPositionPct: 0.18,
      cashReservePct: 0.2,
      drawdownBlockPct: 0.04,
      concentrationMultiplier: 0.5,
      cryptoPreference: 0,
      dividendPreference: 1.15,
      turnoverLimitPct: 0.04,
      decisionCadence: "low",
      buyThreshold: 0.78,
      sellThreshold: 0.74,
      rebalanceThresholdPct: 0.1,
      maxTradesPerCycle: 1,
      maxTradesPerDay: 1,
      cooldownMinutes: 2880,
      feeRate: 0.001,
      slippageBps: 12,
      volatilityWeight: 1.6,
      momentumWeight: 0.35,
      trendWeight: 0.45,
      macroWeight: 0.9,
      geopoliticalWeight: 0.45
    },
    assetUniverse: {
      currentlySupportedAllowlist: ["BND", "SCHD", "VTI", "VOO", "SPY"],
      futureTreasuryWatchlist: ["SGOV", "BIL", "SHV", "VGSH", "SCHO"],
      futureTreasurySupportStatus: "not_activated_without_registry_and_provider_verification"
    }
  },
  {
    key: "growth",
    displayName: "Growth Strategy",
    portfolioId: "portfolio_ira_alternatives_2400_v1_growth",
    philosophy: "Seek measured growth with larger equity exposure while preserving IRA paper-only controls.",
    riskPosture: "growth",
    riskLevel: "medium",
    maxPositionPct: 0.35,
    maxDailyLossPct: 0.025,
    parameters: {
      minConfidence: 0.6,
      maxNewTradePct: 0.12,
      maxPositionPct: 0.35,
      cashReservePct: 0.05,
      drawdownBlockPct: 0.11,
      concentrationMultiplier: 1,
      cryptoPreference: 0,
      dividendPreference: 0.9,
      turnoverLimitPct: 0.12,
      decisionCadence: "normal",
      buyThreshold: 0.6,
      sellThreshold: 0.6,
      rebalanceThresholdPct: 0.06,
      maxTradesPerCycle: 1,
      maxTradesPerDay: 2,
      cooldownMinutes: 720,
      feeRate: 0.001,
      slippageBps: 25,
      volatilityWeight: 0.9,
      momentumWeight: 1.05,
      trendWeight: 1.1,
      macroWeight: 0.4,
      geopoliticalWeight: 0.15
    },
    assetUniverse: {
      currentlySupportedAllowlist: ["BND", "SCHD", "VTI", "VOO", "SPY"],
      futureTreasuryWatchlist: ["SGOV", "BIL", "SHV", "VGSH", "SCHO"],
      futureTreasurySupportStatus: "not_activated_without_registry_and_provider_verification"
    }
  },
  {
    key: "aggressive",
    displayName: "Aggressive Strategy",
    portfolioId: "portfolio_ira_alternatives_2400_v1_aggressive",
    philosophy: "Paper-test higher turnover and larger allocations without live execution, leverage, options, margin, or futures.",
    riskPosture: "aggressive",
    riskLevel: "high",
    maxPositionPct: 0.5,
    maxDailyLossPct: 0.04,
    parameters: {
      minConfidence: 0.5,
      maxNewTradePct: 0.2,
      maxPositionPct: 0.5,
      cashReservePct: 0.02,
      drawdownBlockPct: 0.2,
      concentrationMultiplier: 1.4,
      cryptoPreference: 0,
      dividendPreference: 0.6,
      turnoverLimitPct: 0.24,
      decisionCadence: "fast",
      buyThreshold: 0.52,
      sellThreshold: 0.52,
      rebalanceThresholdPct: 0.04,
      maxTradesPerCycle: 2,
      maxTradesPerDay: 3,
      cooldownMinutes: 360,
      feeRate: 0.001,
      slippageBps: 35,
      volatilityWeight: 0.7,
      momentumWeight: 1.35,
      trendWeight: 1.35,
      macroWeight: 0.25,
      geopoliticalWeight: 0.1
    },
    assetUniverse: {
      currentlySupportedAllowlist: ["BND", "SCHD", "VTI", "VOO", "SPY"],
      futureTreasuryWatchlist: ["SGOV", "BIL", "SHV", "VGSH", "SCHO"],
      futureTreasurySupportStatus: "not_activated_without_registry_and_provider_verification"
    }
  }
] as const;

const ACTIVE_ASSET_SYMBOLS = ["BND", "SCHD", "VTI", "VOO", "SPY"] as const;
const FUTURE_TREASURY_SYMBOLS = ["SGOV", "BIL", "SHV", "VGSH", "SCHO"] as const;

const STARTUP_MAX_TRADES_PER_DAY: Record<IraStrategyKey, number> = {
  conservative: 2,
  guardian: 1,
  growth: 4,
  aggressive: 8
};

const WATCHLIST_PRIORITY: Record<IraStrategyKey, Array<{ symbol: typeof ACTIVE_ASSET_SYMBOLS[number]; priority: number; role: string }>> = {
  conservative: [
    { symbol: "BND", priority: 10, role: "Core bond-fund stabilizer; not cash and not a money-market fund." },
    { symbol: "SCHD", priority: 20, role: "Dividend-oriented equity sleeve." },
    { symbol: "VTI", priority: 30, role: "Broad-market equity exposure." },
    { symbol: "VOO", priority: 40, role: "Large-cap equity exposure." },
    { symbol: "SPY", priority: 50, role: "Liquid broad-market proxy." }
  ],
  guardian: [
    { symbol: "BND", priority: 10, role: "Primary defensive bond-fund exposure; not cash and not a money-market fund." },
    { symbol: "SCHD", priority: 20, role: "Lower-turnover dividend equity candidate." },
    { symbol: "VOO", priority: 40, role: "Large-cap equity exposure with strict gates." },
    { symbol: "VTI", priority: 50, role: "Broad-market equity exposure with strict gates." },
    { symbol: "SPY", priority: 60, role: "Liquid broad-market proxy with strict gates." }
  ],
  growth: [
    { symbol: "VTI", priority: 10, role: "Primary broad-market growth exposure." },
    { symbol: "VOO", priority: 20, role: "Large-cap equity growth exposure." },
    { symbol: "SCHD", priority: 30, role: "Dividend stabilizer." },
    { symbol: "SPY", priority: 40, role: "Liquid broad-market proxy." },
    { symbol: "BND", priority: 60, role: "Bond-fund diversifier; not cash and not a money-market fund." }
  ],
  aggressive: [
    { symbol: "SPY", priority: 10, role: "Highest-liquidity equity proxy." },
    { symbol: "VOO", priority: 20, role: "Large-cap equity growth exposure." },
    { symbol: "VTI", priority: 30, role: "Broad-market equity growth exposure." },
    { symbol: "SCHD", priority: 50, role: "Dividend equity diversifier." },
    { symbol: "BND", priority: 80, role: "Bond-fund diversifier; not cash and not a money-market fund." }
  ]
};

type IraStrategyKey = typeof IRA_ALTERNATIVE_STRATEGIES[number]["key"];

interface ComparisonRow {
  id: string;
  baselineId: string;
  displayName: string;
  startingValueUsd: number;
  startTimestamp: string;
  status: string;
  paperOnly: number;
  liveTradingEnabled: number;
  automaticLiveExecutionEnabled: number;
  createdAt: string;
}

interface BenchmarkRow {
  id: string;
  alternativeKey: string;
  displayName: string;
  benchmarkType: string;
  startingValueUsd: number;
  apy: number;
  sourceLabel: string;
  liquidityClassification: string;
  lockTermMonths: number | null;
  earlyWithdrawalPenaltyStatus: string;
  earlyWithdrawalPenaltyJson: string | null;
}

interface StrategyRow {
  id: string;
  portfolioId: string;
  strategyKey: string;
  displayName: string;
  startingValueUsd: number;
  startTimestamp: string;
  parametersJson: string;
  assetUniverseJson: string;
  profileEnabled: number;
  paperOnly: number;
  liveTradingEnabled: number;
  automaticLiveExecutionEnabled: number;
  status: string;
  activationTimestamp?: string | null;
}

interface StrategyValuationRow {
  cashUsd: number;
  holdingsValueUsd: number | null;
  tradeCount: number;
  feesUsd: number | null;
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

interface TrustedQuoteCacheRow {
  symbol: string;
  normalizedQuoteJson: string;
  qualityStatus: string;
  provider: string;
  providerTimestamp: string | null;
  retrievalTimestamp: string;
}

interface ActivationAssetRow {
  id: string;
  symbol: string;
  displayName: string;
  assetType: string;
  market: string;
  currency: string;
  providerSymbol: string;
  enabled: number;
  tradable: number;
  fractionalSupported: number;
  dividendCapable: number;
  expenseRatio: number | null;
  minimumInvestment: number | null;
  marketHoursMode: string;
  pricePrecision: number;
  quantityPrecision: number;
}

interface ActivationPreflightRow {
  strategyKey: IraStrategyKey;
  portfolioId: string;
  profileId: string;
  profileKey: string;
  profileEnabled: number;
  comparisonStartTimestamp: string;
  comparisonStartEquityUsd: number;
  parametersJson: string;
  cashUsd: number;
  startingBalanceUsd: number;
  paperOnly: number;
  liveTradingEnabled: number;
  automaticLiveExecutionEnabled: number;
  positions: number;
  orders: number;
  trades: number;
  fees: number;
}

export interface IraAlternativesDryRunResult {
  generatedAt: string;
  comparisonId: string;
  baselineId: string;
  mutating: false;
  marketStatus: {
    cronCadence: string;
    currentMarketHours: string;
    expectedFirstRegularMarketWindow: string;
  };
  assetUniverse: {
    activeSymbols: AssetSupportSummary[];
    unsupportedTreasuryCandidates: AssetSupportSummary[];
    limitation: string;
  };
  strategies: IraAlternativeDryRunStrategy[];
}

export interface AssetSupportSummary {
  symbol: string;
  registrySupported: boolean;
  quoteProviderSupported: boolean;
  paperExecutionSupported: boolean;
  valuationSupported: boolean;
  marketHoursMode: string | null;
  quoteFreshnessHandling: string;
  limitation?: string;
}

export interface IraAlternativeDryRunStrategy {
  strategyKey: IraStrategyKey;
  portfolioId: string;
  profileId: string;
  profileKey: string;
  displayName: string;
  profileEnabled: boolean;
  policy: Record<string, unknown>;
  symbolsEvaluated: string[];
  canBuildInitialPortfolioFromCash: boolean;
  decisions: Array<{
    symbol: string;
    action: string;
    proposedActionDuringMarketHours: string;
    proposedTradeValueUsd: number;
    confidence: number;
    reason: string;
    riskAllowed: boolean;
    riskChecks: string[];
    quoteTimestamp: string;
    quoteSource: string;
    quoteFreshness: string;
    marketHoursAllowed: boolean;
    executableDuringValidMarketHours: boolean;
    intendedAllocationPct: number;
    screenRank: number | null;
    screenScore: number;
  }>;
}

export interface IraAlternativesActivationResult {
  activated: true;
  generatedAt: string;
  sharedActivationTimestamp: string;
  comparisonId: string;
  baselineId: string;
  portfolios: Array<{
    portfolioId: string;
    profileId: string;
    strategyKey: IraStrategyKey;
    profileKey: string;
    effectiveCadenceMinutes: number;
    maxTradesPerDay: number;
    cashUsd: number;
    positions: number;
    orders: number;
    trades: number;
  }>;
  watchlistsSeeded: number;
  watchlistAssetsSeeded: number;
  expectedFirstRegularMarketWindow: string;
}

export interface IraAlternativeComparison {
  initialized: boolean;
  generatedAt: string;
  comparisonId: string;
  baselineId: string;
  displayName: string;
  startingValueUsd: number;
  startTimestamp: string | null;
  safety: {
    paperOnly: boolean;
    liveTradingEnabled: boolean;
    automaticLiveExecutionEnabled: boolean;
    strategyProfilesEnabled: boolean;
  };
  alternatives: IraAlternativeSummary[];
  disclosures: string[];
}

export interface IraAlternativeSummary {
  id: string;
  key: string;
  name: string;
  type: "bank_benchmark" | "paper_strategy";
  startingValueUsd: number;
  currentValueUsd: number;
  returnPct: number;
  diffVsShareUsd: number | null;
  diffVsCertificateUsd: number | null;
  cashUsd: number | null;
  holdingsValueUsd: number | null;
  tradeCount: number;
  feesUsd: number | null;
  dataStatus: string;
  notes: string[];
}

export interface IraAlternativesInitializationResult extends IraAlternativeComparison {
  idempotent: boolean;
  portfolios: Array<{
    portfolioId: string;
    strategyKey: string;
    startingCashUsd: number;
    profileEnabled: boolean;
    tradeCount: number;
    orderCount: number;
    positionCount: number;
  }>;
  snapshotCount: number;
}

export async function initializeIraAlternativesComparison(db: D1Database, now = new Date()): Promise<IraAlternativesInitializationResult> {
  const existing = await getComparison(db);
  const idempotent = Boolean(existing);
  const nowIso = now.toISOString();
  const startTimestamp = existing?.startTimestamp ?? nowIso;
  const statements: D1PreparedStatement[] = [];

  if (!existing) {
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO ira_alternative_comparisons (
          id, baseline_id, display_name, starting_value_usd, start_timestamp,
          status, paper_only, live_trading_enabled, automatic_live_execution_enabled,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'initialized', 1, 0, 0, ?, ?)`
      ).bind(
        IRA_ALTERNATIVES_COMPARISON_ID,
        IRA_ALTERNATIVES_BASELINE_ID,
        "IRA Alternatives $2,400 Benchmark Comparison",
        IRA_ALTERNATIVES_STARTING_VALUE_USD,
        startTimestamp,
        nowIso,
        nowIso
      ),
      db.prepare(
        `INSERT OR IGNORE INTO ira_alternative_baselines (
          id, comparison_id, starting_value_usd, start_timestamp, accrual_convention, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        IRA_ALTERNATIVES_BASELINE_ID,
        IRA_ALTERNATIVES_COMPARISON_ID,
        IRA_ALTERNATIVES_STARTING_VALUE_USD,
        startTimestamp,
        "daily_apy_effective_rate_elapsed_calendar_days",
        nowIso
      )
    );
  }

  for (const benchmark of IRA_ALTERNATIVE_BENCHMARKS) {
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO ira_alternative_benchmarks (
          id, comparison_id, alternative_key, display_name, benchmark_type,
          starting_value_usd, apy, source_label, liquidity_classification,
          lock_term_months, early_withdrawal_penalty_status,
          early_withdrawal_penalty_json, active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)`
      ).bind(
        benchmark.id,
        IRA_ALTERNATIVES_COMPARISON_ID,
        benchmark.key,
        benchmark.displayName,
        benchmark.type,
        IRA_ALTERNATIVES_STARTING_VALUE_USD,
        benchmark.apy,
        "user_supplied_ira_alternatives_request",
        benchmark.liquidityClassification,
        benchmark.lockTermMonths,
        benchmark.earlyWithdrawalPenaltyStatus,
        nowIso,
        nowIso
      )
    );
  }

  for (const strategy of IRA_ALTERNATIVE_STRATEGIES) {
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO portfolios (
          id, user_id, broker_account_id, name, cash_usd, starting_balance_usd,
          currency, mode, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, ?, ?, 'USD', 'paper', ?, ?)`
      ).bind(
        strategy.portfolioId,
        TIM_USER_ID,
        `${strategy.displayName} IRA Alternatives Paper Portfolio`,
        IRA_ALTERNATIVES_STARTING_VALUE_USD,
        IRA_ALTERNATIVES_STARTING_VALUE_USD,
        nowIso,
        nowIso
      ),
      db.prepare(
        `INSERT OR IGNORE INTO linked_portfolio_accounts (
          portfolio_id, account_type, linked_portfolio_id, relationship_label,
          manual_entry_enabled, managed_by_kairox, read_only, created_at, updated_at
        ) VALUES (?, 'paper', NULL, ?, 0, 1, 0, ?, ?)`
      ).bind(strategy.portfolioId, "IRA alternatives paper-only comparison portfolio", nowIso, nowIso),
      db.prepare(
        `INSERT OR IGNORE INTO portfolio_profiles (
          id, portfolio_id, profile_key, display_name, philosophy, risk_posture,
          comparison_start_timestamp, comparison_start_equity_usd, normalized_start_index,
          parameters_json, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 100, ?, 0, ?, ?)`
      ).bind(
        `portfolio_profile_${sanitizeId(strategy.portfolioId)}`,
        strategy.portfolioId,
        `ira_alternatives_2400_v1_${strategy.key}`,
        strategy.displayName,
        strategy.philosophy,
        strategy.riskPosture,
        startTimestamp,
        IRA_ALTERNATIVES_STARTING_VALUE_USD,
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
        `risk_${sanitizeId(strategy.portfolioId)}`,
        strategy.portfolioId,
        strategy.riskLevel,
        strategy.maxPositionPct,
        strategy.maxDailyLossPct,
        nowIso
      ),
      db.prepare(
        `INSERT OR IGNORE INTO portfolio_goals (id, portfolio_id, objective, target_description, created_at)
         VALUES (?, ?, 'ira_alternatives_comparison', ?, ?)`
      ).bind(
        `goal_${sanitizeId(strategy.portfolioId)}_ira_alternatives`,
        strategy.portfolioId,
        "Compare a disabled paper strategy against IRA share and certificate benchmarks. Activation is separate and protected.",
        nowIso
      ),
      db.prepare(
        `INSERT OR IGNORE INTO ira_alternative_strategy_portfolios (
          id, comparison_id, portfolio_id, strategy_key, display_name, starting_value_usd,
          start_timestamp, parameters_json, asset_universe_json, profile_enabled,
          paper_only, live_trading_enabled, automatic_live_execution_enabled,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 0, 0, 'initialized', ?, ?)`
      ).bind(
        `ira_alt_strategy_${sanitizeId(strategy.key)}_2400_v1`,
        IRA_ALTERNATIVES_COMPARISON_ID,
        strategy.portfolioId,
        strategy.key,
        strategy.displayName,
        IRA_ALTERNATIVES_STARTING_VALUE_USD,
        startTimestamp,
        JSON.stringify(strategy.parameters),
        JSON.stringify(strategy.assetUniverse),
        nowIso,
        nowIso
      )
    );
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }

  const snapshotCount = await recordIraAlternativeDailySnapshots(db, now);
  const comparison = await getIraAlternativesComparison(db, now);
  const portfolios = await Promise.all(IRA_ALTERNATIVE_STRATEGIES.map(async (strategy) => {
    const row = await db.prepare(
      `SELECT
        (SELECT COUNT(*) FROM positions WHERE portfolio_id = ?) AS positionCount,
        (SELECT COUNT(*) FROM orders WHERE portfolio_id = ?) AS orderCount,
        (SELECT COUNT(*) FROM trades WHERE portfolio_id = ?) AS tradeCount,
        (SELECT cash_usd FROM portfolios WHERE id = ?) AS startingCashUsd,
        (SELECT enabled FROM portfolio_profiles WHERE portfolio_id = ? LIMIT 1) AS profileEnabled`
    ).bind(strategy.portfolioId, strategy.portfolioId, strategy.portfolioId, strategy.portfolioId, strategy.portfolioId).first<{
      positionCount: number;
      orderCount: number;
      tradeCount: number;
      startingCashUsd: number;
      profileEnabled: number;
    }>();
    return {
      portfolioId: strategy.portfolioId,
      strategyKey: strategy.key,
      startingCashUsd: Number(row?.startingCashUsd ?? 0),
      profileEnabled: Boolean(row?.profileEnabled),
      tradeCount: Number(row?.tradeCount ?? 0),
      orderCount: Number(row?.orderCount ?? 0),
      positionCount: Number(row?.positionCount ?? 0)
    };
  }));

  return {
    ...comparison,
    idempotent,
    portfolios,
    snapshotCount
  };
}

export async function getIraAlternativesComparison(db: D1Database, now = new Date()): Promise<IraAlternativeComparison> {
  const comparison = await getComparison(db);
  if (!comparison) {
    return uninitializedComparison(now);
  }

  const [benchmarks, strategies] = await Promise.all([
    listRows<BenchmarkRow>(db.prepare(
      `SELECT id, alternative_key AS alternativeKey, display_name AS displayName,
        benchmark_type AS benchmarkType, starting_value_usd AS startingValueUsd, apy,
        source_label AS sourceLabel, liquidity_classification AS liquidityClassification,
        lock_term_months AS lockTermMonths, early_withdrawal_penalty_status AS earlyWithdrawalPenaltyStatus,
        early_withdrawal_penalty_json AS earlyWithdrawalPenaltyJson
       FROM ira_alternative_benchmarks
       WHERE comparison_id = ? AND active = 1
       ORDER BY CASE alternative_key WHEN 'ira_share_150apy' THEN 1 WHEN 'ira_certificate_370apy' THEN 2 ELSE 99 END`
    ).bind(comparison.id)),
    listRows<StrategyRow>(db.prepare(
      `SELECT id, portfolio_id AS portfolioId, strategy_key AS strategyKey,
        display_name AS displayName, starting_value_usd AS startingValueUsd,
        start_timestamp AS startTimestamp, parameters_json AS parametersJson,
        asset_universe_json AS assetUniverseJson, COALESCE(pp.enabled, sp.profile_enabled) AS profileEnabled,
        paper_only AS paperOnly, live_trading_enabled AS liveTradingEnabled,
        automatic_live_execution_enabled AS automaticLiveExecutionEnabled, status,
        activation_timestamp AS activationTimestamp
       FROM ira_alternative_strategy_portfolios sp
       LEFT JOIN portfolio_profiles pp ON pp.portfolio_id = sp.portfolio_id
       WHERE sp.comparison_id = ?
       ORDER BY CASE strategy_key WHEN 'conservative' THEN 1 WHEN 'guardian' THEN 2 WHEN 'growth' THEN 3 WHEN 'aggressive' THEN 4 ELSE 99 END`
    ).bind(comparison.id))
  ]);

  const shareValue = benchmarkValue(benchmarks.find((row) => row.alternativeKey === "ira_share_150apy"), comparison.startTimestamp, now);
  const certificateValue = benchmarkValue(benchmarks.find((row) => row.alternativeKey === "ira_certificate_370apy"), comparison.startTimestamp, now);
  const bankAlternatives = benchmarks.map((benchmark) => {
    const currentValueUsd = calculateApyAccrualValue(benchmark.startingValueUsd, benchmark.apy, comparison.startTimestamp, now);
    return alternativeSummary({
      id: benchmark.id,
      key: benchmark.alternativeKey,
      name: benchmark.displayName,
      type: "bank_benchmark",
      startingValueUsd: benchmark.startingValueUsd,
      currentValueUsd,
      diffVsShareUsd: shareValue === null ? null : currentValueUsd - shareValue,
      diffVsCertificateUsd: certificateValue === null ? null : currentValueUsd - certificateValue,
      cashUsd: null,
      holdingsValueUsd: null,
      tradeCount: 0,
      feesUsd: null,
      dataStatus: "modeled",
      notes: [
        benchmark.benchmarkType === "bank_certificate" ? "Locked 12-month certificate model; early-withdrawal penalty is unknown and unconfigured." : "Cash share account model; no trading occurs.",
        `APY ${(benchmark.apy * 100).toFixed(2)}% using daily effective APY accrual.`
      ]
    });
  });

  const strategyAlternatives = await Promise.all(strategies.map(async (strategy) => {
    const valuation = await strategyValuation(db, strategy.portfolioId);
    const currentValueUsd = Number(valuation.cashUsd ?? 0) + Number(valuation.holdingsValueUsd ?? 0);
    const assetUniverse = parseJson<{ futureTreasuryWatchlist?: string[]; futureTreasurySupportStatus?: string }>(strategy.assetUniverseJson, {});
    return alternativeSummary({
      id: strategy.id,
      key: strategy.strategyKey,
      name: strategy.displayName,
      type: "paper_strategy",
      startingValueUsd: strategy.startingValueUsd,
      currentValueUsd,
      diffVsShareUsd: shareValue === null ? null : currentValueUsd - shareValue,
      diffVsCertificateUsd: certificateValue === null ? null : currentValueUsd - certificateValue,
      cashUsd: valuation.cashUsd,
      holdingsValueUsd: valuation.holdingsValueUsd ?? 0,
      tradeCount: valuation.tradeCount,
      feesUsd: valuation.feesUsd ?? 0,
      dataStatus: strategy.status === "initialized" && strategy.profileEnabled === 0 ? "initialized_disabled_no_trading" : strategy.status,
      notes: [
        "Independent paper portfolio. Activation is separate and protected.",
        "Live execution, leverage, margin, options, and futures are disabled.",
        strategy.strategyKey === "conservative" ? "Most realistic candidate for a cautious IRA workflow, subject to later approval and support checks." : "Paper-only comparison strategy, not a recommendation.",
        assetUniverse.futureTreasuryWatchlist?.length ? `Treasury symbols tracked for future support only: ${assetUniverse.futureTreasuryWatchlist.join(", ")}.` : "No future Treasury watchlist configured.",
        assetUniverse.futureTreasurySupportStatus ?? "Future Treasury support is unverified."
      ]
    });
  }));

  return {
    initialized: true,
    generatedAt: now.toISOString(),
    comparisonId: comparison.id,
    baselineId: comparison.baselineId,
    displayName: comparison.displayName,
    startingValueUsd: comparison.startingValueUsd,
    startTimestamp: comparison.startTimestamp,
    safety: {
      paperOnly: comparison.paperOnly === 1,
      liveTradingEnabled: comparison.liveTradingEnabled === 1,
      automaticLiveExecutionEnabled: comparison.automaticLiveExecutionEnabled === 1,
      strategyProfilesEnabled: strategies.some((strategy) => strategy.profileEnabled === 1)
    },
    alternatives: [...bankAlternatives, ...strategyAlternatives],
    disclosures: disclosures()
  };
}

export async function getIraAlternativesDryRun(db: D1Database, now = new Date()): Promise<IraAlternativesDryRunResult> {
  const comparison = await getComparison(db);
  if (!comparison) {
    throw new Error("IRA alternatives comparison is not initialized.");
  }
  const [activeAssets, treasuryAssets, preflight] = await Promise.all([
    supportedAssets(db, [...ACTIVE_ASSET_SYMBOLS]),
    supportedAssets(db, [...FUTURE_TREASURY_SYMBOLS]),
    activationPreflightRows(db)
  ]);
  const activeSupport = assetSupportSummaries(activeAssets, [...ACTIVE_ASSET_SYMBOLS]);
  const treasurySupport = assetSupportSummaries(treasuryAssets, [...FUTURE_TREASURY_SYMBOLS]);
  assertCleanPreflight(preflight);
  assertActiveAssetsSupported(activeSupport);

  const strategies = await Promise.all(IRA_ALTERNATIVE_STRATEGIES.map(async (strategy) => {
    const row = preflight.find((item) => item.strategyKey === strategy.key);
    if (!row) {
      throw new Error(`${strategy.key} IRA alternatives portfolio mapping is missing.`);
    }
    const profile = await getPortfolioProfile(db, strategy.portfolioId);
    const assets = plannedAssetsForStrategy(activeAssets, strategy.key);
    const decisions = await dryRunDecisionsForProfile(db, profile, assets, now);
    return {
      strategyKey: strategy.key,
      portfolioId: strategy.portfolioId,
      profileId: row.profileId,
      profileKey: row.profileKey,
      displayName: strategy.displayName,
      profileEnabled: row.profileEnabled === 1,
      policy: policySummary(profile),
      symbolsEvaluated: decisions.map((decision) => decision.symbol),
      canBuildInitialPortfolioFromCash: assets.length > 0 && decisions.length > 0,
      decisions
    };
  }));

  return {
    generatedAt: now.toISOString(),
    comparisonId: comparison.id,
    baselineId: comparison.baselineId,
    mutating: false,
    marketStatus: {
      cronCadence: "*/30 * * * *",
      currentMarketHours: "US stock and ETF execution is limited to regular market hours.",
      expectedFirstRegularMarketWindow: expectedFirstRegularMarketWindow()
    },
    assetUniverse: {
      activeSymbols: activeSupport,
      unsupportedTreasuryCandidates: treasurySupport,
      limitation: "The retirement comparison currently lacks a true Treasury-bill or cash-equivalent trading asset. BND is a bond fund, not cash and not a money-market fund."
    },
    strategies
  };
}

export async function activateIraAlternativesProfiles(db: D1Database, now = new Date()): Promise<IraAlternativesActivationResult> {
  const comparison = await getComparison(db);
  if (!comparison) {
    throw new Error("IRA alternatives comparison is not initialized.");
  }
  const preflight = await activationPreflightRows(db);
  assertCleanPreflight(preflight, { requireDisabledProfiles: true });
  const activeAssets = await supportedAssets(db, [...ACTIVE_ASSET_SYMBOLS]);
  assertActiveAssetsSupported(assetSupportSummaries(activeAssets, [...ACTIVE_ASSET_SYMBOLS]));
  const dryRun = await getIraAlternativesDryRun(db, now);
  if (dryRun.strategies.some((strategy) => !strategy.canBuildInitialPortfolioFromCash)) {
    throw new Error("At least one IRA alternatives strategy cannot build an initial portfolio from cash.");
  }

  const activationTimestamp = now.toISOString();
  const statements: D1PreparedStatement[] = [];
  let watchlistAssetsSeeded = 0;
  for (const strategy of IRA_ALTERNATIVE_STRATEGIES) {
    const profile = await getPortfolioProfile(db, strategy.portfolioId);
    const parameters = {
      ...strategy.parameters,
      maxTradesPerDay: STARTUP_MAX_TRADES_PER_DAY[strategy.key]
    };
    const watchlistId = `watchlist_${sanitizeId(strategy.portfolioId)}_ira_alternatives`;
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO watchlists (id, portfolio_id, name, description, enabled)
         VALUES (?, ?, ?, ?, 1)`
      ).bind(
        watchlistId,
        strategy.portfolioId,
        `${strategy.displayName} IRA Alternatives Universe`,
        "Activation-seeded paper-only IRA alternatives universe. Treasury candidates remain unsupported unless separately verified."
      ),
      db.prepare(
        `UPDATE portfolio_profiles
         SET enabled = 1, parameters_json = ?, updated_at = ?
         WHERE id = ? AND portfolio_id = ? AND enabled = 0`
      ).bind(JSON.stringify(parameters), activationTimestamp, `portfolio_profile_${sanitizeId(strategy.portfolioId)}`, strategy.portfolioId),
      db.prepare(
        `UPDATE ira_alternative_strategy_portfolios
         SET status = 'active', activation_timestamp = ?, activated_by = 'protected_ira_alternatives_activation', updated_at = ?
         WHERE comparison_id = ? AND portfolio_id = ? AND status = 'initialized'`
      ).bind(activationTimestamp, activationTimestamp, IRA_ALTERNATIVES_COMPARISON_ID, strategy.portfolioId)
    );
    for (const item of WATCHLIST_PRIORITY[strategy.key]) {
      const asset = activeAssets.get(item.symbol);
      if (!asset) {
        throw new Error(`${item.symbol} is missing from the supported active asset map.`);
      }
      watchlistAssetsSeeded += 1;
      statements.push(
        db.prepare(
          `INSERT OR IGNORE INTO watchlist_assets (id, watchlist_id, asset_id, enabled, ranking_priority, notes)
           VALUES (?, ?, ?, 1, ?, ?)`
        ).bind(
          `watchlist_asset_${sanitizeId(strategy.portfolioId)}_${sanitizeId(item.symbol)}`,
          watchlistId,
          asset.id,
          item.priority,
          item.role
        )
      );
    }
  }
  await db.batch(statements);
  const verification = await activationPreflightRows(db);
  const activated = verification.filter((row) => row.profileEnabled === 1);
  if (activated.length !== 4 || activated.some((row) => !IRA_ALTERNATIVE_STRATEGIES.some((strategy) => strategy.key === row.strategyKey))) {
    throw new Error("Activation did not produce exactly the four intended IRA alternatives profiles.");
  }

  return {
    activated: true,
    generatedAt: now.toISOString(),
    sharedActivationTimestamp: activationTimestamp,
    comparisonId: comparison.id,
    baselineId: comparison.baselineId,
    portfolios: activated.sort((left, right) => strategyOrder(left.strategyKey) - strategyOrder(right.strategyKey)).map((row) => {
      const parameters = parseJson<Record<string, unknown>>(row.parametersJson, {});
      return {
        portfolioId: row.portfolioId,
        profileId: row.profileId,
        strategyKey: row.strategyKey,
        profileKey: row.profileKey,
        effectiveCadenceMinutes: cadenceMinutesFromParameters(parameters),
        maxTradesPerDay: Number(parameters.maxTradesPerDay ?? 0),
        cashUsd: row.cashUsd,
        positions: row.positions,
        orders: row.orders,
        trades: row.trades
      };
    }),
    watchlistsSeeded: IRA_ALTERNATIVE_STRATEGIES.length,
    watchlistAssetsSeeded,
    expectedFirstRegularMarketWindow: expectedFirstRegularMarketWindow()
  };
}

export async function recordIraAlternativeDailySnapshots(db: D1Database, now = new Date()): Promise<number> {
  const comparison = await getIraAlternativesComparison(db, now);
  if (!comparison.initialized || !comparison.startTimestamp) {
    return 0;
  }
  const share = comparison.alternatives.find((alternative) => alternative.key === "ira_share_150apy");
  const certificate = comparison.alternatives.find((alternative) => alternative.key === "ira_certificate_370apy");
  const snapshotDate = now.toISOString().slice(0, 10);
  const snapshotTimestamp = now.toISOString();
  const statements = comparison.alternatives.map((alternative) => db.prepare(
    `INSERT OR IGNORE INTO ira_alternative_daily_snapshots (
      id, comparison_id, alternative_id, alternative_key, alternative_type,
      snapshot_date, snapshot_timestamp, starting_value_usd, current_value_usd,
      return_pct, diff_vs_share_usd, diff_vs_certificate_usd, cash_usd,
      holdings_value_usd, fees_usd, drawdown_pct, trade_count, data_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
  ).bind(
    `ira_alt_snapshot_${snapshotDate}_${sanitizeId(alternative.id)}`,
    comparison.comparisonId,
    alternative.id,
    alternative.key,
    alternative.type,
    snapshotDate,
    snapshotTimestamp,
    alternative.startingValueUsd,
    alternative.currentValueUsd,
    alternative.returnPct,
    share ? alternative.currentValueUsd - share.currentValueUsd : null,
    certificate ? alternative.currentValueUsd - certificate.currentValueUsd : null,
    alternative.cashUsd,
    alternative.holdingsValueUsd,
    alternative.feesUsd,
    alternative.tradeCount,
    alternative.dataStatus,
    snapshotTimestamp
  ));
  if (statements.length === 0) {
    return 0;
  }
  await db.batch(statements);
  return statements.length;
}

export function calculateApyAccrualValue(startingValueUsd: number, apy: number, startTimestamp: string | Date, now: string | Date): number {
  const startMs = typeof startTimestamp === "string" ? Date.parse(startTimestamp) : startTimestamp.getTime();
  const nowMs = typeof now === "string" ? Date.parse(now) : now.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) {
    throw new Error("APY accrual requires valid start and current timestamps.");
  }
  const elapsedDays = Math.max(0, (nowMs - startMs) / 86_400_000);
  const dailyRate = (1 + apy) ** (1 / 365) - 1;
  return roundMoney(startingValueUsd * (1 + dailyRate) ** elapsedDays);
}

export function renderIraAlternativesHtml(comparison: IraAlternativeComparison): Response {
  const html = comparison.initialized ? renderComparisonHtml(comparison) : renderUninitializedHtml(comparison);
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function renderComparisonHtml(comparison: IraAlternativeComparison): string {
  const rows = comparison.alternatives.map((alternative) => `
          <tr>
            <td><strong>${escapeHtml(alternative.name)}</strong><span>${escapeHtml(alternative.type === "bank_benchmark" ? "Modeled bank benchmark" : "Disabled paper strategy")}</span></td>
            <td>${formatMoney(alternative.currentValueUsd)}</td>
            <td>${formatPercent(alternative.returnPct)}</td>
            <td>${alternative.diffVsShareUsd === null ? "n/a" : formatSignedMoney(alternative.diffVsShareUsd)}</td>
            <td>${alternative.diffVsCertificateUsd === null ? "n/a" : formatSignedMoney(alternative.diffVsCertificateUsd)}</td>
            <td>${alternative.tradeCount}</td>
            <td>${escapeHtml(alternative.dataStatus)}</td>
          </tr>`).join("");
  const cards = comparison.alternatives.map((alternative) => `
        <section class="alt">
          <div>
            <h2>${escapeHtml(alternative.name)}</h2>
            <p>${escapeHtml(alternative.notes[0] ?? "")}</p>
          </div>
          <dl>
            <div><dt>Value</dt><dd>${formatMoney(alternative.currentValueUsd)}</dd></div>
            <div><dt>Return</dt><dd>${formatPercent(alternative.returnPct)}</dd></div>
            <div><dt>Cash</dt><dd>${alternative.cashUsd === null ? "n/a" : formatMoney(alternative.cashUsd)}</dd></div>
            <div><dt>Trades</dt><dd>${alternative.tradeCount}</dd></div>
          </dl>
        </section>`).join("");
  return pageShell(comparison.displayName, `
      <header>
        <p class="eyebrow">Initialized comparison</p>
        <h1>IRA alternatives: ${formatMoney(comparison.startingValueUsd)}</h1>
        <p>Six alternatives are compared from the same start timestamp and the same starting value. The bank alternatives are modeled accrual benchmarks. The four Kairox strategies are separate disabled paper portfolios with no starting holdings, orders, trades, or fees.</p>
      </header>
      <section class="summary">
        <div><span>Comparison ID</span><strong>${escapeHtml(comparison.comparisonId)}</strong></div>
        <div><span>Baseline ID</span><strong>${escapeHtml(comparison.baselineId)}</strong></div>
        <div><span>Start timestamp</span><strong>${escapeHtml(comparison.startTimestamp ?? "not initialized")}</strong></div>
        <div><span>Safety</span><strong>${comparison.safety.paperOnly && !comparison.safety.liveTradingEnabled && !comparison.safety.automaticLiveExecutionEnabled ? "Paper-only" : "Review required"}</strong></div>
      </section>
      <section>
        <h2>Plain-language readout</h2>
        <p>The share account and certificate show what the original ${formatMoney(comparison.startingValueUsd)} would look like under fixed APY assumptions. The strategy portfolios begin as cash-only paper accounts; they can gain or lose money only after a future protected activation step.</p>
      </section>
      <section class="table-wrap">
        <table>
          <thead><tr><th>Alternative</th><th>Current value</th><th>Return</th><th>Vs share</th><th>Vs certificate</th><th>Trades</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
      <div class="alts">${cards}</div>
      <section>
        <h2>Disclosures</h2>
        <ul>${comparison.disclosures.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </section>
  `);
}

function renderUninitializedHtml(comparison: IraAlternativeComparison): string {
  return pageShell("IRA alternatives not initialized", `
      <header>
        <p class="eyebrow">Protected setup required</p>
        <h1>IRA alternatives comparison is not initialized yet</h1>
        <p>No benchmark rows, strategy portfolios, snapshots, trades, orders, or holdings exist for ${escapeHtml(comparison.comparisonId)} yet. Initialization is a separate protected operation.</p>
      </header>
      <section>
        <h2>Planned alternatives</h2>
        <ul>
          ${IRA_ALTERNATIVE_BENCHMARKS.map((benchmark) => `<li>${escapeHtml(benchmark.displayName)} at ${(benchmark.apy * 100).toFixed(2)}% APY</li>`).join("")}
          ${IRA_ALTERNATIVE_STRATEGIES.map((strategy) => `<li>${escapeHtml(strategy.displayName)} disabled paper portfolio</li>`).join("")}
        </ul>
      </section>
  `);
}

function pageShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} - Kairox</title>
    <style>
      :root { color-scheme: light; --ink: #172026; --muted: #5b6670; --line: #d8dee4; --bg: #f7f9fb; --panel: #ffffff; --accent: #1d6f5f; --warn: #8a5a00; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: var(--bg); }
      main { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 32px 0 48px; }
      header { margin-bottom: 24px; }
      h1 { margin: 0 0 10px; font-size: clamp(2rem, 5vw, 3.4rem); line-height: 1; letter-spacing: 0; }
      h2 { margin: 0 0 12px; font-size: 1.05rem; letter-spacing: 0; }
      p { max-width: 860px; margin: 0; color: var(--muted); line-height: 1.55; }
      .eyebrow { color: var(--accent); font-weight: 700; text-transform: uppercase; font-size: .75rem; letter-spacing: .08em; margin-bottom: 8px; }
      section { margin-top: 18px; }
      .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; border: 1px solid var(--line); background: var(--line); }
      .summary div { background: var(--panel); padding: 14px; min-width: 0; }
      .summary span, td span { display: block; color: var(--muted); font-size: .8rem; margin-bottom: 4px; }
      .summary strong { overflow-wrap: anywhere; }
      .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--panel); }
      table { width: 100%; border-collapse: collapse; min-width: 840px; }
      th, td { padding: 12px 14px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }
      th { font-size: .78rem; text-transform: uppercase; color: var(--muted); background: #eef3f7; letter-spacing: .06em; }
      .alts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 18px; }
      .alt { border: 1px solid var(--line); background: var(--panel); border-radius: 8px; padding: 16px; margin: 0; }
      .alt dl { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 14px 0 0; }
      dt { color: var(--muted); font-size: .78rem; }
      dd { margin: 2px 0 0; font-weight: 700; }
      ul { margin: 0; padding-left: 20px; color: var(--muted); line-height: 1.55; }
      @media (max-width: 820px) {
        main { width: min(100% - 24px, 1180px); padding-top: 24px; }
        .summary, .alts { grid-template-columns: 1fr; }
        .alt dl { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
    </style>
  </head>
  <body>
    <main>${body}</main>
  </body>
</html>`;
}

function uninitializedComparison(now: Date): IraAlternativeComparison {
  return {
    initialized: false,
    generatedAt: now.toISOString(),
    comparisonId: IRA_ALTERNATIVES_COMPARISON_ID,
    baselineId: IRA_ALTERNATIVES_BASELINE_ID,
    displayName: "IRA Alternatives $2,400 Benchmark Comparison",
    startingValueUsd: IRA_ALTERNATIVES_STARTING_VALUE_USD,
    startTimestamp: null,
    safety: {
      paperOnly: true,
      liveTradingEnabled: false,
      automaticLiveExecutionEnabled: false,
      strategyProfilesEnabled: false
    },
    alternatives: [],
    disclosures: disclosures()
  };
}

async function getComparison(db: D1Database): Promise<ComparisonRow | null> {
  return db.prepare(
    `SELECT id, baseline_id AS baselineId, display_name AS displayName,
      starting_value_usd AS startingValueUsd, start_timestamp AS startTimestamp,
      status, paper_only AS paperOnly, live_trading_enabled AS liveTradingEnabled,
      automatic_live_execution_enabled AS automaticLiveExecutionEnabled,
      created_at AS createdAt
     FROM ira_alternative_comparisons
     WHERE id = ?
     LIMIT 1`
  ).bind(IRA_ALTERNATIVES_COMPARISON_ID).first<ComparisonRow>();
}

async function strategyValuation(db: D1Database, portfolioId: string): Promise<StrategyValuationRow> {
  const row = await db.prepare(
    `SELECT
      p.cash_usd AS cashUsd,
      COALESCE((SELECT SUM(market_value_usd) FROM positions WHERE portfolio_id = p.id AND quantity > 0), 0) AS holdingsValueUsd,
      COALESCE((SELECT COUNT(*) FROM trades WHERE portfolio_id = p.id), 0) AS tradeCount,
      COALESCE((SELECT SUM(fees_usd) FROM trades WHERE portfolio_id = p.id), 0) AS feesUsd
     FROM portfolios p
     WHERE p.id = ?
     LIMIT 1`
  ).bind(portfolioId).first<StrategyValuationRow>();
  return row ?? { cashUsd: 0, holdingsValueUsd: 0, tradeCount: 0, feesUsd: 0 };
}

function benchmarkValue(row: BenchmarkRow | undefined, startTimestamp: string, now: Date): number | null {
  return row ? calculateApyAccrualValue(row.startingValueUsd, row.apy, startTimestamp, now) : null;
}

async function activationPreflightRows(db: D1Database): Promise<ActivationPreflightRow[]> {
  return listRows<ActivationPreflightRow>(db.prepare(
    `SELECT sp.strategy_key AS strategyKey, sp.portfolio_id AS portfolioId,
      pp.id AS profileId, pp.profile_key AS profileKey, pp.enabled AS profileEnabled,
      pp.comparison_start_timestamp AS comparisonStartTimestamp,
      pp.comparison_start_equity_usd AS comparisonStartEquityUsd,
      pp.parameters_json AS parametersJson,
      p.cash_usd AS cashUsd, p.starting_balance_usd AS startingBalanceUsd,
      sp.paper_only AS paperOnly, sp.live_trading_enabled AS liveTradingEnabled,
      sp.automatic_live_execution_enabled AS automaticLiveExecutionEnabled,
      (SELECT COUNT(*) FROM positions WHERE portfolio_id = p.id) AS positions,
      (SELECT COUNT(*) FROM orders WHERE portfolio_id = p.id) AS orders,
      (SELECT COUNT(*) FROM trades WHERE portfolio_id = p.id) AS trades,
      (SELECT COALESCE(SUM(fees_usd), 0) FROM trades WHERE portfolio_id = p.id) AS fees
     FROM ira_alternative_strategy_portfolios sp
     JOIN portfolios p ON p.id = sp.portfolio_id
     JOIN portfolio_profiles pp ON pp.portfolio_id = p.id
     WHERE sp.comparison_id = ?
     ORDER BY CASE sp.strategy_key WHEN 'conservative' THEN 1 WHEN 'guardian' THEN 2 WHEN 'growth' THEN 3 WHEN 'aggressive' THEN 4 ELSE 99 END`
  ).bind(IRA_ALTERNATIVES_COMPARISON_ID));
}

function assertCleanPreflight(rows: ActivationPreflightRow[], options: { requireDisabledProfiles?: boolean } = {}): void {
  const expected = new Set<IraStrategyKey>(IRA_ALTERNATIVE_STRATEGIES.map((strategy) => strategy.key));
  if (rows.length !== 4) {
    throw new Error(`Expected exactly four IRA alternatives strategy portfolios; found ${rows.length}.`);
  }
  for (const row of rows) {
    if (!expected.has(row.strategyKey)) {
      throw new Error(`Unexpected IRA alternatives strategy key: ${row.strategyKey}.`);
    }
    if (row.startingBalanceUsd !== IRA_ALTERNATIVES_STARTING_VALUE_USD || row.cashUsd !== IRA_ALTERNATIVES_STARTING_VALUE_USD) {
      throw new Error(`${row.strategyKey} is no longer at the clean $2,400.00 cash baseline.`);
    }
    if (row.comparisonStartEquityUsd !== IRA_ALTERNATIVES_STARTING_VALUE_USD) {
      throw new Error(`${row.strategyKey} comparison start value is not $2,400.00.`);
    }
    if (row.paperOnly !== 1 || row.liveTradingEnabled !== 0 || row.automaticLiveExecutionEnabled !== 0) {
      throw new Error(`${row.strategyKey} paper-only safety flags are not intact.`);
    }
    if (options.requireDisabledProfiles && row.profileEnabled !== 0) {
      throw new Error(`${row.strategyKey} profile is already enabled; refusing repeated activation.`);
    }
    if (row.positions !== 0 || row.orders !== 0 || row.trades !== 0 || row.fees !== 0) {
      throw new Error(`${row.strategyKey} no longer has zero positions, orders, trades, and fees.`);
    }
  }
}

async function supportedAssets(db: D1Database, symbols: string[]): Promise<Map<string, AssetRegistryRecord>> {
  if (symbols.length === 0) {
    return new Map();
  }
  const placeholders = symbols.map(() => "?").join(", ");
  const rows = await listRows<ActivationAssetRow>(db.prepare(
    `SELECT id, symbol, display_name AS displayName, asset_type AS assetType,
      market, currency, provider_symbol AS providerSymbol, enabled, tradable,
      fractional_supported AS fractionalSupported, dividend_capable AS dividendCapable,
      expense_ratio AS expenseRatio, minimum_investment AS minimumInvestment,
      market_hours_mode AS marketHoursMode, price_precision AS pricePrecision,
      quantity_precision AS quantityPrecision
     FROM assets
     WHERE symbol IN (${placeholders})`
  ).bind(...symbols));
  return new Map(rows.map((row) => [row.symbol, parseActivationAssetRow(row)]));
}

function parseActivationAssetRow(row: ActivationAssetRow): AssetRegistryRecord {
  return {
    id: row.id,
    symbol: row.symbol,
    displayName: row.displayName,
    assetType: row.assetType as AssetRegistryRecord["assetType"],
    market: row.market,
    currency: row.currency,
    providerSymbol: row.providerSymbol,
    enabled: row.enabled === 1,
    tradable: row.tradable === 1,
    fractionalSupported: row.fractionalSupported === 1,
    dividendCapable: row.dividendCapable === 1,
    expenseRatio: row.expenseRatio,
    minimumInvestment: row.minimumInvestment,
    marketHoursMode: row.marketHoursMode as AssetRegistryRecord["marketHoursMode"],
    pricePrecision: row.pricePrecision,
    quantityPrecision: row.quantityPrecision
  };
}

function assetSupportSummaries(assetMap: Map<string, AssetRegistryRecord>, symbols: string[]): AssetSupportSummary[] {
  return symbols.map((symbol) => {
    const asset = assetMap.get(symbol);
    const supported = Boolean(asset?.enabled && asset.tradable && asset.market === "US" && asset.currency === "USD");
    return {
      symbol,
      registrySupported: Boolean(asset?.enabled),
      quoteProviderSupported: Boolean(asset?.providerSymbol),
      paperExecutionSupported: supported,
      valuationSupported: Boolean(asset?.enabled && asset.providerSymbol),
      marketHoursMode: asset?.marketHoursMode ?? null,
      quoteFreshnessHandling: asset ? `${asset.marketHoursMode} market-hours classification with strict paper-execution quote freshness.` : "No registry row; not eligible for quote, valuation, or paper execution.",
      limitation: asset ? undefined : "Unsupported treasury/cash-equivalent candidate; not activated."
    };
  });
}

function assertActiveAssetsSupported(summaries: AssetSupportSummary[]): void {
  const unsupported = summaries.filter((asset) => !asset.registrySupported || !asset.quoteProviderSupported || !asset.paperExecutionSupported || !asset.valuationSupported);
  if (unsupported.length > 0) {
    throw new Error(`Cannot activate IRA alternatives because active symbols are unsupported: ${unsupported.map((asset) => asset.symbol).join(", ")}.`);
  }
}

function plannedAssetsForStrategy(assetMap: Map<string, AssetRegistryRecord>, strategyKey: IraStrategyKey): AssetRegistryRecord[] {
  return WATCHLIST_PRIORITY[strategyKey].flatMap((item) => {
    const asset = assetMap.get(item.symbol);
    return asset ? [{ ...asset, rankingPriority: item.priority, notes: item.role }] : [];
  });
}

async function dryRunDecisionsForProfile(db: D1Database, profile: PortfolioProfile, assets: AssetRegistryRecord[], now: Date): Promise<IraAlternativeDryRunStrategy["decisions"]> {
  const investmentPolicy = await getInvestmentPolicy(db, profile.portfolioId);
  const rankedInput: RankedOpportunity[] = [];
  for (const asset of assets) {
    const marketData = await latestReadOnlyMarketData(db, asset, now);
    const exposure = {
      portfolioValueUsd: IRA_ALTERNATIVES_STARTING_VALUE_USD,
      drawdownPct: 0,
      symbolExposurePct: 0,
      categoryExposurePct: 0
    };
    const screen = adjustDryRunScreenForProfile(screenAsset({ asset, marketData, now, exposure }), profile);
    const decision = screen.eligible ? decidePaperAction({ marketData, hasPosition: false }) : dryRunScreenedOutDecision(marketData, screen.reason);
    rankedInput.push({
      asset,
      marketData,
      decision: applyDryRunProfileDecisionPolicy(decision, profile),
      screen,
      positionValueUsd: 0,
      hasPosition: false
    });
  }
  return rankOpportunities(rankedInput).map((item) => {
    const marketHours = canExecuteAt(item.asset.assetType, now, item.asset.marketHoursMode);
    const signalDuringMarketHours = item.marketData.validated
      ? applyDryRunProfileDecisionPolicy(decidePaperAction({ marketData: item.marketData, hasPosition: false }), profile)
      : item.decision;
    const proposedTradeValueUsd = signalDuringMarketHours.action === "BUY"
      ? roundMoney(Math.min(
        IRA_ALTERNATIVES_STARTING_VALUE_USD * profile.parameters.maxNewTradePct,
        Math.max(0, IRA_ALTERNATIVES_STARTING_VALUE_USD - IRA_ALTERNATIVES_STARTING_VALUE_USD * profile.parameters.cashReservePct)
      ))
      : 0;
    const risk = assessPaperTrade({
      action: signalDuringMarketHours.action,
      marketData: item.marketData,
      portfolioValueUsd: IRA_ALTERNATIVES_STARTING_VALUE_USD,
      cashUsd: IRA_ALTERNATIVES_STARTING_VALUE_USD,
      currentPositionValueUsd: 0,
      proposedTradeValueUsd,
      drawdownPct: 0,
      duplicateSignal: false,
      openedNewPositionThisRun: false,
      hasPosition: false,
      maxNewTradePct: profile.parameters.maxNewTradePct,
      maxPositionPct: profile.parameters.maxPositionPct,
      drawdownBlockPct: profile.parameters.drawdownBlockPct,
      investmentPolicy,
      orderIntent: signalDuringMarketHours.action === "SELL" ? "long_sell" : "long_buy"
    });
    const riskChecks = [...risk.reasons];
    if ((signalDuringMarketHours.action === "BUY" || signalDuringMarketHours.action === "SELL") && !marketHours.allowed && marketHours.reason) {
      riskChecks.push(marketHours.reason);
    }
    return {
      symbol: item.asset.symbol,
      action: marketHours.allowed ? signalDuringMarketHours.action : "DO_NOTHING",
      proposedActionDuringMarketHours: signalDuringMarketHours.action,
      proposedTradeValueUsd,
      confidence: signalDuringMarketHours.confidenceScore,
      reason: marketHours.allowed ? signalDuringMarketHours.explanation : `Market is closed now: ${marketHours.reason ?? "regular market hours are required."} ${signalDuringMarketHours.explanation}`,
      riskAllowed: risk.allowed && marketHours.allowed,
      riskChecks,
      quoteTimestamp: item.marketData.asOf,
      quoteSource: item.marketData.source,
      quoteFreshness: item.marketData.quality ?? item.marketData.status ?? "unknown",
      marketHoursAllowed: marketHours.allowed,
      executableDuringValidMarketHours: risk.allowed && (signalDuringMarketHours.action === "BUY" || signalDuringMarketHours.action === "SELL"),
      intendedAllocationPct: signalDuringMarketHours.action === "BUY" ? roundRatio(proposedTradeValueUsd / IRA_ALTERNATIVES_STARTING_VALUE_USD) : 0,
      screenRank: item.screen.rank,
      screenScore: item.screen.score
    };
  });
}

async function latestReadOnlyMarketData(db: D1Database, asset: AssetRegistryRecord, now: Date): Promise<MarketDataset> {
  const snapshotRow = await db.prepare(
    `SELECT symbol, asset_class AS assetClass, source, price_usd AS priceUsd,
      price_as_of AS priceAsOf, volume, candles_json AS candlesJson, created_at AS createdAt
     FROM market_snapshots
     WHERE symbol = ? AND validation_status = 'validated' AND price_usd > 0
     ORDER BY created_at DESC
     LIMIT 1`
  ).bind(asset.symbol).first<ReadOnlyMarketRow>();
  const trustedRow = await db.prepare(
    `SELECT symbol, normalized_quote_json AS normalizedQuoteJson, quality_status AS qualityStatus,
      provider, provider_timestamp AS providerTimestamp, retrieval_timestamp AS retrievalTimestamp
     FROM trusted_quote_cache
     WHERE symbol = ?`
  ).bind(asset.symbol).first<TrustedQuoteCacheRow>();
  const candidates = [
    snapshotRow ? marketDatasetFromSnapshot(snapshotRow, asset, now) : null,
    trustedRow ? marketDatasetFromTrustedQuote(trustedRow, asset, now) : null
  ].filter((candidate): candidate is MarketDataset => candidate !== null);
  return candidates.sort((a, b) => new Date(b.asOf).getTime() - new Date(a.asOf).getTime())[0] ?? latestReadOnlyMarketUnavailable(asset, now);
}

function marketDatasetFromSnapshot(row: ReadOnlyMarketRow, asset: AssetRegistryRecord, now: Date): MarketDataset {
  const ageSeconds = Math.max(0, Math.floor((now.getTime() - new Date(row.createdAt).getTime()) / 1000));
  const maxAgeSeconds = maxReadOnlyAgeSeconds(asset.assetType);
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

function marketDatasetFromTrustedQuote(row: TrustedQuoteCacheRow, asset: AssetRegistryRecord, now: Date): MarketDataset | null {
  const quote = parseTrustedQuote(row.normalizedQuoteJson);
  const price = quote?.lastPrice;
  if (!quote || !Number.isFinite(price) || (price ?? 0) <= 0) {
    return null;
  }
  const asOf = quote.providerTimestamp ?? row.providerTimestamp ?? quote.receivedTimestamp ?? row.retrievalTimestamp;
  const ageSeconds = Math.max(0, Math.floor((now.getTime() - new Date(asOf).getTime()) / 1000));
  const stale = ageSeconds > maxReadOnlyAgeSeconds(asset.assetType) || /stale|missing|failure|unavailable|conflicting|anomalous/i.test(quote.dataQualityStatus ?? row.qualityStatus);
  return {
    symbol: asset.symbol,
    assetClass: asset.assetType,
    priceUsd: price as number,
    asOf,
    source: quote.providerName ?? row.provider,
    validated: !stale,
    stale,
    volume: quote.volume ?? undefined,
    candles: quote.candles ?? [],
    status: stale ? "deferred" : "cached",
    quality: stale ? "stale" : "acceptable_cached",
    userMessage: stale ? "Trusted quote cache is too old for dry-run execution approval." : "Using trusted read-only quote cache for dry-run evaluation.",
    error: stale ? "Trusted quote cache is too old for dry-run execution approval." : undefined
  };
}

function parseTrustedQuote(value: string | null): NormalizedQuote | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as NormalizedQuote : null;
  } catch {
    return null;
  }
}

function maxReadOnlyAgeSeconds(assetType: string): number {
  return assetType === "crypto" ? 30 * 60 : 4 * 24 * 60 * 60;
}

function latestReadOnlyMarketUnavailable(asset: AssetRegistryRecord, now: Date): MarketDataset {
  return {
    symbol: asset.symbol,
    assetClass: asset.assetType,
    priceUsd: 0,
    asOf: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString(),
    source: "none",
    validated: false,
    stale: true,
    candles: [],
    status: "unavailable",
    quality: "invalid",
    userMessage: "No trusted read-only market data is available for dry-run evaluation.",
    error: "No trusted read-only market data is available for dry-run evaluation."
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

function applyDryRunProfileDecisionPolicy(decision: StrategyDecision, profile: PortfolioProfile): StrategyDecision {
  if (decision.action !== "BUY" && decision.action !== "SELL") {
    return decision;
  }
  const threshold = decision.action === "SELL" ? profile.parameters.sellThreshold : profile.parameters.buyThreshold;
  if (decision.confidenceScore >= threshold) {
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

function adjustDryRunScreenForProfile(screen: ScreenResult, profile: PortfolioProfile): ScreenResult {
  let score = screen.score;
  const reasons: string[] = [];
  if (screen.assetType === "crypto") {
    score *= profile.parameters.cryptoPreference;
    reasons.push("Crypto is excluded from this IRA alternatives comparison.");
  }
  if (screen.assetType === "bond_fund" || screen.symbol === "SCHD") {
    score *= profile.parameters.dividendPreference;
  }
  const eligible = screen.eligible && reasons.length === 0;
  return {
    ...screen,
    eligible,
    score: roundRatio(Math.max(0, Math.min(100, score))),
    reason: eligible ? screen.reason : [screen.reason, ...reasons].join(" ")
  };
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

function policySummary(profile: PortfolioProfile): Record<string, unknown> {
  return {
    cashReservePct: profile.parameters.cashReservePct,
    maxNewTradePct: profile.parameters.maxNewTradePct,
    maxPositionPct: profile.parameters.maxPositionPct,
    minConfidence: profile.parameters.minConfidence,
    buyThreshold: profile.parameters.buyThreshold,
    sellThreshold: profile.parameters.sellThreshold,
    maxTradesPerCycle: profile.parameters.maxTradesPerCycle,
    maxTradesPerDay: profile.parameters.maxTradesPerDay,
    cooldownMinutes: profile.parameters.cooldownMinutes,
    turnoverLimitPct: profile.parameters.turnoverLimitPct,
    drawdownBlockPct: profile.parameters.drawdownBlockPct,
    decisionCadence: profile.parameters.decisionCadence,
    cryptoPreference: profile.parameters.cryptoPreference,
    leverageAllowed: false,
    marginAllowed: false,
    shortSellingAllowed: false,
    optionsAllowed: false,
    futuresAllowed: false,
    activeAssetAllowlist: ACTIVE_ASSET_SYMBOLS
  };
}

function cadenceMinutesFromParameters(parameters: Record<string, unknown>): number {
  switch (parameters.decisionCadence) {
    case "low":
      return 24 * 60;
    case "moderate":
      return 6 * 60;
    case "normal":
      return 2 * 60;
    case "fast":
      return 60;
    case "very_fast":
      return 30;
    default:
      return 2 * 60;
  }
}

function expectedFirstRegularMarketWindow(): string {
  return "Monday, August 3, 2026, on or after the regular US market open at 9:30 AM America/New_York, subject to the */30 cron cadence, quote freshness, and profile due checks.";
}

function strategyOrder(key: IraStrategyKey): number {
  return IRA_ALTERNATIVE_STRATEGIES.findIndex((strategy) => strategy.key === key);
}

function alternativeSummary(input: Omit<IraAlternativeSummary, "returnPct">): IraAlternativeSummary {
  return {
    ...input,
    currentValueUsd: roundMoney(input.currentValueUsd),
    diffVsShareUsd: input.diffVsShareUsd === null ? null : roundMoney(input.diffVsShareUsd),
    diffVsCertificateUsd: input.diffVsCertificateUsd === null ? null : roundMoney(input.diffVsCertificateUsd),
    returnPct: input.startingValueUsd > 0 ? roundRatio(input.currentValueUsd / input.startingValueUsd - 1) : 0
  };
}

function disclosures(): string[] {
  return [
    "The Actual IRA Share Account benchmark and 12-Month IRA Certificate benchmark are non-trading modeled accrual benchmarks.",
    "The IRA certificate is modeled as a 12-month locked alternative; early-withdrawal penalty is unknown/null/unconfigured and is not fabricated.",
    "The four Kairox strategy portfolios are independent paper portfolios that begin disabled with exactly $2,400.00 cash and no starting holdings, orders, trades, or fees.",
    "Paper strategies can gain or lose value after future activation; aggressive is a comparison scenario, not a recommendation.",
    "Treasury-style symbols such as SGOV, BIL, SHV, VGSH, and SCHO are future architecture candidates only until registry and provider support are verified."
  ];
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatSignedMoney(value: number): string {
  const formatted = formatMoney(Math.abs(value));
  return `${value >= 0 ? "+" : "-"}${formatted}`;
}

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundRatio(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function sanitizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96) || "ira_alternative";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
