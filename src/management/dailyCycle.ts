import { PerformanceAnalyticsService } from "../analytics/performance.ts";
import { recordJourneyEvent } from "../journey/service.ts";
import { MarketDataService } from "../market/service.ts";
import { getInvestmentPolicy, type InvestmentPolicy } from "../policies/investmentPolicy.ts";
import { listPortfolioProfiles } from "../portfolio/profiles.ts";
import { accountDate, getPortfolioValuation, type PortfolioValuation } from "../portfolio/valuation.ts";
import { RecommendationProposalService } from "../recommendations/proposalService.ts";
import { DailyPortfolioReviewService, getDailyReview, shouldRunScheduledDailyReview, type DailyPortfolioReview } from "../reviews/dailyReview.ts";
import { PortfolioDecisionService } from "../decisions/portfolioDecision.ts";
import { PortfolioBriefingService } from "../briefings/portfolioBriefing.ts";
import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";
import { addMoney, roundRatio } from "../shared/money.ts";
import type { AssetClass, Env } from "../shared/types.ts";

export type DailyManagementOutcome =
  | "Hold"
  | "Review recommended"
  | "Rebalance proposal recommended"
  | "Risk alert"
  | "Data unavailable"
  | "Policy violation";

export interface DailyManagementConfig {
  holdDriftThresholdPct: number;
  reviewDriftThresholdPct: number;
  rebalanceDriftThresholdPct: number;
  drawdownReviewThresholdPct: number;
  criticalDrawdownThresholdPct: number;
  stalePriceMs: number;
  targetAllocation: AllocationShape;
  autoCreateDraftProposal: boolean;
}

export interface AllocationShape {
  cashPct: number;
  equityPct: number;
  bondPct: number;
  otherPct: number;
  largestPositionPct: number;
  largestSectorPct: number;
  sectors: Record<string, number>;
}

export interface DailyManagementCycle {
  id: string;
  portfolioId: string;
  cycleDate: string;
  triggerSource: "manual" | "scheduled";
  status: "completed" | "skipped" | "failed";
  startedAt: string;
  completedAt: string | null;
  dataTimestamp: string | null;
  marketDataSnapshotId: string | null;
  marketDataStatus: "fresh" | "stale" | "unavailable";
  providerSummary: ProviderSummary[];
  portfolioValueUsd: number;
  investedValueUsd: number;
  cashUsd: number;
  dailyChangeUsd: number;
  dailyChangePct: number;
  returnSinceStartUsd: number;
  returnSinceStartPct: number;
  unrealizedGainLossUsd: number;
  unrealizedGainLossPct: number;
  currentAllocation: AllocationShape;
  targetAllocation: AllocationShape;
  allocationDrift: AllocationDrift;
  performanceMetrics: Record<string, number | string | null>;
  drawdownMetrics: { currentDrawdownPct: number; maximumDrawdownPct: number };
  riskFindings: string[];
  policyFindings: string[];
  unresolvedItems: string[];
  policyCompliant: boolean;
  outcome: DailyManagementOutcome;
  recommendationExplanation: string;
  dailyReviewId: string | null;
  createdProposalId: string | null;
  errorDetails: string | null;
  refreshReason: string | null;
}

export interface DailyManagementRunResult {
  cycle: DailyManagementCycle | null;
  skipped: boolean;
  idempotent: boolean;
  reason: string | null;
}

export interface AllocationDrift {
  cashPct: number;
  equityPct: number;
  bondPct: number;
  otherPct: number;
  maxAbsoluteDriftPct: number;
  sectors: Record<string, number>;
}

export interface ProviderSummary {
  symbol: string;
  provider: string;
  timestamp: string | null;
  status: string;
}

interface PortfolioRow {
  id: string;
  name: string;
  mode: string;
  cashUsd: number;
  startingBalanceUsd: number;
}

interface PositionRow {
  symbol: string;
  assetClass: AssetClass;
  quantity: number;
  avgEntryPriceUsd: number;
  currentPriceUsd: number;
  marketValueUsd: number;
}

interface ConfigRow {
  holdDriftThresholdPct: number;
  reviewDriftThresholdPct: number;
  rebalanceDriftThresholdPct: number;
  drawdownReviewThresholdPct: number;
  criticalDrawdownThresholdPct: number;
  stalePriceMs: number;
  targetCashPct: number;
  targetEquityPct: number;
  targetBondPct: number;
  targetOtherPct: number;
  autoCreateDraftProposal: number;
}

interface CycleRow {
  id: string;
  portfolio_id: string;
  cycle_date: string;
  trigger_source: "manual" | "scheduled";
  status: "completed" | "skipped" | "failed";
  started_at: string;
  completed_at: string | null;
  data_timestamp: string | null;
  market_data_snapshot_id: string | null;
  market_data_status: "fresh" | "stale" | "unavailable";
  provider_summary_json: string;
  portfolio_value_usd: number;
  invested_value_usd: number;
  cash_usd: number;
  daily_change_usd: number;
  daily_change_pct: number;
  return_since_start_usd: number;
  return_since_start_pct: number;
  unrealized_gain_loss_usd: number;
  unrealized_gain_loss_pct: number;
  current_allocation_json: string;
  target_allocation_json: string;
  allocation_drift_json: string;
  performance_metrics_json: string;
  drawdown_metrics_json: string;
  risk_findings_json: string;
  policy_findings_json: string;
  unresolved_items_json: string;
  policy_compliant: number;
  outcome: DailyManagementOutcome;
  recommendation_explanation: string;
  daily_review_id: string | null;
  created_proposal_id: string | null;
  error_details: string | null;
  refresh_reason: string | null;
}

const TIMEZONE = "America/New_York";
const RULE_VERSION = "daily-management-cycle-v1";
const ACTIVE_PROPOSAL_STATUSES = ["Draft", "Ready for Review", "Approved", "Orders Staged"];
const ACTIVE_BATCH_STATUSES = ["Pending Review", "Ready to Execute", "Executing"];

export const DEFAULT_DAILY_MANAGEMENT_CONFIG: DailyManagementConfig = {
  holdDriftThresholdPct: 0.05,
  reviewDriftThresholdPct: 0.05,
  rebalanceDriftThresholdPct: 0.1,
  drawdownReviewThresholdPct: 0.07,
  criticalDrawdownThresholdPct: 0.1,
  stalePriceMs: 36 * 60 * 60 * 1000,
  targetAllocation: { cashPct: 0.4, equityPct: 0.4, bondPct: 0.2, otherPct: 0, largestPositionPct: 0.2, largestSectorPct: 0.3, sectors: {} },
  autoCreateDraftProposal: true
};

export class DailyManagementCycleService {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async run(
    portfolioId = TIM_PORTFOLIO_ID,
    triggerSource: "manual" | "scheduled" = "manual",
    now = new Date(),
    options: { refresh?: boolean; refreshReason?: string } = {}
  ): Promise<DailyManagementRunResult> {
    const cycleDate = accountDate(now, TIMEZONE);
    const existing = await this.get(portfolioId, cycleDate);
    if (existing && !options.refresh) {
      await this.recordEvent(existing.id, portfolioId, cycleDate, "duplicate_cycle_prevented", "Daily management cycle already exists for this market date.", { existingCycleId: existing.id }, now);
      return { cycle: existing, skipped: true, idempotent: true, reason: "Daily management cycle already exists for this market date." };
    }

    if (triggerSource === "scheduled") {
      const schedule = shouldRunScheduledDailyReview(now);
      if (!schedule.shouldRun) {
        const skipped = await this.persistSkipped(portfolioId, schedule.marketDate, triggerSource, schedule.reason ?? "Market is closed.", now);
        return { cycle: skipped, skipped: true, idempotent: false, reason: schedule.reason };
      }
    }

    await this.recordEvent(existing?.id ?? null, portfolioId, cycleDate, options.refresh ? "cycle_refresh_started" : "cycle_started", "Daily paper management cycle started.", { triggerSource, refresh: options.refresh === true }, now);

    try {
      const portfolio = await this.getPortfolio(portfolioId);
      if (!portfolio) {
        throw new Error("Portfolio not found.");
      }
      if (portfolio.mode !== "paper") {
        throw new Error("Daily management cycles are restricted to paper portfolios.");
      }

      const policy = await getInvestmentPolicy(this.db, portfolioId);
      const config = await this.getConfig(policy);
      const positionsBefore = await this.getPositions(portfolioId);
      const symbols = positionsBefore.map((position) => position.symbol);
      const marketSnapshot = await new MarketDataService(this.db).createSnapshot(symbols, "daily_review", now);
      const providerSummary = providerSummaryFromSnapshot(marketSnapshot);

      const dailyReviewResult = await new DailyPortfolioReviewService(this.db).run(portfolioId, triggerSource, now);
      const review = dailyReviewResult.review ?? await getDailyReview(this.db, portfolioId, cycleDate);
      const [valuation, analytics, positions, unresolvedItems] = await Promise.all([
        getPortfolioValuation(this.db, portfolioId, now),
        new PerformanceAnalyticsService(this.db).getSummary(portfolioId, now),
        this.getPositions(portfolioId),
        this.getUnresolvedItems(portfolioId)
      ]);

      const currentAllocation = calculateManagementAllocation(valuation, positions);
      const targetAllocation = targetAllocationFor(config, policy);
      const allocationDrift = calculateAllocationDrift(currentAllocation, targetAllocation);
      const policyFindings = evaluateManagementPolicy(policy, currentAllocation, analytics.currentDrawdownPct, positions);
      const riskFindings = evaluateRiskFindings(allocationDrift, analytics.currentDrawdownPct, config, policy, unresolvedItems);
      const marketDataStatus = classifyManagementDataStatus(valuation, now, config.stalePriceMs);
      const decision = decideDailyManagementCycle({
        allocationDrift,
        policyFindings,
        riskFindings,
        unresolvedItems,
        marketDataStatus,
        currentDrawdownPct: analytics.currentDrawdownPct,
        config
      });

      let createdProposalId: string | null = null;
      if (
        decision.outcome === "Rebalance proposal recommended" &&
        review &&
        marketDataStatus === "fresh" &&
        policyFindings.length === 0 &&
        unresolvedItems.length === 0 &&
        config.autoCreateDraftProposal
      ) {
        const proposalResult = await new RecommendationProposalService(this.db).createDraftFromReview(review.id, { now });
        createdProposalId = proposalResult.proposal?.id ?? null;
      }

      const cycle = buildCycleRecord({
        portfolioId,
        cycleDate,
        triggerSource,
        startedAt: now.toISOString(),
        completedAt: now.toISOString(),
        valuation,
        analytics,
        currentAllocation,
        targetAllocation,
        allocationDrift,
        providerSummary,
        marketDataStatus,
        marketDataSnapshotId: marketSnapshot.id,
        policyFindings,
        riskFindings,
        unresolvedItems,
        decision,
        review,
        createdProposalId,
        refreshReason: options.refreshReason ?? null
      });

      await this.persistCycle(cycle, options.refresh === true);
      const decisionResult = await new PortfolioDecisionService(this.db).evaluateCycle(cycle.id, now);
      await new PortfolioBriefingService(this.db).generate(cycle.portfolioId, { type: decisionResult.decision.primaryRecommendation === "Risk intervention" ? "risk_alert" : "daily_close", now });
      await this.recordMeaningfulJourney(cycle, policy);
      await this.recordEvent(cycle.id, portfolioId, cycleDate, "cycle_completed", "Daily paper management cycle completed.", { outcome: cycle.outcome, createdProposalId }, now);
      return { cycle, skipped: false, idempotent: false, reason: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown daily management cycle error.";
      const failed = await this.persistFailed(portfolioId, cycleDate, triggerSource, message, now);
      await this.recordEvent(failed.id, portfolioId, cycleDate, "cycle_failed", "Daily paper management cycle failed.", { error: message }, now);
      throw error;
    }
  }

  async latest(portfolioId = TIM_PORTFOLIO_ID): Promise<DailyManagementCycle | null> {
    const row = await this.db.prepare("SELECT * FROM daily_management_cycles WHERE portfolio_id = ? ORDER BY cycle_date DESC LIMIT 1").bind(portfolioId).first<CycleRow>();
    return row ? mapCycleRow(row) : null;
  }

  async list(portfolioId = TIM_PORTFOLIO_ID, limit = 30): Promise<DailyManagementCycle[]> {
    const rows = await listRows<CycleRow>(
      this.db.prepare("SELECT * FROM daily_management_cycles WHERE portfolio_id = ? ORDER BY cycle_date DESC LIMIT ?").bind(portfolioId, limit)
    );
    return rows.map(mapCycleRow);
  }

  async get(portfolioId: string, cycleDate: string): Promise<DailyManagementCycle | null> {
    const row = await this.db.prepare("SELECT * FROM daily_management_cycles WHERE portfolio_id = ? AND cycle_date = ?").bind(portfolioId, cycleDate).first<CycleRow>();
    return row ? mapCycleRow(row) : null;
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
         ORDER BY market_value_usd DESC, symbol ASC`
      ).bind(portfolioId)
    );
  }

  private async getConfig(policy: InvestmentPolicy | null): Promise<DailyManagementConfig> {
    const row = await this.db.prepare(
      `SELECT hold_drift_threshold_pct AS holdDriftThresholdPct,
        review_drift_threshold_pct AS reviewDriftThresholdPct,
        rebalance_drift_threshold_pct AS rebalanceDriftThresholdPct,
        drawdown_review_threshold_pct AS drawdownReviewThresholdPct,
        critical_drawdown_threshold_pct AS criticalDrawdownThresholdPct,
        stale_price_ms AS stalePriceMs, target_cash_pct AS targetCashPct,
        target_equity_pct AS targetEquityPct, target_bond_pct AS targetBondPct,
        target_other_pct AS targetOtherPct,
        auto_create_draft_proposal AS autoCreateDraftProposal
       FROM daily_management_cycle_config
       WHERE risk_profile = ?
       ORDER BY updated_at DESC
       LIMIT 1`
    ).bind(policy?.riskProfile ?? "Conservative").first<ConfigRow>();
    if (!row) {
      return DEFAULT_DAILY_MANAGEMENT_CONFIG;
    }
    return {
      holdDriftThresholdPct: row.holdDriftThresholdPct,
      reviewDriftThresholdPct: row.reviewDriftThresholdPct,
      rebalanceDriftThresholdPct: row.rebalanceDriftThresholdPct,
      drawdownReviewThresholdPct: row.drawdownReviewThresholdPct,
      criticalDrawdownThresholdPct: row.criticalDrawdownThresholdPct,
      stalePriceMs: row.stalePriceMs,
      targetAllocation: {
        cashPct: row.targetCashPct,
        equityPct: row.targetEquityPct,
        bondPct: row.targetBondPct,
        otherPct: row.targetOtherPct,
        largestPositionPct: policy?.maxSinglePositionPct ?? DEFAULT_DAILY_MANAGEMENT_CONFIG.targetAllocation.largestPositionPct,
        largestSectorPct: policy?.maxSectorAllocationPct ?? DEFAULT_DAILY_MANAGEMENT_CONFIG.targetAllocation.largestSectorPct,
        sectors: {}
      },
      autoCreateDraftProposal: row.autoCreateDraftProposal === 1
    };
  }

  private async getUnresolvedItems(portfolioId: string): Promise<string[]> {
    const proposalPlaceholders = ACTIVE_PROPOSAL_STATUSES.map(() => "?").join(", ");
    const batchPlaceholders = ACTIVE_BATCH_STATUSES.map(() => "?").join(", ");
    const [proposal, batch] = await Promise.all([
      this.db.prepare(`SELECT id, status FROM recommendation_proposals WHERE portfolio_id = ? AND status IN (${proposalPlaceholders}) ORDER BY created_at DESC LIMIT 1`).bind(portfolioId, ...ACTIVE_PROPOSAL_STATUSES).first<{ id: string; status: string }>(),
      this.db.prepare(`SELECT id, status FROM paper_order_batches WHERE portfolio_id = ? AND status IN (${batchPlaceholders}) ORDER BY created_at DESC LIMIT 1`).bind(portfolioId, ...ACTIVE_BATCH_STATUSES).first<{ id: string; status: string }>()
    ]);
    return [
      proposal ? `Unresolved recommendation proposal ${proposal.id} is ${proposal.status}.` : null,
      batch ? `Unresolved paper order batch ${batch.id} is ${batch.status}.` : null
    ].filter((item): item is string => Boolean(item));
  }

  private async persistCycle(cycle: DailyManagementCycle, refresh: boolean): Promise<void> {
    const sql = refresh
      ? `INSERT INTO daily_management_cycles (
          id, portfolio_id, cycle_date, trigger_source, status, started_at, completed_at,
          data_timestamp, market_data_snapshot_id, market_data_status, provider_summary_json,
          portfolio_value_usd, invested_value_usd, cash_usd, daily_change_usd, daily_change_pct,
          return_since_start_usd, return_since_start_pct, unrealized_gain_loss_usd,
          unrealized_gain_loss_pct, current_allocation_json, target_allocation_json,
          allocation_drift_json, performance_metrics_json, drawdown_metrics_json,
          risk_findings_json, policy_findings_json, unresolved_items_json, policy_compliant,
          outcome, recommendation_explanation, daily_review_id, created_proposal_id,
          error_details, refresh_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(portfolio_id, cycle_date) DO UPDATE SET
          trigger_source = excluded.trigger_source,
          status = excluded.status,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at,
          data_timestamp = excluded.data_timestamp,
          market_data_snapshot_id = excluded.market_data_snapshot_id,
          market_data_status = excluded.market_data_status,
          provider_summary_json = excluded.provider_summary_json,
          portfolio_value_usd = excluded.portfolio_value_usd,
          invested_value_usd = excluded.invested_value_usd,
          cash_usd = excluded.cash_usd,
          daily_change_usd = excluded.daily_change_usd,
          daily_change_pct = excluded.daily_change_pct,
          return_since_start_usd = excluded.return_since_start_usd,
          return_since_start_pct = excluded.return_since_start_pct,
          unrealized_gain_loss_usd = excluded.unrealized_gain_loss_usd,
          unrealized_gain_loss_pct = excluded.unrealized_gain_loss_pct,
          current_allocation_json = excluded.current_allocation_json,
          target_allocation_json = excluded.target_allocation_json,
          allocation_drift_json = excluded.allocation_drift_json,
          performance_metrics_json = excluded.performance_metrics_json,
          drawdown_metrics_json = excluded.drawdown_metrics_json,
          risk_findings_json = excluded.risk_findings_json,
          policy_findings_json = excluded.policy_findings_json,
          unresolved_items_json = excluded.unresolved_items_json,
          policy_compliant = excluded.policy_compliant,
          outcome = excluded.outcome,
          recommendation_explanation = excluded.recommendation_explanation,
          daily_review_id = excluded.daily_review_id,
          created_proposal_id = COALESCE(excluded.created_proposal_id, daily_management_cycles.created_proposal_id),
          error_details = excluded.error_details,
          refresh_reason = excluded.refresh_reason,
          updated_at = datetime('now')`
      : `INSERT OR IGNORE INTO daily_management_cycles (
          id, portfolio_id, cycle_date, trigger_source, status, started_at, completed_at,
          data_timestamp, market_data_snapshot_id, market_data_status, provider_summary_json,
          portfolio_value_usd, invested_value_usd, cash_usd, daily_change_usd, daily_change_pct,
          return_since_start_usd, return_since_start_pct, unrealized_gain_loss_usd,
          unrealized_gain_loss_pct, current_allocation_json, target_allocation_json,
          allocation_drift_json, performance_metrics_json, drawdown_metrics_json,
          risk_findings_json, policy_findings_json, unresolved_items_json, policy_compliant,
          outcome, recommendation_explanation, daily_review_id, created_proposal_id,
          error_details, refresh_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    await this.db.prepare(sql).bind(...cycleBindValues(cycle)).run();
  }

  private async persistSkipped(portfolioId: string, cycleDate: string, triggerSource: "manual" | "scheduled", reason: string, now: Date): Promise<DailyManagementCycle> {
    const cycle = emptyCycle(portfolioId, cycleDate, triggerSource, now, "skipped", "Data unavailable", reason);
    await this.persistCycle(cycle, false);
    await this.recordEvent(cycle.id, portfolioId, cycleDate, "cycle_skipped", "Daily paper management cycle skipped.", { reason }, now);
    return cycle;
  }

  private async persistFailed(portfolioId: string, cycleDate: string, triggerSource: "manual" | "scheduled", reason: string, now: Date): Promise<DailyManagementCycle> {
    const cycle = emptyCycle(portfolioId, cycleDate, triggerSource, now, "failed", "Data unavailable", reason);
    cycle.errorDetails = reason;
    await this.persistCycle(cycle, true);
    return cycle;
  }

  private async recordEvent(cycleId: string | null, portfolioId: string, cycleDate: string, eventType: string, message: string, details: Record<string, unknown>, now: Date): Promise<void> {
    await this.db.prepare(
      `INSERT OR IGNORE INTO daily_management_cycle_events (
        id, cycle_id, portfolio_id, cycle_date, event_type, message, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id("daily_management_event", `${portfolioId}:${cycleDate}:${eventType}:${now.toISOString()}:${message}`), cycleId, portfolioId, cycleDate, eventType, message, JSON.stringify(details), now.toISOString()).run();
  }

  private async recordMeaningfulJourney(cycle: DailyManagementCycle, policy: InvestmentPolicy | null): Promise<void> {
    const meaningful =
      cycle.outcome !== "Hold" ||
      cycle.createdProposalId !== null ||
      cycle.drawdownMetrics.currentDrawdownPct >= (policy?.maxDrawdownPct ?? 1) * 0.7;
    if (!meaningful) {
      return;
    }
    const key = `${cycle.portfolioId}:${cycle.cycleDate}:${cycle.outcome}:${cycle.createdProposalId ?? "none"}`;
    await recordJourneyEvent(this.db, {
      portfolioId: cycle.portfolioId,
      eventType: cycle.createdProposalId ? "manual_intervention" : "risk_limit_reached",
      timestamp: cycle.completedAt ?? cycle.startedAt,
      title: cycle.createdProposalId ? "Draft rebalance proposal generated" : `Daily management ${cycle.outcome}`,
      description: cycle.recommendationExplanation,
      accountValueUsd: cycle.portfolioValueUsd,
      portfolioValueUsd: cycle.investedValueUsd,
      cashValueUsd: cycle.cashUsd,
      source: cycle.triggerSource === "scheduled" ? "scheduler" : "manual",
      severity: cycle.outcome === "Risk alert" || cycle.outcome === "Policy violation" ? "warning" : "info",
      strategyVersion: RULE_VERSION,
      metadata: { dailyManagementCycleId: cycle.id, createdProposalId: cycle.createdProposalId, dedupeKey: key, paperOnly: true }
    });
  }
}

export async function runScheduledDailyManagementCycles(env: Env, scheduledAt = new Date().toISOString()): Promise<DailyManagementRunResult[]> {
  const service = new DailyManagementCycleService(env.DB);
  const now = new Date(scheduledAt);
  const schedule = shouldRunScheduledDailyReview(now);
  if (!schedule.shouldRun) {
    return [await service.run(TIM_PORTFOLIO_ID, "scheduled", now)];
  }
  const profiles = await listPortfolioProfiles(env.DB);
  const results: DailyManagementRunResult[] = [];
  for (const profile of profiles) {
    results.push(await service.run(profile.portfolioId, "scheduled", now));
  }
  return results;
}

export function calculateManagementAllocation(valuation: PortfolioValuation, positions: PositionRow[]): AllocationShape {
  const total = valuation.totalAccountValueUsd > 0 ? valuation.totalAccountValueUsd : 1;
  const sectors: Record<string, number> = {};
  for (const position of positions) {
    const sector = sectorFor(position);
    sectors[sector] = addMoney(sectors[sector] ?? 0, position.marketValueUsd);
  }
  const equity = positions.filter((position) => ["stock", "etf", "reit"].includes(position.assetClass)).reduce((sum, position) => addMoney(sum, position.marketValueUsd), 0);
  const bonds = positions.filter((position) => ["bond_fund", "money_market"].includes(position.assetClass)).reduce((sum, position) => addMoney(sum, position.marketValueUsd), 0);
  const largestPosition = Math.max(0, ...positions.map((position) => position.marketValueUsd));
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

export function calculateAllocationDrift(current: AllocationShape, target: AllocationShape): AllocationDrift {
  const sectors: Record<string, number> = {};
  for (const sector of new Set([...Object.keys(current.sectors), ...Object.keys(target.sectors)])) {
    sectors[sector] = roundRatio((current.sectors[sector] ?? 0) - (target.sectors[sector] ?? 0));
  }
  const drift = {
    cashPct: roundRatio(current.cashPct - target.cashPct),
    equityPct: roundRatio(current.equityPct - target.equityPct),
    bondPct: roundRatio(current.bondPct - target.bondPct),
    otherPct: roundRatio(current.otherPct - target.otherPct),
    sectors,
    maxAbsoluteDriftPct: 0
  };
  drift.maxAbsoluteDriftPct = Math.max(Math.abs(drift.cashPct), Math.abs(drift.equityPct), Math.abs(drift.bondPct), Math.abs(drift.otherPct), ...Object.values(sectors).map(Math.abs));
  return drift;
}

export function decideDailyManagementCycle(input: {
  allocationDrift: AllocationDrift;
  policyFindings: string[];
  riskFindings: string[];
  unresolvedItems: string[];
  marketDataStatus: "fresh" | "stale" | "unavailable";
  currentDrawdownPct: number;
  config: DailyManagementConfig;
}): { outcome: DailyManagementOutcome; explanation: string } {
  if (input.marketDataStatus !== "fresh") {
    return { outcome: "Data unavailable", explanation: "Required market pricing is stale or unavailable, so Kairox will not recommend an actionable rebalance." };
  }
  const critical = input.riskFindings.find((finding) => /critical drawdown/i.test(finding));
  if (critical) {
    return { outcome: "Risk alert", explanation: `${critical} Review risk exposure before considering any new paper action.` };
  }
  if (input.policyFindings.length > 0) {
    return { outcome: "Policy violation", explanation: `Policy review is required: ${input.policyFindings.join(" ")}` };
  }
  if (input.allocationDrift.maxAbsoluteDriftPct > input.config.rebalanceDriftThresholdPct) {
    if (input.unresolvedItems.length > 0) {
      return { outcome: "Review recommended", explanation: `Allocation drift exceeds the rebalance threshold, but an unresolved workflow already exists: ${input.unresolvedItems.join(" ")}` };
    }
    return { outcome: "Rebalance proposal recommended", explanation: "Allocation drift exceeds the configured rebalance threshold and current data is valid; a draft proposal may be prepared for review." };
  }
  if (input.allocationDrift.maxAbsoluteDriftPct > input.config.reviewDriftThresholdPct || input.riskFindings.length > 0 || input.unresolvedItems.length > 0) {
    return { outcome: "Review recommended", explanation: `Review is recommended: ${[...input.riskFindings, ...input.unresolvedItems, "Allocation or workflow state is outside the hold band."].join(" ")}` };
  }
  return { outcome: "Hold", explanation: "No action is recommended because pricing is current, the portfolio is inside policy limits, and allocation drift remains within the configured hold band." };
}

function buildCycleRecord(input: {
  portfolioId: string;
  cycleDate: string;
  triggerSource: "manual" | "scheduled";
  startedAt: string;
  completedAt: string;
  valuation: PortfolioValuation;
  analytics: Awaited<ReturnType<PerformanceAnalyticsService["getSummary"]>>;
  currentAllocation: AllocationShape;
  targetAllocation: AllocationShape;
  allocationDrift: AllocationDrift;
  providerSummary: ProviderSummary[];
  marketDataStatus: "fresh" | "stale" | "unavailable";
  marketDataSnapshotId: string | null;
  policyFindings: string[];
  riskFindings: string[];
  unresolvedItems: string[];
  decision: { outcome: DailyManagementOutcome; explanation: string };
  review: DailyPortfolioReview | null;
  createdProposalId: string | null;
  refreshReason: string | null;
}): DailyManagementCycle {
  const cost = input.valuation.positions.reduce((sum, position) => addMoney(sum, position.averageCostBasisUsd * position.quantity), 0);
  return {
    id: `daily_management_${input.portfolioId}_${input.cycleDate}`,
    portfolioId: input.portfolioId,
    cycleDate: input.cycleDate,
    triggerSource: input.triggerSource,
    status: "completed",
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    dataTimestamp: input.valuation.lastSuccessfulMarketDataUpdateTime,
    marketDataSnapshotId: input.marketDataSnapshotId,
    marketDataStatus: input.marketDataStatus,
    providerSummary: input.providerSummary,
    portfolioValueUsd: input.valuation.totalAccountValueUsd,
    investedValueUsd: input.valuation.portfolioValueUsd,
    cashUsd: input.valuation.cashUsd,
    dailyChangeUsd: input.valuation.todayChangeUsd,
    dailyChangePct: input.valuation.todayChangePct,
    returnSinceStartUsd: input.valuation.overallReturnUsd,
    returnSinceStartPct: input.valuation.overallReturnPct,
    unrealizedGainLossUsd: input.valuation.unrealizedProfitLossUsd,
    unrealizedGainLossPct: cost > 0 ? roundRatio(input.valuation.unrealizedProfitLossUsd / cost) : 0,
    currentAllocation: input.currentAllocation,
    targetAllocation: input.targetAllocation,
    allocationDrift: input.allocationDrift,
    performanceMetrics: {
      dailyChangeUsd: input.valuation.todayChangeUsd,
      dailyChangePct: input.valuation.todayChangePct,
      allTimeReturnUsd: input.analytics.allTimeReturn.amountUsd,
      allTimeReturnPct: input.analytics.allTimeReturn.percentage,
      highestPortfolioValueUsd: input.analytics.highestPortfolioValueUsd,
      lowestPortfolioValueUsd: input.analytics.lowestPortfolioValueUsd
    },
    drawdownMetrics: {
      currentDrawdownPct: input.analytics.currentDrawdownPct,
      maximumDrawdownPct: input.analytics.maximumDrawdownPct
    },
    riskFindings: input.riskFindings,
    policyFindings: input.policyFindings,
    unresolvedItems: input.unresolvedItems,
    policyCompliant: input.policyFindings.length === 0,
    outcome: input.decision.outcome,
    recommendationExplanation: input.decision.explanation,
    dailyReviewId: input.review?.id ?? null,
    createdProposalId: input.createdProposalId,
    errorDetails: null,
    refreshReason: input.refreshReason
  };
}

function evaluateManagementPolicy(policy: InvestmentPolicy | null, allocation: AllocationShape, currentDrawdownPct: number, positions: PositionRow[]): string[] {
  if (!policy) {
    return ["No active investment policy is configured."];
  }
  const findings: string[] = [];
  if (allocation.cashPct < policy.minCashAllocationPct) {
    findings.push("Cash allocation is below the policy minimum.");
  }
  if (allocation.largestSectorPct > policy.maxSectorAllocationPct + 0.0005) {
    findings.push("A sector allocation exceeds the policy maximum.");
  }
  if (allocation.largestPositionPct > policy.maxSinglePositionPct + 0.0005) {
    findings.push("A position exceeds the policy single-position maximum.");
  }
  if (currentDrawdownPct >= policy.maxDrawdownPct) {
    findings.push("Current drawdown is at or above the policy drawdown target.");
  }
  return [...new Set(findings)];
}

function evaluateRiskFindings(drift: AllocationDrift, currentDrawdownPct: number, config: DailyManagementConfig, policy: InvestmentPolicy | null, unresolvedItems: string[]): string[] {
  const findings: string[] = [];
  if (drift.maxAbsoluteDriftPct > config.rebalanceDriftThresholdPct) {
    findings.push("Allocation drift exceeds the rebalance threshold.");
  } else if (drift.maxAbsoluteDriftPct > config.reviewDriftThresholdPct) {
    findings.push("Allocation drift exceeds the review threshold.");
  }
  if (currentDrawdownPct >= (policy?.maxDrawdownPct ?? config.criticalDrawdownThresholdPct)) {
    findings.push("Critical drawdown warning: current drawdown reached the stored maximum drawdown target.");
  } else if (currentDrawdownPct >= config.drawdownReviewThresholdPct) {
    findings.push("Drawdown has reached the review threshold.");
  }
  if (unresolvedItems.length > 0) {
    findings.push("An unresolved proposal or order workflow already exists.");
  }
  return findings;
}

function targetAllocationFor(config: DailyManagementConfig, policy: InvestmentPolicy | null): AllocationShape {
  const cashPct = Math.max(config.targetAllocation.cashPct, policy?.minCashAllocationPct ?? 0);
  const remaining = Math.max(0, 1 - cashPct);
  const requestedNonCash = config.targetAllocation.equityPct + config.targetAllocation.bondPct + config.targetAllocation.otherPct;
  const scale = requestedNonCash > remaining && requestedNonCash > 0 ? remaining / requestedNonCash : 1;
  return {
    cashPct: roundRatio(cashPct),
    equityPct: roundRatio(config.targetAllocation.equityPct * scale),
    bondPct: roundRatio(config.targetAllocation.bondPct * scale),
    otherPct: roundRatio(config.targetAllocation.otherPct * scale),
    largestPositionPct: policy?.maxSinglePositionPct ?? config.targetAllocation.largestPositionPct,
    largestSectorPct: policy?.maxSectorAllocationPct ?? config.targetAllocation.largestSectorPct,
    sectors: {}
  };
}

function classifyManagementDataStatus(valuation: PortfolioValuation, now: Date, stalePriceMs: number): "fresh" | "stale" | "unavailable" {
  if (valuation.positions.length === 0) {
    return "fresh";
  }
  if (!valuation.lastSuccessfulMarketDataUpdateTime || valuation.dataStatus === "unavailable") {
    return "unavailable";
  }
  const age = now.getTime() - new Date(valuation.lastSuccessfulMarketDataUpdateTime).getTime();
  return Number.isFinite(age) && age >= 0 && age <= stalePriceMs && valuation.dataStatus !== "stale" ? "fresh" : "stale";
}

function providerSummaryFromSnapshot(snapshot: Awaited<ReturnType<MarketDataService["createSnapshot"]>>): ProviderSummary[] {
  return [...snapshot.quotes.values()].map((quote) => ({
    symbol: quote.symbol,
    provider: quote.providerName,
    timestamp: quote.providerTimestamp,
    status: quote.dataQualityStatus
  }));
}

function emptyCycle(portfolioId: string, cycleDate: string, triggerSource: "manual" | "scheduled", now: Date, status: "skipped" | "failed", outcome: DailyManagementOutcome, reason: string): DailyManagementCycle {
  return {
    id: `daily_management_${portfolioId}_${cycleDate}`,
    portfolioId,
    cycleDate,
    triggerSource,
    status,
    startedAt: now.toISOString(),
    completedAt: now.toISOString(),
    dataTimestamp: null,
    marketDataSnapshotId: null,
    marketDataStatus: "unavailable",
    providerSummary: [],
    portfolioValueUsd: 0,
    investedValueUsd: 0,
    cashUsd: 0,
    dailyChangeUsd: 0,
    dailyChangePct: 0,
    returnSinceStartUsd: 0,
    returnSinceStartPct: 0,
    unrealizedGainLossUsd: 0,
    unrealizedGainLossPct: 0,
    currentAllocation: DEFAULT_DAILY_MANAGEMENT_CONFIG.targetAllocation,
    targetAllocation: DEFAULT_DAILY_MANAGEMENT_CONFIG.targetAllocation,
    allocationDrift: { cashPct: 0, equityPct: 0, bondPct: 0, otherPct: 0, maxAbsoluteDriftPct: 0, sectors: {} },
    performanceMetrics: {},
    drawdownMetrics: { currentDrawdownPct: 0, maximumDrawdownPct: 0 },
    riskFindings: [reason],
    policyFindings: [],
    unresolvedItems: [],
    policyCompliant: false,
    outcome,
    recommendationExplanation: reason,
    dailyReviewId: null,
    createdProposalId: null,
    errorDetails: status === "failed" ? reason : null,
    refreshReason: null
  };
}

function cycleBindValues(cycle: DailyManagementCycle): unknown[] {
  return [
    cycle.id,
    cycle.portfolioId,
    cycle.cycleDate,
    cycle.triggerSource,
    cycle.status,
    cycle.startedAt,
    cycle.completedAt,
    cycle.dataTimestamp,
    cycle.marketDataSnapshotId,
    cycle.marketDataStatus,
    JSON.stringify(cycle.providerSummary),
    cycle.portfolioValueUsd,
    cycle.investedValueUsd,
    cycle.cashUsd,
    cycle.dailyChangeUsd,
    cycle.dailyChangePct,
    cycle.returnSinceStartUsd,
    cycle.returnSinceStartPct,
    cycle.unrealizedGainLossUsd,
    cycle.unrealizedGainLossPct,
    JSON.stringify(cycle.currentAllocation),
    JSON.stringify(cycle.targetAllocation),
    JSON.stringify(cycle.allocationDrift),
    JSON.stringify(cycle.performanceMetrics),
    JSON.stringify(cycle.drawdownMetrics),
    JSON.stringify(cycle.riskFindings),
    JSON.stringify(cycle.policyFindings),
    JSON.stringify(cycle.unresolvedItems),
    cycle.policyCompliant ? 1 : 0,
    cycle.outcome,
    cycle.recommendationExplanation,
    cycle.dailyReviewId,
    cycle.createdProposalId,
    cycle.errorDetails,
    cycle.refreshReason
  ];
}

function mapCycleRow(row: CycleRow): DailyManagementCycle {
  return {
    id: row.id,
    portfolioId: row.portfolio_id,
    cycleDate: row.cycle_date,
    triggerSource: row.trigger_source,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    dataTimestamp: row.data_timestamp,
    marketDataSnapshotId: row.market_data_snapshot_id,
    marketDataStatus: row.market_data_status,
    providerSummary: parseJson(row.provider_summary_json, []),
    portfolioValueUsd: row.portfolio_value_usd,
    investedValueUsd: row.invested_value_usd,
    cashUsd: row.cash_usd,
    dailyChangeUsd: row.daily_change_usd,
    dailyChangePct: row.daily_change_pct,
    returnSinceStartUsd: row.return_since_start_usd,
    returnSinceStartPct: row.return_since_start_pct,
    unrealizedGainLossUsd: row.unrealized_gain_loss_usd,
    unrealizedGainLossPct: row.unrealized_gain_loss_pct,
    currentAllocation: parseJson(row.current_allocation_json, DEFAULT_DAILY_MANAGEMENT_CONFIG.targetAllocation),
    targetAllocation: parseJson(row.target_allocation_json, DEFAULT_DAILY_MANAGEMENT_CONFIG.targetAllocation),
    allocationDrift: parseJson(row.allocation_drift_json, { cashPct: 0, equityPct: 0, bondPct: 0, otherPct: 0, maxAbsoluteDriftPct: 0, sectors: {} }),
    performanceMetrics: parseJson(row.performance_metrics_json, {}),
    drawdownMetrics: parseJson(row.drawdown_metrics_json, { currentDrawdownPct: 0, maximumDrawdownPct: 0 }),
    riskFindings: parseJson(row.risk_findings_json, []),
    policyFindings: parseJson(row.policy_findings_json, []),
    unresolvedItems: parseJson(row.unresolved_items_json, []),
    policyCompliant: row.policy_compliant === 1,
    outcome: row.outcome,
    recommendationExplanation: row.recommendation_explanation,
    dailyReviewId: row.daily_review_id,
    createdProposalId: row.created_proposal_id,
    errorDetails: row.error_details,
    refreshReason: row.refresh_reason
  };
}

function sectorFor(position: Pick<PositionRow, "assetClass" | "symbol">): string {
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

function id(prefix: string, key: string): string {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(16)}`;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
