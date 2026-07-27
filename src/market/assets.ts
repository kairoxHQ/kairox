import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";
import type { AssetClass } from "../shared/types.ts";
import { getLinkedPortfolioAccount } from "../portfolio/accountTypes.ts";

export const ASSET_TYPES = ["stock", "etf", "mutual_fund", "crypto", "reit", "bond_fund", "money_market"] as const;
export const MARKET_HOURS_MODES = ["continuous", "us_regular", "fund_end_of_day", "cash_equivalent", "disabled"] as const;

export type AssetType = (typeof ASSET_TYPES)[number];
export type MarketHoursMode = (typeof MARKET_HOURS_MODES)[number];

export interface AssetRegistryRecord {
  id: string;
  symbol: string;
  displayName: string;
  assetType: AssetType;
  market: string;
  currency: string;
  providerSymbol: string;
  enabled: boolean;
  tradable: boolean;
  fractionalSupported: boolean;
  dividendCapable: boolean;
  expenseRatio: number | null;
  minimumInvestment: number | null;
  marketHoursMode: MarketHoursMode;
  pricePrecision: number;
  quantityPrecision: number;
  rankingPriority?: number;
  notes?: string | null;
}

export const NO_ENABLED_CANDIDATES = "NO_ENABLED_CANDIDATES";

export type CandidateUniverseSource = "watchlist_assets" | "paper_twin_positions" | "none";

export interface CandidateUniverse {
  assets: AssetRegistryRecord[];
  source: CandidateUniverseSource;
  reason: typeof NO_ENABLED_CANDIDATES | null;
}

interface AssetRow {
  id: string;
  symbol: string;
  displayName: string;
  assetType: string;
  market: string;
  currency: string;
  providerSymbol: string;
  enabled: number;
  tradable: number;
  fractionalSupported: number;
  dividendCapable: number;
  expenseRatio: number | null;
  minimumInvestment: number | null;
  marketHoursMode: string;
  pricePrecision: number;
  quantityPrecision: number;
  rankingPriority?: number;
  notes?: string | null;
}

interface PositionAssetRow extends Partial<AssetRow> {
  positionSymbol: string;
  positionAssetClass: string;
}

export async function listEnabledWatchlistAssets(db: D1Database, portfolioId = TIM_PORTFOLIO_ID): Promise<AssetRegistryRecord[]> {
  const rows = await listRows<AssetRow>(
    db
      .prepare(
        `SELECT
          a.id,
          a.symbol,
          a.display_name AS displayName,
          a.asset_type AS assetType,
          a.market,
          a.currency,
          a.provider_symbol AS providerSymbol,
          a.enabled,
          a.tradable,
          a.fractional_supported AS fractionalSupported,
          a.dividend_capable AS dividendCapable,
          a.expense_ratio AS expenseRatio,
          a.minimum_investment AS minimumInvestment,
          a.market_hours_mode AS marketHoursMode,
          a.price_precision AS pricePrecision,
          a.quantity_precision AS quantityPrecision,
          wa.ranking_priority AS rankingPriority,
          wa.notes
         FROM watchlists w
         JOIN watchlist_assets wa ON wa.watchlist_id = w.id
         JOIN assets a ON a.id = wa.asset_id
         WHERE w.portfolio_id = ?
           AND w.enabled = 1
           AND wa.enabled = 1
           AND a.enabled = 1
         ORDER BY wa.ranking_priority ASC, a.symbol ASC`
      )
      .bind(portfolioId)
  );

  return rows.map(parseAssetRow);
}

export async function resolvePaperCandidateUniverse(db: D1Database, portfolioId = TIM_PORTFOLIO_ID): Promise<CandidateUniverse> {
  const watchlistAssets = dedupeAssets(await listEnabledWatchlistAssets(db, portfolioId));
  if (watchlistAssets.length > 0) {
    return { assets: watchlistAssets, source: "watchlist_assets", reason: null };
  }

  const account = await getLinkedPortfolioAccount(db, portfolioId);
  if (account.readOnly) {
    return { assets: [], source: "none", reason: NO_ENABLED_CANDIDATES };
  }
  const canUsePositionUniverse = account.accountType === "paper_portfolio_twin" || await isStrategyExperimentPortfolio(db, portfolioId);
  if (!canUsePositionUniverse) {
    return { assets: [], source: "none", reason: NO_ENABLED_CANDIDATES };
  }

  const positionAssets = dedupeAssets(await listEnabledPositionAssets(db, portfolioId));
  return positionAssets.length > 0
    ? { assets: positionAssets, source: "paper_twin_positions", reason: null }
    : { assets: [], source: "none", reason: NO_ENABLED_CANDIDATES };
}

async function isStrategyExperimentPortfolio(db: D1Database, portfolioId: string): Promise<boolean> {
  try {
    const row = await db.prepare("SELECT portfolio_id AS portfolioId FROM strategy_experiment_portfolios WHERE portfolio_id = ? LIMIT 1").bind(portfolioId).first<{ portfolioId: string }>();
    return !!row;
  } catch (error) {
    if (/strategy_experiment_portfolios|no such table/i.test(error instanceof Error ? error.message : String(error))) {
      return false;
    }
    throw error;
  }
}

async function listEnabledPositionAssets(db: D1Database, portfolioId: string): Promise<AssetRegistryRecord[]> {
  const rows = await listRows<PositionAssetRow>(
    db
      .prepare(
        `SELECT
          p.symbol AS positionSymbol,
          p.asset_class AS positionAssetClass,
          a.id,
          a.symbol,
          a.display_name AS displayName,
          a.asset_type AS assetType,
          a.market,
          a.currency,
          a.provider_symbol AS providerSymbol,
          a.enabled,
          a.tradable,
          a.fractional_supported AS fractionalSupported,
          a.dividend_capable AS dividendCapable,
          a.expense_ratio AS expenseRatio,
          a.minimum_investment AS minimumInvestment,
          a.market_hours_mode AS marketHoursMode,
          a.price_precision AS pricePrecision,
          a.quantity_precision AS quantityPrecision,
          NULL AS rankingPriority,
          NULL AS notes
         FROM positions p
         LEFT JOIN assets a ON a.symbol = p.symbol
         WHERE p.portfolio_id = ?
           AND p.quantity > 0
           AND COALESCE(a.enabled, 1) = 1
         ORDER BY p.symbol ASC`
      )
      .bind(portfolioId)
  );

  return rows.flatMap((row) => {
    const asset = parsePositionAssetRow(portfolioId, row);
    return asset ? [asset] : [];
  });
}

function dedupeAssets(assets: AssetRegistryRecord[]): AssetRegistryRecord[] {
  const bySymbol = new Map<string, AssetRegistryRecord>();
  for (const asset of assets) {
    if (!bySymbol.has(asset.symbol)) {
      bySymbol.set(asset.symbol, asset);
    }
  }
  return [...bySymbol.values()];
}

function parsePositionAssetRow(portfolioId: string, row: PositionAssetRow): AssetRegistryRecord | null {
  if (row.id) {
    return parseAssetRow(row as AssetRow);
  }
  if (!isAssetType(row.positionAssetClass)) {
    return null;
  }
  const assetType = row.positionAssetClass;
  return {
    id: `position_${sanitizeAssetId(portfolioId)}_${sanitizeAssetId(row.positionSymbol)}`,
    symbol: row.positionSymbol,
    displayName: row.positionSymbol,
    assetType,
    market: assetType === "crypto" ? "crypto" : "US",
    currency: "USD",
    providerSymbol: row.positionSymbol,
    enabled: true,
    tradable: defaultTradableForAssetType(assetType),
    fractionalSupported: true,
    dividendCapable: assetType !== "crypto",
    expenseRatio: null,
    minimumInvestment: null,
    marketHoursMode: defaultMarketHoursModeForAssetType(assetType),
    pricePrecision: 2,
    quantityPrecision: assetType === "crypto" ? 8 : 6,
    rankingPriority: undefined,
    notes: "Derived from current paper-twin position because no asset registry row exists."
  };
}

function defaultTradableForAssetType(assetType: AssetType): boolean {
  return assetType === "stock" || assetType === "etf" || assetType === "crypto" || assetType === "reit" || assetType === "bond_fund";
}

function defaultMarketHoursModeForAssetType(assetType: AssetType): MarketHoursMode {
  if (assetType === "crypto") return "continuous";
  if (assetType === "mutual_fund") return "fund_end_of_day";
  if (assetType === "stock" || assetType === "etf" || assetType === "reit" || assetType === "bond_fund") return "us_regular";
  return "cash_equivalent";
}

function sanitizeAssetId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96) || "asset";
}

export async function getAssets(db: D1Database): Promise<unknown> {
  const rows = await listRows<AssetRow>(
    db.prepare(
      `SELECT
        id,
        symbol,
        display_name AS displayName,
        asset_type AS assetType,
        market,
        currency,
        provider_symbol AS providerSymbol,
        enabled,
        tradable,
        fractional_supported AS fractionalSupported,
        dividend_capable AS dividendCapable,
        expense_ratio AS expenseRatio,
        minimum_investment AS minimumInvestment,
        market_hours_mode AS marketHoursMode,
        price_precision AS pricePrecision,
        quantity_precision AS quantityPrecision
       FROM assets
       ORDER BY enabled DESC, symbol ASC`
    )
  );

  return {
    supportedAssetTypes: ASSET_TYPES,
    assets: rows.map(parseAssetRow)
  };
}

export async function getWatchlists(db: D1Database, portfolioId = TIM_PORTFOLIO_ID): Promise<unknown> {
  const watchlists = await listRows<{
    id: string;
    name: string;
    description: string | null;
    enabled: number;
    createdAt: string;
    updatedAt: string;
  }>(
    db
      .prepare(
        `SELECT id, name, description, enabled, created_at AS createdAt, updated_at AS updatedAt
         FROM watchlists
         WHERE portfolio_id = ?
         ORDER BY enabled DESC, name ASC`
      )
      .bind(portfolioId)
  );

  const watchlistAssets = await listRows<AssetRow & { watchlistId: string }>(
    db
      .prepare(
        `SELECT
          w.id AS watchlistId,
          a.id,
          a.symbol,
          a.display_name AS displayName,
          a.asset_type AS assetType,
          a.market,
          a.currency,
          a.provider_symbol AS providerSymbol,
          a.enabled,
          a.tradable,
          a.fractional_supported AS fractionalSupported,
          a.dividend_capable AS dividendCapable,
          a.expense_ratio AS expenseRatio,
          a.minimum_investment AS minimumInvestment,
          a.market_hours_mode AS marketHoursMode,
          a.price_precision AS pricePrecision,
          a.quantity_precision AS quantityPrecision,
          wa.ranking_priority AS rankingPriority,
          wa.notes
         FROM watchlists w
         JOIN watchlist_assets wa ON wa.watchlist_id = w.id
         JOIN assets a ON a.id = wa.asset_id
         WHERE w.portfolio_id = ?
         ORDER BY w.name ASC, wa.enabled DESC, wa.ranking_priority ASC, a.symbol ASC`
      )
      .bind(portfolioId)
  );

  return {
    watchlists: watchlists.map((watchlist) => ({
      ...watchlist,
      enabled: watchlist.enabled === 1,
      assets: watchlistAssets
        .filter((asset) => asset.watchlistId === watchlist.id)
        .map(parseAssetRow)
    }))
  };
}

export function parseAssetRow(row: AssetRow): AssetRegistryRecord {
  if (!isAssetType(row.assetType)) {
    throw new Error(`Unsupported asset type in registry: ${row.assetType}`);
  }
  if (!isMarketHoursMode(row.marketHoursMode)) {
    throw new Error(`Unsupported market-hours mode in registry: ${row.marketHoursMode}`);
  }

  return {
    id: row.id,
    symbol: row.symbol,
    displayName: row.displayName,
    assetType: row.assetType,
    market: row.market,
    currency: row.currency,
    providerSymbol: row.providerSymbol,
    enabled: row.enabled === 1,
    tradable: row.tradable === 1,
    fractionalSupported: row.fractionalSupported === 1,
    dividendCapable: row.dividendCapable === 1,
    expenseRatio: row.expenseRatio,
    minimumInvestment: row.minimumInvestment,
    marketHoursMode: row.marketHoursMode,
    pricePrecision: row.pricePrecision,
    quantityPrecision: row.quantityPrecision,
    rankingPriority: row.rankingPriority,
    notes: row.notes
  };
}

export function assetTypeToClass(assetType: AssetType): AssetClass {
  return assetType;
}

export function isAssetType(value: string): value is AssetType {
  return (ASSET_TYPES as readonly string[]).includes(value);
}

export function isMarketHoursMode(value: string): value is MarketHoursMode {
  return (MARKET_HOURS_MODES as readonly string[]).includes(value);
}
