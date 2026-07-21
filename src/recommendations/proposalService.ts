import { getInvestmentPolicy, validateInvestmentPolicy, type InvestmentPolicy } from "../policies/investmentPolicy.ts";
import { recordJourneyEvent } from "../journey/service.ts";
import { listRows } from "../shared/db.ts";
import { addMoney, roundMoney, roundRatio, subtractMoney } from "../shared/money.ts";
import type { AssetClass } from "../shared/types.ts";
import { MarketDataService } from "../market/service.ts";
import { StrategyEngine, type StrategyRun, type StrategyDecision } from "../strategy/engine.ts";
import { assertPortfolioAllowsTradingActions } from "../portfolio/accountTypes.ts";

export type ReviewProposalStatus =
  | "Draft"
  | "Ready for Review"
  | "Approved"
  | "Rejected"
  | "Expired"
  | "Superseded"
  | "Orders Staged"
  | "Executed"
  | "No Actionable Proposal";

export type ProposalDecisionResult =
  | { proposal: RecommendationProposal; noAction: false; idempotent: boolean; reason: null }
  | { proposal: RecommendationProposal | null; noAction: true; idempotent: boolean; reason: string };

export interface RecommendationProposalConfig {
  minimumAllocationDriftPct: number;
  minimumTradeValueUsd: number;
  minimumExpectedImprovementPct: number;
  maximumTurnoverPct: number;
  priceDeviationPct: number;
  proposalExpirationHours: number;
  stalePriceMs: number;
}

export interface RecommendationProposal {
  id: string;
  portfolioId: string;
  sourceDailyReviewId: string;
  reviewMarketDate: string;
  version: number;
  status: ReviewProposalStatus;
  recommendationType: string;
  triggeredRules: string[];
  currentAllocation: AllocationShape;
  targetAllocation: AllocationShape;
  expectedAllocation: AllocationShape;
  proposedBuys: ProposalTradeLine[];
  proposedSells: ProposalTradeLine[];
  estimatedTradeAmountUsd: number;
  estimatedRemainingCashUsd: number;
  policyValidation: { compliant: boolean; reasons: string[]; warnings: string[] };
  riskScoreBefore: number;
  riskScoreAfter: number;
  diversificationScoreBefore: number;
  diversificationScoreAfter: number;
  estimatedTurnoverPct: number;
  rationale: string;
  confidenceScore: number;
  marketDataTimestamp: string | null;
  marketDataSnapshotId: string | null;
  strategyRunId: string | null;
  generatedAt: string;
  expiresAt: string;
  regenerationReason: string | null;
  noActionReason: string | null;
  lines: ProposalTradeLine[];
}

export interface ProposalTradeLine {
  side: "Buy" | "Sell";
  symbol: string;
  securityName: string;
  assetClass: AssetClass;
  assetCategory: string;
  estimatedQuantity: number;
  estimatedAmountUsd: number;
  referencePriceUsd: number;
  marketDataTimestamp: string;
  reason: string;
  confidenceScore: number;
  policyValidation: { allowed: boolean; reasons: string[] };
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

interface DailyReviewRow {
  id: string;
  portfolioId: string;
  marketDate: string;
  status: string;
  recommendation: string;
  triggeredRulesJson: string;
  allocationJson: string;
  policyWarningsJson: string;
  dataFreshnessStatus: string;
  confidenceScore: number;
  riskScore: number;
  diversificationScore: number;
  marketDataTimestamp: string | null;
  relevantMetricsJson: string;
  summaryExplanation: string;
  strategyRunId: string | null;
}

interface PortfolioRow {
  id: string;
  mode: string;
  cashUsd: number;
  totalAccountValueUsd: number;
}

interface PositionRow {
  symbol: string;
  securityName: string | null;
  assetClass: AssetClass;
  quantity: number;
  currentPriceUsd: number;
  marketValueUsd: number;
}

interface PriceRow {
  symbol: string;
  priceUsd: number;
  priceTimestamp: string;
  createdAt: string;
}

interface ProposalRow {
  id: string;
  portfolioId: string;
  sourceDailyReviewId: string;
  reviewMarketDate: string;
  version: number;
  status: ReviewProposalStatus;
  recommendationType: string;
  triggeredRulesJson: string;
  currentAllocationJson: string;
  targetAllocationJson: string;
  expectedAllocationJson: string;
  proposedBuysJson: string;
  proposedSellsJson: string;
  estimatedTradeAmountUsd: number;
  estimatedRemainingCashUsd: number;
  policyValidationJson: string;
  riskScoreBefore: number;
  riskScoreAfter: number;
  diversificationScoreBefore: number;
  diversificationScoreAfter: number;
  estimatedTurnoverPct: number;
  rationale: string;
  confidenceScore: number;
  marketDataTimestamp: string | null;
  marketDataSnapshotId: string | null;
  strategyRunId: string | null;
  generatedAt: string;
  expiresAt: string;
  regenerationReason: string | null;
  noActionReason: string | null;
}

interface LineRow {
  side: "Buy" | "Sell";
  symbol: string;
  securityName: string;
  assetClass: AssetClass;
  assetCategory: string;
  estimatedQuantity: number;
  estimatedAmountUsd: number;
  referencePriceUsd: number;
  marketDataTimestamp: string;
  reason: string;
  confidenceScore: number;
  policyValidationJson: string;
}

const ELIGIBLE_RECOMMENDATIONS = new Set(["Rebalance Suggested", "Risk Reduction Suggested", "Opportunity Identified"]);
const INELIGIBLE_RECOMMENDATIONS = new Set(["Hold", "Monitor", "Data Incomplete"]);
const ACTIVE_STATUSES = ["Draft", "Ready for Review", "Approved", "Orders Staged"];

export const DEFAULT_RECOMMENDATION_PROPOSAL_CONFIG: RecommendationProposalConfig = {
  minimumAllocationDriftPct: 0.005,
  minimumTradeValueUsd: 0.25,
  minimumExpectedImprovementPct: 0.0001,
  maximumTurnoverPct: 0.15,
  priceDeviationPct: 0.03,
  proposalExpirationHours: 24,
  stalePriceMs: 36 * 60 * 60 * 1000
};

export class RecommendationProposalService {
  private readonly db: D1Database;
  private readonly config: RecommendationProposalConfig;

  constructor(db: D1Database, config = DEFAULT_RECOMMENDATION_PROPOSAL_CONFIG) {
    this.db = db;
    this.config = config;
  }

  async createDraftFromReview(reviewId: string, options: { regenerate?: boolean; reason?: string; now?: Date } = {}): Promise<ProposalDecisionResult> {
    const now = options.now ?? new Date();
    const review = await this.getReview(reviewId);
    if (!review) {
      throw new Error("Daily review not found.");
    }

    await this.recordEvent(null, review.portfolioId, review.id, "draft_proposal_requested", "Draft recommendation proposal requested.", { regenerate: options.regenerate === true }, now);

    const eligibility = validateReviewEligibility(review);
    if (!eligibility.eligible) {
      await this.recordNoAction(review, eligibility.reason, now);
      return { proposal: null, noAction: true, idempotent: false, reason: eligibility.reason };
    }

    const existing = await this.getActiveProposalForReview(review.portfolioId, review.id);
    if (existing && !options.regenerate) {
      return { proposal: existing, noAction: false, idempotent: true, reason: null };
    }
    if (existing && options.regenerate) {
      await this.supersede(existing.id, options.reason ?? "Regenerated from daily review.", now);
      await this.recordEvent(existing.id, review.portfolioId, review.id, "proposal_regenerated", "Recommendation proposal regenerated from daily review.", { previousVersion: existing.version }, now);
    }

    const [portfolio, policy, positions, strategyRun, nextVersion] = await Promise.all([
      this.getPortfolio(review.portfolioId),
      getInvestmentPolicy(this.db, review.portfolioId),
      this.getPositions(review.portfolioId),
      new StrategyEngine(this.db).latest(review.portfolioId),
      this.nextVersion(review.portfolioId, review.id)
    ]);
    if (!portfolio || portfolio.mode !== "paper") {
      throw new Error("Recommendation proposals are restricted to paper portfolios.");
    }
    await assertPortfolioAllowsTradingActions(this.db, review.portfolioId, "create recommendation proposals");
    if (!policy) {
      return this.noAction(review, "No active investment policy is configured for this portfolio.", now);
    }

    const strategyDecisionSymbols = (strategyRun?.dailyReviewId === review.id || strategyRun?.dailyReviewId === null)
      ? strategyRun.finalDecisions.map((decision) => decision.symbol).filter((symbol) => symbol !== "PORTFOLIO")
      : [];
    const marketSnapshot = await new MarketDataService(this.db).createSnapshot([...positions.map((position) => position.symbol), ...strategyDecisionSymbols], "proposal", now);
    const prices = this.getPricesFromSnapshot(marketSnapshot, now);
    const plan = buildRecommendationProposalPlan({
      review,
      portfolio,
      policy,
      positions,
      prices,
      strategyRun: strategyRun?.dailyReviewId === review.id || strategyRun?.dailyReviewId === null ? strategyRun : null,
      version: nextVersion,
      now,
      regenerateReason: options.reason ?? null,
      config: this.config
    });
    plan.proposal.marketDataSnapshotId = marketSnapshot.id;
    plan.proposal.strategyRunId = strategyRun?.id ?? null;

    if (plan.noActionReason) {
      return this.noAction(review, plan.noActionReason, now);
    }

    await this.insertProposal(plan.proposal);
    await this.recordEvent(plan.proposal.id, review.portfolioId, review.id, "proposal_created", "Draft recommendation proposal created.", { version: plan.proposal.version, status: plan.proposal.status }, now);
    await recordJourneyEvent(this.db, {
      portfolioId: review.portfolioId,
      eventType: "manual_intervention",
      timestamp: now.toISOString(),
      title: "Draft rebalance proposal created",
      description: plan.proposal.rationale,
      source: "manual",
      severity: "info",
      strategyVersion: "recommendation-proposal-v1",
      metadata: { sourceDailyReviewId: review.id, proposalId: plan.proposal.id, paperOnly: true }
    });
    return { proposal: plan.proposal, noAction: false, idempotent: false, reason: null };
  }

  async list(portfolioId: string, limit = 10): Promise<RecommendationProposal[]> {
    const rows = await listRows<ProposalRow>(
      this.db.prepare(
        `SELECT id, portfolio_id AS portfolioId, source_daily_review_id AS sourceDailyReviewId,
          review_market_date AS reviewMarketDate, version, status, recommendation_type AS recommendationType,
          triggered_rules_json AS triggeredRulesJson, current_allocation_json AS currentAllocationJson,
          target_allocation_json AS targetAllocationJson, expected_allocation_json AS expectedAllocationJson,
          proposed_buys_json AS proposedBuysJson, proposed_sells_json AS proposedSellsJson,
          estimated_trade_amount_usd AS estimatedTradeAmountUsd,
          estimated_remaining_cash_usd AS estimatedRemainingCashUsd,
          policy_validation_json AS policyValidationJson, risk_score_before AS riskScoreBefore,
          risk_score_after AS riskScoreAfter, diversification_score_before AS diversificationScoreBefore,
          diversification_score_after AS diversificationScoreAfter, estimated_turnover_pct AS estimatedTurnoverPct,
          rationale, confidence_score AS confidenceScore, market_data_timestamp AS marketDataTimestamp,
          market_data_snapshot_id AS marketDataSnapshotId, strategy_run_id AS strategyRunId,
          generated_at AS generatedAt, expires_at AS expiresAt, regeneration_reason AS regenerationReason,
          no_action_reason AS noActionReason
         FROM recommendation_proposals
         WHERE portfolio_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      ).bind(portfolioId, limit)
    );
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  async getById(proposalId: string): Promise<RecommendationProposal | null> {
    const row = await this.getProposalRow(proposalId);
    return row ? this.hydrate(row) : null;
  }

  async markReady(proposalId: string, now = new Date()): Promise<RecommendationProposal> {
    const proposal = await this.requireProposal(proposalId);
    await this.updateStatus(proposal.id, "Ready for Review", null, now);
    await this.recordEvent(proposal.id, proposal.portfolioId, proposal.sourceDailyReviewId, "proposal_marked_ready_for_review", "Recommendation proposal marked Ready for Review.", {}, now);
    return (await this.getById(proposalId)) as RecommendationProposal;
  }

  async reject(proposalId: string, reason = "Rejected by reviewer.", now = new Date()): Promise<RecommendationProposal> {
    const proposal = await this.requireProposal(proposalId);
    await this.updateStatus(proposal.id, "Rejected", reason, now);
    await this.recordEvent(proposal.id, proposal.portfolioId, proposal.sourceDailyReviewId, "proposal_rejected", "Recommendation proposal rejected.", { reason }, now);
    return (await this.getById(proposalId)) as RecommendationProposal;
  }

  async supersede(proposalId: string, reason = "Superseded by reviewer.", now = new Date()): Promise<RecommendationProposal> {
    const proposal = await this.requireProposal(proposalId);
    await this.updateStatus(proposal.id, "Superseded", reason, now);
    await this.recordEvent(proposal.id, proposal.portfolioId, proposal.sourceDailyReviewId, "proposal_superseded", "Recommendation proposal superseded.", { reason }, now);
    return (await this.getById(proposalId)) as RecommendationProposal;
  }

  private async noAction(review: DailyReviewRow, reason: string, now: Date): Promise<ProposalDecisionResult> {
    await this.recordNoAction(review, reason, now);
    return { proposal: null, noAction: true, idempotent: false, reason };
  }

  private async recordNoAction(review: DailyReviewRow, reason: string, now: Date): Promise<void> {
    await this.recordEvent(null, review.portfolioId, review.id, "no_actionable_proposal_found", "No actionable recommendation proposal was created.", { reason }, now);
  }

  private async getReview(reviewId: string): Promise<DailyReviewRow | null> {
    return this.db.prepare(
      `SELECT id, portfolio_id AS portfolioId, market_date AS marketDate, status,
        recommendation, triggered_rules_json AS triggeredRulesJson,
        allocation_json AS allocationJson, policy_warnings_json AS policyWarningsJson,
        data_freshness_status AS dataFreshnessStatus, confidence_score AS confidenceScore,
        risk_score AS riskScore, diversification_score AS diversificationScore,
        market_data_timestamp AS marketDataTimestamp, relevant_metrics_json AS relevantMetricsJson,
        summary_explanation AS summaryExplanation, strategy_run_id AS strategyRunId
       FROM daily_portfolio_reviews
       WHERE id = ?`
    ).bind(reviewId).first<DailyReviewRow>();
  }

  private async getPortfolio(portfolioId: string): Promise<PortfolioRow | null> {
    return this.db.prepare(
      `SELECT p.id, p.mode, p.cash_usd AS cashUsd,
        p.cash_usd + COALESCE(SUM(pos.market_value_usd), 0) AS totalAccountValueUsd
       FROM portfolios p
       LEFT JOIN positions pos ON pos.portfolio_id = p.id AND pos.quantity > 0
       WHERE p.id = ?
       GROUP BY p.id`
    ).bind(portfolioId).first<PortfolioRow>();
  }

  private async getPositions(portfolioId: string): Promise<PositionRow[]> {
    return listRows<PositionRow>(
      this.db.prepare(
        `SELECT p.symbol, a.display_name AS securityName, p.asset_class AS assetClass,
          p.quantity, p.current_price_usd AS currentPriceUsd, p.market_value_usd AS marketValueUsd
         FROM positions p
         LEFT JOIN assets a ON a.symbol = p.symbol
         WHERE p.portfolio_id = ? AND p.quantity > 0
         ORDER BY p.market_value_usd DESC, p.symbol ASC`
      ).bind(portfolioId)
    );
  }

  private getPricesFromSnapshot(snapshot: Awaited<ReturnType<MarketDataService["createSnapshot"]>>, now: Date): Map<string, PriceRow> {
    const rows: PriceRow[] = [];
    for (const [symbol, quote] of snapshot.quotes) {
      if (quote.validation.valid && quote.lastPrice && quote.providerTimestamp && isFresh(quote.providerTimestamp, now, this.config.stalePriceMs)) {
        rows.push({ symbol, priceUsd: quote.lastPrice, priceTimestamp: quote.providerTimestamp, createdAt: quote.receivedTimestamp });
      }
    }
    return new Map(rows.map((row) => [row.symbol, row]));
  }

  private async getActiveProposalForReview(portfolioId: string, reviewId: string): Promise<RecommendationProposal | null> {
    const placeholders = ACTIVE_STATUSES.map(() => "?").join(", ");
    const row = await this.db.prepare(
      `SELECT id, portfolio_id AS portfolioId, source_daily_review_id AS sourceDailyReviewId,
        review_market_date AS reviewMarketDate, version, status, recommendation_type AS recommendationType,
        triggered_rules_json AS triggeredRulesJson, current_allocation_json AS currentAllocationJson,
        target_allocation_json AS targetAllocationJson, expected_allocation_json AS expectedAllocationJson,
        proposed_buys_json AS proposedBuysJson, proposed_sells_json AS proposedSellsJson,
        estimated_trade_amount_usd AS estimatedTradeAmountUsd,
        estimated_remaining_cash_usd AS estimatedRemainingCashUsd,
        policy_validation_json AS policyValidationJson, risk_score_before AS riskScoreBefore,
        risk_score_after AS riskScoreAfter, diversification_score_before AS diversificationScoreBefore,
        diversification_score_after AS diversificationScoreAfter, estimated_turnover_pct AS estimatedTurnoverPct,
        rationale, confidence_score AS confidenceScore, market_data_timestamp AS marketDataTimestamp,
        market_data_snapshot_id AS marketDataSnapshotId, strategy_run_id AS strategyRunId,
        generated_at AS generatedAt, expires_at AS expiresAt, regeneration_reason AS regenerationReason,
        no_action_reason AS noActionReason
       FROM recommendation_proposals
       WHERE portfolio_id = ? AND source_daily_review_id = ? AND status IN (${placeholders})
       ORDER BY version DESC
       LIMIT 1`
    ).bind(portfolioId, reviewId, ...ACTIVE_STATUSES).first<ProposalRow>();
    return row ? this.hydrate(row) : null;
  }

  private async nextVersion(portfolioId: string, reviewId: string): Promise<number> {
    const row = await this.db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS nextVersion FROM recommendation_proposals WHERE portfolio_id = ? AND source_daily_review_id = ?").bind(portfolioId, reviewId).first<{ nextVersion: number }>();
    return row?.nextVersion ?? 1;
  }

  private async insertProposal(proposal: RecommendationProposal): Promise<void> {
    await this.db.prepare(
      `INSERT INTO recommendation_proposals (
        id, portfolio_id, source_daily_review_id, review_market_date, version, status,
        recommendation_type, triggered_rules_json, current_allocation_json,
        target_allocation_json, expected_allocation_json, proposed_buys_json,
        proposed_sells_json, estimated_trade_amount_usd, estimated_remaining_cash_usd,
        policy_validation_json, risk_score_before, risk_score_after,
        diversification_score_before, diversification_score_after, estimated_turnover_pct,
        rationale, confidence_score, market_data_timestamp, market_data_snapshot_id, strategy_run_id, generated_at, expires_at,
        regeneration_reason, no_action_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      proposal.id,
      proposal.portfolioId,
      proposal.sourceDailyReviewId,
      proposal.reviewMarketDate,
      proposal.version,
      proposal.status,
      proposal.recommendationType,
      JSON.stringify(proposal.triggeredRules),
      JSON.stringify(proposal.currentAllocation),
      JSON.stringify(proposal.targetAllocation),
      JSON.stringify(proposal.expectedAllocation),
      JSON.stringify(proposal.proposedBuys),
      JSON.stringify(proposal.proposedSells),
      proposal.estimatedTradeAmountUsd,
      proposal.estimatedRemainingCashUsd,
      JSON.stringify(proposal.policyValidation),
      proposal.riskScoreBefore,
      proposal.riskScoreAfter,
      proposal.diversificationScoreBefore,
      proposal.diversificationScoreAfter,
      proposal.estimatedTurnoverPct,
      proposal.rationale,
      proposal.confidenceScore,
      proposal.marketDataTimestamp,
      proposal.marketDataSnapshotId,
      proposal.strategyRunId,
      proposal.generatedAt,
      proposal.expiresAt,
      proposal.regenerationReason,
      proposal.noActionReason
    ).run();

    for (const [index, line] of proposal.lines.entries()) {
      await this.db.prepare(
        `INSERT INTO recommendation_proposal_lines (
          id, proposal_id, line_order, side, symbol, security_name, asset_class,
          asset_category, estimated_quantity, estimated_amount_usd, reference_price_usd,
          market_data_timestamp, reason, confidence_score, policy_validation_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        `${proposal.id}_line_${index + 1}`,
        proposal.id,
        index + 1,
        line.side,
        line.symbol,
        line.securityName,
        line.assetClass,
        line.assetCategory,
        line.estimatedQuantity,
        line.estimatedAmountUsd,
        line.referencePriceUsd,
        line.marketDataTimestamp,
        line.reason,
        line.confidenceScore,
        JSON.stringify(line.policyValidation)
      ).run();
    }
  }

  private async hydrate(row: ProposalRow): Promise<RecommendationProposal> {
    const lines = await listRows<LineRow>(
      this.db.prepare(
        `SELECT side, symbol, security_name AS securityName, asset_class AS assetClass,
          asset_category AS assetCategory, estimated_quantity AS estimatedQuantity,
          estimated_amount_usd AS estimatedAmountUsd, reference_price_usd AS referencePriceUsd,
          market_data_timestamp AS marketDataTimestamp, reason, confidence_score AS confidenceScore,
          policy_validation_json AS policyValidationJson
         FROM recommendation_proposal_lines
         WHERE proposal_id = ?
         ORDER BY line_order ASC`
      ).bind(row.id)
    );
    const hydratedLines = lines.map((line) => ({
      side: line.side,
      symbol: line.symbol,
      securityName: line.securityName,
      assetClass: line.assetClass,
      assetCategory: line.assetCategory,
      estimatedQuantity: line.estimatedQuantity,
      estimatedAmountUsd: line.estimatedAmountUsd,
      referencePriceUsd: line.referencePriceUsd,
      marketDataTimestamp: line.marketDataTimestamp,
      reason: line.reason,
      confidenceScore: line.confidenceScore,
      policyValidation: parseJson(line.policyValidationJson, { allowed: false, reasons: [] })
    }));
    return {
      id: row.id,
      portfolioId: row.portfolioId,
      sourceDailyReviewId: row.sourceDailyReviewId,
      reviewMarketDate: row.reviewMarketDate,
      version: row.version,
      status: row.status,
      recommendationType: row.recommendationType,
      triggeredRules: parseJson(row.triggeredRulesJson, []),
      currentAllocation: parseJson(row.currentAllocationJson, emptyAllocation()),
      targetAllocation: parseJson(row.targetAllocationJson, emptyAllocation()),
      expectedAllocation: parseJson(row.expectedAllocationJson, emptyAllocation()),
      proposedBuys: parseJson(row.proposedBuysJson, []),
      proposedSells: parseJson(row.proposedSellsJson, []),
      estimatedTradeAmountUsd: row.estimatedTradeAmountUsd,
      estimatedRemainingCashUsd: row.estimatedRemainingCashUsd,
      policyValidation: parseJson(row.policyValidationJson, { compliant: false, reasons: [], warnings: [] }),
      riskScoreBefore: row.riskScoreBefore,
      riskScoreAfter: row.riskScoreAfter,
      diversificationScoreBefore: row.diversificationScoreBefore,
      diversificationScoreAfter: row.diversificationScoreAfter,
      estimatedTurnoverPct: row.estimatedTurnoverPct,
      rationale: row.rationale,
      confidenceScore: row.confidenceScore,
      marketDataTimestamp: row.marketDataTimestamp,
      marketDataSnapshotId: row.marketDataSnapshotId,
      strategyRunId: row.strategyRunId,
      generatedAt: row.generatedAt,
      expiresAt: row.expiresAt,
      regenerationReason: row.regenerationReason,
      noActionReason: row.noActionReason,
      lines: hydratedLines
    };
  }

  private async getProposalRow(proposalId: string): Promise<ProposalRow | null> {
    return this.db.prepare(
      `SELECT id, portfolio_id AS portfolioId, source_daily_review_id AS sourceDailyReviewId,
        review_market_date AS reviewMarketDate, version, status, recommendation_type AS recommendationType,
        triggered_rules_json AS triggeredRulesJson, current_allocation_json AS currentAllocationJson,
        target_allocation_json AS targetAllocationJson, expected_allocation_json AS expectedAllocationJson,
        proposed_buys_json AS proposedBuysJson, proposed_sells_json AS proposedSellsJson,
        estimated_trade_amount_usd AS estimatedTradeAmountUsd,
        estimated_remaining_cash_usd AS estimatedRemainingCashUsd,
        policy_validation_json AS policyValidationJson, risk_score_before AS riskScoreBefore,
        risk_score_after AS riskScoreAfter, diversification_score_before AS diversificationScoreBefore,
        diversification_score_after AS diversificationScoreAfter, estimated_turnover_pct AS estimatedTurnoverPct,
        rationale, confidence_score AS confidenceScore, market_data_timestamp AS marketDataTimestamp,
        market_data_snapshot_id AS marketDataSnapshotId, strategy_run_id AS strategyRunId,
        generated_at AS generatedAt, expires_at AS expiresAt, regeneration_reason AS regenerationReason,
        no_action_reason AS noActionReason
       FROM recommendation_proposals
       WHERE id = ?`
    ).bind(proposalId).first<ProposalRow>();
  }

  private async requireProposal(proposalId: string): Promise<RecommendationProposal> {
    const proposal = await this.getById(proposalId);
    if (!proposal) {
      throw new Error("Recommendation proposal not found.");
    }
    return proposal;
  }

  private async updateStatus(proposalId: string, status: ReviewProposalStatus, reason: string | null, now: Date): Promise<void> {
    await this.db.prepare(
      `UPDATE recommendation_proposals
       SET status = ?, regeneration_reason = COALESCE(?, regeneration_reason), updated_at = datetime('now')
       WHERE id = ?`
    ).bind(status, reason, proposalId).run();
  }

  private async recordEvent(proposalId: string | null, portfolioId: string, reviewId: string | null, eventType: string, message: string, details: Record<string, unknown>, now: Date): Promise<void> {
    await this.db.prepare(
      `INSERT OR IGNORE INTO recommendation_proposal_events (
        id, proposal_id, portfolio_id, source_daily_review_id, event_type, message, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id("recommendation_proposal_event", `${proposalId ?? portfolioId}:${reviewId ?? ""}:${eventType}:${now.toISOString()}`), proposalId, portfolioId, reviewId, eventType, message, JSON.stringify(details), now.toISOString()).run();
  }
}

export function validateReviewEligibility(review: DailyReviewRow): { eligible: boolean; reason: string } {
  if (review.status !== "completed") {
    return { eligible: false, reason: "Daily review is not completed." };
  }
  if (INELIGIBLE_RECOMMENDATIONS.has(review.recommendation)) {
    return { eligible: false, reason: `${review.recommendation} reviews are not eligible for proposal generation.` };
  }
  if (!ELIGIBLE_RECOMMENDATIONS.has(review.recommendation)) {
    return { eligible: false, reason: "Daily review recommendation is not eligible for proposal generation." };
  }
  if (review.dataFreshnessStatus !== "fresh") {
    return { eligible: false, reason: "Required market data is not current." };
  }
  const reasons = parseJson<string[]>(review.policyWarningsJson, []);
  const rules = parseJson<string[]>(review.triggeredRulesJson, []);
  const metrics = parseJson<Record<string, unknown>>(review.relevantMetricsJson, {});
  if (reasons.length === 0 && rules.length === 0) {
    return { eligible: false, reason: "Daily review does not include actionable reasons." };
  }
  if (Object.keys(metrics).length === 0) {
    return { eligible: false, reason: "Daily review does not include supporting metrics." };
  }
  return { eligible: true, reason: "Eligible." };
}

export function buildRecommendationProposalPlan(input: {
  review: DailyReviewRow;
  portfolio: PortfolioRow;
  policy: InvestmentPolicy;
  positions: PositionRow[];
  prices: Map<string, PriceRow>;
  strategyRun?: StrategyRun | null;
  version: number;
  now: Date;
  regenerateReason: string | null;
  config: RecommendationProposalConfig;
}): { proposal: RecommendationProposal; noActionReason: string | null } {
  const currentAllocation = parseJson<AllocationShape>(input.review.allocationJson, emptyAllocation());
  const triggeredRules = parseJson<string[]>(input.review.triggeredRulesJson, []);
  const policyWarnings = parseJson<string[]>(input.review.policyWarningsJson, []);
  const tradeLines: ProposalTradeLine[] = [];
  const reasons: string[] = [];
  const nowIso = input.now.toISOString();
  const positionBySymbol = new Map(input.positions.map((position) => [position.symbol, position]));

  for (const position of input.positions) {
    const price = input.prices.get(position.symbol);
    if (!price) {
      return { proposal: emptyProposal(input, currentAllocation, "Missing or stale market price."), noActionReason: `Missing or stale market price for ${position.symbol}.` };
    }
  }

  const total = input.portfolio.totalAccountValueUsd > 0 ? input.portfolio.totalAccountValueUsd : 1;
  if (input.strategyRun) {
    for (const decision of input.strategyRun.finalDecisions.filter(isActionableStrategyDecision)) {
      const price = input.prices.get(decision.symbol);
      if (!price) {
        return { proposal: emptyProposal(input, currentAllocation, `Missing or stale strategy price for ${decision.symbol}.`), noActionReason: `Missing or stale strategy price for ${decision.symbol}.` };
      }
      const existing = positionBySymbol.get(decision.symbol);
      const amount = Math.abs(decision.estimatedDollarChange);
      if (amount < input.config.minimumTradeValueUsd) {
        continue;
      }
      const side = decision.estimatedDollarChange < 0 || decision.action === "Sell" || decision.action === "Trim" ? "Sell" : "Buy";
      const assetClass = existing?.assetClass ?? assetClassFromStrategyDecision(decision);
      const validation = validateInvestmentPolicy({
        policy: input.policy,
        action: side === "Buy" ? "BUY" : "SELL",
        symbol: decision.symbol,
        assetClass,
        portfolioValueUsd: total,
        cashUsd: input.portfolio.cashUsd,
        currentPositionValueUsd: existing?.marketValueUsd ?? 0,
        proposedTradeValueUsd: side === "Buy" ? amount : 0,
        resultingSectorValueUsd: side === "Buy" ? (existing?.marketValueUsd ?? 0) + amount : Math.max(0, (existing?.marketValueUsd ?? 0) - amount)
      });
      if (!validation.allowed && side === "Buy") {
        reasons.push(...validation.reasons);
        continue;
      }
      tradeLines.push({
        side,
        symbol: decision.symbol,
        securityName: input.strategyRun.securityScores.find((score) => score.symbol === decision.symbol)?.securityName ?? existing?.securityName ?? decision.symbol,
        assetClass,
        assetCategory: input.strategyRun.securityScores.find((score) => score.symbol === decision.symbol)?.assetCategory ?? (existing ? sectorFor(existing) : "Strategy candidate"),
        estimatedQuantity: roundRatio(amount / price.priceUsd),
        estimatedAmountUsd: roundMoney(amount),
        referencePriceUsd: price.priceUsd,
        marketDataTimestamp: price.priceTimestamp,
        reason: `Strategy ${input.strategyRun.strategy.strategyName} ${input.strategyRun.strategy.strategyVersion}: ${decision.explanation}`,
        confidenceScore: decision.confidenceScore,
        policyValidation: validation
      });
    }
  }

  if (!input.strategyRun) {
    const maxPositionValue = total * input.policy.maxSinglePositionPct;
    const overLimit = input.positions.filter((position) => position.marketValueUsd > maxPositionValue).sort((left, right) => right.marketValueUsd - left.marketValueUsd);
    for (const position of overLimit) {
      const price = input.prices.get(position.symbol);
      if (!price) {
        continue;
      }
      const excess = position.marketValueUsd - maxPositionValue;
      const amount = Math.min(position.marketValueUsd, Math.max(input.config.minimumTradeValueUsd, excess + 0.01));
      if (amount < input.config.minimumTradeValueUsd) {
        continue;
      }
      tradeLines.push({
        side: "Sell",
        symbol: position.symbol,
        securityName: position.securityName ?? position.symbol,
        assetClass: position.assetClass,
        assetCategory: sectorFor(position),
        estimatedQuantity: roundRatio(amount / price.priceUsd),
        estimatedAmountUsd: roundMoney(amount),
        referencePriceUsd: price.priceUsd,
        marketDataTimestamp: price.priceTimestamp,
        reason: "Reduce concentration back inside the investment policy single-position limit.",
        confidenceScore: input.review.confidenceScore,
        policyValidation: { allowed: true, reasons: [] }
      });
    }

    const cashExcess = input.portfolio.cashUsd - total * Math.max(input.policy.minCashAllocationPct, currentAllocation.cashPct - input.config.minimumAllocationDriftPct);
    if ((input.review.recommendation === "Rebalance Suggested" || input.review.recommendation === "Opportunity Identified") && cashExcess >= input.config.minimumTradeValueUsd) {
      const candidate = input.positions.find((position) => position.assetClass === "bond_fund") ?? input.positions[0];
      if (candidate) {
        const price = input.prices.get(candidate.symbol);
        if (price) {
          const amount = Math.min(cashExcess, total * input.config.maximumTurnoverPct);
          const validation = validateInvestmentPolicy({
            policy: input.policy,
            action: "BUY",
            symbol: candidate.symbol,
            assetClass: candidate.assetClass,
            portfolioValueUsd: total,
            cashUsd: input.portfolio.cashUsd,
            currentPositionValueUsd: candidate.marketValueUsd,
            proposedTradeValueUsd: amount,
            resultingSectorValueUsd: candidate.marketValueUsd + amount
          });
          if (validation.allowed) {
            tradeLines.push({
              side: "Buy",
              symbol: candidate.symbol,
              securityName: candidate.securityName ?? candidate.symbol,
              assetClass: candidate.assetClass,
              assetCategory: sectorFor(candidate),
              estimatedQuantity: roundRatio(amount / price.priceUsd),
              estimatedAmountUsd: roundMoney(amount),
              referencePriceUsd: price.priceUsd,
              marketDataTimestamp: price.priceTimestamp,
              reason: "Deploy excess cash while preserving the required policy reserve.",
              confidenceScore: Math.max(0.5, input.review.confidenceScore - 0.05),
              policyValidation: validation
            });
          } else {
            reasons.push(...validation.reasons);
          }
        }
      }
    }
  }

  if (tradeLines.length === 0) {
    return { proposal: emptyProposal(input, currentAllocation, "No compliant trade cleared the configured thresholds."), noActionReason: "No compliant trade cleared the configured thresholds." };
  }

  const estimatedTradeAmount = roundMoney(tradeLines.reduce((sum, line) => sum + line.estimatedAmountUsd, 0));
  const turnoverPct = roundRatio(estimatedTradeAmount / total);
  if (turnoverPct > input.config.maximumTurnoverPct) {
    return { proposal: emptyProposal(input, currentAllocation, "Maximum turnover limit would be exceeded."), noActionReason: "Maximum turnover limit would be exceeded." };
  }

  const buys = tradeLines.filter((line) => line.side === "Buy");
  const sells = tradeLines.filter((line) => line.side === "Sell");
  const remainingCash = roundMoney(input.portfolio.cashUsd + sells.reduce((sum, line) => sum + line.estimatedAmountUsd, 0) - buys.reduce((sum, line) => sum + line.estimatedAmountUsd, 0));
  if (remainingCash < total * input.policy.minCashAllocationPct) {
    return { proposal: emptyProposal(input, currentAllocation, "Proposal would violate the required cash reserve."), noActionReason: "Proposal would violate the required cash reserve." };
  }

  const expectedAllocation = expectedAllocationAfter(input.portfolio, input.positions, tradeLines);
  const postWarnings = validatePostTrade(input.policy, expectedAllocation);
  const improvement = Math.max(0, input.review.riskScore - riskScoreAfter(input.review.riskScore, postWarnings.length, tradeLines));
  if (input.review.recommendation !== "Opportunity Identified" && improvement < input.config.minimumExpectedImprovementPct && postWarnings.length >= policyWarnings.length) {
    return { proposal: emptyProposal(input, currentAllocation, "Expected improvement is below the configured threshold."), noActionReason: "Expected improvement is below the configured threshold." };
  }

  const generatedAt = nowIso;
  const expiresAt = new Date(input.now.getTime() + input.config.proposalExpirationHours * 60 * 60 * 1000).toISOString();
  const riskAfter = riskScoreAfter(input.review.riskScore, postWarnings.length, tradeLines);
  const diversificationAfter = roundRatio(Math.min(1, input.review.diversificationScore + (sells.length > 0 ? 0.03 : 0.01)));
  const proposal: RecommendationProposal = {
    id: recommendationProposalId(input.review.portfolioId, input.review.id, input.version, generatedAt),
    portfolioId: input.review.portfolioId,
    sourceDailyReviewId: input.review.id,
    reviewMarketDate: input.review.marketDate,
    version: input.version,
    status: "Draft",
    recommendationType: input.review.recommendation,
    triggeredRules,
    currentAllocation,
    targetAllocation: targetAllocationFor(input.policy),
    expectedAllocation,
    proposedBuys: buys,
    proposedSells: sells,
    estimatedTradeAmountUsd: estimatedTradeAmount,
    estimatedRemainingCashUsd: remainingCash,
    policyValidation: { compliant: postWarnings.length === 0, reasons: postWarnings, warnings: reasons },
    riskScoreBefore: input.review.riskScore,
    riskScoreAfter: riskAfter,
    diversificationScoreBefore: input.review.diversificationScore,
    diversificationScoreAfter: diversificationAfter,
    estimatedTurnoverPct: turnoverPct,
    rationale: `${input.review.recommendation}: ${input.review.summaryExplanation}`,
    confidenceScore: input.review.confidenceScore,
    marketDataTimestamp: latestTimestamp(tradeLines.map((line) => line.marketDataTimestamp)),
    marketDataSnapshotId: null,
    strategyRunId: input.strategyRun?.id ?? null,
    generatedAt,
    expiresAt,
    regenerationReason: input.regenerateReason,
    noActionReason: null,
    lines: tradeLines
  };
  return { proposal, noActionReason: null };
}

function validatePostTrade(policy: InvestmentPolicy, allocation: AllocationShape): string[] {
  const reasons: string[] = [];
  if (allocation.cashPct < policy.minCashAllocationPct) {
    reasons.push("Expected cash allocation is below policy minimum.");
  }
  if (allocation.largestPositionPct > policy.maxSinglePositionPct) {
    reasons.push("Expected largest position remains above policy limit.");
  }
  if (allocation.largestSectorPct > policy.maxSectorAllocationPct) {
    reasons.push("Expected largest sector remains above policy limit.");
  }
  return reasons;
}

function expectedAllocationAfter(portfolio: PortfolioRow, positions: PositionRow[], lines: ProposalTradeLine[]): AllocationShape {
  const values = new Map(positions.map((position) => [position.symbol, position.marketValueUsd]));
  let cash = portfolio.cashUsd;
  for (const line of lines) {
    const current = values.get(line.symbol) ?? 0;
    if (line.side === "Sell") {
      values.set(line.symbol, Math.max(0, current - line.estimatedAmountUsd));
      cash = addMoney(cash, line.estimatedAmountUsd);
    } else {
      values.set(line.symbol, addMoney(current, line.estimatedAmountUsd));
      cash = subtractMoney(cash, line.estimatedAmountUsd);
    }
  }
  const syntheticPositions = positions.map((position) => ({ ...position, marketValueUsd: values.get(position.symbol) ?? position.marketValueUsd }));
  const total = cash + syntheticPositions.reduce((sum, position) => sum + position.marketValueUsd, 0);
  const sectors: Record<string, number> = {};
  for (const position of syntheticPositions) {
    const sector = sectorFor(position);
    sectors[sector] = addMoney(sectors[sector] ?? 0, position.marketValueUsd);
  }
  const equity = syntheticPositions.filter((position) => ["stock", "etf", "reit"].includes(position.assetClass)).reduce((sum, position) => addMoney(sum, position.marketValueUsd), 0);
  const bond = syntheticPositions.filter((position) => ["bond_fund", "money_market"].includes(position.assetClass)).reduce((sum, position) => addMoney(sum, position.marketValueUsd), 0);
  const largestPosition = Math.max(0, ...syntheticPositions.map((position) => position.marketValueUsd));
  const largestSector = Math.max(0, ...Object.values(sectors));
  return {
    cashPct: roundRatio(cash / total),
    equityPct: roundRatio(equity / total),
    bondPct: roundRatio(bond / total),
    otherPct: roundRatio(Math.max(0, total - cash - equity - bond) / total),
    largestPositionPct: roundRatio(largestPosition / total),
    largestSectorPct: roundRatio(largestSector / total),
    sectors: Object.fromEntries(Object.entries(sectors).map(([key, value]) => [key, roundRatio(value / total)]))
  };
}

function targetAllocationFor(policy: InvestmentPolicy): AllocationShape {
  return {
    cashPct: Math.max(policy.minCashAllocationPct, 0.1),
    equityPct: 0.4,
    bondPct: 0.3,
    otherPct: 0,
    largestPositionPct: policy.maxSinglePositionPct,
    largestSectorPct: policy.maxSectorAllocationPct,
    sectors: {}
  };
}

function emptyProposal(input: {
  review: DailyReviewRow;
  portfolio: PortfolioRow;
  policy: InvestmentPolicy;
  version: number;
  now: Date;
  regenerateReason: string | null;
}, allocation: AllocationShape, reason: string): RecommendationProposal {
  const nowIso = input.now.toISOString();
  return {
    id: recommendationProposalId(input.review.portfolioId, input.review.id, input.version, nowIso),
    portfolioId: input.review.portfolioId,
    sourceDailyReviewId: input.review.id,
    reviewMarketDate: input.review.marketDate,
    version: input.version,
    status: "No Actionable Proposal",
    recommendationType: input.review.recommendation,
    triggeredRules: parseJson(input.review.triggeredRulesJson, []),
    currentAllocation: allocation,
    targetAllocation: targetAllocationFor(input.policy),
    expectedAllocation: allocation,
    proposedBuys: [],
    proposedSells: [],
    estimatedTradeAmountUsd: 0,
    estimatedRemainingCashUsd: input.portfolio.cashUsd,
    policyValidation: { compliant: false, reasons: [reason], warnings: [] },
    riskScoreBefore: input.review.riskScore,
    riskScoreAfter: input.review.riskScore,
    diversificationScoreBefore: input.review.diversificationScore,
    diversificationScoreAfter: input.review.diversificationScore,
    estimatedTurnoverPct: 0,
    rationale: reason,
    confidenceScore: input.review.confidenceScore,
    marketDataTimestamp: input.review.marketDataTimestamp,
    marketDataSnapshotId: null,
    strategyRunId: null,
    generatedAt: nowIso,
    expiresAt: new Date(input.now.getTime() + DEFAULT_RECOMMENDATION_PROPOSAL_CONFIG.proposalExpirationHours * 60 * 60 * 1000).toISOString(),
    regenerationReason: input.regenerateReason,
    noActionReason: reason,
    lines: []
  };
}

function sectorFor(position: Pick<PositionRow, "assetClass" | "symbol">): string {
  if (position.assetClass === "bond_fund" || /BND|BOND|TREAS|SHY|IEF|TLT/i.test(position.symbol)) {
    return "Investment-grade bonds";
  }
  if (/SCHD|DIV|LOWV|USMV/i.test(position.symbol)) {
    return "Dividend or low-volatility equity";
  }
  return position.assetClass === "stock" || position.assetClass === "etf" ? "U.S. broad-market equity" : position.assetClass;
}

function isActionableStrategyDecision(decision: StrategyDecision): boolean {
  return ["Buy", "Add", "Trim", "Sell", "Rebalance"].includes(decision.action) && Math.abs(decision.estimatedDollarChange) > 0;
}

function assetClassFromStrategyDecision(decision: StrategyDecision): AssetClass {
  if (/BND|SHY|IEF|TLT|TREAS|BOND/i.test(decision.symbol)) {
    return "bond_fund";
  }
  return "etf";
}

function riskScoreAfter(before: number, postWarningCount: number, lines: ProposalTradeLine[]): number {
  const sellImprovement = lines.some((line) => line.side === "Sell") ? 0.04 : 0.01;
  const penalty = postWarningCount > 0 ? 0.02 : 0;
  return roundRatio(Math.max(0, before - sellImprovement + penalty));
}

function isFresh(timestamp: string, now: Date, maxAgeMs: number): boolean {
  const priceMs = new Date(timestamp).getTime();
  return Number.isFinite(priceMs) && priceMs <= now.getTime() + 5 * 60 * 1000 && now.getTime() - priceMs <= maxAgeMs;
}

function latestTimestamp(values: string[]): string | null {
  return values.length ? values.sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] : null;
}

function recommendationProposalId(portfolioId: string, reviewId: string, version: number, timestamp: string): string {
  return `review_proposal_${portfolioId}_${version}_${hash(`${reviewId}:${timestamp}`)}`.slice(0, 180);
}

function id(prefix: string, key: string): string {
  return `${prefix}_${hash(key)}`;
}

function hash(key: string): string {
  let value = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    value ^= key.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(16);
}

function emptyAllocation(): AllocationShape {
  return { cashPct: 0, equityPct: 0, bondPct: 0, otherPct: 0, largestPositionPct: 0, largestSectorPct: 0, sectors: {} };
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
