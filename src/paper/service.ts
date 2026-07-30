import { canExecuteAt } from "../market/hours.ts";
import { listEnabledWatchlistAssets, resolvePaperCandidateUniverse, type AssetRegistryRecord } from "../market/assets.ts";
import { MarketDataService, quoteToMarketDataset, type MarketDataSnapshot } from "../market/service.ts";
import {
  getCachedMarketData,
  getLastKnownGoodMarketData,
  getMarketDataStatuses,
  marketStatusFromDataset,
  upsertMarketDataStatus
} from "../market/status.ts";
import { calculatePerformance, recordEquityHistory } from "../portfolio/performance.ts";
import { getPortfolioProfile, type PortfolioProfile } from "../portfolio/profiles.ts";
import { assessPaperTrade } from "../risk/checks.ts";
import { decidePaperAction, estimateTransactionCost, type StrategyDecision } from "../strategy/paperStrategy.ts";
import { calculateIndicators } from "../strategy/indicators.ts";
import { rankOpportunities, screenAsset, type RankedOpportunity, type ScreenResult } from "../strategy/screener.ts";
import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";
import type { Env, MarketDataset } from "../shared/types.ts";
import { generateSummaries } from "../summaries/service.ts";
import { userMessageForMarketData } from "../shared/messages.ts";
import { completeDailySnapshot, ensureDailyStartSnapshot } from "../portfolio/dailySnapshots.ts";
import { getPortfolioValuation, recordValuationSnapshot } from "../portfolio/valuation.ts";
import { evaluateAndAwardMilestones } from "../milestones/service.ts";
import { recordValuationJourneyEvents } from "../journey/service.ts";
import { getInvestmentPolicy } from "../policies/investmentPolicy.ts";
import { evaluateIraCashManagement, resolveIraCashManagementParameters, type IraCashManagementDecision } from "../policies/iraCashManagement.ts";
import { assertPortfolioAllowsTradingActions } from "../portfolio/accountTypes.ts";

const SPREAD_RATE = 0.0025;
const FEE_RATE = 0.001;

interface PositionRow {
  id: string;
  symbol: string;
  assetClass: string;
  quantity: number;
  avgEntryPriceUsd: number;
  currentPriceUsd: number;
  marketValueUsd: number;
}

interface PortfolioRow {
  id: string;
  cashUsd: number;
  startingBalanceUsd: number;
}

interface RunSymbolSummary {
  symbol: string;
  action: string;
  executed: boolean;
  reason: string;
  signalKey: string;
  rank?: number | null;
  screenScore?: number;
}

export interface PaperRunOptions {
  trigger?: "manual" | "scheduled";
  runKey?: string;
  now?: Date;
  allowExecution?: boolean;
  portfolioId?: string;
  marketDataSnapshot?: MarketDataSnapshot;
  budget?: PaperRunBudget;
  runMaintenance?: boolean;
  onProgress?: (progress: PaperRunProgress) => Promise<void>;
  progressIntervalSymbols?: number;
  auditContext?: PaperRunAuditContext;
}

export interface PaperRunAuditContext {
  schedulerParentRunId?: string | null;
  schedulerChildRunId?: string | null;
  strategyProfileKey?: string | null;
}

export interface PaperRunProgress {
  phase: "evaluate" | "persist_decisions" | "execute" | "maintenance" | "finalize";
  symbolsProcessed: number;
  recommendationsPersisted: number;
  tradesExecuted: number;
  budget: PaperRunBudget | null;
}

export interface PaperRunBudget {
  outboundProviderRequests: number;
  d1Reads: number;
  d1Writes: number;
  d1Batches: number;
  cacheHits: number;
  cacheMisses: number;
  profilesProcessed: number;
  symbolsProcessed: number;
  retries: number;
  fallbacks: number;
}

interface PersistedRecommendationRow {
  symbol: string;
  action: string;
  explanation: string;
  signalKey: string;
  screenRank: number | null;
  screenScore: number | null;
  createdAt: string;
}

interface PersistedTradeRow {
  signalKey: string;
}

export async function runPaperStrategy(env: Env, options: PaperRunOptions = {}): Promise<unknown> {
  const now = options.now ?? new Date();
  const runStartedAt = now.toISOString();
  const portfolioId = options.portfolioId ?? TIM_PORTFOLIO_ID;
  const profile = await getPortfolioProfile(env.DB, portfolioId);
  await assertPortfolioAllowsTradingActions(env.DB, portfolioId, "run paper strategy");
  const investmentPolicy = await getInvestmentPolicy(env.DB, portfolioId);
  const runKey = options.runKey ?? `paper:${profile.profileKey}:${runStartedAt.slice(0, 16)}`;
  const executionAllowedBySystem = options.allowExecution ?? true;
  const existingRun = await env.DB.prepare("SELECT summary_json AS summaryJson FROM strategy_runs WHERE run_key = ?")
    .bind(runKey)
    .first<{ summaryJson: string }>();

  if (existingRun) {
    return { idempotent: true, ...JSON.parse(existingRun.summaryJson) };
  }

  const marketDataService = new MarketDataService(env.DB);
  const candidateUniverse = await resolvePaperCandidateUniverse(env.DB, portfolioId);
  const assets = candidateUniverse.assets;
  const evaluated: RankedOpportunity[] = [];
  let openedNewPositionThisRun = false;

  for (const asset of assets) {
    const symbol = asset.symbol;
    const marketData = await getMarketData(env.DB, marketDataService, asset, now, options.marketDataSnapshot, options.budget);
    incrementBudget(options.budget, "symbolsProcessed");
    await recordMarketSnapshot(env.DB, marketData);
    incrementBudget(options.budget, "d1Writes");
    await upsertMarketDataStatus(env.DB, marketStatusFromDataset(marketData, new Date().toISOString()));
    incrementBudget(options.budget, "d1Writes");

    const portfolio = await getPortfolioRow(env.DB, portfolioId);
    const position = await getPosition(env.DB, portfolioId, symbol);
    const openPositions = await getOpenPositions(env.DB, portfolioId);
    const portfolioState = await calculatePortfolioState(env.DB, portfolio, new Map([[symbol, marketData.priceUsd]]), portfolioId);
    const exposure = exposureForAsset(asset, openPositions, portfolioState.totalValueUsd, portfolioState.drawdownPct);
    const screen = adjustScreenForProfile(screenAsset({ asset, marketData, now, exposure }), profile);
    const decision = screen.eligible ? decidePaperAction({
      marketData,
      hasPosition: !!position && position.quantity > 0
    }) : screenedOutDecision(marketData, screen);
    const profileDecision = applyProfileDecisionPolicy(decision, profile);

    evaluated.push({
      asset,
      marketData,
      decision: profileDecision,
      screen,
      positionValueUsd: position?.marketValueUsd ?? 0,
      hasPosition: !!position && position.quantity > 0
    });
  }

  const ranked = rankOpportunities(evaluated);
  const summaries: RunSymbolSummary[] = [];
  const progressInterval = Math.max(1, options.progressIntervalSymbols ?? 4);
  let persistedRecommendations = 0;
  let progressTradesExecuted = 0;
  const tradesCompletedToday = await completedTradesForAccountDay(env.DB, portfolioId, now);
  const latestTrade = await latestTradeForPortfolio(env.DB, portfolioId);

  for (const item of ranked) {
    const { asset, marketData, decision, screen } = item;
    const position = await getPosition(env.DB, portfolioId, asset.symbol);
    const portfolio = await getPortfolioRow(env.DB, portfolioId);
    const portfolioState = await calculatePortfolioState(env.DB, portfolio, new Map([[asset.symbol, marketData.priceUsd]]), portfolioId);

    const duplicateSignal = await hasProcessedSignal(env.DB, portfolioId, decision.signalKey);
    const executionGateReasons: string[] = [];
    const isExecutionAction = decision.action === "BUY" || decision.action === "SELL";
    if (isExecutionAction && !executionAllowedBySystem) {
      executionGateReasons.push("Automation is paused, so scheduled paper execution is blocked.");
    }
    if (isExecutionAction && progressTradesExecuted >= profile.parameters.maxTradesPerCycle) {
      executionGateReasons.push(`${profile.displayName} reached its ${profile.parameters.maxTradesPerCycle} trade per cycle startup cap.`);
    }
    if (isExecutionAction && tradesCompletedToday + progressTradesExecuted >= profile.parameters.maxTradesPerDay) {
      executionGateReasons.push(`${profile.displayName} reached its ${profile.parameters.maxTradesPerDay} completed trade per day startup cap.`);
    }
    const cooldownRemaining = cooldownMinutesRemaining(latestTrade?.executedAt ?? null, now, profile.parameters.cooldownMinutes);
    if (isExecutionAction && cooldownRemaining > 0) {
      executionGateReasons.push(`${profile.displayName} cooldown is active for another ${cooldownRemaining} minute(s).`);
    }

    if (isExecutionAction) {
      if (!asset.tradable) {
        executionGateReasons.push(`${asset.symbol} is tracked in the asset registry but is not enabled for paper execution.`);
      }
      const marketHours = canExecuteAt(marketData.assetClass, now, asset.marketHoursMode);
      if (!marketHours.allowed && marketHours.reason) {
        executionGateReasons.push(marketHours.reason);
      }
    }

    const proposedTradeValueUsd =
      decision.action === "BUY"
        ? Math.min(portfolioState.totalValueUsd * profile.parameters.maxNewTradePct, Math.max(0, portfolioState.cashUsd - portfolioState.totalValueUsd * profile.parameters.cashReservePct))
        : position?.marketValueUsd ?? 0;
    const baseRisk = assessPaperTrade({
      action: decision.action,
      marketData,
      portfolioValueUsd: portfolioState.totalValueUsd,
      cashUsd: portfolioState.cashUsd,
      currentPositionValueUsd: position?.marketValueUsd ?? 0,
      proposedTradeValueUsd,
      drawdownPct: portfolioState.drawdownPct,
      duplicateSignal,
      openedNewPositionThisRun,
      hasPosition: !!position && position.quantity > 0,
      maxNewTradePct: profile.parameters.maxNewTradePct,
      maxPositionPct: profile.parameters.maxPositionPct,
      drawdownBlockPct: profile.parameters.drawdownBlockPct,
      investmentPolicy,
      orderIntent: decision.action === "SELL" ? "long_sell" : "long_buy"
    });
    const risk =
      executionGateReasons.length > 0
        ? {
            allowed: false,
            riskScore: 0.9,
            reasons: [...baseRisk.reasons, ...executionGateReasons]
          }
        : baseRisk;

    const recommendationId = await recordRecommendationAndJournal(env.DB, portfolioId, marketData, decision, risk, screen, profile, options.auditContext);
    persistedRecommendations += 1;

    let executed = false;
    let reason = risk.reasons.join(" ");

    if (risk.allowed && (decision.action === "BUY" || decision.action === "SELL")) {
      const execution = await executePaperTrade(env.DB, portfolioId, marketData, decision, proposedTradeValueUsd, position, profile, options.auditContext, recommendationId);
      executed = execution.executed;
      reason = execution.reason;
      if (executed) {
        progressTradesExecuted += 1;
      }
      if (executed && decision.action === "BUY" && !position) {
        openedNewPositionThisRun = true;
      }
    }

    summaries.push({
      symbol: asset.symbol,
      action: risk.allowed ? decision.action : "DO_NOTHING",
      executed,
      reason,
      signalKey: decision.signalKey,
      rank: screen.rank,
      screenScore: screen.score
    });
    if (options.onProgress && summaries.length % progressInterval === 0) {
      await options.onProgress({
        phase: progressTradesExecuted > 0 ? "execute" : "persist_decisions",
        symbolsProcessed: summaries.length,
        recommendationsPersisted: persistedRecommendations,
        tradesExecuted: progressTradesExecuted,
        budget: options.budget ?? null
      });
    }
  }

  const cashManagementSummary = await evaluateIraIdleCashFallback({
    db: env.DB,
    portfolioId,
    profile,
    investmentPolicy,
    assets,
    evaluated,
    hasOrdinaryExecution: progressTradesExecuted > 0,
    executionAllowedBySystem,
    auditContext: options.auditContext,
    now
  });
  if (cashManagementSummary) {
    summaries.push(cashManagementSummary.summary);
    persistedRecommendations += 1;
    if (cashManagementSummary.executed) {
      progressTradesExecuted += 1;
    }
  }

  const executedTradeCount = summaries.filter((summary) => summary.executed).length;
  if (options.onProgress) {
    await options.onProgress({
      phase: executedTradeCount > 0 ? "maintenance" : "finalize",
      symbolsProcessed: summaries.length,
      recommendationsPersisted: persistedRecommendations,
      tradesExecuted: executedTradeCount,
      budget: options.budget ?? null
    });
  }
  const maintenanceResult = options.runMaintenance ?? true
    ? await runPostStrategyMaintenance(env.DB, portfolioId, runStartedAt, now)
    : await lightweightPerformanceSummary(env.DB, portfolioId, runStartedAt);
  const finalPortfolio = await calculatePortfolioState(env.DB, await getPortfolioRow(env.DB, portfolioId), new Map(), portfolioId);
  const summary = {
    runKey,
    profile: {
      portfolioId,
      profileKey: profile.profileKey,
      displayName: profile.displayName,
      riskPosture: profile.riskPosture
    },
    startedAt: runStartedAt,
    trigger: options.trigger ?? "manual",
    paperOnly: true,
    liveTradingEnabled: false,
    candidateUniverse: {
      source: candidateUniverse.source,
      reason: candidateUniverse.reason,
      symbols: assets.map((asset) => asset.symbol)
    },
    symbols: summaries,
    portfolio: finalPortfolio,
    performance: maintenanceResult.performance,
    maintenance: maintenanceResult.maintenance
  };

  await env.DB.prepare("INSERT INTO strategy_runs (id, run_key, status, summary_json) VALUES (?, ?, ?, ?)")
    .bind(id("run", runKey), runKey, "completed", JSON.stringify(summary))
    .run();

  return summary;
}

async function evaluateIraIdleCashFallback(input: {
  db: D1Database;
  portfolioId: string;
  profile: PortfolioProfile;
  investmentPolicy: Awaited<ReturnType<typeof getInvestmentPolicy>>;
  assets: AssetRegistryRecord[];
  evaluated: RankedOpportunity[];
  hasOrdinaryExecution: boolean;
  executionAllowedBySystem: boolean;
  auditContext?: PaperRunAuditContext;
  now: Date;
}): Promise<{ summary: RunSymbolSummary; executed: boolean } | null> {
  if (input.portfolioId !== "portfolio_ira" || input.profile.profileKey !== "ira") {
    return null;
  }

  const parameters = resolveIraCashManagementParameters(input.profile.parameters.iraCashManagement);
  const targetAsset = firstSupportedIraCashAsset(parameters.conservativeAllowlist.map((asset) => asset.symbol), input.assets);
  const targetMarketData = targetAsset
    ? input.evaluated.find((item) => item.asset.symbol === targetAsset.symbol)?.marketData ?? null
    : null;
  const portfolio = await getPortfolioRow(input.db, input.portfolioId);
  const position = targetAsset ? await getPosition(input.db, input.portfolioId, targetAsset.symbol) : null;
  const state = await calculatePortfolioState(input.db, portfolio, targetMarketData ? new Map([[targetMarketData.symbol, targetMarketData.priceUsd]]) : new Map(), input.portfolioId);
  const tradedTargetToday = targetAsset ? await hasTradedSymbolOnAccountDay(input.db, input.portfolioId, targetAsset.symbol, input.now) : false;
  const policyDecision = evaluateIraCashManagement({
    portfolioId: input.portfolioId,
    cashUsd: state.cashUsd,
    totalValueUsd: state.totalValueUsd,
    existingPositionValueUsd: position?.marketValueUsd ?? 0,
    asset: targetAsset,
    marketData: targetMarketData,
    hasOrdinaryExecution: input.hasOrdinaryExecution,
    tradedTargetToday,
    maxNewTradePct: input.profile.parameters.maxNewTradePct,
    currentPositionLimitPct: input.profile.parameters.maxPositionPct,
    feeRate: input.profile.parameters.feeRate,
    slippageBps: input.profile.parameters.slippageBps,
    now: input.now,
    parameters
  });
  const marketData = targetMarketData ?? cashManagementPlaceholderMarketData(policyDecision, input.now);
  const decision = iraCashStrategyDecision(marketData, policyDecision);
  const executionGateReasons: string[] = [];
  if (decision.action === "BUY") {
    if (!input.executionAllowedBySystem) {
      executionGateReasons.push("Automation is paused, so scheduled paper execution is blocked.");
    }
    if (!targetAsset?.tradable) {
      executionGateReasons.push(`${policyDecision.targetSymbol ?? "Target asset"} is not enabled for paper execution.`);
    }
    if (targetAsset) {
      const marketHours = canExecuteAt(marketData.assetClass, input.now, targetAsset.marketHoursMode);
      if (!marketHours.allowed && marketHours.reason) {
        executionGateReasons.push(marketHours.reason);
      }
    }
  }
  const baseRisk = assessPaperTrade({
    action: decision.action,
    marketData,
    portfolioValueUsd: state.totalValueUsd,
    cashUsd: state.cashUsd,
    currentPositionValueUsd: position?.marketValueUsd ?? 0,
    proposedTradeValueUsd: policyDecision.proposedDeploymentUsd,
    drawdownPct: state.drawdownPct,
    duplicateSignal: await hasProcessedSignal(input.db, input.portfolioId, decision.signalKey),
    openedNewPositionThisRun: false,
    hasPosition: !!position && position.quantity > 0,
    maxNewTradePct: input.profile.parameters.maxNewTradePct,
    maxPositionPct: input.profile.parameters.maxPositionPct,
    drawdownBlockPct: input.profile.parameters.drawdownBlockPct,
    investmentPolicy: input.investmentPolicy,
    orderIntent: "long_buy"
  });
  const risk = executionGateReasons.length > 0
    ? { allowed: false, riskScore: 0.9, reasons: [...baseRisk.reasons, ...executionGateReasons] }
    : baseRisk;
  const recommendationId = await recordRecommendationAndJournal(input.db, input.portfolioId, marketData, decision, risk, undefined, input.profile, input.auditContext);
  let executed = false;
  let reason = decision.action === "DO_NOTHING" ? decision.explanation : risk.reasons.join(" ");
  if (risk.allowed && decision.action === "BUY" && targetAsset) {
    const execution = await executePaperTrade(input.db, input.portfolioId, marketData, decision, policyDecision.proposedDeploymentUsd, position, input.profile, input.auditContext, recommendationId);
    executed = execution.executed;
    reason = execution.reason;
  }
  return {
    executed,
    summary: {
      symbol: policyDecision.targetSymbol ?? "IRA_CASH",
      action: risk.allowed ? decision.action : "DO_NOTHING",
      executed,
      reason,
      signalKey: decision.signalKey,
      rank: null,
      screenScore: undefined
    }
  };
}

export async function recoverPaperStrategyRunFromPersistedWork(
  env: Env,
  options: {
    runKey: string;
    portfolioId: string;
    startedAt: string;
    now: Date;
    expectedSymbols: number;
    budget?: PaperRunBudget;
    runMaintenance?: boolean;
  }
): Promise<unknown | null> {
  const existingRun = await env.DB.prepare("SELECT summary_json AS summaryJson FROM strategy_runs WHERE run_key = ?")
    .bind(options.runKey)
    .first<{ summaryJson: string }>();
  if (existingRun) {
    return { idempotent: true, ...JSON.parse(existingRun.summaryJson) };
  }

  const recommendations = await listRows<PersistedRecommendationRow>(
    env.DB.prepare(
      `SELECT symbol, action, explanation, signal_key AS signalKey,
        screen_rank AS screenRank, screen_score AS screenScore, created_at AS createdAt
       FROM recommendations
       WHERE portfolio_id = ? AND created_at >= datetime(?)
       ORDER BY created_at ASC`
    ).bind(options.portfolioId, options.startedAt)
  );
  incrementBudget(options.budget, "d1Reads");

  if (recommendations.length < options.expectedSymbols) {
    return null;
  }

  const signalKeys = recommendations.map((row) => row.signalKey);
  const placeholders = signalKeys.map(() => "?").join(",");
  const trades = signalKeys.length
    ? await listRows<PersistedTradeRow>(
        env.DB.prepare(
          `SELECT signal_key AS signalKey
           FROM trades
           WHERE portfolio_id = ? AND signal_key IN (${placeholders})`
        ).bind(options.portfolioId, ...signalKeys)
      )
    : [];
  incrementBudget(options.budget, "d1Reads");
  const executedSignals = new Set(trades.map((row) => row.signalKey));
  const profile = await getPortfolioProfile(env.DB, options.portfolioId);
  const executedTradeCount = executedSignals.size;
  const maintenanceResult = options.runMaintenance ?? (executedTradeCount > 0)
    ? await runPostStrategyMaintenance(env.DB, options.portfolioId, options.startedAt, options.now)
    : await lightweightPerformanceSummary(env.DB, options.portfolioId, options.startedAt);
  const finalPortfolio = await calculatePortfolioState(env.DB, await getPortfolioRow(env.DB, options.portfolioId), new Map(), options.portfolioId);
  const summary = {
    runKey: options.runKey,
    recovered: true,
    profile: {
      portfolioId: options.portfolioId,
      profileKey: profile.profileKey,
      displayName: profile.displayName,
      riskPosture: profile.riskPosture
    },
    startedAt: options.startedAt,
    trigger: "scheduled",
    paperOnly: true,
    liveTradingEnabled: false,
    symbols: recommendations.map((row) => ({
      symbol: row.symbol,
      action: row.action,
      executed: executedSignals.has(row.signalKey),
      reason: row.explanation,
      signalKey: row.signalKey,
      rank: row.screenRank,
      screenScore: row.screenScore ?? undefined
    })),
    portfolio: finalPortfolio,
    performance: maintenanceResult.performance,
    maintenance: maintenanceResult.maintenance
  };

  await env.DB.prepare("INSERT OR IGNORE INTO strategy_runs (id, run_key, status, summary_json) VALUES (?, ?, ?, ?)")
    .bind(id("run", options.runKey), options.runKey, "completed", JSON.stringify(summary))
    .run();
  incrementBudget(options.budget, "d1Writes");

  return summary;
}

export async function getMarket(db: D1Database): Promise<unknown> {
  const assets = await listEnabledWatchlistAssets(db);
  return {
    symbols: assets.map((asset) => asset.symbol),
    assets,
    statuses: await getMarketDataStatuses(db),
    latest: await listRows(
      db.prepare(
        `SELECT symbol, asset_class AS assetClass, source, price_usd AS priceUsd,
          price_as_of AS priceAsOf, volume, validation_status AS validationStatus,
          CASE
            WHEN validation_status = 'validated' THEN 'Market data is available.'
            WHEN error LIKE '%stale%' THEN symbol || ' evaluation deferred because the latest quote was stale.'
            ELSE 'Market data temporarily unavailable; no trade was made.'
          END AS userMessage,
          created_at AS createdAt
         FROM market_snapshots
         ORDER BY created_at DESC
         LIMIT 20`
      )
    )
  };
}

export async function getDiagnostics(db: D1Database): Promise<unknown> {
  return {
    marketDataStatus: await getMarketDataStatuses(db, true),
    recentMarketErrors: await listRows(
      db.prepare(
        `SELECT symbol, source, validation_status AS validationStatus, error,
          price_as_of AS priceAsOf, created_at AS createdAt
         FROM market_snapshots
         WHERE validation_status != 'validated' OR error IS NOT NULL
         ORDER BY created_at DESC
         LIMIT 30`
      )
    )
  };
}

export async function getTrades(db: D1Database, portfolioId = TIM_PORTFOLIO_ID): Promise<unknown> {
  return {
    trades: await listRows(
      db.prepare(
        `SELECT id, order_id AS orderId, symbol, asset_class AS assetClass, side,
          quantity, price_usd AS priceUsd, fees_usd AS feesUsd, paper_only AS paperOnly,
          signal_key AS signalKey, executed_at AS executedAt
         FROM trades
         WHERE portfolio_id = ?
         ORDER BY executed_at DESC
         LIMIT 50`
      )
      .bind(portfolioId)
    )
  };
}

export async function getPerformance(db: D1Database, portfolioId = TIM_PORTFOLIO_ID): Promise<unknown> {
  const portfolio = await getPortfolioRow(db, portfolioId);
  const state = await calculatePortfolioState(db, portfolio, new Map(), portfolioId);
  const snapshots = await listRows(
    db.prepare(
      `SELECT snapshot_date AS snapshotDate, cash_usd AS cashUsd,
        positions_value_usd AS positionsValueUsd, total_value_usd AS totalValueUsd,
        created_at AS createdAt
       FROM daily_snapshots
       WHERE portfolio_id = ?
       ORDER BY created_at DESC
       LIMIT 30`
    ).bind(portfolioId)
  );

  return { portfolio: state, metrics: await calculatePerformance(db, portfolioId), snapshots };
}

export async function getOpportunities(db: D1Database, portfolioId = TIM_PORTFOLIO_ID): Promise<unknown> {
  const recommendations = await listRows<{
    symbol: string;
    assetType: string | null;
    action: string;
    explanation: string;
    confidenceScore: number;
    riskScore: number;
    screenEligible: number | null;
    screenScore: number | null;
    screenRank: number | null;
    screenReason: string | null;
    dataFreshness: string | null;
    currentExposurePct: number | null;
    priceUsd: number | null;
    priceAsOf: string | null;
    signalKey: string;
    createdAt: string;
  }>(
    db.prepare(
      `SELECT symbol, asset_type AS assetType, action, explanation, confidence_score AS confidenceScore,
        risk_score AS riskScore, price_usd AS priceUsd, price_as_of AS priceAsOf,
        screen_eligible AS screenEligible, screen_score AS screenScore,
        screen_rank AS screenRank, screen_reason AS screenReason,
        data_freshness AS dataFreshness, current_exposure_pct AS currentExposurePct,
        signal_key AS signalKey, created_at AS createdAt
       FROM recommendations
       WHERE portfolio_id = ?
       ORDER BY created_at DESC
       LIMIT 30`
    )
    .bind(portfolioId)
  );

  return {
    opportunities: recommendations.map((row) => ({
      symbol: row.symbol,
      assetType: row.assetType ?? "unknown",
      eligible: row.screenEligible === null ? row.action !== "DO_NOTHING" : row.screenEligible === 1,
      screenScore: row.screenScore,
      rank: row.screenRank,
      latestPriceOrNav: row.priceUsd,
      freshness: row.dataFreshness ?? "Unavailable",
      decision: row.action,
      confidence: row.confidenceScore,
      exclusionOrSkipReason: row.screenReason ?? row.explanation,
      currentExposure: row.currentExposurePct,
      priceAsOf: row.priceAsOf,
      createdAt: row.createdAt,
      signalKey: row.signalKey
    })),
    rejected: recommendations.filter((row) => row.action === "DO_NOTHING" || row.screenEligible === 0),
    policy: {
      paperOnly: true,
      defaultAction: "DO_NOTHING",
      explanation: "Opportunities are logged recommendations from the paper strategy. Execution remains blocked unless validation and risk checks pass."
    }
  };
}

async function getPortfolioRow(db: D1Database, portfolioId: string): Promise<PortfolioRow> {
  const row = await db
    .prepare("SELECT id, cash_usd AS cashUsd, starting_balance_usd AS startingBalanceUsd FROM portfolios WHERE id = ?")
    .bind(portfolioId)
    .first<PortfolioRow>();

  if (!row) {
    throw new Error("Paper portfolio is not initialized.");
  }

  return row;
}

async function getPosition(db: D1Database, portfolioId: string, symbol: string): Promise<PositionRow | null> {
  return db
    .prepare(
      `SELECT id, symbol, asset_class AS assetClass, quantity,
        avg_entry_price_usd AS avgEntryPriceUsd, current_price_usd AS currentPriceUsd,
        market_value_usd AS marketValueUsd
       FROM positions
       WHERE portfolio_id = ? AND symbol = ? AND quantity > 0`
    )
    .bind(portfolioId, symbol)
    .first<PositionRow>();
}

async function getOpenPositions(db: D1Database, portfolioId: string): Promise<PositionRow[]> {
  return listRows<PositionRow>(
    db
      .prepare(
        `SELECT id, symbol, asset_class AS assetClass, quantity,
          avg_entry_price_usd AS avgEntryPriceUsd, current_price_usd AS currentPriceUsd,
          market_value_usd AS marketValueUsd
         FROM positions
         WHERE portfolio_id = ? AND quantity > 0`
      )
      .bind(portfolioId)
  );
}

async function completedTradesForAccountDay(db: D1Database, portfolioId: string, now: Date): Promise<number> {
  const day = now.toISOString().slice(0, 10);
  const row = await db.prepare(
    "SELECT COUNT(*) AS count FROM trades WHERE portfolio_id = ? AND substr(executed_at, 1, 10) = ?"
  ).bind(portfolioId, day).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function latestTradeForPortfolio(db: D1Database, portfolioId: string): Promise<{ executedAt: string | null } | null> {
  return db.prepare(
    "SELECT executed_at AS executedAt FROM trades WHERE portfolio_id = ? ORDER BY executed_at DESC LIMIT 1"
  ).bind(portfolioId).first<{ executedAt: string | null }>();
}

async function hasTradedSymbolOnAccountDay(db: D1Database, portfolioId: string, symbol: string, now: Date): Promise<boolean> {
  const day = now.toISOString().slice(0, 10);
  const row = await db.prepare(
    "SELECT id FROM trades WHERE portfolio_id = ? AND symbol = ? AND substr(executed_at, 1, 10) = ? LIMIT 1"
  ).bind(portfolioId, symbol, day).first<{ id: string }>();
  return !!row;
}

function cooldownMinutesRemaining(latestTradeAt: string | null, now: Date, cooldownMinutes: number): number {
  if (!latestTradeAt || cooldownMinutes <= 0) return 0;
  const tradeTime = new Date(latestTradeAt.endsWith("Z") ? latestTradeAt : `${latestTradeAt.replace(" ", "T")}Z`).getTime();
  if (!Number.isFinite(tradeTime)) return 0;
  const elapsed = Math.floor((now.getTime() - tradeTime) / 60000);
  return Math.max(0, cooldownMinutes - elapsed);
}

function firstSupportedIraCashAsset(symbols: string[], assets: AssetRegistryRecord[]): AssetRegistryRecord | null {
  const bySymbol = new Map(assets.map((asset) => [asset.symbol, asset]));
  for (const symbol of symbols) {
    const asset = bySymbol.get(symbol.toUpperCase());
    if (asset) return asset;
  }
  return null;
}

function iraCashStrategyDecision(marketData: MarketDataset, policy: IraCashManagementDecision): StrategyDecision {
  const action = policy.action;
  const amount = policy.proposedDeploymentUsd > 0 ? ` Proposed deployment: $${policy.proposedDeploymentUsd.toFixed(4)}.` : " Proposed deployment: $0.0000.";
  const quote = policy.decisionPriceUsd
    ? ` Quote: $${policy.decisionPriceUsd.toFixed(4)} from ${policy.quoteSource ?? "unknown source"} at ${policy.quoteTimestamp ?? "unknown time"}; freshness ${policy.quoteFreshness}.`
    : ` Quote: unavailable; freshness ${policy.quoteFreshness}.`;
  const audit = ` Cash before: $${policy.cashBeforeUsd.toFixed(2)}. Required reserve: $${policy.requiredReserveUsd.toFixed(2)}. Target reserve: $${policy.targetReserveUsd.toFixed(2)}. Deployable excess cash: $${policy.deployableExcessCashUsd.toFixed(2)}. Maximum risk-cap amount: $${policy.maxNewTradeUsd.toFixed(4)}.${amount} Selected asset: ${policy.targetSymbol ?? "none"}.${quote} Estimated fee: $${policy.feeUsd.toFixed(4)}. Estimated slippage: $${policy.slippageUsd.toFixed(4)}.`;
  const day = marketData.asOf.slice(0, 10);
  return {
    symbol: marketData.symbol,
    action,
    confidenceScore: policy.confidenceScore,
    riskScore: policy.riskScore,
    indicators: {
      shortMovingAverage: null,
      longMovingAverage: null,
      rsi: null,
      momentumPct: null
    },
    explanation: `${policy.reason}${audit}`,
    signalKey: `IRA_CASH:${marketData.symbol}:${action}:${day}`,
    transactionCostEstimateUsd: policy.feeUsd + policy.slippageUsd
  };
}

function cashManagementPlaceholderMarketData(policy: IraCashManagementDecision, now: Date): MarketDataset {
  const symbol = policy.targetSymbol ?? "IRA_CASH";
  const timestamp = policy.quoteTimestamp ?? now.toISOString();
  return {
    symbol,
    assetClass: "yield",
    priceUsd: policy.decisionPriceUsd ?? 0,
    asOf: timestamp,
    source: policy.quoteSource ?? "ira_cash_management_policy",
    validated: false,
    candles: [],
    stale: true,
    error: policy.reason,
    userMessage: policy.reason,
    status: "deferred",
    quality: "invalid"
  };
}

async function getMarketData(
  db: D1Database,
  marketDataService: MarketDataService,
  asset: AssetRegistryRecord,
  now: Date,
  sharedSnapshot?: MarketDataSnapshot,
  budget?: PaperRunBudget
): Promise<MarketDataset> {
  const symbol = asset.symbol;
  const snapshotQuote = sharedSnapshot?.quotes.get(asset.providerSymbol) ?? sharedSnapshot?.quotes.get(symbol);
  if (snapshotQuote) {
    incrementBudget(budget, "cacheHits");
    return { ...quoteToMarketDataset(snapshotQuote), symbol: asset.symbol, assetClass: asset.assetType };
  }
  incrementBudget(budget, "d1Reads");
  const cached = await getCachedMarketData(db, symbol, now);
  if (cached) {
    incrementBudget(budget, "cacheHits");
    return cached;
  }

  incrementBudget(budget, "cacheMisses");
  incrementBudget(budget, "outboundProviderRequests");
  const live = quoteToMarketDataset(await marketDataService.getQuote(asset.providerSymbol, "proposal", now));
  const normalizedLive = { ...live, symbol: asset.symbol, assetClass: asset.assetType };
  if (normalizedLive.validated) {
    return normalizedLive;
  }

  const lastKnownGood = await getLastKnownGoodMarketData(db, symbol, now);
  if (lastKnownGood) {
    return {
      ...lastKnownGood,
      userMessage: `${symbol} live data is temporarily unavailable; using a recent validated snapshot.`,
      technicalError: normalizedLive.technicalError ?? normalizedLive.error,
      error: `${symbol} live data is temporarily unavailable; using a recent validated snapshot.`
    };
  }

  return {
    ...normalizedLive,
    userMessage: normalizedLive.userMessage ?? userMessageForMarketData(symbol, normalizedLive.error),
    error: normalizedLive.userMessage ?? userMessageForMarketData(symbol, normalizedLive.error)
  };
}

function incrementBudget(budget: PaperRunBudget | undefined, key: keyof PaperRunBudget, amount = 1): void {
  if (!budget) return;
  budget[key] += amount;
}

export function exposureForAsset(
  asset: AssetRegistryRecord,
  positions: PositionRow[],
  totalValueUsd: number,
  drawdownPct: number
) {
  const denominator = totalValueUsd > 0 ? totalValueUsd : 1;
  const symbolExposureUsd = positions
    .filter((position) => position.symbol === asset.symbol)
    .reduce((sum, position) => sum + position.marketValueUsd, 0);
  const categoryExposureUsd = positions
    .filter((position) => position.assetClass === asset.assetType)
    .reduce((sum, position) => sum + position.marketValueUsd, 0);

  return {
    portfolioValueUsd: totalValueUsd,
    drawdownPct,
    symbolExposurePct: symbolExposureUsd / denominator,
    categoryExposurePct: categoryExposureUsd / denominator
  };
}

function screenedOutDecision(marketData: MarketDataset, screen: ScreenResult): StrategyDecision {
  const indicators = calculateIndicators(marketData.candles);
  const signalKey = `${marketData.symbol}:DO_NOTHING:screen:${marketData.asOf}:${screen.reason.slice(0, 48)}`;
  return {
    symbol: marketData.symbol,
    action: "DO_NOTHING",
    confidenceScore: 0.9,
    riskScore: 0.05,
    indicators,
    explanation: screen.reason,
    signalKey,
    transactionCostEstimateUsd: 0
  };
}

export function applyProfileDecisionPolicy(decision: StrategyDecision, profile: PortfolioProfile): StrategyDecision {
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

function adjustScreenForProfile(screen: ScreenResult, profile: PortfolioProfile): ScreenResult {
  let score = screen.score;
  const reasons: string[] = [];
  if (screen.assetType === "crypto") {
    score *= profile.parameters.cryptoPreference;
    if (profile.profileKey === "kairox_conservative" && screen.currentExposurePct > 0.05) {
      reasons.push("Conservative profile limits crypto exposure.");
    }
  }
  if (screen.assetType === "bond_fund" || screen.symbol === "SCHD") {
    score *= profile.parameters.dividendPreference;
  }
  if (profile.profileKey === "kairox_conservative" && screen.categoryExposurePct > 0.25) {
    reasons.push("Conservative profile applies stronger concentration protection.");
  }
  const eligible = screen.eligible && reasons.length === 0;
  return {
    ...screen,
    eligible,
    score: Math.round(Math.max(0, Math.min(100, score)) * 10000) / 10000,
    reason: eligible ? screen.reason : [screen.reason, ...reasons].join(" ")
  };
}

export async function calculatePortfolioState(db: D1Database, portfolio: PortfolioRow, prices: Map<string, number>, portfolioId: string) {
  const positions = await listRows<PositionRow>(
    db
      .prepare(
        `SELECT id, symbol, asset_class AS assetClass, quantity,
          avg_entry_price_usd AS avgEntryPriceUsd, current_price_usd AS currentPriceUsd,
          market_value_usd AS marketValueUsd
         FROM positions
         WHERE portfolio_id = ? AND quantity > 0`
      )
      .bind(portfolioId)
  );
  const positionsValueUsd = positions.reduce((sum, position) => {
    const price = prices.get(position.symbol) ?? position.currentPriceUsd;
    return sum + position.quantity * price;
  }, 0);
  const totalValueUsd = portfolio.cashUsd + positionsValueUsd;
  const highWater = await db
    .prepare("SELECT MAX(total_value_usd) AS highWater FROM daily_snapshots WHERE portfolio_id = ?")
    .bind(portfolioId)
    .first<{ highWater: number | null }>();
  const highWaterValue = Math.max(highWater?.highWater ?? portfolio.startingBalanceUsd, portfolio.startingBalanceUsd);
  const drawdownPct = highWaterValue > 0 ? Math.max(0, (highWaterValue - totalValueUsd) / highWaterValue) : 0;

  return {
    cashUsd: round(portfolio.cashUsd),
    positionsValueUsd: round(positionsValueUsd),
    totalValueUsd: round(totalValueUsd),
    drawdownPct: round(drawdownPct)
  };
}

async function recordMarketSnapshot(db: D1Database, data: MarketDataset): Promise<void> {
  await db
    .prepare(
      `INSERT INTO market_snapshots (
        id, symbol, asset_class, source, price_usd, price_as_of, volume,
        candles_json, validation_status, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id("market", `${data.symbol}:${data.asOf}:${Date.now()}`),
      data.symbol,
      data.assetClass,
      data.source,
      data.priceUsd || null,
      data.asOf,
      data.volume ?? null,
      JSON.stringify(data.candles.slice(-40)),
      data.validated ? "validated" : "invalid",
      data.error ?? null
    )
    .run();
}

async function recordRecommendationAndJournal(
  db: D1Database,
  portfolioId: string,
  marketData: MarketDataset,
  decision: StrategyDecision,
  risk: { allowed: boolean; riskScore: number; reasons: string[] },
  screen: ScreenResult | undefined,
  profile: PortfolioProfile,
  auditContext?: PaperRunAuditContext
): Promise<string> {
  const action = risk.allowed ? decision.action : "DO_NOTHING";
  const explanation = risk.allowed ? decision.explanation : `Risk checks blocked execution: ${risk.reasons.join(" ")}`;
  const recommendationId = id("rec", `${portfolioId}:${decision.signalKey}`);
  const journalId = id("journal", `${portfolioId}:${decision.signalKey}`);

  await db
    .prepare(
      `INSERT OR IGNORE INTO recommendations (
        id, portfolio_id, symbol, action, explanation, confidence_score, risk_score,
        market_data_source, price_usd, price_as_of, signal_key, indicators_json,
        transaction_cost_estimate_usd, asset_type, screen_eligible, screen_score,
        screen_rank, screen_reason, data_freshness, current_exposure_pct,
        scheduler_parent_run_id, scheduler_child_run_id, strategy_profile_key,
        quote_source, quote_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      recommendationId,
      portfolioId,
      marketData.symbol,
      action,
      explanation,
      decision.confidenceScore,
      risk.riskScore,
      marketData.source,
      marketData.priceUsd || null,
      marketData.asOf,
      decision.signalKey,
      JSON.stringify(decision.indicators),
      decision.transactionCostEstimateUsd,
      screen?.assetType ?? marketData.assetClass,
      screen ? (screen.eligible ? 1 : 0) : null,
      screen?.score ?? null,
      screen?.rank ?? null,
      screen?.reason ?? null,
      screen?.dataFreshness ?? null,
      screen?.currentExposurePct ?? null,
      auditContext?.schedulerParentRunId ?? null,
      auditContext?.schedulerChildRunId ?? null,
      auditContext?.strategyProfileKey ?? profile.profileKey,
      marketData.source,
      marketData.asOf
    )
    .run();

  await db
    .prepare(
      `INSERT OR IGNORE INTO decision_journal (
        id, portfolio_id, recommendation_id, decision, explanation,
        confidence_score, risk_score, price_data_json, signal_key,
        scheduler_parent_run_id, scheduler_child_run_id, strategy_profile_key,
        quote_source, quote_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      journalId,
      portfolioId,
      recommendationId,
      action,
      explanation,
      decision.confidenceScore,
      risk.riskScore,
      JSON.stringify({
        symbol: marketData.symbol,
        priceUsd: marketData.priceUsd,
        source: marketData.source,
        validated: marketData.validated,
        priceAsOf: marketData.asOf,
        volume: marketData.volume
      }),
      decision.signalKey,
      auditContext?.schedulerParentRunId ?? null,
      auditContext?.schedulerChildRunId ?? null,
      auditContext?.strategyProfileKey ?? profile.profileKey,
      marketData.source,
      marketData.asOf
    )
    .run();
  return recommendationId;
}

async function hasProcessedSignal(db: D1Database, portfolioId: string, signalKey: string): Promise<boolean> {
  const row = await db.prepare("SELECT id FROM trades WHERE portfolio_id = ? AND signal_key = ?").bind(portfolioId, signalKey).first<{ id: string }>();
  return !!row;
}

async function executePaperTrade(
  db: D1Database,
  portfolioId: string,
  marketData: MarketDataset,
  decision: StrategyDecision,
  proposedTradeValueUsd: number,
  position: PositionRow | null,
  profile: PortfolioProfile,
  auditContext: PaperRunAuditContext | undefined,
  recommendationId: string
): Promise<{ executed: boolean; reason: string }> {
  const side = decision.action;
  const orderId = id("order", `${portfolioId}:${decision.signalKey}`);
  const tradeId = id("trade", `${portfolioId}:${decision.signalKey}`);
  const idempotencyKey = `paper:${portfolioId}:${decision.signalKey}`;

  if (side === "BUY") {
    const notional = proposedTradeValueUsd;
    const fillPrice = marketData.priceUsd * (1 + SPREAD_RATE);
    const fee = Math.max(0.01, notional * FEE_RATE);
    const spendable = notional - fee;
    const quantity = spendable > 0 ? spendable / fillPrice : 0;

    if (quantity <= 0) {
      return { executed: false, reason: "Trade size too small after estimated costs." };
    }

    await db.batch([
      insertOrderStatement(db, portfolioId, orderId, marketData, side, quantity, fillPrice, fee, idempotencyKey, decision, profile, auditContext, recommendationId),
      insertTradeStatement(db, portfolioId, tradeId, orderId, marketData, side, quantity, fillPrice, fee, decision, profile, auditContext, recommendationId),
      upsertPositionStatement(db, portfolioId, marketData, quantity, fillPrice, position),
      updateCashStatement(db, portfolioId, -(quantity * fillPrice + fee))
    ]);
    return { executed: true, reason: "Paper buy filled at validated market price with estimated costs." };
  }

  if (side === "SELL" && position) {
    const fillPrice = marketData.priceUsd * (1 - SPREAD_RATE);
    const quantity = position.quantity;
    const gross = quantity * fillPrice;
    const fee = Math.max(0.01, gross * FEE_RATE);

    await db.batch([
      insertOrderStatement(db, portfolioId, orderId, marketData, side, quantity, fillPrice, fee, idempotencyKey, decision, profile, auditContext, recommendationId),
      insertTradeStatement(db, portfolioId, tradeId, orderId, marketData, side, quantity, fillPrice, fee, decision, profile, auditContext, recommendationId),
      closePositionStatement(db, position.id, marketData, fillPrice),
      updateCashStatement(db, portfolioId, gross - fee)
    ]);
    return { executed: true, reason: "Paper sell filled at validated market price with estimated costs." };
  }

  return { executed: false, reason: "No executable paper trade requested." };
}

async function insertOrder(
  db: D1Database,
  portfolioId: string,
  orderId: string,
  marketData: MarketDataset,
  side: "BUY" | "SELL",
  quantity: number,
  fillPrice: number,
  fee: number,
  idempotencyKey: string,
  decision: StrategyDecision
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO orders (
        id, portfolio_id, symbol, asset_class, side, order_type, quantity,
        status, paper_only, risk_checked, explanation, signal_key,
        estimated_fee_usd, fill_price_usd, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      orderId,
      portfolioId,
      marketData.symbol,
      marketData.assetClass,
      side,
      "market",
      quantity,
      "filled",
      1,
      1,
      decision.explanation,
      decision.signalKey,
      fee,
      fillPrice,
      idempotencyKey
    )
    .run();
}

function insertOrderStatement(
  db: D1Database,
  portfolioId: string,
  orderId: string,
  marketData: MarketDataset,
  side: "BUY" | "SELL",
  quantity: number,
  fillPrice: number,
  fee: number,
  idempotencyKey: string,
  decision: StrategyDecision,
  profile: PortfolioProfile,
  auditContext: PaperRunAuditContext | undefined,
  recommendationId: string
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO orders (
        id, portfolio_id, symbol, asset_class, side, order_type, quantity,
        status, paper_only, risk_checked, explanation, signal_key,
        estimated_fee_usd, fill_price_usd, idempotency_key, recommendation_id,
        scheduler_parent_run_id, scheduler_child_run_id, strategy_profile_key,
        decision_confidence, quote_source, quote_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      orderId,
      portfolioId,
      marketData.symbol,
      marketData.assetClass,
      side,
      "market",
      quantity,
      "filled",
      1,
      1,
      decision.explanation,
      decision.signalKey,
      fee,
      fillPrice,
      idempotencyKey,
      recommendationId,
      auditContext?.schedulerParentRunId ?? null,
      auditContext?.schedulerChildRunId ?? null,
      auditContext?.strategyProfileKey ?? profile.profileKey,
      decision.confidenceScore,
      marketData.source,
      marketData.asOf
    );
}

async function insertTrade(
  db: D1Database,
  portfolioId: string,
  tradeId: string,
  orderId: string,
  marketData: MarketDataset,
  side: "BUY" | "SELL",
  quantity: number,
  fillPrice: number,
  fee: number,
  signalKey: string
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO trades (
        id, order_id, portfolio_id, symbol, asset_class, side,
        quantity, price_usd, fees_usd, paper_only, signal_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(tradeId, orderId, portfolioId, marketData.symbol, marketData.assetClass, side, quantity, fillPrice, fee, 1, signalKey)
    .run();
}

function insertTradeStatement(
  db: D1Database,
  portfolioId: string,
  tradeId: string,
  orderId: string,
  marketData: MarketDataset,
  side: "BUY" | "SELL",
  quantity: number,
  fillPrice: number,
  fee: number,
  decision: StrategyDecision,
  profile: PortfolioProfile,
  auditContext: PaperRunAuditContext | undefined,
  recommendationId: string
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO trades (
        id, order_id, portfolio_id, symbol, asset_class, side,
        quantity, price_usd, fees_usd, paper_only, signal_key, recommendation_id,
        scheduler_parent_run_id, scheduler_child_run_id, strategy_profile_key,
        decision_confidence, quote_source, quote_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      tradeId,
      orderId,
      portfolioId,
      marketData.symbol,
      marketData.assetClass,
      side,
      quantity,
      fillPrice,
      fee,
      1,
      decision.signalKey,
      recommendationId,
      auditContext?.schedulerParentRunId ?? null,
      auditContext?.schedulerChildRunId ?? null,
      auditContext?.strategyProfileKey ?? profile.profileKey,
      decision.confidenceScore,
      marketData.source,
      marketData.asOf
    );
}

async function upsertPosition(
  db: D1Database,
  portfolioId: string,
  marketData: MarketDataset,
  quantity: number,
  fillPrice: number,
  existing: PositionRow | null
): Promise<void> {
  const positionId = `pos_${portfolioId}_${marketData.symbol.replace(/[^A-Z0-9]/g, "_")}`;
  const existingQuantity = existing?.quantity ?? 0;
  const newQuantity = existingQuantity + quantity;
  const newAverage =
    newQuantity > 0
      ? ((existingQuantity * (existing?.avgEntryPriceUsd ?? 0)) + quantity * fillPrice) / newQuantity
      : fillPrice;

  await db
    .prepare(
      `INSERT INTO positions (
        id, portfolio_id, symbol, asset_class, quantity,
        avg_entry_price_usd, current_price_usd, market_value_usd, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        quantity = excluded.quantity,
        avg_entry_price_usd = excluded.avg_entry_price_usd,
        current_price_usd = excluded.current_price_usd,
        market_value_usd = excluded.market_value_usd,
        updated_at = datetime('now')`
    )
    .bind(
      positionId,
      portfolioId,
      marketData.symbol,
      marketData.assetClass,
      newQuantity,
      newAverage,
      marketData.priceUsd,
      newQuantity * marketData.priceUsd
    )
    .run();
}

function upsertPositionStatement(
  db: D1Database,
  portfolioId: string,
  marketData: MarketDataset,
  quantity: number,
  fillPrice: number,
  existing: PositionRow | null
): D1PreparedStatement {
  const positionId = `pos_${portfolioId}_${marketData.symbol.replace(/[^A-Z0-9]/g, "_")}`;
  const existingQuantity = existing?.quantity ?? 0;
  const newQuantity = existingQuantity + quantity;
  const newAverage =
    newQuantity > 0
      ? ((existingQuantity * (existing?.avgEntryPriceUsd ?? 0)) + quantity * fillPrice) / newQuantity
      : fillPrice;

  return db
    .prepare(
      `INSERT INTO positions (
        id, portfolio_id, symbol, asset_class, quantity,
        avg_entry_price_usd, current_price_usd, market_value_usd, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        quantity = excluded.quantity,
        avg_entry_price_usd = excluded.avg_entry_price_usd,
        current_price_usd = excluded.current_price_usd,
        market_value_usd = excluded.market_value_usd,
        updated_at = datetime('now')`
    )
    .bind(
      positionId,
      portfolioId,
      marketData.symbol,
      marketData.assetClass,
      newQuantity,
      newAverage,
      marketData.priceUsd,
      newQuantity * marketData.priceUsd
    );
}

async function closePosition(db: D1Database, positionId: string, marketData: MarketDataset, fillPrice: number): Promise<void> {
  await db
    .prepare(
      `UPDATE positions
       SET quantity = 0, current_price_usd = ?, market_value_usd = 0, updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(fillPrice, positionId)
    .run();
}

function closePositionStatement(db: D1Database, positionId: string, marketData: MarketDataset, fillPrice: number): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE positions
       SET quantity = 0, current_price_usd = ?, market_value_usd = 0, updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(fillPrice, positionId);
}

async function updateCash(db: D1Database, portfolioId: string, deltaUsd: number): Promise<void> {
  await db
    .prepare("UPDATE portfolios SET cash_usd = cash_usd + ?, updated_at = datetime('now') WHERE id = ?")
    .bind(deltaUsd, portfolioId)
    .run();
}

function updateCashStatement(db: D1Database, portfolioId: string, deltaUsd: number): D1PreparedStatement {
  return db
    .prepare("UPDATE portfolios SET cash_usd = cash_usd + ?, updated_at = datetime('now') WHERE id = ?")
    .bind(deltaUsd, portfolioId);
}

async function updateDailyAndBenchmarks(db: D1Database, portfolioId = TIM_PORTFOLIO_ID): Promise<void> {
  const portfolio = await getPortfolioRow(db, portfolioId);
  const state = await calculatePortfolioState(db, portfolio, new Map(), portfolioId);
  const snapshotDate = new Date().toISOString().slice(0, 10);
  const latestBtc = await latestValidatedMarket(db, "BTC-USD");
  const latestSpy = await latestValidatedMarket(db, "SPY");

  await db
    .prepare(
      `INSERT OR REPLACE INTO daily_snapshots (
        id, portfolio_id, snapshot_date, cash_usd, positions_value_usd, total_value_usd
      ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(`snapshot_${portfolioId}_${snapshotDate}`, portfolioId, snapshotDate, state.cashUsd, state.positionsValueUsd, state.totalValueUsd)
    .run();

  await db
    .prepare(
      `INSERT OR REPLACE INTO benchmark_snapshots (
        id, benchmark_name, snapshot_date, symbol, starting_value_usd, units,
        price_usd, value_usd, market_data_source, price_as_of
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(`benchmark_cash_${snapshotDate}`, "cash", snapshotDate, "USD", 20, 20, 1, 20, "system", new Date().toISOString())
    .run();

  if (latestBtc) {
    await upsertBenchmark(db, "bitcoin_buy_and_hold", snapshotDate, "BTC", latestBtc.priceUsd, latestBtc.source, latestBtc.priceAsOf);
  }

  if (latestSpy) {
    await upsertBenchmark(db, "spy_buy_and_hold", snapshotDate, "SPY", latestSpy.priceUsd, latestSpy.source, latestSpy.priceAsOf);
  }
}

async function runPostStrategyMaintenance(
  db: D1Database,
  portfolioId: string,
  runStartedAt: string,
  now: Date
): Promise<{ performance: unknown; maintenance: { mode: "full"; skipped: false } }> {
  await updateDailyAndBenchmarks(db, portfolioId);
  const performance = await recordEquityHistory(db, runStartedAt, portfolioId);
  await ensureDailyStartSnapshot(db, portfolioId, now);
  const valuation = await getPortfolioValuation(db, portfolioId, now);
  await recordValuationSnapshot(db, valuation);
  await completeDailySnapshot(db, portfolioId, now);
  await evaluateAndAwardMilestones(db, portfolioId, valuation);
  await recordValuationJourneyEvents(db, valuation);
  await generateSummaries(db, now);
  return { performance, maintenance: { mode: "full", skipped: false } };
}

async function lightweightPerformanceSummary(
  db: D1Database,
  portfolioId: string,
  runStartedAt: string
): Promise<{ performance: unknown; maintenance: { mode: "skipped_no_trade_observation"; skipped: true; reason: string } }> {
  const portfolio = await getPortfolioRow(db, portfolioId);
  const state = await calculatePortfolioState(db, portfolio, new Map(), portfolioId);
  return {
    performance: {
      startingBalanceUsd: portfolio.startingBalanceUsd,
      cashUsd: state.cashUsd,
      positionsValueUsd: state.positionsValueUsd,
      totalValueUsd: state.totalValueUsd,
      totalReturnUsd: round(state.totalValueUsd - portfolio.startingBalanceUsd),
      totalReturnPct: portfolio.startingBalanceUsd > 0 ? round((state.totalValueUsd - portfolio.startingBalanceUsd) / portfolio.startingBalanceUsd) : 0,
      maxDrawdownPct: state.drawdownPct,
      benchmarkReturns: [],
      generatedAt: runStartedAt
    },
    maintenance: {
      mode: "skipped_no_trade_observation",
      skipped: true,
      reason: "No paper trade executed; deferred valuation, milestone, journey, and summary maintenance to scheduled portfolio workflows."
    }
  };
}

async function latestValidatedMarket(
  db: D1Database,
  symbol: string
): Promise<{ priceUsd: number; source: string; priceAsOf: string } | null> {
  return db
    .prepare(
      `SELECT price_usd AS priceUsd, source, price_as_of AS priceAsOf
       FROM market_snapshots
       WHERE symbol = ? AND validation_status = 'validated' AND price_usd > 0
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(symbol)
    .first<{ priceUsd: number; source: string; priceAsOf: string }>();
}

async function upsertBenchmark(
  db: D1Database,
  benchmarkName: string,
  snapshotDate: string,
  symbol: string,
  priceUsd: number,
  source: string,
  priceAsOf: string
): Promise<void> {
  const previous = await db
    .prepare(
      `SELECT units FROM benchmark_snapshots
       WHERE benchmark_name = ? AND units > 0
       ORDER BY created_at ASC
       LIMIT 1`
    )
    .bind(benchmarkName)
    .first<{ units: number }>();
  const units = previous?.units && previous.units > 0 ? previous.units : 20 / priceUsd;
  await db
    .prepare(
      `INSERT OR REPLACE INTO benchmark_snapshots (
        id, benchmark_name, snapshot_date, symbol, starting_value_usd, units,
        price_usd, value_usd, market_data_source, price_as_of
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      `benchmark_${benchmarkName}_${snapshotDate}`,
      benchmarkName,
      snapshotDate,
      symbol,
      20,
      units,
      priceUsd,
      units * priceUsd,
      source,
      priceAsOf
    )
    .run();
}

function id(prefix: string, key: string): string {
  return `${prefix}_${hashString(key)}`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
