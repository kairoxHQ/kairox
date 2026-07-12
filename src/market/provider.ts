import type { MarketDataset, MarketPrice } from "../shared/types.ts";

export interface MarketDataProvider {
  readonly name: string;
  getLatestPrice(symbol: string): Promise<MarketPrice>;
  getMarketData(symbol: string): Promise<MarketDataset>;
}
