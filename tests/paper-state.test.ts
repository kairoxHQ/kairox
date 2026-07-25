import assert from "node:assert/strict";
import { test } from "node:test";
import { canExecuteAt } from "../src/market/hours.ts";
import { calculatePortfolioState, exposureForAsset } from "../src/paper/service.ts";
import { assessPaperTrade } from "../src/risk/checks.ts";
import type { AssetRegistryRecord } from "../src/market/assets.ts";
import type { MarketDataset } from "../src/shared/types.ts";

test("non-default paper portfolio state uses its own cash, positions, and high-water history", async () => {
  const db = portfolioStateDb({
    positions: {
      portfolio_tim_paper: [
        position("BTC-USD", "crypto", 0.00003111916041121339, 62433.87, 1.9429),
        position("O", "reit", 0.030669003041717817, 64.17, 1.9680299251870323),
        position("SCHD", "etf", 0.06108247898771591, 32.56, 1.9888)
      ],
      portfolio_tim_real_portfolio: [
        position("GEN", "stock", 7.606, 26.11, 198.59266),
        position("FXAIX", "mutual_fund", 0.411, 258.7, 106.3257),
        position("SOXX", "etf", 0.05069, 552.69, 28.0158561)
      ]
    },
    highWater: {
      portfolio_tim_paper: 20,
      portfolio_tim_real_portfolio: null
    }
  });

  const state = await calculatePortfolioState(
    db,
    { id: "portfolio_tim_real_portfolio", cashUsd: 0, startingBalanceUsd: 339.934075447 },
    new Map([
      ["GEN", 25.84],
      ["FXAIX", 257.65],
      ["SOXX", 527.01]
    ]),
    "portfolio_tim_real_portfolio"
  );

  assert.equal(state.cashUsd, 0);
  assert.equal(state.positionsValueUsd, 329.1473);
  assert.equal(state.totalValueUsd, 329.1473);
  assert.equal(state.drawdownPct, 0.0317);
  assert.notEqual(state.positionsValueUsd, 5.8998);
});

test("Tim Real-style paper twin drawdown is zero when current value exceeds starting balance and no history exists", async () => {
  const db = portfolioStateDb({
    positions: {
      portfolio_tim_paper: [
        position("BTC-USD", "crypto", 0.00003111916041121339, 62433.87, 1.9429),
        position("O", "reit", 0.030669003041717817, 64.17, 1.9680299251870323),
        position("SCHD", "etf", 0.06108247898771591, 32.56, 1.9888)
      ],
      portfolio_tim_real_portfolio: [
        position("BTC-USD", "crypto", 0.000061, 66370.23, 4.04858403),
        position("ETH-USD", "crypto", 0.0024, 1921.33, 4.611192),
        position("FXAIX", "mutual_fund", 0.411, 258.7, 106.3257),
        position("GEN", "stock", 7.606, 26.11, 198.59266),
        position("KO", "stock", 0.128205, 81.97, 10.50896385),
        position("MSFT", "stock", 0.060762, 397.75, 24.1680855),
        position("SOXX", "etf", 0.05069, 552.69, 28.0158561),
        position("VOO", "etf", 0.022436, 687.87, 15.43305132),
        position("VOOG", "etf", 0.1228, 81.98, 10.067144)
      ]
    },
    highWater: {
      portfolio_tim_paper: 20,
      portfolio_tim_real_portfolio: null
    }
  });

  const state = await calculatePortfolioState(
    db,
    { id: "portfolio_tim_real_portfolio", cashUsd: 0, startingBalanceUsd: 339.934075447 },
    new Map(),
    "portfolio_tim_real_portfolio"
  );

  assert.equal(state.positionsValueUsd, 401.7712);
  assert.equal(state.totalValueUsd, 401.7712);
  assert.equal(state.drawdownPct, 0);
});

test("exposure percentages use the evaluated portfolio account value denominator", () => {
  const positions = [
    position("GEN", "stock", 7.606, 25.84, 196.53904),
    position("FXAIX", "mutual_fund", 0.411, 257.65, 105.89415)
  ];
  const totalValueUsd = 396.31389458;

  const genExposure = exposureForAsset(asset("GEN", "stock"), positions, totalValueUsd, 0);
  const fxaixExposure = exposureForAsset(asset("FXAIX", "mutual_fund"), positions, totalValueUsd, 0);

  assert.ok(Math.abs(genExposure.symbolExposurePct - 0.496) < 0.0001);
  assert.ok(Math.abs(fxaixExposure.symbolExposurePct - 0.2672) < 0.0001);
  assert.ok(genExposure.symbolExposurePct < 0.5);
  assert.ok(fxaixExposure.symbolExposurePct < 0.5);
});

test("Tim Paper portfolio state remains unchanged when evaluated explicitly", async () => {
  const db = portfolioStateDb({
    positions: {
      portfolio_tim_paper: [
        position("BTC-USD", "crypto", 0.00003111916041121339, 62433.87, 1.9429),
        position("O", "reit", 0.030669003041717817, 64.17, 1.9680299251870323),
        position("SCHD", "etf", 0.06108247898771591, 32.56, 1.9888)
      ],
      portfolio_tim_real_portfolio: [
        position("GEN", "stock", 7.606, 26.11, 198.59266)
      ]
    },
    highWater: {
      portfolio_tim_paper: 20,
      portfolio_tim_real_portfolio: null
    }
  });

  const state = await calculatePortfolioState(
    db,
    { id: "portfolio_tim_paper", cashUsd: 13.803113777839874, startingBalanceUsd: 20 },
    new Map(),
    "portfolio_tim_paper"
  );

  assert.equal(state.positionsValueUsd, 5.8998);
  assert.equal(state.totalValueUsd, 19.7029);
  assert.equal(state.drawdownPct, 0.0149);
});

test("market-hours, mutual-fund, and BUY-only drawdown restrictions are unchanged", () => {
  assert.equal(canExecuteAt("etf", new Date("2026-07-25T15:00:00.000Z"), "us_regular").allowed, false);
  assert.equal(canExecuteAt("mutual_fund", new Date("2026-07-25T15:00:00.000Z"), "fund_end_of_day").allowed, false);

  const buyRisk = assessPaperTrade({
    action: "BUY",
    marketData: marketData("GEN", "stock"),
    portfolioValueUsd: 396,
    cashUsd: 40,
    currentPositionValueUsd: 0,
    proposedTradeValueUsd: 10,
    drawdownPct: 0.1,
    duplicateSignal: false,
    openedNewPositionThisRun: false,
    hasPosition: false
  });
  const sellRisk = assessPaperTrade({
    action: "SELL",
    marketData: marketData("GEN", "stock"),
    portfolioValueUsd: 396,
    cashUsd: 0,
    currentPositionValueUsd: 196,
    proposedTradeValueUsd: 196,
    drawdownPct: 0.1,
    duplicateSignal: false,
    openedNewPositionThisRun: false,
    hasPosition: true
  });

  assert.equal(buyRisk.allowed, false);
  assert.match(buyRisk.reasons.join(" "), /drawdown/);
  assert.equal(sellRisk.reasons.some((reason) => /drawdown/i.test(reason)), false);
});

function portfolioStateDb(fixture: {
  positions: Record<string, PositionRow[]>;
  highWater: Record<string, number | null>;
}): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          const portfolioId = String(params[0]);
          return {
            async all() {
              if (/FROM positions/i.test(sql)) {
                return { results: fixture.positions[portfolioId] ?? [] };
              }
              return { results: [] };
            },
            async first() {
              if (/MAX\(total_value_usd\)/i.test(sql)) {
                return { highWater: fixture.highWater[portfolioId] ?? null };
              }
              return null;
            }
          };
        }
      };
    }
  } as unknown as D1Database;
}

interface PositionRow {
  id: string;
  symbol: string;
  assetClass: string;
  quantity: number;
  avgEntryPriceUsd: number;
  currentPriceUsd: number;
  marketValueUsd: number;
}

function position(symbol: string, assetClass: string, quantity: number, currentPriceUsd: number, marketValueUsd: number): PositionRow {
  return {
    id: `position_${symbol}`,
    symbol,
    assetClass,
    quantity,
    avgEntryPriceUsd: currentPriceUsd,
    currentPriceUsd,
    marketValueUsd
  };
}

function asset(symbol: string, assetType: AssetRegistryRecord["assetType"]): AssetRegistryRecord {
  return {
    id: `asset_${symbol}`,
    symbol,
    displayName: symbol,
    assetType,
    market: assetType === "crypto" ? "crypto" : "US",
    currency: "USD",
    providerSymbol: symbol,
    enabled: true,
    tradable: assetType !== "mutual_fund",
    fractionalSupported: true,
    dividendCapable: assetType !== "crypto",
    expenseRatio: null,
    minimumInvestment: null,
    marketHoursMode: assetType === "crypto" ? "continuous" : assetType === "mutual_fund" ? "fund_end_of_day" : "us_regular",
    pricePrecision: 2,
    quantityPrecision: assetType === "crypto" ? 8 : 6
  };
}

function marketData(symbol: string, assetClass: MarketDataset["assetClass"]): MarketDataset {
  return {
    symbol,
    assetClass,
    priceUsd: 25.84,
    asOf: "2026-07-24T20:00:00.000Z",
    source: "test",
    validated: true,
    stale: false,
    candles: []
  };
}
