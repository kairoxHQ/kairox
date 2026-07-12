import type { MarketDataProvider } from "./provider.ts";
import type { MarketDataset, MarketPrice } from "../shared/types.ts";

export class MockMarketDataProvider implements MarketDataProvider {
  readonly name = "mock_market_data";

  async getLatestPrice(symbol: string): Promise<MarketPrice> {
    const data = await this.getMarketData(symbol);
    return data;
  }

  async getMarketData(symbol: string): Promise<MarketDataset> {
    return {
      symbol,
      assetClass: symbol === "BTC" ? "crypto" : "stock",
      priceUsd: symbol === "BTC" ? 65000 : 0,
      asOf: new Date().toISOString(),
      source: this.name,
      validated: false,
      stale: true,
      candles: [],
      error: "Mock data is not valid for Sprint 2 paper execution."
    };
  }
}
