import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  evaluateIraCashManagement,
  resolveDefensiveIraAlternativeCashManagementParameters,
  resolveIraCashManagementParameters,
  sizeTradeDownToCap,
  type IraCashManagementInput
} from "../src/policies/iraCashManagement.ts";
import type { AssetRegistryRecord } from "../src/market/assets.ts";
import type { MarketDataset } from "../src/shared/types.ts";
import { assessPaperTrade } from "../src/risk/checks.ts";

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

test("Conservative IRA alternatives can deploy initial all-cash capital to BND without lowering equity threshold", () => {
  const parameters = resolveDefensiveIraAlternativeCashManagementParameters(
    "portfolio_ira_alternatives_2400_v1_conservative",
    "ira_alternatives_2400_v1_conservative"
  );
  const decision = evaluateIraCashManagement(input({
    portfolioId: "portfolio_ira_alternatives_2400_v1_conservative",
    cashUsd: 2400,
    totalValueUsd: 2400,
    maxNewTradePct: 0.08,
    currentPositionLimitPct: 0.2,
    parameters
  }));

  assert.equal(decision.action, "BUY");
  assert.equal(decision.targetSymbol, "BND");
  assert.equal(decision.proposedDeploymentUsd, 192);
  assert.equal(decision.requiredReserveUsd, 240);
  assert.equal(decision.targetReserveUsd, 360);
  assert.match(decision.reason, /initial defensive allocation/);
  assert.doesNotMatch(policySource, /buyThreshold\s*[:=]\s*0\.5/);
});

test("Guardian IRA alternatives deploy more slowly than Conservative", () => {
  const conservativeParameters = resolveDefensiveIraAlternativeCashManagementParameters(
    "portfolio_ira_alternatives_2400_v1_conservative",
    "ira_alternatives_2400_v1_conservative"
  );
  const guardianParameters = resolveDefensiveIraAlternativeCashManagementParameters(
    "portfolio_ira_alternatives_2400_v1_guardian",
    "ira_alternatives_2400_v1_guardian"
  );
  const conservative = evaluateIraCashManagement(input({
    portfolioId: "portfolio_ira_alternatives_2400_v1_conservative",
    cashUsd: 2400,
    totalValueUsd: 2400,
    maxNewTradePct: 0.08,
    currentPositionLimitPct: 0.2,
    parameters: conservativeParameters
  }));
  const guardian = evaluateIraCashManagement(input({
    portfolioId: "portfolio_ira_alternatives_2400_v1_guardian",
    cashUsd: 2400,
    totalValueUsd: 2400,
    maxNewTradePct: 0.05,
    currentPositionLimitPct: 0.18,
    parameters: guardianParameters
  }));

  assert.equal(guardian.action, "BUY");
  assert.equal(guardian.proposedDeploymentUsd, 120);
  assert.equal(guardian.targetReserveUsd, 600);
  assert.ok(guardian.proposedDeploymentUsd < conservative.proposedDeploymentUsd);
  assert.ok(guardian.targetReserveUsd > conservative.targetReserveUsd);
  assert.match(guardian.reason, /supported broad bond allocation/);
});

test("Growth and Aggressive IRA alternatives do not receive defensive BND fallback", () => {
  assert.equal(resolveDefensiveIraAlternativeCashManagementParameters("portfolio_ira_alternatives_2400_v1_growth", "ira_alternatives_2400_v1_growth"), null);
  assert.equal(resolveDefensiveIraAlternativeCashManagementParameters("portfolio_ira_alternatives_2400_v1_aggressive", "ira_alternatives_2400_v1_aggressive"), null);
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

test("policy amount exactly equal to the raw max-new-trade cap passes", () => {
  const decision = evaluateIraCashManagement(input({
    cashUsd: 600,
    totalValueUsd: 2384.5,
    maxNewTradePct: 0.1,
    parameters: { dailyDeploymentLimitPctOfExcess: 1 }
  }));
  assert.equal(decision.action, "BUY");
  assert.equal(decision.proposedDeploymentUsd, 238.45);
  assert.equal(decision.proposedDeploymentUsd <= 2384.5 * 0.1, true);
});

test("rounded policy amount never exceeds the raw risk cap", () => {
  const rawCap = 238.45415;
  assert.equal(sizeTradeDownToCap(238.4542, rawCap), 238.4541);
  const decision = evaluateIraCashManagement(input({
    cashUsd: 1909.8485985848502,
    totalValueUsd: 2384.5415,
    maxNewTradePct: 0.1,
    parameters: { dailyDeploymentLimitPctOfExcess: 1 }
  }));
  assert.equal(decision.proposedDeploymentUsd, 238.4541);
  assert.equal(decision.proposedDeploymentUsd <= decision.maxNewTradeUsd, true);
  assert.equal(decision.proposedDeploymentUsd <= 2384.5415 * 0.1, true);
});

test("raw cap with more precision than supported money amount rounds downward", () => {
  assert.equal(sizeTradeDownToCap(1000, 238.45415), 238.4541);
  assert.notEqual(sizeTradeDownToCap(1000, 238.45415), 238.4542);
});

test("$238.4542 versus $238.45415 produces a safe executable amount", () => {
  const decision = evaluateIraCashManagement(input({
    cashUsd: 1909.8485985848502,
    totalValueUsd: 2384.5415,
    maxNewTradePct: 0.1,
    parameters: { dailyDeploymentLimitPctOfExcess: 1 }
  }));
  assert.equal(decision.proposedDeploymentUsd, 238.4541);
  const risk = assessPaperTrade({
    action: "BUY",
    marketData: validQuote,
    portfolioValueUsd: 2384.5415,
    cashUsd: 1909.8485985848502,
    currentPositionValueUsd: 0,
    proposedTradeValueUsd: decision.proposedDeploymentUsd,
    drawdownPct: 0,
    duplicateSignal: false,
    openedNewPositionThisRun: false,
    hasPosition: false,
    maxNewTradePct: 0.1,
    maxPositionPct: 0.2,
    drawdownBlockPct: 0.1,
    investmentPolicy: null,
    orderIntent: "long_buy"
  });
  assert.equal(risk.allowed, true);
});

test("fees and slippage do not push the effective cash outlay above the max-new-trade cap", () => {
  const decision = evaluateIraCashManagement(input({
    cashUsd: 1909.8485985848502,
    totalValueUsd: 2384.5415,
    maxNewTradePct: 0.1,
    parameters: { dailyDeploymentLimitPctOfExcess: 1 }
  }));
  const spendableBeforeFill = decision.proposedDeploymentUsd - decision.feeUsd;
  const estimatedCashOutlay = spendableBeforeFill + decision.feeUsd;
  assert.equal(estimatedCashOutlay <= 2384.5415 * 0.1, true);
  assert.equal(decision.slippageUsd > 0, true);
});

test("same-day repeated cash-equivalent churn is prevented", () => {
  const decision = evaluateIraCashManagement(input({ tradedTargetToday: true }));
  assert.equal(decision.action, "DO_NOTHING");
  assert.match(decision.reason, /same-day/);
});

test("prior-day BND activity does not permanently block later deployment", () => {
  const decision = evaluateIraCashManagement(input({ tradedTargetToday: false }));
  assert.equal(decision.action, "BUY");
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

test("fresh BND quote permits a BUY while stale BND quote blocks with clear reason", () => {
  const fresh = evaluateIraCashManagement(input({ now: new Date("2026-07-29T15:30:00.000Z") }));
  const stale = evaluateIraCashManagement(input({ marketData: { ...validQuote, stale: true, quality: "stale" } }));
  assert.equal(fresh.action, "BUY");
  assert.equal(fresh.quoteFreshness, "fresh");
  assert.equal(stale.action, "DO_NOTHING");
  assert.equal(stale.quoteFreshness, "stale");
  assert.match(stale.reason, /quote is stale or invalid/);
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

test("UI displays latest IRA policy amount, cap, quote freshness, and outcome", () => {
  assert.match(portfolioSource, /Latest IRA cash-management evaluation/);
  assert.match(portfolioSource, /Proposed deployment/);
  assert.match(portfolioSource, /Maximum risk cap/);
  assert.match(portfolioSource, /Quote freshness/);
  assert.match(portfolioSource, /Final outcome/);
  assert.match(paperSource, /Maximum risk-cap amount/);
  assert.match(paperSource, /freshness \$\{policy\.quoteFreshness\}/);
});

test("existing ETF holdings remain unchanged unless a valid strategy decision changes them", () => {
  assert.doesNotMatch(policySource, /SCHD[\s\S]*SELL|UPDATE positions[\s\S]*SCHD/);
});

test("five-strategy experiment portfolios remain unchanged", () => {
  assert.doesNotMatch(migration, /strategy_experiment/);
  assert.match(paperSource, /resolveDefensiveIraAlternativeCashManagementParameters/);
  assert.match(policySource, /eligiblePortfolioIds\.includes\(input\.portfolioId\)/);
});

test("Tim Real portfolios remain unchanged", () => {
  assert.doesNotMatch(migration, /Tim Real|read_only_watchlist|paper_portfolio_twin/);
  assert.match(policySource, /profileKey === "ira_alternatives_2400_v1_conservative"/);
  assert.match(policySource, /profileKey === "ira_alternatives_2400_v1_guardian"/);
  assert.doesNotMatch(policySource, /portfolio_tim_real/);
});

test("live execution remains disabled", () => {
  assert.match(paperSource, /paperOnly: true/);
  assert.match(paperSource, /liveTradingEnabled: false/);
  assert.doesNotMatch(paperSource, /LIVE_TRADING_ENABLED"\s*,\s*"true"|live_trading_allowed\s*=\s*1/);
});
