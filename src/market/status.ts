import { listRows } from "../shared/db.ts";
import { userMessageForMarketData } from "../shared/messages.ts";
import type { MarketCandle, MarketDataset } from "../shared/types.ts";

export interface MarketDataStatus {
  symbol: string;
  source: string;
  fetchedAt: string;
  ageSeconds: number;
  isFresh: boolean;
  quality: "fresh" | "acceptable_cached" | "stale" | "invalid";
  status: "validated" | "cached" | "deferred" | "unavailable";
  userMessage: string;
  technicalError?: string;
}

interface SnapshotRow {
  symbol: string;
  assetClass: "stock" | "etf" | "crypto" | "option" | "future" | "cash";
  source: string;
  priceUsd: number;
  priceAsOf: string;
  volume: number | null;
  candlesJson: string;
  createdAt: string;
}

export function cacheFreshnessSeconds(symbol: string): number {
  return symbol === "BTC-USD" ? 5 * 60 : 30 * 60;
}

export function lastKnownGoodMaxAgeSeconds(symbol: string): number {
  return symbol === "BTC-USD" ? 30 * 60 : 4 * 24 * 60 * 60;
}

export function shouldUseCachedSnapshot(symbol: string, ageSeconds: number): boolean {
  return ageSeconds <= cacheFreshnessSeconds(symbol);
}

export function shouldUseLastKnownGood(symbol: string, ageSeconds: number): boolean {
  return ageSeconds <= lastKnownGoodMaxAgeSeconds(symbol);
}

export function marketStatusFromDataset(data: MarketDataset, fetchedAt = new Date().toISOString()): MarketDataStatus {
  const ageSeconds = Math.max(0, Math.floor((Date.now() - new Date(fetchedAt).getTime()) / 1000));
  const isFresh = data.validated && !data.stale;
  return {
    symbol: data.symbol,
    source: data.source,
    fetchedAt,
    ageSeconds,
    isFresh,
    quality: data.quality ?? (isFresh ? "fresh" : "invalid"),
    status: data.status ?? (isFresh ? "validated" : "unavailable"),
    userMessage: data.userMessage ?? data.error ?? userMessageForMarketData(data.symbol),
    technicalError: data.technicalError
  };
}

export async function getCachedMarketData(db: D1Database, symbol: string, now = new Date()): Promise<MarketDataset | null> {
  const row = await getLastValidSnapshot(db, symbol);
  if (!row) {
    return null;
  }

  const ageSeconds = Math.max(0, Math.floor((now.getTime() - new Date(row.createdAt).getTime()) / 1000));
  if (!shouldUseCachedSnapshot(symbol, ageSeconds)) {
    return null;
  }

  return datasetFromSnapshot(row, "cached", "acceptable_cached", "Using a recent cached market snapshot.");
}

export async function getLastKnownGoodMarketData(db: D1Database, symbol: string, now = new Date()): Promise<MarketDataset | null> {
  const row = await getLastValidSnapshot(db, symbol);
  if (!row) {
    return null;
  }

  const ageSeconds = Math.max(0, Math.floor((now.getTime() - new Date(row.createdAt).getTime()) / 1000));
  if (!shouldUseLastKnownGood(symbol, ageSeconds)) {
    return null;
  }

  return datasetFromSnapshot(row, "cached", "acceptable_cached", "Using the last known valid market snapshot.");
}

export async function upsertMarketDataStatus(db: D1Database, status: MarketDataStatus): Promise<void> {
  await db
    .prepare(
      `INSERT INTO market_data_status (
        symbol, source, fetched_at, age_seconds, is_fresh, quality,
        status, user_message, technical_error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(symbol) DO UPDATE SET
        source = excluded.source,
        fetched_at = excluded.fetched_at,
        age_seconds = excluded.age_seconds,
        is_fresh = excluded.is_fresh,
        quality = excluded.quality,
        status = excluded.status,
        user_message = excluded.user_message,
        technical_error = excluded.technical_error,
        updated_at = datetime('now')`
    )
    .bind(
      status.symbol,
      status.source,
      status.fetchedAt,
      status.ageSeconds,
      status.isFresh ? 1 : 0,
      status.quality,
      status.status,
      status.userMessage,
      status.technicalError ?? null
    )
    .run();
}

export async function getMarketDataStatuses(db: D1Database, includeTechnical = false): Promise<unknown[]> {
  const rows = await listRows<{
    symbol: string;
    source: string;
    fetchedAt: string;
    ageSeconds: number;
    isFresh: number;
    quality: string;
    status: string;
    userMessage: string;
    technicalError: string | null;
  }>(
    db.prepare(
      `SELECT symbol, source, fetched_at AS fetchedAt, age_seconds AS ageSeconds,
        is_fresh AS isFresh, quality, status, user_message AS userMessage,
        technical_error AS technicalError
       FROM market_data_status
       ORDER BY symbol ASC`
    )
  );

  return rows.map((row) => ({
    symbol: row.symbol,
    source: row.source,
    fetchedAt: row.fetchedAt,
    ageSeconds: row.ageSeconds,
    isFresh: row.isFresh === 1,
    quality: row.quality,
    status: row.status,
    userMessage: row.userMessage,
    ...(includeTechnical ? { technicalError: row.technicalError } : {})
  }));
}

async function getLastValidSnapshot(db: D1Database, symbol: string): Promise<SnapshotRow | null> {
  return db
    .prepare(
      `SELECT symbol, asset_class AS assetClass, source, price_usd AS priceUsd,
        price_as_of AS priceAsOf, volume, candles_json AS candlesJson,
        created_at AS createdAt
       FROM market_snapshots
       WHERE symbol = ? AND validation_status = 'validated' AND price_usd > 0
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(symbol)
    .first<SnapshotRow>();
}

function datasetFromSnapshot(
  row: SnapshotRow,
  status: "cached",
  quality: "acceptable_cached",
  message: string
): MarketDataset {
  return {
    symbol: row.symbol,
    assetClass: row.assetClass,
    priceUsd: row.priceUsd,
    asOf: row.priceAsOf,
    source: row.source,
    validated: true,
    stale: false,
    volume: row.volume ?? undefined,
    candles: parseCandles(row.candlesJson),
    status,
    quality,
    userMessage: message
  };
}

function parseCandles(value: string): MarketCandle[] {
  try {
    const parsed = JSON.parse(value) as MarketCandle[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
