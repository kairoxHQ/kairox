import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import worker from "../src/index.ts";
import { parseAssetRow } from "../src/market/assets.ts";
import { canExecuteAt } from "../src/market/hours.ts";
import { YahooFinanceMarketDataProvider } from "../src/market/yahooFinanceProvider.ts";
import { rankOpportunities, screenAsset } from "../src/strategy/screener.ts";
import { decidePaperAction } from "../src/strategy/paperStrategy.ts";
import type { AssetClass, MarketDataset } from "../src/shared/types.ts";

test("asset registry parses Sprint 5A asset metadata", () => {
  const asset = parseAssetRow({
    id: "asset_vti",
    symbol: "VTI",
    displayName: "Vanguard Total Stock Market ETF",
    assetType: "etf",
    market: "US",
    currency: "USD",
    providerSymbol: "VTI",
    enabled: 1,
    tradable: 1,
    fractionalSupported: 1,
    dividendCapable: 1,
    expenseRatio: null,
    minimumInvestment: null,
    marketHoursMode: "us_regular",
    pricePrecision: 2,
    quantityPrecision: 6,
    rankingPriority: 30,
    notes: "Broad market candidate."
  });

  assert.equal(asset.symbol, "VTI");
  assert.equal(asset.assetType, "etf");
  assert.equal(asset.tradable, true);
  assert.equal(asset.marketHoursMode, "us_regular");
});

test("asset registry rejects unsupported asset types", () => {
  assert.throws(
    () =>
      parseAssetRow({
        id: "asset_option",
        symbol: "SPY240119C",
        displayName: "Unsupported option",
        assetType: "option",
        market: "US",
        currency: "USD",
        providerSymbol: "SPY240119C",
        enabled: 1,
        tradable: 0,
        fractionalSupported: 0,
        dividendCapable: 0,
        expenseRatio: null,
        minimumInvestment: null,
        marketHoursMode: "disabled",
        pricePrecision: 2,
        quantityPrecision: 0
      }),
    /Unsupported asset type/
  );
});

test("market-hours modes are asset-aware", () => {
  assert.equal(canExecuteAt("crypto", new Date("2026-07-12T03:00:00.000Z"), "continuous").allowed, true);
  assert.equal(canExecuteAt("reit", new Date("2026-07-13T14:00:00.000Z"), "us_regular").allowed, true);
  assert.equal(canExecuteAt("bond_fund", new Date("2026-07-13T22:00:00.000Z"), "us_regular").allowed, false);
  assert.equal(canExecuteAt("money_market", new Date("2026-07-13T14:00:00.000Z"), "cash_equivalent").allowed, false);
});

test("public market provider can evaluate a non-hardcoded stock symbol", async () => {
  const provider = new YahooFinanceMarketDataProvider(((input: RequestInfo | URL) => {
    const url = String(input);
    assert.match(url, /AAPL/);
    return Promise.resolve(Response.json(yahooChartPayload("AAPL")));
  }) as typeof fetch);

  const data = await provider.getMarketData("AAPL");

  assert.equal(data.symbol, "AAPL");
  assert.equal(data.assetClass, "stock");
  assert.equal(data.validated, true);
});

test("asset universe endpoints are public read routes", async () => {
  const env = { DB: {} as D1Database, APP_MODE: "paper", LIVE_TRADING_ENABLED: "false", STARTING_BALANCE_USD: "20", BENCHMARK_ASSET: "BTC" };

  const assetResponse = await worker.fetch(new Request("https://kairox.test/assets", { method: "POST" }), env);
  const watchlistResponse = await worker.fetch(new Request("https://kairox.test/watchlists", { method: "POST" }), env);
  const opportunitiesResponse = await worker.fetch(new Request("https://kairox.test/opportunities", { method: "POST" }), env);

  assert.equal(assetResponse.status, 405);
  assert.equal(watchlistResponse.status, 405);
  assert.equal(opportunitiesResponse.status, 405);
});

test("Sprint 5B migration seeds the controlled universe idempotently", () => {
  const sql = readFileSync("migrations/0007_controlled_multi_asset_universe.sql", "utf8");
  for (const symbol of ["VOO", "VTI", "QQQ", "SCHD", "SOXX", "BND", "MSFT", "AAPL", "O", "FXAIX"]) {
    assert.match(sql, new RegExp(`'${symbol}'`));
  }
  assert.match(sql, /INSERT OR IGNORE INTO assets/);
  assert.match(sql, /INSERT OR IGNORE INTO watchlist_assets/);
  assert.doesNotMatch(sql, /DELETE FROM portfolios|DELETE FROM positions|DELETE FROM trades/i);
});

test("Sprint 5B watchlist priorities stay in the approved order", () => {
  const sql = readFileSync("migrations/0007_controlled_multi_asset_universe.sql", "utf8");
  const expected = [
    ["asset_btc_usd", 10],
    ["asset_spy", 20],
    ["asset_voo", 30],
    ["asset_vti", 40],
    ["asset_qqq", 50],
    ["asset_schd", 60],
    ["asset_soxx", 70],
    ["asset_bnd", 80],
    ["asset_msft", 90],
    ["asset_aapl", 100],
    ["asset_o", 110],
    ["asset_fxaix", 120]
  ] as const;

  for (const [assetId, priority] of expected) {
    assert.match(sql, new RegExp(`WHEN '${assetId}' THEN ${priority}`));
  }
});

test("provider classifies controlled stock, ETF, REIT, bond ETF, and mutual fund symbols", async () => {
  const provider = new YahooFinanceMarketDataProvider(((input: RequestInfo | URL) => {
    const symbol = decodeURIComponent(String(input).split("/chart/")[1]?.split("?")[0] ?? "SPY");
    return Promise.resolve(Response.json(yahooChartPayload(symbol)));
  }) as typeof fetch);

  const cases: Array<[string, AssetClass]> = [
    ["MSFT", "stock"],
    ["VOO", "etf"],
    ["O", "reit"],
    ["BND", "bond_fund"],
    ["FXAIX", "mutual_fund"]
  ];

  for (const [symbol, assetClass] of cases) {
    const data = await provider.getMarketData(symbol);
    assert.equal(data.symbol, symbol);
    assert.equal(data.assetClass, assetClass);
    assert.equal(data.validated, true);
  }
});

test("provider failure for one controlled asset is isolated as unavailable data", async () => {
  const provider = new YahooFinanceMarketDataProvider((() => Promise.resolve(new Response("upstream failed", { status: 503 }))) as typeof fetch);
  const data = await provider.getMarketData("MSFT");

  assert.equal(data.symbol, "MSFT");
  assert.equal(data.validated, false);
  assert.equal(data.status, "unavailable");
  assert.doesNotMatch(data.userMessage ?? "", /503|upstream/i);
});

test("mutual-fund daily NAV candidates are screened out for production paper execution", () => {
  const screen = screenAsset({
    asset: asset("FXAIX", "mutual_fund", "fund_end_of_day", false, 120),
    marketData: marketData("FXAIX", "mutual_fund"),
    now: new Date("2026-07-13T15:00:00.000Z"),
    exposure: { portfolioValueUsd: 20, drawdownPct: 0, symbolExposurePct: 0, categoryExposurePct: 0 }
  });

  assert.equal(screen.eligible, false);
  assert.match(screen.reason, /Mutual funds require reliable daily NAV/);
});

test("stale data excludes an otherwise tradable candidate", () => {
  const data = marketData("VOO", "etf");
  data.validated = false;
  data.stale = true;
  data.userMessage = "VOO evaluation deferred because the latest quote was stale.";

  const screen = screenAsset({
    asset: asset("VOO", "etf", "us_regular", true, 30),
    marketData: data,
    now: new Date("2026-07-13T15:00:00.000Z"),
    exposure: { portfolioValueUsd: 20, drawdownPct: 0, symbolExposurePct: 0, categoryExposurePct: 0 }
  });

  assert.equal(screen.eligible, false);
  assert.equal(screen.dataFreshness, "Stale");
});

test("screener eligibility and deterministic ranking use score, confidence, and priority", () => {
  const now = new Date("2026-07-13T15:00:00.000Z");
  const voo = marketData("VOO", "etf", 1.2);
  const bnd = marketData("BND", "bond_fund", 0.2);
  const items = [
    {
      asset: asset("BND", "bond_fund", "us_regular", true, 80),
      marketData: bnd,
      decision: decidePaperAction({ marketData: bnd, hasPosition: false }),
      screen: screenAsset({
        asset: asset("BND", "bond_fund", "us_regular", true, 80),
        marketData: bnd,
        now,
        exposure: { portfolioValueUsd: 20, drawdownPct: 0, symbolExposurePct: 0, categoryExposurePct: 0 }
      }),
      positionValueUsd: 0,
      hasPosition: false
    },
    {
      asset: asset("VOO", "etf", "us_regular", true, 30),
      marketData: voo,
      decision: decidePaperAction({ marketData: voo, hasPosition: false }),
      screen: screenAsset({
        asset: asset("VOO", "etf", "us_regular", true, 30),
        marketData: voo,
        now,
        exposure: { portfolioValueUsd: 20, drawdownPct: 0, symbolExposurePct: 0, categoryExposurePct: 0 }
      }),
      positionValueUsd: 0,
      hasPosition: false
    }
  ];

  const ranked = rankOpportunities(items);

  assert.equal(ranked[0].asset.symbol, "VOO");
  assert.equal(ranked[0].screen.rank, 1);
  assert.ok(ranked.every((item) => item.screen.eligible));
});

test("concentration penalty lowers similarly ranked ETF opportunities", () => {
  const now = new Date("2026-07-13T15:00:00.000Z");
  const lowExposure = screenAsset({
    asset: asset("VOO", "etf", "us_regular", true, 30),
    marketData: marketData("VOO", "etf"),
    now,
    exposure: { portfolioValueUsd: 20, drawdownPct: 0, symbolExposurePct: 0, categoryExposurePct: 0 }
  });
  const concentrated = screenAsset({
    asset: asset("VOO", "etf", "us_regular", true, 30),
    marketData: marketData("VOO", "etf"),
    now,
    exposure: { portfolioValueUsd: 20, drawdownPct: 0, symbolExposurePct: 0.26, categoryExposurePct: 0.4 }
  });

  assert.ok(concentrated.score < lowExposure.score);
});

test("status endpoint keeps live trading disabled", async () => {
  const env = { DB: {} as D1Database, APP_MODE: "paper", LIVE_TRADING_ENABLED: "false", STARTING_BALANCE_USD: "20", BENCHMARK_ASSET: "BTC" };
  const response = await worker.fetch(new Request("https://kairox.test/status"), env);
  const body = await response.json() as { safety: { liveTradingEnabled: boolean } };

  assert.equal(response.status, 200);
  assert.equal(body.safety.liveTradingEnabled, false);
});

function yahooChartPayload(symbol: string) {
  const start = Math.floor((Date.now() - 34 * 86400000) / 1000);
  const timestamp = Array.from({ length: 35 }, (_, index) => start + index * 86400);
  const close = Array.from({ length: 35 }, (_, index) => 190 + index);
  return {
    chart: {
      result: [
        {
          meta: {
            regularMarketPrice: close.at(-1),
            regularMarketTime: timestamp.at(-1),
            symbol
          },
          timestamp,
          indicators: {
            quote: [
              {
                open: close.map((value) => value - 1),
                high: close.map((value) => value + 1),
                low: close.map((value) => value - 2),
                close,
                volume: close.map((_, index) => 1000000 + index)
              }
            ]
          }
        }
      ]
    }
  };
}

function asset(symbol: string, assetType: AssetClass, marketHoursMode: "continuous" | "us_regular" | "fund_end_of_day", tradable: boolean, rankingPriority: number) {
  return {
    id: `asset_${symbol.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
    symbol,
    displayName: symbol,
    assetType,
    market: assetType === "crypto" ? "crypto" : "US",
    currency: "USD",
    providerSymbol: symbol,
    enabled: true,
    tradable,
    fractionalSupported: true,
    dividendCapable: assetType !== "crypto",
    expenseRatio: null,
    minimumInvestment: null,
    marketHoursMode,
    pricePrecision: 2,
    quantityPrecision: assetType === "crypto" ? 8 : 6,
    rankingPriority
  };
}

function marketData(symbol: string, assetClass: AssetClass, dailyStep = 0.8): MarketDataset {
  const candles = Array.from({ length: 40 }, (_, index) => {
    const close = 100 + index * dailyStep + Math.sin(index) * 0.25;
    return {
      timestamp: new Date(Date.now() - (40 - index) * 86400000).toISOString(),
      open: close - 0.2,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1000000 + index
    };
  });

  return {
    symbol,
    assetClass,
    priceUsd: candles.at(-1)?.close ?? 100,
    asOf: new Date().toISOString(),
    source: "test",
    validated: true,
    stale: false,
    volume: 1000000,
    candles,
    status: "validated",
    quality: "fresh"
  };
}
