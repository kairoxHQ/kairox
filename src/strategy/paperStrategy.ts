import { calculateIndicators, type Indicators } from "./indicators.ts";
import type { DecisionAction, MarketDataset } from "../shared/types.ts";

export interface StrategyInput {
  marketData: MarketDataset;
  hasPosition: boolean;
}

export interface StrategyDecision {
  symbol: string;
  action: DecisionAction;
  confidenceScore: number;
  riskScore: number;
  indicators: Indicators;
  explanation: string;
  signalKey: string;
  transactionCostEstimateUsd: number;
}

const MINIMUM_CONFIDENCE = 0.6;
const TRANSACTION_COST_RATE = 0.0035;

export function decidePaperAction(input: StrategyInput): StrategyDecision {
  const { marketData, hasPosition } = input;
  const indicators = calculateIndicators(marketData.candles);

  if (!marketData.validated) {
    return decision(marketData, "DO_NOTHING", 0.95, 0.05, indicators, marketData.error ?? "Market data is unavailable or stale.");
  }

  const missingIndicator =
    indicators.shortMovingAverage === null ||
    indicators.longMovingAverage === null ||
    indicators.rsi === null ||
    indicators.momentumPct === null;

  if (missingIndicator) {
    return decision(marketData, "DO_NOTHING", 0.9, 0.05, indicators, "Insufficient candle history for deterministic indicators.");
  }

  const shortMovingAverage = indicators.shortMovingAverage;
  const longMovingAverage = indicators.longMovingAverage;
  const rsi = indicators.rsi;
  const momentumPct = indicators.momentumPct;

  if (
    shortMovingAverage === null ||
    longMovingAverage === null ||
    rsi === null ||
    momentumPct === null
  ) {
    return decision(marketData, "DO_NOTHING", 0.9, 0.05, indicators, "Insufficient candle history for deterministic indicators.");
  }

  const bullish =
    shortMovingAverage > longMovingAverage &&
    rsi >= 35 &&
    rsi <= 70 &&
    momentumPct > 0;
  const bearish =
    shortMovingAverage < longMovingAverage ||
    rsi > 75 ||
    momentumPct < -0.03;
  const confidence = scoreConfidence(indicators);

  if (!hasPosition && bullish && confidence >= MINIMUM_CONFIDENCE) {
    return decision(marketData, "BUY", confidence, 0.45, indicators, "Bullish moving-average, RSI, and momentum signal passed the confidence threshold.");
  }

  if (hasPosition && bearish && confidence >= MINIMUM_CONFIDENCE) {
    return decision(marketData, "SELL", confidence, 0.35, indicators, "Exit signal from moving averages, RSI, or negative momentum passed the confidence threshold.");
  }

  if (hasPosition) {
    return decision(marketData, "HOLD", confidence, 0.15, indicators, "No deterministic exit signal is strong enough to justify a paper sell.");
  }

  return decision(marketData, "DO_NOTHING", confidence, 0.05, indicators, "No deterministic buy signal met the confidence threshold.");
}

export function estimateTransactionCost(priceUsd: number, notionalUsd: number): number {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0 || !Number.isFinite(notionalUsd) || notionalUsd <= 0) {
    return 0;
  }

  return Math.max(0.01, notionalUsd * TRANSACTION_COST_RATE);
}

function decision(
  marketData: MarketDataset,
  action: DecisionAction,
  confidenceScore: number,
  riskScore: number,
  indicators: Indicators,
  explanation: string
): StrategyDecision {
  const indicatorKey = [
    indicators.shortMovingAverage,
    indicators.longMovingAverage,
    indicators.rsi,
    indicators.momentumPct
  ].map((value) => (value === null ? "na" : value.toFixed(4)));
  const signalKey = `${marketData.symbol}:${action}:${marketData.asOf}:${indicatorKey.join(":")}`;

  return {
    symbol: marketData.symbol,
    action,
    confidenceScore,
    riskScore,
    indicators,
    explanation,
    signalKey,
    transactionCostEstimateUsd: estimateTransactionCost(marketData.priceUsd, Math.max(1, marketData.priceUsd * 0.0001))
  };
}

function scoreConfidence(indicators: Indicators): number {
  if (
    indicators.shortMovingAverage === null ||
    indicators.longMovingAverage === null ||
    indicators.rsi === null ||
    indicators.momentumPct === null
  ) {
    return 0.4;
  }

  const maSpread = Math.min(0.25, Math.abs(indicators.shortMovingAverage - indicators.longMovingAverage) / indicators.longMovingAverage);
  const momentumScore = Math.min(0.25, Math.abs(indicators.momentumPct));
  const rsiBalance = indicators.rsi >= 35 && indicators.rsi <= 70 ? 0.2 : 0.05;

  return Math.min(0.95, 0.45 + maSpread + momentumScore + rsiBalance);
}
