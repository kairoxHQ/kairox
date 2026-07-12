import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateIndicators, calculateRsi, momentum, movingAverage } from "../src/strategy/indicators.ts";

test("movingAverage calculates the trailing average", () => {
  assert.equal(movingAverage([1, 2, 3, 4, 5], 3), 4);
});

test("RSI returns a bounded value", () => {
  const rsi = calculateRsi([44, 45, 44, 46, 47, 48, 47, 49, 50, 51, 50, 52, 53, 54, 55], 14);
  assert.equal(typeof rsi, "number");
  assert.ok(rsi! >= 0 && rsi! <= 100);
});

test("momentum returns percent change over lookback", () => {
  assert.equal(momentum([100, 101, 102, 103, 104, 110], 5), 0.1);
});

test("calculateIndicators returns all configured indicators with enough candles", () => {
  const candles = Array.from({ length: 30 }, (_, index) => ({
    timestamp: new Date(2026, 0, index + 1).toISOString(),
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100 + index,
    volume: 1000
  }));

  const indicators = calculateIndicators(candles);
  assert.equal(typeof indicators.shortMovingAverage, "number");
  assert.equal(typeof indicators.longMovingAverage, "number");
  assert.equal(typeof indicators.rsi, "number");
  assert.equal(typeof indicators.momentumPct, "number");
});
