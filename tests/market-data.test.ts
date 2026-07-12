import assert from "node:assert/strict";
import { test } from "node:test";
import { renderDashboardHtml } from "../src/dashboard/service.ts";
import { shouldUseCachedSnapshot, shouldUseLastKnownGood } from "../src/market/status.ts";
import { YahooFinanceMarketDataProvider } from "../src/market/yahooFinanceProvider.ts";
import { decidePaperAction } from "../src/strategy/paperStrategy.ts";
import { sanitizeForUser } from "../src/shared/messages.ts";

test("market provider invokes injected fetch with the global receiver", async () => {
  const fetchLike = function (this: unknown, input: RequestInfo | URL): Promise<Response> {
    assert.equal(this, globalThis);
    const url = String(input);
    if (url.includes("/ticker")) {
      return Promise.resolve(Response.json({ price: "64000", time: "2026-07-12T12:00:00.000Z" }));
    }
    return Promise.resolve(Response.json([[1782000000, 63000, 65000, 64000, 64500, 1000], ...btcCandles()]));
  } as typeof fetch;

  const provider = new YahooFinanceMarketDataProvider(fetchLike);
  const data = await provider.getMarketData("BTC-USD");

  assert.equal(data.validated, true);
  assert.equal(data.source, "coinbase_public_market_data");
});

test("Yahoo 429 handling falls back to Stooq for SPY without exposing raw HTTP text to users", async () => {
  const calls: string[] = [];
  const provider = new YahooFinanceMarketDataProvider(((input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("query1.finance.yahoo.com")) {
      return Promise.resolve(new Response("rate limited", { status: 429, headers: { "Retry-After": "0" } }));
    }
    return Promise.resolve(new Response(stooqHistoryCsv(), { status: 200, headers: { "content-type": "text/csv" } }));
  }) as typeof fetch);

  const data = await provider.getMarketData("SPY");

  assert.equal(data.validated, true);
  assert.equal(data.source, "stooq_public_market_data");
  assert.ok(calls.some((url) => url.includes("query1.finance.yahoo.com")));
  assert.ok(calls.some((url) => url.includes("stooq.com/q/d/l")));
  assert.doesNotMatch(data.userMessage ?? "", /HTTP 429|Retry-After/i);
});

test("cache freshness rules reuse D1 snapshots before repeated provider calls", () => {
  assert.equal(shouldUseCachedSnapshot("BTC-USD", 299), true);
  assert.equal(shouldUseCachedSnapshot("BTC-USD", 301), false);
  assert.equal(shouldUseCachedSnapshot("SPY", 1200), true);
});

test("stale last-known-good rules expire unavailable market data", () => {
  assert.equal(shouldUseLastKnownGood("SPY", 4 * 24 * 60 * 60), true);
  assert.equal(shouldUseLastKnownGood("SPY", 4 * 24 * 60 * 60 + 1), false);
});

test("fully unavailable market data results in DO_NOTHING", () => {
  const decision = decidePaperAction({
    hasPosition: false,
    marketData: {
      symbol: "SPY",
      assetClass: "etf",
      priceUsd: 0,
      asOf: new Date(0).toISOString(),
      source: "all_public_sources_unavailable",
      validated: false,
      stale: true,
      candles: [],
      userMessage: "Market data temporarily unavailable; no trade was made.",
      technicalError: "Yahoo HTTP 429; Stooq browser verification failed",
      error: "Market data temporarily unavailable; no trade was made."
    }
  });

  assert.equal(decision.action, "DO_NOTHING");
  assert.doesNotMatch(decision.explanation, /HTTP 429|browser verification|Yahoo/i);
});

test("public sanitization hides technical errors while diagnostics can keep them separately", () => {
  assert.equal(
    sanitizeForUser("Illegal invocation: function called with incorrect `this` reference. See https://developers.cloudflare.com/workers/"),
    "No action was taken."
  );
});

test("dashboard uses Kairox branding and keeps raw diagnostics out of normal UI", () => {
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
    recommendations: [{ symbol: "SPY", action: "DO_NOTHING", explanation: "Illegal invocation: function called with incorrect `this` reference" }],
    journal: [{ decision: "DO_NOTHING", explanation: "Market data temporarily unavailable; no trade was made." }],
    trades: [],
    scheduledRuns: [],
    summaries: [{ summaryType: "morning", title: "Morning Kairox paper-trading summary", body: "Market data temporarily unavailable; no trade was made." }],
    rejectedOpportunities: [],
    marketDataStatus: [{
      symbol: "SPY",
      source: "stooq_public_market_data",
      fetchedAt: "2026-07-12T12:00:00.000Z",
      isFresh: false,
      status: "deferred",
      userMessage: "SPY evaluation deferred because the latest quote was stale."
    }]
  });

  assert.match(html, /<title>Kairox Dashboard<\/title>/);
  assert.match(html, /Market Data Status/);
  assert.doesNotMatch(html, /Illegal invocation|developers.cloudflare.com|HTTP 429/);
});

function btcCandles(): Array<[number, number, number, number, number, number]> {
  return Array.from({ length: 35 }, (_, index) => {
    const close = 64000 + index;
    return [1780000000 + index * 86400, close - 100, close + 100, close - 50, close, 1000 + index];
  });
}

function stooqHistoryCsv(): string {
  const rows = Array.from({ length: 45 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 4, 27 + index)).toISOString().slice(0, 10);
    const close = 600 + index;
    return `${date},${close - 1},${close + 2},${close - 2},${close},${1000000 + index}`;
  });
  return `Date,Open,High,Low,Close,Volume\n${rows.join("\n")}`;
}
