import { listRows, TIM_USER_ID } from "../shared/db.ts";

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
      decisionCadence: "slow",
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
      decisionCadence: "slow",
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
}

interface StrategyValuationRow {
  cashUsd: number;
  holdingsValueUsd: number | null;
  tradeCount: number;
  feesUsd: number | null;
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
        asset_universe_json AS assetUniverseJson, profile_enabled AS profileEnabled,
        paper_only AS paperOnly, live_trading_enabled AS liveTradingEnabled,
        automatic_live_execution_enabled AS automaticLiveExecutionEnabled, status
       FROM ira_alternative_strategy_portfolios
       WHERE comparison_id = ?
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
