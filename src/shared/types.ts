export type AssetClass = "stock" | "etf" | "crypto" | "option" | "future" | "cash";
export type DecisionAction = "BUY" | "SELL" | "HOLD" | "DO_NOTHING";
export type OrderSide = "BUY" | "SELL";

export interface Env {
  DB: D1Database;
  APP_MODE: "paper";
  LIVE_TRADING_ENABLED: "false";
  STARTING_BALANCE_USD: string;
  BENCHMARK_ASSET: string;
  PAPER_RUN_SECRET?: string;
}

export interface MarketPrice {
  symbol: string;
  assetClass: AssetClass;
  priceUsd: number;
  asOf: string;
  source: string;
  validated: boolean;
}

export interface MarketCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface MarketDataset extends MarketPrice {
  candles: MarketCandle[];
  volume?: number;
  stale: boolean;
  error?: string;
  userMessage?: string;
  technicalError?: string;
  status?: "validated" | "cached" | "deferred" | "unavailable";
  quality?: "fresh" | "acceptable_cached" | "stale" | "invalid";
}

export interface Recommendation {
  id: string;
  portfolioId: string;
  symbol: string;
  action: DecisionAction;
  explanation: string;
  confidenceScore: number;
  riskScore: number;
  marketData: MarketPrice;
  createdAt: string;
}
