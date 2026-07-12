import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";

export interface PerformanceMetrics {
  startingBalanceUsd: number;
  cashUsd: number;
  positionsValueUsd: number;
  totalValueUsd: number;
  realizedProfitLossUsd: number;
  unrealizedProfitLossUsd: number;
  estimatedTransactionCostsUsd: number;
  dividendIncomeUsd: number;
  priceReturnUsd: number;
  dividendReturnUsd: number;
  totalReturnUsd: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  tradeCount: number;
  benchmarkReturns: BenchmarkReturn[];
}

export interface BenchmarkReturn {
  benchmarkName: string;
  startValueUsd: number;
  latestValueUsd: number;
  returnUsd: number;
  returnPct: number;
  priceAsOf: string;
}

interface PortfolioRow {
  cashUsd: number;
  startingBalanceUsd: number;
}

interface PositionRow {
  quantity: number;
  avgEntryPriceUsd: number;
  currentPriceUsd: number;
  marketValueUsd: number;
}

export async function calculatePerformance(db: D1Database): Promise<PerformanceMetrics> {
  const portfolio = await db
    .prepare("SELECT cash_usd AS cashUsd, starting_balance_usd AS startingBalanceUsd FROM portfolios WHERE id = ?")
    .bind(TIM_PORTFOLIO_ID)
    .first<PortfolioRow>();
  if (!portfolio) {
    throw new Error("Paper portfolio is not initialized.");
  }

  const positions = await listRows<PositionRow>(
    db
      .prepare(
        `SELECT quantity, avg_entry_price_usd AS avgEntryPriceUsd,
          current_price_usd AS currentPriceUsd, market_value_usd AS marketValueUsd
         FROM positions
         WHERE portfolio_id = ? AND quantity > 0`
      )
      .bind(TIM_PORTFOLIO_ID)
  );
  const trades = await db
    .prepare("SELECT COUNT(*) AS count, COALESCE(SUM(fees_usd), 0) AS fees FROM trades WHERE portfolio_id = ?")
    .bind(TIM_PORTFOLIO_ID)
    .first<{ count: number; fees: number }>();
  const dividends = await db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS income
       FROM dividend_events
       WHERE portfolio_id = ? AND reliability_status = 'recorded'`
    )
    .bind(TIM_PORTFOLIO_ID)
    .first<{ income: number }>();

  const positionsValueUsd = positions.reduce((sum, position) => sum + position.marketValueUsd, 0);
  const unrealizedProfitLossUsd = positions.reduce(
    (sum, position) => sum + position.quantity * (position.currentPriceUsd - position.avgEntryPriceUsd),
    0
  );
  const dividendIncomeUsd = dividends?.income ?? 0;
  const totalValueUsd = portfolio.cashUsd + positionsValueUsd;
  const totalReturnUsd = totalValueUsd + dividendIncomeUsd - portfolio.startingBalanceUsd;
  const realizedProfitLossUsd = totalReturnUsd - unrealizedProfitLossUsd - dividendIncomeUsd;
  const priceReturnUsd = totalReturnUsd - dividendIncomeUsd;
  const maxDrawdownPct = await calculateMaxDrawdown(db, portfolio.startingBalanceUsd, totalValueUsd);

  return {
    startingBalanceUsd: round(portfolio.startingBalanceUsd),
    cashUsd: round(portfolio.cashUsd),
    positionsValueUsd: round(positionsValueUsd),
    totalValueUsd: round(totalValueUsd),
    realizedProfitLossUsd: round(realizedProfitLossUsd),
    unrealizedProfitLossUsd: round(unrealizedProfitLossUsd),
    estimatedTransactionCostsUsd: round(trades?.fees ?? 0),
    dividendIncomeUsd: round(dividendIncomeUsd),
    priceReturnUsd: round(priceReturnUsd),
    dividendReturnUsd: round(dividendIncomeUsd),
    totalReturnUsd: round(totalReturnUsd),
    totalReturnPct: round(portfolio.startingBalanceUsd > 0 ? totalReturnUsd / portfolio.startingBalanceUsd : 0),
    maxDrawdownPct: round(maxDrawdownPct),
    tradeCount: trades?.count ?? 0,
    benchmarkReturns: await getBenchmarkReturns(db)
  };
}

export async function recordEquityHistory(db: D1Database, recordedAt = new Date().toISOString()): Promise<PerformanceMetrics> {
  const metrics = await calculatePerformance(db);
  await db
    .prepare(
      `INSERT OR REPLACE INTO portfolio_equity_history (
        id, portfolio_id, recorded_at, cash_usd, positions_value_usd,
        realized_pl_usd, unrealized_pl_usd, estimated_transaction_costs_usd,
        dividend_income_usd, price_return_usd, dividend_return_usd,
        total_return_usd, total_value_usd, max_drawdown_pct, benchmark_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      `equity_${recordedAt.slice(0, 16).replace(/[^0-9TZ]/g, "")}`,
      TIM_PORTFOLIO_ID,
      recordedAt,
      metrics.cashUsd,
      metrics.positionsValueUsd,
      metrics.realizedProfitLossUsd,
      metrics.unrealizedProfitLossUsd,
      metrics.estimatedTransactionCostsUsd,
      metrics.dividendIncomeUsd,
      metrics.priceReturnUsd,
      metrics.dividendReturnUsd,
      metrics.totalReturnUsd,
      metrics.totalValueUsd,
      metrics.maxDrawdownPct,
      JSON.stringify(metrics.benchmarkReturns)
    )
    .run();
  return metrics;
}

export function calculateMaxDrawdownFromSeries(values: number[]): number {
  let highWater = values[0] ?? 0;
  let maxDrawdown = 0;
  for (const value of values) {
    highWater = Math.max(highWater, value);
    if (highWater > 0) {
      maxDrawdown = Math.max(maxDrawdown, (highWater - value) / highWater);
    }
  }
  return round(maxDrawdown);
}

export function compareBenchmark(startValueUsd: number, latestValueUsd: number): { returnUsd: number; returnPct: number } {
  const returnUsd = latestValueUsd - startValueUsd;
  return {
    returnUsd: round(returnUsd),
    returnPct: round(startValueUsd > 0 ? returnUsd / startValueUsd : 0)
  };
}

async function calculateMaxDrawdown(db: D1Database, startingBalance: number, currentValue: number): Promise<number> {
  const snapshots = await listRows<{ totalValueUsd: number }>(
    db
      .prepare(
        `SELECT total_value_usd AS totalValueUsd
         FROM portfolio_equity_history
         WHERE portfolio_id = ?
         ORDER BY recorded_at ASC`
      )
      .bind(TIM_PORTFOLIO_ID)
  );
  return calculateMaxDrawdownFromSeries([startingBalance, ...snapshots.map((snapshot) => snapshot.totalValueUsd), currentValue]);
}

async function getBenchmarkReturns(db: D1Database): Promise<BenchmarkReturn[]> {
  const rows = await listRows<{
    benchmarkName: string;
    startValueUsd: number;
    latestValueUsd: number;
    priceAsOf: string;
  }>(
    db.prepare(
      `WITH latest AS (
        SELECT benchmark_name, MAX(created_at) AS created_at
        FROM benchmark_snapshots
        GROUP BY benchmark_name
      )
      SELECT b.benchmark_name AS benchmarkName, b.starting_value_usd AS startValueUsd,
        b.value_usd AS latestValueUsd, b.price_as_of AS priceAsOf
      FROM benchmark_snapshots b
      JOIN latest l ON l.benchmark_name = b.benchmark_name AND l.created_at = b.created_at
      ORDER BY b.benchmark_name`
    )
  );
  return rows.map((row) => {
    const comparison = compareBenchmark(row.startValueUsd, row.latestValueUsd);
    return {
      benchmarkName: row.benchmarkName,
      startValueUsd: round(row.startValueUsd),
      latestValueUsd: round(row.latestValueUsd),
      returnUsd: comparison.returnUsd,
      returnPct: comparison.returnPct,
      priceAsOf: row.priceAsOf
    };
  });
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
