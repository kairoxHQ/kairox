import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";
import { addMoney, multiplyMoney, pctChange, roundMoney, roundRatio, subtractMoney } from "../shared/money.ts";

export type ValuationDataStatus = "live" | "delayed" | "stale" | "unavailable";

export interface PositionInput {
  id?: string;
  symbol: string;
  assetClass: string;
  quantity: number;
  avgEntryPriceUsd: number;
  fallbackPriceUsd: number;
  fallbackMarketValueUsd: number;
  latestPriceUsd?: number | null;
  latestPriceAsOf?: string | null;
  latestDataStatus?: ValuationDataStatus | null;
}

export interface ValuedPosition {
  symbol: string;
  assetClass: string;
  quantity: number;
  averageCostBasisUsd: number;
  currentMarketPriceUsd: number | null;
  currentPositionValueUsd: number;
  unrealizedProfitLossUsd: number;
  unrealizedProfitLossPct: number;
  realizedProfitLossUsd: number;
  dataStatus: ValuationDataStatus;
  priceTimestamp: string | null;
}

export interface PortfolioValuationInput {
  portfolioId: string;
  startingBalanceUsd: number;
  availableCashUsd: number;
  positions: PositionInput[];
  realizedProfitLossUsd: number;
  feesUsd: number;
  todayStartingTotalAccountValueUsd?: number | null;
  valuationTimestamp: string;
}

export interface PortfolioValuation {
  portfolioId: string;
  valuationTimestamp: string;
  positions: ValuedPosition[];
  availableCashUsd: number;
  cashUsd: number;
  portfolioValueUsd: number;
  totalPortfolioValueUsd: number;
  totalAccountValueUsd: number;
  realizedProfitLossUsd: number;
  unrealizedProfitLossUsd: number;
  feesUsd: number;
  todayChangeUsd: number;
  todayChangePct: number;
  overallReturnUsd: number;
  overallReturnPct: number;
  lastSuccessfulMarketDataUpdateTime: string | null;
  dataStatus: ValuationDataStatus;
  dataMode: "paper" | "simulated" | "live";
}

interface PortfolioRow {
  id: string;
  cashUsd: number;
  startingBalanceUsd: number;
}

interface PositionRow {
  id: string;
  symbol: string;
  assetClass: string;
  quantity: number;
  avgEntryPriceUsd: number;
  currentPriceUsd: number;
  marketValueUsd: number;
}

interface PriceRow {
  symbol: string;
  priceUsd: number;
  priceAsOf: string;
  validationStatus: string;
  createdAt: string;
}

export async function getPortfolioValuation(db: D1Database, portfolioId = TIM_PORTFOLIO_ID, now = new Date()): Promise<PortfolioValuation> {
  const portfolio = await db
    .prepare("SELECT id, cash_usd AS cashUsd, starting_balance_usd AS startingBalanceUsd FROM portfolios WHERE id = ?")
    .bind(portfolioId)
    .first<PortfolioRow>();
  if (!portfolio) {
    throw new Error("Portfolio is not initialized.");
  }

  const positions = await listRows<PositionRow>(
    db
      .prepare(
        `SELECT id, symbol, asset_class AS assetClass, quantity,
          avg_entry_price_usd AS avgEntryPriceUsd, current_price_usd AS currentPriceUsd,
          market_value_usd AS marketValueUsd
         FROM positions
         WHERE portfolio_id = ? AND quantity > 0
         ORDER BY symbol`
      )
      .bind(portfolioId)
  );
  const latestPrices = await latestPricesBySymbol(db);
  const trades = await db
    .prepare("SELECT COALESCE(SUM(fees_usd), 0) AS fees FROM trades WHERE portfolio_id = ?")
    .bind(portfolioId)
    .first<{ fees: number }>();
  const todayStart = await db
    .prepare(
      `SELECT starting_total_account_value_usd AS startingTotalAccountValueUsd
       FROM account_daily_snapshots
       WHERE portfolio_id = ? AND snapshot_date = ?
       LIMIT 1`
    )
    .bind(portfolioId, accountDate(now, "America/New_York"))
    .first<{ startingTotalAccountValueUsd: number }>();

  return calculatePortfolioValuation({
    portfolioId,
    startingBalanceUsd: portfolio.startingBalanceUsd,
    availableCashUsd: portfolio.cashUsd,
    positions: positions.map((position) => {
      const latest = latestPrices.get(position.symbol);
      return {
        symbol: position.symbol,
        assetClass: position.assetClass,
        quantity: position.quantity,
        avgEntryPriceUsd: position.avgEntryPriceUsd,
        fallbackPriceUsd: position.currentPriceUsd,
        fallbackMarketValueUsd: position.marketValueUsd,
        latestPriceUsd: latest?.priceUsd ?? null,
        latestPriceAsOf: latest?.priceAsOf ?? null,
        latestDataStatus: latest ? classifyPriceStatus(latest, now) : "unavailable"
      };
    }),
    realizedProfitLossUsd: 0,
    feesUsd: trades?.fees ?? 0,
    todayStartingTotalAccountValueUsd: todayStart?.startingTotalAccountValueUsd ?? null,
    valuationTimestamp: now.toISOString()
  });
}

export function calculatePortfolioValuation(input: PortfolioValuationInput): PortfolioValuation {
  const positions = input.positions.map(valuePosition);
  const portfolioValueUsd = positions.reduce((sum, position) => addMoney(sum, position.currentPositionValueUsd), 0);
  const totalAccountValueUsd = addMoney(input.availableCashUsd, portfolioValueUsd);
  const unrealizedProfitLossUsd = positions.reduce((sum, position) => addMoney(sum, position.unrealizedProfitLossUsd), 0);
  const overallReturnUsd = subtractMoney(totalAccountValueUsd, input.startingBalanceUsd);
  const todayStart = input.todayStartingTotalAccountValueUsd ?? totalAccountValueUsd;
  const latestMarketTime = latestTimestamp(positions.map((position) => position.priceTimestamp).filter(Boolean) as string[]);
  const status = combineStatuses(positions.map((position) => position.dataStatus));

  return {
    portfolioId: input.portfolioId,
    valuationTimestamp: input.valuationTimestamp,
    positions,
    availableCashUsd: roundMoney(input.availableCashUsd),
    cashUsd: roundMoney(input.availableCashUsd),
    portfolioValueUsd,
    totalPortfolioValueUsd: portfolioValueUsd,
    totalAccountValueUsd,
    realizedProfitLossUsd: roundMoney(input.realizedProfitLossUsd),
    unrealizedProfitLossUsd,
    feesUsd: roundMoney(input.feesUsd),
    todayChangeUsd: subtractMoney(totalAccountValueUsd, todayStart),
    todayChangePct: pctChange(todayStart, totalAccountValueUsd),
    overallReturnUsd,
    overallReturnPct: pctChange(input.startingBalanceUsd, totalAccountValueUsd),
    lastSuccessfulMarketDataUpdateTime: latestMarketTime,
    dataStatus: status,
    dataMode: "paper"
  };
}

export function valuePosition(input: PositionInput): ValuedPosition {
  const price = input.latestPriceUsd && input.latestPriceUsd > 0 ? input.latestPriceUsd : input.fallbackPriceUsd;
  const status = input.latestPriceUsd && input.latestPriceUsd > 0 ? (input.latestDataStatus ?? "delayed") : "stale";
  const value = multiplyMoney(price, input.quantity);
  const cost = multiplyMoney(input.avgEntryPriceUsd, input.quantity);
  const unrealized = subtractMoney(value, cost);

  return {
    symbol: input.symbol,
    assetClass: input.assetClass,
    quantity: input.quantity,
    averageCostBasisUsd: roundMoney(input.avgEntryPriceUsd),
    currentMarketPriceUsd: price > 0 ? roundMoney(price) : null,
    currentPositionValueUsd: value,
    unrealizedProfitLossUsd: unrealized,
    unrealizedProfitLossPct: cost > 0 ? roundRatio(unrealized / cost) : 0,
    realizedProfitLossUsd: 0,
    dataStatus: status,
    priceTimestamp: input.latestPriceAsOf ?? null
  };
}

export async function recordValuationSnapshot(db: D1Database, valuation: PortfolioValuation, timezone = "America/New_York"): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO valuation_snapshots (
        id, portfolio_id, valuation_timestamp, account_timezone, cash_usd,
        portfolio_value_usd, total_account_value_usd, realized_pl_usd,
        unrealized_pl_usd, overall_return_usd, overall_return_pct,
        today_change_usd, today_change_pct, data_status, last_market_data_at,
        positions_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      `valuation_${valuation.portfolioId}_${valuation.valuationTimestamp.slice(0, 16).replace(/[^0-9TZ]/g, "")}`,
      valuation.portfolioId,
      valuation.valuationTimestamp,
      timezone,
      valuation.cashUsd,
      valuation.portfolioValueUsd,
      valuation.totalAccountValueUsd,
      valuation.realizedProfitLossUsd,
      valuation.unrealizedProfitLossUsd,
      valuation.overallReturnUsd,
      valuation.overallReturnPct,
      valuation.todayChangeUsd,
      valuation.todayChangePct,
      valuation.dataStatus,
      valuation.lastSuccessfulMarketDataUpdateTime,
      JSON.stringify(valuation.positions)
    )
    .run();
}

function combineStatuses(statuses: ValuationDataStatus[]): ValuationDataStatus {
  if (statuses.length === 0) {
    return "unavailable";
  }
  if (statuses.some((status) => status === "unavailable")) {
    return "unavailable";
  }
  if (statuses.some((status) => status === "stale")) {
    return "stale";
  }
  if (statuses.some((status) => status === "delayed")) {
    return "delayed";
  }
  return "live";
}

async function latestPricesBySymbol(db: D1Database): Promise<Map<string, PriceRow>> {
  const rows = await listRows<PriceRow>(
    db.prepare(
      `SELECT ms.symbol, ms.price_usd AS priceUsd, ms.price_as_of AS priceAsOf,
        ms.validation_status AS validationStatus, ms.created_at AS createdAt
       FROM market_snapshots ms
       JOIN (
         SELECT symbol, MAX(created_at) AS createdAt
         FROM market_snapshots
         WHERE validation_status = 'validated' AND price_usd > 0
         GROUP BY symbol
       ) latest ON latest.symbol = ms.symbol AND latest.createdAt = ms.created_at`
    )
  );
  return new Map(rows.map((row) => [row.symbol, row]));
}

function classifyPriceStatus(row: PriceRow, now: Date): ValuationDataStatus {
  const ageSeconds = Math.max(0, Math.floor((now.getTime() - new Date(row.createdAt).getTime()) / 1000));
  if (row.validationStatus !== "validated") {
    return "unavailable";
  }
  if (row.symbol.endsWith("-USD")) {
    return ageSeconds <= 5 * 60 ? "live" : ageSeconds <= 30 * 60 ? "delayed" : "stale";
  }
  return ageSeconds <= 30 * 60 ? "delayed" : ageSeconds <= 4 * 24 * 60 * 60 ? "stale" : "unavailable";
}

function latestTimestamp(values: string[]): string | null {
  if (values.length === 0) {
    return null;
  }
  return values.sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
}

export function accountDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}
