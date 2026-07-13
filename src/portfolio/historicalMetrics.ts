import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";
import { pctChange, roundMoney, roundRatio, subtractMoney } from "../shared/money.ts";
import { calculateMaxDrawdownFromSeries } from "./performance.ts";
import { getPortfolioValuation, type PortfolioValuation } from "./valuation.ts";

export type PerformancePeriod = "today" | "week" | "month" | "year" | "since_account_creation" | "since_automation_started";

export interface HistoricalMetric {
  period: PerformancePeriod;
  startingValueUsd: number;
  endingOrCurrentValueUsd: number;
  dollarReturnUsd: number;
  percentageReturn: number;
  realizedProfitLossUsd: number;
  unrealizedProfitLossUsd: number;
  depositsUsd: number;
  withdrawalsUsd: number;
  feesUsd: number;
  netTradingReturnUsd: number;
  tradeCount: number;
  winRate: number | null;
  averageWinUsd: number | null;
  averageLossUsd: number | null;
  profitFactor: number | null;
  largestWinUsd: number | null;
  largestLossUsd: number | null;
  currentStreak: { type: "winning" | "losing" | "flat"; count: number };
  maximumDrawdownPct: number;
}

interface EquityRow {
  recordedAt: string;
  totalValueUsd: number;
  realizedProfitLossUsd: number;
  unrealizedProfitLossUsd: number;
  feesUsd: number;
}

interface TradeRow {
  side: string;
  feesUsd: number;
  executedAt: string;
}

export async function getHistoricalMetrics(db: D1Database, portfolioId = TIM_PORTFOLIO_ID, now = new Date()): Promise<HistoricalMetric[]> {
  const valuation = await getPortfolioValuation(db, portfolioId, now);
  const periods: PerformancePeriod[] = ["today", "week", "month", "year", "since_account_creation", "since_automation_started"];
  return Promise.all(periods.map((period) => calculateHistoricalMetric(db, portfolioId, valuation, period, now)));
}

export async function calculateHistoricalMetric(
  db: D1Database,
  portfolioId: string,
  current: PortfolioValuation,
  period: PerformancePeriod,
  now = new Date()
): Promise<HistoricalMetric> {
  const start = periodStart(period, now);
  const rows = await listRows<EquityRow>(
    db
      .prepare(
        `SELECT recorded_at AS recordedAt, total_value_usd AS totalValueUsd,
          realized_pl_usd AS realizedProfitLossUsd,
          unrealized_pl_usd AS unrealizedProfitLossUsd,
          estimated_transaction_costs_usd AS feesUsd
         FROM portfolio_equity_history
         WHERE portfolio_id = ? AND recorded_at >= ?
         ORDER BY recorded_at ASC`
      )
      .bind(portfolioId, start)
  );
  const trades = await listRows<TradeRow>(
    db
      .prepare(
        `SELECT side, fees_usd AS feesUsd, executed_at AS executedAt
         FROM trades
         WHERE portfolio_id = ? AND executed_at >= ?
         ORDER BY executed_at ASC`
      )
      .bind(portfolioId, start)
  );
  const startValue = rows[0]?.totalValueUsd ?? current.totalAccountValueUsd;
  const tradeOutcomes = inferTradeOutcomes(trades);
  const wins = tradeOutcomes.filter((value) => value > 0);
  const losses = tradeOutcomes.filter((value) => value < 0);
  const grossWin = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));

  return {
    period,
    startingValueUsd: roundMoney(startValue),
    endingOrCurrentValueUsd: current.totalAccountValueUsd,
    dollarReturnUsd: subtractMoney(current.totalAccountValueUsd, startValue),
    percentageReturn: pctChange(startValue, current.totalAccountValueUsd),
    realizedProfitLossUsd: current.realizedProfitLossUsd,
    unrealizedProfitLossUsd: current.unrealizedProfitLossUsd,
    depositsUsd: 0,
    withdrawalsUsd: 0,
    feesUsd: roundMoney(trades.reduce((sum, trade) => sum + trade.feesUsd, 0)),
    netTradingReturnUsd: subtractMoney(subtractMoney(current.totalAccountValueUsd, startValue), 0),
    tradeCount: trades.length,
    winRate: tradeOutcomes.length > 0 ? roundRatio(wins.length / tradeOutcomes.length) : null,
    averageWinUsd: wins.length > 0 ? roundMoney(grossWin / wins.length) : null,
    averageLossUsd: losses.length > 0 ? roundMoney(grossLoss / losses.length) : null,
    profitFactor: grossLoss > 0 ? roundRatio(grossWin / grossLoss) : grossWin > 0 ? null : null,
    largestWinUsd: wins.length > 0 ? roundMoney(Math.max(...wins)) : null,
    largestLossUsd: losses.length > 0 ? roundMoney(Math.min(...losses)) : null,
    currentStreak: calculateStreak(tradeOutcomes),
    maximumDrawdownPct: calculateMaxDrawdownFromSeries([...rows.map((row) => row.totalValueUsd), current.totalAccountValueUsd])
  };
}

function periodStart(period: PerformancePeriod, now: Date): string {
  const start = new Date(now);
  if (period === "today") {
    start.setUTCHours(0, 0, 0, 0);
  } else if (period === "week") {
    start.setUTCDate(start.getUTCDate() - 7);
  } else if (period === "month") {
    start.setUTCMonth(start.getUTCMonth() - 1);
  } else if (period === "year") {
    start.setUTCFullYear(start.getUTCFullYear() - 1);
  } else {
    return "1970-01-01T00:00:00.000Z";
  }
  return start.toISOString();
}

function inferTradeOutcomes(trades: TradeRow[]): number[] {
  return trades.map((trade) => (trade.side === "SELL" ? -trade.feesUsd : -trade.feesUsd));
}

export function calculateStreak(outcomes: number[]): { type: "winning" | "losing" | "flat"; count: number } {
  const last = outcomes.at(-1);
  if (!last || last === 0) {
    return { type: "flat", count: 0 };
  }
  const type = last > 0 ? "winning" : "losing";
  let count = 0;
  for (let index = outcomes.length - 1; index >= 0; index -= 1) {
    if ((type === "winning" && outcomes[index] > 0) || (type === "losing" && outcomes[index] < 0)) {
      count += 1;
    } else {
      break;
    }
  }
  return { type, count };
}
