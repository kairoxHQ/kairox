import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validateInvestmentPolicy, type InvestmentPolicy } from "../src/policies/investmentPolicy.ts";
import { renderDashboardHtml } from "../src/dashboard/service.ts";

const migration = readFileSync("migrations/0014_ira_investment_policy.sql", "utf8");
const policy: InvestmentPolicy = {
  id: "policy_portfolio_ira_conservative_retirement",
  portfolioId: "portfolio_ira",
  status: "active",
  riskProfile: "Conservative",
  primaryObjective: "Capital preservation with moderate long-term growth",
  timeHorizon: "Long term",
  incomeNeed: "Low",
  liquidityRequirement: "Moderate",
  maxDrawdownPct: 0.1,
  minCashAllocationPct: 0.1,
  maxSinglePositionPct: 0.2,
  maxSectorAllocationPct: 0.3,
  allowedAssetTypes: ["stock", "etf", "bond_fund", "money_market"],
  allowedInvestmentTypes: ["Broad-market ETFs", "Dividend ETFs", "Bond ETFs", "Treasury ETFs"],
  prohibitedInvestmentTypes: ["options", "margin", "leveraged_etf", "inverse_etf", "crypto", "penny_stock", "short_selling", "futures", "concentrated_single_stock"],
  simulationBeganAt: "2026-07-13T21:00:00.000Z"
};

test("IRA conservative investment policy is stored in a reusable database table", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS account_investment_policies/);
  assert.match(migration, /'policy_portfolio_ira_conservative_retirement'/);
  assert.match(migration, /'portfolio_ira'/);
  assert.match(migration, /'Conservative'/);
  assert.match(migration, /0\.10/);
  assert.match(migration, /0\.20/);
  assert.match(migration, /0\.30/);
  assert.match(migration, /UPDATE watchlist_assets[\s\S]*asset_btc_usd/);
});

test("valid conservative ETF purchase passes IRA policy validation", () => {
  const result = validateInvestmentPolicy({
    policy,
    action: "BUY",
    symbol: "VOO",
    assetClass: "etf",
    portfolioValueUsd: 2400,
    cashUsd: 2400,
    currentPositionValueUsd: 0,
    proposedTradeValueUsd: 240
  });

  assert.equal(result.allowed, true);
});

test("position-size violation is rejected", () => {
  const result = validateInvestmentPolicy({
    policy,
    action: "BUY",
    symbol: "VOO",
    assetClass: "etf",
    portfolioValueUsd: 2400,
    cashUsd: 2400,
    currentPositionValueUsd: 200,
    proposedTradeValueUsd: 400
  });

  assert.equal(result.allowed, false);
  assert.match(result.reasons.join(" "), /maximum single-position/);
});

test("minimum-cash violation is rejected", () => {
  const result = validateInvestmentPolicy({
    policy,
    action: "BUY",
    symbol: "BND",
    assetClass: "bond_fund",
    portfolioValueUsd: 2400,
    cashUsd: 300,
    currentPositionValueUsd: 0,
    proposedTradeValueUsd: 100
  });

  assert.equal(result.allowed, false);
  assert.match(result.reasons.join(" "), /minimum cash/);
});

test("prohibited leveraged ETF is rejected", () => {
  const result = validateInvestmentPolicy({
    policy,
    action: "BUY",
    symbol: "TQQQ",
    assetClass: "etf",
    portfolioValueUsd: 2400,
    cashUsd: 2400,
    currentPositionValueUsd: 0,
    proposedTradeValueUsd: 100,
    securityTags: ["leveraged_etf"]
  });

  assert.equal(result.allowed, false);
  assert.match(result.reasons.join(" "), /leveraged etf/);
});

test("prohibited cryptocurrency is rejected", () => {
  const result = validateInvestmentPolicy({
    policy,
    action: "BUY",
    symbol: "BTC-USD",
    assetClass: "crypto",
    portfolioValueUsd: 2400,
    cashUsd: 2400,
    currentPositionValueUsd: 0,
    proposedTradeValueUsd: 100
  });

  assert.equal(result.allowed, false);
  assert.match(result.reasons.join(" "), /crypto is not an allowed asset type|cryptocurrency|crypto/);
});

test("prohibited margin or short order is rejected", () => {
  const margin = validateInvestmentPolicy({
    policy,
    action: "BUY",
    orderIntent: "margin_buy",
    symbol: "VOO",
    assetClass: "etf",
    portfolioValueUsd: 2400,
    cashUsd: 2400,
    currentPositionValueUsd: 0,
    proposedTradeValueUsd: 100
  });
  const short = validateInvestmentPolicy({
    policy,
    action: "SELL",
    orderIntent: "short_sell",
    symbol: "AAPL",
    assetClass: "stock",
    portfolioValueUsd: 2400,
    cashUsd: 2400,
    currentPositionValueUsd: 0,
    proposedTradeValueUsd: 100
  });

  assert.equal(margin.allowed, false);
  assert.match(margin.reasons.join(" "), /margin/);
  assert.equal(short.allowed, false);
  assert.match(short.reasons.join(" "), /short selling/);
});

test("dashboard displays IRA conservative account summary and paper badge", () => {
  const html = renderDashboardHtml({
    selectedPortfolioId: "portfolio_ira",
    accountProfiles: [{ portfolioId: "portfolio_ira", profileKey: "ira", displayName: "IRA", riskPosture: "Conservative" }],
    investmentPolicy: policy,
    settings: { automationPaused: false },
    performance: {
      startingBalanceUsd: 2400,
      totalValueUsd: 2400,
      cashUsd: 2400,
      positionsValueUsd: 0,
      todayGainLossUsd: 0,
      totalReturnUsd: 0,
      priceReturnUsd: 0,
      dividendReturnUsd: 0,
      tradeCount: 0,
      maxDrawdownPct: 0,
      benchmarkReturns: []
    },
    positions: [],
    recommendations: [],
    journal: [],
    trades: [],
    scheduledRuns: [],
    summaries: [],
    rejectedOpportunities: []
  });

  assert.match(html, /Accounts/);
  assert.match(html, /Conservative/);
  assert.match(html, /Paper/);
  assert.match(html, /\$2,400\.00/);
  assert.match(html, /Open account detail/);
  assert.doesNotMatch(html, /Capital preservation with moderate long-term growth|Max drawdown/);
});
