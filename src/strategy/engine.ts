import { MarketDataService, type MarketDataSnapshot, type NormalizedQuote } from "../market/service.ts";
import { getInvestmentPolicy, validateInvestmentPolicy, type InvestmentPolicy } from "../policies/investmentPolicy.ts";
import { getPortfolioValuation } from "../portfolio/valuation.ts";
import { recordJourneyEvent } from "../journey/service.ts";
import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";
import { roundMoney, roundRatio } from "../shared/money.ts";
import type { AssetClass } from "../shared/types.ts";

export type StrategyDecisionAction =
  | "Hold"
  | "Buy"
  | "Add"
  | "Trim"
  | "Sell"
  | "Rebalance"
  | "Monitor"
  | "No Action"
  | "Data Incomplete";

export interface StrategyVersion {
  id: string;
  strategyName: string;
  strategyVersion: string;
  objective: string;
  status: "draft" | "active" | "retired";
  supportedRiskProfiles: string[];
  rules: StrategyRules;
  weights: Record<string, number>;
  thresholds: StrategyThresholds;
  allocationRanges: Record<string, AllocationRange>;
  changeNotes: string;
  createdAt: string;
}

export interface StrategyRules {
  prohibited?: string[];
  preferred?: string[];
}

export interface StrategyThresholds {
  minimumBuyScore: number;
  minimumConfidence: number;
  minimumTradeValueUsd: number;
  minimumPortfolioImprovement: number;
  maximumTurnoverPct: number;
  rebalanceDriftThresholdPct: number;
  trimThresholdPct: number;
  sellThreshold: number;
  cooldownDays: number;
  minimumScoreChange: number;
  minimumAllocationChangePct: number;
}

export interface AllocationRange {
  min: number;
  target: number;
  max: number;
}

export interface UniverseSecurity {
  symbol: string;
  securityName: string;
  assetType: AssetClass | string;
  assetCategory: string;
  sector: string;
  expenseRatio: number | null;
  averageVolume: number | null;
  bidAskSpread: number | null;
  dividendYield: number | null;
  duration: number | null;
  creditQuality: string | null;
  volatility: number | null;
  maximumDrawdown: number | null;
  historicalReturn: number | null;
  dataQualityStatus: string;
  eligibilityStatus: string;
  exclusionReason: string | null;
}

export interface StrategyFactorScore {
  factor: string;
  rawInput: unknown;
  normalizedScore: number | null;
  weight: number;
  contribution: number;
  available: boolean;
  scale: string;
  reason?: string;
}

export interface SecurityScore {
  symbol: string;
  securityName: string;
  assetType: string;
  assetCategory: string;
  sector: string;
  eligibility: PolicyResult;
  quoteStatus: string;
  investmentScore: number;
  confidenceScore: number;
  factors: StrategyFactorScore[];
  supportingFactors: string[];
  opposingFactors: string[];
  missingFactors: string[];
  dataTimestamp: string | null;
}

export interface PolicyResult {
  allowed: boolean;
  reasons: string[];
}

export interface StrategyDecision {
  symbol: string;
  action: StrategyDecisionAction;
  currentAllocation: number;
  targetAllocationRange: AllocationRange | null;
  proposedAllocation: number;
  estimatedDollarChange: number;
  investmentScore: number;
  confidenceScore: number;
  triggeredRules: string[];
  supportingFactors: string[];
  opposingFactors: string[];
  policyResult: PolicyResult;
  dataTimestamp: string | null;
  strategyVersion: string;
  explanation: string;
}

export interface PortfolioAnalysis {
  cashPct: number;
  categoryAllocation: Record<string, number>;
  sectorAllocation: Record<string, number>;
  largestPositionPct: number;
  largestSectorPct: number;
  cashReserveRequiredPct: number;
  maxSinglePositionPct: number;
  maxSectorAllocationPct: number;
  drift: Record<string, number>;
  policyWarnings: string[];
}

export interface StrategyRun {
  id: string;
  portfolioId: string;
  strategy: StrategyVersion;
  marketDataSnapshotId: string;
  dailyReviewId: string | null;
  currentPortfolioState: unknown;
  candidateUniverse: UniverseSecurity[];
  excludedCandidates: Array<{ symbol: string; reason: string }>;
  securityScores: SecurityScore[];
  portfolioAnalysis: PortfolioAnalysis;
  finalDecisions: StrategyDecision[];
  currentDecision: StrategyDecisionAction;
  confidenceScore: number;
  portfolioScore: number;
  riskScore: number;
  generatedAt: string;
  engineVersion: string;
  idempotent: boolean;
}

export interface StrategyRunOptions {
  dailyReviewId?: string | null;
  snapshotId?: string | null;
  now?: Date;
}

interface StrategyVersionRow {
  id: string;
  strategyName: string;
  strategyVersion: string;
  objective: string;
  status: StrategyVersion["status"];
  supportedRiskProfilesJson: string;
  rulesJson: string;
  weightsJson: string;
  thresholdsJson: string;
  allocationRangesJson: string;
  changeNotes: string;
  createdAt: string;
}

interface UniverseRow {
  symbol: string;
  securityName: string;
  assetType: string;
  assetCategory: string;
  sector: string;
  expenseRatio: number | null;
  averageVolume: number | null;
  bidAskSpread: number | null;
  dividendYield: number | null;
  duration: number | null;
  creditQuality: string | null;
  volatility: number | null;
  maximumDrawdown: number | null;
  historicalReturn: number | null;
  dataQualityStatus: string;
  eligibilityStatus: string;
  exclusionReason: string | null;
}

interface PositionRow {
  symbol: string;
  assetClass: AssetClass;
  quantity: number;
  avgEntryPriceUsd: number;
  currentPriceUsd: number;
  marketValueUsd: number;
}

interface PortfolioRow {
  id: string;
  mode: string;
  cashUsd: number;
  startingBalanceUsd: number;
}

interface StrategyRunRow {
  id: string;
  portfolioId: string;
  strategyVersionId: string;
  marketDataSnapshotId: string;
  dailyReviewId: string | null;
  currentPortfolioStateJson: string;
  candidateUniverseJson: string;
  excludedCandidatesJson: string;
  securityScoresJson: string;
  portfolioAnalysisJson: string;
  finalDecisionsJson: string;
  currentDecision: StrategyDecisionAction;
  confidenceScore: number;
  portfolioScore: number;
  riskScore: number;
  generatedAt: string;
  engineVersion: string;
}

export const STRATEGY_ENGINE_VERSION = "strategy-engine-v1";

const DEFAULT_THRESHOLDS: StrategyThresholds = {
  minimumBuyScore: 70,
  minimumConfidence: 0.7,
  minimumTradeValueUsd: 25,
  minimumPortfolioImprovement: 0.02,
  maximumTurnoverPct: 0.15,
  rebalanceDriftThresholdPct: 0.05,
  trimThresholdPct: 0.02,
  sellThreshold: 0.65,
  cooldownDays: 7,
  minimumScoreChange: 8,
  minimumAllocationChangePct: 0.02
};

export class StrategyEngine {
  private readonly db: D1Database;
  private readonly marketData: MarketDataService;

  constructor(db: D1Database, marketData = new MarketDataService(db)) {
    this.db = db;
    this.marketData = marketData;
  }

  async run(portfolioId = TIM_PORTFOLIO_ID, options: StrategyRunOptions = {}): Promise<StrategyRun> {
    const now = options.now ?? new Date();
    const [portfolio, policy, strategy, positions] = await Promise.all([
      this.getPortfolio(portfolioId),
      getInvestmentPolicy(this.db, portfolioId),
      this.getActiveStrategy(),
      this.getPositions(portfolioId)
    ]);
    if (!portfolio) {
      throw new Error("Portfolio not found.");
    }
    if (portfolio.mode !== "paper") {
      throw new Error("Strategy analysis is restricted to paper portfolios.");
    }
    if (!policy) {
      throw new Error("No active investment policy is configured for this portfolio.");
    }
    if (!strategy.supportedRiskProfiles.includes(policy.riskProfile)) {
      throw new Error(`Strategy ${strategy.strategyName} does not support ${policy.riskProfile} risk profile.`);
    }

    await this.recordEvent(null, portfolioId, "strategy_analysis_started", "Strategy analysis started.", { strategyVersionId: strategy.id }, now);
    const universe = await this.getUniverse(strategy.id);
    const symbols = [...new Set([...universe.map((item) => item.symbol), ...positions.map((item) => item.symbol)])];
    const snapshot = options.snapshotId
      ? await this.requireSnapshot(options.snapshotId)
      : await this.marketData.createSnapshot(symbols, "proposal", now);
    const existing = await this.getRunBySnapshot(portfolioId, strategy.id, snapshot.id);
    if (existing) {
      return { ...existing, idempotent: true };
    }

    const valuation = await getPortfolioValuation(this.db, portfolioId, now);
    const portfolioAnalysis = analyzePortfolio({ policy, strategy, portfolio, positions, universe, totalValueUsd: valuation.totalAccountValueUsd });
    const scored = await scoreUniverse({ strategy, policy, universe, positions, snapshot, portfolioAnalysis, totalValueUsd: valuation.totalAccountValueUsd });
    const excludedCandidates = scored
      .filter((score) => !score.eligibility.allowed)
      .map((score) => ({ symbol: score.symbol, reason: score.eligibility.reasons.join(" ") || "Not eligible." }));
    const decisions = generateDecisions({
      strategy,
      portfolio,
      policy,
      positions,
      scores: scored,
      portfolioAnalysis,
      totalValueUsd: valuation.totalAccountValueUsd
    });
    const currentDecision = overallDecision(decisions);
    const confidenceScore = roundRatio(average(decisions.map((decision) => decision.confidenceScore), average(scored.map((score) => score.confidenceScore), 0)));
    const portfolioScore = roundRatio(average(scored.filter((score) => score.eligibility.allowed).map((score) => score.investmentScore / 100), 0));
    const riskScore = calculatePortfolioRisk(portfolioAnalysis, policy);
    const generatedAt = now.toISOString();
    const run: StrategyRun = {
      id: `strategy_run_${portfolioId}_${hash(`${strategy.id}:${snapshot.id}`)}`,
      portfolioId,
      strategy,
      marketDataSnapshotId: snapshot.id,
      dailyReviewId: options.dailyReviewId ?? null,
      currentPortfolioState: {
        cashUsd: portfolio.cashUsd,
        totalAccountValueUsd: valuation.totalAccountValueUsd,
        positions: positions.map((position) => ({
          symbol: position.symbol,
          assetClass: position.assetClass,
          quantity: position.quantity,
          marketValueUsd: position.marketValueUsd,
          allocationPct: roundRatio(position.marketValueUsd / Math.max(valuation.totalAccountValueUsd, 1))
        }))
      },
      candidateUniverse: universe,
      excludedCandidates,
      securityScores: scored,
      portfolioAnalysis,
      finalDecisions: decisions,
      currentDecision,
      confidenceScore,
      portfolioScore,
      riskScore,
      generatedAt,
      engineVersion: STRATEGY_ENGINE_VERSION,
      idempotent: false
    };

    await this.persistRun(run);
    await this.recordEvent(run.id, portfolioId, "candidate_universe_evaluated", "Strategy candidate universe evaluated.", { candidates: universe.length }, now);
    for (const excluded of excludedCandidates) {
      await this.recordEvent(run.id, portfolioId, "security_excluded", "Strategy excluded a candidate security.", excluded, now);
    }
    await this.recordEvent(run.id, portfolioId, "portfolio_scored", "Strategy portfolio score calculated.", { portfolioScore, riskScore }, now);
    for (const decision of decisions) {
      await this.recordEvent(run.id, portfolioId, decision.action === "No Action" || decision.action === "Hold" ? "no_action_recommended" : "recommendation_generated", "Strategy recommendation generated.", { symbol: decision.symbol, action: decision.action }, now);
    }
    await this.recordEvent(run.id, portfolioId, "strategy_analysis_completed", "Strategy analysis completed.", { currentDecision }, now);
    await this.linkDailyReview(options.dailyReviewId ?? null, run.id);
    await recordJourneyEvent(this.db, {
      portfolioId,
      eventType: "strategy_version_changed",
      timestamp: generatedAt,
      title: "Strategy analysis completed",
      description: `${strategy.strategyName} ${strategy.strategyVersion}: ${currentDecision}.`,
      source: "manual",
      severity: currentDecision === "Data Incomplete" ? "warning" : "info",
      strategyVersion: `${strategy.strategyName} ${strategy.strategyVersion}`,
      metadata: { strategyRunId: run.id, marketDataSnapshotId: snapshot.id, paperOnly: true }
    });
    return run;
  }

  async latest(portfolioId = TIM_PORTFOLIO_ID): Promise<StrategyRun | null> {
    const row = await this.db.prepare(
      `SELECT id, portfolio_id AS portfolioId, strategy_version_id AS strategyVersionId,
        market_data_snapshot_id AS marketDataSnapshotId, daily_review_id AS dailyReviewId,
        current_portfolio_state_json AS currentPortfolioStateJson,
        candidate_universe_json AS candidateUniverseJson,
        excluded_candidates_json AS excludedCandidatesJson,
        security_scores_json AS securityScoresJson,
        portfolio_analysis_json AS portfolioAnalysisJson,
        final_decisions_json AS finalDecisionsJson,
        current_decision AS currentDecision, confidence_score AS confidenceScore,
        portfolio_score AS portfolioScore, risk_score AS riskScore,
        generated_at AS generatedAt, engine_version AS engineVersion
       FROM strategy_decision_runs
       WHERE portfolio_id = ?
       ORDER BY created_at DESC
       LIMIT 1`
    ).bind(portfolioId).first<StrategyRunRow>();
    return row ? this.hydrateRun(row, false) : null;
  }

  async list(portfolioId = TIM_PORTFOLIO_ID, limit = 10): Promise<StrategyRun[]> {
    const rows = await listRows<StrategyRunRow>(
      this.db.prepare(
        `SELECT id, portfolio_id AS portfolioId, strategy_version_id AS strategyVersionId,
          market_data_snapshot_id AS marketDataSnapshotId, daily_review_id AS dailyReviewId,
          current_portfolio_state_json AS currentPortfolioStateJson,
          candidate_universe_json AS candidateUniverseJson,
          excluded_candidates_json AS excludedCandidatesJson,
          security_scores_json AS securityScoresJson,
          portfolio_analysis_json AS portfolioAnalysisJson,
          final_decisions_json AS finalDecisionsJson,
          current_decision AS currentDecision, confidence_score AS confidenceScore,
          portfolio_score AS portfolioScore, risk_score AS riskScore,
          generated_at AS generatedAt, engine_version AS engineVersion
         FROM strategy_decision_runs
         WHERE portfolio_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      ).bind(portfolioId, limit)
    );
    return Promise.all(rows.map((row) => this.hydrateRun(row, false)));
  }

  private async getPortfolio(portfolioId: string): Promise<PortfolioRow | null> {
    return this.db.prepare("SELECT id, mode, cash_usd AS cashUsd, starting_balance_usd AS startingBalanceUsd FROM portfolios WHERE id = ?").bind(portfolioId).first<PortfolioRow>();
  }

  private async getPositions(portfolioId: string): Promise<PositionRow[]> {
    return listRows<PositionRow>(
      this.db.prepare(
        `SELECT symbol, asset_class AS assetClass, quantity, avg_entry_price_usd AS avgEntryPriceUsd,
          current_price_usd AS currentPriceUsd, market_value_usd AS marketValueUsd
         FROM positions
         WHERE portfolio_id = ? AND quantity > 0
         ORDER BY market_value_usd DESC, symbol ASC`
      ).bind(portfolioId)
    );
  }

  private async getActiveStrategy(): Promise<StrategyVersion> {
    const row = await this.db.prepare(
      `SELECT id, strategy_name AS strategyName, strategy_version AS strategyVersion,
        objective, status, supported_risk_profiles_json AS supportedRiskProfilesJson,
        rules_json AS rulesJson, weights_json AS weightsJson, thresholds_json AS thresholdsJson,
        allocation_ranges_json AS allocationRangesJson, change_notes AS changeNotes,
        created_at AS createdAt
       FROM strategy_versions
       WHERE strategy_name = 'Conservative Retirement' AND status = 'active'
       ORDER BY created_at DESC
       LIMIT 1`
    ).first<StrategyVersionRow>();
    if (!row) {
      throw new Error("No active Conservative Retirement strategy version is configured.");
    }
    return mapStrategy(row);
  }

  private async getStrategyById(id: string): Promise<StrategyVersion> {
    const row = await this.db.prepare(
      `SELECT id, strategy_name AS strategyName, strategy_version AS strategyVersion,
        objective, status, supported_risk_profiles_json AS supportedRiskProfilesJson,
        rules_json AS rulesJson, weights_json AS weightsJson, thresholds_json AS thresholdsJson,
        allocation_ranges_json AS allocationRangesJson, change_notes AS changeNotes,
        created_at AS createdAt
       FROM strategy_versions
       WHERE id = ?`
    ).bind(id).first<StrategyVersionRow>();
    if (!row) {
      throw new Error("Strategy version not found.");
    }
    return mapStrategy(row);
  }

  private async getUniverse(strategyVersionId: string): Promise<UniverseSecurity[]> {
    return listRows<UniverseRow>(
      this.db.prepare(
        `SELECT symbol, security_name AS securityName, asset_type AS assetType,
          asset_category AS assetCategory, sector, expense_ratio AS expenseRatio,
          average_volume AS averageVolume, bid_ask_spread AS bidAskSpread,
          dividend_yield AS dividendYield, duration, credit_quality AS creditQuality,
          volatility, maximum_drawdown AS maximumDrawdown, historical_return AS historicalReturn,
          data_quality_status AS dataQualityStatus, eligibility_status AS eligibilityStatus,
          exclusion_reason AS exclusionReason
         FROM strategy_universe_securities
         WHERE strategy_version_id = ? AND enabled = 1
         ORDER BY symbol ASC`
      ).bind(strategyVersionId)
    );
  }

  private async requireSnapshot(snapshotId: string): Promise<MarketDataSnapshot> {
    const snapshot = await this.marketData.getSnapshot(snapshotId);
    if (!snapshot) {
      throw new Error("Market-data snapshot not found.");
    }
    return snapshot;
  }

  private async getRunBySnapshot(portfolioId: string, strategyVersionId: string, snapshotId: string): Promise<StrategyRun | null> {
    const row = await this.db.prepare(
      `SELECT id, portfolio_id AS portfolioId, strategy_version_id AS strategyVersionId,
        market_data_snapshot_id AS marketDataSnapshotId, daily_review_id AS dailyReviewId,
        current_portfolio_state_json AS currentPortfolioStateJson,
        candidate_universe_json AS candidateUniverseJson,
        excluded_candidates_json AS excludedCandidatesJson,
        security_scores_json AS securityScoresJson,
        portfolio_analysis_json AS portfolioAnalysisJson,
        final_decisions_json AS finalDecisionsJson,
        current_decision AS currentDecision, confidence_score AS confidenceScore,
        portfolio_score AS portfolioScore, risk_score AS riskScore,
        generated_at AS generatedAt, engine_version AS engineVersion
       FROM strategy_decision_runs
       WHERE portfolio_id = ? AND strategy_version_id = ? AND market_data_snapshot_id = ?
       LIMIT 1`
    ).bind(portfolioId, strategyVersionId, snapshotId).first<StrategyRunRow>();
    return row ? this.hydrateRun(row, true) : null;
  }

  private async hydrateRun(row: StrategyRunRow, idempotent: boolean): Promise<StrategyRun> {
    return {
      id: row.id,
      portfolioId: row.portfolioId,
      strategy: await this.getStrategyById(row.strategyVersionId),
      marketDataSnapshotId: row.marketDataSnapshotId,
      dailyReviewId: row.dailyReviewId,
      currentPortfolioState: parseJson(row.currentPortfolioStateJson, {}),
      candidateUniverse: parseJson(row.candidateUniverseJson, []),
      excludedCandidates: parseJson(row.excludedCandidatesJson, []),
      securityScores: parseJson(row.securityScoresJson, []),
      portfolioAnalysis: parseJson(row.portfolioAnalysisJson, emptyAnalysis()),
      finalDecisions: parseJson(row.finalDecisionsJson, []),
      currentDecision: row.currentDecision,
      confidenceScore: row.confidenceScore,
      portfolioScore: row.portfolioScore,
      riskScore: row.riskScore,
      generatedAt: row.generatedAt,
      engineVersion: row.engineVersion,
      idempotent
    };
  }

  private async persistRun(run: StrategyRun): Promise<void> {
    await this.db.prepare(
      `INSERT INTO strategy_decision_runs (
        id, portfolio_id, strategy_version_id, market_data_snapshot_id, daily_review_id,
        current_portfolio_state_json, candidate_universe_json, excluded_candidates_json,
        security_scores_json, portfolio_analysis_json, final_decisions_json,
        current_decision, confidence_score, portfolio_score, risk_score, generated_at, engine_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      run.id,
      run.portfolioId,
      run.strategy.id,
      run.marketDataSnapshotId,
      run.dailyReviewId,
      JSON.stringify(run.currentPortfolioState),
      JSON.stringify(run.candidateUniverse),
      JSON.stringify(run.excludedCandidates),
      JSON.stringify(run.securityScores),
      JSON.stringify(run.portfolioAnalysis),
      JSON.stringify(run.finalDecisions),
      run.currentDecision,
      run.confidenceScore,
      run.portfolioScore,
      run.riskScore,
      run.generatedAt,
      run.engineVersion
    ).run();
  }

  private async linkDailyReview(reviewId: string | null, runId: string): Promise<void> {
    if (!reviewId) {
      return;
    }
    await this.db.prepare("UPDATE daily_portfolio_reviews SET strategy_run_id = ?, updated_at = datetime('now') WHERE id = ?").bind(runId, reviewId).run();
  }

  private async recordEvent(runId: string | null, portfolioId: string, eventType: string, message: string, details: Record<string, unknown>, now: Date): Promise<void> {
    await this.db.prepare(
      `INSERT OR IGNORE INTO strategy_run_events (
        id, run_id, portfolio_id, event_type, message, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(`strategy_event_${hash(`${runId ?? portfolioId}:${eventType}:${now.toISOString()}:${message}`)}`, runId, portfolioId, eventType, message, JSON.stringify(details), now.toISOString()).run();
  }
}

export function analyzePortfolio(input: {
  policy: InvestmentPolicy;
  strategy: StrategyVersion;
  portfolio: PortfolioRow;
  positions: PositionRow[];
  universe: UniverseSecurity[];
  totalValueUsd: number;
}): PortfolioAnalysis {
  const total = Math.max(input.totalValueUsd, 1);
  const cashPct = roundRatio(input.portfolio.cashUsd / total);
  const categoryBySymbol = new Map(input.universe.map((item) => [item.symbol, item.assetCategory]));
  const sectorBySymbol = new Map(input.universe.map((item) => [item.symbol, item.sector]));
  const categoryAllocation: Record<string, number> = { "Cash reserve": cashPct };
  const sectorAllocation: Record<string, number> = {};
  for (const position of input.positions) {
    const valuePct = position.marketValueUsd / total;
    const category = categoryBySymbol.get(position.symbol) ?? categoryForAsset(position.assetClass, position.symbol);
    const sector = sectorBySymbol.get(position.symbol) ?? category;
    categoryAllocation[category] = roundRatio((categoryAllocation[category] ?? 0) + valuePct);
    sectorAllocation[sector] = roundRatio((sectorAllocation[sector] ?? 0) + valuePct);
  }
  const maxSinglePositionPct = Math.min(input.policy.maxSinglePositionPct, 0.2);
  const maxSectorAllocationPct = Math.min(input.policy.maxSectorAllocationPct, 0.3);
  const cashReserveRequiredPct = Math.max(input.policy.minCashAllocationPct, input.strategy.allocationRanges["Cash reserve"]?.min ?? 0.1);
  const drift: Record<string, number> = {};
  for (const [category, range] of Object.entries(input.strategy.allocationRanges)) {
    const current = category === "Cash reserve" ? cashPct : categoryAllocation[category] ?? 0;
    drift[category] = roundRatio(current < range.min ? range.min - current : current > range.max ? current - range.max : 0);
  }
  const largestPositionPct = roundRatio(Math.max(0, ...input.positions.map((position) => position.marketValueUsd / total)));
  const largestSectorPct = roundRatio(Math.max(0, ...Object.values(sectorAllocation)));
  const policyWarnings: string[] = [];
  if (cashPct < cashReserveRequiredPct) policyWarnings.push("Cash reserve is below the stricter strategy/account minimum.");
  if (largestPositionPct > maxSinglePositionPct) policyWarnings.push("A position exceeds the stricter strategy/account single-position limit.");
  if (largestSectorPct > maxSectorAllocationPct) policyWarnings.push("A sector exceeds the stricter strategy/account sector limit.");
  return {
    cashPct,
    categoryAllocation,
    sectorAllocation,
    largestPositionPct,
    largestSectorPct,
    cashReserveRequiredPct,
    maxSinglePositionPct,
    maxSectorAllocationPct,
    drift,
    policyWarnings
  };
}

export async function scoreUniverse(input: {
  strategy: StrategyVersion;
  policy: InvestmentPolicy;
  universe: UniverseSecurity[];
  positions: PositionRow[];
  snapshot: MarketDataSnapshot;
  portfolioAnalysis: PortfolioAnalysis;
  totalValueUsd: number;
}): Promise<SecurityScore[]> {
  const positionBySymbol = new Map(input.positions.map((position) => [position.symbol, position]));
  return input.universe.map((security) => {
    const quote = input.snapshot.quotes.get(security.symbol) ?? null;
    const eligibility = evaluateEligibility(security, input.policy, quote);
    const factors = buildFactors(security, quote, input.strategy, input.portfolioAnalysis, positionBySymbol.has(security.symbol), eligibility);
    const totalWeight = factors.filter((factor) => factor.available).reduce((sum, factor) => sum + factor.weight, 0);
    const rawScore = totalWeight > 0 ? factors.reduce((sum, factor) => sum + factor.contribution, 0) / totalWeight : 0;
    const missingCount = factors.filter((factor) => !factor.available).length;
    const dataPenalty = quote?.dataQualityStatus === "Conflicting" || quote?.dataQualityStatus === "Stale" || quote?.dataQualityStatus === "Missing" ? 0.35 : 0;
    const confidenceScore = roundRatio(Math.max(0, Math.min(1, factors.filter((factor) => factor.available).length / factors.length - missingCount * 0.025 - dataPenalty)));
    return {
      symbol: security.symbol,
      securityName: security.securityName,
      assetType: security.assetType,
      assetCategory: security.assetCategory,
      sector: security.sector,
      eligibility,
      quoteStatus: quote?.dataQualityStatus ?? "Missing",
      investmentScore: roundRatio(Math.max(0, Math.min(100, rawScore))),
      confidenceScore,
      factors,
      supportingFactors: factors.filter((factor) => (factor.normalizedScore ?? 0) >= 70).map((factor) => factor.factor),
      opposingFactors: factors.filter((factor) => factor.available && (factor.normalizedScore ?? 0) < 45).map((factor) => factor.factor),
      missingFactors: factors.filter((factor) => !factor.available).map((factor) => factor.factor),
      dataTimestamp: quote?.providerTimestamp ?? quote?.receivedTimestamp ?? null
    };
  }).sort((left, right) => right.investmentScore - left.investmentScore || right.confidenceScore - left.confidenceScore || left.symbol.localeCompare(right.symbol));
}

export function generateDecisions(input: {
  strategy: StrategyVersion;
  portfolio: PortfolioRow;
  policy: InvestmentPolicy;
  positions: PositionRow[];
  scores: SecurityScore[];
  portfolioAnalysis: PortfolioAnalysis;
  totalValueUsd: number;
}): StrategyDecision[] {
  const total = Math.max(input.totalValueUsd, 1);
  const positionBySymbol = new Map(input.positions.map((position) => [position.symbol, position]));
  const decisions: StrategyDecision[] = [];
  for (const position of input.positions) {
    const score = input.scores.find((item) => item.symbol === position.symbol);
    const currentAllocation = roundRatio(position.marketValueUsd / total);
    const range = score ? input.strategy.allocationRanges[score.assetCategory] ?? null : null;
    const exceedsPositionLimit = currentAllocation > input.portfolioAnalysis.maxSinglePositionPct;
    const ineligible = score && !score.eligibility.allowed;
    const categoryExcess = range ? currentAllocation > range.max + input.strategy.thresholds.trimThresholdPct : false;
    const action: StrategyDecisionAction = ineligible ? "Sell" : exceedsPositionLimit || categoryExcess ? "Trim" : "Hold";
    const estimatedDollarChange = action === "Trim"
      ? -roundMoney((currentAllocation - Math.min(range?.max ?? input.portfolioAnalysis.maxSinglePositionPct, input.portfolioAnalysis.maxSinglePositionPct)) * total)
      : action === "Sell" ? -roundMoney(position.marketValueUsd) : 0;
    decisions.push(decisionFromScore({
      symbol: position.symbol,
      action,
      currentAllocation,
      range,
      proposedAllocation: action === "Hold" ? currentAllocation : Math.max(0, currentAllocation + estimatedDollarChange / total),
      estimatedDollarChange,
      score,
      strategy: input.strategy,
      triggeredRules: ineligible ? ["security_ineligible"] : exceedsPositionLimit ? ["position_limit"] : categoryExcess ? ["allocation_above_range"] : ["within_strategy_range"],
      explanation: explanationFor(action, position.symbol, ineligible ? "Security is no longer eligible or violates policy." : exceedsPositionLimit ? "Position exceeds the stricter concentration limit." : categoryExcess ? "Allocation exceeds the configured strategy range." : "Holding remains inside policy and strategy ranges.")
    }));
  }

  const availableCash = Math.max(0, input.portfolio.cashUsd - input.totalValueUsd * input.portfolioAnalysis.cashReserveRequiredPct);
  const underweightCategories = Object.entries(input.strategy.allocationRanges)
    .filter(([category, range]) => category !== "Cash reserve" && (input.portfolioAnalysis.categoryAllocation[category] ?? 0) < range.min - input.strategy.thresholds.rebalanceDriftThresholdPct)
    .map(([category]) => category);
  if (availableCash >= input.strategy.thresholds.minimumTradeValueUsd) {
    for (const category of underweightCategories) {
      const candidate = input.scores.find((score) =>
        score.assetCategory === category &&
        !positionBySymbol.has(score.symbol) &&
        score.eligibility.allowed &&
        score.investmentScore >= input.strategy.thresholds.minimumBuyScore &&
        score.confidenceScore >= input.strategy.thresholds.minimumConfidence
      );
      if (!candidate) {
        continue;
      }
      const range = input.strategy.allocationRanges[category] ?? null;
      const currentAllocation = input.portfolioAnalysis.categoryAllocation[category] ?? 0;
      const targetGap = Math.max(0, (range?.target ?? range?.min ?? currentAllocation) - currentAllocation);
      const amount = roundMoney(Math.min(availableCash, input.totalValueUsd * targetGap, input.totalValueUsd * input.strategy.thresholds.maximumTurnoverPct));
      if (amount < input.strategy.thresholds.minimumTradeValueUsd) {
        continue;
      }
      decisions.push(decisionFromScore({
        symbol: candidate.symbol,
        action: "Buy",
        currentAllocation: 0,
        range,
        proposedAllocation: roundRatio(amount / total),
        estimatedDollarChange: amount,
        score: candidate,
        strategy: input.strategy,
        triggeredRules: ["category_underweight", "minimum_score_met", "cash_reserve_preserved"],
        explanation: explanationFor("Buy", candidate.symbol, `${category} is below the configured strategy range and the candidate clears score, confidence, and policy checks.`)
      }));
    }
  }

  if (decisions.length === 0) {
    decisions.push({
      symbol: "PORTFOLIO",
      action: input.portfolioAnalysis.policyWarnings.length ? "Monitor" : "No Action",
      currentAllocation: 1,
      targetAllocationRange: null,
      proposedAllocation: 1,
      estimatedDollarChange: 0,
      investmentScore: roundRatio(average(input.scores.map((score) => score.investmentScore), 0)),
      confidenceScore: roundRatio(average(input.scores.map((score) => score.confidenceScore), 0)),
      triggeredRules: input.portfolioAnalysis.policyWarnings.length ? ["policy_warning"] : ["within_policy"],
      supportingFactors: [],
      opposingFactors: input.portfolioAnalysis.policyWarnings,
      policyResult: { allowed: input.portfolioAnalysis.policyWarnings.length === 0, reasons: input.portfolioAnalysis.policyWarnings },
      dataTimestamp: null,
      strategyVersion: input.strategy.strategyVersion,
      explanation: input.portfolioAnalysis.policyWarnings.length
        ? "Monitor: policy warnings exist, but no compliant strategy action cleared the configured thresholds."
        : "No Action: portfolio remains inside the strategy and account-policy limits."
    });
  }
  return decisions.sort((left, right) => actionPriority(right.action) - actionPriority(left.action) || Math.abs(right.estimatedDollarChange) - Math.abs(left.estimatedDollarChange));
}

function evaluateEligibility(security: UniverseSecurity, policy: InvestmentPolicy, quote: NormalizedQuote | null): PolicyResult {
  const reasons: string[] = [];
  const normalizedType = String(quote?.assetType ?? security.assetType).toLowerCase();
  if (security.eligibilityStatus === "ineligible" && security.exclusionReason) {
    reasons.push(security.exclusionReason);
  }
  if (["crypto", "leveraged_etf", "inverse_etf", "option", "unknown"].includes(normalizedType)) {
    reasons.push(`${normalizedType.replace(/_/g, " ")} is not eligible for this strategy.`);
  }
  if (!quote || !quote.validation.valid || !quote.lastPrice) {
    reasons.push("Valid current market data is required.");
  }
  if (quote?.dataQualityStatus === "Conflicting") {
    reasons.push("Provider prices are conflicting.");
  }
  const assetClass = normalizeAssetClass(security.assetType);
  const policyResult = validateInvestmentPolicy({
    policy,
    action: "BUY",
    symbol: security.symbol,
    assetClass,
    portfolioValueUsd: 1_000_000,
    cashUsd: 1_000_000,
    currentPositionValueUsd: 0,
    proposedTradeValueUsd: 0,
    securityTags: [normalizedType, security.assetCategory]
  });
  reasons.push(...policyResult.reasons);
  return { allowed: reasons.length === 0, reasons: [...new Set(reasons)] };
}

function buildFactors(
  security: UniverseSecurity,
  quote: NormalizedQuote | null,
  strategy: StrategyVersion,
  analysis: PortfolioAnalysis,
  alreadyHeld: boolean,
  eligibility: PolicyResult
): StrategyFactorScore[] {
  const weights = strategy.weights;
  const allocation = analysis.categoryAllocation[security.assetCategory] ?? 0;
  const range = strategy.allocationRanges[security.assetCategory];
  return [
    factor("policyEligibility", eligibility.allowed ? "eligible" : eligibility.reasons, eligibility.allowed ? 100 : 0, weights.policyEligibility, true, "100 when eligible, 0 when prohibited."),
    factor("dataQuality", quote?.dataQualityStatus ?? "Missing", dataQualityScore(quote), weights.dataQuality, Boolean(quote), "Valid/Previous Close/Delayed score highest; stale/conflicting score low."),
    factor("allocationNeed", { current: allocation, range }, range ? scoreAllocationNeed(allocation, range, alreadyHeld) : null, weights.allocationNeed, Boolean(range), "Higher when the asset category is under target range."),
    factor("diversificationBenefit", { currentCategoryPct: allocation, alreadyHeld }, alreadyHeld ? 55 : Math.max(50, 100 - allocation * 180), weights.diversificationBenefit, true, "Higher for diversifying categories not already held."),
    factor("volatility", security.volatility, security.volatility === null ? null : clampScore(100 - security.volatility * 180), weights.volatility, security.volatility !== null, "Lower volatility receives a higher score."),
    factor("maximumDrawdown", security.maximumDrawdown, security.maximumDrawdown === null ? null : clampScore(100 - security.maximumDrawdown * 120), weights.maximumDrawdown, security.maximumDrawdown !== null, "Lower historical drawdown receives a higher score."),
    factor("yield", security.dividendYield, security.dividendYield === null ? null : clampScore(45 + security.dividendYield * 900), weights.yield, security.dividendYield !== null, "Sustainable income receives credit without dominating the decision."),
    factor("expenseRatio", security.expenseRatio, security.expenseRatio === null ? null : clampScore(100 - security.expenseRatio * 10000), weights.expenseRatio, security.expenseRatio !== null, "Lower fund expense ratio receives a higher score."),
    factor("liquidity", security.averageVolume, security.averageVolume === null ? null : clampScore(Math.log10(Math.max(1, security.averageVolume)) * 15), weights.liquidity, security.averageVolume !== null, "Higher average volume receives a higher score."),
    factor("spread", security.bidAskSpread, security.bidAskSpread === null ? null : clampScore(100 - security.bidAskSpread * 10000), weights.spread, security.bidAskSpread !== null, "Lower bid-ask spread receives a higher score.")
  ];
}

function decisionFromScore(input: {
  symbol: string;
  action: StrategyDecisionAction;
  currentAllocation: number;
  range: AllocationRange | null;
  proposedAllocation: number;
  estimatedDollarChange: number;
  score?: SecurityScore;
  strategy: StrategyVersion;
  triggeredRules: string[];
  explanation: string;
}): StrategyDecision {
  return {
    symbol: input.symbol,
    action: input.action,
    currentAllocation: input.currentAllocation,
    targetAllocationRange: input.range,
    proposedAllocation: roundRatio(input.proposedAllocation),
    estimatedDollarChange: roundMoney(input.estimatedDollarChange),
    investmentScore: input.score?.investmentScore ?? 0,
    confidenceScore: input.score?.confidenceScore ?? 0,
    triggeredRules: input.triggeredRules,
    supportingFactors: input.score?.supportingFactors ?? [],
    opposingFactors: input.score?.opposingFactors ?? [],
    policyResult: input.score?.eligibility ?? { allowed: true, reasons: [] },
    dataTimestamp: input.score?.dataTimestamp ?? null,
    strategyVersion: input.strategy.strategyVersion,
    explanation: input.explanation
  };
}

function explanationFor(action: StrategyDecisionAction, symbol: string, reason: string): string {
  return `${action} ${symbol}: ${reason} This is analysis only; no proposal, order, or execution is created.`;
}

function overallDecision(decisions: StrategyDecision[]): StrategyDecisionAction {
  if (decisions.some((decision) => decision.action === "Data Incomplete")) return "Data Incomplete";
  if (decisions.some((decision) => decision.action === "Sell" || decision.action === "Trim")) return "Rebalance";
  if (decisions.some((decision) => decision.action === "Buy" || decision.action === "Add")) return "Rebalance";
  if (decisions.some((decision) => decision.action === "Monitor")) return "Monitor";
  if (decisions.every((decision) => decision.action === "Hold")) return "Hold";
  return "No Action";
}

function calculatePortfolioRisk(analysis: PortfolioAnalysis, policy: InvestmentPolicy): number {
  const cashPenalty = analysis.cashPct < analysis.cashReserveRequiredPct ? 0.25 : 0;
  const concentration = Math.max(analysis.largestPositionPct / Math.max(policy.maxSinglePositionPct, 0.01), analysis.largestSectorPct / Math.max(policy.maxSectorAllocationPct, 0.01));
  return roundRatio(Math.min(1, cashPenalty + concentration * 0.55));
}

function dataQualityScore(quote: NormalizedQuote | null): number | null {
  if (!quote) return null;
  if (quote.dataQualityStatus === "Valid") return 100;
  if (quote.dataQualityStatus === "Previous Close" || quote.dataQualityStatus === "Delayed") return 82;
  if (quote.dataQualityStatus === "Stale") return 20;
  return 0;
}

function scoreAllocationNeed(current: number, range: AllocationRange, alreadyHeld: boolean): number {
  if (current < range.min) return alreadyHeld ? 82 : 92;
  if (current <= range.target) return 72;
  if (current <= range.max) return 48;
  return 15;
}

function factor(factorName: string, rawInput: unknown, normalizedScore: number | null, weight: number | undefined, available: boolean, scale: string): StrategyFactorScore {
  const normalized = normalizedScore === null ? null : clampScore(normalizedScore);
  const factorWeight = weight ?? 0;
  return {
    factor: factorName,
    rawInput,
    normalizedScore: normalized,
    weight: factorWeight,
    contribution: normalized === null || !available ? 0 : normalized * factorWeight,
    available,
    scale
  };
}

function mapStrategy(row: StrategyVersionRow): StrategyVersion {
  return {
    id: row.id,
    strategyName: row.strategyName,
    strategyVersion: row.strategyVersion,
    objective: row.objective,
    status: row.status,
    supportedRiskProfiles: parseJson(row.supportedRiskProfilesJson, []),
    rules: parseJson(row.rulesJson, {}),
    weights: parseJson(row.weightsJson, {}),
    thresholds: { ...DEFAULT_THRESHOLDS, ...parseJson(row.thresholdsJson, {}) },
    allocationRanges: parseJson(row.allocationRangesJson, {}),
    changeNotes: row.changeNotes,
    createdAt: row.createdAt
  };
}

function categoryForAsset(assetClass: AssetClass, symbol: string): string {
  if (assetClass === "bond_fund" || /BND|BOND|TREAS|SHY|IEF|TLT/i.test(symbol)) return "Investment-grade bonds";
  if (/SCHD|DIV|LOWV|USMV/i.test(symbol)) return "Dividend or defensive equity";
  if (assetClass === "money_market") return "Short-term Treasuries or cash equivalents";
  return assetClass === "stock" || assetClass === "etf" ? "Broad U.S. equity" : assetClass;
}

function normalizeAssetClass(value: string): AssetClass {
  if (value === "bond_fund" || value === "money_market" || value === "crypto" || value === "mutual_fund" || value === "reit" || value === "stock" || value === "etf") {
    return value;
  }
  return "stock";
}

function actionPriority(action: StrategyDecisionAction): number {
  return { Sell: 9, Trim: 8, Rebalance: 7, Buy: 6, Add: 5, Monitor: 4, Hold: 3, "No Action": 2, "Data Incomplete": 1 }[action] ?? 0;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, roundRatio(value)));
}

function average(values: number[], fallback: number): number {
  const clean = values.filter((value) => Number.isFinite(value));
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : fallback;
}

function emptyAnalysis(): PortfolioAnalysis {
  return {
    cashPct: 0,
    categoryAllocation: {},
    sectorAllocation: {},
    largestPositionPct: 0,
    largestSectorPct: 0,
    cashReserveRequiredPct: 0.1,
    maxSinglePositionPct: 0.2,
    maxSectorAllocationPct: 0.3,
    drift: {},
    policyWarnings: []
  };
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function hash(key: string): string {
  let value = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    value ^= key.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(16);
}
