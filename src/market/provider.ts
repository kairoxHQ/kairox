import type { MarketDataset, MarketPrice } from "../shared/types.ts";
import type { AssetRegistryRecord } from "./assets.ts";

export interface MarketDataProvider {
  readonly name: string;
  getLatestPrice(symbol: string): Promise<MarketPrice>;
  getMarketData(symbol: string): Promise<MarketDataset>;
  getMarketDataForAsset?(asset: AssetRegistryRecord): Promise<MarketDataset>;
}
