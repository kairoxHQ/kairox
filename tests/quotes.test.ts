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

test("dashboard renders a compact market ticker after account cards without restoring duplicate sections", () => {
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
        namedQuote(normalizeQuoteFromDataset(instrument("^GSPC", "index", "index", 2), dataset("^GSPC", 6400, 6300, openMarket), { now: openMarket }), "S&P 500"),
        namedQuote(normalizeQuoteFromDataset(instrument("^DJI", "index", "index", 2), dataset("^DJI", 45000, 44900, openMarket), { now: openMarket }), "Dow"),
        namedQuote(normalizeQuoteFromDataset(instrument("^IXIC", "index", "index", 2), dataset("^IXIC", 21000, 21100, openMarket), { now: openMarket }), "Nasdaq"),
        normalizeQuoteFromDataset(instrument("^VIX", "index", "index", 2), dataset("^VIX", 16, 16, openMarket), { now: openMarket }),
        normalizeQuoteFromDataset(instrument("BTC-USD", "crypto", "usd", 2, "continuous"), dataset("BTC-USD", 65000, 64000, openMarket), { now: openMarket }),
        normalizeQuoteFromDataset(instrument("^RUT", "index", "index", 2), dataset("^RUT", 2300, 2280, openMarket), { now: openMarket }),
        unavailableQuote("BAD")
      ]
    },
    profileHoldingQuotes: { generatedAt: openMarket.toISOString(), profiles: [{ portfolioId: "portfolio_tim_paper", holdings: [] }] }
  });

  assert.match(html, /Kairox Dashboard/);
  assert.match(html, /id="market-ticker"/);
  assert.match(html, /data-dashboard-market-strip/);
  assert.match(html, /S&amp;P 500/);
  assert.match(html, /Dow/);
  assert.match(html, /Nasdaq/);
  assert.match(html, /VIX/);
  assert.match(html, /BTC-USD/);
  assert.match(html, /\+100\.00 \(\+1\.59%\)/);
  assert.match(html, /-\$?100\.00 \(-0\.47%\)|-100\.00 \(-0\.47%\)/);
  assert.match(html, /Flat/);
  assert.match(html, /Open - Delayed|Closed - Market Closed|Continuous - Live/);
  assert.match(html, /Markets are open\. Regular trading ends at 4:00 PM ET\./);
  assert.ok(html.indexOf('id="accounts"') < html.indexOf('id="market-ticker"'));
  assert.doesNotMatch(html, /\^RUT|BAD/);
  assert.doesNotMatch(html, /ticker-item|ticker-strip|holding-quotes|data-holding-quotes/);
  assert.doesNotMatch(html, /data-market-ticker/);
  assert.doesNotMatch(html, /\/market-ticker/);
  assert.doesNotMatch(html, /\/profiles\/holdings\/quotes/);
  assert.doesNotMatch(html, /Decision Journal|Latest Recommendations|Scheduled Runs|Portfolio History|Research Center|Strategy Analysis|Strategy Evaluation Lab|Forward Test|Performance Comparison|Knowledge Graph|Event Timeline|Pending Paper Orders/);
  assert.doesNotMatch(html, /\/paper\/run/);
});

test("dashboard compact ticker renders unavailable quote states safely", () => {
  const html = renderDashboardHtml({
    settings: { automationPaused: false },
    performance: {
      totalValueUsd: 20,
      cashUsd: 20,
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
        unavailableQuote("^GSPC"),
        unavailableQuote("^DJI"),
        unavailableQuote("^IXIC"),
        unavailableQuote("^VIX"),
        unavailableQuote("BTC-USD")
      ]
    }
  });
  const tickerSection = html.slice(html.indexOf('id="market-ticker"'), html.indexOf('<section class="two-col">'));

  assert.match(html, /id="market-ticker"/);
  assert.match(tickerSection, /Unavailable/);
  assert.match(tickerSection, /Unavailable - Unavailable/);
  assert.match(tickerSection, /Flat/);
  assert.doesNotMatch(tickerSection, /null|undefined|NaN|Illegal invocation|HTTP 429/);
});

test("dashboard overall today matches summed account daily market moves", () => {
  const html = renderDashboardHtml({
    settings: { automationPaused: false },
    overallSummary: {
      combinedValueUsd: 351,
      todayChangeUsd: 1,
      todayChangePct: 0.002857,
      todayChangeStatus: "partial",
      todayPreviousCloseValueUsd: 350,
      totalGainLossUsd: 11,
      guardianStatus: "Clear",
      paperLiveStatus: "Paper only"
    },
    accounts: [
      {
        portfolioId: "portfolio_ira",
        profileKey: "ira",
        accountName: "IRA",
        totalCurrentValueUsd: 141,
        todayChangeUsd: 1,
        todayChangePct: 0.007143,
        todayChangeStatus: "complete",
        todayChangeDisclosure: "Daily market movement is summed from open holdings using current prices versus previous close; cash is unchanged.",
        todayPreviousCloseAccountValueUsd: 140,
        totalReturnUsd: 1,
        totalReturnPct: 0.007143,
        cashUsd: 100,
        positionCount: 2,
        riskProfile: "moderate",
        indicator: "up",
        paperLabel: "Paper",
        readOnly: false,
        managedByKairox: true
      },
      {
        portfolioId: "portfolio_tim_paper",
        profileKey: "tim_balanced",
        accountName: "Tim Balanced",
        totalCurrentValueUsd: 210,
        todayChangeUsd: 0,
        todayChangePct: 0,
        todayChangeStatus: "partial",
        todayChangeDisclosure: "Daily market movement is partial because 1 open holding lacked a usable current price or previous close.",
        todayPreviousCloseAccountValueUsd: 210,
        totalReturnUsd: 10,
        totalReturnPct: 0.05,
        cashUsd: 20,
        positionCount: 1,
        riskProfile: "moderate",
        indicator: "flat",
        paperLabel: "Paper",
        readOnly: false,
        managedByKairox: true
      }
    ],
    performance: {
      totalValueUsd: 351,
      cashUsd: 120,
      totalReturnUsd: 11,
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
    rejectedOpportunities: []
  });

  assert.match(html, /Today/);
  assert.match(html, /\+\$1\.00 \(\+0\.29%\)/);
  assert.match(html, /IRA/);
  assert.match(html, /Up \+\$1\.00 \(\+0\.71%\) today/);
  assert.match(html, /Partial daily price data/);
  assert.doesNotMatch(html, /-\$0\.00|-0\.00%/);
});

test("dashboard shows linked read-only watchlists without double-counting managed totals", () => {
  const html = renderDashboardHtml({
    settings: { automationPaused: false },
    accounts: [
      {
        portfolioId: "portfolio_tim_real_watchlist",
        profileKey: "portfolio_tim_real_watchlist",
        accountName: "Tim Real Watchlist",
        totalCurrentValueUsd: 401.77,
        todayChangeUsd: -2.98,
        todayChangePct: -0.0074,
        todayChangeStatus: "complete",
        todayChangeDisclosure: "Daily market movement is summed from open holdings using current prices versus previous close; cash is unchanged.",
        todayPreviousCloseAccountValueUsd: 404.75,
        totalReturnUsd: 61.84,
        totalReturnPct: 0.1819,
        cashUsd: 0,
        positionCount: 9,
        riskProfile: "baseline",
        indicator: "down",
        paperLabel: "Read Only",
        readOnly: true,
        managedByKairox: false
      },
      {
        portfolioId: "portfolio_tim_real_portfolio",
        profileKey: "tim_real_portfolio",
        accountName: "Tim Real Portfolio",
        totalCurrentValueUsd: 401.77,
        todayChangeUsd: -2.98,
        todayChangePct: -0.0074,
        todayChangeStatus: "complete",
        todayChangeDisclosure: "Daily market movement is summed from open holdings using current prices versus previous close; cash is unchanged.",
        todayPreviousCloseAccountValueUsd: 404.75,
        totalReturnUsd: 61.84,
        totalReturnPct: 0.1819,
        cashUsd: 0,
        positionCount: 9,
        riskProfile: "managed",
        indicator: "down",
        paperLabel: "Paper Managed",
        readOnly: false,
        managedByKairox: true
      }
    ],
    performance: {
      totalValueUsd: 401.77,
      cashUsd: 0,
      totalReturnUsd: 61.84,
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
    rejectedOpportunities: []
  });

  assert.match(html, /Tim Real Watchlist/);
  assert.match(html, /Tim Real Portfolio/);
  assert.match(html, /Read Only/);
  assert.match(html, /Paper Managed/);
  assert.match(html, /Read-only comparison account; excluded from managed totals/);
  assert.match(html, /Combined value \(managed\)/);
  assert.match(html, /1 managed account; 2 visible/);
  assert.match(html, /\$401\.77/);
  assert.doesNotMatch(html, /\$803\.54/);
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

function namedQuote(quote: NormalizedQuote, shortName: string): NormalizedQuote {
  return { ...quote, displayName: shortName, shortName };
}
