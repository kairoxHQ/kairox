import assert from "node:assert/strict";
import { test } from "node:test";
import { assessPaperTrade } from "../src/risk/checks.ts";
import { decidePaperAction } from "../src/strategy/paperStrategy.ts";
import type { MarketDataset } from "../src/shared/types.ts";

test("strategy records DO_NOTHING for malformed market data", () => {
  const decision = decidePaperAction({
    hasPosition: false,
    marketData: invalidMarketData("Market data validation failed")
  });

  assert.equal(decision.action, "DO_NOTHING");
  assert.match(decision.explanation, /Market data validation failed/);
});

test("strategy emits BUY for bullish validated data without a position", () => {
  const decision = decidePaperAction({
    hasPosition: false,
    marketData: trendingMarketData()
  });

  assert.equal(decision.action, "BUY");
  assert.ok(decision.confidenceScore >= 0.6);
});

test("risk blocks buys above the 10 percent trade limit", () => {
  const risk = assessPaperTrade({
    action: "BUY",
    marketData: trendingMarketData(),
    portfolioValueUsd: 20,
    cashUsd: 20,
    currentPositionValueUsd: 0,
    proposedTradeValueUsd: 3,
    drawdownPct: 0,
    duplicateSignal: false,
    openedNewPositionThisRun: false,
    hasPosition: false
  });

  assert.equal(risk.allowed, false);
  assert.match(risk.reasons.join(" "), /10%/);
});

test("risk blocks duplicate signals for idempotency", () => {
  const risk = assessPaperTrade({
    action: "BUY",
    marketData: trendingMarketData(),
    portfolioValueUsd: 20,
    cashUsd: 20,
    currentPositionValueUsd: 0,
    proposedTradeValueUsd: 2,
    drawdownPct: 0,
    duplicateSignal: true,
    openedNewPositionThisRun: false,
    hasPosition: false
  });

  assert.equal(risk.allowed, false);
  assert.match(risk.reasons.join(" "), /already been processed/);
});

test("risk blocks new buys after 10 percent drawdown", () => {
  const risk = assessPaperTrade({
    action: "BUY",
    marketData: trendingMarketData(),
    portfolioValueUsd: 18,
    cashUsd: 18,
    currentPositionValueUsd: 0,
    proposedTradeValueUsd: 1,
    drawdownPct: 0.1,
    duplicateSignal: false,
    openedNewPositionThisRun: false,
    hasPosition: false
  });

  assert.equal(risk.allowed, false);
  assert.match(risk.reasons.join(" "), /drawdown/);
});

function trendingMarketData(): MarketDataset {
  const candles = Array.from({ length: 35 }, (_, index) => ({
    timestamp: new Date(Date.now() - (35 - index) * 86400000).toISOString(),
    open: 100 + index * 0.4 + Math.sin(index * 1.7) * 2,
    high: 101 + index * 0.4 + Math.sin(index * 1.7) * 2,
    low: 99 + index * 0.4 + Math.sin(index * 1.7) * 2,
    close: 100 + index * 0.4 + Math.sin(index * 1.7) * 2,
    volume: 1000 + index
  }));

  return {
    symbol: "SPY",
    assetClass: "etf",
    priceUsd: 135,
    asOf: new Date().toISOString(),
    source: "test",
    validated: true,
    stale: false,
    volume: 1035,
    candles
  };
}

function invalidMarketData(error: string): MarketDataset {
  return {
    symbol: "SPY",
    assetClass: "etf",
    priceUsd: 0,
    asOf: new Date(0).toISOString(),
    source: "test",
    validated: false,
    stale: true,
    candles: [],
    error
  };
}
