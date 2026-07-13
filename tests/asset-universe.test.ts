import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAssetRow } from "../src/market/assets.ts";
import { canExecuteAt } from "../src/market/hours.ts";
import { YahooFinanceMarketDataProvider } from "../src/market/yahooFinanceProvider.ts";

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
