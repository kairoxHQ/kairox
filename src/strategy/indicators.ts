import type { MarketCandle } from "../shared/types.ts";

export interface Indicators {
  shortMovingAverage: number | null;
  longMovingAverage: number | null;
  rsi: number | null;
  momentumPct: number | null;
}

export function movingAverage(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) {
    return null;
  }

  const slice = values.slice(-period);
  return slice.reduce((sum, value) => sum + value, 0) / period;
}

export function calculateRsi(values: number[], period = 14): number | null {
  if (period <= 0 || values.length <= period) {
    return null;
  }

  const slice = values.slice(-(period + 1));
  let gains = 0;
  let losses = 0;

  for (let index = 1; index < slice.length; index += 1) {
    const delta = slice[index] - slice[index - 1];
    if (delta >= 0) {
      gains += delta;
    } else {
      losses += Math.abs(delta);
    }
  }

  const averageGain = gains / period;
  const averageLoss = losses / period;

  if (averageLoss === 0) {
    return 100;
  }

  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

export function momentum(values: number[], lookback = 5): number | null {
  if (lookback <= 0 || values.length <= lookback) {
    return null;
  }

  const current = values.at(-1);
  const previous = values.at(-(lookback + 1));
  if (!current || !previous) {
    return null;
  }

  return (current - previous) / previous;
}

export function calculateIndicators(candles: MarketCandle[]): Indicators {
  const closes = candles.map((candle) => candle.close).filter((value) => Number.isFinite(value) && value > 0);

  return {
    shortMovingAverage: movingAverage(closes, 5),
    longMovingAverage: movingAverage(closes, 20),
    rsi: calculateRsi(closes, 14),
    momentumPct: momentum(closes, 5)
  };
}
