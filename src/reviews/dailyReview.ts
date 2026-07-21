import { MarketDataService, quoteToMarketDataset } from "../market/service.ts";
import { PerformanceAnalyticsService, type PerformanceAnalyticsSummary } from "../analytics/performance.ts";
import { completeDailySnapshot, ensureDailyStartSnapshot } from "../portfolio/dailySnapshots.ts";
import { recordEquityHistory } from "../portfolio/performance.ts";
import { accountDate, getPortfolioValuation, recordValuationSnapshot, type PortfolioValuation } from "../portfolio/valuation.ts";
import { getInvestmentPolicy, type InvestmentPolicy } from "../policies/investmentPolicy.ts";
import { listPortfolioProfiles } from "../portfolio/profiles.ts";
import { recordJourneyEvent } from "../journey/service.ts";
import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";
import { addMoney, pctChange, roundMoney, roundRatio, subtractMoney } from "../shared/money.ts";
import type { AssetClass, Env, MarketDataset } from "../shared/types.ts";
import { assertPortfolioAllowsTradingActions } from "../portfolio/accountTypes.ts";

export type DailyDecisionStatus =
  | "Hold"
  | "Monitor"
  | "Rebalance Suggested"
  | "Risk Reduction Suggested"
  | "Opportunity Identified"
  | "Data Incomplete";

export interface DailyReviewConfig {
  stalePriceMs: number;
  nearLimitRatio: number;
  allocationDriftThresholdPct: number;
  maxRiskScore: number;
  balancedBenchmarkWeights: Record<string, number>;
}

export interface DailyReviewBenchmark {
  name: string;
  valueUsd: number | null;
  returnUsd: number | null;
  returnPct: number | null;
  dataStatus: "complete" | "incomplete" | "unavailable";
  disclosure: string;
  symbols: string[];
}

export interface DailyPortfolioReview {
  id: string;
  portfolioId: string;
  marketDate: string;
  triggerSource: "manual" | "scheduled";
  status: "completed" | "skipped" | "failed";
  portfolioValueUsd: number;
  dailyChangeUsd: number;
  dailyChangePct: number;
  totalReturnUsd: number;
  totalReturnPct: number;
  cashUsd: number;
  allocation: AllocationSummary;
  benchmarks: DailyReviewBenchmark[];
  riskScore: number;
  diversificationScore: number;
  currentDrawdownPct: number;
  maximumDrawdownPct: number;
  largestPositiveContributor: Contributor | null;
  largestNegativeContributor: Contributor | null;
  policyCompliant: boolean;
  policyWarnings: string[];
  dataFreshnessStatus: "fresh" | "stale" | "unavailable";
  recommendation: DailyDecisionStatus;
  supportingReasons: string[];
  confidenceScore: number;
  triggeredRules: string[];
  relevantMetrics: Record<string, number | string | boolean | null>;
  marketDataTimestamp: string | null;
  marketDataSnapshotId: string | null;
  strategyRunId: string | null;
  generatedAt: string;
  ruleEngineVersion: string;
  summaryExplanation: string;
}

export interface DailyReviewRunResult {
  review: DailyPortfolioReview | null;
  skipped: boolean;
  reason: string | null;
  idempotent: boolean;
}

export interface AllocationSummary {
  cashPct: number;
  equityPct: number;
  bondPct: number;
  otherPct: number;
  largestPositionPct: number;
  largestSectorPct: number;
  sectors: Record<string, number>;
}

export interface Contributor {
  symbol: string;
  unrealizedProfitLossUsd: number;
  unrealizedProfitLossPct: number;
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
  name: string;
  mode: string;
  cashUsd: number;
  startingBalanceUsd: number;
}

interface MarketPriceRow {
  symbol: string;
  priceUsd: number;
  priceAsOf: string;
  createdAt: string;
}

const RULE_ENGINE_VERSION = "daily-review-rules-v1";
const TIMEZONE = "America/New_York";

export const DEFAULT_DAILY_REVIEW_CONFIG: DailyReviewConfig = {
  stalePriceMs: 36 * 60 * 60 * 1000,
  nearLimitRatio: 0.9,
  allocationDriftThresholdPct: 0.05,
  maxRiskScore: 0.65,
  balancedBenchmarkWeights: { SPY: 0.4, BND: 0.4, cash: 0.2 }
};

export class DailyPortfolioReviewService {
  private readonly db: D1Database;
  private readonly config: DailyReviewConfig;

  constructor(db: D1Database, config = DEFAULT_DAILY_REVIEW_CONFIG) {
    this.db = db;
    this.config = config;
  }

  async run(portfolioId = TIM_PORTFOLIO_ID, triggerSource: "manual" | "scheduled" = "manual", now = new Date()): Promise<DailyReviewRunResult> {
    const marketDate = accountDate(now, TIMEZONE);
    const existing = await getDailyReview(this.db, portfolioId, marketDate);
    if (existing) {
      await this.recordRun(portfolioId, marketDate, triggerSource, "skipped", "Daily review already exists for this market date.", existing.id, now);
      return { review: existing, skipped: true, reason: "Daily review already exists for this market date.", idempotent: true };
    }

    if (triggerSource === "scheduled") {
      const schedule = shouldRunScheduledDailyReview(now);
      if (!schedule.shouldRun) {
        await this.recordRun(portfolioId, schedule.marketDate, triggerSource, "skipped", schedule.reason, null, now);
        return { review: null, skipped: true, reason: schedule.reason, idempotent: false };
      }
    }

    await this.recordRun(portfolioId, marketDate, triggerSource, "started", null, null, now);
    await this.recordEvent(null, portfolioId, marketDate, "daily_review_started", "Daily paper portfolio review started.", { triggerSource }, now);

    try {
      const portfolio = await this.getPortfolio(portfolioId);
      if (!portfolio) {
        throw new Error("Portfolio not found.");
      }
      if (portfolio.mode !== "paper") {
        throw new Error("Daily reviews are currently restricted to paper portfolios.");
      }
      await assertPortfolioAllowsTradingActions(this.db, portfolioId, "run daily reviews");

      const positionsBefore = await this.getPositions(portfolioId);
      const reviewSymbols = [...new Set([...positionsBefore.map((position) => position.symbol), "SPY", "BND"])];
      const marketSnapshot = await new MarketDataService(this.db).createSnapshot(reviewSymbols, "daily_review", now);
      const refreshed = await this.refreshHeldPrices(positionsBefore, marketSnapshot);
      await this.updatePositionsFromPrices(portfolioId, refreshed, now);
      const valuation = await this.updateValuationArtifacts(portfolioId, now);
      await this.recordEvent(null, portfolioId, marketDate, "valuation_updated", "Daily valuation and snapshots updated.", { totalAccountValueUsd: valuation.totalAccountValueUsd }, now);

      const [policy, analytics, positionsAfter] = await Promise.all([
        getInvestmentPolicy(this.db, portfolioId),
        new PerformanceAnalyticsService(this.db).getSummary(portfolioId, now),
        this.getPositions(portfolioId)
      ]);
      const allocation = calculateAllocation(valuation, positionsAfter);
      const benchmarks = await this.calculateBenchmarks(portfolio, valuation, positionsAfter, marketSnapshot);
      await this.recordEvent(null, portfolioId, marketDate, "benchmark_comparison_completed", "Daily benchmark comparison completed.", { benchmarks: benchmarks.map((benchmark) => benchmark.name) }, now);

      const policyWarnings = evaluatePolicyWarnings(policy, allocation, analytics);
      if (policyWarnings.length > 0) {
        await this.recordEvent(null, portfolioId, marketDate, "policy_warning_detected", "Daily review detected policy warnings.", { policyWarnings }, now);
      }
      const dataFreshnessStatus = classifyReviewFreshness(valuation, now, this.config.stalePriceMs);
      const contributors = contributorsFromPositions(positionsAfter);
      const decision = decideDailyReview({
        allocation,
        policy,
        policyWarnings,
        dataFreshnessStatus,
        currentDrawdownPct: analytics.currentDrawdownPct,
        maximumDrawdownPct: analytics.maximumDrawdownPct,
        config: this.config
      });
      await this.recordEvent(null, portfolioId, marketDate, "recommendation_generated", "Daily paper recommendation generated.", { recommendation: decision.recommendation }, now);

      const review = buildReviewRecord({
        portfolioId,
        marketDate,
        triggerSource,
        valuation,
        analytics,
        allocation,
        benchmarks,
        policyWarnings,
        dataFreshnessStatus,
        decision,
        contributors,
        marketDataSnapshotId: marketSnapshot.id,
        now
      });

      await this.persistReview(review);
      await this.recordEvent(review.id, portfolioId, marketDate, "daily_review_completed", "Daily paper portfolio review completed.", { recommendation: review.recommendation }, now);
      await this.recordJourney(review, policyWarnings.length > 0 ? "warning" : "info");
      await this.recordRun(portfolioId, marketDate, triggerSource, "completed", null, review.id, now);
      return { review, skipped: false, reason: null, idempotent: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown daily review error.";
      await this.recordEvent(null, portfolioId, marketDate, "daily_review_failed", "Daily paper portfolio review failed.", { error: message }, now);
      await this.recordRun(portfolioId, marketDate, triggerSource, "failed", null, null, now, message);
      throw error;
    }
  }

  async list(portfolioId = TIM_PORTFOLIO_ID, limit = 30): Promise<DailyPortfolioReview[]> {
    const rows = await listRows<DailyReviewRow>(
      this.db.prepare(
        `SELECT * FROM daily_portfolio_reviews
         WHERE portfolio_id = ?
         ORDER BY market_date DESC
         LIMIT ?`
      ).bind(portfolioId, limit)
    );
    return rows.map(mapReviewRow);
  }

  private async getPortfolio(portfolioId: string): Promise<PortfolioRow | null> {
    return this.db.prepare("SELECT id, name, mode, cash_usd AS cashUsd, starting_balance_usd AS startingBalanceUsd FROM portfolios WHERE id = ?").bind(portfolioId).first<PortfolioRow>();
  }

  private async getPositions(portfolioId: string): Promise<PositionRow[]> {
    return listRows<PositionRow>(
      this.db.prepare(
        `SELECT symbol, asset_class AS assetClass, quantity,
          avg_entry_price_usd AS avgEntryPriceUsd, current_price_usd AS currentPriceUsd,
          market_value_usd AS marketValueUsd
         FROM positions
         WHERE portfolio_id = ? AND quantity > 0
         ORDER BY market_value_usd DESC`
      ).bind(portfolioId)
    );
  }

  private async refreshHeldPrices(positions: PositionRow[], snapshot: Awaited<ReturnType<MarketDataService["createSnapshot"]>>): Promise<Map<string, MarketDataset>> {
    const refreshed = new Map<string, MarketDataset>();
    for (const symbol of [...new Set(positions.map((position) => position.symbol))]) {
      try {
        const quote = snapshot.quotes.get(symbol);
        const data = quote ? quoteToMarketDataset(quote) : null;
        if (data && data.validated && data.priceUsd > 0) {
          await this.recordMarketSnapshot(data, new Date(snapshot.createdAt));
          refreshed.set(symbol, data);
        }
      } catch {
        // A failed symbol must not break the review; cached D1 data is used by valuation if trustworthy.
      }
    }
    return refreshed;
  }

  private async recordMarketSnapshot(data: MarketDataset, now: Date): Promise<void> {
    await this.db.prepare(
      `INSERT OR REPLACE INTO market_snapshots (
        id, symbol, asset_class, source, price_usd, price_as_of, volume,
        candles_json, validation_status, error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      `daily_review_${data.symbol}_${now.toISOString().slice(0, 16).replace(/[^0-9TZ]/g, "")}`,
      data.symbol,
      data.assetClass,
      data.source,
      data.priceUsd,
      data.asOf,
      data.volume ?? null,
      JSON.stringify(data.candles.slice(-90)),
      data.validated ? "validated" : "unavailable",
      data.validated ? null : data.userMessage ?? "Market data unavailable.",
      now.toISOString()
    ).run();
  }

  private async updatePositionsFromPrices(portfolioId: string, refreshed: Map<string, MarketDataset>, now: Date): Promise<void> {
    for (const [symbol, data] of refreshed) {
      await this.db.prepare(
        `UPDATE positions
         SET current_price_usd = ?, market_value_usd = ROUND(quantity * ?, 4), updated_at = ?
         WHERE portfolio_id = ? AND symbol = ? AND quantity > 0`
      ).bind(data.priceUsd, data.priceUsd, now.toISOString(), portfolioId, symbol).run();
    }
  }

  private async updateValuationArtifacts(portfolioId: string, now: Date): Promise<PortfolioValuation> {
    await ensureDailyStartSnapshot(this.db, portfolioId, now);
    const valuation = await getPortfolioValuation(this.db, portfolioId, now);
    await recordValuationSnapshot(this.db, valuation);
    await completeDailySnapshot(this.db, portfolioId, now);
    await recordEquityHistory(this.db, now.toISOString(), portfolioId);
    return valuation;
  }

  private async calculateBenchmarks(portfolio: PortfolioRow, valuation: PortfolioValuation, positions: PositionRow[], snapshot: Awaited<ReturnType<MarketDataService["createSnapshot"]>>): Promise<DailyReviewBenchmark[]> {
    const starting = portfolio.startingBalanceUsd;
    const spy = priceRowFromSnapshot(snapshot, "SPY");
    const bnd = priceRowFromSnapshot(snapshot, "BND");
    const cash = benchmark("Bank/cash baseline", starting, starting, "complete", "Cash baseline assumes no interest unless cash-yield data is available.", ["cash"]);
    const spyBenchmark = priceBenchmark("S&P 500 benchmark", starting, spy, "SPY");
    const balanced = balancedBenchmark(starting, this.config.balancedBenchmarkWeights, { SPY: spy, BND: bnd });
    const buyHold = buyAndHoldBenchmark(starting, positions, valuation, "Dividend data is not complete in the current market-data source; buy-and-hold is price return only.");
    return [cash, spyBenchmark, balanced, buyHold].map((item) => ({ ...item, valueUsd: item.valueUsd === null ? null : roundMoney(item.valueUsd), returnUsd: item.returnUsd === null ? null : roundMoney(item.returnUsd), returnPct: item.returnPct === null ? null : roundRatio(item.returnPct) }));
  }

  private async latestPrice(symbol: string): Promise<MarketPriceRow | null> {
    return this.db.prepare(
      `SELECT symbol, price_usd AS priceUsd, price_as_of AS priceAsOf, created_at AS createdAt
       FROM market_snapshots
       WHERE symbol = ? AND validation_status = 'validated' AND price_usd > 0
       ORDER BY created_at DESC
       LIMIT 1`
    ).bind(symbol).first<MarketPriceRow>();
  }

  private async persistReview(review: DailyPortfolioReview): Promise<void> {
    await this.db.prepare(
      `INSERT OR IGNORE INTO daily_portfolio_reviews (
        id, portfolio_id, market_date, trigger_source, status, portfolio_value_usd,
        daily_change_usd, daily_change_pct, total_return_usd, total_return_pct,
        cash_usd, allocation_json, benchmark_json, risk_score, diversification_score,
        current_drawdown_pct, maximum_drawdown_pct, largest_positive_contributor_json,
        largest_negative_contributor_json, policy_compliant, policy_warnings_json,
        data_freshness_status, recommendation, supporting_reasons_json, confidence_score,
        triggered_rules_json, relevant_metrics_json, market_data_timestamp, generated_at,
        rule_engine_version, summary_explanation, market_data_snapshot_id
      ) VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      review.id,
      review.portfolioId,
      review.marketDate,
      review.triggerSource,
      review.portfolioValueUsd,
      review.dailyChangeUsd,
      review.dailyChangePct,
      review.totalReturnUsd,
      review.totalReturnPct,
      review.cashUsd,
      JSON.stringify(review.allocation),
      JSON.stringify(review.benchmarks),
      review.riskScore,
      review.diversificationScore,
      review.currentDrawdownPct,
      review.maximumDrawdownPct,
      review.largestPositiveContributor ? JSON.stringify(review.largestPositiveContributor) : null,
      review.largestNegativeContributor ? JSON.stringify(review.largestNegativeContributor) : null,
      review.policyCompliant ? 1 : 0,
      JSON.stringify(review.policyWarnings),
      review.dataFreshnessStatus,
      review.recommendation,
      JSON.stringify(review.supportingReasons),
      review.confidenceScore,
      JSON.stringify(review.triggeredRules),
      JSON.stringify(review.relevantMetrics),
      review.marketDataTimestamp,
      review.generatedAt,
      review.ruleEngineVersion,
      review.summaryExplanation,
      review.marketDataSnapshotId
    ).run();
  }

  private async recordRun(
    portfolioId: string | null,
    marketDate: string,
    triggerSource: "manual" | "scheduled",
    status: "started" | "completed" | "skipped" | "failed",
    skipReason: string | null,
    reviewId: string | null,
    now: Date,
    errorMessage: string | null = null
  ): Promise<void> {
    await this.db.prepare(
      `INSERT INTO daily_review_runs (
        id, portfolio_id, market_date, trigger_source, status, skip_reason,
        error_message, review_id, scheduled_at, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id("daily_review_run", `${portfolioId ?? "all"}:${marketDate}:${triggerSource}:${status}:${now.toISOString()}`),
      portfolioId,
      marketDate,
      triggerSource,
      status,
      skipReason,
      errorMessage,
      reviewId,
      triggerSource === "scheduled" ? now.toISOString() : null,
      now.toISOString(),
      status === "started" ? null : now.toISOString()
    ).run();
  }

  private async recordEvent(reviewId: string | null, portfolioId: string, marketDate: string, eventType: string, message: string, details: Record<string, unknown>, now: Date): Promise<void> {
    await this.db.prepare(
      `INSERT OR IGNORE INTO daily_review_events (
        id, review_id, portfolio_id, market_date, event_type, message, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id("daily_review_event", `${portfolioId}:${marketDate}:${eventType}:${now.toISOString()}:${message}`), reviewId, portfolioId, marketDate, eventType, message, JSON.stringify(details), now.toISOString()).run();
  }

  private async recordJourney(review: DailyPortfolioReview, severity: "info" | "warning"): Promise<void> {
    await recordJourneyEvent(this.db, {
      portfolioId: review.portfolioId,
      eventType: "daily_summary_completed",
      timestamp: review.generatedAt,
      title: "Daily paper portfolio review completed",
      description: review.summaryExplanation,
      accountValueUsd: review.portfolioValueUsd,
      portfolioValueUsd: review.portfolioValueUsd - review.cashUsd,
      cashValueUsd: review.cashUsd,
      source: review.triggerSource === "scheduled" ? "scheduler" : "manual",
      severity,
      strategyVersion: review.ruleEngineVersion,
      metadata: { recommendation: review.recommendation, policyWarnings: review.policyWarnings, paperOnly: true }
    });
  }
}

export async function runScheduledDailyReviews(env: Env, scheduledAt = new Date().toISOString()): Promise<DailyReviewRunResult[]> {
  const now = new Date(scheduledAt);
  const schedule = shouldRunScheduledDailyReview(now);
  if (!schedule.shouldRun) {
    const service = new DailyPortfolioReviewService(env.DB);
    return [await service.run(TIM_PORTFOLIO_ID, "scheduled", now)];
  }
  const service = new DailyPortfolioReviewService(env.DB);
  const profiles = await listPortfolioProfiles(env.DB);
  const results: DailyReviewRunResult[] = [];
  for (const profile of profiles) {
    results.push(await service.run(profile.portfolioId, "scheduled", now));
  }
  return results;
}

export async function getDailyReview(db: D1Database, portfolioId = TIM_PORTFOLIO_ID, marketDate?: string): Promise<DailyPortfolioReview | null> {
  const date = marketDate ?? accountDate(new Date(), TIMEZONE);
  const row = await db.prepare("SELECT * FROM daily_portfolio_reviews WHERE portfolio_id = ? AND market_date = ?").bind(portfolioId, date).first<DailyReviewRow>();
  return row ? mapReviewRow(row) : null;
}

export async function listDailyReviews(db: D1Database, portfolioId = TIM_PORTFOLIO_ID, limit = 30): Promise<DailyPortfolioReview[]> {
  return new DailyPortfolioReviewService(db).list(portfolioId, limit);
}

export function shouldRunScheduledDailyReview(now: Date): { shouldRun: boolean; marketDate: string; reason: string | null } {
  const marketDate = accountDate(now, TIMEZONE);
  if (isWeekendMarketDate(marketDate)) {
    return { shouldRun: false, marketDate, reason: "Weekend; U.S. equity market closed." };
  }
  if (isUsMarketHoliday(marketDate)) {
    return { shouldRun: false, marketDate, reason: "Market holiday; U.S. equity market closed." };
  }
  const minutes = minutesInTimeZone(now, TIMEZONE);
  if (minutes < 16 * 60 + 5) {
    return { shouldRun: false, marketDate, reason: "Before regular U.S. market close review window." };
  }
  return { shouldRun: true, marketDate, reason: null };
}

export function calculateAllocation(valuation: PortfolioValuation, positions: PositionRow[]): AllocationSummary {
  const total = valuation.totalAccountValueUsd > 0 ? valuation.totalAccountValueUsd : 1;
  const sectors: Record<string, number> = {};
  for (const position of positions) {
    const sector = sectorFor(position);
    sectors[sector] = addMoney(sectors[sector] ?? 0, position.marketValueUsd);
  }
  const equity = positions.filter((position) => ["stock", "etf", "reit"].includes(position.assetClass)).reduce((sum, position) => addMoney(sum, position.marketValueUsd), 0);
  const bonds = positions.filter((position) => ["bond_fund", "money_market"].includes(position.assetClass)).reduce((sum, position) => addMoney(sum, position.marketValueUsd), 0);
  const largestPosition = positions.reduce((max, position) => Math.max(max, position.marketValueUsd), 0);
  const largestSector = Math.max(0, ...Object.values(sectors));
  return {
    cashPct: roundRatio(valuation.cashUsd / total),
    equityPct: roundRatio(equity / total),
    bondPct: roundRatio(bonds / total),
    otherPct: roundRatio(Math.max(0, total - valuation.cashUsd - equity - bonds) / total),
    largestPositionPct: roundRatio(largestPosition / total),
    largestSectorPct: roundRatio(largestSector / total),
    sectors: Object.fromEntries(Object.entries(sectors).map(([key, value]) => [key, roundRatio(value / total)]))
  };
}

export function evaluatePolicyWarnings(policy: InvestmentPolicy | null, allocation: AllocationSummary, analytics: PerformanceAnalyticsSummary): string[] {
  if (!policy) {
    return ["No active investment policy is configured."];
  }
  const warnings: string[] = [];
  if (allocation.cashPct < policy.minCashAllocationPct) {
    warnings.push("Cash allocation is below the policy minimum.");
  }
  if (allocation.largestPositionPct > policy.maxSinglePositionPct) {
    warnings.push("A position exceeds the policy single-position limit.");
  }
  if (allocation.largestSectorPct > policy.maxSectorAllocationPct) {
    warnings.push("A sector allocation exceeds the policy sector limit.");
  }
  if (analytics.currentDrawdownPct > policy.maxDrawdownPct) {
    warnings.push("Current drawdown exceeds the policy drawdown target.");
  }
  return warnings;
}

export function decideDailyReview(input: {
  allocation: AllocationSummary;
  policy: InvestmentPolicy | null;
  policyWarnings: string[];
  dataFreshnessStatus: "fresh" | "stale" | "unavailable";
  currentDrawdownPct: number;
  maximumDrawdownPct: number;
  config: DailyReviewConfig;
}): { recommendation: DailyDecisionStatus; reasons: string[]; confidenceScore: number; triggeredRules: string[]; riskScore: number; diversificationScore: number } {
  const reasons: string[] = [];
  const triggeredRules: string[] = [];
  const policy = input.policy;
  const riskScore = calculateRiskScore(input.allocation, input.currentDrawdownPct, policy);
  const diversificationScore = calculateDiversificationScore(input.allocation);
  if (input.dataFreshnessStatus !== "fresh") {
    return { recommendation: "Data Incomplete", reasons: ["Required market data is stale or unavailable."], confidenceScore: 0.98, triggeredRules: ["data_freshness"], riskScore, diversificationScore };
  }
  if (input.policyWarnings.length > 0) {
    return { recommendation: "Risk Reduction Suggested", reasons: input.policyWarnings, confidenceScore: 0.9, triggeredRules: ["policy_limit"], riskScore, diversificationScore };
  }
  if (policy) {
    if (input.currentDrawdownPct >= policy.maxDrawdownPct * input.config.nearLimitRatio) {
      reasons.push("Drawdown is approaching the conservative policy target.");
      triggeredRules.push("drawdown_near_limit");
    }
    if (input.allocation.largestPositionPct >= policy.maxSinglePositionPct * input.config.nearLimitRatio) {
      reasons.push("A position is approaching the policy concentration limit.");
      triggeredRules.push("position_near_limit");
    }
    if (input.allocation.largestSectorPct >= policy.maxSectorAllocationPct * input.config.nearLimitRatio) {
      reasons.push("A sector is approaching the policy concentration limit.");
      triggeredRules.push("sector_near_limit");
    }
    if (input.allocation.otherPct > input.config.allocationDriftThresholdPct) {
      return { recommendation: "Rebalance Suggested", reasons: ["Allocation drift exceeds the configured threshold."], confidenceScore: 0.82, triggeredRules: ["allocation_drift"], riskScore, diversificationScore };
    }
  }
  if (reasons.length > 0) {
    return { recommendation: "Monitor", reasons, confidenceScore: 0.78, triggeredRules, riskScore, diversificationScore };
  }
  return { recommendation: "Hold", reasons: ["Portfolio remains within the configured conservative paper-policy limits."], confidenceScore: 0.74, triggeredRules: ["within_policy"], riskScore, diversificationScore };
}

export function isUsMarketHoliday(marketDate: string): boolean {
  const holidays = new Set([
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
    "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"
  ]);
  return holidays.has(marketDate);
}

function buildReviewRecord(input: {
  portfolioId: string;
  marketDate: string;
  triggerSource: "manual" | "scheduled";
  valuation: PortfolioValuation;
  analytics: PerformanceAnalyticsSummary;
  allocation: AllocationSummary;
  benchmarks: DailyReviewBenchmark[];
  policyWarnings: string[];
  dataFreshnessStatus: "fresh" | "stale" | "unavailable";
  decision: ReturnType<typeof decideDailyReview>;
  contributors: { positive: Contributor | null; negative: Contributor | null };
  marketDataSnapshotId: string | null;
  now: Date;
}): DailyPortfolioReview {
  const totalReturnUsd = input.analytics.allTimeReturn.amountUsd;
  const marketDataTimestamp = input.valuation.lastSuccessfulMarketDataUpdateTime;
  const summaryExplanation = `${input.decision.recommendation}: ${input.decision.reasons.join(" ")}`;
  return {
    id: `daily_review_${input.portfolioId}_${input.marketDate}`,
    portfolioId: input.portfolioId,
    marketDate: input.marketDate,
    triggerSource: input.triggerSource,
    status: "completed",
    portfolioValueUsd: input.valuation.totalAccountValueUsd,
    dailyChangeUsd: input.valuation.todayChangeUsd,
    dailyChangePct: input.valuation.todayChangePct,
    totalReturnUsd,
    totalReturnPct: input.analytics.allTimeReturn.percentage,
    cashUsd: input.valuation.cashUsd,
    allocation: input.allocation,
    benchmarks: input.benchmarks,
    riskScore: input.decision.riskScore,
    diversificationScore: input.decision.diversificationScore,
    currentDrawdownPct: input.analytics.currentDrawdownPct,
    maximumDrawdownPct: input.analytics.maximumDrawdownPct,
    largestPositiveContributor: input.contributors.positive,
    largestNegativeContributor: input.contributors.negative,
    policyCompliant: input.policyWarnings.length === 0,
    policyWarnings: input.policyWarnings,
    dataFreshnessStatus: input.dataFreshnessStatus,
    recommendation: input.decision.recommendation,
    supportingReasons: input.decision.reasons,
    confidenceScore: input.decision.confidenceScore,
    triggeredRules: input.decision.triggeredRules,
    relevantMetrics: {
      cashPct: input.allocation.cashPct,
      equityPct: input.allocation.equityPct,
      bondPct: input.allocation.bondPct,
      largestPositionPct: input.allocation.largestPositionPct,
      largestSectorPct: input.allocation.largestSectorPct,
      currentDrawdownPct: input.analytics.currentDrawdownPct,
      totalReturnUsd
    },
    marketDataTimestamp,
    marketDataSnapshotId: input.marketDataSnapshotId,
    strategyRunId: null,
    generatedAt: input.now.toISOString(),
    ruleEngineVersion: RULE_ENGINE_VERSION,
    summaryExplanation
  };
}

function classifyReviewFreshness(valuation: PortfolioValuation, now: Date, stalePriceMs: number): "fresh" | "stale" | "unavailable" {
  if (valuation.positions.length === 0) {
    return "fresh";
  }
  if (!valuation.lastSuccessfulMarketDataUpdateTime) {
    return "unavailable";
  }
  const age = now.getTime() - new Date(valuation.lastSuccessfulMarketDataUpdateTime).getTime();
  return Number.isFinite(age) && age >= 0 && age <= stalePriceMs ? "fresh" : "stale";
}

function contributorsFromPositions(positions: PositionRow[]): { positive: Contributor | null; negative: Contributor | null } {
  const contributors = positions.map((position) => {
    const cost = position.quantity * position.avgEntryPriceUsd;
    const pl = position.marketValueUsd - cost;
    return { symbol: position.symbol, unrealizedProfitLossUsd: roundMoney(pl), unrealizedProfitLossPct: cost > 0 ? roundRatio(pl / cost) : 0 };
  });
  return {
    positive: contributors.filter((item) => item.unrealizedProfitLossUsd > 0).sort((left, right) => right.unrealizedProfitLossUsd - left.unrealizedProfitLossUsd)[0] ?? null,
    negative: contributors.filter((item) => item.unrealizedProfitLossUsd < 0).sort((left, right) => left.unrealizedProfitLossUsd - right.unrealizedProfitLossUsd)[0] ?? null
  };
}

function calculateRiskScore(allocation: AllocationSummary, currentDrawdownPct: number, policy: InvestmentPolicy | null): number {
  const drawdownComponent = policy?.maxDrawdownPct ? Math.min(1, currentDrawdownPct / policy.maxDrawdownPct) : currentDrawdownPct;
  const concentration = Math.max(allocation.largestPositionPct, allocation.largestSectorPct);
  return roundRatio(Math.min(1, concentration * 1.6 + drawdownComponent * 0.3 + allocation.equityPct * 0.1));
}

function calculateDiversificationScore(allocation: AllocationSummary): number {
  const sectorCount = Object.values(allocation.sectors).filter((value) => value > 0.01).length;
  const mixScore = Math.min(1, sectorCount / 4);
  const concentrationPenalty = Math.min(0.6, allocation.largestPositionPct + allocation.largestSectorPct / 2);
  return roundRatio(Math.max(0, Math.min(1, 0.35 + mixScore * 0.5 - concentrationPenalty * 0.35)));
}

function benchmark(name: string, starting: number, value: number, dataStatus: DailyReviewBenchmark["dataStatus"], disclosure: string, symbols: string[]): DailyReviewBenchmark {
  return { name, valueUsd: value, returnUsd: subtractMoney(value, starting), returnPct: pctChange(starting, value), dataStatus, disclosure, symbols };
}

function priceBenchmark(name: string, starting: number, price: MarketPriceRow | null, symbol: string): DailyReviewBenchmark {
  if (!price) {
    return { name, valueUsd: null, returnUsd: null, returnPct: null, dataStatus: "unavailable", disclosure: "No trustworthy benchmark price is available; value was not fabricated.", symbols: [symbol] };
  }
  return benchmark(name, starting, starting, "incomplete", "Starting benchmark price history is not complete yet; value remains at starting capital until historical baseline is available.", [symbol]);
}

function priceRowFromSnapshot(snapshot: Awaited<ReturnType<MarketDataService["createSnapshot"]>>, symbol: string): MarketPriceRow | null {
  const quote = snapshot.quotes.get(symbol);
  if (!quote || !quote.lastPrice || !quote.providerTimestamp || !quote.validation.valid) {
    return null;
  }
  return {
    symbol,
    priceUsd: quote.lastPrice,
    priceAsOf: quote.providerTimestamp,
    createdAt: quote.receivedTimestamp
  };
}

function balancedBenchmark(starting: number, weights: Record<string, number>, prices: Record<string, MarketPriceRow | null>): DailyReviewBenchmark {
  const unavailable = Object.entries(weights).filter(([symbol]) => symbol !== "cash" && !prices[symbol]);
  if (unavailable.length > 0) {
    return { name: "Conservative balanced benchmark", valueUsd: null, returnUsd: null, returnPct: null, dataStatus: "unavailable", disclosure: "One or more benchmark prices are unavailable; balanced benchmark was not fabricated.", symbols: Object.keys(weights) };
  }
  return benchmark("Conservative balanced benchmark", starting, starting, "incomplete", "Historical total-return baseline is incomplete; benchmark is held at starting value until enough history exists.", Object.keys(weights));
}

function buyAndHoldBenchmark(starting: number, positions: PositionRow[], valuation: PortfolioValuation, disclosure: string): DailyReviewBenchmark {
  if (positions.length === 0) {
    return benchmark("Buy-and-hold initial allocation", starting, valuation.totalAccountValueUsd, "complete", "Cash-only account baseline equals current account value.", ["cash"]);
  }
  return benchmark("Buy-and-hold initial allocation", starting, valuation.totalAccountValueUsd, "incomplete", disclosure, positions.map((position) => position.symbol));
}

function sectorFor(position: PositionRow): string {
  if (position.assetClass === "bond_fund" || /BND|BOND|TREAS|SHY|IEF|TLT/i.test(position.symbol)) {
    return "Investment-grade bonds";
  }
  if (/SCHD|DIV|LOWV|USMV/i.test(position.symbol)) {
    return "Dividend or low-volatility equity";
  }
  if (position.assetClass === "money_market") {
    return "Cash equivalents";
  }
  return position.assetClass === "stock" || position.assetClass === "etf" ? "U.S. broad-market equity" : position.assetClass;
}

function isWeekendMarketDate(marketDate: string): boolean {
  const day = new Date(`${marketDate}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function minutesInTimeZone(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function id(prefix: string, key: string): string {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(16)}`;
}

interface DailyReviewRow {
  id: string;
  portfolio_id: string;
  market_date: string;
  trigger_source: "manual" | "scheduled";
  status: "completed" | "skipped" | "failed";
  portfolio_value_usd: number;
  daily_change_usd: number;
  daily_change_pct: number;
  total_return_usd: number;
  total_return_pct: number;
  cash_usd: number;
  allocation_json: string;
  benchmark_json: string;
  risk_score: number;
  diversification_score: number;
  current_drawdown_pct: number;
  maximum_drawdown_pct: number;
  largest_positive_contributor_json: string | null;
  largest_negative_contributor_json: string | null;
  policy_compliant: number;
  policy_warnings_json: string;
  data_freshness_status: "fresh" | "stale" | "unavailable";
  recommendation: DailyDecisionStatus;
  supporting_reasons_json: string;
  confidence_score: number;
  triggered_rules_json: string;
  relevant_metrics_json: string;
  market_data_timestamp: string | null;
  market_data_snapshot_id: string | null;
  strategy_run_id: string | null;
  generated_at: string;
  rule_engine_version: string;
  summary_explanation: string;
}

function mapReviewRow(row: DailyReviewRow): DailyPortfolioReview {
  return {
    id: row.id,
    portfolioId: row.portfolio_id,
    marketDate: row.market_date,
    triggerSource: row.trigger_source,
    status: row.status,
    portfolioValueUsd: row.portfolio_value_usd,
    dailyChangeUsd: row.daily_change_usd,
    dailyChangePct: row.daily_change_pct,
    totalReturnUsd: row.total_return_usd,
    totalReturnPct: row.total_return_pct,
    cashUsd: row.cash_usd,
    allocation: parseJson(row.allocation_json, { cashPct: 0, equityPct: 0, bondPct: 0, otherPct: 0, largestPositionPct: 0, largestSectorPct: 0, sectors: {} }),
    benchmarks: parseJson(row.benchmark_json, []),
    riskScore: row.risk_score,
    diversificationScore: row.diversification_score,
    currentDrawdownPct: row.current_drawdown_pct,
    maximumDrawdownPct: row.maximum_drawdown_pct,
    largestPositiveContributor: row.largest_positive_contributor_json ? parseJson(row.largest_positive_contributor_json, null) : null,
    largestNegativeContributor: row.largest_negative_contributor_json ? parseJson(row.largest_negative_contributor_json, null) : null,
    policyCompliant: row.policy_compliant === 1,
    policyWarnings: parseJson(row.policy_warnings_json, []),
    dataFreshnessStatus: row.data_freshness_status,
    recommendation: row.recommendation,
    supportingReasons: parseJson(row.supporting_reasons_json, []),
    confidenceScore: row.confidence_score,
    triggeredRules: parseJson(row.triggered_rules_json, []),
    relevantMetrics: parseJson(row.relevant_metrics_json, {}),
    marketDataTimestamp: row.market_data_timestamp,
    marketDataSnapshotId: row.market_data_snapshot_id ?? null,
    strategyRunId: row.strategy_run_id ?? null,
    generatedAt: row.generated_at,
    ruleEngineVersion: row.rule_engine_version,
    summaryExplanation: row.summary_explanation
  };
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
