import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";
import { calculatePerformance } from "../portfolio/performance.ts";
import { listEnabledWatchlistAssets } from "../market/assets.ts";
import { getMarketDataStatuses } from "../market/status.ts";
import { sanitizeForUser } from "../shared/messages.ts";
import { getLatestDailySnapshots, type DailySnapshotSummary } from "../portfolio/dailySnapshots.ts";
import { getPortfolioValuation, type PortfolioValuation } from "../portfolio/valuation.ts";

export async function generateSummaries(db: D1Database, now = new Date()): Promise<void> {
  const date = now.toISOString().slice(0, 10);
  const performance = await calculatePerformance(db);
  const positions = await listRows<{ symbol: string; quantity: number; marketValueUsd: number }>(
    db
      .prepare(
        `SELECT symbol, quantity, market_value_usd AS marketValueUsd
         FROM positions
         WHERE portfolio_id = ? AND quantity > 0
         ORDER BY market_value_usd DESC`
      )
      .bind(TIM_PORTFOLIO_ID)
  );
  const trades = await listRows<{ symbol: string; side: string; quantity: number; priceUsd: number; feesUsd: number }>(
    db
      .prepare(
        `SELECT symbol, side, quantity, price_usd AS priceUsd, fees_usd AS feesUsd
         FROM trades
         WHERE portfolio_id = ? AND date(executed_at) = date(?)
         ORDER BY executed_at DESC`
      )
      .bind(TIM_PORTFOLIO_ID, date)
  );
  const rejected = await listRows<{ symbol: string; action: string; explanation: string }>(
    db
      .prepare(
        `SELECT symbol, action, explanation
         FROM recommendations
         WHERE portfolio_id = ? AND action = 'DO_NOTHING'
           AND explanation NOT LIKE 'Market data temporarily unavailable%'
           AND explanation NOT LIKE '%latest quote was stale%'
         ORDER BY created_at DESC
         LIMIT 5`
      )
      .bind(TIM_PORTFOLIO_ID)
  );
  const dividends = await listRows<{ symbol: string; amountUsd: number; explanation: string }>(
    db
      .prepare(
        `SELECT symbol, amount_usd AS amountUsd, explanation
         FROM dividend_events
         WHERE portfolio_id = ? AND date(created_at) = date(?)
         ORDER BY created_at DESC`
      )
      .bind(TIM_PORTFOLIO_ID, date)
  );
  const marketIssues = await listRows<{ symbol: string; error: string }>(
    db.prepare(
      `SELECT symbol, error
       FROM market_snapshots
       WHERE validation_status != 'validated'
       ORDER BY created_at DESC
       LIMIT 5`
    )
  );
  const marketStatuses = await getMarketDataStatuses(db) as Array<{ symbol: string; userMessage: string }>;
  const watchlistAssets = await listEnabledWatchlistAssets(db);
  const watchedSymbols = watchlistAssets.map((asset) => asset.symbol);
  const marketStatusText = marketStatuses.length
    ? marketStatuses.map((status) => `${status.symbol}: ${summaryStatusMessage(status)}`).join("; ")
    : "none recorded";

  await upsertSummary(db, "morning", date, "Morning Kairox paper-trading summary", [
    `Portfolio value: $${performance.totalValueUsd}.`,
    `Overnight crypto activity is reflected in the latest crypto market snapshots when available.`,
    `Previous result: total return $${performance.totalReturnUsd}.`,
    `Positions held: ${positions.length ? positions.map((position) => position.symbol).join(", ") : "none"}.`,
    `Market data status: ${marketStatusText}.`,
    `Watching ${watchedSymbols.length ? watchedSymbols.join(", ") : "the enabled asset watchlist"} for validated momentum, moving-average, RSI, risk, and market-hours conditions.`
  ], { performance, positions, marketStatuses });

  await upsertSummary(db, "end_of_day", date, "End-of-day Kairox paper-trading summary", [
    `Trades made: ${trades.length}.`,
    `Trades rejected or skipped: ${rejected.length}.`,
    `Portfolio change: total return $${performance.totalReturnUsd}, price return $${performance.priceReturnUsd}, dividend return $${performance.dividendReturnUsd}.`,
    `Benchmark comparison: ${performance.benchmarkReturns.map((b) => `${b.benchmarkName} ${formatPct(b.returnPct)}`).join(", ") || "unavailable"}.`,
    `Fees/spreads charged: $${performance.estimatedTransactionCostsUsd}.`,
    `Dividend activity: ${dividends.length ? dividends.map((d) => `${d.symbol} $${d.amountUsd}`).join(", ") : "none recorded"}.`,
    `Current positions: ${positions.length ? positions.map((position) => position.symbol).join(", ") : "none"}.`,
    `Market data status: ${marketStatusText}.`
  ], { performance, trades, rejected, dividends, positions, marketStatuses });
}

export async function getSummaries(db: D1Database): Promise<unknown> {
  const rows = await listRows<{
    summaryType: string;
    summaryDate: string;
    title: string;
    body: string;
    createdAt: string;
  }>(
    db.prepare(
      `SELECT summary_type AS summaryType, summary_date AS summaryDate,
        title, body, created_at AS createdAt
       FROM system_summaries
       ORDER BY summary_date DESC, summary_type ASC
       LIMIT 20`
    )
  );

  return {
    summaries: rows.map((row) => ({
      ...row,
      body: sanitizeForUser(row.body, "Summary includes only user-safe market and portfolio information.")
    }))
  };
}

export async function getDailySummaryData(db: D1Database, portfolioId = TIM_PORTFOLIO_ID): Promise<unknown> {
  const [valuation, snapshots, marketStatuses] = await Promise.all([
    getPortfolioValuation(db, portfolioId),
    getLatestDailySnapshots(db, portfolioId),
    getMarketDataStatuses(db) as Promise<Array<{ symbol: string; status?: string; isFresh?: boolean; userMessage: string }>>
  ]);
  const latest = snapshots[0] ?? emptySnapshot(valuation);
  return buildDailySummary(valuation, latest, marketStatuses);
}

export function buildDailySummary(
  valuation: PortfolioValuation,
  snapshot: DailySnapshotSummary,
  marketStatuses: Array<{ symbol: string; status?: string; isFresh?: boolean; userMessage: string }>
) {
  const marketDataHealth = marketStatuses.length
    ? marketStatuses.map((status) => ({ symbol: status.symbol, message: summaryStatusMessage(status) }))
    : [{ symbol: "portfolio", message: "No market-data status records are available yet." }];
  const tradesTaken = snapshot.tradeCount;
  const beginnerSummary =
    tradesTaken === 0
      ? `Kairox made no trades today. The account is ${valuation.dataStatus === "live" ? "using live market data" : `showing ${valuation.dataStatus} market data`}.`
      : `Kairox recorded ${tradesTaken} paper trade${tradesTaken === 1 ? "" : "s"} today.`;

  return {
    date: snapshot.snapshotDate,
    startingAccountValueUsd: snapshot.startingTotalAccountValueUsd,
    endingAccountValueUsd: snapshot.endingTotalAccountValueUsd ?? valuation.totalAccountValueUsd,
    dailyDollarChangeUsd: snapshot.dailyProfitLossUsd,
    dailyPercentageChange: snapshot.dailyReturnPct,
    tradesTaken,
    winningTrades: snapshot.winningTrades,
    losingTrades: snapshot.losingTrades,
    bestTrade: snapshot.bestTrade,
    largestLoss: snapshot.largestLosingTrade,
    feesUsd: snapshot.feesUsd,
    dailyDrawdown: snapshot.maximumDailyDrawdownPct,
    riskLimitStatus: valuation.dataStatus === "stale" || valuation.dataStatus === "unavailable" ? "Market-data guard active" : "Within configured paper limits",
    marketDataHealth,
    kairoxStatus: valuation.dataStatus === "unavailable" ? "waiting" : "watching",
    beginnerSummary,
    advancedSummary: {
      valuationTimestamp: valuation.valuationTimestamp,
      dataStatus: valuation.dataStatus,
      realizedProfitLossUsd: snapshot.realizedProfitLossUsd,
      unrealizedProfitLossUsd: snapshot.unrealizedProfitLossUsd,
      highestAccountValueUsd: snapshot.highestAccountValueUsd,
      lowestAccountValueUsd: snapshot.lowestAccountValueUsd,
      reconciled: snapshot.reconciled,
      reconciliationStatus: snapshot.reconciliationStatus
    }
  };
}

async function upsertSummary(
  db: D1Database,
  type: "morning" | "end_of_day",
  date: string,
  title: string,
  lines: string[],
  data: unknown
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO system_summaries (
        id, summary_type, summary_date, title, body, data_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(summary_type, summary_date) DO UPDATE SET
        title = excluded.title,
        body = excluded.body,
        data_json = excluded.data_json,
        created_at = datetime('now')`
    )
    .bind(`summary_${type}_${date}`, type, date, title, lines.join("\n"), JSON.stringify(data))
    .run();
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function summaryStatusMessage(status: { status?: string; isFresh?: boolean; userMessage: string }): string {
  if (status.isFresh || status.status === "validated") {
    return "Fresh quote available.";
  }
  if (status.status === "cached") {
    return "Using a recent cached market snapshot.";
  }
  if (/stale/i.test(status.userMessage)) {
    return "Latest quote is stale; evaluation may be deferred.";
  }
  return sanitizeForUser(status.userMessage, "Market data temporarily unavailable; no trade was made.");
}

function emptySnapshot(valuation: PortfolioValuation): DailySnapshotSummary {
  return {
    portfolioId: valuation.portfolioId,
    snapshotDate: valuation.valuationTimestamp.slice(0, 10),
    startingCashUsd: valuation.cashUsd,
    startingPortfolioValueUsd: valuation.portfolioValueUsd,
    startingTotalAccountValueUsd: valuation.totalAccountValueUsd,
    endingCashUsd: null,
    endingPortfolioValueUsd: null,
    endingTotalAccountValueUsd: null,
    dailyProfitLossUsd: 0,
    dailyReturnPct: 0,
    realizedProfitLossUsd: 0,
    unrealizedProfitLossUsd: valuation.unrealizedProfitLossUsd,
    tradeCount: 0,
    winningTrades: 0,
    losingTrades: 0,
    bestTrade: null,
    largestLosingTrade: null,
    feesUsd: 0,
    highestAccountValueUsd: valuation.totalAccountValueUsd,
    lowestAccountValueUsd: valuation.totalAccountValueUsd,
    maximumDailyDrawdownPct: 0,
    reconciled: valuation.dataMode === "paper",
    reconciliationStatus: "no_daily_snapshot_yet"
  };
}
