import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";
import { addMoney, pctChange, roundMoney, subtractMoney } from "../shared/money.ts";
import { accountDate, getPortfolioValuation, type PortfolioValuation } from "./valuation.ts";

export interface DailySnapshotSummary {
  portfolioId: string;
  snapshotDate: string;
  startingCashUsd: number;
  startingPortfolioValueUsd: number;
  startingTotalAccountValueUsd: number;
  endingCashUsd: number | null;
  endingPortfolioValueUsd: number | null;
  endingTotalAccountValueUsd: number | null;
  dailyProfitLossUsd: number;
  dailyReturnPct: number;
  realizedProfitLossUsd: number;
  unrealizedProfitLossUsd: number;
  tradeCount: number;
  winningTrades: number;
  losingTrades: number;
  bestTrade: TradeResult | null;
  largestLosingTrade: TradeResult | null;
  feesUsd: number;
  highestAccountValueUsd: number;
  lowestAccountValueUsd: number;
  maximumDailyDrawdownPct: number;
  reconciled: boolean;
  reconciliationStatus: string;
}

export interface TradeResult {
  tradeId: string;
  symbol: string;
  side: string;
  profitLossUsd: number;
  executedAt: string;
}

interface SnapshotRow {
  portfolioId: string;
  snapshotDate: string;
  startingCashUsd: number;
  startingPortfolioValueUsd: number;
  startingTotalAccountValueUsd: number;
  endingCashUsd: number | null;
  endingPortfolioValueUsd: number | null;
  endingTotalAccountValueUsd: number | null;
  realizedProfitLossUsd: number | null;
  unrealizedProfitLossUsd: number | null;
  tradeCount: number;
  winningTrades: number;
  losingTrades: number;
  bestTradeJson: string | null;
  largestLosingTradeJson: string | null;
  feesUsd: number;
  highestAccountValueUsd: number | null;
  lowestAccountValueUsd: number | null;
  maxDailyDrawdownPct: number | null;
  reconciled: number;
  reconciliationStatus: string;
}

export async function ensureDailyStartSnapshot(
  db: D1Database,
  portfolioId = TIM_PORTFOLIO_ID,
  now = new Date(),
  timezone = "America/New_York"
): Promise<DailySnapshotSummary> {
  const snapshotDate = accountDate(now, timezone);
  const existing = await getDailySnapshot(db, portfolioId, snapshotDate);
  if (existing) {
    return existing;
  }
  const valuation = await getPortfolioValuation(db, portfolioId, now);
  await db
    .prepare(
      `INSERT OR IGNORE INTO account_daily_snapshots (
        id, portfolio_id, snapshot_date, account_timezone,
        starting_cash_usd, starting_portfolio_value_usd,
        starting_total_account_value_usd, holdings_start_json,
        open_positions_start, start_data_timestamp, highest_account_value_usd,
        lowest_account_value_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      `daily_${portfolioId}_${snapshotDate}`,
      portfolioId,
      snapshotDate,
      timezone,
      valuation.cashUsd,
      valuation.portfolioValueUsd,
      valuation.totalAccountValueUsd,
      JSON.stringify(valuation.positions),
      valuation.positions.length,
      valuation.lastSuccessfulMarketDataUpdateTime ?? valuation.valuationTimestamp,
      valuation.totalAccountValueUsd,
      valuation.totalAccountValueUsd
    )
    .run();
  return (await getDailySnapshot(db, portfolioId, snapshotDate)) as DailySnapshotSummary;
}

export async function completeDailySnapshot(
  db: D1Database,
  portfolioId = TIM_PORTFOLIO_ID,
  now = new Date(),
  timezone = "America/New_York"
): Promise<DailySnapshotSummary> {
  const start = await ensureDailyStartSnapshot(db, portfolioId, now, timezone);
  const valuation = await getPortfolioValuation(db, portfolioId, now);
  const trades = await tradesForDate(db, portfolioId, start.snapshotDate, timezone);
  const tradeResults = calculateTradeResults(trades);
  const fees = trades.reduce((sum, trade) => addMoney(sum, trade.feesUsd), 0);
  const bestTrade = tradeResults.sort((left, right) => right.profitLossUsd - left.profitLossUsd)[0] ?? null;
  const largestLosingTrade = tradeResults.filter((trade) => trade.profitLossUsd < 0).sort((left, right) => left.profitLossUsd - right.profitLossUsd)[0] ?? null;
  const highest = Math.max(start.highestAccountValueUsd, valuation.totalAccountValueUsd);
  const lowest = Math.min(start.lowestAccountValueUsd, valuation.totalAccountValueUsd);
  const maxDrawdown = highest > 0 ? (highest - lowest) / highest : 0;

  await db
    .prepare(
      `UPDATE account_daily_snapshots SET
        ending_cash_usd = ?,
        ending_portfolio_value_usd = ?,
        ending_total_account_value_usd = ?,
        daily_pl_usd = ?,
        daily_return_pct = ?,
        realized_pl_usd = ?,
        unrealized_pl_usd = ?,
        trade_count = ?,
        winning_trades = ?,
        losing_trades = ?,
        best_trade_json = ?,
        largest_losing_trade_json = ?,
        fees_usd = ?,
        highest_account_value_usd = ?,
        lowest_account_value_usd = ?,
        max_daily_drawdown_pct = ?,
        reconciled = ?,
        reconciliation_status = ?,
        updated_at = datetime('now')
       WHERE portfolio_id = ? AND snapshot_date = ?`
    )
    .bind(
      valuation.cashUsd,
      valuation.portfolioValueUsd,
      valuation.totalAccountValueUsd,
      subtractMoney(valuation.totalAccountValueUsd, start.startingTotalAccountValueUsd),
      pctChange(start.startingTotalAccountValueUsd, valuation.totalAccountValueUsd),
      valuation.realizedProfitLossUsd,
      valuation.unrealizedProfitLossUsd,
      trades.length,
      tradeResults.filter((trade) => trade.profitLossUsd > 0).length,
      tradeResults.filter((trade) => trade.profitLossUsd < 0).length,
      bestTrade ? JSON.stringify(bestTrade) : null,
      largestLosingTrade ? JSON.stringify(largestLosingTrade) : null,
      fees,
      highest,
      lowest,
      maxDrawdown,
      valuation.dataMode === "paper" ? 1 : 0,
      valuation.dataMode === "paper" ? "paper_reconciled" : "not_reconciled",
      portfolioId,
      start.snapshotDate
    )
    .run();

  return (await getDailySnapshot(db, portfolioId, start.snapshotDate)) as DailySnapshotSummary;
}

export async function getDailySnapshot(db: D1Database, portfolioId: string, snapshotDate: string): Promise<DailySnapshotSummary | null> {
  const row = await db
    .prepare(
      `SELECT portfolio_id AS portfolioId, snapshot_date AS snapshotDate,
        starting_cash_usd AS startingCashUsd,
        starting_portfolio_value_usd AS startingPortfolioValueUsd,
        starting_total_account_value_usd AS startingTotalAccountValueUsd,
        ending_cash_usd AS endingCashUsd,
        ending_portfolio_value_usd AS endingPortfolioValueUsd,
        ending_total_account_value_usd AS endingTotalAccountValueUsd,
        realized_pl_usd AS realizedProfitLossUsd,
        unrealized_pl_usd AS unrealizedProfitLossUsd,
        trade_count AS tradeCount, winning_trades AS winningTrades,
        losing_trades AS losingTrades, best_trade_json AS bestTradeJson,
        largest_losing_trade_json AS largestLosingTradeJson,
        fees_usd AS feesUsd, highest_account_value_usd AS highestAccountValueUsd,
        lowest_account_value_usd AS lowestAccountValueUsd,
        max_daily_drawdown_pct AS maxDailyDrawdownPct,
        reconciled, reconciliation_status AS reconciliationStatus
       FROM account_daily_snapshots
       WHERE portfolio_id = ? AND snapshot_date = ?`
    )
    .bind(portfolioId, snapshotDate)
    .first<SnapshotRow>();

  return row ? mapSnapshot(row) : null;
}

export async function getLatestDailySnapshots(db: D1Database, portfolioId = TIM_PORTFOLIO_ID): Promise<DailySnapshotSummary[]> {
  const rows = await listRows<SnapshotRow>(
    db
      .prepare(
        `SELECT portfolio_id AS portfolioId, snapshot_date AS snapshotDate,
          starting_cash_usd AS startingCashUsd,
          starting_portfolio_value_usd AS startingPortfolioValueUsd,
          starting_total_account_value_usd AS startingTotalAccountValueUsd,
          ending_cash_usd AS endingCashUsd,
          ending_portfolio_value_usd AS endingPortfolioValueUsd,
          ending_total_account_value_usd AS endingTotalAccountValueUsd,
          realized_pl_usd AS realizedProfitLossUsd,
          unrealized_pl_usd AS unrealizedProfitLossUsd,
          trade_count AS tradeCount, winning_trades AS winningTrades,
          losing_trades AS losingTrades, best_trade_json AS bestTradeJson,
          largest_losing_trade_json AS largestLosingTradeJson,
          fees_usd AS feesUsd, highest_account_value_usd AS highestAccountValueUsd,
          lowest_account_value_usd AS lowestAccountValueUsd,
          max_daily_drawdown_pct AS maxDailyDrawdownPct,
          reconciled, reconciliation_status AS reconciliationStatus
         FROM account_daily_snapshots
         WHERE portfolio_id = ?
         ORDER BY snapshot_date DESC
         LIMIT 30`
      )
      .bind(portfolioId)
  );
  return rows.map(mapSnapshot);
}

function mapSnapshot(row: SnapshotRow): DailySnapshotSummary {
  const ending = row.endingTotalAccountValueUsd ?? row.startingTotalAccountValueUsd;
  return {
    portfolioId: row.portfolioId,
    snapshotDate: row.snapshotDate,
    startingCashUsd: roundMoney(row.startingCashUsd),
    startingPortfolioValueUsd: roundMoney(row.startingPortfolioValueUsd),
    startingTotalAccountValueUsd: roundMoney(row.startingTotalAccountValueUsd),
    endingCashUsd: nullableMoney(row.endingCashUsd),
    endingPortfolioValueUsd: nullableMoney(row.endingPortfolioValueUsd),
    endingTotalAccountValueUsd: nullableMoney(row.endingTotalAccountValueUsd),
    dailyProfitLossUsd: subtractMoney(ending, row.startingTotalAccountValueUsd),
    dailyReturnPct: pctChange(row.startingTotalAccountValueUsd, ending),
    realizedProfitLossUsd: roundMoney(row.realizedProfitLossUsd ?? 0),
    unrealizedProfitLossUsd: roundMoney(row.unrealizedProfitLossUsd ?? 0),
    tradeCount: row.tradeCount,
    winningTrades: row.winningTrades,
    losingTrades: row.losingTrades,
    bestTrade: parseTrade(row.bestTradeJson),
    largestLosingTrade: parseTrade(row.largestLosingTradeJson),
    feesUsd: roundMoney(row.feesUsd),
    highestAccountValueUsd: roundMoney(row.highestAccountValueUsd ?? ending),
    lowestAccountValueUsd: roundMoney(row.lowestAccountValueUsd ?? ending),
    maximumDailyDrawdownPct: row.maxDailyDrawdownPct ?? 0,
    reconciled: row.reconciled === 1,
    reconciliationStatus: row.reconciliationStatus
  };
}

interface TradeRow {
  id: string;
  symbol: string;
  side: string;
  quantity: number;
  priceUsd: number;
  feesUsd: number;
  executedAt: string;
}

async function tradesForDate(db: D1Database, portfolioId: string, snapshotDate: string, timezone: string): Promise<TradeRow[]> {
  const rows = await listRows<TradeRow>(
    db
      .prepare(
        `SELECT id, symbol, side, quantity, price_usd AS priceUsd,
          fees_usd AS feesUsd, executed_at AS executedAt
         FROM trades
         WHERE portfolio_id = ?
         ORDER BY executed_at ASC`
      )
      .bind(portfolioId)
  );
  return rows.filter((trade) => accountDate(parseStoredUtc(trade.executedAt), timezone) === snapshotDate);
}

export function calculateTradeResults(trades: TradeRow[]): TradeResult[] {
  return trades.map((trade) => ({
    tradeId: trade.id,
    symbol: trade.symbol,
    side: trade.side,
    profitLossUsd: roundMoney(trade.side === "SELL" ? trade.quantity * trade.priceUsd - trade.feesUsd : -trade.feesUsd),
    executedAt: trade.executedAt
  }));
}

function nullableMoney(value: number | null): number | null {
  return value === null ? null : roundMoney(value);
}

function parseTrade(value: string | null): TradeResult | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as TradeResult;
  } catch {
    return null;
  }
}

function parseStoredUtc(value: string): Date {
  return new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}
