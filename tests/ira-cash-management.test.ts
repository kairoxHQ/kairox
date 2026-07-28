import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { evaluateIraCashManagement, resolveIraCashManagementParameters, type IraCashManagementInput } from "../src/policies/iraCashManagement.ts";
import type { AssetRegistryRecord } from "../src/market/assets.ts";
import type { MarketDataset } from "../src/shared/types.ts";

const policySource = readFileSync("src/policies/iraCashManagement.ts", "utf8");
const paperSource = readFileSync("src/paper/service.ts", "utf8");
const observationSource = readFileSync("src/paper/observation.ts", "utf8");
const portfolioSource = readFileSync("src/portfolio/service.ts", "utf8");
const migration = readFileSync("migrations/0041_ira_idle_cash_policy.sql", "utf8");

const bndAsset: AssetRegistryRecord = {
  id: "asset_bnd",
  symbol: "BND",
  displayName: "Vanguard Total Bond Market ETF",
  assetType: "bond_fund",
  market: "US",
  currency: "USD",
  providerSymbol: "BND",
  enabled: true,
  tradable: true,
  fractionalSupported: true,
  dividendCapable: true,
  expenseRatio: 0.0003,
  minimumInvestment: null,
  marketHoursMode: "us_regular",
  pricePrecision: 2,
  quantityPrecision: 6
};

const validQuote: MarketDataset = {
  symbol: "BND",
  assetClass: "bond_fund",
  priceUsd: 72.64,
  asOf: "2026-07-29T15:00:00.000Z",
  source: "yahoo_finance_chart",
  validated: true,
  candles: [],
  stale: false,
  quality: "fresh",
  status: "validated"
};

function input(overrides: Partial<IraCashManagementInput> = {}): IraCashManagementInput {
  return {
    portfolioId: "portfolio_ira",
    cashUsd: 1900,
    totalValueUsd: 2400,
    existingPositionValueUsd: 0,
    asset: bndAsset,
    marketData: validQuote,
    hasOrdinaryExecution: false,
    tradedTargetToday: false,
    maxNewTradePct: 0.1,
    currentPositionLimitPct: 0.2,
    feeRate: 0.001,
    slippageBps: 25,
    now: new Date("2026-07-29T15:00:00.000Z"),
    ...overrides
  };
}

test("IRA with excess idle cash evaluates the cash-management policy", () => {
  const decision = evaluateIraCashManagement(input());
  assert.equal(decision.action, "BUY");
  assert.equal(decision.targetSymbol, "BND");
  assert.match(decision.reason, /Deploy excess IRA cash/);
});

test("required operational reserve is preserved", () => {
  const decision = evaluateIraCashManagement(input());
  assert.equal(decision.requiredReserveUsd, 120);
  assert.equal(decision.targetReserveUsd, 180);
  assert.equal(decision.proposedDeploymentUsd <= 1900 - 120, true);
});

test("only deployable excess cash is eligible for investment", () => {
  const decision = evaluateIraCashManagement(input({ cashUsd: 350, totalValueUsd: 2400, maxNewTradePct: 1 }));
  assert.equal(decision.deployableExcessCashUsd, 170);
  assert.equal(decision.proposedDeploymentUsd <= decision.deployableExcessCashUsd, true);
});

test("cash below the maximum threshold produces no cash-deployment order", () => {
  const decision = evaluateIraCashManagement(input({ cashUsd: 250, totalValueUsd: 2400 }));
  assert.equal(decision.action, "DO_NOTHING");
  assert.match(decision.reason, /within policy limits/);
});

test("deployable amount below the minimum trade size produces no order with a clear reason", () => {
  const decision = evaluateIraCashManagement(input({
    cashUsd: 310,
    totalValueUsd: 2400,
    parameters: { targetOperationalCashReservePct: 0.123, maxUnallocatedCashPct: 0.125 }
  }));
  assert.equal(decision.action, "DO_NOTHING");
  assert.match(decision.reason, /below minimum/);
});

test("stale or invalid quotes prevent deployment", () => {
  const stale = evaluateIraCashManagement(input({ marketData: { ...validQuote, stale: true, quality: "stale" } }));
  const invalid = evaluateIraCashManagement(input({ marketData: { ...validQuote, validated: false, priceUsd: 0, quality: "invalid" } }));
  assert.equal(stale.action, "DO_NOTHING");
  assert.equal(invalid.action, "DO_NOTHING");
  assert.match(`${stale.reason} ${invalid.reason}`, /stale or invalid/);
});

test("unsupported assets are rejected", () => {
  const decision = evaluateIraCashManagement(input({ asset: null, marketData: null }));
  assert.equal(decision.action, "DO_NOTHING");
  assert.match(decision.reason, /no supported allowlisted/);
});

test("only allowlisted conservative assets can receive fallback cash", () => {
  const asset = { ...bndAsset, symbol: "VOO", assetType: "etf" as const };
  const decision = evaluateIraCashManagement(input({ asset, marketData: { ...validQuote, symbol: "VOO", assetClass: "etf" } }));
  assert.equal(decision.action, "DO_NOTHING");
  assert.match(decision.reason, /no supported allowlisted/);
});

test("no leveraged, inverse, crypto, option, or speculative asset is selected", () => {
  for (const symbol of ["TQQQ", "SQQQ", "BITO", "SPY-OPTION", "JUNK"]) {
    const asset = { ...bndAsset, symbol, displayName: `${symbol} leveraged inverse crypto option junk` };
    const decision = evaluateIraCashManagement(input({ asset, marketData: { ...validQuote, symbol } }));
    assert.equal(decision.action, "DO_NOTHING");
  }
});

test("daily deployment limit is enforced", () => {
  const decision = evaluateIraCashManagement(input());
  assert.equal(decision.proposedDeploymentUsd, 240);
});

test("same-day repeated cash-equivalent churn is prevented", () => {
  const decision = evaluateIraCashManagement(input({ tradedTargetToday: true }));
  assert.equal(decision.action, "DO_NOTHING");
  assert.match(decision.reason, /same-day/);
});

test("purchase cannot exceed available cash", () => {
  const decision = evaluateIraCashManagement(input({ cashUsd: 150, totalValueUsd: 1000 }));
  assert.equal(decision.action, "DO_NOTHING");
});

test("fees and slippage are included", () => {
  const decision = evaluateIraCashManagement(input());
  assert.equal(decision.feeUsd, 0.24);
  assert.equal(decision.slippageUsd, 0.6);
});

test("cash-management parameters are configurable and migrated only for the IRA", () => {
  const params = resolveIraCashManagementParameters({ minimumDeploymentUsd: 50, conservativeAllowlist: [{ symbol: "bnd", category: "broad_bond_market_etf", targetAllocationPct: 0.15, priority: 3 }] });
  assert.equal(params.minimumDeploymentUsd, 50);
  assert.equal(params.conservativeAllowlist[0].symbol, "BND");
  assert.match(migration, /WHERE portfolio_id = 'portfolio_ira'/);
  assert.doesNotMatch(migration, /portfolio_tim_real|portfolio_real|strategy_experiment_portfolios/);
});

test("scheduler includes the IRA profile and child completes independently", () => {
  assert.match(observationSource, /listPortfolioProfiles\(this\.db, \{ includeReadOnly: false \}\)/);
  assert.match(observationSource, /profile\.portfolioId/);
  assert.match(observationSource, /finalizeParent\(parent\.id, now\)/);
});

test("duplicate scheduler runs cannot duplicate orders", () => {
  assert.match(paperSource, /SELECT summary_json AS summaryJson FROM strategy_runs WHERE run_key = \?/);
  assert.match(paperSource, /IRA_CASH:\$\{marketData\.symbol\}:\$\{action\}:\$\{day\}/);
  assert.match(paperSource, /INSERT OR IGNORE INTO orders/);
  assert.match(paperSource, /INSERT OR IGNORE INTO trades/);
});

test("recommendations, orders, and trades carry complete audit links", () => {
  for (const field of ["scheduler_parent_run_id", "scheduler_child_run_id", "strategy_profile_key", "quote_source", "quote_timestamp", "recommendation_id"]) {
    assert.match(paperSource, new RegExp(field));
  }
  assert.match(paperSource, /cashBeforeUsd/);
  assert.match(paperSource, /requiredReserveUsd/);
  assert.match(paperSource, /deployableExcessCashUsd/);
});

test("UI distinguishes operational cash from cash-equivalent holdings", () => {
  assert.match(portfolioSource, /IRA Cash Management/);
  assert.match(portfolioSource, /Operational reserve/);
  assert.match(portfolioSource, /Cash-equivalent investments/);
  assert.match(portfolioSource, /Bond investments/);
  assert.match(portfolioSource, /Equity investments/);
});

test("UI displays excess idle cash and latest decision reason", () => {
  assert.match(portfolioSource, /Excess idle cash/);
  assert.match(portfolioSource, /Latest cash-management decision/);
});

test("existing ETF holdings remain unchanged unless a valid strategy decision changes them", () => {
  assert.doesNotMatch(policySource, /SCHD[\s\S]*SELL|UPDATE positions[\s\S]*SCHD/);
});

test("five-strategy experiment portfolios remain unchanged", () => {
  assert.doesNotMatch(migration, /strategy_experiment/);
  assert.match(paperSource, /input\.portfolioId !== "portfolio_ira"/);
});

test("Tim Real portfolios remain unchanged", () => {
  assert.doesNotMatch(migration, /Tim Real|read_only_watchlist|paper_portfolio_twin/);
  assert.match(paperSource, /profile\.profileKey !== "ira"/);
});

test("live execution remains disabled", () => {
  assert.match(paperSource, /paperOnly: true/);
  assert.match(paperSource, /liveTradingEnabled: false/);
  assert.doesNotMatch(paperSource, /LIVE_TRADING_ENABLED"\s*,\s*"true"|live_trading_allowed\s*=\s*1/);
});
