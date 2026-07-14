import type { MarketDataset, MarketPrice } from "../shared/types.ts";
import type { AssetRegistryRecord } from "./assets.ts";

export interface MarketDataProvider {
  readonly name: string;
  getLatestPrice(symbol: string): Promise<MarketPrice>;
  getMarketData(symbol: string): Promise<MarketDataset>;
  getMarketDataForAsset?(asset: AssetRegistryRecord): Promise<MarketDataset>;
  getQuotes?(symbols: string[]): Promise<MarketDataset[]>;
  getHistoricalPrices?(symbol: string, startDate: string, endDate: string): Promise<MarketDataset>;
  getSecurityMetadata?(symbol: string): Promise<unknown>;
  getMarketStatus?(): Promise<unknown>;
  getTradingCalendar?(startDate: string, endDate: string): Promise<unknown>;
}
