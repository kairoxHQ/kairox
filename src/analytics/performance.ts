import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";
import { pctChange, roundMoney, roundRatio, subtractMoney } from "../shared/money.ts";

export interface AnalyticsValuationSnapshot {
  portfolioId: string;
  valuationTimestamp: string;
  cashUsd: number;
  portfolioValueUsd: number;
  totalAccountValueUsd: number;
  realizedProfitLossUsd: number;
  unrealizedProfitLossUsd: number;
  overallReturnUsd: number;
  overallReturnPct: number;
  todayChangeUsd: number | null;
  todayChangePct: number | null;
  dataStatus: string;
}

export interface AnalyticsDailySnapshot {
  portfolioId: string;
  snapshotDate: string;
  startingTotalAccountValueUsd: number;
  endingTotalAccountValueUsd: number | null;
  dailyProfitLossUsd: number | null;
  dailyReturnPct: number | null;
  highestAccountValueUsd: number | null;
  lowestAccountValueUsd: number | null;
  maximumDailyDrawdownPct: number | null;
  tradeCount: number;
}

export interface AnalyticsChange {
  amountUsd: number;
  percentage: number;
  startValueUsd: number | null;
  endValueUsd: number;
  startTimestamp: string | null;
  endTimestamp: string | null;
}

export interface AnalyticsRecord {
  date: string;
  startingValueUsd: number;
  endingValueUsd: number;
  changeUsd: number;
  changePct: number;
  highestValueUsd: number;
  lowestValueUsd: number;
  maximumDrawdownPct: number;
  tradeCount: number;
}

export interface AnalyticsHistoryPoint {
  timestamp: string;
  totalAccountValueUsd: number;
  portfolioValueUsd: number;
  cashUsd: number;
  unrealizedProfitLossUsd: number;
  realizedProfitLossUsd: number;
  overallReturnUsd: number;
  overallReturnPct: number;
  dataStatus: string;
}

export interface PerformanceAnalyticsSummary {
  portfolioId: string;
  generatedAt: string;
  dataStatus: "empty" | "partial" | "ready";
  currentPortfolioValueUsd: number;
  currentHoldingsValueUsd: number;
  currentCashUsd: number;
  investedCapitalUsd: number;
  unrealizedGainLossUsd: number;
  unrealizedGainLossPct: number;
  dailyChange: AnalyticsChange;
  weeklyChange: AnalyticsChange;
  monthlyChange: AnalyticsChange;
  yearToDateChange: AnalyticsChange;
  allTimeReturn: AnalyticsChange;
  highestPortfolioValueUsd: number;
  lowestPortfolioValueUsd: number;
  bestDay: AnalyticsRecord | null;
  worstDay: AnalyticsRecord | null;
  maximumDrawdownPct: number;
  currentDrawdownPct: number;
  daysInvested: number;
  consecutivePositiveDays: number;
  consecutiveNegativeDays: number;
}

export interface PerformanceAnalytics {
  summary: PerformanceAnalyticsSummary;
  history: AnalyticsHistoryPoint[];
  records: AnalyticsRecord[];
}

interface PortfolioFallbackRow {
  id: string;
  cashUsd: number;
  startingBalanceUsd: number;
}

// Central read-only analytics facade for dashboard, journey, milestone, review, and future autonomy surfaces.
export class PerformanceAnalyticsService {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async getPerformance(portfolioId = TIM_PORTFOLIO_ID, now = new Date()): Promise<PerformanceAnalytics> {
    const [valuations, dailySnapshots, portfolio] = await Promise.all([
      this.getValuationSnapshots(portfolioId),
      this.getDailySnapshots(portfolioId),
      this.getPortfolioFallback(portfolioId)
    ]);
    return calculatePerformanceAnalytics({
      portfolioId,
      valuations,
      dailySnapshots,
      portfolioFallback: portfolio,
      now
    });
  }

  async getSummary(portfolioId = TIM_PORTFOLIO_ID, now = new Date()): Promise<PerformanceAnalyticsSummary> {
    return (await this.getPerformance(portfolioId, now)).summary;
  }

  async getHistory(portfolioId = TIM_PORTFOLIO_ID, now = new Date()): Promise<{ portfolioId: string; generatedAt: string; history: AnalyticsHistoryPoint[] }> {
    const performance = await this.getPerformance(portfolioId, now);
    return { portfolioId, generatedAt: performance.summary.generatedAt, history: performance.history };
  }

  async getRecords(portfolioId = TIM_PORTFOLIO_ID, now = new Date()): Promise<{ portfolioId: string; generatedAt: string; records: AnalyticsRecord[] }> {
    const performance = await this.getPerformance(portfolioId, now);
    return { portfolioId, generatedAt: performance.summary.generatedAt, records: performance.records };
  }

  private async getValuationSnapshots(portfolioId: string): Promise<AnalyticsValuationSnapshot[]> {
    const rows = await listRows<AnalyticsValuationSnapshot>(
      this.db
        .prepare(
          `SELECT portfolio_id AS portfolioId, valuation_timestamp AS valuationTimestamp,
            cash_usd AS cashUsd, portfolio_value_usd AS portfolioValueUsd,
            total_account_value_usd AS totalAccountValueUsd,
            realized_pl_usd AS realizedProfitLossUsd,
            unrealized_pl_usd AS unrealizedProfitLossUsd,
            overall_return_usd AS overallReturnUsd,
            overall_return_pct AS overallReturnPct,
            today_change_usd AS todayChangeUsd,
            today_change_pct AS todayChangePct,
            data_status AS dataStatus
           FROM valuation_snapshots
           WHERE portfolio_id = ?
           ORDER BY valuation_timestamp ASC`
        )
        .bind(portfolioId)
    );
    return rows;
  }

  private async getDailySnapshots(portfolioId: string): Promise<AnalyticsDailySnapshot[]> {
    const rows = await listRows<AnalyticsDailySnapshot>(
      this.db
        .prepare(
          `SELECT portfolio_id AS portfolioId, snapshot_date AS snapshotDate,
            starting_total_account_value_usd AS startingTotalAccountValueUsd,
            ending_total_account_value_usd AS endingTotalAccountValueUsd,
            daily_pl_usd AS dailyProfitLossUsd,
            daily_return_pct AS dailyReturnPct,
            highest_account_value_usd AS highestAccountValueUsd,
            lowest_account_value_usd AS lowestAccountValueUsd,
            max_daily_drawdown_pct AS maximumDailyDrawdownPct,
            trade_count AS tradeCount
           FROM account_daily_snapshots
           WHERE portfolio_id = ?
           ORDER BY snapshot_date ASC`
        )
        .bind(portfolioId)
    );
    return rows;
  }

  private async getPortfolioFallback(portfolioId: string): Promise<PortfolioFallbackRow | null> {
    return this.db
      .prepare("SELECT id, cash_usd AS cashUsd, starting_balance_usd AS startingBalanceUsd FROM portfolios WHERE id = ?")
      .bind(portfolioId)
      .first<PortfolioFallbackRow>();
  }
}

export function calculatePerformanceAnalytics(input: {
  portfolioId: string;
  valuations: AnalyticsValuationSnapshot[];
  dailySnapshots: AnalyticsDailySnapshot[];
  portfolioFallback?: PortfolioFallbackRow | null;
  now?: Date;
}): PerformanceAnalytics {
  const now = input.now ?? new Date();
  const valuations = [...input.valuations].sort((left, right) => new Date(left.valuationTimestamp).getTime() - new Date(right.valuationTimestamp).getTime());
  const dailySnapshots = [...input.dailySnapshots].sort((left, right) => left.snapshotDate.localeCompare(right.snapshotDate));
  const history = valuations.map(historyPoint);
  const records = dailySnapshots.map(recordFromDailySnapshot);
  const latest = valuations.at(-1);
  const firstValue = firstInvestedValue(valuations, dailySnapshots, input.portfolioFallback);
  const currentValue = latest?.totalAccountValueUsd ?? input.portfolioFallback?.cashUsd ?? 0;
  const currentHoldings = latest?.portfolioValueUsd ?? 0;
  const currentCash = latest?.cashUsd ?? input.portfolioFallback?.cashUsd ?? currentValue;
  const highLowValues = [...history.map((point) => point.totalAccountValueUsd), ...records.flatMap((record) => [record.highestValueUsd, record.lowestValueUsd])].filter(isFiniteNumber);
  const highest = highLowValues.length > 0 ? Math.max(...highLowValues) : currentValue;
  const lowest = highLowValues.length > 0 ? Math.min(...highLowValues) : currentValue;
  const bestDay = records.filter((record) => record.changeUsd > 0).sort((left, right) => right.changeUsd - left.changeUsd)[0] ?? null;
  const worstDay = records.filter((record) => record.changeUsd < 0).sort((left, right) => left.changeUsd - right.changeUsd)[0] ?? null;
  const series = normalizedSeries(valuations, dailySnapshots, currentValue);
  const maximumDrawdownPct = calculateMaximumDrawdown(series.map((point) => point.value));
  const currentDrawdownPct = highest > 0 ? roundRatio((highest - currentValue) / highest) : 0;
  const daysInvested = calculateDaysInvested(dailySnapshots, valuations);
  const streaks = calculateDailyStreaks(records);
  const dataStatus = valuations.length === 0 && dailySnapshots.length === 0 ? "empty" : valuations.length < 2 || dailySnapshots.length === 0 ? "partial" : "ready";

  return {
    summary: {
      portfolioId: input.portfolioId,
      generatedAt: now.toISOString(),
      dataStatus,
      currentPortfolioValueUsd: roundMoney(currentValue),
      currentHoldingsValueUsd: roundMoney(currentHoldings),
      currentCashUsd: roundMoney(currentCash),
      investedCapitalUsd: roundMoney(firstValue),
      unrealizedGainLossUsd: roundMoney(latest?.unrealizedProfitLossUsd ?? 0),
      unrealizedGainLossPct: currentHoldings > 0 ? roundRatio((latest?.unrealizedProfitLossUsd ?? 0) / (currentHoldings - (latest?.unrealizedProfitLossUsd ?? 0))) : 0,
      dailyChange: latest?.todayChangeUsd !== null && latest?.todayChangeUsd !== undefined
        ? changeFromValues((latest.totalAccountValueUsd - latest.todayChangeUsd), latest.totalAccountValueUsd, latest.valuationTimestamp, latest.valuationTimestamp)
        : periodChange(series, now, 1, currentValue),
      weeklyChange: periodChange(series, now, 7, currentValue),
      monthlyChange: periodChange(series, now, 30, currentValue),
      yearToDateChange: ytdChange(series, now, currentValue),
      allTimeReturn: changeFromValues(firstValue, currentValue, series[0]?.timestamp ?? null, latest?.valuationTimestamp ?? null),
      highestPortfolioValueUsd: roundMoney(highest),
      lowestPortfolioValueUsd: roundMoney(lowest),
      bestDay,
      worstDay,
      maximumDrawdownPct,
      currentDrawdownPct,
      daysInvested,
      consecutivePositiveDays: streaks.positive,
      consecutiveNegativeDays: streaks.negative
    },
    history,
    records
  };
}

export function calculateMaximumDrawdown(values: number[]): number {
  let highWater = values[0] ?? 0;
  let maxDrawdown = 0;
  for (const value of values) {
    highWater = Math.max(highWater, value);
    if (highWater > 0) {
      maxDrawdown = Math.max(maxDrawdown, (highWater - value) / highWater);
    }
  }
  return roundRatio(maxDrawdown);
}

export function calculateDailyStreaks(records: AnalyticsRecord[]): { positive: number; negative: number } {
  let positive = 0;
  let negative = 0;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const change = records[index].changeUsd;
    if (change > 0 && negative === 0) {
      positive += 1;
      continue;
    }
    if (change < 0 && positive === 0) {
      negative += 1;
      continue;
    }
    break;
  }
  return { positive, negative };
}

function historyPoint(row: AnalyticsValuationSnapshot): AnalyticsHistoryPoint {
  return {
    timestamp: row.valuationTimestamp,
    totalAccountValueUsd: roundMoney(row.totalAccountValueUsd),
    portfolioValueUsd: roundMoney(row.portfolioValueUsd),
    cashUsd: roundMoney(row.cashUsd),
    unrealizedProfitLossUsd: roundMoney(row.unrealizedProfitLossUsd),
    realizedProfitLossUsd: roundMoney(row.realizedProfitLossUsd),
    overallReturnUsd: roundMoney(row.overallReturnUsd),
    overallReturnPct: roundRatio(row.overallReturnPct),
    dataStatus: row.dataStatus
  };
}

function recordFromDailySnapshot(row: AnalyticsDailySnapshot): AnalyticsRecord {
  const ending = row.endingTotalAccountValueUsd ?? row.startingTotalAccountValueUsd;
  const change = row.dailyProfitLossUsd ?? subtractMoney(ending, row.startingTotalAccountValueUsd);
  return {
    date: row.snapshotDate,
    startingValueUsd: roundMoney(row.startingTotalAccountValueUsd),
    endingValueUsd: roundMoney(ending),
    changeUsd: roundMoney(change),
    changePct: row.dailyReturnPct ?? pctChange(row.startingTotalAccountValueUsd, ending),
    highestValueUsd: roundMoney(row.highestAccountValueUsd ?? Math.max(row.startingTotalAccountValueUsd, ending)),
    lowestValueUsd: roundMoney(row.lowestAccountValueUsd ?? Math.min(row.startingTotalAccountValueUsd, ending)),
    maximumDrawdownPct: roundRatio(row.maximumDailyDrawdownPct ?? 0),
    tradeCount: row.tradeCount
  };
}

function firstInvestedValue(
  valuations: AnalyticsValuationSnapshot[],
  dailySnapshots: AnalyticsDailySnapshot[],
  fallback?: PortfolioFallbackRow | null
): number {
  return dailySnapshots[0]?.startingTotalAccountValueUsd ?? valuations[0]?.totalAccountValueUsd ?? fallback?.startingBalanceUsd ?? fallback?.cashUsd ?? 0;
}

function normalizedSeries(valuations: AnalyticsValuationSnapshot[], dailySnapshots: AnalyticsDailySnapshot[], currentValue: number): Array<{ timestamp: string; value: number }> {
  const daily = dailySnapshots.map((row) => ({
    timestamp: `${row.snapshotDate}T23:59:59.000Z`,
    value: row.endingTotalAccountValueUsd ?? row.startingTotalAccountValueUsd
  }));
  const intraday = valuations.map((row) => ({ timestamp: row.valuationTimestamp, value: row.totalAccountValueUsd }));
  const combined = [...daily, ...intraday].filter((point) => isFiniteNumber(point.value));
  if (combined.length === 0) {
    return [{ timestamp: new Date(0).toISOString(), value: currentValue }];
  }
  return combined.sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
}

function periodChange(series: Array<{ timestamp: string; value: number }>, now: Date, daysBack: number, currentValue: number): AnalyticsChange {
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - daysBack);
  const startPoint = firstPointAtOrAfter(series, start.toISOString()) ?? series[0] ?? null;
  return startPoint ? changeFromValues(startPoint.value, currentValue, startPoint.timestamp, series.at(-1)?.timestamp ?? null) : changeFromValues(currentValue, currentValue, null, null);
}

function ytdChange(series: Array<{ timestamp: string; value: number }>, now: Date, currentValue: number): AnalyticsChange {
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const startPoint = firstPointAtOrAfter(series, start.toISOString()) ?? series[0] ?? null;
  return startPoint ? changeFromValues(startPoint.value, currentValue, startPoint.timestamp, series.at(-1)?.timestamp ?? null) : changeFromValues(currentValue, currentValue, null, null);
}

function firstPointAtOrAfter(series: Array<{ timestamp: string; value: number }>, timestamp: string): { timestamp: string; value: number } | null {
  return series.find((point) => point.timestamp >= timestamp) ?? null;
}

function changeFromValues(start: number, end: number, startTimestamp: string | null, endTimestamp: string | null): AnalyticsChange {
  return {
    amountUsd: subtractMoney(end, start),
    percentage: pctChange(start, end),
    startValueUsd: roundMoney(start),
    endValueUsd: roundMoney(end),
    startTimestamp,
    endTimestamp
  };
}

function calculateDaysInvested(dailySnapshots: AnalyticsDailySnapshot[], valuations: AnalyticsValuationSnapshot[]): number {
  if (dailySnapshots.length > 0) {
    return dailySnapshots.filter((row) => (row.endingTotalAccountValueUsd ?? row.startingTotalAccountValueUsd) > 0).length;
  }
  if (valuations.length === 0) {
    return 0;
  }
  const first = new Date(valuations[0].valuationTimestamp).getTime();
  const last = new Date(valuations.at(-1)?.valuationTimestamp ?? valuations[0].valuationTimestamp).getTime();
  return Math.max(1, Math.floor((last - first) / (24 * 60 * 60 * 1000)) + 1);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
