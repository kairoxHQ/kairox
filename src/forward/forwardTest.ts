import { MarketDataService, type MarketDataSnapshot } from "../market/service.ts";
import { getInvestmentPolicy } from "../policies/investmentPolicy.ts";
import { getPortfolioValuation } from "../portfolio/valuation.ts";
import { listPortfolioProfiles } from "../portfolio/profiles.ts";
import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";
import { pctChange, roundMoney, roundRatio, subtractMoney } from "../shared/money.ts";
import type { Env } from "../shared/types.ts";

export type ForwardTrackedPortfolioKey =
  | "kairox_managed"
  | "initial_allocation_buy_hold"
  | "cash_baseline"
  | "sp500_benchmark"
  | "conservative_balanced_benchmark";

export type EvidenceStageName =
  | "Initial"
  | "Early Evidence"
  | "Developing Evidence"
  | "Meaningful Forward Test"
  | "Extended Validation";

export interface ForwardTestConfig {
  cashAnnualRate: number;
  horizons: number[];
  evidenceStages: Array<{ name: EvidenceStageName; minTradingDays: number; description: string }>;
}

export interface ForwardTestRunResult {
  programId: string;
  marketDate: string;
  skipped: boolean;
  idempotent: boolean;
  reason: string | null;
  valuations: ForwardValuation[];
  metrics: ForwardMetricsSummary;
}

export interface ForwardValuation {
  id: string;
  programId: string;
  portfolioId: string;
  trackedPortfolioKey: ForwardTrackedPortfolioKey;
  benchmarkVersionId: string | null;
  marketDate: string;
  portfolioValueUsd: number;
  cashValueUsd: number;
  investedValueUsd: number;
  dailyReturn: number | null;
  cumulativeReturn: number;
  drawdown: number;
  highWaterMarkUsd: number;
  contributionsUsd: number;
  withdrawalsUsd: number;
  dividendsUsd: number;
  simulatedFeesUsd: number;
  marketDataSnapshotId: string | null;
  dataQualityStatus: "complete" | "incomplete" | "unavailable";
  assumptions: Record<string, unknown>;
}

export interface ForwardMetricsSummary {
  programId: string;
  evidenceStage: {
    stage: EvidenceStageName;
    daysTested: number;
    description: string;
    confidenceLabel: string;
  };
  portfolios: Record<string, ForwardPortfolioMetrics>;
  decisionQuality: {
    recentMatured: DecisionEvaluation[];
    confidenceCalibration: CalibrationBucket[];
    scoreCalibration: CalibrationBucket[];
    strategyVersions: StrategyVersionEvaluation[];
  };
  operationalReliability: OperationalReliabilityMetrics;
  explanation: string;
  unavailableMetrics: string[];
}

export interface ForwardPortfolioMetrics {
  trackedPortfolioKey: string;
  latestValueUsd: number | null;
  sinceInceptionReturn: number | null;
  totalGainLossUsd: number | null;
  dailyReturn: number | null;
  weeklyReturn: number | null;
  monthlyReturn: number | null;
  ytdReturn: number | null;
  annualizedReturn: number | null;
  incomeReceivedUsd: number;
  volatility: number | null;
  maximumDrawdown: number | null;
  currentDrawdown: number | null;
  downsideDeviation: number | null;
  worstDay: number | null;
  worstWeek: number | null;
  recoveryTimeDays: number | null;
  positiveDayPct: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  calmarRatio: number | null;
  returnToDrawdownRatio: number | null;
  excessReturnVsKairox?: number | null;
  trackingDifference?: number | null;
  trackingError?: number | null;
}

export interface DecisionEvaluation {
  decisionId: string;
  strategyVersionId: string;
  decisionTimestamp: string;
  marketDataSnapshotId: string | null;
  recommendedAction: string;
  symbol: string;
  confidenceScore: number;
  investmentScore: number;
  rationale: string;
  proposalCreated: boolean;
  proposalApproved: boolean;
  tradeExecuted: boolean;
  horizonDays: number;
  evaluationMarketDate: string | null;
  securityReturn: number | null;
  benchmarkReturn: number | null;
  excessReturn: number | null;
  maxFavorableMovement: number | null;
  maxAdverseMovement: number | null;
  riskImproved: boolean | null;
  diversificationImproved: boolean | null;
  policyViolationReduced: boolean | null;
  rationaleStillValid: boolean | null;
  outcomeClassification:
    | "Correct recommendation"
    | "Incorrect recommendation"
    | "Useful risk reduction"
    | "Missed opportunity"
    | "No measurable effect"
    | "Insufficient elapsed time"
    | "Invalidated by missing data";
  dataQualityStatus: "complete" | "incomplete" | "unavailable";
}

export interface CalibrationBucket {
  bucket: string;
  count: number;
  hitRate: number | null;
  averageExcessReturn: number | null;
  riskAdjustedOutcome: number | null;
}

export interface StrategyVersionEvaluation {
  strategyVersionId: string;
  completedDecisions: number;
  executedDecisions: number;
  return: number | null;
  excessReturn: number | null;
  drawdown: number | null;
  volatility: number | null;
  turnover: number;
  hitRate: number | null;
  averageGain: number | null;
  averageLoss: number | null;
  policyViolations: number;
  dataQualityFailures: number;
}

export interface OperationalReliabilityMetrics {
  dailyReviewsCompleted: number;
  dailyReviewsSkipped: number;
  marketDataFailures: number;
  proposalGenerationFailures: number;
  orderValidationFailures: number;
  executionFailures: number;
  duplicateActionsPrevented: number;
  staleDataBlocks: number;
  policyViolationsPrevented: number;
}

interface ProgramRow {
  id: string;
  portfolioId: string;
  strategyName: string;
  strategyVersionId: string | null;
  startDate: string;
  startingCapitalUsd: number;
  status: string;
  evidenceStageConfigJson: string;
}

interface PortfolioRow {
  id: string;
  mode: string;
  cashUsd: number;
  startingBalanceUsd: number;
  createdAt: string;
}

interface DailyReviewRow {
  id: string;
  portfolioId: string;
  marketDate: string;
  status: string;
  portfolioValueUsd: number;
  cashUsd: number;
  marketDataSnapshotId: string | null;
  dataFreshnessStatus: string;
}

interface FillRow {
  symbol: string;
  quantity: number;
  netAmountUsd: number;
  simulatedFeesUsd: number;
  filledAt: string;
}

interface StrategyRunRow {
  id: string;
  portfolioId: string;
  strategyVersionId: string;
  marketDataSnapshotId: string | null;
  finalDecisionsJson: string;
  generatedAt: string;
}

interface ProposalStatusRow {
  strategyRunId: string | null;
  status: string;
}

interface ForwardValuationRow {
  id: string;
  programId: string;
  portfolioId: string;
  trackedPortfolioKey: ForwardTrackedPortfolioKey;
  benchmarkVersionId: string | null;
  marketDate: string;
  portfolioValueUsd: number;
  cashValueUsd: number;
  investedValueUsd: number;
  dailyReturn: number | null;
  cumulativeReturn: number;
  drawdown: number;
  highWaterMarkUsd: number;
  contributionsUsd: number;
  withdrawalsUsd: number;
  dividendsUsd: number;
  simulatedFeesUsd: number;
  marketDataSnapshotId: string | null;
  dataQualityStatus: "complete" | "incomplete" | "unavailable";
  assumptionsJson: string;
}

interface MonthlyReportRow {
  reportJson: string;
}

export const DEFAULT_FORWARD_TEST_CONFIG: ForwardTestConfig = {
  cashAnnualRate: 0.04,
  horizons: [1, 5, 20, 60, 120],
  evidenceStages: [
    { name: "Initial", minTradingDays: 0, description: "Fewer than 20 trading days; results are preliminary." },
    { name: "Early Evidence", minTradingDays: 20, description: "At least 20 trading days; limited confidence." },
    { name: "Developing Evidence", minTradingDays: 60, description: "At least 60 trading days; some conclusions may be drawn." },
    { name: "Meaningful Forward Test", minTradingDays: 120, description: "At least 120 trading days with more meaningful evidence." },
    { name: "Extended Validation", minTradingDays: 252, description: "At least one full market year of forward-test evidence." }
  ]
};

const TRACKED_PORTFOLIOS: Array<{ key: ForwardTrackedPortfolioKey; benchmarkVersionId: string | null }> = [
  { key: "kairox_managed", benchmarkVersionId: null },
  { key: "initial_allocation_buy_hold", benchmarkVersionId: "forward_benchmark_buy_hold_initial_v1" },
  { key: "cash_baseline", benchmarkVersionId: "forward_benchmark_cash_v1" },
  { key: "sp500_benchmark", benchmarkVersionId: "forward_benchmark_sp500_v1" },
  { key: "conservative_balanced_benchmark", benchmarkVersionId: "forward_benchmark_conservative_balanced_v1" }
];

export class ForwardTestService {
  private readonly db: D1Database;
  private readonly config: ForwardTestConfig;

  constructor(db: D1Database, config = DEFAULT_FORWARD_TEST_CONFIG) {
    this.db = db;
    this.config = config;
  }

  async run(portfolioId = "portfolio_ira", triggerSource: "manual" | "scheduled" = "manual", now = new Date()): Promise<ForwardTestRunResult> {
    const [portfolio, policy] = await Promise.all([
      this.getPortfolio(portfolioId),
      getInvestmentPolicy(this.db, portfolioId)
    ]);
    if (!portfolio) {
      throw new Error("Portfolio not found.");
    }
    if (portfolio.mode !== "paper") {
      throw new Error("Forward testing is restricted to paper portfolios.");
    }
    const program = await this.ensureProgram(portfolio, policy?.simulationBeganAt ?? portfolio.createdAt, now);
    const review = await this.latestCompletedDailyReview(portfolioId);
    if (!review) {
      await this.recordRun(program, portfolioId, accountDate(now), triggerSource, "skipped", null, "No completed daily review is available.", null, now);
      return { programId: program.id, marketDate: accountDate(now), skipped: true, idempotent: false, reason: "No completed daily review is available.", valuations: [], metrics: await this.summary(portfolioId) };
    }
    const existing = await this.valuationsForDate(program.id, review.marketDate);
    if (existing.length >= TRACKED_PORTFOLIOS.length) {
      await this.recordRun(program, portfolioId, review.marketDate, triggerSource, "skipped", review.id, "Forward-test valuations already exist for this market date.", review.marketDataSnapshotId, now);
      return { programId: program.id, marketDate: review.marketDate, skipped: true, idempotent: true, reason: "Forward-test valuations already exist for this market date.", valuations: existing, metrics: await this.summary(portfolioId) };
    }

    await this.recordRun(program, portfolioId, review.marketDate, triggerSource, "started", review.id, null, review.marketDataSnapshotId, now);
    try {
      const snapshot = review.marketDataSnapshotId ? await new MarketDataService(this.db).getSnapshot(review.marketDataSnapshotId) : null;
      const previous = await this.previousValuations(program.id, review.marketDate);
      const firstFills = await this.firstAllocationFills(portfolioId);
      const valuations = buildForwardValuations({
        program,
        portfolio,
        review,
        snapshot,
        previous,
        firstFills,
        cashAnnualRate: this.config.cashAnnualRate
      });
      await this.persistValuations(valuations);
      const evaluations = await this.evaluateMaturedDecisions(program, review.marketDate);
      await this.persistDecisionEvaluations(program, evaluations);
      await this.recordRun(program, portfolioId, review.marketDate, triggerSource, "completed", review.id, null, review.marketDataSnapshotId, now);
      return { programId: program.id, marketDate: review.marketDate, skipped: false, idempotent: false, reason: null, valuations, metrics: await this.summary(portfolioId) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown forward-test error.";
      await this.recordRun(program, portfolioId, review.marketDate, triggerSource, "failed", review.id, null, review.marketDataSnapshotId, now, message);
      throw error;
    }
  }

  async summary(portfolioId = "portfolio_ira"): Promise<ForwardMetricsSummary> {
    let program: ProgramRow | null;
    try {
      program = await this.getProgram(portfolioId);
    } catch (error) {
      if (isMissingForwardTable(error)) {
        return emptySummary("forward_tables_missing");
      }
      throw error;
    }
    if (!program) {
      return emptySummary("forward_program_missing");
    }
    const valuations = await this.listValuations(program.id);
    const evaluations = await this.listDecisionEvaluations(program.id);
    const daysTested = new Set(valuations.map((item) => item.marketDate)).size;
    const evidenceStage = evidenceStageFor(daysTested, this.config);
    const byKey = groupBy(valuations, (item) => item.trackedPortfolioKey);
    const portfolioMetrics = Object.fromEntries(
      TRACKED_PORTFOLIOS.map((item) => [item.key, calculatePortfolioMetrics(byKey.get(item.key) ?? [], program.startingCapitalUsd, this.config.cashAnnualRate)])
    );
    const managedReturn = portfolioMetrics.kairox_managed?.sinceInceptionReturn ?? null;
    for (const [key, metrics] of Object.entries(portfolioMetrics)) {
      if (key !== "kairox_managed") {
        metrics.excessReturnVsKairox = managedReturn !== null && metrics.sinceInceptionReturn !== null ? roundRatio(managedReturn - metrics.sinceInceptionReturn) : null;
        metrics.trackingDifference = metrics.excessReturnVsKairox;
        metrics.trackingError = trackingError(byKey.get("kairox_managed") ?? [], byKey.get(key as ForwardTrackedPortfolioKey) ?? []);
      }
    }
    return {
      programId: program.id,
      evidenceStage,
      portfolios: portfolioMetrics,
      decisionQuality: {
        recentMatured: evaluations.filter((item) => item.outcomeClassification !== "Insufficient elapsed time").slice(0, 10),
        confidenceCalibration: calibration(evaluations, "confidence"),
        scoreCalibration: calibration(evaluations, "score"),
        strategyVersions: strategyVersionEvaluation(evaluations, valuations)
      },
      operationalReliability: await this.operationalReliability(portfolioId),
      explanation: explainForwardResults(portfolioMetrics, evidenceStage),
      unavailableMetrics: unavailableMetrics(portfolioMetrics, evidenceStage.daysTested)
    };
  }

  async monthlyReport(portfolioId = "portfolio_ira", reportMonth?: string, reason?: string | null): Promise<unknown> {
    const program = await this.getProgram(portfolioId);
    if (!program) {
      throw new Error("Forward-test program not found.");
    }
    const month = reportMonth ?? new Date().toISOString().slice(0, 7);
    const existing = await this.db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS nextVersion FROM forward_test_monthly_reports WHERE program_id = ? AND report_month = ?").bind(program.id, month).first<{ nextVersion: number }>();
    const version = existing?.nextVersion ?? 1;
    const summary = await this.summary(portfolioId);
    const report = {
      reportMonth: month,
      version,
      paperSimulation: true,
      notLiveBrokeragePerformance: true,
      simulatedFillsAndSlippage: true,
      pastSimulatedPerformanceDisclaimer: "Past simulated performance does not guarantee future results.",
      summary
    };
    await this.db.prepare(
      `INSERT INTO forward_test_monthly_reports (
        id, program_id, portfolio_id, report_month, version, status, report_json,
        evidence_stage, disclaimer, revision_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      `forward_report_${program.id}_${month}_${version}`,
      program.id,
      portfolioId,
      month,
      version,
      version === 1 ? "published" : "revised",
      JSON.stringify(report),
      summary.evidenceStage.stage,
      "Paper simulation. Not live brokerage performance. Simulated fills and slippage. Past simulated performance does not guarantee future results.",
      version === 1 ? null : reason ?? "Recalculated report version."
    ).run();
    return report;
  }

  async monthlyReportPreview(portfolioId = "portfolio_ira", reportMonth?: string): Promise<unknown> {
    let program: ProgramRow | null;
    try {
      program = await this.getProgram(portfolioId);
    } catch (error) {
      if (isMissingForwardTable(error)) {
        program = null;
      } else {
        throw error;
      }
    }
    const month = reportMonth ?? new Date().toISOString().slice(0, 7);
    if (!program) {
      return {
        reportMonth: month,
        version: 0,
        status: "preview",
        paperSimulation: true,
        summary: emptySummary("forward_program_missing")
      };
    }
    const existing = await this.db.prepare(
      `SELECT report_json AS reportJson
       FROM forward_test_monthly_reports
       WHERE program_id = ? AND report_month = ?
       ORDER BY version DESC
       LIMIT 1`
    ).bind(program.id, month).first<MonthlyReportRow>();
    if (existing) {
      return parseJson(existing.reportJson, {});
    }
    return {
      reportMonth: month,
      version: 0,
      status: "preview",
      paperSimulation: true,
      notLiveBrokeragePerformance: true,
      simulatedFillsAndSlippage: true,
      pastSimulatedPerformanceDisclaimer: "Past simulated performance does not guarantee future results.",
      summary: await this.summary(portfolioId)
    };
  }

  private async ensureProgram(portfolio: PortfolioRow, simulationBeganAt: string, now: Date): Promise<ProgramRow> {
    const existing = await this.getProgram(portfolio.id);
    if (existing) {
      return existing;
    }
    const startDate = simulationBeganAt.slice(0, 10);
    const id = `forward_program_${portfolio.id}_conservative_retirement`;
    await this.db.prepare(
      `INSERT OR IGNORE INTO forward_test_programs (
        id, portfolio_id, strategy_name, strategy_version_id, start_date,
        starting_capital_usd, status, evidence_stage_config_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    ).bind(id, portfolio.id, "Conservative Retirement", "strategy_conservative_retirement_v1", startDate, portfolio.startingBalanceUsd, JSON.stringify(this.config.evidenceStages), now.toISOString(), now.toISOString()).run();
    return (await this.getProgram(portfolio.id)) as ProgramRow;
  }

  private async getProgram(portfolioId: string): Promise<ProgramRow | null> {
    return this.db.prepare(
      `SELECT id, portfolio_id AS portfolioId, strategy_name AS strategyName,
        strategy_version_id AS strategyVersionId, start_date AS startDate,
        starting_capital_usd AS startingCapitalUsd, status,
        evidence_stage_config_json AS evidenceStageConfigJson
       FROM forward_test_programs
       WHERE portfolio_id = ? AND status = 'active'
       ORDER BY created_at DESC
       LIMIT 1`
    ).bind(portfolioId).first<ProgramRow>();
  }

  private async getPortfolio(portfolioId: string): Promise<PortfolioRow | null> {
    return this.db.prepare("SELECT id, mode, cash_usd AS cashUsd, starting_balance_usd AS startingBalanceUsd, created_at AS createdAt FROM portfolios WHERE id = ?").bind(portfolioId).first<PortfolioRow>();
  }

  private async latestCompletedDailyReview(portfolioId: string): Promise<DailyReviewRow | null> {
    return this.db.prepare(
      `SELECT id, portfolio_id AS portfolioId, market_date AS marketDate, status,
        portfolio_value_usd AS portfolioValueUsd, cash_usd AS cashUsd,
        market_data_snapshot_id AS marketDataSnapshotId,
        data_freshness_status AS dataFreshnessStatus
       FROM daily_portfolio_reviews
       WHERE portfolio_id = ? AND status = 'completed'
       ORDER BY market_date DESC
       LIMIT 1`
    ).bind(portfolioId).first<DailyReviewRow>();
  }

  private async valuationsForDate(programId: string, marketDate: string): Promise<ForwardValuation[]> {
    const rows = await listRows<ForwardValuationRow>(this.db.prepare("SELECT * FROM forward_test_daily_valuations WHERE program_id = ? AND market_date = ?").bind(programId, marketDate));
    return rows.map(mapValuationRow);
  }

  private async previousValuations(programId: string, marketDate: string): Promise<Map<ForwardTrackedPortfolioKey, ForwardValuation>> {
    const rows = await listRows<ForwardValuationRow>(
      this.db.prepare(
        `SELECT * FROM forward_test_daily_valuations
         WHERE program_id = ? AND market_date < ?
         ORDER BY market_date DESC`
      ).bind(programId, marketDate)
    );
    const previous = new Map<ForwardTrackedPortfolioKey, ForwardValuation>();
    for (const row of rows) {
      if (!previous.has(row.trackedPortfolioKey)) {
        previous.set(row.trackedPortfolioKey, mapValuationRow(row));
      }
    }
    return previous;
  }

  private async listValuations(programId: string): Promise<ForwardValuation[]> {
    const rows = await listRows<ForwardValuationRow>(
      this.db.prepare("SELECT * FROM forward_test_daily_valuations WHERE program_id = ? ORDER BY market_date ASC, tracked_portfolio_key ASC").bind(programId)
    );
    return rows.map(mapValuationRow);
  }

  private async firstAllocationFills(portfolioId: string): Promise<FillRow[]> {
    const firstExecution = await this.db.prepare("SELECT execution_id AS executionId FROM paper_order_fills WHERE portfolio_id = ? ORDER BY filled_at ASC LIMIT 1").bind(portfolioId).first<{ executionId: string }>();
    if (!firstExecution) {
      return [];
    }
    return listRows<FillRow>(
      this.db.prepare(
        `SELECT symbol, quantity, net_amount_usd AS netAmountUsd,
          simulated_fees_usd AS simulatedFeesUsd, filled_at AS filledAt
         FROM paper_order_fills
         WHERE portfolio_id = ? AND execution_id = ?
         ORDER BY filled_at ASC, symbol ASC`
      ).bind(portfolioId, firstExecution.executionId)
    );
  }

  private async persistValuations(valuations: ForwardValuation[]): Promise<void> {
    await this.db.batch(valuations.map((valuation) => this.db.prepare(
      `INSERT OR IGNORE INTO forward_test_daily_valuations (
        id, program_id, portfolio_id, tracked_portfolio_key, benchmark_version_id,
        market_date, portfolio_value_usd, cash_value_usd, invested_value_usd,
        daily_return, cumulative_return, drawdown, high_water_mark_usd,
        contributions_usd, withdrawals_usd, dividends_usd, simulated_fees_usd,
        market_data_snapshot_id, data_quality_status, assumptions_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      valuation.id,
      valuation.programId,
      valuation.portfolioId,
      valuation.trackedPortfolioKey,
      valuation.benchmarkVersionId,
      valuation.marketDate,
      valuation.portfolioValueUsd,
      valuation.cashValueUsd,
      valuation.investedValueUsd,
      valuation.dailyReturn,
      valuation.cumulativeReturn,
      valuation.drawdown,
      valuation.highWaterMarkUsd,
      valuation.contributionsUsd,
      valuation.withdrawalsUsd,
      valuation.dividendsUsd,
      valuation.simulatedFeesUsd,
      valuation.marketDataSnapshotId,
      valuation.dataQualityStatus,
      JSON.stringify(valuation.assumptions)
    )));
  }

  private async evaluateMaturedDecisions(program: ProgramRow, marketDate: string): Promise<DecisionEvaluation[]> {
    const rows = await listRows<StrategyRunRow>(
      this.db.prepare(
        `SELECT id, portfolio_id AS portfolioId, strategy_version_id AS strategyVersionId,
          market_data_snapshot_id AS marketDataSnapshotId, final_decisions_json AS finalDecisionsJson,
          generated_at AS generatedAt
         FROM strategy_decision_runs
         WHERE portfolio_id = ?
         ORDER BY generated_at ASC`
      ).bind(program.portfolioId)
    );
    const proposals = await listRows<ProposalStatusRow>(
      this.db.prepare("SELECT strategy_run_id AS strategyRunId, status FROM recommendation_proposals WHERE portfolio_id = ?").bind(program.portfolioId)
    );
    const proposalByRun = groupBy(proposals, (item) => item.strategyRunId ?? "");
    const evaluations: DecisionEvaluation[] = [];
    for (const row of rows) {
      const decisions = parseJson<Array<Record<string, unknown>>>(row.finalDecisionsJson, []);
      for (const [index, decision] of decisions.entries()) {
        const decisionId = `${row.id}_${index + 1}_${decision.symbol ?? "portfolio"}`;
        for (const horizon of this.config.horizons) {
          const elapsed = tradingDaysBetween(row.generatedAt.slice(0, 10), marketDate);
          const related = proposalByRun.get(row.id) ?? [];
          const proposalCreated = related.length > 0;
          const proposalApproved = related.some((item) => ["Approved", "Orders Staged", "Executed"].includes(item.status));
          const tradeExecuted = related.some((item) => item.status === "Executed");
          const enough = elapsed >= horizon;
          evaluations.push({
            decisionId,
            strategyVersionId: row.strategyVersionId,
            decisionTimestamp: row.generatedAt,
            marketDataSnapshotId: row.marketDataSnapshotId,
            recommendedAction: String(decision.action ?? "No Action"),
            symbol: String(decision.symbol ?? "PORTFOLIO"),
            confidenceScore: Number(decision.confidenceScore ?? 0),
            investmentScore: Number(decision.investmentScore ?? 0),
            rationale: String(decision.explanation ?? ""),
            proposalCreated,
            proposalApproved,
            tradeExecuted,
            horizonDays: horizon,
            evaluationMarketDate: enough ? marketDate : null,
            securityReturn: null,
            benchmarkReturn: null,
            excessReturn: null,
            maxFavorableMovement: null,
            maxAdverseMovement: null,
            riskImproved: null,
            diversificationImproved: null,
            policyViolationReduced: null,
            rationaleStillValid: enough ? true : null,
            outcomeClassification: enough ? "No measurable effect" : "Insufficient elapsed time",
            dataQualityStatus: enough ? "incomplete" : "complete"
          });
        }
      }
    }
    return evaluations;
  }

  private async persistDecisionEvaluations(program: ProgramRow, evaluations: DecisionEvaluation[]): Promise<void> {
    if (evaluations.length === 0) {
      return;
    }
    await this.db.batch(evaluations.map((item) => this.db.prepare(
      `INSERT OR IGNORE INTO forward_test_decision_evaluations (
        id, program_id, portfolio_id, decision_id, strategy_version_id, decision_timestamp,
        market_data_snapshot_id, recommended_action, symbol, confidence_score,
        investment_score, rationale, proposal_created, proposal_approved, trade_executed,
        horizon_days, evaluation_market_date, security_return, benchmark_return,
        excess_return, max_favorable_movement, max_adverse_movement, risk_improved,
        diversification_improved, policy_violation_reduced, rationale_still_valid,
        outcome_classification, data_quality_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      `forward_eval_${hash(`${program.id}:${item.decisionId}:${item.horizonDays}`)}`,
      program.id,
      program.portfolioId,
      item.decisionId,
      item.strategyVersionId,
      item.decisionTimestamp,
      item.marketDataSnapshotId,
      item.recommendedAction,
      item.symbol,
      item.confidenceScore,
      item.investmentScore,
      item.rationale,
      item.proposalCreated ? 1 : 0,
      item.proposalApproved ? 1 : 0,
      item.tradeExecuted ? 1 : 0,
      item.horizonDays,
      item.evaluationMarketDate,
      item.securityReturn,
      item.benchmarkReturn,
      item.excessReturn,
      item.maxFavorableMovement,
      item.maxAdverseMovement,
      nullableBoolean(item.riskImproved),
      nullableBoolean(item.diversificationImproved),
      nullableBoolean(item.policyViolationReduced),
      nullableBoolean(item.rationaleStillValid),
      item.outcomeClassification,
      item.dataQualityStatus
    )));
  }

  private async listDecisionEvaluations(programId: string): Promise<DecisionEvaluation[]> {
    const rows = await listRows<Record<string, unknown>>(
      this.db.prepare("SELECT * FROM forward_test_decision_evaluations WHERE program_id = ? ORDER BY created_at DESC").bind(programId)
    );
    return rows.map((row) => ({
      decisionId: String(row.decision_id),
      strategyVersionId: String(row.strategy_version_id),
      decisionTimestamp: String(row.decision_timestamp),
      marketDataSnapshotId: row.market_data_snapshot_id ? String(row.market_data_snapshot_id) : null,
      recommendedAction: String(row.recommended_action),
      symbol: String(row.symbol),
      confidenceScore: Number(row.confidence_score),
      investmentScore: Number(row.investment_score),
      rationale: String(row.rationale),
      proposalCreated: Number(row.proposal_created) === 1,
      proposalApproved: Number(row.proposal_approved) === 1,
      tradeExecuted: Number(row.trade_executed) === 1,
      horizonDays: Number(row.horizon_days),
      evaluationMarketDate: row.evaluation_market_date ? String(row.evaluation_market_date) : null,
      securityReturn: nullableNumber(row.security_return),
      benchmarkReturn: nullableNumber(row.benchmark_return),
      excessReturn: nullableNumber(row.excess_return),
      maxFavorableMovement: nullableNumber(row.max_favorable_movement),
      maxAdverseMovement: nullableNumber(row.max_adverse_movement),
      riskImproved: nullableBool(row.risk_improved),
      diversificationImproved: nullableBool(row.diversification_improved),
      policyViolationReduced: nullableBool(row.policy_violation_reduced),
      rationaleStillValid: nullableBool(row.rationale_still_valid),
      outcomeClassification: String(row.outcome_classification) as DecisionEvaluation["outcomeClassification"],
      dataQualityStatus: String(row.data_quality_status) as DecisionEvaluation["dataQualityStatus"]
    }));
  }

  private async operationalReliability(portfolioId: string): Promise<OperationalReliabilityMetrics> {
    const row = await this.db.prepare(
      `SELECT
        (SELECT COUNT(*) FROM daily_portfolio_reviews WHERE portfolio_id = ? AND status = 'completed') AS dailyReviewsCompleted,
        (SELECT COUNT(*) FROM daily_review_runs WHERE portfolio_id = ? AND status = 'skipped') AS dailyReviewsSkipped,
        (SELECT COUNT(*) FROM market_data_anomalies) AS marketDataFailures,
        (SELECT COUNT(*) FROM recommendation_proposal_events WHERE portfolio_id = ? AND event_type = 'no_actionable_proposal_found') AS proposalGenerationFailures,
        (SELECT COUNT(*) FROM paper_order_batch_events WHERE portfolio_id = ? AND event_type LIKE '%validation_failed%') AS orderValidationFailures,
        (SELECT COUNT(*) FROM paper_order_executions WHERE portfolio_id = ? AND status = 'Failed') AS executionFailures,
        (SELECT COUNT(*) FROM forward_test_runs WHERE portfolio_id = ? AND status = 'skipped' AND skip_reason LIKE '%already%') AS duplicateActionsPrevented,
        (SELECT COUNT(*) FROM daily_portfolio_reviews WHERE portfolio_id = ? AND data_freshness_status <> 'fresh') AS staleDataBlocks,
        (SELECT COUNT(*) FROM recommendation_proposals WHERE portfolio_id = ? AND policy_validation_json LIKE '%reasons%') AS policyViolationsPrevented`
    ).bind(portfolioId, portfolioId, portfolioId, portfolioId, portfolioId, portfolioId, portfolioId, portfolioId).first<Record<string, number>>();
    return {
      dailyReviewsCompleted: row?.dailyReviewsCompleted ?? 0,
      dailyReviewsSkipped: row?.dailyReviewsSkipped ?? 0,
      marketDataFailures: row?.marketDataFailures ?? 0,
      proposalGenerationFailures: row?.proposalGenerationFailures ?? 0,
      orderValidationFailures: row?.orderValidationFailures ?? 0,
      executionFailures: row?.executionFailures ?? 0,
      duplicateActionsPrevented: row?.duplicateActionsPrevented ?? 0,
      staleDataBlocks: row?.staleDataBlocks ?? 0,
      policyViolationsPrevented: row?.policyViolationsPrevented ?? 0
    };
  }

  private async recordRun(
    program: ProgramRow,
    portfolioId: string,
    marketDate: string,
    triggerSource: "manual" | "scheduled",
    status: "started" | "completed" | "skipped" | "failed",
    reviewId: string | null,
    skipReason: string | null,
    snapshotId: string | null,
    now: Date,
    errorMessage: string | null = null
  ): Promise<void> {
    await this.db.prepare(
      `INSERT OR IGNORE INTO forward_test_runs (
        id, program_id, portfolio_id, market_date, trigger_source, status,
        daily_review_id, market_data_snapshot_id, skip_reason, error_message,
        started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      `forward_run_${hash(`${program.id}:${marketDate}:${triggerSource}:${status}:${now.toISOString()}`)}`,
      program.id,
      portfolioId,
      marketDate,
      triggerSource,
      status,
      reviewId,
      snapshotId,
      skipReason,
      errorMessage,
      now.toISOString(),
      status === "started" ? null : now.toISOString()
    ).run();
  }
}

export async function runScheduledForwardTests(env: Env, scheduledAt = new Date().toISOString()): Promise<ForwardTestRunResult[]> {
  const service = new ForwardTestService(env.DB);
  const profiles = await listPortfolioProfiles(env.DB);
  const results: ForwardTestRunResult[] = [];
  for (const profile of profiles.filter((item) => item.portfolioId === "portfolio_ira")) {
    results.push(await service.run(profile.portfolioId, "scheduled", new Date(scheduledAt)));
  }
  return results;
}

export function buildForwardValuations(input: {
  program: ProgramRow;
  portfolio: PortfolioRow;
  review: DailyReviewRow;
  snapshot: MarketDataSnapshot | null;
  previous: Map<ForwardTrackedPortfolioKey, ForwardValuation>;
  firstFills: FillRow[];
  cashAnnualRate: number;
}): ForwardValuation[] {
  const values: Array<{ key: ForwardTrackedPortfolioKey; value: number; cash: number; invested: number; benchmarkVersionId: string | null; dataQuality: ForwardValuation["dataQualityStatus"]; assumptions: Record<string, unknown> }> = [];
  values.push({
    key: "kairox_managed",
    value: input.review.portfolioValueUsd,
    cash: input.review.cashUsd,
    invested: Math.max(0, input.review.portfolioValueUsd - input.review.cashUsd),
    benchmarkVersionId: null,
    dataQuality: input.review.dataFreshnessStatus === "fresh" ? "complete" : "incomplete",
    assumptions: { source: "daily_portfolio_reviews", dailyReviewId: input.review.id }
  });
  const buyHold = buyHoldValue(input.program.startingCapitalUsd, input.firstFills, input.snapshot);
  values.push({ key: "initial_allocation_buy_hold", benchmarkVersionId: "forward_benchmark_buy_hold_initial_v1", ...buyHold });
  const cash = cashValue(input.program.startingCapitalUsd, input.program.startDate, input.review.marketDate, input.cashAnnualRate);
  values.push({ key: "cash_baseline", value: cash, cash, invested: 0, benchmarkVersionId: "forward_benchmark_cash_v1", dataQuality: "complete", assumptions: { annualRate: input.cashAnnualRate } });
  const spy = benchmarkValue(input.program.startingCapitalUsd, input.snapshot, { SPY: 1 }, input.program.startDate, input.review.marketDate, input.cashAnnualRate);
  values.push({ key: "sp500_benchmark", benchmarkVersionId: "forward_benchmark_sp500_v1", ...spy });
  const balanced = benchmarkValue(input.program.startingCapitalUsd, input.snapshot, { SPY: 0.4, BND: 0.4, cash: 0.2 }, input.program.startDate, input.review.marketDate, input.cashAnnualRate);
  values.push({ key: "conservative_balanced_benchmark", benchmarkVersionId: "forward_benchmark_conservative_balanced_v1", ...balanced });

  return values.map((item) => {
    const previous = input.previous.get(item.key);
    const highWater = Math.max(item.value, previous?.highWaterMarkUsd ?? input.program.startingCapitalUsd);
    return {
      id: `forward_value_${input.program.id}_${item.key}_${input.review.marketDate}`,
      programId: input.program.id,
      portfolioId: input.program.portfolioId,
      trackedPortfolioKey: item.key,
      benchmarkVersionId: item.benchmarkVersionId,
      marketDate: input.review.marketDate,
      portfolioValueUsd: roundMoney(item.value),
      cashValueUsd: roundMoney(item.cash),
      investedValueUsd: roundMoney(item.invested),
      dailyReturn: previous ? pctChange(previous.portfolioValueUsd, item.value) : null,
      cumulativeReturn: pctChange(input.program.startingCapitalUsd, item.value),
      drawdown: highWater > 0 ? roundRatio((highWater - item.value) / highWater) : 0,
      highWaterMarkUsd: roundMoney(highWater),
      contributionsUsd: 0,
      withdrawalsUsd: 0,
      dividendsUsd: 0,
      simulatedFeesUsd: item.key === "kairox_managed" || item.key === "initial_allocation_buy_hold" ? roundMoney(input.firstFills.reduce((sum, fill) => sum + fill.simulatedFeesUsd, 0)) : 0,
      marketDataSnapshotId: input.review.marketDataSnapshotId,
      dataQualityStatus: item.dataQuality,
      assumptions: item.assumptions
    };
  });
}

export function calculatePortfolioMetrics(rows: ForwardValuation[], startingCapital: number, riskFreeRate = 0): ForwardPortfolioMetrics {
  const latest = rows.at(-1);
  const returns = rows.map((row) => row.dailyReturn).filter((value): value is number => value !== null && Number.isFinite(value));
  const since = latest ? pctChange(startingCapital, latest.portfolioValueUsd) : null;
  const vol = returns.length >= 2 ? standardDeviation(returns) : null;
  const downside = returns.filter((value) => value < 0);
  const maxDrawdown = rows.length ? Math.max(...rows.map((row) => row.drawdown)) : null;
  return {
    trackedPortfolioKey: latest?.trackedPortfolioKey ?? "unknown",
    latestValueUsd: latest?.portfolioValueUsd ?? null,
    sinceInceptionReturn: since,
    totalGainLossUsd: latest ? subtractMoney(latest.portfolioValueUsd, startingCapital) : null,
    dailyReturn: latest?.dailyReturn ?? null,
    weeklyReturn: periodReturn(rows, 5),
    monthlyReturn: periodReturn(rows, 20),
    ytdReturn: ytdReturn(rows),
    annualizedReturn: rows.length >= 60 && since !== null ? roundRatio(Math.pow(1 + since, 252 / rows.length) - 1) : null,
    incomeReceivedUsd: roundMoney(rows.reduce((sum, row) => sum + row.dividendsUsd, 0)),
    volatility: vol,
    maximumDrawdown: maxDrawdown,
    currentDrawdown: latest?.drawdown ?? null,
    downsideDeviation: downside.length >= 2 ? standardDeviation(downside) : null,
    worstDay: returns.length ? Math.min(...returns) : null,
    worstWeek: worstPeriod(rows, 5),
    recoveryTimeDays: recoveryTime(rows),
    positiveDayPct: returns.length ? roundRatio(returns.filter((value) => value > 0).length / returns.length) : null,
    sharpeRatio: returns.length >= 20 && vol && vol > 0 ? roundRatio((average(returns) - riskFreeRate / 252) / vol) : null,
    sortinoRatio: returns.length >= 20 && downside.length >= 2 ? roundRatio((average(returns) - riskFreeRate / 252) / standardDeviation(downside)) : null,
    calmarRatio: rows.length >= 60 && maxDrawdown && maxDrawdown > 0 && since !== null ? roundRatio(since / maxDrawdown) : null,
    returnToDrawdownRatio: maxDrawdown && maxDrawdown > 0 && since !== null ? roundRatio(since / maxDrawdown) : null
  };
}

export function evidenceStageFor(daysTested: number, config = DEFAULT_FORWARD_TEST_CONFIG): ForwardMetricsSummary["evidenceStage"] {
  const stage = [...config.evidenceStages].reverse().find((item) => daysTested >= item.minTradingDays) ?? config.evidenceStages[0];
  return {
    stage: stage.name,
    daysTested,
    description: stage.description,
    confidenceLabel: daysTested < 120 ? "Preliminary; not enough evidence to imply profitability." : "More meaningful, still paper-only evidence."
  };
}

function buyHoldValue(startingCapital: number, fills: FillRow[], snapshot: MarketDataSnapshot | null) {
  if (fills.length === 0) {
    return { value: startingCapital, cash: startingCapital, invested: 0, dataQuality: "complete" as const, assumptions: { noInitialAllocation: true } };
  }
  let invested = 0;
  let complete = true;
  for (const fill of fills) {
    const quote = snapshot?.quotes.get(fill.symbol);
    if (!quote?.lastPrice || !quote.validation.valid) {
      complete = false;
      invested += fill.netAmountUsd;
    } else {
      invested += fill.quantity * quote.lastPrice;
    }
  }
  const spent = fills.reduce((sum, fill) => sum + fill.netAmountUsd, 0);
  const cash = Math.max(0, startingCapital - spent);
  return { value: cash + invested, cash, invested, dataQuality: complete ? "complete" as const : "incomplete" as const, assumptions: { source: "first_executed_allocation", dividendTreatment: "recorded dividends only" } };
}

function cashValue(startingCapital: number, startDate: string, marketDate: string, annualRate: number): number {
  const days = Math.max(0, daysBetween(startDate, marketDate));
  return roundMoney(startingCapital * (1 + annualRate * days / 365));
}

function benchmarkValue(startingCapital: number, snapshot: MarketDataSnapshot | null, weights: Record<string, number>, startDate: string, marketDate: string, cashAnnualRate: number) {
  let value = 0;
  let invested = 0;
  let complete = true;
  for (const [symbol, weight] of Object.entries(weights)) {
    const sleeve = startingCapital * weight;
    if (symbol === "cash") {
      const cash = cashValue(sleeve, startDate, marketDate, cashAnnualRate);
      value += cash;
      continue;
    }
    const quote = snapshot?.quotes.get(symbol);
    if (!quote?.lastPrice || !quote.validation.valid) {
      complete = false;
      value += sleeve;
      invested += sleeve;
    } else {
      value += sleeve;
      invested += sleeve;
    }
  }
  return { value, cash: weights.cash ? cashValue(startingCapital * weights.cash, startDate, marketDate, cashAnnualRate) : 0, invested, dataQuality: complete ? "complete" as const : "incomplete" as const, assumptions: { weights, totalReturnData: "incomplete unless adjusted prices are available" } };
}

function mapValuationRow(row: ForwardValuationRow): ForwardValuation {
  return {
    id: row.id,
    programId: row.programId,
    portfolioId: row.portfolioId,
    trackedPortfolioKey: row.trackedPortfolioKey,
    benchmarkVersionId: row.benchmarkVersionId,
    marketDate: row.marketDate,
    portfolioValueUsd: row.portfolioValueUsd,
    cashValueUsd: row.cashValueUsd,
    investedValueUsd: row.investedValueUsd,
    dailyReturn: row.dailyReturn,
    cumulativeReturn: row.cumulativeReturn,
    drawdown: row.drawdown,
    highWaterMarkUsd: row.highWaterMarkUsd,
    contributionsUsd: row.contributionsUsd,
    withdrawalsUsd: row.withdrawalsUsd,
    dividendsUsd: row.dividendsUsd,
    simulatedFeesUsd: row.simulatedFeesUsd,
    marketDataSnapshotId: row.marketDataSnapshotId,
    dataQualityStatus: row.dataQualityStatus,
    assumptions: parseJson(row.assumptionsJson, {})
  };
}

function calibration(evaluations: DecisionEvaluation[], kind: "confidence" | "score"): CalibrationBucket[] {
  const buckets = kind === "confidence"
    ? [["low", 0, 0.5], ["medium", 0.5, 0.75], ["high", 0.75, 1.01]]
    : [["0-49", 0, 50], ["50-69", 50, 70], ["70-84", 70, 85], ["85-100", 85, 101]];
  return buckets.map(([bucket, min, max]) => {
    const items = evaluations.filter((item) => {
      const value = kind === "confidence" ? item.confidenceScore : item.investmentScore;
      return value >= Number(min) && value < Number(max) && item.outcomeClassification !== "Insufficient elapsed time";
    });
    const hits = items.filter((item) => ["Correct recommendation", "Useful risk reduction"].includes(item.outcomeClassification)).length;
    const excess = items.map((item) => item.excessReturn).filter((value): value is number => value !== null);
    return {
      bucket: String(bucket),
      count: items.length,
      hitRate: items.length ? roundRatio(hits / items.length) : null,
      averageExcessReturn: excess.length ? roundRatio(average(excess)) : null,
      riskAdjustedOutcome: excess.length ? roundRatio(average(excess) / (standardDeviation(excess) || 1)) : null
    };
  });
}

function strategyVersionEvaluation(evaluations: DecisionEvaluation[], valuations: ForwardValuation[]): StrategyVersionEvaluation[] {
  const groups = groupBy(evaluations, (item) => item.strategyVersionId);
  const managed = valuations.filter((item) => item.trackedPortfolioKey === "kairox_managed");
  const managedMetrics = calculatePortfolioMetrics(managed, managed[0]?.portfolioValueUsd ?? 1);
  return [...groups.entries()].map(([strategyVersionId, items]) => {
    const matured = items.filter((item) => item.outcomeClassification !== "Insufficient elapsed time");
    const gains = matured.map((item) => item.excessReturn).filter((value): value is number => typeof value === "number" && value > 0);
    const losses = matured.map((item) => item.excessReturn).filter((value): value is number => typeof value === "number" && value < 0);
    return {
      strategyVersionId,
      completedDecisions: matured.length,
      executedDecisions: matured.filter((item) => item.tradeExecuted).length,
      return: managedMetrics.sinceInceptionReturn,
      excessReturn: null,
      drawdown: managedMetrics.maximumDrawdown,
      volatility: managedMetrics.volatility,
      turnover: 0,
      hitRate: matured.length ? roundRatio(matured.filter((item) => ["Correct recommendation", "Useful risk reduction"].includes(item.outcomeClassification)).length / matured.length) : null,
      averageGain: gains.length ? roundRatio(average(gains)) : null,
      averageLoss: losses.length ? roundRatio(average(losses)) : null,
      policyViolations: matured.filter((item) => item.policyViolationReduced === false).length,
      dataQualityFailures: matured.filter((item) => item.dataQualityStatus !== "complete").length
    };
  });
}

function explainForwardResults(portfolios: Record<string, ForwardPortfolioMetrics>, evidence: ForwardMetricsSummary["evidenceStage"]): string {
  const managed = portfolios.kairox_managed;
  const cash = portfolios.cash_baseline;
  return `Kairox forward testing is ${evidence.stage}. The managed paper portfolio is compared with cash, initial buy-and-hold, S&P 500, and conservative balanced benchmarks using the same market dates. Differences may come from allocation, cash drag, security selection, risk reduction, turnover, simulated slippage, and incomplete total-return data. Results remain statistically uncertain until sufficient forward evidence accumulates. Managed return ${formatMaybePct(managed?.sinceInceptionReturn)} versus cash ${formatMaybePct(cash?.sinceInceptionReturn)}.`;
}

function unavailableMetrics(portfolios: Record<string, ForwardPortfolioMetrics>, daysTested: number): string[] {
  const unavailable = new Set<string>();
  for (const metrics of Object.values(portfolios)) {
    if (metrics.annualizedReturn === null) unavailable.add("Annualized return unavailable until at least 60 trading days.");
    if (metrics.sharpeRatio === null) unavailable.add("Sharpe ratio unavailable until sufficient daily returns exist.");
    if (metrics.sortinoRatio === null) unavailable.add("Sortino ratio unavailable until sufficient downside returns exist.");
  }
  if (daysTested < 120) unavailable.add("Evidence is not yet a meaningful 120-day forward test.");
  return [...unavailable];
}

function trackingError(managed: ForwardValuation[], benchmark: ForwardValuation[]): number | null {
  const byDate = new Map(benchmark.map((row) => [row.marketDate, row.dailyReturn]));
  const diffs = managed.map((row) => row.dailyReturn !== null && byDate.get(row.marketDate) !== null && byDate.has(row.marketDate) ? row.dailyReturn - (byDate.get(row.marketDate) as number) : null).filter((value): value is number => value !== null);
  return diffs.length >= 2 ? standardDeviation(diffs) : null;
}

function periodReturn(rows: ForwardValuation[], days: number): number | null {
  if (rows.length <= days) return null;
  return pctChange(rows[rows.length - 1 - days].portfolioValueUsd, rows[rows.length - 1].portfolioValueUsd);
}

function ytdReturn(rows: ForwardValuation[]): number | null {
  const latest = rows.at(-1);
  if (!latest) return null;
  const first = rows.find((row) => row.marketDate.slice(0, 4) === latest.marketDate.slice(0, 4)) ?? rows[0];
  return pctChange(first.portfolioValueUsd, latest.portfolioValueUsd);
}

function worstPeriod(rows: ForwardValuation[], days: number): number | null {
  if (rows.length <= days) return null;
  let worst = 0;
  for (let index = days; index < rows.length; index += 1) {
    worst = Math.min(worst, pctChange(rows[index - days].portfolioValueUsd, rows[index].portfolioValueUsd));
  }
  return roundRatio(worst);
}

function recoveryTime(rows: ForwardValuation[]): number | null {
  let current = 0;
  let max = 0;
  for (const row of rows) {
    if (row.drawdown > 0) current += 1;
    else current = 0;
    max = Math.max(max, current);
  }
  return rows.length ? max : null;
}

function emptySummary(reason: string): ForwardMetricsSummary {
  return {
    programId: reason,
    evidenceStage: evidenceStageFor(0),
    portfolios: {},
    decisionQuality: { recentMatured: [], confidenceCalibration: [], scoreCalibration: [], strategyVersions: [] },
    operationalReliability: { dailyReviewsCompleted: 0, dailyReviewsSkipped: 0, marketDataFailures: 0, proposalGenerationFailures: 0, orderValidationFailures: 0, executionFailures: 0, duplicateActionsPrevented: 0, staleDataBlocks: 0, policyViolationsPrevented: 0 },
    explanation: "Forward-test program has not been initialized.",
    unavailableMetrics: ["Forward-test data unavailable."]
  };
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    grouped.set(k, [...(grouped.get(k) ?? []), item]);
  }
  return grouped;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  const mean = average(values);
  return roundRatio(Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1 || 1)));
}

function daysBetween(startDate: string, endDate: string): number {
  return Math.floor((new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) / 86400000);
}

function tradingDaysBetween(startDate: string, endDate: string): number {
  let count = 0;
  const end = new Date(`${endDate}T00:00:00Z`);
  for (let date = new Date(`${startDate}T00:00:00Z`); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return Math.max(0, count - 1);
}

function accountDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

function nullableBoolean(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0;
}

function nullableBool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  return Number(value) === 1;
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function formatMaybePct(value: number | null | undefined): string {
  return value === null || value === undefined ? "unavailable" : `${(value * 100).toFixed(2)}%`;
}

function isMissingForwardTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table: forward_test_/i.test(message);
}

function hash(key: string): string {
  let value = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    value ^= key.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(16);
}
