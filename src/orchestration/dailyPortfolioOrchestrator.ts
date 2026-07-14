import { BenchmarkComparisonService, type BenchmarkRunResult } from "../benchmarks/comparison.ts";
import { PortfolioBriefingService, type PortfolioBriefing } from "../briefings/portfolioBriefing.ts";
import { PortfolioDecisionService, type PortfolioDecision } from "../decisions/portfolioDecision.ts";
import { safePublishDomainEvent } from "../events/eventBus.ts";
import { MarketDataService, type NormalizedQuote } from "../market/service.ts";
import { DailyManagementCycleService, type DailyManagementCycle } from "../management/dailyCycle.ts";
import { getInvestmentPolicy } from "../policies/investmentPolicy.ts";
import { completeDailySnapshot, type DailySnapshotSummary } from "../portfolio/dailySnapshots.ts";
import { accountDate, getPortfolioValuation, type PortfolioValuation } from "../portfolio/valuation.ts";
import { shouldRunScheduledDailyReview } from "../reviews/dailyReview.ts";
import { listRows } from "../shared/db.ts";
import { addMoney, roundMoney } from "../shared/money.ts";
import type { Env } from "../shared/types.ts";

export type DailyOrchestrationTriggerType = "Scheduled" | "Manual protected" | "Recovery retry" | "Administrative refresh";
export type DailyOrchestrationStatus = "Pending" | "Running" | "Completed" | "Completed with warnings" | "Data unavailable" | "Failed" | "Superseded";
export type DailyOrchestrationStageStatus = "completed" | "warning" | "failed" | "skipped";

export interface DailyOrchestrationRequest {
  portfolioId?: string;
  marketDate?: string;
  triggerType?: DailyOrchestrationTriggerType;
  refreshMode?: "normal" | "validate_only" | "administrative_refresh";
  actor?: string;
  now?: Date;
}

export interface DailyOrchestrationStageResult {
  stage: string;
  critical: boolean;
  status: DailyOrchestrationStageStatus;
  message: string;
  recordId?: string | null;
  startedAt: string;
  completedAt: string;
}

export interface DailyOrchestrationReconciliation {
  passed: boolean;
  warnings: string[];
  cashLedgerReconciled: boolean;
  positionsReconciled: boolean;
  valuationReconciled: boolean;
  benchmarkDateReconciled: boolean;
  dailyCycleMatchesValuation: boolean;
  decisionMatchesCycle: boolean;
  briefingMatchesDecision: boolean;
  prePostMutationCheck: {
    cashChanged: boolean;
    positionQuantityChanged: boolean;
    ordersChanged: boolean;
    fillsChanged: boolean;
    tradesChanged: boolean;
  };
}

export interface DailyOrchestrationRun {
  id: string;
  portfolioId: string;
  marketDate: string;
  triggerType: DailyOrchestrationTriggerType;
  refreshMode: string;
  actor: string;
  status: DailyOrchestrationStatus;
  startedAt: string;
  completedAt: string | null;
  currentStage: string;
  stageResults: DailyOrchestrationStageResult[];
  sourceMarketDataTimestamps: Record<string, string | null>;
  valuation: Partial<PortfolioValuation>;
  snapshotId: string | null;
  benchmarkUpdateIds: string[];
  dailyCycleId: string | null;
  decisionId: string | null;
  briefingId: string | null;
  journeyEventIds: string[];
  reconciliation: DailyOrchestrationReconciliation | null;
  warnings: string[];
  errorDetails: string | null;
  retryCount: number;
  supersedingRunId: string | null;
}

interface PortfolioRow {
  id: string;
  name: string;
  mode: string;
  cashUsd: number;
  brokerStatus: string | null;
}

interface PositionRow {
  symbol: string;
  quantity: number;
}

interface MutationCounts {
  cashUsd: number;
  positions: Record<string, number>;
  orders: number;
  fills: number;
  trades: number;
}

interface RunRow {
  id: string;
  portfolioId: string;
  marketDate: string;
  triggerType: DailyOrchestrationTriggerType;
  refreshMode: string;
  actor: string;
  status: DailyOrchestrationStatus;
  startedAt: string;
  completedAt: string | null;
  currentStage: string;
  stageResultsJson: string;
  sourceMarketDataTimestampsJson: string;
  valuationJson: string;
  snapshotId: string | null;
  benchmarkUpdateIdsJson: string;
  dailyCycleId: string | null;
  decisionId: string | null;
  briefingId: string | null;
  journeyEventIdsJson: string;
  reconciliationJson: string;
  warningsJson: string;
  errorDetails: string | null;
  retryCount: number;
  supersedingRunId: string | null;
}

const TIMEZONE = "America/New_York";
const HELD_AND_BENCHMARK_SYMBOLS = ["VTI", "SCHD", "BND"];
const FINAL_STATUSES: DailyOrchestrationStatus[] = ["Completed", "Completed with warnings", "Data unavailable"];

export class DailyPortfolioOrchestrator {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async run(request: DailyOrchestrationRequest = {}): Promise<{ run: DailyOrchestrationRun; idempotent: boolean; warnings: string[] }> {
    const now = request.now ?? new Date();
    const portfolioId = request.portfolioId ?? "portfolio_ira";
    const marketDate = request.marketDate ?? accountDate(now, TIMEZONE);
    const triggerType = request.triggerType ?? "Manual protected";
    const refreshMode = request.refreshMode ?? "normal";
    const actor = request.actor ?? (triggerType === "Scheduled" ? "scheduler" : "manual");

    if (triggerType === "Scheduled") {
      const schedule = shouldRunScheduledDailyOrchestration(now);
      if (!schedule.shouldRun) {
        const skipped = await this.persistInitialRun({ portfolioId, marketDate: schedule.marketDate, triggerType, refreshMode, actor, now, status: "Data unavailable", currentStage: "schedule_skipped" });
        const stage = stageResult("schedule", false, "skipped", schedule.reason ?? "Scheduled orchestration skipped.", now);
        await this.finalizeRun(skipped.id, "Data unavailable", "schedule_skipped", [stage], {}, {}, null, [], null, null, null, [], null, [stage.message], null, now);
        return { run: await this.requiredRun(skipped.id), idempotent: false, warnings: [stage.message] };
      }
    }

    const existing = await this.findExisting(portfolioId, marketDate, triggerType, refreshMode);
    if (existing && FINAL_STATUSES.includes(existing.status) && triggerType !== "Administrative refresh") {
      return { run: existing, idempotent: true, warnings: existing.warnings };
    }

    if (triggerType === "Administrative refresh") {
      const latestFinal = await this.latestFinalNormalRun(portfolioId, marketDate);
      if (latestFinal) {
        const newer = await this.hasNewerTrustedPricing(latestFinal, now);
        if (!newer) {
          return { run: latestFinal, idempotent: true, warnings: ["Administrative refresh rejected because no newer trusted pricing is available."] };
        }
      }
    }

    const run = existing && existing.status === "Failed"
      ? await this.markRetry(existing, now)
      : await this.persistInitialRun({ portfolioId, marketDate, triggerType, refreshMode, actor, now, status: "Running", currentStage: "validate_account" });

    const stageResults: DailyOrchestrationStageResult[] = [];
    const warnings: string[] = [];
    let sourceMarketDataTimestamps: Record<string, string | null> = {};
    const state: {
      valuation: PortfolioValuation | null;
      snapshot: DailySnapshotSummary | null;
      benchmarkRun: BenchmarkRunResult | null;
      cycle: DailyManagementCycle | null;
      decision: PortfolioDecision | null;
      briefing: PortfolioBriefing | null;
    } = { valuation: null, snapshot: null, benchmarkRun: null, cycle: null, decision: null, briefing: null };
    const before = await this.mutationCounts(portfolioId);

    try {
      await this.stage(run.id, "validate_account", async () => {
        const portfolio = await this.getPortfolio(portfolioId);
        if (!portfolio) throw new Error("Account does not exist.");
        if (portfolio.mode !== "paper") throw new Error("Daily orchestration is restricted to paper accounts.");
        if (portfolio.brokerStatus && portfolio.brokerStatus !== "active") throw new Error("Paper account is not active.");
        const policy = await getInvestmentPolicy(this.db, portfolioId);
        if (!policy || policy.status !== "active") throw new Error("Active investment policy is required.");
      }, stageResults, true, now);

      await this.stage(run.id, "refresh_market_data", async () => {
        const symbols = await this.heldAndBenchmarkSymbols(portfolioId);
        const quotes = await new MarketDataService(this.db).getQuotes(symbols, "daily_review", now);
        validateQuotes(quotes, now);
        sourceMarketDataTimestamps = Object.fromEntries(quotes.map((quote) => [quote.symbol, quote.providerTimestamp]));
        await safePublishDomainEvent(this.db, {
          eventType: "MarketData.Refreshed",
          correlationId: run.id,
          portfolioId,
          sourceService: "DailyPortfolioOrchestrator",
          payload: { symbols, sourceMarketDataTimestamps, useCase: "daily_review" },
          occurredAt: now
        });
      }, stageResults, true, now);

      await this.stage(run.id, "calculate_valuation", async () => {
        state.valuation = await getPortfolioValuation(this.db, portfolioId, now);
        if (state.valuation.dataStatus === "unavailable") {
          throw new Error("Current valuation is unavailable because trusted market data is missing.");
        }
        await safePublishDomainEvent(this.db, {
          eventType: "PortfolioValuation.Completed",
          correlationId: run.id,
          portfolioId,
          sourceService: "PortfolioValuation",
          payload: slimValuation(state.valuation),
          occurredAt: now
        });
      }, stageResults, true, now);

      await this.stage(run.id, "record_daily_snapshot", async () => {
        state.snapshot = await completeDailySnapshot(this.db, portfolioId, now, TIMEZONE);
      }, stageResults, true, now);

      await this.stage(run.id, "update_benchmarks", async () => {
        try {
          state.benchmarkRun = await new BenchmarkComparisonService(this.db).run(portfolioId, triggerType === "Scheduled" ? "scheduled" : "manual", now);
          await safePublishDomainEvent(this.db, {
            eventType: "Benchmark.Updated",
            correlationId: run.id,
            portfolioId,
            sourceService: "BenchmarkComparisonService",
            payload: {
              runId: state.benchmarkRun.runId,
              skipped: state.benchmarkRun.skipped,
              valuationCount: state.benchmarkRun.valuations.length
            },
            occurredAt: now
          });
        } catch (error) {
          warnings.push(`Benchmark update warning: ${messageOf(error)}`);
          throw error;
        }
      }, stageResults, false, now);

      await this.stage(run.id, "run_daily_management", async () => {
        const result = await new DailyManagementCycleService(this.db).run(portfolioId, triggerType === "Scheduled" ? "scheduled" : "manual", now, {
          refresh: triggerType === "Administrative refresh",
          refreshReason: triggerType === "Administrative refresh" ? "Administrative orchestration refresh." : undefined
        });
        state.cycle = result.cycle;
        if (!state.cycle || state.cycle.status !== "completed") {
          throw new Error(result.reason ?? "Daily management cycle did not complete.");
        }
        await safePublishDomainEvent(this.db, {
          eventType: "DailyManagement.Completed",
          correlationId: run.id,
          portfolioId,
          sourceService: "DailyManagementCycleService",
          payload: {
            cycleId: state.cycle.id,
            marketDate: state.cycle.cycleDate,
            portfolioValueUsd: state.cycle.portfolioValueUsd,
            policyCompliant: state.cycle.policyCompliant,
            outcome: state.cycle.outcome
          },
          occurredAt: now
        });
      }, stageResults, true, now);

      await this.stage(run.id, "evaluate_portfolio_decision", async () => {
        if (!state.cycle) throw new Error("Daily management cycle is required before decision evaluation.");
        state.decision = (await new PortfolioDecisionService(this.db).evaluateCycle(state.cycle.id, now)).decision;
        await safePublishDomainEvent(this.db, {
          eventType: "PortfolioDecision.Generated",
          correlationId: run.id,
          portfolioId,
          sourceService: "PortfolioDecisionService",
          payload: {
            decisionId: state.decision.id,
            sourceCycleId: state.decision.sourceCycleId,
            recommendation: state.decision.primaryRecommendation,
            confidenceScore: state.decision.confidenceScore,
            riskScore: state.decision.riskScore
          },
          occurredAt: now
        });
      }, stageResults, true, now);

      await this.stage(run.id, "generate_portfolio_briefing", async () => {
        try {
          state.briefing = (await new PortfolioBriefingService(this.db).generate(portfolioId, { type: "daily_close", now })).briefing;
          await safePublishDomainEvent(this.db, {
            eventType: "Briefing.Generated",
            correlationId: run.id,
            portfolioId,
            sourceService: "PortfolioBriefingService",
            payload: {
              briefingId: state.briefing.id,
              sourceDecisionId: state.briefing.sourceDecisionId,
              briefingType: state.briefing.briefingType,
              validationStatus: state.briefing.validationStatus,
              narrativeSource: state.briefing.narrativeSource
            },
            occurredAt: now
          });
        } catch (error) {
          warnings.push(`Briefing warning: ${messageOf(error)}`);
          throw error;
        }
      }, stageResults, false, now);

      await this.stage(run.id, "journey_events", async () => {
        // Existing component services own meaningful journey-event creation and deduplication.
      }, stageResults, false, now);

      const after = await this.mutationCounts(portfolioId);
      const reconciliation = await this.reconcile({ portfolioId, marketDate, valuation: state.valuation, snapshot: state.snapshot, benchmarkRun: state.benchmarkRun, cycle: state.cycle, decision: state.decision, briefing: state.briefing, before, after });
      warnings.push(...reconciliation.warnings);
      const status: DailyOrchestrationStatus = state.valuation?.dataStatus === "unavailable"
        ? "Data unavailable"
        : warnings.length || !reconciliation.passed
        ? "Completed with warnings"
        : "Completed";
      await this.finalizeRun(run.id, status, "completed", stageResults, sourceMarketDataTimestamps, state.valuation ?? {}, snapshotId(state.snapshot), state.benchmarkRun ? [state.benchmarkRun.runId] : [], state.cycle?.id ?? null, state.decision?.id ?? null, state.briefing?.id ?? null, [], reconciliation, warnings, null, now);
      if (triggerType === "Administrative refresh") {
        await this.supersedePriorNormalRun(portfolioId, marketDate, run.id, now);
      }
      return { run: await this.requiredRun(run.id), idempotent: false, warnings };
    } catch (error) {
      const status: DailyOrchestrationStatus = /market data|quote|valuation/i.test(messageOf(error)) ? "Data unavailable" : "Failed";
      warnings.push(messageOf(error));
      await this.finalizeRun(run.id, status, "failed", stageResults, sourceMarketDataTimestamps, state.valuation ?? {}, snapshotId(state.snapshot), state.benchmarkRun ? [state.benchmarkRun.runId] : [], state.cycle?.id ?? null, state.decision?.id ?? null, state.briefing?.id ?? null, [], null, warnings, messageOf(error), now);
      return { run: await this.requiredRun(run.id), idempotent: false, warnings };
    }
  }

  async latest(portfolioId = "portfolio_ira"): Promise<DailyOrchestrationRun | null> {
    const row = await this.db.prepare(`${RUN_SELECT} WHERE portfolio_id = ? ORDER BY started_at DESC LIMIT 1`).bind(portfolioId).first<RunRow>();
    return row ? mapRun(row) : null;
  }

  async list(portfolioId = "portfolio_ira", limit = 20): Promise<DailyOrchestrationRun[]> {
    const rows = await listRows<RunRow>(this.db.prepare(`${RUN_SELECT} WHERE portfolio_id = ? ORDER BY started_at DESC LIMIT ?`).bind(portfolioId, limit));
    return rows.map(mapRun);
  }

  private async stage(runId: string, name: string, work: () => Promise<void>, results: DailyOrchestrationStageResult[], critical: boolean, now: Date): Promise<void> {
    await this.updateStage(runId, name, now);
    const startedAt = now.toISOString();
    try {
      await work();
      results.push({ stage: name, critical, status: "completed", message: `${name} completed.`, startedAt, completedAt: new Date().toISOString() });
    } catch (error) {
      const result = { stage: name, critical, status: critical ? "failed" as const : "warning" as const, message: messageOf(error), startedAt, completedAt: new Date().toISOString() };
      results.push(result);
      if (critical) {
        throw error;
      }
    }
  }

  private async reconcile(input: {
    portfolioId: string;
    marketDate: string;
    valuation: PortfolioValuation | null;
    snapshot: DailySnapshotSummary | null;
    benchmarkRun: BenchmarkRunResult | null;
    cycle: DailyManagementCycle | null;
    decision: PortfolioDecision | null;
    briefing: PortfolioBriefing | null;
    before: MutationCounts;
    after: MutationCounts;
  }): Promise<DailyOrchestrationReconciliation> {
    const warnings: string[] = [];
    const valuationReconciled = input.valuation ? roundMoney(input.valuation.cashUsd + input.valuation.portfolioValueUsd) === input.valuation.totalAccountValueUsd : false;
    if (!valuationReconciled) warnings.push("Valuation does not reconcile to cash plus current positions.");
    const benchmarkDateReconciled = !input.benchmarkRun || input.benchmarkRun.skipped || input.benchmarkRun.valuations.every((item) => item.valuationDate === input.marketDate);
    if (!benchmarkDateReconciled) warnings.push("Benchmark valuations do not share the orchestration market date.");
    const dailyCycleMatchesValuation = Boolean(input.cycle && input.valuation && Math.abs(input.cycle.portfolioValueUsd - input.valuation.totalAccountValueUsd) < 0.02);
    if (!dailyCycleMatchesValuation) warnings.push("Daily-cycle portfolio value does not match current valuation.");
    const decisionMatchesCycle = Boolean(input.decision && input.cycle && input.decision.sourceCycleId === input.cycle.id);
    if (!decisionMatchesCycle) warnings.push("Portfolio decision is not linked to the completed daily cycle.");
    const briefingMatchesDecision = !input.briefing || !input.decision || input.briefing.sourceDecisionId === input.decision.id;
    if (!briefingMatchesDecision) warnings.push("Briefing is not linked to the generated portfolio decision.");
    const cashLedgerReconciled = input.before.cashUsd === input.after.cashUsd;
    const positionQuantityChanged = JSON.stringify(input.before.positions) !== JSON.stringify(input.after.positions);
    const positionsReconciled = !positionQuantityChanged;
    const ordersChanged = input.before.orders !== input.after.orders;
    const fillsChanged = input.before.fills !== input.after.fills;
    const tradesChanged = input.before.trades !== input.after.trades;
    if (!cashLedgerReconciled) warnings.push("Cash changed during orchestration.");
    if (!positionsReconciled) warnings.push("Position quantities changed during orchestration.");
    if (ordersChanged || fillsChanged || tradesChanged) warnings.push("Trading records changed during orchestration.");
    return {
      passed: warnings.length === 0,
      warnings,
      cashLedgerReconciled,
      positionsReconciled,
      valuationReconciled,
      benchmarkDateReconciled,
      dailyCycleMatchesValuation,
      decisionMatchesCycle,
      briefingMatchesDecision,
      prePostMutationCheck: {
        cashChanged: !cashLedgerReconciled,
        positionQuantityChanged,
        ordersChanged,
        fillsChanged,
        tradesChanged
      }
    };
  }

  private async getPortfolio(portfolioId: string): Promise<PortfolioRow | null> {
    return this.db.prepare(
      `SELECT p.id, p.name, p.mode, p.cash_usd AS cashUsd, ba.status AS brokerStatus
       FROM portfolios p
       LEFT JOIN broker_accounts ba ON ba.id = p.broker_account_id
       WHERE p.id = ?`
    ).bind(portfolioId).first<PortfolioRow>();
  }

  private async heldAndBenchmarkSymbols(portfolioId: string): Promise<string[]> {
    const rows = await listRows<{ symbol: string }>(this.db.prepare("SELECT symbol FROM positions WHERE portfolio_id = ? AND quantity > 0").bind(portfolioId));
    return [...new Set([...rows.map((row) => row.symbol), ...HELD_AND_BENCHMARK_SYMBOLS])];
  }

  private async mutationCounts(portfolioId: string): Promise<MutationCounts> {
    const [portfolio, positions, counts] = await Promise.all([
      this.db.prepare("SELECT cash_usd AS cashUsd FROM portfolios WHERE id = ?").bind(portfolioId).first<{ cashUsd: number }>(),
      listRows<PositionRow>(this.db.prepare("SELECT symbol, quantity FROM positions WHERE portfolio_id = ? AND quantity > 0 ORDER BY symbol").bind(portfolioId)),
      this.db.prepare(
        `SELECT
          (SELECT COUNT(*) FROM orders WHERE portfolio_id = ?) AS orders,
          (SELECT COUNT(*) FROM paper_order_fills WHERE portfolio_id = ?) AS fills,
          (SELECT COUNT(*) FROM trades WHERE portfolio_id = ?) AS trades`
      ).bind(portfolioId, portfolioId, portfolioId).first<{ orders: number; fills: number; trades: number }>()
    ]);
    return {
      cashUsd: portfolio?.cashUsd ?? 0,
      positions: Object.fromEntries(positions.map((position) => [position.symbol, position.quantity])),
      orders: counts?.orders ?? 0,
      fills: counts?.fills ?? 0,
      trades: counts?.trades ?? 0
    };
  }

  private async findExisting(portfolioId: string, marketDate: string, triggerType: string, refreshMode: string): Promise<DailyOrchestrationRun | null> {
    const row = await this.db.prepare(`${RUN_SELECT} WHERE portfolio_id = ? AND market_date = ? AND trigger_type = ? AND refresh_mode = ? LIMIT 1`).bind(portfolioId, marketDate, triggerType, refreshMode).first<RunRow>();
    return row ? mapRun(row) : null;
  }

  private async latestFinalNormalRun(portfolioId: string, marketDate: string): Promise<DailyOrchestrationRun | null> {
    const row = await this.db.prepare(`${RUN_SELECT} WHERE portfolio_id = ? AND market_date = ? AND trigger_type <> 'Administrative refresh' AND status IN ('Completed', 'Completed with warnings', 'Data unavailable') ORDER BY completed_at DESC LIMIT 1`).bind(portfolioId, marketDate).first<RunRow>();
    return row ? mapRun(row) : null;
  }

  private async hasNewerTrustedPricing(existing: DailyOrchestrationRun, now: Date): Promise<boolean> {
    const symbols = Object.keys(existing.sourceMarketDataTimestamps);
    if (symbols.length === 0) return true;
    const quotes = await new MarketDataService(this.db).getQuotes(symbols, "daily_review", now);
    return quotes.some((quote) => {
      const previous = existing.sourceMarketDataTimestamps[quote.symbol];
      return quote.providerTimestamp && (!previous || new Date(quote.providerTimestamp).getTime() > new Date(previous).getTime());
    });
  }

  private async persistInitialRun(input: { portfolioId: string; marketDate: string; triggerType: DailyOrchestrationTriggerType; refreshMode: string; actor: string; now: Date; status: DailyOrchestrationStatus; currentStage: string }): Promise<DailyOrchestrationRun> {
    const runId = id("daily_orchestration", `${input.portfolioId}_${input.marketDate}_${input.triggerType}_${input.refreshMode}`);
    await this.db.prepare(
      `INSERT INTO daily_orchestration_runs (
        id, portfolio_id, market_date, trigger_type, refresh_mode, actor, status,
        started_at, current_stage
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(portfolio_id, market_date, trigger_type, refresh_mode) DO UPDATE SET
        status = excluded.status,
        started_at = excluded.started_at,
        current_stage = excluded.current_stage,
        retry_count = retry_count + CASE WHEN daily_orchestration_runs.status = 'Failed' THEN 1 ELSE 0 END,
        updated_at = datetime('now')`
    ).bind(runId, input.portfolioId, input.marketDate, input.triggerType, input.refreshMode, input.actor, input.status, input.now.toISOString(), input.currentStage).run();
    return this.requiredRun(runId);
  }

  private async markRetry(run: DailyOrchestrationRun, now: Date): Promise<DailyOrchestrationRun> {
    await this.db.prepare("UPDATE daily_orchestration_runs SET status = 'Running', started_at = ?, completed_at = NULL, current_stage = 'retry_started', retry_count = retry_count + 1, updated_at = datetime('now') WHERE id = ?")
      .bind(now.toISOString(), run.id).run();
    return this.requiredRun(run.id);
  }

  private async updateStage(runId: string, stage: string, now: Date): Promise<void> {
    await this.db.prepare("UPDATE daily_orchestration_runs SET current_stage = ?, updated_at = datetime('now') WHERE id = ?").bind(stage, runId).run();
  }

  private async finalizeRun(
    runId: string,
    status: DailyOrchestrationStatus,
    currentStage: string,
    stages: DailyOrchestrationStageResult[],
    sourceMarketDataTimestamps: Record<string, string | null>,
    valuation: Partial<PortfolioValuation>,
    snapshotIdValue: string | null,
    benchmarkUpdateIds: string[],
    dailyCycleId: string | null,
    decisionId: string | null,
    briefingId: string | null,
    journeyEventIds: string[],
    reconciliation: DailyOrchestrationReconciliation | null,
    warnings: string[],
    errorDetails: string | null,
    now: Date
  ): Promise<void> {
    await this.db.prepare(
      `UPDATE daily_orchestration_runs SET
        status = ?, completed_at = ?, current_stage = ?, stage_results_json = ?,
        source_market_data_timestamps_json = ?, valuation_json = ?, snapshot_id = ?,
        benchmark_update_ids_json = ?, daily_cycle_id = ?, decision_id = ?, briefing_id = ?,
        journey_event_ids_json = ?, reconciliation_json = ?, warnings_json = ?,
        error_details = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).bind(
      status,
      now.toISOString(),
      currentStage,
      JSON.stringify(stages),
      JSON.stringify(sourceMarketDataTimestamps),
      JSON.stringify(slimValuation(valuation)),
      snapshotIdValue,
      JSON.stringify(benchmarkUpdateIds),
      dailyCycleId,
      decisionId,
      briefingId,
      JSON.stringify(journeyEventIds),
      JSON.stringify(reconciliation),
      JSON.stringify(warnings),
      errorDetails,
      runId
    ).run();
  }

  private async supersedePriorNormalRun(portfolioId: string, marketDate: string, supersedingRunId: string, now: Date): Promise<void> {
    await this.db.prepare(
      `UPDATE daily_orchestration_runs
       SET status = 'Superseded', superseding_run_id = ?, updated_at = datetime('now')
       WHERE portfolio_id = ? AND market_date = ? AND id <> ?
         AND trigger_type <> 'Administrative refresh'
         AND status IN ('Completed', 'Completed with warnings', 'Data unavailable')`
    ).bind(supersedingRunId, portfolioId, marketDate, supersedingRunId).run();
  }

  private async requiredRun(runId: string): Promise<DailyOrchestrationRun> {
    const row = await this.db.prepare(`${RUN_SELECT} WHERE id = ?`).bind(runId).first<RunRow>();
    if (!row) throw new Error("Daily orchestration run was not found after persistence.");
    return mapRun(row);
  }
}

export async function runScheduledDailyOrchestrations(env: Env, scheduledAt = new Date().toISOString()): Promise<unknown[]> {
  const now = new Date(scheduledAt);
  const schedule = shouldRunScheduledDailyOrchestration(now);
  if (!schedule.shouldRun) {
    return [{ skipped: true, marketDate: schedule.marketDate, reason: schedule.reason }];
  }
  const service = new DailyPortfolioOrchestrator(env.DB);
  const result = await service.run({ portfolioId: "portfolio_ira", triggerType: "Scheduled", actor: "scheduler", now, marketDate: schedule.marketDate });
  return [result.run];
}

export function shouldRunScheduledDailyOrchestration(now: Date): { shouldRun: boolean; marketDate: string; reason: string | null } {
  return shouldRunScheduledDailyReview(now);
}

export function validateQuotes(quotes: NormalizedQuote[], now: Date): void {
  const failures: string[] = [];
  for (const quote of quotes) {
    if (!quote.lastPrice || quote.lastPrice <= 0 || quote.dataQualityStatus === "Missing" || quote.dataQualityStatus === "Provider Failure") {
      failures.push(`${quote.symbol}: missing trusted price`);
    }
    if (quote.providerTimestamp && new Date(quote.providerTimestamp).getTime() > now.getTime() + 60_000) {
      failures.push(`${quote.symbol}: provider timestamp is in the future`);
    }
    if (quote.dataQualityStatus === "Stale" || quote.dataQualityStatus === "Conflicting" || quote.dataQualityStatus === "Anomalous") {
      failures.push(`${quote.symbol}: ${quote.dataQualityStatus}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Market data validation failed: ${failures.join("; ")}`);
  }
}

function stageResult(stage: string, critical: boolean, status: DailyOrchestrationStageStatus, message: string, now: Date): DailyOrchestrationStageResult {
  return { stage, critical, status, message, startedAt: now.toISOString(), completedAt: now.toISOString() };
}

function snapshotId(snapshot: DailySnapshotSummary | null): string | null {
  return snapshot ? `daily_${snapshot.portfolioId}_${snapshot.snapshotDate}` : null;
}

function slimValuation(valuation: Partial<PortfolioValuation>): Partial<PortfolioValuation> {
  return {
    portfolioId: valuation.portfolioId,
    valuationTimestamp: valuation.valuationTimestamp,
    cashUsd: valuation.cashUsd,
    portfolioValueUsd: valuation.portfolioValueUsd,
    totalAccountValueUsd: valuation.totalAccountValueUsd,
    lastSuccessfulMarketDataUpdateTime: valuation.lastSuccessfulMarketDataUpdateTime,
    dataStatus: valuation.dataStatus,
    dataMode: valuation.dataMode
  };
}

function mapRun(row: RunRow): DailyOrchestrationRun {
  return {
    id: row.id,
    portfolioId: row.portfolioId,
    marketDate: row.marketDate,
    triggerType: row.triggerType,
    refreshMode: row.refreshMode,
    actor: row.actor,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    currentStage: row.currentStage,
    stageResults: parseJson(row.stageResultsJson, []),
    sourceMarketDataTimestamps: parseJson(row.sourceMarketDataTimestampsJson, {}),
    valuation: parseJson(row.valuationJson, {}),
    snapshotId: row.snapshotId,
    benchmarkUpdateIds: parseJson(row.benchmarkUpdateIdsJson, []),
    dailyCycleId: row.dailyCycleId,
    decisionId: row.decisionId,
    briefingId: row.briefingId,
    journeyEventIds: parseJson(row.journeyEventIdsJson, []),
    reconciliation: parseJson(row.reconciliationJson, null),
    warnings: parseJson(row.warningsJson, []),
    errorDetails: row.errorDetails,
    retryCount: row.retryCount,
    supersedingRunId: row.supersedingRunId
  };
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown orchestration error.";
}

function id(prefix: string, key: string): string {
  return `${prefix}_${key.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120)}`;
}

const RUN_SELECT = `SELECT id, portfolio_id AS portfolioId, market_date AS marketDate,
  trigger_type AS triggerType, refresh_mode AS refreshMode, actor, status,
  started_at AS startedAt, completed_at AS completedAt, current_stage AS currentStage,
  stage_results_json AS stageResultsJson,
  source_market_data_timestamps_json AS sourceMarketDataTimestampsJson,
  valuation_json AS valuationJson, snapshot_id AS snapshotId,
  benchmark_update_ids_json AS benchmarkUpdateIdsJson, daily_cycle_id AS dailyCycleId,
  decision_id AS decisionId, briefing_id AS briefingId,
  journey_event_ids_json AS journeyEventIdsJson, reconciliation_json AS reconciliationJson,
  warnings_json AS warningsJson, error_details AS errorDetails, retry_count AS retryCount,
  superseding_run_id AS supersedingRunId
  FROM daily_orchestration_runs`;
