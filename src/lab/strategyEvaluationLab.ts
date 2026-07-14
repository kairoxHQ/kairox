import { MarketDataService, type MarketDataSnapshot, type NormalizedQuote } from "../market/service.ts";
import { safePublishDomainEvent } from "../events/eventBus.ts";
import { listRows } from "../shared/db.ts";
import { pctChange, roundMoney, roundRatio } from "../shared/money.ts";
import type { Env } from "../shared/types.ts";

export type LabStrategyName =
  | "Conservative Income"
  | "Balanced Growth"
  | "Buy & Hold"
  | "Dividend Growth"
  | "Equal Weight";

export interface StrategyDefinition {
  id: string;
  strategyName: LabStrategyName;
  strategyVersion: string;
  objective: string;
  targetWeights: Record<string, number>;
  rules: {
    rebalance: "monthly" | "none";
    switchEligible: boolean;
  };
  rebalanceFrequency: "monthly" | "none";
  changeNotes: string;
}

export interface StrategyLabValuation {
  strategyId: string;
  strategyName: LabStrategyName;
  marketDate: string;
  portfolioValueUsd: number;
  cashUsd: number;
  investedValueUsd: number;
  dailyReturn: number | null;
  cumulativeReturn: number;
  drawdown: number;
  highWaterMarkUsd: number;
  volatility: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  winRate: number | null;
  turnover: number;
  allocation: Record<string, number>;
  riskMetrics: {
    maximumDrawdown: number | null;
    latestDrawdown: number;
    returnsObserved: number;
  };
  marketDataSnapshotId: string | null;
  dataQualityStatus: "complete" | "incomplete" | "unavailable";
  virtualPositions?: LabVirtualPosition[];
}

interface LabVirtualPosition {
  symbol: string;
  quantity: number;
  averageCostUsd: number;
  marketValueUsd: number;
  allocationPct: number;
}

export interface StrategyLabSummary {
  programId: string | null;
  portfolioId: string;
  startDate: string | null;
  startingCapitalUsd: number | null;
  strategies: StrategyDefinition[];
  latestValuations: StrategyLabValuation[];
  rankings: StrategyLabRanking[];
  monthlyRankings: StrategyLabMonthlyRanking[];
  outperformance: OutperformanceSignal[];
  recommendation: StrategySwitchRecommendation;
  auditEvents: StrategyLabAuditEvent[];
  warnings: string[];
}

export interface StrategyLabRunResult {
  programId: string;
  marketDate: string;
  idempotent: boolean;
  snapshotId: string | null;
  valuations: StrategyLabValuation[];
  rankings: StrategyLabRanking[];
  warnings: string[];
}

export interface StrategyLabRanking {
  strategyId: string;
  strategyName: LabStrategyName;
  rank: number;
  returnPct: number | null;
  drawdownPct: number | null;
  volatilityPct: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  winRate: number | null;
  turnover: number;
  score: number;
}

export interface StrategyLabMonthlyRanking {
  rankingMonth: string;
  evidenceStatus: string;
  rankings: StrategyLabRanking[];
  outperformance: OutperformanceSignal[];
}

export interface OutperformanceSignal {
  strategyName: LabStrategyName;
  comparedWith: LabStrategyName;
  excessReturnPct: number;
  enoughEvidence: boolean;
  statisticallyMeaningful: boolean;
  reason: string;
}

export interface StrategySwitchRecommendation {
  allowed: boolean;
  recommendedStrategy: LabStrategyName | null;
  reason: string;
  evidenceThresholds: StrategyLabEvidenceThresholds;
}

export interface StrategyLabEvidenceThresholds {
  minimumValuationDays: number;
  minimumExcessReturnPct: number;
  minimumSharpeImprovement: number;
  maximumDrawdownPenaltyPct: number;
}

export interface StrategyLabAuditEvent {
  eventType: string;
  message: string;
  createdAt: string;
}

interface ProgramRow {
  id: string;
  portfolioId: string;
  name: string;
  startingCapitalUsd: number;
  startDate: string;
  status: string;
  evidenceThresholdsJson: string;
}

interface PortfolioRow {
  id: string;
  mode: string;
  startingBalanceUsd: number;
  createdAt: string;
}

interface LatestReviewRow {
  marketDate: string;
  marketDataSnapshotId: string | null;
}

interface StrategyRow {
  id: string;
  strategyName: LabStrategyName;
  strategyVersion: string;
  objective: string;
  targetWeightsJson: string;
  rulesJson: string;
  rebalanceFrequency: "monthly" | "none";
  changeNotes: string;
}

interface ValuationRow {
  strategyId: string;
  strategyName: LabStrategyName;
  marketDate: string;
  portfolioValueUsd: number;
  cashUsd: number;
  investedValueUsd: number;
  dailyReturn: number | null;
  cumulativeReturn: number;
  drawdown: number;
  highWaterMarkUsd: number;
  volatility: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  winRate: number | null;
  turnover: number;
  allocationJson: string;
  riskMetricsJson: string;
  marketDataSnapshotId: string | null;
  dataQualityStatus: "complete" | "incomplete" | "unavailable";
}

interface PositionRow {
  strategyId: string;
  symbol: string;
  quantity: number;
  averageCostUsd: number;
  marketValueUsd: number;
  allocationPct: number;
}

interface MonthlyRankingRow {
  rankingMonth: string;
  rankingsJson: string;
  evidenceStatus: string;
  outperformanceJson: string;
}

interface AuditRow {
  eventType: string;
  message: string;
  createdAt: string;
}

export const DEFAULT_STRATEGY_LAB_THRESHOLDS: StrategyLabEvidenceThresholds = {
  minimumValuationDays: 60,
  minimumExcessReturnPct: 0.02,
  minimumSharpeImprovement: 0.1,
  maximumDrawdownPenaltyPct: 0.02
};

export const BUILT_IN_LAB_STRATEGIES: Omit<StrategyDefinition, "id">[] = [
  {
    strategyName: "Conservative Income",
    strategyVersion: "1.0.0",
    objective: "Prioritize income, lower volatility, and capital preservation.",
    targetWeights: { VTI: 0.2, SCHD: 0.25, BND: 0.35, SHY: 0.1, cash: 0.1 },
    rules: { rebalance: "monthly", switchEligible: true },
    rebalanceFrequency: "monthly",
    changeNotes: "Initial lab strategy focused on income and bonds."
  },
  {
    strategyName: "Balanced Growth",
    strategyVersion: "1.0.0",
    objective: "Balance broad equity growth with bond ballast and required cash.",
    targetWeights: { VTI: 0.5, SCHD: 0.15, BND: 0.2, SHY: 0.05, cash: 0.1 },
    rules: { rebalance: "monthly", switchEligible: true },
    rebalanceFrequency: "monthly",
    changeNotes: "Initial lab strategy with moderate equity tilt."
  },
  {
    strategyName: "Buy & Hold",
    strategyVersion: "1.0.0",
    objective: "Hold the initial diversified paper allocation without tactical changes.",
    targetWeights: { VTI: 0.2, SCHD: 0.2, BND: 0.2, cash: 0.4 },
    rules: { rebalance: "none", switchEligible: false },
    rebalanceFrequency: "none",
    changeNotes: "Initial no-rebalance reference strategy."
  },
  {
    strategyName: "Dividend Growth",
    strategyVersion: "1.0.0",
    objective: "Favor dividend growth while keeping bonds and cash as stabilizers.",
    targetWeights: { SCHD: 0.45, VTI: 0.25, BND: 0.15, SHY: 0.05, cash: 0.1 },
    rules: { rebalance: "monthly", switchEligible: true },
    rebalanceFrequency: "monthly",
    changeNotes: "Initial lab strategy with dividend-oriented equity emphasis."
  },
  {
    strategyName: "Equal Weight",
    strategyVersion: "1.0.0",
    objective: "Split invested capital evenly across core sleeves with a cash reserve.",
    targetWeights: { VTI: 0.225, SCHD: 0.225, BND: 0.225, SHY: 0.225, cash: 0.1 },
    rules: { rebalance: "monthly", switchEligible: true },
    rebalanceFrequency: "monthly",
    changeNotes: "Initial simple equal-weight comparison strategy."
  }
];

export class StrategyEvaluationLabService {
  private readonly db: D1Database;
  private readonly marketData: MarketDataService;
  private readonly thresholds: StrategyLabEvidenceThresholds;

  constructor(db: D1Database, marketData = new MarketDataService(db), thresholds = DEFAULT_STRATEGY_LAB_THRESHOLDS) {
    this.db = db;
    this.marketData = marketData;
    this.thresholds = thresholds;
  }

  async run(portfolioId = "portfolio_ira", now = new Date()): Promise<StrategyLabRunResult> {
    const portfolio = await this.getPortfolio(portfolioId);
    if (!portfolio) throw new Error("Portfolio not found.");
    if (portfolio.mode !== "paper") throw new Error("Strategy Evaluation Lab is restricted to paper portfolios.");
    const program = await this.ensureProgram(portfolio, now);
    const strategies = await this.ensureStrategies(program, now);
    const latestReview = await this.latestReview(portfolioId);
    const marketDate = latestReview?.marketDate ?? accountDate(now);
    const existing = await this.valuationsForDate(program.id, marketDate);
    if (existing.length >= strategies.length) {
      return {
        programId: program.id,
        marketDate,
        idempotent: true,
        snapshotId: existing[0]?.marketDataSnapshotId ?? null,
        valuations: existing,
        rankings: rankStrategies(existing),
        warnings: ["Strategy lab valuations already exist for this market date."]
      };
    }
    const snapshot = latestReview?.marketDataSnapshotId
      ? await this.marketData.getSnapshot(latestReview.marketDataSnapshotId)
      : await this.marketData.createSnapshot(symbolsForStrategies(strategies), "daily_review", now);
    if (!snapshot) {
      throw new Error("A market-data snapshot is required for strategy lab evaluation.");
    }
    await this.audit(program, "strategy_lab_run_started", "Strategy lab run started.", { marketDate, snapshotId: snapshot.id }, now);
    const warnings = validateSnapshot(strategies, snapshot);
    const valuations = await this.buildValuations(program, portfolioId, strategies, snapshot, marketDate);
    await this.persistValuations(program, valuations);
    await this.persistMonthlyRanking(program, marketDate, valuations, now);
    await this.audit(program, "strategy_lab_run_completed", "Strategy lab run completed without touching active portfolio holdings.", { marketDate, strategyCount: strategies.length, warnings }, now);
    const rankings = rankStrategies(valuations);
    await safePublishDomainEvent(this.db, {
      eventType: "StrategyLab.Ranked",
      correlationId: `strategy_lab_${portfolioId}_${marketDate}`,
      portfolioId,
      sourceService: "StrategyEvaluationLabService",
      payload: {
        programId: program.id,
        marketDate,
        snapshotId: snapshot.id,
        rankings: rankings.map((ranking) => ({
          strategyName: ranking.strategyName,
          rank: ranking.rank,
          score: ranking.score
        }))
      },
      occurredAt: now
    });
    return {
      programId: program.id,
      marketDate,
      idempotent: false,
      snapshotId: snapshot.id,
      valuations,
      rankings,
      warnings
    };
  }

  async summary(portfolioId = "portfolio_ira"): Promise<StrategyLabSummary> {
    const program = await this.getProgram(portfolioId);
    if (!program) {
      return {
        programId: null,
        portfolioId,
        startDate: null,
        startingCapitalUsd: null,
        strategies: BUILT_IN_LAB_STRATEGIES.map((strategy, index) => ({ id: `builtin_preview_${index}`, ...strategy })),
        latestValuations: [],
        rankings: [],
        monthlyRankings: [],
        outperformance: [],
        recommendation: { allowed: false, recommendedStrategy: null, reason: "Strategy lab has not been initialized.", evidenceThresholds: this.thresholds },
        auditEvents: [],
        warnings: ["Run the protected lab update to initialize virtual strategy comparisons."]
      };
    }
    const [strategies, valuations, monthlyRankings, auditEvents] = await Promise.all([
      this.getStrategies(program.id),
      this.latestValuations(program.id),
      this.monthlyRankings(program.id),
      this.auditEvents(program.id)
    ]);
    const rankings = rankStrategies(valuations);
    const outperformance = detectOutperformance(valuations, this.thresholds);
    return {
      programId: program.id,
      portfolioId,
      startDate: program.startDate,
      startingCapitalUsd: program.startingCapitalUsd,
      strategies,
      latestValuations: valuations,
      rankings,
      monthlyRankings,
      outperformance,
      recommendation: recommendationFromRankings(rankings, outperformance, valuations, this.thresholds),
      auditEvents,
      warnings: valuations.some((valuation) => valuation.dataQualityStatus !== "complete") ? ["Some lab strategies have incomplete market data."] : []
    };
  }

  private async ensureProgram(portfolio: PortfolioRow, now: Date): Promise<ProgramRow> {
    const existing = await this.getProgram(portfolio.id);
    if (existing) return existing;
    const id = `strategy_lab_${portfolio.id}`;
    await this.db.prepare(
      `INSERT OR IGNORE INTO strategy_lab_programs (
        id, portfolio_id, name, starting_capital_usd, start_date, status, evidence_thresholds_json, created_at, updated_at
      ) VALUES (?, ?, 'IRA Strategy Evaluation Lab', ?, ?, 'active', ?, ?, ?)`
    ).bind(id, portfolio.id, portfolio.startingBalanceUsd, portfolio.createdAt.slice(0, 10), JSON.stringify(this.thresholds), now.toISOString(), now.toISOString()).run();
    const program = await this.getProgram(portfolio.id);
    if (!program) throw new Error("Strategy lab program could not be initialized.");
    await this.audit(program, "strategy_lab_initialized", "Strategy lab initialized for paper-only virtual strategy comparison.", { startingCapitalUsd: portfolio.startingBalanceUsd }, now);
    return program;
  }

  private async ensureStrategies(program: ProgramRow, now: Date): Promise<StrategyDefinition[]> {
    const existing = await this.getStrategies(program.id);
    if (existing.length >= BUILT_IN_LAB_STRATEGIES.length) return existing;
    for (const strategy of BUILT_IN_LAB_STRATEGIES) {
      const id = `strategy_lab_${program.portfolioId}_${slug(strategy.strategyName)}_v1`;
      await this.db.prepare(
        `INSERT OR IGNORE INTO strategy_lab_strategies (
          id, program_id, strategy_name, strategy_version, objective, status,
          target_weights_json, rules_json, rebalance_frequency, change_notes, created_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
      ).bind(id, program.id, strategy.strategyName, strategy.strategyVersion, strategy.objective, JSON.stringify(strategy.targetWeights), JSON.stringify(strategy.rules), strategy.rebalanceFrequency, strategy.changeNotes, now.toISOString()).run();
    }
    await this.audit(program, "strategy_lab_strategies_registered", "Built-in lab strategies registered.", { strategies: BUILT_IN_LAB_STRATEGIES.map((item) => item.strategyName) }, now);
    return this.getStrategies(program.id);
  }

  private async buildValuations(program: ProgramRow, portfolioId: string, strategies: StrategyDefinition[], snapshot: MarketDataSnapshot, marketDate: string): Promise<StrategyLabValuation[]> {
    const previousValuations = await this.latestValuations(program.id);
    const previousPositions = await this.previousPositions(program.id);
    return Promise.all(strategies.map(async (strategy) => {
      const prior = previousValuations.find((valuation) => valuation.strategyId === strategy.id);
      const positions = previousPositions.filter((position) => position.strategyId === strategy.id);
      const shouldInitialize = positions.length === 0;
      const shouldRebalance = shouldInitialize || (strategy.rules.rebalance === "monthly" && prior?.marketDate.slice(0, 7) !== marketDate.slice(0, 7));
      const baseValue = prior?.portfolioValueUsd ?? program.startingCapitalUsd;
      const portfolio = shouldRebalance
        ? targetPortfolio(strategy, baseValue, snapshot)
        : carryForwardPortfolio(strategy, positions, snapshot);
      const value = roundMoney(portfolio.cash + portfolio.positions.reduce((sum, position) => sum + position.marketValueUsd, 0));
      const highWater = Math.max(value, prior?.highWaterMarkUsd ?? program.startingCapitalUsd);
      const strategyHistory = await this.strategyHistory(program.id, strategy.id);
      const dailyReturn = prior ? pctChange(prior.portfolioValueUsd, value) : null;
      const returns = [...strategyHistory.map((row) => row.dailyReturn).filter((item): item is number => item !== null), ...(dailyReturn === null ? [] : [dailyReturn])];
      const allocation = Object.fromEntries(portfolio.positions.map((position) => [position.symbol, roundRatio(position.marketValueUsd / Math.max(value, 1))]));
      if (portfolio.cash > 0) allocation.cash = roundRatio(portfolio.cash / Math.max(value, 1));
      return {
        strategyId: strategy.id,
        strategyName: strategy.strategyName,
        marketDate,
        portfolioValueUsd: value,
        cashUsd: roundMoney(portfolio.cash),
        investedValueUsd: roundMoney(value - portfolio.cash),
        dailyReturn,
        cumulativeReturn: pctChange(program.startingCapitalUsd, value),
        drawdown: highWater > 0 ? roundRatio((highWater - value) / highWater) : 0,
        highWaterMarkUsd: roundMoney(highWater),
        volatility: returns.length >= 2 ? standardDeviation(returns) : null,
        sharpeRatio: returns.length >= 20 ? sharpe(returns) : null,
        sortinoRatio: returns.filter((item) => item < 0).length >= 2 ? sortino(returns) : null,
        winRate: returns.length ? roundRatio(returns.filter((item) => item > 0).length / returns.length) : null,
        turnover: shouldInitialize ? roundRatio((value - portfolio.cash) / Math.max(value, 1)) : 0,
        allocation,
        riskMetrics: {
          maximumDrawdown: Math.max(0, ...strategyHistory.map((row) => row.drawdown), highWater > 0 ? (highWater - value) / highWater : 0),
          latestDrawdown: highWater > 0 ? roundRatio((highWater - value) / highWater) : 0,
          returnsObserved: returns.length
        },
        marketDataSnapshotId: snapshot.id,
        dataQualityStatus: portfolio.complete ? "complete" : "incomplete",
        virtualPositions: portfolio.positions.map((position) => ({
          ...position,
          allocationPct: roundRatio(position.marketValueUsd / Math.max(value, 1))
        }))
      };
    }));
  }

  private async persistValuations(program: ProgramRow, valuations: StrategyLabValuation[]): Promise<void> {
    for (const valuation of valuations) {
      await this.db.prepare(
        `INSERT OR IGNORE INTO strategy_lab_daily_valuations (
          id, program_id, portfolio_id, strategy_id, market_date, starting_capital_usd,
          portfolio_value_usd, cash_usd, invested_value_usd, daily_return, cumulative_return,
          drawdown, high_water_mark_usd, volatility, sharpe_ratio, sortino_ratio,
          win_rate, turnover, allocation_json, risk_metrics_json, market_data_snapshot_id, data_quality_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        `strategy_lab_value_${program.id}_${valuation.strategyId}_${valuation.marketDate}`,
        program.id,
        program.portfolioId,
        valuation.strategyId,
        valuation.marketDate,
        program.startingCapitalUsd,
        valuation.portfolioValueUsd,
        valuation.cashUsd,
        valuation.investedValueUsd,
        valuation.dailyReturn,
        valuation.cumulativeReturn,
        valuation.drawdown,
        valuation.highWaterMarkUsd,
        valuation.volatility,
        valuation.sharpeRatio,
        valuation.sortinoRatio,
        valuation.winRate,
        valuation.turnover,
        JSON.stringify(valuation.allocation),
        JSON.stringify(valuation.riskMetrics),
        valuation.marketDataSnapshotId,
        valuation.dataQualityStatus
      ).run();
      for (const position of valuation.virtualPositions ?? []) {
        await this.db.prepare(
          `INSERT OR IGNORE INTO strategy_lab_virtual_positions (
            id, program_id, strategy_id, market_date, symbol, quantity, average_cost_usd, market_value_usd, allocation_pct
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          `strategy_lab_pos_${program.id}_${valuation.strategyId}_${valuation.marketDate}_${position.symbol}`,
          program.id,
          valuation.strategyId,
          valuation.marketDate,
          position.symbol,
          position.quantity,
          position.averageCostUsd,
          position.marketValueUsd,
          position.allocationPct
        ).run();
        if (valuation.turnover > 0 && position.symbol !== "cash") {
          await this.db.prepare(
            `INSERT OR IGNORE INTO strategy_lab_virtual_trades (
              id, program_id, strategy_id, market_date, symbol, side, quantity, price_usd, notional_usd, reason
            ) VALUES (?, ?, ?, ?, ?, 'BUY', ?, ?, ?, ?)`
          ).bind(
            `strategy_lab_trade_${program.id}_${valuation.strategyId}_${valuation.marketDate}_${position.symbol}_initial`,
            program.id,
            valuation.strategyId,
            valuation.marketDate,
            position.symbol,
            position.quantity,
            position.averageCostUsd,
            position.marketValueUsd,
            "Virtual lab allocation only; active IRA holdings and cash are not changed."
          ).run();
        }
      }
    }
  }

  private async persistMonthlyRanking(program: ProgramRow, marketDate: string, valuations: StrategyLabValuation[], now: Date): Promise<void> {
    const month = marketDate.slice(0, 7);
    const rankings = rankStrategies(valuations);
    const outperformance = detectOutperformance(valuations, this.thresholds);
    const rankingEvidenceStatus = evidenceStatus(valuations, this.thresholds);
    await this.db.prepare(
      `INSERT OR IGNORE INTO strategy_lab_monthly_rankings (
        id, program_id, ranking_month, rankings_json, evidence_status, outperformance_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(`strategy_lab_ranking_${program.id}_${month}`, program.id, month, JSON.stringify(rankings), rankingEvidenceStatus, JSON.stringify(outperformance), now.toISOString()).run();
  }

  private async getPortfolio(portfolioId: string): Promise<PortfolioRow | null> {
    return this.db.prepare("SELECT id, mode, starting_balance_usd AS startingBalanceUsd, created_at AS createdAt FROM portfolios WHERE id = ?").bind(portfolioId).first<PortfolioRow>();
  }

  private async getProgram(portfolioId: string): Promise<ProgramRow | null> {
    return this.db.prepare(
      `SELECT id, portfolio_id AS portfolioId, name, starting_capital_usd AS startingCapitalUsd,
        start_date AS startDate, status, evidence_thresholds_json AS evidenceThresholdsJson
       FROM strategy_lab_programs
       WHERE portfolio_id = ? AND status = 'active'
       LIMIT 1`
    ).bind(portfolioId).first<ProgramRow>();
  }

  private async getStrategies(programId: string): Promise<StrategyDefinition[]> {
    const rows = await listRows<StrategyRow>(
      this.db.prepare(
        `SELECT id, strategy_name AS strategyName, strategy_version AS strategyVersion,
          objective, target_weights_json AS targetWeightsJson, rules_json AS rulesJson,
          rebalance_frequency AS rebalanceFrequency, change_notes AS changeNotes
         FROM strategy_lab_strategies
         WHERE program_id = ? AND status = 'active'
         ORDER BY strategy_name ASC`
      ).bind(programId)
    );
    return rows.map((row) => ({
      id: row.id,
      strategyName: row.strategyName,
      strategyVersion: row.strategyVersion,
      objective: row.objective,
      targetWeights: parseJson(row.targetWeightsJson, {}),
      rules: parseJson(row.rulesJson, { rebalance: row.rebalanceFrequency, switchEligible: false }),
      rebalanceFrequency: row.rebalanceFrequency,
      changeNotes: row.changeNotes
    }));
  }

  private async latestReview(portfolioId: string): Promise<LatestReviewRow | null> {
    return this.db.prepare(
      `SELECT market_date AS marketDate, market_data_snapshot_id AS marketDataSnapshotId
       FROM daily_portfolio_reviews
       WHERE portfolio_id = ? AND status = 'completed'
       ORDER BY market_date DESC
       LIMIT 1`
    ).bind(portfolioId).first<LatestReviewRow>();
  }

  private async valuationsForDate(programId: string, marketDate: string): Promise<StrategyLabValuation[]> {
    const rows = await this.valuationRows(
      `WHERE v.program_id = ? AND v.market_date = ? ORDER BY s.strategy_name ASC`,
      [programId, marketDate]
    );
    return rows.map(mapValuationRow);
  }

  private async latestValuations(programId: string): Promise<StrategyLabValuation[]> {
    const latest = await this.db.prepare("SELECT MAX(market_date) AS marketDate FROM strategy_lab_daily_valuations WHERE program_id = ?").bind(programId).first<{ marketDate: string | null }>();
    return latest?.marketDate ? this.valuationsForDate(programId, latest.marketDate) : [];
  }

  private async strategyHistory(programId: string, strategyId: string): Promise<StrategyLabValuation[]> {
    const rows = await this.valuationRows(
      `WHERE v.program_id = ? AND v.strategy_id = ? ORDER BY v.market_date ASC`,
      [programId, strategyId]
    );
    return rows.map(mapValuationRow);
  }

  private async previousPositions(programId: string): Promise<PositionRow[]> {
    const latest = await this.db.prepare("SELECT MAX(market_date) AS marketDate FROM strategy_lab_virtual_positions WHERE program_id = ?").bind(programId).first<{ marketDate: string | null }>();
    if (!latest?.marketDate) return [];
    return listRows<PositionRow>(
      this.db.prepare(
        `SELECT strategy_id AS strategyId, symbol, quantity, average_cost_usd AS averageCostUsd,
          market_value_usd AS marketValueUsd, allocation_pct AS allocationPct
         FROM strategy_lab_virtual_positions
         WHERE program_id = ? AND market_date = ?`
      ).bind(programId, latest.marketDate)
    );
  }

  private async valuationRows(whereClause: string, params: unknown[]): Promise<ValuationRow[]> {
    const statement = this.db.prepare(
      `SELECT v.strategy_id AS strategyId, s.strategy_name AS strategyName, v.market_date AS marketDate,
        v.portfolio_value_usd AS portfolioValueUsd, v.cash_usd AS cashUsd,
        v.invested_value_usd AS investedValueUsd, v.daily_return AS dailyReturn,
        v.cumulative_return AS cumulativeReturn, v.drawdown, v.high_water_mark_usd AS highWaterMarkUsd,
        v.volatility, v.sharpe_ratio AS sharpeRatio, v.sortino_ratio AS sortinoRatio,
        v.win_rate AS winRate, v.turnover, v.allocation_json AS allocationJson,
        v.risk_metrics_json AS riskMetricsJson, v.market_data_snapshot_id AS marketDataSnapshotId,
        v.data_quality_status AS dataQualityStatus
       FROM strategy_lab_daily_valuations v
       JOIN strategy_lab_strategies s ON s.id = v.strategy_id
       ${whereClause}`
    );
    return listRows<ValuationRow>(statement.bind(...params));
  }

  private async monthlyRankings(programId: string): Promise<StrategyLabMonthlyRanking[]> {
    const rows = await listRows<MonthlyRankingRow>(
      this.db.prepare(
        `SELECT ranking_month AS rankingMonth, rankings_json AS rankingsJson,
          evidence_status AS evidenceStatus, outperformance_json AS outperformanceJson
         FROM strategy_lab_monthly_rankings
         WHERE program_id = ?
         ORDER BY ranking_month DESC
         LIMIT 12`
      ).bind(programId)
    );
    return rows.map((row) => ({
      rankingMonth: row.rankingMonth,
      evidenceStatus: row.evidenceStatus,
      rankings: parseJson(row.rankingsJson, []),
      outperformance: parseJson(row.outperformanceJson, [])
    }));
  }

  private async audit(program: ProgramRow, eventType: string, message: string, details: Record<string, unknown>, now: Date): Promise<void> {
    await this.db.prepare(
      `INSERT INTO strategy_lab_audit_events (id, program_id, portfolio_id, event_type, message, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(`strategy_lab_audit_${hash(`${program.id}:${eventType}:${now.toISOString()}:${message}`)}`, program.id, program.portfolioId, eventType, message, JSON.stringify(details), now.toISOString()).run();
  }

  private async auditEvents(programId: string): Promise<StrategyLabAuditEvent[]> {
    return listRows<AuditRow>(
      this.db.prepare(
        `SELECT event_type AS eventType, message, created_at AS createdAt
         FROM strategy_lab_audit_events
         WHERE program_id = ?
         ORDER BY created_at DESC
         LIMIT 12`
      ).bind(programId)
    );
  }
}

export async function runScheduledStrategyLabs(env: Env, scheduledAt = new Date().toISOString()): Promise<StrategyLabRunResult[]> {
  const service = new StrategyEvaluationLabService(env.DB);
  return [await service.run("portfolio_ira", new Date(scheduledAt))];
}

export function rankStrategies(valuations: StrategyLabValuation[]): StrategyLabRanking[] {
  return valuations
    .map((valuation) => {
      const returnScore = (valuation.cumulativeReturn + 0.2) * 100;
      const drawdownPenalty = valuation.drawdown * 80;
      const volatilityPenalty = (valuation.volatility ?? 0) * 30;
      const sharpeBonus = (valuation.sharpeRatio ?? 0) * 4;
      return {
        strategyId: valuation.strategyId,
        strategyName: valuation.strategyName,
        rank: 0,
        returnPct: valuation.cumulativeReturn,
        drawdownPct: valuation.drawdown,
        volatilityPct: valuation.volatility,
        sharpeRatio: valuation.sharpeRatio,
        sortinoRatio: valuation.sortinoRatio,
        winRate: valuation.winRate,
        turnover: valuation.turnover,
        score: roundRatio(returnScore - drawdownPenalty - volatilityPenalty + sharpeBonus)
      };
    })
    .sort((left, right) => right.score - left.score || (right.returnPct ?? 0) - (left.returnPct ?? 0))
    .map((ranking, index) => ({ ...ranking, rank: index + 1 }));
}

export function detectOutperformance(valuations: StrategyLabValuation[], thresholds = DEFAULT_STRATEGY_LAB_THRESHOLDS): OutperformanceSignal[] {
  const baseline = valuations.find((valuation) => valuation.strategyName === "Buy & Hold");
  if (!baseline) return [];
  return valuations
    .filter((valuation) => valuation.strategyName !== "Buy & Hold")
    .map((valuation) => {
      const excess = roundRatio(valuation.cumulativeReturn - baseline.cumulativeReturn);
      const enoughEvidence = valuation.riskMetrics.returnsObserved >= thresholds.minimumValuationDays;
      const drawdownPenalty = valuation.drawdown - baseline.drawdown;
      const sharpeImprovement = (valuation.sharpeRatio ?? 0) - (baseline.sharpeRatio ?? 0);
      const statisticallyMeaningful = enoughEvidence &&
        excess >= thresholds.minimumExcessReturnPct &&
        sharpeImprovement >= thresholds.minimumSharpeImprovement &&
        drawdownPenalty <= thresholds.maximumDrawdownPenaltyPct;
      return {
        strategyName: valuation.strategyName,
        comparedWith: "Buy & Hold",
        excessReturnPct: excess,
        enoughEvidence,
        statisticallyMeaningful,
        reason: statisticallyMeaningful
          ? "Excess return, Sharpe improvement, and drawdown constraints clear the configured evidence threshold."
          : "Outperformance is not yet statistically meaningful under the configured evidence threshold."
      };
    });
}

function recommendationFromRankings(
  rankings: StrategyLabRanking[],
  outperformance: OutperformanceSignal[],
  valuations: StrategyLabValuation[],
  thresholds: StrategyLabEvidenceThresholds
): StrategySwitchRecommendation {
  const meaningful = outperformance.find((item) => item.statisticallyMeaningful);
  if (!meaningful) {
    return {
      allowed: false,
      recommendedStrategy: null,
      reason: valuations.length === 0
        ? "No lab valuations exist yet."
        : "No strategy has cleared the configurable evidence threshold. The active strategy must not be replaced automatically.",
      evidenceThresholds: thresholds
    };
  }
  const top = rankings[0];
  return {
    allowed: true,
    recommendedStrategy: top?.strategyName ?? meaningful.strategyName,
    reason: "A switch may be recommended for human review only. The lab never replaces the active strategy automatically.",
    evidenceThresholds: thresholds
  };
}

function targetPortfolio(strategy: StrategyDefinition, portfolioValue: number, snapshot: MarketDataSnapshot) {
  const positions: Array<{ symbol: string; quantity: number; averageCostUsd: number; marketValueUsd: number }> = [];
  let cash = portfolioValue * (strategy.targetWeights.cash ?? 0);
  let complete = true;
  for (const [symbol, weight] of Object.entries(strategy.targetWeights)) {
    if (symbol === "cash") continue;
    const quote = trustedQuote(snapshot.quotes.get(symbol));
    const notional = portfolioValue * weight;
    if (!quote?.lastPrice) {
      complete = false;
      cash += notional;
      continue;
    }
    positions.push({
      symbol,
      quantity: roundRatio(notional / quote.lastPrice),
      averageCostUsd: quote.lastPrice,
      marketValueUsd: roundMoney(notional)
    });
  }
  return { cash: roundMoney(cash), positions, complete };
}

function carryForwardPortfolio(strategy: StrategyDefinition, positions: PositionRow[], snapshot: MarketDataSnapshot) {
  const carried: Array<{ symbol: string; quantity: number; averageCostUsd: number; marketValueUsd: number }> = [];
  let complete = true;
  let cashPct = strategy.targetWeights.cash ?? 0;
  for (const position of positions) {
    if (position.symbol === "cash") {
      cashPct = position.allocationPct;
      continue;
    }
    const quote = trustedQuote(snapshot.quotes.get(position.symbol));
    if (!quote?.lastPrice) {
      complete = false;
      carried.push({ symbol: position.symbol, quantity: position.quantity, averageCostUsd: position.averageCostUsd, marketValueUsd: position.marketValueUsd });
    } else {
      carried.push({ symbol: position.symbol, quantity: position.quantity, averageCostUsd: position.averageCostUsd, marketValueUsd: roundMoney(position.quantity * quote.lastPrice) });
    }
  }
  const invested = carried.reduce((sum, position) => sum + position.marketValueUsd, 0);
  const cash = cashPct > 0 && cashPct < 1 ? roundMoney(invested * cashPct / (1 - cashPct)) : 0;
  return { cash, positions: carried, complete };
}

function validateSnapshot(strategies: StrategyDefinition[], snapshot: MarketDataSnapshot): string[] {
  const warnings: string[] = [];
  for (const symbol of symbolsForStrategies(strategies)) {
    const quote = snapshot.quotes.get(symbol);
    if (!trustedQuote(quote)) warnings.push(`${symbol} did not have complete trusted data for the lab snapshot.`);
  }
  return warnings;
}

function trustedQuote(quote: NormalizedQuote | undefined): NormalizedQuote | null {
  if (!quote?.lastPrice || quote.lastPrice <= 0) return null;
  if (!quote.validation.valid) return null;
  if (["Conflicting", "Anomalous", "Missing", "Provider Failure"].includes(quote.dataQualityStatus)) return null;
  return quote;
}

function symbolsForStrategies(strategies: StrategyDefinition[]): string[] {
  return [...new Set(strategies.flatMap((strategy) => Object.keys(strategy.targetWeights)).filter((symbol) => symbol !== "cash"))].sort();
}

function mapValuationRow(row: ValuationRow): StrategyLabValuation {
  return {
    strategyId: row.strategyId,
    strategyName: row.strategyName,
    marketDate: row.marketDate,
    portfolioValueUsd: row.portfolioValueUsd,
    cashUsd: row.cashUsd,
    investedValueUsd: row.investedValueUsd,
    dailyReturn: row.dailyReturn,
    cumulativeReturn: row.cumulativeReturn,
    drawdown: row.drawdown,
    highWaterMarkUsd: row.highWaterMarkUsd,
    volatility: row.volatility,
    sharpeRatio: row.sharpeRatio,
    sortinoRatio: row.sortinoRatio,
    winRate: row.winRate,
    turnover: row.turnover,
    allocation: parseJson(row.allocationJson, {}),
    riskMetrics: parseJson(row.riskMetricsJson, { maximumDrawdown: row.drawdown, latestDrawdown: row.drawdown, returnsObserved: 0 }),
    marketDataSnapshotId: row.marketDataSnapshotId,
    dataQualityStatus: row.dataQualityStatus
  };
}

function evidenceStatus(valuations: StrategyLabValuation[], thresholds: StrategyLabEvidenceThresholds): string {
  const days = Math.max(0, ...valuations.map((valuation) => valuation.riskMetrics.returnsObserved));
  return days >= thresholds.minimumValuationDays ? "threshold_met" : "preliminary";
}

function standardDeviation(values: number[]): number {
  const avg = average(values);
  return roundRatio(Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1 || 1)));
}

function sharpe(returns: number[]): number | null {
  const vol = standardDeviation(returns);
  return vol > 0 ? roundRatio(average(returns) / vol) : null;
}

function sortino(returns: number[]): number | null {
  const downside = returns.filter((value) => value < 0);
  const vol = downside.length >= 2 ? standardDeviation(downside) : 0;
  return vol > 0 ? roundRatio(average(returns) / vol) : null;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function accountDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
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
