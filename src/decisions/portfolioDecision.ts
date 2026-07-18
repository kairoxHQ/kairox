import { BenchmarkComparisonService, type BenchmarkComparisonSummary } from "../benchmarks/comparison.ts";
import { recordJourneyEvent } from "../journey/service.ts";
import { getInvestmentPolicy, type InvestmentPolicy } from "../policies/investmentPolicy.ts";
import { RecommendationProposalService } from "../recommendations/proposalService.ts";
import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";
import { formatPercent } from "../shared/displayFormat.ts";
import { roundMoney, roundRatio } from "../shared/money.ts";

export type PortfolioDecisionRecommendation =
  | "Hold"
  | "Add to existing position"
  | "Reduce existing position"
  | "Rebalance"
  | "Increase cash"
  | "Deploy excess cash"
  | "Review required"
  | "Risk intervention"
  | "Data unavailable";

export type PortfolioDecisionStatus =
  | "Draft"
  | "Ready for review"
  | "Accepted for proposal"
  | "Rejected"
  | "Superseded"
  | "Expired"
  | "No action"
  | "Blocked by data"
  | "Blocked by policy";

export type PortfolioDecisionUrgency = "Low" | "Normal" | "Elevated" | "High" | "Critical";

export interface PortfolioDecisionRuleConfig {
  id: string;
  riskProfile: string;
  strategyName: string;
  version: number;
  minimumAllocationDriftPct: number;
  rebalanceDriftThresholdPct: number;
  deployCashExcessPct: number;
  defensiveDrawdownPct: number;
  criticalDrawdownPct: number;
  minimumTradeValueUsd: number;
  minimumExpectedImprovementPct: number;
  cooldownDaysAfterExecution: number;
  maximumMonthlyTurnoverPct: number;
  maximumQuarterlyRebalances: number;
  minimumConfidence: number;
  stalePriceMs: number;
  expirationHours: number;
  rules: Record<string, unknown>;
}

export interface PortfolioDecisionAction {
  actionType: PortfolioDecisionRecommendation;
  symbolOrCategory: string;
  currentAllocationPct: number | null;
  targetAllocationPct: number | null;
  suggestedDirection: "increase" | "decrease" | "hold" | "review";
  suggestedDollarRange: { minUsd: number; maxUsd: number };
  maximumPermittedAmountUsd: number;
  reason: string;
  expectedEffectOnAllocation: string;
  expectedEffectOnCash: string;
  expectedEffectOnRisk: string;
  policyValidation: { allowed: boolean; reasons: string[] };
  priority: number;
}

export interface PortfolioDecision {
  id: string;
  portfolioId: string;
  sourceCycleId: string;
  sourceCycleVersionHash: string;
  evaluationDate: string;
  primaryRecommendation: PortfolioDecisionRecommendation;
  status: PortfolioDecisionStatus;
  confidenceScore: number;
  urgency: PortfolioDecisionUrgency;
  summary: string;
  detailedExplanation: string;
  supportingFacts: string[];
  triggeredRules: string[];
  suppressedRules: string[];
  policyCompliance: { compliant: boolean; reasons: string[] };
  currentAllocation: AllocationShape;
  targetAllocation: AllocationShape;
  allocationDrift: AllocationDrift;
  actions: PortfolioDecisionAction[];
  cashLevel: { cashUsd: number; cashPct: number; minimumCashPct: number; targetCashPct: number };
  drawdown: { currentDrawdownPct: number; maximumDrawdownPct: number; policyMaxDrawdownPct: number };
  riskScore: number;
  benchmarkContext: DecisionBenchmarkContext;
  inputSnapshot: Record<string, unknown>;
  dataTimestamp: string | null;
  dataQualityStatus: string;
  createdAt: string;
  expiresAt: string;
  userResponse: string | null;
  userResponseReason: string | null;
  respondedAt: string | null;
  resultingProposalId: string | null;
  supersedingDecisionId: string | null;
}

export interface DecisionBenchmarkContext {
  evidenceLabel: string;
  days: number;
  kairoxValueUsd: number | null;
  bestReturnBenchmark: string | null;
  lowestDrawdownBenchmark: string | null;
  summary: string;
}

export interface PortfolioDecisionResult {
  decision: PortfolioDecision;
  idempotent: boolean;
  proposalCreated: boolean;
  proposalId: string | null;
}

interface CycleRow {
  id: string;
  portfolioId: string;
  cycleDate: string;
  status: string;
  completedAt: string | null;
  dataTimestamp: string | null;
  marketDataSnapshotId: string | null;
  marketDataStatus: "fresh" | "stale" | "unavailable";
  portfolioValueUsd: number;
  investedValueUsd: number;
  cashUsd: number;
  currentAllocationJson: string;
  targetAllocationJson: string;
  allocationDriftJson: string;
  drawdownMetricsJson: string;
  riskFindingsJson: string;
  policyFindingsJson: string;
  unresolvedItemsJson: string;
  policyCompliant: number;
  outcome: string;
  recommendationExplanation: string;
  dailyReviewId: string | null;
  refreshReason: string | null;
  updatedAt: string;
}

interface ConfigRow {
  id: string;
  riskProfile: string;
  strategyName: string;
  version: number;
  minimumAllocationDriftPct: number;
  rebalanceDriftThresholdPct: number;
  deployCashExcessPct: number;
  defensiveDrawdownPct: number;
  criticalDrawdownPct: number;
  minimumTradeValueUsd: number;
  minimumExpectedImprovementPct: number;
  cooldownDaysAfterExecution: number;
  maximumMonthlyTurnoverPct: number;
  maximumQuarterlyRebalances: number;
  minimumConfidence: number;
  stalePriceMs: number;
  expirationHours: number;
  rulesJson: string;
}

interface DecisionRow {
  id: string;
  portfolioId: string;
  sourceCycleId: string;
  sourceCycleVersionHash: string;
  evaluationDate: string;
  primaryRecommendation: PortfolioDecisionRecommendation;
  status: PortfolioDecisionStatus;
  confidenceScore: number;
  urgency: PortfolioDecisionUrgency;
  summary: string;
  detailedExplanation: string;
  supportingFactsJson: string;
  triggeredRulesJson: string;
  suppressedRulesJson: string;
  policyComplianceJson: string;
  currentAllocationJson: string;
  targetAllocationJson: string;
  allocationDriftJson: string;
  actionsJson: string;
  cashLevelJson: string;
  drawdownJson: string;
  riskScore: number;
  benchmarkContextJson: string;
  inputSnapshotJson: string;
  dataTimestamp: string | null;
  dataQualityStatus: string;
  createdAt: string;
  expiresAt: string;
  userResponse: string | null;
  userResponseReason: string | null;
  respondedAt: string | null;
  resultingProposalId: string | null;
  supersedingDecisionId: string | null;
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

export interface AllocationDrift {
  cashPct: number;
  equityPct: number;
  bondPct: number;
  otherPct: number;
  maxAbsoluteDriftPct: number;
  sectors: Record<string, number>;
}

const ACTIONABLE_RECOMMENDATIONS = new Set<PortfolioDecisionRecommendation>(["Rebalance", "Deploy excess cash", "Increase cash", "Add to existing position", "Reduce existing position"]);
const ACTIVE_DECISION_STATUSES: PortfolioDecisionStatus[] = ["Draft", "Ready for review", "No action", "Blocked by data", "Blocked by policy"];
const DECISION_SELECT = `SELECT id, portfolio_id AS portfolioId, source_cycle_id AS sourceCycleId,
  source_cycle_version_hash AS sourceCycleVersionHash, evaluation_date AS evaluationDate,
  primary_recommendation AS primaryRecommendation, status, confidence_score AS confidenceScore,
  urgency, summary, detailed_explanation AS detailedExplanation,
  supporting_facts_json AS supportingFactsJson, triggered_rules_json AS triggeredRulesJson,
  suppressed_rules_json AS suppressedRulesJson, policy_compliance_json AS policyComplianceJson,
  current_allocation_json AS currentAllocationJson, target_allocation_json AS targetAllocationJson,
  allocation_drift_json AS allocationDriftJson, actions_json AS actionsJson,
  cash_level_json AS cashLevelJson, drawdown_json AS drawdownJson, risk_score AS riskScore,
  benchmark_context_json AS benchmarkContextJson, input_snapshot_json AS inputSnapshotJson,
  data_timestamp AS dataTimestamp, data_quality_status AS dataQualityStatus,
  created_at AS createdAt, expires_at AS expiresAt, user_response AS userResponse,
  user_response_reason AS userResponseReason, responded_at AS respondedAt,
  resulting_proposal_id AS resultingProposalId, superseding_decision_id AS supersedingDecisionId
  FROM portfolio_decisions`;

export class PortfolioDecisionService {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async evaluate(portfolioId = TIM_PORTFOLIO_ID, now = new Date()): Promise<PortfolioDecisionResult> {
    const cycle = await this.latestCompletedCycle(portfolioId);
    if (!cycle) {
      throw new Error("No completed daily management cycle is available for portfolio decision evaluation.");
    }
    return this.evaluateCycle(cycle.id, now);
  }

  async evaluateCycle(cycleId: string, now = new Date()): Promise<PortfolioDecisionResult> {
    const cycle = await this.getCycle(cycleId);
    if (!cycle || cycle.status !== "completed") {
      throw new Error("Completed daily management cycle not found.");
    }
    const existing = await this.getByCycleVersion(cycle.portfolioId, cycle.id, cycleVersionHash(cycle));
    if (existing) {
      return { decision: existing, idempotent: true, proposalCreated: false, proposalId: existing.resultingProposalId };
    }
    const [policy, config, benchmarkSummary, cooldown] = await Promise.all([
      getInvestmentPolicy(this.db, cycle.portfolioId),
      this.getConfig(cycle.portfolioId),
      new BenchmarkComparisonService(this.db).summary(cycle.portfolioId),
      this.executionCooldown(cycle.portfolioId, now)
    ]);
    const decision = buildPortfolioDecision({
      cycle,
      policy,
      config,
      benchmarkSummary,
      cooldownActive: cooldown.active,
      now
    });
    await this.supersedeActive(cycle.portfolioId, decision.id, now);
    await this.insertDecision(decision);
    await this.recordEvent(decision.id, decision.portfolioId, "decision_created", "Portfolio decision generated.", { primaryRecommendation: decision.primaryRecommendation, confidenceScore: decision.confidenceScore }, now);
    await this.recordMeaningfulJourney(decision, now);
    return { decision, idempotent: false, proposalCreated: false, proposalId: null };
  }

  async latest(portfolioId = TIM_PORTFOLIO_ID): Promise<PortfolioDecision | null> {
    await this.expireOutdated(portfolioId, new Date());
    const row = await this.db.prepare(`${DECISION_SELECT} WHERE portfolio_id = ? ORDER BY created_at DESC LIMIT 1`).bind(portfolioId).first<DecisionRow>();
    return row ? mapDecisionRow(row) : null;
  }

  async list(portfolioId = TIM_PORTFOLIO_ID, limit = 20): Promise<PortfolioDecision[]> {
    await this.expireOutdated(portfolioId, new Date());
    const rows = await listRows<DecisionRow>(
      this.db.prepare(`${DECISION_SELECT} WHERE portfolio_id = ? ORDER BY created_at DESC LIMIT ?`).bind(portfolioId, limit)
    );
    return rows.map(mapDecisionRow);
  }

  async get(decisionId: string): Promise<PortfolioDecision | null> {
    const row = await this.db.prepare(`${DECISION_SELECT} WHERE id = ?`).bind(decisionId).first<DecisionRow>();
    return row ? mapDecisionRow(row) : null;
  }

  async acceptForProposal(decisionId: string, reason = "Accepted for proposal.", now = new Date()): Promise<PortfolioDecisionResult> {
    const decision = await this.get(decisionId);
    if (!decision) {
      throw new Error("Portfolio decision not found.");
    }
    if (decision.resultingProposalId) {
      return { decision, idempotent: true, proposalCreated: false, proposalId: decision.resultingProposalId };
    }
    if (!ACTIONABLE_RECOMMENDATIONS.has(decision.primaryRecommendation)) {
      const updated = await this.updateStatus(decision, "No action", "Acceptance did not create a proposal because the recommendation is not actionable.", now);
      return { decision: updated, idempotent: false, proposalCreated: false, proposalId: null };
    }
    const reviewId = typeof decision.inputSnapshot.dailyReviewId === "string" ? decision.inputSnapshot.dailyReviewId : null;
    if (!reviewId) {
      const updated = await this.updateStatus(decision, "Blocked by policy", "No source daily review is available for proposal generation.", now);
      return { decision: updated, idempotent: false, proposalCreated: false, proposalId: null };
    }
    const result = await new RecommendationProposalService(this.db).createDraftFromReview(reviewId, { now });
    const proposalId = result.proposal?.id ?? null;
    const updated = await this.updateStatus(decision, "Accepted for proposal", reason, now, proposalId);
    await this.recordEvent(updated.id, updated.portfolioId, "accepted_for_proposal", "Portfolio decision accepted for proposal.", { proposalId, noAction: result.noAction, reason: result.reason }, now);
    await recordJourneyEvent(this.db, {
      portfolioId: updated.portfolioId,
      eventType: "manual_intervention",
      timestamp: now.toISOString(),
      title: "Portfolio decision accepted for proposal",
      description: updated.summary,
      accountValueUsd: typeof updated.inputSnapshot.portfolioValueUsd === "number" ? updated.inputSnapshot.portfolioValueUsd : null,
      cashValueUsd: updated.cashLevel.cashUsd,
      source: "manual",
      severity: "info",
      strategyVersion: "portfolio-decision-v1",
      metadata: { decisionId: updated.id, resultingProposalId: proposalId, paperOnly: true }
    });
    return { decision: updated, idempotent: result.idempotent, proposalCreated: Boolean(proposalId) && !result.idempotent, proposalId };
  }

  async reject(decisionId: string, reason = "Rejected by reviewer.", now = new Date()): Promise<PortfolioDecision> {
    const decision = await requiredDecision(this, decisionId);
    const updated = await this.updateStatus(decision, "Rejected", reason, now);
    await this.recordEvent(updated.id, updated.portfolioId, "decision_rejected", "Portfolio decision rejected.", { reason }, now);
    return updated;
  }

  async defer(decisionId: string, reason = "Deferred by reviewer.", now = new Date()): Promise<PortfolioDecision> {
    const decision = await requiredDecision(this, decisionId);
    const updated = await this.updateStatus(decision, "Ready for review", reason, now);
    await this.recordEvent(updated.id, updated.portfolioId, "decision_deferred", "Portfolio decision deferred.", { reason }, now);
    return updated;
  }

  async markReviewed(decisionId: string, reason = "Reviewed by reviewer.", now = new Date()): Promise<PortfolioDecision> {
    const decision = await requiredDecision(this, decisionId);
    const status: PortfolioDecisionStatus = decision.primaryRecommendation === "Hold" ? "No action" : "Ready for review";
    const updated = await this.updateStatus(decision, status, reason, now);
    await this.recordEvent(updated.id, updated.portfolioId, "decision_reviewed", "Portfolio decision marked reviewed.", { reason }, now);
    return updated;
  }

  private async latestCompletedCycle(portfolioId: string): Promise<CycleRow | null> {
    return this.db.prepare(
      `SELECT id, portfolio_id AS portfolioId, cycle_date AS cycleDate, status,
        completed_at AS completedAt, data_timestamp AS dataTimestamp,
        market_data_snapshot_id AS marketDataSnapshotId, market_data_status AS marketDataStatus,
        portfolio_value_usd AS portfolioValueUsd, invested_value_usd AS investedValueUsd,
        cash_usd AS cashUsd, current_allocation_json AS currentAllocationJson,
        target_allocation_json AS targetAllocationJson, allocation_drift_json AS allocationDriftJson,
        drawdown_metrics_json AS drawdownMetricsJson, risk_findings_json AS riskFindingsJson,
        policy_findings_json AS policyFindingsJson, unresolved_items_json AS unresolvedItemsJson,
        policy_compliant AS policyCompliant, outcome, recommendation_explanation AS recommendationExplanation,
        daily_review_id AS dailyReviewId, refresh_reason AS refreshReason, updated_at AS updatedAt
       FROM daily_management_cycles
       WHERE portfolio_id = ? AND status = 'completed'
       ORDER BY cycle_date DESC, updated_at DESC
       LIMIT 1`
    ).bind(portfolioId).first<CycleRow>();
  }

  private async getCycle(cycleId: string): Promise<CycleRow | null> {
    return this.db.prepare(
      `SELECT id, portfolio_id AS portfolioId, cycle_date AS cycleDate, status,
        completed_at AS completedAt, data_timestamp AS dataTimestamp,
        market_data_snapshot_id AS marketDataSnapshotId, market_data_status AS marketDataStatus,
        portfolio_value_usd AS portfolioValueUsd, invested_value_usd AS investedValueUsd,
        cash_usd AS cashUsd, current_allocation_json AS currentAllocationJson,
        target_allocation_json AS targetAllocationJson, allocation_drift_json AS allocationDriftJson,
        drawdown_metrics_json AS drawdownMetricsJson, risk_findings_json AS riskFindingsJson,
        policy_findings_json AS policyFindingsJson, unresolved_items_json AS unresolvedItemsJson,
        policy_compliant AS policyCompliant, outcome, recommendation_explanation AS recommendationExplanation,
        daily_review_id AS dailyReviewId, refresh_reason AS refreshReason, updated_at AS updatedAt
       FROM daily_management_cycles
       WHERE id = ?
       LIMIT 1`
    ).bind(cycleId).first<CycleRow>();
  }

  private async getByCycleVersion(portfolioId: string, cycleId: string, versionHash: string): Promise<PortfolioDecision | null> {
    const row = await this.db.prepare(`${DECISION_SELECT} WHERE portfolio_id = ? AND source_cycle_id = ? AND source_cycle_version_hash = ? LIMIT 1`).bind(portfolioId, cycleId, versionHash).first<DecisionRow>();
    return row ? mapDecisionRow(row) : null;
  }

  private async getConfig(portfolioId: string): Promise<PortfolioDecisionRuleConfig> {
    const policy = await getInvestmentPolicy(this.db, portfolioId);
    const row = await this.db.prepare(
      `SELECT id, risk_profile AS riskProfile, strategy_name AS strategyName, version,
        minimum_allocation_drift_pct AS minimumAllocationDriftPct,
        rebalance_drift_threshold_pct AS rebalanceDriftThresholdPct,
        deploy_cash_excess_pct AS deployCashExcessPct,
        defensive_drawdown_pct AS defensiveDrawdownPct,
        critical_drawdown_pct AS criticalDrawdownPct,
        minimum_trade_value_usd AS minimumTradeValueUsd,
        minimum_expected_improvement_pct AS minimumExpectedImprovementPct,
        cooldown_days_after_execution AS cooldownDaysAfterExecution,
        maximum_monthly_turnover_pct AS maximumMonthlyTurnoverPct,
        maximum_quarterly_rebalances AS maximumQuarterlyRebalances,
        minimum_confidence AS minimumConfidence,
        stale_price_ms AS stalePriceMs,
        expiration_hours AS expirationHours,
        rules_json AS rulesJson
       FROM portfolio_decision_rule_configs
       WHERE risk_profile = ? AND status = 'active'
       ORDER BY version DESC
       LIMIT 1`
    ).bind(policy?.riskProfile ?? "Conservative").first<ConfigRow>();
    return row ? mapConfigRow(row) : defaultConfig(policy);
  }

  private async executionCooldown(portfolioId: string, now: Date): Promise<{ active: boolean; daysSinceExecution: number | null }> {
    const row = await this.db.prepare(
      "SELECT MAX(filled_at) AS lastFilledAt FROM paper_order_fills WHERE portfolio_id = ?"
    ).bind(portfolioId).first<{ lastFilledAt: string | null }>();
    if (!row?.lastFilledAt) {
      return { active: false, daysSinceExecution: null };
    }
    const days = Math.floor((now.getTime() - new Date(row.lastFilledAt).getTime()) / 86400000);
    const config = await this.getConfig(portfolioId);
    return { active: Number.isFinite(days) && days >= 0 && days < config.cooldownDaysAfterExecution, daysSinceExecution: Number.isFinite(days) ? days : null };
  }

  private async supersedeActive(portfolioId: string, newDecisionId: string, now: Date): Promise<void> {
    const placeholders = ACTIVE_DECISION_STATUSES.map(() => "?").join(", ");
    await this.db.prepare(`UPDATE portfolio_decisions SET status = 'Superseded', superseding_decision_id = ?, responded_at = ? WHERE portfolio_id = ? AND id <> ? AND status IN (${placeholders})`)
      .bind(newDecisionId, now.toISOString(), portfolioId, newDecisionId, ...ACTIVE_DECISION_STATUSES)
      .run();
  }

  private async expireOutdated(portfolioId: string, now: Date): Promise<void> {
    await this.db.prepare("UPDATE portfolio_decisions SET status = 'Expired', responded_at = ? WHERE portfolio_id = ? AND status IN ('Draft', 'Ready for review') AND expires_at < ?")
      .bind(now.toISOString(), portfolioId, now.toISOString()).run();
  }

  private async insertDecision(decision: PortfolioDecision): Promise<void> {
    await this.db.prepare(
      `INSERT INTO portfolio_decisions (
        id, portfolio_id, source_cycle_id, source_cycle_version_hash, evaluation_date,
        primary_recommendation, status, confidence_score, urgency, summary,
        detailed_explanation, supporting_facts_json, triggered_rules_json,
        suppressed_rules_json, policy_compliance_json, current_allocation_json,
        target_allocation_json, allocation_drift_json, actions_json, cash_level_json,
        drawdown_json, risk_score, benchmark_context_json, input_snapshot_json,
        data_timestamp, data_quality_status, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      decision.id,
      decision.portfolioId,
      decision.sourceCycleId,
      decision.sourceCycleVersionHash,
      decision.evaluationDate,
      decision.primaryRecommendation,
      decision.status,
      decision.confidenceScore,
      decision.urgency,
      decision.summary,
      decision.detailedExplanation,
      JSON.stringify(decision.supportingFacts),
      JSON.stringify(decision.triggeredRules),
      JSON.stringify(decision.suppressedRules),
      JSON.stringify(decision.policyCompliance),
      JSON.stringify(decision.currentAllocation),
      JSON.stringify(decision.targetAllocation),
      JSON.stringify(decision.allocationDrift),
      JSON.stringify(decision.actions),
      JSON.stringify(decision.cashLevel),
      JSON.stringify(decision.drawdown),
      decision.riskScore,
      JSON.stringify(decision.benchmarkContext),
      JSON.stringify(decision.inputSnapshot),
      decision.dataTimestamp,
      decision.dataQualityStatus,
      decision.createdAt,
      decision.expiresAt
    ).run();
  }

  private async updateStatus(decision: PortfolioDecision, status: PortfolioDecisionStatus, reason: string, now: Date, proposalId: string | null = decision.resultingProposalId): Promise<PortfolioDecision> {
    await this.db.prepare(
      `UPDATE portfolio_decisions
       SET status = ?, user_response = ?, user_response_reason = ?, responded_at = ?, resulting_proposal_id = COALESCE(?, resulting_proposal_id)
       WHERE id = ?`
    ).bind(status, status, reason, now.toISOString(), proposalId, decision.id).run();
    return (await this.get(decision.id)) as PortfolioDecision;
  }

  private async recordEvent(decisionId: string | null, portfolioId: string, eventType: string, message: string, details: Record<string, unknown>, now: Date): Promise<void> {
    await this.db.prepare(
      `INSERT OR IGNORE INTO portfolio_decision_events (
        id, decision_id, portfolio_id, event_type, message, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id("portfolio_decision_event", `${portfolioId}:${decisionId ?? "none"}:${eventType}:${now.toISOString()}`), decisionId, portfolioId, eventType, message, JSON.stringify(details), now.toISOString()).run();
  }

  private async recordMeaningfulJourney(decision: PortfolioDecision, now: Date): Promise<void> {
    if (decision.primaryRecommendation === "Hold") {
      const priorHold = await this.db.prepare("SELECT id FROM portfolio_decisions WHERE portfolio_id = ? AND primary_recommendation = 'Hold' AND id <> ? LIMIT 1").bind(decision.portfolioId, decision.id).first<{ id: string }>();
      if (priorHold) return;
    }
    if (decision.primaryRecommendation === "Review required" || decision.primaryRecommendation === "Data unavailable") {
      return;
    }
    await recordJourneyEvent(this.db, {
      portfolioId: decision.portfolioId,
      eventType: decision.primaryRecommendation === "Risk intervention" ? "risk_limit_reached" : "manual_intervention",
      timestamp: now.toISOString(),
      title: `Portfolio decision: ${decision.primaryRecommendation}`,
      description: decision.summary,
      accountValueUsd: typeof decision.inputSnapshot.portfolioValueUsd === "number" ? decision.inputSnapshot.portfolioValueUsd : null,
      cashValueUsd: decision.cashLevel.cashUsd,
      source: "strategy",
      severity: decision.urgency === "Critical" || decision.urgency === "High" ? "warning" : "info",
      strategyVersion: "portfolio-decision-v1",
      metadata: { decisionId: decision.id, sourceCycleId: decision.sourceCycleId, paperOnly: true }
    });
  }
}

export function buildPortfolioDecision(input: {
  cycle: CycleRow;
  policy: InvestmentPolicy | null;
  config: PortfolioDecisionRuleConfig;
  benchmarkSummary: BenchmarkComparisonSummary;
  cooldownActive: boolean;
  now: Date;
}): PortfolioDecision {
  const currentAllocation = parseJson<AllocationShape>(input.cycle.currentAllocationJson, emptyAllocation());
  const targetAllocation = parseJson<AllocationShape>(input.cycle.targetAllocationJson, emptyAllocation());
  const allocationDrift = parseJson<AllocationDrift>(input.cycle.allocationDriftJson, emptyDrift());
  const drawdown = parseJson<{ currentDrawdownPct: number; maximumDrawdownPct: number }>(input.cycle.drawdownMetricsJson, { currentDrawdownPct: 0, maximumDrawdownPct: 0 });
  const riskFindings = parseJson<string[]>(input.cycle.riskFindingsJson, []);
  const policyFindings = parseJson<string[]>(input.cycle.policyFindingsJson, []);
  const unresolvedItems = parseJson<string[]>(input.cycle.unresolvedItemsJson, []);
  const benchmarkContext = benchmarkContextFor(input.benchmarkSummary);
  const rules = evaluateDecisionRules({
    currentAllocation,
    targetAllocation,
    allocationDrift,
    drawdown,
    riskFindings,
    policyFindings,
    unresolvedItems,
    cycle: input.cycle,
    policy: input.policy,
    config: input.config,
    cooldownActive: input.cooldownActive,
    benchmarkContext
  });
  const confidenceScore = confidenceFor({
    cycle: input.cycle,
    config: input.config,
    allocationDrift,
    drawdown,
    policy: input.policy,
    benchmarkSummary: input.benchmarkSummary,
    triggeredRules: rules.triggeredRules,
    suppressedRules: rules.suppressedRules
  });
  const status = initialStatusFor(rules.primaryRecommendation, confidenceScore, input.config);
  const expiresAt = new Date(input.now.getTime() + input.config.expirationHours * 60 * 60 * 1000).toISOString();
  const inputSnapshot = {
    sourceCycleId: input.cycle.id,
    cycleDate: input.cycle.cycleDate,
    dailyReviewId: input.cycle.dailyReviewId,
    portfolioValueUsd: input.cycle.portfolioValueUsd,
    investedValueUsd: input.cycle.investedValueUsd,
    cashUsd: input.cycle.cashUsd,
    marketDataSnapshotId: input.cycle.marketDataSnapshotId,
    policyId: input.policy?.id ?? null,
    ruleConfigId: input.config.id,
    benchmarkEvidence: input.benchmarkSummary.evidence.label,
    noTradingMutation: true
  };
  return {
    id: `portfolio_decision_${input.cycle.portfolioId}_${input.cycle.cycleDate}_${cycleVersionHash(input.cycle).slice(0, 12)}`,
    portfolioId: input.cycle.portfolioId,
    sourceCycleId: input.cycle.id,
    sourceCycleVersionHash: cycleVersionHash(input.cycle),
    evaluationDate: input.cycle.cycleDate,
    primaryRecommendation: rules.primaryRecommendation,
    status,
    confidenceScore,
    urgency: urgencyFor(rules.primaryRecommendation, drawdown, allocationDrift),
    summary: summaryFor(rules.primaryRecommendation, rules.triggeredRules, confidenceScore),
    detailedExplanation: explanationFor(rules.primaryRecommendation, rules.triggeredRules, rules.suppressedRules, input.cycle, benchmarkContext),
    supportingFacts: supportingFactsFor(input.cycle, currentAllocation, targetAllocation, drawdown, benchmarkContext),
    triggeredRules: rules.triggeredRules,
    suppressedRules: rules.suppressedRules,
    policyCompliance: { compliant: policyFindings.length === 0 && input.cycle.policyCompliant === 1, reasons: policyFindings },
    currentAllocation,
    targetAllocation,
    allocationDrift,
    actions: rules.actions,
    cashLevel: { cashUsd: input.cycle.cashUsd, cashPct: currentAllocation.cashPct, minimumCashPct: input.policy?.minCashAllocationPct ?? 0, targetCashPct: targetAllocation.cashPct },
    drawdown: { currentDrawdownPct: drawdown.currentDrawdownPct, maximumDrawdownPct: drawdown.maximumDrawdownPct, policyMaxDrawdownPct: input.policy?.maxDrawdownPct ?? input.config.criticalDrawdownPct },
    riskScore: roundRatio(Math.min(1, Math.max(drawdown.currentDrawdownPct / Math.max(input.policy?.maxDrawdownPct ?? input.config.criticalDrawdownPct, 0.0001), allocationDrift.maxAbsoluteDriftPct))),
    benchmarkContext,
    inputSnapshot,
    dataTimestamp: input.cycle.dataTimestamp,
    dataQualityStatus: input.cycle.marketDataStatus,
    createdAt: input.now.toISOString(),
    expiresAt,
    userResponse: null,
    userResponseReason: null,
    respondedAt: null,
    resultingProposalId: null,
    supersedingDecisionId: null
  };
}

function evaluateDecisionRules(input: {
  currentAllocation: AllocationShape;
  targetAllocation: AllocationShape;
  allocationDrift: AllocationDrift;
  drawdown: { currentDrawdownPct: number; maximumDrawdownPct: number };
  riskFindings: string[];
  policyFindings: string[];
  unresolvedItems: string[];
  cycle: CycleRow;
  policy: InvestmentPolicy | null;
  config: PortfolioDecisionRuleConfig;
  cooldownActive: boolean;
  benchmarkContext: DecisionBenchmarkContext;
}): { primaryRecommendation: PortfolioDecisionRecommendation; triggeredRules: string[]; suppressedRules: string[]; actions: PortfolioDecisionAction[] } {
  const triggeredRules: string[] = [];
  const suppressedRules: string[] = [];
  const actions: PortfolioDecisionAction[] = [];
  const portfolioValue = input.cycle.portfolioValueUsd > 0 ? input.cycle.portfolioValueUsd : 1;

  if (input.cycle.marketDataStatus !== "fresh") {
    triggeredRules.push("Pricing is stale or unavailable.");
    return { primaryRecommendation: "Data unavailable", triggeredRules, suppressedRules, actions };
  }
  if (!input.policy) {
    triggeredRules.push("No active investment policy is configured.");
    return { primaryRecommendation: "Review required", triggeredRules, suppressedRules, actions };
  }
  if (input.policyFindings.length > 0 && (input.drawdown.currentDrawdownPct >= input.config.criticalDrawdownPct || /below the policy minimum|exceeds/i.test(input.policyFindings.join(" ")))) {
    triggeredRules.push(...input.policyFindings, "Policy compliance has priority over return optimization.");
    actions.push(action("Risk intervention", "Portfolio", null, null, "review", 0, 0, "Policy violation requires review before any new exposure.", "Stops policy drift from being ignored.", "Preserves cash and exposure until reviewed.", "Reduces policy risk.", false, input.policyFindings, 1));
    return { primaryRecommendation: "Risk intervention", triggeredRules, suppressedRules, actions };
  }
  if (input.drawdown.currentDrawdownPct >= input.config.defensiveDrawdownPct) {
    triggeredRules.push("Current drawdown reached the defensive threshold.");
    actions.push(action("Increase cash", "Portfolio", input.currentAllocation.cashPct, input.targetAllocation.cashPct, "increase", input.config.minimumTradeValueUsd, roundMoney(portfolioValue * 0.1), "Conservative risk control calls for reviewing exposure during deeper drawdowns.", "May increase cash allocation.", "Would preserve or increase cash.", "May lower downside risk.", true, [], 1));
    return { primaryRecommendation: "Increase cash", triggeredRules, suppressedRules, actions };
  }
  if (input.unresolvedItems.length > 0) {
    triggeredRules.push("An unresolved proposal or paper-order batch already exists.");
    suppressedRules.push("Actionable rebalance suppressed to avoid duplicate workflow state.");
    return { primaryRecommendation: "Review required", triggeredRules, suppressedRules, actions };
  }
  if (input.cooldownActive) {
    triggeredRules.push("Recent paper execution is inside the configured cooldown period.");
    suppressedRules.push("Anti-churn rule suppresses new trade recommendations after recent execution.");
    return { primaryRecommendation: "Review required", triggeredRules, suppressedRules, actions };
  }
  if (input.currentAllocation.cashPct - input.targetAllocation.cashPct > input.config.deployCashExcessPct) {
    const maxDeployable = Math.max(0, input.cycle.cashUsd - portfolioValue * input.policy.minCashAllocationPct);
    triggeredRules.push("Cash exceeds the configured target range.");
    if (maxDeployable >= input.config.minimumTradeValueUsd) {
      actions.push(action("Deploy excess cash", "Cash reserve", input.currentAllocation.cashPct, input.targetAllocation.cashPct, "decrease", input.config.minimumTradeValueUsd, maxDeployable, "Cash is above the conservative target range and can be reviewed for deployment.", "Would move allocation closer to target.", "Would reduce excess cash while preserving the mandatory reserve.", "Can improve allocation discipline without chasing recent benchmark returns.", true, [], 1));
      return { primaryRecommendation: "Deploy excess cash", triggeredRules, suppressedRules, actions };
    }
    suppressedRules.push("Excess cash amount is below the configured minimum trade value.");
  }
  if (input.allocationDrift.maxAbsoluteDriftPct >= input.config.rebalanceDriftThresholdPct) {
    triggeredRules.push("Allocation drift exceeds the rebalance threshold.");
    const range = roundMoney(portfolioValue * input.allocationDrift.maxAbsoluteDriftPct);
    if (range >= input.config.minimumTradeValueUsd) {
      actions.push(action("Rebalance", "Portfolio allocation", null, null, "review", input.config.minimumTradeValueUsd, range, "Portfolio allocation is materially outside the configured target range.", "Would reduce category drift.", "Would preserve the cash reserve before any proposal is approved.", "May reduce concentration and allocation risk.", true, [], 1));
      return { primaryRecommendation: "Rebalance", triggeredRules, suppressedRules, actions };
    }
    suppressedRules.push("Allocation drift is material but expected trade value is below the minimum trade threshold.");
  }
  if (input.allocationDrift.maxAbsoluteDriftPct >= input.config.minimumAllocationDriftPct || input.riskFindings.length > 0) {
    triggeredRules.push(...input.riskFindings, "Allocation is outside the hold band but not yet actionable.");
    return { primaryRecommendation: "Review required", triggeredRules: [...new Set(triggeredRules)], suppressedRules, actions };
  }
  triggeredRules.push("No policy violation, material drift, stale data, or urgent risk event is present.");
  suppressedRules.push("Benchmark context is informational and did not force a trade.");
  return { primaryRecommendation: "Hold", triggeredRules, suppressedRules, actions };
}

function confidenceFor(input: {
  cycle: CycleRow;
  config: PortfolioDecisionRuleConfig;
  allocationDrift: AllocationDrift;
  drawdown: { currentDrawdownPct: number; maximumDrawdownPct: number };
  policy: InvestmentPolicy | null;
  benchmarkSummary: BenchmarkComparisonSummary;
  triggeredRules: string[];
  suppressedRules: string[];
}): number {
  let score = 0.55;
  if (input.cycle.marketDataStatus === "fresh") score += 0.15;
  if (input.cycle.dataTimestamp) score += 0.08;
  if (input.policy) score += 0.08;
  if (input.allocationDrift.maxAbsoluteDriftPct >= input.config.minimumAllocationDriftPct) score += 0.04;
  if (input.drawdown.currentDrawdownPct >= input.config.defensiveDrawdownPct) score += 0.05;
  if (input.benchmarkSummary.evidence.label !== "Preliminary") score += 0.04;
  if (input.triggeredRules.length > 0 && input.suppressedRules.length === 0) score += 0.03;
  if (input.cycle.marketDataStatus !== "fresh") score -= 0.2;
  return roundRatio(Math.max(0.1, Math.min(0.95, score)));
}

function initialStatusFor(recommendation: PortfolioDecisionRecommendation, confidence: number, config: PortfolioDecisionRuleConfig): PortfolioDecisionStatus {
  if (recommendation === "Data unavailable") return "Blocked by data";
  if (recommendation === "Risk intervention") return "Blocked by policy";
  if (recommendation === "Hold") return "No action";
  if (confidence < config.minimumConfidence) return "Ready for review";
  return "Draft";
}

function urgencyFor(recommendation: PortfolioDecisionRecommendation, drawdown: { currentDrawdownPct: number }, drift: AllocationDrift): PortfolioDecisionUrgency {
  if (recommendation === "Risk intervention") return "Critical";
  if (recommendation === "Increase cash") return "High";
  if (recommendation === "Rebalance" || drift.maxAbsoluteDriftPct > 0.08) return "Elevated";
  if (recommendation === "Review required" || recommendation === "Data unavailable") return "Normal";
  if (drawdown.currentDrawdownPct > 0.05) return "Elevated";
  return "Low";
}

function action(actionType: PortfolioDecisionRecommendation, symbolOrCategory: string, currentAllocationPct: number | null, targetAllocationPct: number | null, suggestedDirection: PortfolioDecisionAction["suggestedDirection"], minUsd: number, maxUsd: number, reason: string, expectedEffectOnAllocation: string, expectedEffectOnCash: string, expectedEffectOnRisk: string, allowed: boolean, reasons: string[], priority: number): PortfolioDecisionAction {
  return {
    actionType,
    symbolOrCategory,
    currentAllocationPct,
    targetAllocationPct,
    suggestedDirection,
    suggestedDollarRange: { minUsd: roundMoney(minUsd), maxUsd: roundMoney(maxUsd) },
    maximumPermittedAmountUsd: roundMoney(maxUsd),
    reason,
    expectedEffectOnAllocation,
    expectedEffectOnCash,
    expectedEffectOnRisk,
    policyValidation: { allowed, reasons },
    priority
  };
}

function benchmarkContextFor(summary: BenchmarkComparisonSummary): DecisionBenchmarkContext {
  const available = summary.benchmarks.filter((item) => item.currentValueUsd !== null);
  const bestReturn = [...available].sort((a, b) => (b.returnPct ?? -Infinity) - (a.returnPct ?? -Infinity))[0];
  const lowestDrawdown = [...available].sort((a, b) => (a.maximumDrawdownPct ?? Infinity) - (b.maximumDrawdownPct ?? Infinity))[0];
  const kairox = summary.benchmarks.find((item) => item.benchmarkKey === "kairox_actual");
  return {
    evidenceLabel: summary.evidence.label,
    days: summary.evidence.days,
    kairoxValueUsd: kairox?.currentValueUsd ?? null,
    bestReturnBenchmark: bestReturn?.benchmarkName ?? null,
    lowestDrawdownBenchmark: lowestDrawdown?.benchmarkName ?? null,
    summary: summary.proofSummary
  };
}

function summaryFor(recommendation: PortfolioDecisionRecommendation, triggeredRules: string[], confidence: number): string {
  const rule = triggeredRules[0] ?? "No material rule was triggered.";
  return `${recommendation}: ${rule} Confidence reflects data quality and rule agreement, not a profit prediction (${Math.round(confidence * 100)}%).`;
}

function explanationFor(recommendation: PortfolioDecisionRecommendation, triggeredRules: string[], suppressedRules: string[], cycle: CycleRow, benchmarkContext: DecisionBenchmarkContext): string {
  return [
    `Kairox recommends ${recommendation} for this paper portfolio based on the completed daily management cycle from ${cycle.cycleDate}.`,
    `Primary evidence: ${triggeredRules.join(" ")}`,
    suppressedRules.length ? `Suppressed rules: ${suppressedRules.join(" ")}` : "No actionable rule was suppressed except benchmark chasing, which is intentionally informational only.",
    `Benchmark context: ${benchmarkContext.summary}`,
    "If no action is taken, the portfolio remains unchanged and no paper trade workflow is advanced."
  ].join(" ");
}

function supportingFactsFor(cycle: CycleRow, current: AllocationShape, target: AllocationShape, drawdown: { currentDrawdownPct: number; maximumDrawdownPct: number }, benchmarkContext: DecisionBenchmarkContext): string[] {
  return [
    `Cash is ${formatPct(current.cashPct)} versus target ${formatPct(target.cashPct)}.`,
    `Equity is ${formatPct(current.equityPct)} and bonds are ${formatPct(current.bondPct)}.`,
    `Current drawdown is ${formatPct(drawdown.currentDrawdownPct)}; maximum drawdown is ${formatPct(drawdown.maximumDrawdownPct)}.`,
    `Market data status is ${cycle.marketDataStatus}.`,
    `Benchmark evidence is ${benchmarkContext.evidenceLabel} over ${benchmarkContext.days} valuation day(s).`
  ];
}

function cycleVersionHash(cycle: CycleRow): string {
  return hashText(JSON.stringify({
    id: cycle.id,
    completedAt: cycle.completedAt,
    dataTimestamp: cycle.dataTimestamp,
    updatedAt: cycle.updatedAt,
    refreshReason: cycle.refreshReason,
    currentAllocationJson: cycle.currentAllocationJson,
    targetAllocationJson: cycle.targetAllocationJson,
    allocationDriftJson: cycle.allocationDriftJson,
    policyFindingsJson: cycle.policyFindingsJson,
    riskFindingsJson: cycle.riskFindingsJson,
    unresolvedItemsJson: cycle.unresolvedItemsJson
  }));
}

function mapDecisionRow(row: DecisionRow): PortfolioDecision {
  return {
    id: row.id,
    portfolioId: row.portfolioId,
    sourceCycleId: row.sourceCycleId,
    sourceCycleVersionHash: row.sourceCycleVersionHash,
    evaluationDate: row.evaluationDate,
    primaryRecommendation: row.primaryRecommendation,
    status: row.status,
    confidenceScore: row.confidenceScore,
    urgency: row.urgency,
    summary: row.summary,
    detailedExplanation: row.detailedExplanation,
    supportingFacts: parseJson(row.supportingFactsJson, []),
    triggeredRules: parseJson(row.triggeredRulesJson, []),
    suppressedRules: parseJson(row.suppressedRulesJson, []),
    policyCompliance: parseJson(row.policyComplianceJson, { compliant: false, reasons: [] }),
    currentAllocation: parseJson(row.currentAllocationJson, emptyAllocation()),
    targetAllocation: parseJson(row.targetAllocationJson, emptyAllocation()),
    allocationDrift: parseJson(row.allocationDriftJson, emptyDrift()),
    actions: parseJson(row.actionsJson, []),
    cashLevel: parseJson(row.cashLevelJson, { cashUsd: 0, cashPct: 0, minimumCashPct: 0, targetCashPct: 0 }),
    drawdown: parseJson(row.drawdownJson, { currentDrawdownPct: 0, maximumDrawdownPct: 0, policyMaxDrawdownPct: 0 }),
    riskScore: row.riskScore,
    benchmarkContext: parseJson(row.benchmarkContextJson, { evidenceLabel: "Preliminary", days: 0, kairoxValueUsd: null, bestReturnBenchmark: null, lowestDrawdownBenchmark: null, summary: "" }),
    inputSnapshot: parseJson(row.inputSnapshotJson, {}),
    dataTimestamp: row.dataTimestamp,
    dataQualityStatus: row.dataQualityStatus,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    userResponse: row.userResponse,
    userResponseReason: row.userResponseReason,
    respondedAt: row.respondedAt,
    resultingProposalId: row.resultingProposalId,
    supersedingDecisionId: row.supersedingDecisionId
  };
}

function mapConfigRow(row: ConfigRow): PortfolioDecisionRuleConfig {
  return {
    id: row.id,
    riskProfile: row.riskProfile,
    strategyName: row.strategyName,
    version: row.version,
    minimumAllocationDriftPct: row.minimumAllocationDriftPct,
    rebalanceDriftThresholdPct: row.rebalanceDriftThresholdPct,
    deployCashExcessPct: row.deployCashExcessPct,
    defensiveDrawdownPct: row.defensiveDrawdownPct,
    criticalDrawdownPct: row.criticalDrawdownPct,
    minimumTradeValueUsd: row.minimumTradeValueUsd,
    minimumExpectedImprovementPct: row.minimumExpectedImprovementPct,
    cooldownDaysAfterExecution: row.cooldownDaysAfterExecution,
    maximumMonthlyTurnoverPct: row.maximumMonthlyTurnoverPct,
    maximumQuarterlyRebalances: row.maximumQuarterlyRebalances,
    minimumConfidence: row.minimumConfidence,
    stalePriceMs: row.stalePriceMs,
    expirationHours: row.expirationHours,
    rules: parseJson(row.rulesJson, {})
  };
}

function defaultConfig(policy: InvestmentPolicy | null): PortfolioDecisionRuleConfig {
  return {
    id: "portfolio_decision_default_conservative",
    riskProfile: policy?.riskProfile ?? "Conservative",
    strategyName: "Conservative Retirement",
    version: 1,
    minimumAllocationDriftPct: 0.03,
    rebalanceDriftThresholdPct: 0.08,
    deployCashExcessPct: 0.08,
    defensiveDrawdownPct: 0.07,
    criticalDrawdownPct: policy?.maxDrawdownPct ?? 0.1,
    minimumTradeValueUsd: 25,
    minimumExpectedImprovementPct: 0.02,
    cooldownDaysAfterExecution: 7,
    maximumMonthlyTurnoverPct: 0.2,
    maximumQuarterlyRebalances: 2,
    minimumConfidence: 0.65,
    stalePriceMs: 36 * 60 * 60 * 1000,
    expirationHours: 24,
    rules: {}
  };
}

function emptyAllocation(): AllocationShape {
  return { cashPct: 0, equityPct: 0, bondPct: 0, otherPct: 0, largestPositionPct: 0, largestSectorPct: 0, sectors: {} };
}

function emptyDrift(): AllocationDrift {
  return { cashPct: 0, equityPct: 0, bondPct: 0, otherPct: 0, maxAbsoluteDriftPct: 0, sectors: {} };
}

async function requiredDecision(service: PortfolioDecisionService, decisionId: string): Promise<PortfolioDecision> {
  const decision = await service.get(decisionId);
  if (!decision) throw new Error("Portfolio decision not found.");
  return decision;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function id(prefix: string, key: string): string {
  return `${prefix}_${hashText(key)}`;
}

function formatPct(value: number): string {
  return formatPercent(value);
}
