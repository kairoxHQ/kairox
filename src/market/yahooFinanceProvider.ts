import type { AssetClass, MarketCandle, MarketDataset, MarketPrice } from "../shared/types.ts";

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        regularMarketTime?: number;
        symbol?: string;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
    error?: { description?: string };
  };
}

const SYMBOLS: Record<string, AssetClass> = {
  "BTC-USD": "crypto",
  SPY: "etf"
};

export class YahooFinanceMarketDataProvider {
  readonly name = "yahoo_finance_chart";
  private readonly fetchFn: typeof fetch;

  constructor(fetchFn: typeof fetch = globalThis.fetch) {
    this.fetchFn = (input, init) => Reflect.apply(fetchFn, globalThis, [input, init]) as Promise<Response>;
  }

  async getLatestPrice(symbol: string): Promise<MarketPrice> {
    return this.getMarketData(symbol);
  }

  async getMarketData(symbol: string): Promise<MarketDataset> {
    const normalized = normalizeSymbol(symbol);

    if (!SYMBOLS[normalized]) {
      return invalidDataset(normalized, this.name, `Unsupported symbol: ${symbol}`, `Unsupported market symbol: ${symbol}`);
    }

    if (normalized === "BTC-USD") {
      try {
        return await this.fetchCoinbaseBtc();
      } catch (error) {
        const technicalError = error instanceof Error ? error.message : "Unknown Coinbase market data error";
        try {
          const payload = await this.fetchYahooWithRetry(normalized);
          return parseYahooChart(normalized, SYMBOLS[normalized], this.name, payload);
        } catch (fallbackError) {
          return invalidDataset(
            normalized,
            "public_market_data_fallback",
            "Market data temporarily unavailable; no trade was made.",
            `${technicalError}; Yahoo fallback failed: ${fallbackError instanceof Error ? fallbackError.message : "Unknown error"}`
          );
        }
      }
    }

    try {
      const payload = await this.fetchYahooWithRetry(normalized);
      const yahoo = parseYahooChart(normalized, SYMBOLS[normalized], this.name, payload);
      if (yahoo.validated) {
        return yahoo;
      }

      return this.fetchFallback(normalized, yahoo.technicalError ?? yahoo.error);
    } catch (error) {
      return this.fetchFallback(normalized, error instanceof Error ? error.message : "Unknown market data error");
    }
  }

  private async fetchFallback(symbol: string, previousError?: string): Promise<MarketDataset> {
    try {
      if (symbol === "BTC-USD") {
        return await this.fetchCoinbaseBtc(previousError);
      }

      if (symbol === "SPY") {
        return await this.fetchStooqSpy(previousError);
      }
    } catch (error) {
      return invalidDataset(
        symbol,
        "public_market_data_fallback",
        "Market data temporarily unavailable; no trade was made.",
        `${previousError ?? "Primary provider failed"}; fallback failed: ${
          error instanceof Error ? error.message : "Unknown fallback error"
        }`
      );
    }

    return invalidDataset(symbol, this.name, "Market data temporarily unavailable; no trade was made.", previousError ?? "No fallback available.");
  }

  private async fetchYahooWithRetry(symbol: string): Promise<YahooChartResponse> {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?range=3mo&interval=1d&includePrePost=false`;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort("market data timeout"), 5000);
        const response = await this.fetchFn(url, {
          headers: {
            accept: "application/json",
            "user-agent": "Mozilla/5.0 (compatible; CryptoLabAI/0.2; +https://cryptolab-ai.aprilfamilycookbook.workers.dev)"
          },
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) {
          throw await httpError(response, "Yahoo Finance");
        }

        return (await response.json()) as YahooChartResponse;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Market data request failed");
        if (attempt < 2) {
          await sleep(retryDelayMs(lastError, attempt));
        }
      }
    }

    throw lastError ?? new Error("Market data request failed");
  }

  private async fetchCoinbaseBtc(previousError?: string): Promise<MarketDataset> {
    const [tickerResponse, candlesResponse] = await Promise.all([
      this.fetchJson<{ price?: string; time?: string }>("https://api.exchange.coinbase.com/products/BTC-USD/ticker"),
      this.fetchJson<Array<[number, number, number, number, number, number]>>(
        "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400"
      )
    ]);
    const candles = candlesResponse
      .map(([time, low, high, open, close, volume]) => ({
        timestamp: new Date(time * 1000).toISOString(),
        open,
        high,
        low,
        close,
        volume
      }))
      .filter((candle) => isPositive(candle.open) && isPositive(candle.high) && isPositive(candle.low) && isPositive(candle.close))
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const lastCandle = candles.at(-1);
    const tickerPrice = Number(tickerResponse.price);
    const priceUsd = isPositive(tickerPrice) ? tickerPrice : lastCandle?.close ?? 0;
    const asOf = tickerResponse.time ?? lastCandle?.timestamp ?? new Date(0).toISOString();
    const stale = isStale("BTC-USD", asOf);
    const validated = isPositive(priceUsd) && candles.length >= 30 && !stale;

    return {
      symbol: "BTC-USD",
      assetClass: "crypto",
      priceUsd,
      asOf,
      source: "coinbase_public_market_data",
      validated,
      stale,
      volume: lastCandle?.volume,
      candles,
      userMessage: validated ? undefined : "Market data temporarily unavailable; no trade was made.",
      technicalError: validated ? previousError : `Coinbase validation failed: price=${priceUsd}, candles=${candles.length}, stale=${stale}`,
      error: validated ? previousError : "Market data temporarily unavailable; no trade was made.",
      status: validated ? "validated" : "unavailable",
      quality: validated ? "fresh" : "invalid"
    };
  }

  private async fetchStooqSpy(previousError?: string): Promise<MarketDataset> {
    const historyCsv = await this.fetchText("https://stooq.com/q/d/l/?s=spy.us&i=d");
    const candles = parseStooqHistory(historyCsv);
    const lastCandle = candles.at(-1);
    const priceUsd = lastCandle?.close ?? 0;
    const asOf = lastCandle?.timestamp ?? new Date(0).toISOString();
    const stale = isStale("SPY", asOf);
    const validated = isPositive(priceUsd) && candles.length >= 30 && !stale;

    return {
      symbol: "SPY",
      assetClass: "etf",
      priceUsd,
      asOf,
      source: "stooq_public_market_data",
      validated,
      stale,
      volume: lastCandle?.volume,
      candles,
      userMessage: validated ? undefined : "SPY evaluation deferred because the latest quote was stale.",
      technicalError: validated ? previousError : `Stooq validation failed after Yahoo error: ${previousError}; price=${priceUsd}, candles=${candles.length}, stale=${stale}`,
      error: validated ? previousError : "SPY evaluation deferred because the latest quote was stale.",
      status: validated ? "validated" : "unavailable",
      quality: validated ? "fresh" : stale ? "stale" : "invalid"
    };
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await this.fetchFn(url, { headers: { accept: "application/json" } });
    if (!response.ok) {
      throw await httpError(response, url);
    }
    return (await response.json()) as T;
  }

  private async fetchText(url: string): Promise<string> {
    const response = await this.fetchFn(url, { headers: { accept: "text/csv,text/plain" } });
    if (!response.ok) {
      throw await httpError(response, url);
    }
    return response.text();
  }
}

export function normalizeSymbol(symbol: string): string {
  const upper = symbol.trim().toUpperCase();
  return upper === "BTC" ? "BTC-USD" : upper;
}

function parseYahooChart(
  symbol: string,
  assetClass: AssetClass,
  source: string,
  payload: YahooChartResponse
): MarketDataset {
  const result = payload.chart?.result?.[0];
  if (!result) {
    return invalidDataset(symbol, source, payload.chart?.error?.description ?? "Missing chart result");
  }

  const quote = result.indicators?.quote?.[0];
  const timestamps = result.timestamp ?? [];
  const candles: MarketCandle[] = [];

  for (let index = 0; index < timestamps.length; index += 1) {
    const open = quote?.open?.[index];
    const high = quote?.high?.[index];
    const low = quote?.low?.[index];
    const close = quote?.close?.[index];

    if (isPositive(open) && isPositive(high) && isPositive(low) && isPositive(close)) {
      const volume = quote?.volume?.[index];
      candles.push({
        timestamp: new Date(timestamps[index] * 1000).toISOString(),
        open,
        high,
        low,
        close,
        volume: isPositive(volume) ? volume : undefined
      });
    }
  }

  const lastCandle = candles.at(-1);
  const metaPrice = result.meta?.regularMarketPrice;
  const metaTime = result.meta?.regularMarketTime;
  const priceUsd = isPositive(metaPrice) ? metaPrice : lastCandle?.close ?? 0;
  const asOf =
    typeof metaTime === "number" && metaTime > 0
      ? new Date(metaTime * 1000).toISOString()
      : lastCandle?.timestamp ?? new Date(0).toISOString();
  const stale = isStale(symbol, asOf);
  const validated = isPositive(priceUsd) && candles.length >= 30 && !stale;

  return {
    symbol,
    assetClass,
    priceUsd,
    asOf,
    source,
    validated,
    stale,
    volume: lastCandle?.volume,
    candles,
    userMessage: validated ? undefined : (stale ? `${symbol} evaluation deferred because the latest quote was stale.` : "Market data temporarily unavailable; no trade was made."),
    technicalError: validated ? undefined : `Market data validation failed: price=${priceUsd}, candles=${candles.length}, stale=${stale}`,
    error: validated ? undefined : (stale ? `${symbol} evaluation deferred because the latest quote was stale.` : "Market data temporarily unavailable; no trade was made."),
    status: validated ? "validated" : "unavailable",
    quality: validated ? "fresh" : stale ? "stale" : "invalid"
  };
}

function invalidDataset(symbol: string, source: string, userMessage: string, technicalError = userMessage): MarketDataset {
  return {
    symbol,
    assetClass: SYMBOLS[symbol] ?? "stock",
    priceUsd: 0,
    asOf: new Date(0).toISOString(),
    source,
    validated: false,
    stale: true,
    candles: [],
    error: userMessage,
    userMessage,
    technicalError,
    status: "unavailable",
    quality: "invalid"
  };
}

function parseStooqHistory(csv: string): MarketCandle[] {
  return csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((row) => {
      const [date, open, high, low, close, volume] = row.split(",");
      return {
        timestamp: new Date(`${date}T21:00:00Z`).toISOString(),
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume)
      };
    })
    .filter((candle) => isPositive(candle.open) && isPositive(candle.high) && isPositive(candle.low) && isPositive(candle.close))
    .slice(-90);
}

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isStale(symbol: string, asOf: string): boolean {
  const ageMs = Date.now() - new Date(asOf).getTime();
  const maxAgeMs = symbol === "BTC-USD" ? 36 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  return !Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxAgeMs;
}

async function httpError(response: Response, source: string): Promise<Error> {
  const retryAfter = response.headers.get("retry-after");
  const error = new Error(`${source} responded with HTTP ${response.status}${retryAfter ? `; retry-after=${retryAfter}` : ""}`);
  if (retryAfter) {
    Object.defineProperty(error, "retryAfterMs", { value: parseRetryAfterMs(retryAfter), enumerable: false });
  }
  Object.defineProperty(error, "retryable", { value: response.status === 429 || response.status >= 500, enumerable: false });
  return error;
}

function retryDelayMs(error: Error, attempt: number): number {
  const retryAfterMs = (error as Error & { retryAfterMs?: number }).retryAfterMs;
  if (retryAfterMs && retryAfterMs > 0) {
    return Math.min(retryAfterMs, 5000);
  }
  const retryable = (error as Error & { retryable?: boolean }).retryable;
  return retryable ? 250 * 2 ** attempt : 150 * (attempt + 1);
}

function parseRetryAfterMs(value: string): number {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const dateMs = new Date(value).getTime();
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
