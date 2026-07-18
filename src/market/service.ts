import type { AssetClass, MarketCandle, MarketDataset } from "../shared/types.ts";
import { listRows } from "../shared/db.ts";
import { YahooFinanceMarketDataProvider, normalizeSymbol } from "./yahooFinanceProvider.ts";
import type { MarketDataProvider } from "./provider.ts";
import { getUsEquityMarketStatus, isUsEquityMarketHoliday } from "./hours.ts";

export type MarketDataUseCase = "dashboard" | "valuation" | "daily_review" | "proposal" | "order_staging" | "paper_execution";
export type QuoteQualityStatus =
  | "Valid"
  | "Delayed"
  | "Previous Close"
  | "Stale"
  | "Missing"
  | "Conflicting"
  | "Anomalous"
  | "Provider Failure";

export interface FreshnessPolicy {
  maxAgeMs: number;
  allowCachedFallback: boolean;
  allowPreviousClose: boolean;
  strict: boolean;
}

export interface NormalizedQuote {
  symbol: string;
  securityName: string | null;
  assetType: AssetClass | "unknown" | "leveraged_etf" | "inverse_etf" | "option" | "treasury_etf" | "cash_equivalent";
  exchange: string | null;
  currency: string;
  bid: number | null;
  ask: number | null;
  lastPrice: number | null;
  previousClose: number | null;
  marketSession: "regular" | "pre_market" | "after_hours" | "closed" | "continuous" | "unknown";
  providerTimestamp: string | null;
  receivedTimestamp: string;
  providerName: string;
  dataQualityStatus: QuoteQualityStatus;
  source: "primary" | "secondary" | "cache" | "unavailable";
  cached: boolean;
  warnings: string[];
  validation: QuoteValidationResult;
  candles: MarketCandle[];
  volume: number | null;
}

export interface QuoteValidationResult {
  valid: boolean;
  status: QuoteQualityStatus;
  reasons: string[];
  warnings: string[];
}

export interface HistoricalPriceBar {
  symbol: string;
  tradingDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjustedClose: number | null;
  volume: number | null;
  dividendAdjustmentStatus: "adjusted" | "unadjusted" | "unknown";
  splitAdjustmentStatus: "adjusted" | "unadjusted" | "unknown";
  provider: string;
  retrievalTimestamp: string;
}

export interface SecurityMetadata {
  symbol: string;
  displayName: string | null;
  assetType: NormalizedQuote["assetType"];
  exchange: string | null;
  currency: string;
  tradable: boolean;
  fractionalSupported: boolean;
  eligibilityStatus: "eligible" | "ineligible" | "unknown";
  reasons: string[];
}

export interface MarketDataSnapshot {
  id: string;
  useCase: MarketDataUseCase;
  quotes: Map<string, NormalizedQuote>;
  createdAt: string;
}

export interface MarketDataServiceConfig {
  primaryProvider?: MarketDataProvider;
  secondaryProvider?: MarketDataProvider | null;
  freshnessPolicies?: Partial<Record<MarketDataUseCase, FreshnessPolicy>>;
  anomalyThresholdPct?: number;
  providerDisagreementPct?: number;
  timeoutMs?: number;
}

interface CacheRow {
  normalizedQuoteJson: string;
  expiresAt: string;
}

interface AssetRow {
  symbol: string;
  displayName: string;
  assetType: AssetClass;
  market: string;
  currency: string;
  fractionalSupported: number;
  tradable: number;
}

const DEFAULT_POLICIES: Record<MarketDataUseCase, FreshnessPolicy> = {
  dashboard: { maxAgeMs: 30 * 60 * 1000, allowCachedFallback: true, allowPreviousClose: true, strict: false },
  valuation: { maxAgeMs: 4 * 24 * 60 * 60 * 1000, allowCachedFallback: true, allowPreviousClose: true, strict: false },
  daily_review: { maxAgeMs: 4 * 24 * 60 * 60 * 1000, allowCachedFallback: true, allowPreviousClose: true, strict: false },
  proposal: { maxAgeMs: 36 * 60 * 60 * 1000, allowCachedFallback: false, allowPreviousClose: true, strict: true },
  order_staging: { maxAgeMs: 36 * 60 * 60 * 1000, allowCachedFallback: false, allowPreviousClose: false, strict: true },
  paper_execution: { maxAgeMs: 15 * 60 * 1000, allowCachedFallback: false, allowPreviousClose: false, strict: true }
};

export class MarketDataService {
  private readonly db: D1Database;
  private readonly primary: MarketDataProvider;
  private readonly secondary: MarketDataProvider | null;
  private readonly policies: Record<MarketDataUseCase, FreshnessPolicy>;
  private readonly anomalyThresholdPct: number;
  private readonly providerDisagreementPct: number;
  private readonly memo = new Map<string, Promise<NormalizedQuote>>();

  constructor(db: D1Database, config: MarketDataServiceConfig = {}) {
    this.db = db;
    this.primary = config.primaryProvider ?? new YahooFinanceMarketDataProvider();
    this.secondary = config.secondaryProvider ?? null;
    this.policies = { ...DEFAULT_POLICIES, ...config.freshnessPolicies };
    this.anomalyThresholdPct = config.anomalyThresholdPct ?? 0.25;
    this.providerDisagreementPct = config.providerDisagreementPct ?? 0.03;
  }

  async getQuote(symbol: string, useCase: MarketDataUseCase = "dashboard", now = new Date()): Promise<NormalizedQuote> {
    const normalized = normalizeSymbol(symbol);
    const memoKey = `${useCase}:${normalized}:${now.toISOString().slice(0, 16)}`;
    const existing = this.memo.get(memoKey);
    if (existing) {
      return existing;
    }
    const promise = this.resolveQuote(normalized, useCase, now);
    this.memo.set(memoKey, promise);
    return promise;
  }

  async getQuotes(symbols: string[], useCase: MarketDataUseCase = "dashboard", now = new Date()): Promise<NormalizedQuote[]> {
    return Promise.all([...new Set(symbols.map(normalizeSymbol))].map((symbol) => this.getQuote(symbol, useCase, now)));
  }

  async createSnapshot(symbols: string[], useCase: MarketDataUseCase, now = new Date()): Promise<MarketDataSnapshot> {
    const quotes = await this.getQuotes(symbols, useCase, now);
    const id = `mdsnap_${useCase}_${now.toISOString().replace(/[^0-9A-Za-z]/g, "")}_${hashText(symbols.sort().join("|")).slice(0, 8)}`;
    const quoteMap = new Map(quotes.map((quote) => [quote.symbol, quote]));
    await this.persistSnapshot(id, useCase, quotes, now);
    return { id, useCase, quotes: quoteMap, createdAt: now.toISOString() };
  }

  async getSnapshot(snapshotId: string): Promise<MarketDataSnapshot | null> {
    const snapshot = await this.db.prepare(
      "SELECT id, use_case AS useCase, created_at AS createdAt FROM market_data_snapshots WHERE id = ?"
    ).bind(snapshotId).first<{ id: string; useCase: MarketDataUseCase; createdAt: string }>();
    if (!snapshot) {
      return null;
    }
    const rows = await listRows<{ symbol: string; normalizedQuoteJson: string }>(
      this.db.prepare("SELECT symbol, normalized_quote_json AS normalizedQuoteJson FROM market_data_snapshot_quotes WHERE snapshot_id = ?").bind(snapshotId)
    );
    const quotes = new Map<string, NormalizedQuote>();
    for (const row of rows) {
      const quote = parseJson<NormalizedQuote | null>(row.normalizedQuoteJson, null);
      if (quote) {
        quotes.set(row.symbol, quote);
      }
    }
    return { id: snapshot.id, useCase: snapshot.useCase, quotes, createdAt: snapshot.createdAt };
  }

  async getHistoricalPrices(symbol: string, startDate: string, endDate: string, now = new Date()): Promise<HistoricalPriceBar[]> {
    const normalized = normalizeSymbol(symbol);
    const data = await this.primary.getMarketData(normalized);
    const bars = data.candles
      .map((candle) => ({
        symbol: normalized,
        tradingDate: candle.timestamp.slice(0, 10),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        adjustedClose: null,
        volume: candle.volume ?? null,
        dividendAdjustmentStatus: "unknown" as const,
        splitAdjustmentStatus: "unknown" as const,
        provider: data.source,
        retrievalTimestamp: now.toISOString()
      }))
      .filter((bar) => bar.tradingDate >= startDate && bar.tradingDate <= endDate);
    await this.persistHistoricalBars(bars);
    return bars;
  }

  async getSecurityMetadata(symbol: string): Promise<SecurityMetadata> {
    const normalized = normalizeSymbol(symbol);
    const asset = await this.getAsset(normalized);
    const assetType = classifySecurity(normalized, asset?.assetType);
    const reasons: string[] = [];
    if (assetType === "unknown") {
      reasons.push("Security type is unknown and is not eligible for paper execution.");
    }
    if (assetType === "crypto" || assetType === "leveraged_etf" || assetType === "inverse_etf" || assetType === "option") {
      reasons.push(`${assetType} is prohibited by conservative paper policy.`);
    }
    return {
      symbol: normalized,
      displayName: asset?.displayName ?? null,
      assetType,
      exchange: asset?.market ?? null,
      currency: asset?.currency ?? "USD",
      tradable: asset?.tradable === 1 && reasons.length === 0,
      fractionalSupported: asset?.fractionalSupported === 1,
      eligibilityStatus: reasons.length === 0 && asset ? "eligible" : asset ? "ineligible" : "unknown",
      reasons
    };
  }

  getMarketStatus(now = new Date()): { session: NormalizedQuote["marketSession"]; timestamp: string } {
    return { session: marketSession(now, "etf"), timestamp: now.toISOString() };
  }

  getTradingCalendar(startDate: string, endDate: string): Array<{ date: string; open: boolean; reason?: string }> {
    const days: Array<{ date: string; open: boolean; reason?: string }> = [];
    for (let date = new Date(`${startDate}T00:00:00Z`); date.toISOString().slice(0, 10) <= endDate; date.setUTCDate(date.getUTCDate() + 1)) {
      const day = date.getUTCDay();
      const iso = date.toISOString().slice(0, 10);
      const holiday = isUsEquityMarketHoliday(iso);
      days.push({ date: iso, open: day !== 0 && day !== 6 && !holiday, reason: holiday ? "U.S. market holiday" : day === 0 || day === 6 ? "Weekend" : undefined });
    }
    return days;
  }

  async getProviderHealth(): Promise<unknown[]> {
    return listRows(this.db.prepare(
      `SELECT provider, successful_requests AS successfulRequests, failed_requests AS failedRequests,
        timeout_requests AS timeoutRequests, rate_limit_responses AS rateLimitResponses,
        fallback_uses AS fallbackUses,
        CASE WHEN successful_requests + failed_requests = 0 THEN 0 ELSE total_latency_ms / (successful_requests + failed_requests) END AS averageLatencyMs,
        last_successful_retrieval AS lastSuccessfulRetrieval, circuit_open_until AS circuitOpenUntil,
        updated_at AS updatedAt
       FROM market_data_provider_health
       ORDER BY provider ASC`
    ));
  }

  async getCacheStatus(symbol?: string): Promise<unknown[]> {
    const query = symbol
      ? this.db.prepare("SELECT symbol, provider, quality_status AS qualityStatus, provider_timestamp AS providerTimestamp, retrieval_timestamp AS retrievalTimestamp, expires_at AS expiresAt FROM trusted_quote_cache WHERE symbol = ?").bind(normalizeSymbol(symbol))
      : this.db.prepare("SELECT symbol, provider, quality_status AS qualityStatus, provider_timestamp AS providerTimestamp, retrieval_timestamp AS retrievalTimestamp, expires_at AS expiresAt FROM trusted_quote_cache ORDER BY symbol ASC");
    return listRows(query);
  }

  async getRecentAnomalies(limit = 25): Promise<unknown[]> {
    return listRows(this.db.prepare("SELECT symbol, provider, quality_status AS qualityStatus, anomaly_type AS anomalyType, message, created_at AS createdAt FROM market_data_anomalies ORDER BY created_at DESC LIMIT ?").bind(limit));
  }

  private async resolveQuote(symbol: string, useCase: MarketDataUseCase, now: Date): Promise<NormalizedQuote> {
    const policy = this.policies[useCase];
    const [asset, primaryResult] = await Promise.all([
      this.getAsset(symbol),
      this.fetchProvider(this.primary, symbol, now, "primary")
    ]);

    if (primaryResult.quote && isQuoteUsable(primaryResult.quote, policy)) {
      const secondaryCheck = this.secondary ? await this.fetchProvider(this.secondary, symbol, now, "secondary") : null;
      if (secondaryCheck?.quote && isQuoteUsable(secondaryCheck.quote, policy) && materiallyDisagree(primaryResult.quote, secondaryCheck.quote, this.providerDisagreementPct)) {
        const quote = markQuote(primaryResult.quote, "Conflicting", "Primary and secondary providers disagree materially.");
        await this.recordAnomaly(quote, "provider_disagreement", "Primary and secondary providers disagree materially.", {
          primary: safeProviderValue(primaryResult.quote),
          secondary: safeProviderValue(secondaryCheck.quote)
        }, now);
        return quote;
      }
      await this.persistTrustedQuote(primaryResult.quote, policy, now);
      return primaryResult.quote;
    }

    const secondaryResult = this.secondary ? await this.fetchProvider(this.secondary, symbol, now, "secondary") : null;
    if (primaryResult.quote && secondaryResult?.quote && materiallyDisagree(primaryResult.quote, secondaryResult.quote, this.providerDisagreementPct)) {
      const quote = markQuote(primaryResult.quote, "Conflicting", "Primary and secondary providers disagree materially.");
      await this.recordAnomaly(quote, "provider_disagreement", "Primary and secondary providers disagree materially.", {
        primary: safeProviderValue(primaryResult.quote),
        secondary: safeProviderValue(secondaryResult.quote)
      }, now);
      return quote;
    }
    if (secondaryResult?.quote && isQuoteUsable(secondaryResult.quote, policy)) {
      await this.incrementFallback(secondaryResult.quote.providerName);
      await this.persistTrustedQuote(secondaryResult.quote, policy, now);
      return secondaryResult.quote;
    }

    const cached = await this.getTrustedCachedQuote(symbol, policy, now);
    if (cached) {
      return cached;
    }

    const status = primaryResult.quote?.dataQualityStatus ?? secondaryResult?.quote?.dataQualityStatus ?? "Provider Failure";
    return unavailableQuote(symbol, asset, status, now, [
      primaryResult.error ?? primaryResult.quote?.validation.reasons.join(" ") ?? "Primary provider unavailable.",
      secondaryResult?.error ?? secondaryResult?.quote?.validation.reasons.join(" ") ?? ""
    ].filter(Boolean));
  }

  private async fetchProvider(provider: MarketDataProvider, symbol: string, now: Date, source: "primary" | "secondary"): Promise<{ quote: NormalizedQuote | null; error: string | null }> {
    const started = Date.now();
    try {
      const data = await provider.getMarketData(symbol);
      const asset = await this.getAsset(symbol);
      const quote = normalizeDataset(data, asset, now, source);
      const validation = validateQuote(quote, now, this.policies.dashboard, this.anomalyThresholdPct);
      const normalized = { ...quote, dataQualityStatus: validation.status, validation, warnings: [...quote.warnings, ...validation.warnings] };
      await this.recordProviderHealth(provider.name, true, Date.now() - started, normalized, null, now);
      if (!validation.valid) {
        await this.recordAnomaly(normalized, validation.status, validation.reasons.join(" "), { symbol }, now);
      }
      return { quote: normalized, error: null };
    } catch (error) {
      const message = sanitizeProviderError(error);
      await this.recordProviderHealth(provider.name, false, Date.now() - started, null, message, now);
      return { quote: null, error: message };
    }
  }

  private async getAsset(symbol: string): Promise<AssetRow | null> {
    return this.db.prepare(
      `SELECT symbol, display_name AS displayName, asset_type AS assetType, market, currency,
        fractional_supported AS fractionalSupported, tradable
       FROM assets
       WHERE symbol = ? OR provider_symbol = ?
       ORDER BY symbol = ? DESC
       LIMIT 1`
    ).bind(symbol, symbol, symbol).first<AssetRow>();
  }

  private async getTrustedCachedQuote(symbol: string, policy: FreshnessPolicy, now: Date): Promise<NormalizedQuote | null> {
    if (!policy.allowCachedFallback) {
      return null;
    }
    const row = await this.db.prepare("SELECT normalized_quote_json AS normalizedQuoteJson, expires_at AS expiresAt FROM trusted_quote_cache WHERE symbol = ?").bind(symbol).first<CacheRow>();
    if (!row || new Date(row.expiresAt).getTime() < now.getTime()) {
      return null;
    }
    const quote = parseJson<NormalizedQuote | null>(row.normalizedQuoteJson, null);
    return quote ? { ...quote, source: "cache", cached: true, dataQualityStatus: policy.strict ? "Stale" : "Previous Close", warnings: [...quote.warnings, "Using trusted cached market data."] } : null;
  }

  private async persistTrustedQuote(quote: NormalizedQuote, policy: FreshnessPolicy, now: Date): Promise<void> {
    if (!quote.validation.valid || quote.dataQualityStatus === "Conflicting" || quote.dataQualityStatus === "Anomalous") {
      return;
    }
    const expiresAt = new Date(now.getTime() + policy.maxAgeMs).toISOString();
    const json = JSON.stringify(quote);
    await this.db.prepare(
      `INSERT INTO trusted_quote_cache (
        symbol, normalized_quote_json, provider, quality_status, provider_timestamp,
        retrieval_timestamp, expires_at, validation_result_json, quote_hash, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(symbol) DO UPDATE SET
        normalized_quote_json = excluded.normalized_quote_json,
        provider = excluded.provider,
        quality_status = excluded.quality_status,
        provider_timestamp = excluded.provider_timestamp,
        retrieval_timestamp = excluded.retrieval_timestamp,
        expires_at = excluded.expires_at,
        validation_result_json = excluded.validation_result_json,
        quote_hash = excluded.quote_hash,
        updated_at = datetime('now')`
    ).bind(quote.symbol, json, quote.providerName, quote.dataQualityStatus, quote.providerTimestamp, quote.receivedTimestamp, expiresAt, JSON.stringify(quote.validation), hashText(json)).run();
  }

  private async persistHistoricalBars(bars: HistoricalPriceBar[]): Promise<void> {
    if (bars.length === 0) {
      return;
    }
    await this.db.batch(bars.map((bar) => this.db.prepare(
      `INSERT OR IGNORE INTO historical_price_bars (
        symbol, trading_date, open, high, low, close, adjusted_close, volume,
        dividend_adjustment_status, split_adjustment_status, provider, retrieval_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(bar.symbol, bar.tradingDate, bar.open, bar.high, bar.low, bar.close, bar.adjustedClose, bar.volume, bar.dividendAdjustmentStatus, bar.splitAdjustmentStatus, bar.provider, bar.retrievalTimestamp)));
  }

  private async persistSnapshot(id: string, useCase: MarketDataUseCase, quotes: NormalizedQuote[], now: Date): Promise<void> {
    const counts = quotes.reduce<Record<string, number>>((acc, quote) => {
      acc[quote.dataQualityStatus] = (acc[quote.dataQualityStatus] ?? 0) + 1;
      return acc;
    }, {});
    const statements = [
      this.db.prepare("INSERT OR REPLACE INTO market_data_snapshots (id, use_case, symbols_json, quality_summary_json, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(id, useCase, JSON.stringify(quotes.map((quote) => quote.symbol)), JSON.stringify(counts), now.toISOString()),
      ...quotes.map((quote) => this.db.prepare(
        `INSERT OR REPLACE INTO market_data_snapshot_quotes (
          snapshot_id, symbol, normalized_quote_json, quality_status, provider,
          provider_timestamp, retrieval_timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, quote.symbol, JSON.stringify(quote), quote.dataQualityStatus, quote.providerName, quote.providerTimestamp, quote.receivedTimestamp))
    ];
    await this.db.batch(statements);
  }

  private async recordProviderHealth(provider: string, success: boolean, latencyMs: number, quote: NormalizedQuote | null, error: string | null, now: Date): Promise<void> {
    const timeout = error ? /timeout|abort/i.test(error) : false;
    const rateLimit = error ? /429|rate/i.test(error) : false;
    await this.db.prepare(
      `INSERT INTO market_data_provider_health (
        provider, successful_requests, failed_requests, timeout_requests,
        rate_limit_responses, total_latency_ms, last_successful_retrieval, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(provider) DO UPDATE SET
        successful_requests = successful_requests + excluded.successful_requests,
        failed_requests = failed_requests + excluded.failed_requests,
        timeout_requests = timeout_requests + excluded.timeout_requests,
        rate_limit_responses = rate_limit_responses + excluded.rate_limit_responses,
        total_latency_ms = total_latency_ms + excluded.total_latency_ms,
        last_successful_retrieval = COALESCE(excluded.last_successful_retrieval, last_successful_retrieval),
        updated_at = datetime('now')`
    ).bind(provider, success ? 1 : 0, success ? 0 : 1, timeout ? 1 : 0, rateLimit ? 1 : 0, latencyMs, success ? quote?.receivedTimestamp ?? now.toISOString() : null).run();
  }

  private async incrementFallback(provider: string): Promise<void> {
    await this.db.prepare(
      `INSERT INTO market_data_provider_health (provider, fallback_uses, updated_at)
       VALUES (?, 1, datetime('now'))
       ON CONFLICT(provider) DO UPDATE SET fallback_uses = fallback_uses + 1, updated_at = datetime('now')`
    ).bind(provider).run();
  }

  private async recordAnomaly(quote: NormalizedQuote, type: string, message: string, details: unknown, now: Date): Promise<void> {
    await this.db.prepare(
      "INSERT OR IGNORE INTO market_data_anomalies (id, symbol, provider, quality_status, anomaly_type, message, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(`mda_${quote.symbol}_${now.toISOString().replace(/[^0-9A-Za-z]/g, "")}_${hashText(type + message).slice(0, 8)}`, quote.symbol, quote.providerName, quote.dataQualityStatus, type, message.slice(0, 500), JSON.stringify(details), now.toISOString()).run();
  }
}

export function quoteToMarketDataset(quote: NormalizedQuote): MarketDataset {
  return {
    symbol: quote.symbol,
    assetClass: quote.assetType === "unknown" || quote.assetType === "leveraged_etf" || quote.assetType === "inverse_etf" || quote.assetType === "option" || quote.assetType === "treasury_etf" || quote.assetType === "cash_equivalent" ? "stock" : quote.assetType,
    priceUsd: quote.lastPrice ?? 0,
    asOf: quote.providerTimestamp ?? quote.receivedTimestamp,
    source: quote.providerName,
    validated: quote.dataQualityStatus === "Valid" || quote.dataQualityStatus === "Previous Close" || quote.dataQualityStatus === "Delayed",
    stale: quote.dataQualityStatus === "Stale",
    volume: quote.volume ?? undefined,
    candles: quote.candles,
    status: quote.cached ? "cached" : quote.dataQualityStatus === "Valid" ? "validated" : "unavailable",
    quality: quote.dataQualityStatus === "Valid" ? "fresh" : quote.cached ? "acceptable_cached" : quote.dataQualityStatus === "Stale" ? "stale" : "invalid",
    userMessage: quote.warnings[0],
    error: quote.validation.valid ? undefined : quote.validation.reasons.join(" ")
  };
}

function normalizeDataset(data: MarketDataset, asset: AssetRow | null, now: Date, source: "primary" | "secondary"): NormalizedQuote {
  const previousClose = data.candles.at(-2)?.close ?? data.candles.at(-1)?.close ?? null;
  return {
    symbol: data.symbol,
    securityName: asset?.displayName ?? data.symbol,
    assetType: classifySecurity(data.symbol, asset?.assetType ?? data.assetClass),
    exchange: asset?.market ?? null,
    currency: asset?.currency ?? "USD",
    bid: null,
    ask: null,
    lastPrice: Number.isFinite(data.priceUsd) && data.priceUsd > 0 ? data.priceUsd : null,
    previousClose,
    marketSession: marketSession(now, data.assetClass),
    providerTimestamp: data.asOf,
    receivedTimestamp: now.toISOString(),
    providerName: data.source,
    dataQualityStatus: data.validated ? "Valid" : data.stale ? "Stale" : "Provider Failure",
    source,
    cached: false,
    warnings: data.userMessage ? [data.userMessage] : [],
    validation: { valid: data.validated, status: data.validated ? "Valid" : "Provider Failure", reasons: data.error ? [data.error] : [], warnings: [] },
    candles: data.candles,
    volume: data.volume ?? null
  };
}

export function validateQuote(quote: NormalizedQuote, now: Date, policy: FreshnessPolicy = DEFAULT_POLICIES.dashboard, movementThresholdPct = 0.25): QuoteValidationResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let status: QuoteQualityStatus = quote.dataQualityStatus;
  const price = quote.lastPrice;

  if (!price || price <= 0) {
    reasons.push("Price is missing, zero, or negative.");
    status = "Missing";
  }
  if (quote.bid !== null && quote.ask !== null && quote.bid > quote.ask) {
    reasons.push("Bid is greater than ask.");
    status = "Anomalous";
  }
  const lastCandle = quote.candles.at(-1);
  if (price && lastCandle && (price < lastCandle.low * 0.98 || price > lastCandle.high * 1.02)) {
    reasons.push("Price is outside the reported daily range.");
    status = "Anomalous";
  }
  if (quote.providerTimestamp && new Date(quote.providerTimestamp).getTime() > now.getTime() + 60_000) {
    reasons.push("Provider timestamp is in the future.");
    status = "Anomalous";
  }
  if (quote.currency !== "USD") {
    reasons.push("Quote currency does not match the expected USD currency.");
    status = "Anomalous";
  }
  if (price && quote.previousClose && Math.abs(price - quote.previousClose) / quote.previousClose > movementThresholdPct) {
    warnings.push("Quote has an unusually large one-period movement.");
    status = status === "Valid" ? "Anomalous" : status;
  }
  if (quote.providerTimestamp) {
    const age = now.getTime() - new Date(quote.providerTimestamp).getTime();
    if (age > policy.maxAgeMs && !isPermittedPreviousClose(quote, now, policy)) {
      reasons.push("Quote timestamp is stale for this use case.");
      status = "Stale";
    } else if (age > policy.maxAgeMs && policy.allowPreviousClose) {
      warnings.push("Using previous valid market close under market-aware freshness rules.");
      status = "Previous Close";
    }
  }

  const valid = reasons.length === 0 && status !== "Anomalous" && status !== "Conflicting" && status !== "Provider Failure" && status !== "Missing";
  return { valid, status: valid ? status : status, reasons, warnings };
}

function isQuoteUsable(quote: NormalizedQuote, policy: FreshnessPolicy): boolean {
  if (!quote.validation.valid) {
    return false;
  }
  if (policy.strict && quote.cached) {
    return false;
  }
  return quote.dataQualityStatus === "Valid" || quote.dataQualityStatus === "Delayed" || (policy.allowPreviousClose && quote.dataQualityStatus === "Previous Close");
}

function isPermittedPreviousClose(quote: NormalizedQuote, now: Date, policy: FreshnessPolicy): boolean {
  if (!policy.allowPreviousClose || quote.assetType === "crypto") {
    return false;
  }
  const timestamp = quote.providerTimestamp ? new Date(quote.providerTimestamp) : null;
  if (!timestamp) {
    return false;
  }
  if (quote.marketSession === "after_hours" || quote.marketSession === "pre_market" || quote.marketSession === "closed") {
    return now.getTime() - timestamp.getTime() <= 4 * 24 * 60 * 60 * 1000;
  }
  const calendar = calendarReason(now);
  return calendar !== null && now.getTime() - timestamp.getTime() <= 4 * 24 * 60 * 60 * 1000;
}

function materiallyDisagree(a: NormalizedQuote, b: NormalizedQuote, threshold: number): boolean {
  if (!a.lastPrice || !b.lastPrice) {
    return false;
  }
  return Math.abs(a.lastPrice - b.lastPrice) / Math.min(a.lastPrice, b.lastPrice) > threshold;
}

function markQuote(quote: NormalizedQuote, status: QuoteQualityStatus, reason: string): NormalizedQuote {
  return {
    ...quote,
    dataQualityStatus: status,
    validation: { valid: false, status, reasons: [reason], warnings: quote.validation.warnings },
    warnings: [...quote.warnings, reason]
  };
}

function unavailableQuote(symbol: string, asset: AssetRow | null, status: QuoteQualityStatus, now: Date, reasons: string[]): NormalizedQuote {
  return {
    symbol,
    securityName: asset?.displayName ?? null,
    assetType: classifySecurity(symbol, asset?.assetType),
    exchange: asset?.market ?? null,
    currency: asset?.currency ?? "USD",
    bid: null,
    ask: null,
    lastPrice: null,
    previousClose: null,
    marketSession: marketSession(now, asset?.assetType ?? "stock"),
    providerTimestamp: null,
    receivedTimestamp: now.toISOString(),
    providerName: "unavailable",
    dataQualityStatus: status,
    source: "unavailable",
    cached: false,
    warnings: reasons,
    validation: { valid: false, status, reasons, warnings: [] },
    candles: [],
    volume: null
  };
}

function classifySecurity(symbol: string, assetClass?: string): NormalizedQuote["assetType"] {
  const upper = symbol.toUpperCase();
  if (/(\b|-)2X|3X|ULTRA|LEVERAGED/.test(upper)) return "leveraged_etf";
  if (/INVERSE|SHORT/.test(upper)) return "inverse_etf";
  if (assetClass === "bond_fund" && /SHY|IEF|TLT|SGOV|BIL/.test(upper)) return "treasury_etf";
  if (assetClass === "money_market") return "cash_equivalent";
  return (assetClass as NormalizedQuote["assetType"]) ?? "unknown";
}

function marketSession(now: Date, assetClass: AssetClass | string): NormalizedQuote["marketSession"] {
  if (assetClass === "crypto") {
    return "continuous";
  }
  const status = getUsEquityMarketStatus(now);
  if (status.phase === "weekend" || status.phase === "holiday") return "closed";
  if (status.phase === "regular") return "regular";
  return status.phase;
}

function calendarReason(now: Date): string | null {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
  const day = new Date(`${iso}T12:00:00.000Z`).getUTCDay();
  if (day === 0 || day === 6) return "Weekend";
  if (isUsEquityMarketHoliday(iso)) return "U.S. market holiday";
  return null;
}

function safeProviderValue(quote: NormalizedQuote): unknown {
  return { provider: quote.providerName, price: quote.lastPrice, timestamp: quote.providerTimestamp, status: quote.dataQualityStatus };
}

function sanitizeProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Provider request failed.";
  return message.replace(/[A-Za-z0-9_\-]{24,}/g, "[redacted]").slice(0, 300);
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
