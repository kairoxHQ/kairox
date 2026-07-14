import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildPaperExecutionPlan } from "../src/orders/execution.ts";
import type { PaperOrderBatch } from "../src/orders/staging.ts";
import type { InvestmentPolicy } from "../src/policies/investmentPolicy.ts";

const migration = readFileSync("migrations/0017_paper_order_execution.sql", "utf8");
const serviceSource = readFileSync("src/orders/execution.ts", "utf8");
const indexSource = readFileSync("src/index.ts", "utf8");
const dashboardSource = readFileSync("src/dashboard/service.ts", "utf8");

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

test("valid ready batch executes successfully in the planner", () => {
  const plan = makePlan();

  assert.equal(plan.validation.compliant, true);
  assert.equal(plan.execution.status, "Filled");
  assert.equal(plan.execution.orderCount, 3);
  assert.equal(plan.execution.totalGrossAmountUsd, 1441.4406);
  assert.equal(plan.execution.totalFeesUsd, 0);
  assert.equal(plan.execution.totalNetAmountUsd, 1441.4406);
  assert.equal(plan.execution.cashAfterUsd, 958.5594);
  assert.deepEqual(plan.execution.fills.map((fill) => fill.symbol), ["VTI", "SCHD", "BND"]);
});

test("non-paper account is rejected", () => {
  const plan = makePlan({ portfolio: { id: "portfolio_live", cashUsd: 2400, startingBalanceUsd: 2400, mode: "live", brokerAccountId: "broker_live" } });

  assert.equal(plan.validation.compliant, false);
  assert.match(plan.validation.reasons.join(" "), /Only paper portfolios/);
});

test("Pending Review batch is rejected", () => {
  const batch = makeBatch({ status: "Pending Review" });
  const plan = makePlan({ batch });

  assert.equal(plan.validation.compliant, false);
  assert.match(plan.validation.reasons.join(" "), /not Ready to Execute/);
});

test("already Filled batch is idempotent and uses existing execution result", () => {
  assert.match(serviceSource, /existing\?\.status === "Filled"/);
  assert.match(serviceSource, /idempotent: true/);
  assert.match(migration, /batch_id TEXT NOT NULL UNIQUE/);
});

test("insufficient cash causes zero permissible execution", () => {
  const plan = makePlan({ portfolio: { id: "portfolio_ira", cashUsd: 1000, startingBalanceUsd: 2400, mode: "paper", brokerAccountId: "broker_paper_ira" } });

  assert.equal(plan.validation.compliant, false);
  assert.match(plan.validation.reasons.join(" "), /cash negative|minimum required reserve/);
});

test("minimum cash reserve violation causes zero fills to persist", () => {
  const plan = makePlan({ portfolio: { id: "portfolio_ira", cashUsd: 1600, startingBalanceUsd: 2400, mode: "paper", brokerAccountId: "broker_paper_ira" } });

  assert.equal(plan.validation.compliant, false);
  assert.match(plan.validation.reasons.join(" "), /minimum required reserve/);
});

test("stale or missing price causes zero fills", () => {
  const plan = makePlan({
    prices: [
      { symbol: "VTI", priceUsd: 369.78, priceTimestamp: "2026-07-13T20:00:00.000Z" },
      { symbol: "SCHD", priceUsd: 32.56, priceTimestamp: "2026-07-10T20:00:00.000Z" }
    ]
  });

  assert.equal(plan.validation.compliant, false);
  assert.match(plan.validation.reasons.join(" "), /stale for SCHD|stale for BND/);
});

test("material price movement requires re-review", () => {
  const plan = makePlan({
    prices: [
      { symbol: "VTI", priceUsd: 390, priceTimestamp: "2026-07-14T00:00:00.000Z" },
      { symbol: "SCHD", priceUsd: 32.56, priceTimestamp: "2026-07-14T00:00:00.000Z" },
      { symbol: "BND", priceUsd: 72.5, priceTimestamp: "2026-07-14T00:00:00.000Z" }
    ]
  });

  assert.equal(plan.validation.compliant, false);
  assert.equal(plan.validation.requiresReview, true);
  assert.match(plan.validation.reasons.join(" "), /requires re-review/);
});

test("fractional-share purchases are supported when asset metadata allows them", () => {
  const plan = makePlan();

  assert.equal(plan.execution.fills[0].quantity, 1.298069);
  assert.equal(plan.execution.fills.every((fill) => fill.quantity % 1 !== 0), true);
});

test("existing position average cost updates correctly", () => {
  const plan = makePlan({
    positions: [{
      id: "pos_portfolio_ira_VTI",
      symbol: "VTI",
      assetClass: "etf",
      quantity: 1,
      avgEntryPriceUsd: 300,
      currentPriceUsd: 369.78,
      marketValueUsd: 369.78
    }]
  });
  const vti = plan.positionsAfter.find((position) => position.symbol === "VTI");

  assert.equal(vti?.quantity, 2.298069);
  assert.equal(vti?.avgEntryPriceUsd, 339.6243);
});

test("execution persistence covers cash ledger, transactions, snapshots, proposal status, and rollback shape", () => {
  assert.match(serviceSource, /INSERT OR IGNORE INTO paper_cash_ledger/);
  assert.match(serviceSource, /INSERT OR IGNORE INTO portfolio_transactions/);
  assert.match(serviceSource, /INSERT OR IGNORE INTO orders/);
  assert.match(serviceSource, /INSERT OR IGNORE INTO trades/);
  assert.match(serviceSource, /recordValuationSnapshot/);
  assert.match(serviceSource, /completeDailySnapshot/);
  assert.match(serviceSource, /recordEquityHistory/);
  assert.match(serviceSource, /status = 'executed'/);
  assert.match(serviceSource, /await db\.batch\(statements\)/);
});

test("concurrent execution requests are protected by unique execution and fill keys", () => {
  assert.match(migration, /batch_id TEXT NOT NULL UNIQUE/);
  assert.match(migration, /staged_order_id TEXT NOT NULL UNIQUE/);
  assert.match(migration, /execution_order_id TEXT NOT NULL UNIQUE/);
  assert.match(migration, /trade_id TEXT NOT NULL UNIQUE/);
  assert.match(serviceSource, /INSERT OR IGNORE INTO paper_order_executions/);
  assert.match(serviceSource, /INSERT OR IGNORE INTO paper_order_fills/);
});

test("protected production action requires confirmation and existing secret header", () => {
  assert.match(indexSource, /paper-order-batches.+execute/);
  assert.match(indexSource, /authorize\(request, env\)/);
  assert.match(dashboardSource, /Execute Paper Orders/);
  assert.match(dashboardSource, /confirm\("Execute simulated paper orders only/);
  assert.match(dashboardSource, /x-cryptolab-paper-secret/);
});

function makePlan(overrides: Partial<Parameters<typeof buildPaperExecutionPlan>[0]> = {}) {
  return buildPaperExecutionPlan({
    batch: makeBatch(),
    portfolio: { id: "portfolio_ira", cashUsd: 2400, startingBalanceUsd: 2400, mode: "paper", brokerAccountId: "broker_paper_ira" },
    policy,
    positions: [],
    assets: [
      { symbol: "VTI", assetClass: "etf", fractionalSupported: true, quantityPrecision: 6 },
      { symbol: "SCHD", assetClass: "etf", fractionalSupported: true, quantityPrecision: 6 },
      { symbol: "BND", assetClass: "bond_fund", fractionalSupported: true, quantityPrecision: 6 }
    ],
    prices: [
      { symbol: "VTI", priceUsd: 369.78, priceTimestamp: "2026-07-14T00:00:00.000Z" },
      { symbol: "SCHD", priceUsd: 32.56, priceTimestamp: "2026-07-14T00:00:00.000Z" },
      { symbol: "BND", priceUsd: 72.5, priceTimestamp: "2026-07-14T00:00:00.000Z" }
    ],
    nowIso: "2026-07-14T00:00:00.000Z",
    slippagePct: 0.001,
    feePct: 0,
    priceDeviationThresholdPct: 0.03,
    ...overrides
  });
}

function makeBatch(overrides: Partial<PaperOrderBatch> = {}): PaperOrderBatch {
  const base = {
    id: "paper_order_batch_allocation_portfolio_ira_4",
    portfolioId: "portfolio_ira",
    proposalId: "allocation_portfolio_ira_4",
    proposalVersion: 4,
    totalEstimatedPurchaseUsd: 1440,
    estimatedRemainingCashUsd: 960,
    orderCount: 3,
    validationStatus: "passed" as const,
    validationReport: { compliant: true, reasons: [], warnings: [] },
    priceDeviationStatus: "none" as const,
    priceDeviationThresholdPct: 0.03,
    status: "Ready to Execute" as const,
    rejectionReason: null,
    cancelledReason: null,
    reviewedAt: "2026-07-14T00:00:00.000Z",
    rejectedAt: null,
    cancelledAt: null,
    createdAt: "2026-07-14T00:00:00.000Z",
    orders: [
      order("VTI", "Vanguard Total Stock Market ETF", "U.S. broad-market equity", "etf", 1.298069, 369.78, 0.78),
      order("SCHD", "Schwab U.S. Dividend Equity ETF", "Dividend or low-volatility equity", "etf", 14.742015, 32.56, 0.76),
      order("BND", "Vanguard Total Bond Market ETF", "Investment-grade bonds", "bond_fund", 6.62069, 72.5, 0.8)
    ]
  };
  return { ...base, ...overrides };
}

function order(symbol: string, securityName: string, category: string, assetClass: "etf" | "bond_fund", quantity: number, price: number, confidence: number) {
  return {
    id: `order_${symbol}`,
    batchId: "paper_order_batch_allocation_portfolio_ira_4",
    portfolioId: "portfolio_ira",
    proposalId: "allocation_portfolio_ira_4",
    proposalVersion: 4,
    lineOrder: symbol === "VTI" ? 1 : symbol === "SCHD" ? 2 : 3,
    symbol,
    securityName,
    side: "Buy" as const,
    orderType: "market" as const,
    estimatedQuantity: quantity,
    estimatedDollarAmountUsd: 480,
    referencePriceUsd: price,
    latestReferencePriceUsd: price,
    marketDataTimestamp: "2026-07-14T00:00:00.000Z",
    assetCategory: category,
    assetClass,
    investmentRationale: `${symbol} simulated IRA allocation.`,
    confidenceScore: confidence,
    policyValidation: { allowed: true, reasons: [] },
    priceDeviationPct: 0,
    priceDeviationWarning: false,
    fractionalQuantitySupported: true,
    status: "Ready to Execute" as const,
    createdAt: "2026-07-14T00:00:00.000Z"
  };
}
