import { isRegularUsMarketHours } from "./hours.ts";
import { lastKnownGoodMaxAgeSeconds, shouldUseLastKnownGood } from "./status.ts";
import { YahooFinanceMarketDataProvider } from "./yahooFinanceProvider.ts";
import { listRows, PERMANENT_PORTFOLIO_IDS } from "../shared/db.ts";
import { roundMoney, roundRatio } from "../shared/money.ts";
import type { AssetClass, MarketCandle, MarketDataset } from "../shared/types.ts";

export type UserQuoteStatus = "Live" | "Delayed" | "Cached" | "Market Closed" | "Stale" | "Unavailable";
export type QuoteDirection = "up" | "down" | "unchanged";

export interface TickerInstrument {
  symbol: string;
  providerSymbol: string;
  displayName: string;
  shortName: string;
  assetType: AssetClass;
  marketHoursMode: "continuous" | "us_regular";
  valuePrecision: number;
  changePrecision: number;
  unit: "usd" | "index" | "percent";
}

export interface NormalizedQuote {
  symbol: string;
  providerSymbol: string;
  displayName: string;
  shortName: string;
  assetType: AssetClass;
  price: number | null;
  previousClose: number | null;
  absoluteChange: number | null;
  percentageChange: number | null;
  direction: QuoteDirection;
  timestamp: string | null;
  marketStatus: "Open" | "Closed" | "Continuous" | "Unavailable";
  freshnessStatus: UserQuoteStatus;
  source: string;
  ageSeconds: number | null;
  stale: boolean;
  unit: "usd" | "index" | "percent";
  valuePrecision: number;
  changePrecision: number;
}

export interface HoldingQuote extends NormalizedQuote {
  portfolioId: string;
  quantity: number;
  averageCost: number;
  currentPositionValue: number | null;
  unrealizedGainLoss: number | null;
  unrealizedGainLossPercentage: number | null;
  quantityPrecision: number;
}

interface SnapshotRow {
  symbol: string;
  assetClass: AssetClass;
  source: string;
  priceUsd: number;
  priceAsOf: string;
  candlesJson: string;
  createdAt: string;
}

interface HoldingRow {
  portfolioId: string;
  symbol: string;
  assetClass: AssetClass;
  quantity: number;
  avgEntryPriceUsd: number;
  currentPriceUsd: number;
  marketValueUsd: number;
  displayName: string | null;
  providerSymbol: string | null;
  pricePrecision: number | null;
  quantityPrecision: number | null;
  marketHoursMode: string | null;
}

export const MARKET_TICKER_INSTRUMENTS: TickerInstrument[] = [
  ticker("^GSPC", "S&P 500", "S&P 500", "index", 2),
  ticker("^DJI", "Dow Jones Industrial Average", "Dow", "index", 2),
  ticker("^IXIC", "Nasdaq Composite", "Nasdaq", "index", 2),
  ticker("^RUT", "Russell 2000", "Russell 2000", "index", 2),
  ticker("^VIX", "CBOE Volatility Index", "VIX", "index", 2),
  {
    symbol: "^TNX",
    providerSymbol: "^TNX",
    displayName: "U.S. 10-Year Treasury Yield",
    shortName: "10Y Yield",
    assetType: "yield",
    marketHoursMode: "us_regular",
    valuePrecision: 3,
    changePrecision: 3,
    unit: "percent"
  },
  {
    symbol: "BTC-USD",
    providerSymbol: "BTC-USD",
    displayName: "Bitcoin",
    shortName: "BTC-USD",
    assetType: "crypto",
    marketHoursMode: "continuous",
    valuePrecision: 2,
    changePrecision: 2,
    unit: "usd"
  }
];

export async function getMarketTickerQuotes(db: D1Database, now = new Date()): Promise<{ instruments: NormalizedQuote[]; generatedAt: string }> {
  const provider = new YahooFinanceMarketDataProvider();
  const instruments = await Promise.all(MARKET_TICKER_INSTRUMENTS.map((instrument) => getQuoteForInstrument(db, provider, instrument, now)));
  return { instruments, generatedAt: now.toISOString() };
}

export async function getQuotesForSymbols(db: D1Database, symbols: string, now = new Date()): Promise<{ quotes: NormalizedQuote[]; generatedAt: string }> {
  const requested = symbols
    .split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean)
    .slice(0, 40);
  const instruments = await Promise.all(requested.map((symbol) => resolveInstrument(db, symbol)));
  const provider = new YahooFinanceMarketDataProvider();
  const quotes = await Promise.all(instruments.map((instrument) => getQuoteForInstrument(db, provider, instrument, now)));
  return { quotes, generatedAt: now.toISOString() };
}

export async function getHoldingQuotes(db: D1Database, portfolioId: string, now = new Date()): Promise<{ portfolioId: string; holdings: HoldingQuote[]; generatedAt: string }> {
  const allowedPortfolio = PERMANENT_PORTFOLIO_IDS.find((id) => id === portfolioId);
  if (!allowedPortfolio) {
    return { portfolioId, holdings: [], generatedAt: now.toISOString() };
  }

  const holdings = await listRows<HoldingRow>(
    db
      .prepare(
        `SELECT p.portfolio_id AS portfolioId, p.symbol, p.asset_class AS assetClass,
          p.quantity, p.avg_entry_price_usd AS avgEntryPriceUsd,
          p.current_price_usd AS currentPriceUsd, p.market_value_usd AS marketValueUsd,
          a.display_name AS displayName, a.provider_symbol AS providerSymbol,
          a.price_precision AS pricePrecision, a.quantity_precision AS quantityPrecision,
          a.market_hours_mode AS marketHoursMode
         FROM positions p
         LEFT JOIN assets a ON a.symbol = p.symbol
         WHERE p.portfolio_id = ? AND p.quantity > 0
         ORDER BY p.market_value_usd DESC, p.symbol ASC`
      )
      .bind(allowedPortfolio)
  );
  const provider = new YahooFinanceMarketDataProvider();
  const quotes = await Promise.all(
    holdings.map(async (holding) => {
      const instrument: TickerInstrument = {
        symbol: holding.symbol,
        providerSymbol: holding.providerSymbol ?? holding.symbol,
        displayName: holding.displayName ?? holding.symbol,
        shortName: holding.symbol,
        assetType: holding.assetClass,
        marketHoursMode: holding.marketHoursMode === "continuous" ? "continuous" : "us_regular",
        valuePrecision: holding.pricePrecision ?? (holding.assetClass === "crypto" ? 8 : 2),
        changePrecision: holding.pricePrecision ?? (holding.assetClass === "crypto" ? 8 : 2),
        unit: "usd"
      };
      const quote = await getQuoteForInstrument(db, provider, instrument, now);
      return calculateHoldingQuote(quote, {
        portfolioId: holding.portfolioId,
        quantity: holding.quantity,
        averageCost: holding.avgEntryPriceUsd,
        fallbackPrice: holding.currentPriceUsd,
        quantityPrecision: holding.quantityPrecision ?? (holding.assetClass === "crypto" ? 8 : 6)
      });
    })
  );

  return { portfolioId: allowedPortfolio, holdings: quotes, generatedAt: now.toISOString() };
}

export async function getAllProfileHoldingQuotes(db: D1Database, now = new Date()): Promise<{ profiles: Array<{ portfolioId: string; holdings: HoldingQuote[] }>; generatedAt: string }> {
  const profiles = await Promise.all(PERMANENT_PORTFOLIO_IDS.map((portfolioId) => getHoldingQuotes(db, portfolioId, now)));
  return {
    profiles: profiles.map((profile) => ({ portfolioId: profile.portfolioId, holdings: profile.holdings })),
    generatedAt: now.toISOString()
  };
}

export function normalizeQuoteFromDataset(instrument: TickerInstrument, data: MarketDataset, options: { now?: Date; cached?: boolean } = {}): NormalizedQuote {
  const now = options.now ?? new Date();
  const price = data.validated && data.priceUsd > 0 ? roundTo(data.priceUsd, instrument.valuePrecision) : null;
  const previousClose = price === null ? null : previousCloseFromCandles(data.candles, data.asOf);
  const absoluteChange = price === null || previousClose === null ? null : roundTo(price - previousClose, instrument.changePrecision);
  const percentageChange = price === null || previousClose === null ? null : roundRatio((price - previousClose) / previousClose);
  const ageSeconds = ageInSeconds(data.asOf, now);
  const marketStatus = marketStatusForInstrument(instrument, now, price !== null);
  const freshnessStatus = freshnessStatusForQuote({
    instrument,
    data,
    ageSeconds,
    marketStatus,
    cached: options.cached ?? data.status === "cached",
    now
  });

  return {
    symbol: instrument.symbol,
    providerSymbol: instrument.providerSymbol,
    displayName: instrument.displayName,
    shortName: instrument.shortName,
    assetType: instrument.assetType,
    price,
    previousClose,
    absoluteChange,
    percentageChange,
    direction: directionForChange(absoluteChange),
    timestamp: price === null ? null : data.asOf,
    marketStatus,
    freshnessStatus,
    source: data.source,
    ageSeconds,
    stale: freshnessStatus === "Stale" || freshnessStatus === "Unavailable",
    unit: instrument.unit,
    valuePrecision: instrument.valuePrecision,
    changePrecision: instrument.changePrecision
  };
}

export function calculateHoldingQuote(
  quote: NormalizedQuote,
  holding: { portfolioId: string; quantity: number; averageCost: number; fallbackPrice: number; quantityPrecision: number }
): HoldingQuote {
  const price = quote.price ?? (holding.fallbackPrice > 0 ? holding.fallbackPrice : null);
  const currentPositionValue = price === null ? null : roundMoney(price * holding.quantity);
  const costBasis = holding.averageCost * holding.quantity;
  const unrealizedGainLoss = currentPositionValue === null ? null : roundMoney(currentPositionValue - costBasis);
  return {
    ...quote,
    portfolioId: holding.portfolioId,
    quantity: holding.quantity,
    averageCost: roundMoney(holding.averageCost),
    currentPositionValue,
    unrealizedGainLoss,
    unrealizedGainLossPercentage: unrealizedGainLoss === null || costBasis <= 0 ? null : roundRatio(unrealizedGainLoss / costBasis),
    quantityPrecision: holding.quantityPrecision
  };
}

export function freshnessStatusForQuote(input: {
  instrument: TickerInstrument;
  data: MarketDataset;
  ageSeconds: number | null;
  marketStatus: NormalizedQuote["marketStatus"];
  cached: boolean;
  now: Date;
}): UserQuoteStatus {
  if (!input.data.validated || input.data.priceUsd <= 0 || input.ageSeconds === null) {
    return "Unavailable";
  }
  if (!shouldUseLastKnownGood(input.instrument.symbol, input.ageSeconds)) {
    return "Stale";
  }
  if (input.marketStatus === "Closed") {
    return "Market Closed";
  }
  if (input.cached) {
    return "Cached";
  }
  if (input.instrument.marketHoursMode === "continuous") {
    return input.ageSeconds <= 60 ? "Live" : input.ageSeconds <= lastKnownGoodMaxAgeSeconds(input.instrument.symbol) ? "Delayed" : "Stale";
  }
  return "Delayed";
}

function ticker(symbol: string, displayName: string, shortName: string, assetType: "index", precision: number): TickerInstrument {
  return {
    symbol,
    providerSymbol: symbol,
    displayName,
    shortName,
    assetType,
    marketHoursMode: "us_regular",
    valuePrecision: precision,
    changePrecision: precision,
    unit: "index"
  };
}

async function getQuoteForInstrument(
  db: D1Database,
  provider: YahooFinanceMarketDataProvider,
  instrument: TickerInstrument,
  now: Date
): Promise<NormalizedQuote> {
  try {
    const live = await provider.getMarketData(instrument.providerSymbol);
    if (live.validated) {
      return normalizeQuoteFromDataset(instrument, { ...live, symbol: instrument.symbol, assetClass: instrument.assetType }, { now });
    }
  } catch {
    // Public responses intentionally hide provider error details.
  }

  const snapshot = await getLastKnownGoodSnapshot(db, instrument.symbol, now);
  if (snapshot) {
    return normalizeQuoteFromDataset(instrument, snapshot, { now, cached: true });
  }

  return unavailableQuote(instrument, now);
}

async function resolveInstrument(db: D1Database, requestedSymbol: string): Promise<TickerInstrument> {
  const normalized = requestedSymbol.toUpperCase();
  const tickerInstrument = MARKET_TICKER_INSTRUMENTS.find((instrument) => instrument.symbol.toUpperCase() === normalized || instrument.providerSymbol.toUpperCase() === normalized);
  if (tickerInstrument) {
    return tickerInstrument;
  }
  const asset = await db
    .prepare(
      `SELECT symbol, display_name AS displayName, asset_type AS assetType,
        provider_symbol AS providerSymbol, market_hours_mode AS marketHoursMode,
        price_precision AS pricePrecision
       FROM assets
       WHERE symbol = ? OR provider_symbol = ?
       LIMIT 1`
    )
    .bind(normalized, normalized)
    .first<{
      symbol: string;
      displayName: string;
      assetType: AssetClass;
      providerSymbol: string;
      marketHoursMode: string;
      pricePrecision: number;
    }>();
  return {
    symbol: asset?.symbol ?? normalized,
    providerSymbol: asset?.providerSymbol ?? normalized,
    displayName: asset?.displayName ?? normalized,
    shortName: asset?.symbol ?? normalized,
    assetType: asset?.assetType ?? (normalized.endsWith("-USD") ? "crypto" : "stock"),
    marketHoursMode: asset?.marketHoursMode === "continuous" ? "continuous" : "us_regular",
    valuePrecision: asset?.pricePrecision ?? (normalized.endsWith("-USD") ? 8 : 2),
    changePrecision: asset?.pricePrecision ?? (normalized.endsWith("-USD") ? 8 : 2),
    unit: "usd"
  };
}

async function getLastKnownGoodSnapshot(db: D1Database, symbol: string, now: Date): Promise<MarketDataset | null> {
  const row = await db
    .prepare(
      `SELECT symbol, asset_class AS assetClass, source,
        price_usd AS priceUsd, price_as_of AS priceAsOf,
        candles_json AS candlesJson, created_at AS createdAt
       FROM market_snapshots
       WHERE symbol = ? AND validation_status = 'validated' AND price_usd > 0
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(symbol)
    .first<SnapshotRow>();
  if (!row) {
    return null;
  }
  const ageSeconds = ageInSeconds(row.createdAt, now);
  if (ageSeconds === null || !shouldUseLastKnownGood(symbol, ageSeconds)) {
    return null;
  }
  return {
    symbol: row.symbol,
    assetClass: row.assetClass,
    priceUsd: row.priceUsd,
    asOf: row.priceAsOf,
    source: row.source,
    validated: true,
    stale: false,
    candles: parseCandles(row.candlesJson),
    status: "cached",
    quality: "acceptable_cached"
  };
}

function previousCloseFromCandles(candles: MarketCandle[], asOf: string): number | null {
  const valid = candles.filter((candle) => Number.isFinite(candle.close) && candle.close > 0);
  if (valid.length === 0) {
    return null;
  }
  const asOfDay = asOf.slice(0, 10);
  const beforeAsOfDay = valid.filter((candle) => candle.timestamp.slice(0, 10) < asOfDay);
  const previous = beforeAsOfDay.at(-1) ?? (valid.length > 1 ? valid.at(-2) : valid.at(-1));
  return previous ? roundTo(previous.close, 8) : null;
}

function marketStatusForInstrument(instrument: TickerInstrument, now: Date, hasPrice: boolean): NormalizedQuote["marketStatus"] {
  if (!hasPrice) {
    return "Unavailable";
  }
  if (instrument.marketHoursMode === "continuous") {
    return "Continuous";
  }
  return isRegularUsMarketHours(now) ? "Open" : "Closed";
}

function unavailableQuote(instrument: TickerInstrument, now: Date): NormalizedQuote {
  return {
    symbol: instrument.symbol,
    providerSymbol: instrument.providerSymbol,
    displayName: instrument.displayName,
    shortName: instrument.shortName,
    assetType: instrument.assetType,
    price: null,
    previousClose: null,
    absoluteChange: null,
    percentageChange: null,
    direction: "unchanged",
    timestamp: null,
    marketStatus: "Unavailable",
    freshnessStatus: "Unavailable",
    source: "public_market_data",
    ageSeconds: null,
    stale: true,
    unit: instrument.unit,
    valuePrecision: instrument.valuePrecision,
    changePrecision: instrument.changePrecision
  };
}

function directionForChange(value: number | null): QuoteDirection {
  if (value === null || value === 0) {
    return "unchanged";
  }
  return value > 0 ? "up" : "down";
}

function ageInSeconds(value: string, now: Date): number | null {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time) || time > now.getTime() + 5 * 60 * 1000) {
    return null;
  }
  return Math.max(0, Math.floor((now.getTime() - time) / 1000));
}

function parseCandles(value: string): MarketCandle[] {
  try {
    const parsed = JSON.parse(value) as MarketCandle[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function roundTo(value: number, precision: number): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}
