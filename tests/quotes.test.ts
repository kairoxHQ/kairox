import assert from "node:assert/strict";
import { test } from "node:test";
import { renderDashboardHtml, formatDashboardTimestamp } from "../src/dashboard/service.ts";
import {
  MARKET_TICKER_INSTRUMENTS,
  calculateHoldingQuote,
  freshnessStatusForQuote,
  normalizeQuoteFromDataset,
  type NormalizedQuote,
  type TickerInstrument
} from "../src/market/quotes.ts";
import type { MarketDataset } from "../src/shared/types.ts";

const openMarket = new Date("2026-07-13T14:45:00.000Z");
const closedMarket = new Date("2026-07-12T14:45:00.000Z");

test("normalizes index and yield quotes with daily changes", () => {
  const index = normalizeQuoteFromDataset(instrument("^GSPC", "index", "index", 2), dataset("^GSPC", 6400, 6300, openMarket), { now: openMarket });
  const yieldQuote = normalizeQuoteFromDataset(instrument("^TNX", "yield", "percent", 3), dataset("^TNX", 4.321, 4.2, openMarket), { now: openMarket });

  assert.equal(index.price, 6400);
  assert.equal(index.previousClose, 6300);
  assert.equal(index.absoluteChange, 100);
  assert.equal(index.percentageChange, 0.015873);
  assert.equal(index.direction, "up");
  assert.equal(yieldQuote.assetType, "yield");
  assert.equal(yieldQuote.unit, "percent");
  assert.equal(yieldQuote.absoluteChange, 0.121);
});

test("labels cached, market-closed, stale, and live quote states without overstating freshness", () => {
  const btc = normalizeQuoteFromDataset(instrument("BTC-USD", "crypto", "usd", 2, "continuous"), dataset("BTC-USD", 65000, 64000, openMarket), { now: openMarket });
  const cached = normalizeQuoteFromDataset(instrument("SPY", "etf", "usd", 2), { ...dataset("SPY", 600, 590, openMarket), status: "cached" }, { now: openMarket, cached: true });
  const closed = normalizeQuoteFromDataset(instrument("^DJI", "index", "index", 2), dataset("^DJI", 45000, 44900, closedMarket), { now: closedMarket });
  const stale = freshnessStatusForQuote({
    instrument: instrument("BTC-USD", "crypto", "usd", 2, "continuous"),
    data: dataset("BTC-USD", 65000, 64000, new Date("2026-07-13T13:00:00.000Z")),
    ageSeconds: 60 * 60,
    marketStatus: "Continuous",
    cached: false,
    now: openMarket
  });

  assert.equal(btc.freshnessStatus, "Live");
  assert.equal(cached.freshnessStatus, "Cached");
  assert.equal(closed.freshnessStatus, "Market Closed");
  assert.equal(stale, "Stale");
});

test("crypto and fractional holdings keep precision and compute unrealized gain/loss", () => {
  const quote = normalizeQuoteFromDataset(instrument("BTC-USD", "crypto", "usd", 8, "continuous"), dataset("BTC-USD", 65000.12345678, 64000, openMarket), { now: openMarket });
  const holding = calculateHoldingQuote(quote, {
    portfolioId: "portfolio_tim_paper",
    quantity: 0.00001234,
    averageCost: 60000,
    fallbackPrice: 0,
    quantityPrecision: 8
  });

  assert.equal(quote.price, 65000.12345678);
  assert.equal(holding.quantity, 0.00001234);
  assert.notEqual(holding.currentPositionValue, 0);
  assert.equal(holding.currentPositionValue, 0.8021);
  assert.equal(holding.unrealizedGainLoss, 0.0617);
  assert.equal(holding.unrealizedGainLossPercentage, 0.083333);
});

test("holding calculations remain isolated by portfolio profile", () => {
  const quote = normalizeQuoteFromDataset(instrument("SPY", "etf", "usd", 2), dataset("SPY", 120, 100, openMarket), { now: openMarket });
  const conservative = calculateHoldingQuote(quote, {
    portfolioId: "portfolio_kairox_conservative",
    quantity: 0.05,
    averageCost: 100,
    fallbackPrice: 0,
    quantityPrecision: 6
  });
  const highRisk = calculateHoldingQuote(quote, {
    portfolioId: "portfolio_kairox_high_risk",
    quantity: 0.15,
    averageCost: 110,
    fallbackPrice: 0,
    quantityPrecision: 6
  });

  assert.equal(conservative.currentPositionValue, 6);
  assert.equal(conservative.unrealizedGainLoss, 1);
  assert.equal(highRisk.currentPositionValue, 18);
  assert.equal(highRisk.unrealizedGainLoss, 1.5);
});

test("dashboard polling uses read-only quote endpoints and tolerates individual unavailable quotes", () => {
  const html = renderDashboardHtml({
    settings: { automationPaused: false },
    performance: {
      totalValueUsd: 20,
      cashUsd: 19,
      totalReturnUsd: 0,
      priceReturnUsd: 0,
      dividendReturnUsd: 0,
      tradeCount: 0,
      maxDrawdownPct: 0,
      benchmarkReturns: []
    },
    positions: [],
    recommendations: [],
    journal: [],
    trades: [],
    scheduledRuns: [],
    summaries: [],
    rejectedOpportunities: [],
    marketTicker: {
      generatedAt: openMarket.toISOString(),
      instruments: [
        normalizeQuoteFromDataset(instrument("^GSPC", "index", "index", 2), dataset("^GSPC", 6400, 6300, openMarket), { now: openMarket }),
        unavailableQuote("BAD")
      ]
    },
    profileHoldingQuotes: { generatedAt: openMarket.toISOString(), profiles: [{ portfolioId: "portfolio_tim_paper", holdings: [] }] }
  });

  assert.match(html, /data-market-ticker/);
  assert.match(html, /\/market-ticker/);
  assert.match(html, /\/profiles\/holdings\/quotes/);
  assert.doesNotMatch(html, /\/paper\/run/);
  assert.match(html, /Unavailable/);
});

test("browser-local timestamp formatting is deferred to the viewer timezone", () => {
  const rendered = formatDashboardTimestamp("2026-07-13T14:45:00.000Z", new Date("2026-07-13T15:00:00.000Z"), "America/New_York");

  assert.equal(rendered.status, "ok");
  assert.match(rendered.text, /10:45 AM EDT/);
  assert.match(rendered.text, /Updated 15 minutes ago/);
});

test("market ticker instruments use provider symbols supported by the market-data abstraction", () => {
  assert.deepEqual(
    MARKET_TICKER_INSTRUMENTS.map((item) => item.providerSymbol),
    ["^GSPC", "^DJI", "^IXIC", "^RUT", "^VIX", "^TNX", "BTC-USD"]
  );
});

function instrument(
  symbol: string,
  assetType: TickerInstrument["assetType"],
  unit: TickerInstrument["unit"],
  precision: number,
  marketHoursMode: TickerInstrument["marketHoursMode"] = "us_regular"
): TickerInstrument {
  return {
    symbol,
    providerSymbol: symbol,
    displayName: symbol,
    shortName: symbol,
    assetType,
    marketHoursMode,
    valuePrecision: precision,
    changePrecision: precision,
    unit
  };
}

function dataset(symbol: string, price: number, previousClose: number, now: Date): MarketDataset {
  const previous = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  return {
    symbol,
    assetClass: symbol.endsWith("-USD") ? "crypto" : "index",
    priceUsd: price,
    asOf: now.toISOString(),
    source: "test",
    validated: true,
    stale: false,
    candles: [
      { timestamp: previous, open: previousClose, high: previousClose, low: previousClose, close: previousClose },
      { timestamp: now.toISOString(), open: price, high: price, low: price, close: price }
    ]
  };
}

function unavailableQuote(symbol: string): NormalizedQuote {
  return {
    symbol,
    providerSymbol: symbol,
    displayName: symbol,
    shortName: symbol,
    assetType: "stock",
    price: null,
    previousClose: null,
    absoluteChange: null,
    percentageChange: null,
    direction: "unchanged",
    timestamp: null,
    marketStatus: "Unavailable",
    freshnessStatus: "Unavailable",
    source: "test",
    ageSeconds: null,
    stale: true,
    unit: "usd",
    valuePrecision: 2,
    changePrecision: 2
  };
}
