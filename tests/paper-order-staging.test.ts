import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildAllocationProposal, type AllocationProposal, type ProposalAsset } from "../src/allocation/proposals.ts";
import { buildPaperOrderBatchPreview } from "../src/orders/staging.ts";
import type { InvestmentPolicy } from "../src/policies/investmentPolicy.ts";

const migration = [
  readFileSync("migrations/0016_paper_order_staging.sql", "utf8"),
  readFileSync("migrations/0023_paper_order_staging_metadata.sql", "utf8")
].join("\n");
const serviceSource = readFileSync("src/orders/staging.ts", "utf8");

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

const assets: ProposalAsset[] = [
  asset("SPY", "SPDR S&P 500 ETF Trust", "etf", "U.S. broad-market equity"),
  asset("SCHD", "Schwab U.S. Dividend Equity ETF", "etf", "Dividend or low-volatility equity"),
  asset("BND", "Vanguard Total Bond Market ETF", "bond_fund", "Investment-grade bonds")
];

test("approved proposal creates pending review paper orders", () => {
  const preview = makePreview();

  assert.equal(preview.batch.status, "Pending Review");
  assert.equal(preview.batch.validationStatus, "passed");
  assert.equal(preview.batch.orderCount, 3);
  assert.equal(preview.batch.totalEstimatedPurchaseUsd, 1440);
  assert.equal(preview.batch.estimatedRemainingCashUsd, 960);
  assert.equal(preview.batch.marketDataTimestamp, "2026-07-13T21:00:00.000Z");
  assert.deepEqual(preview.orders.map((order) => order.symbol), ["SPY", "SCHD", "BND"]);
  assert.equal(preview.orders.every((order) => order.side === "Buy" && order.orderType === "market"), true);
  assert.equal(preview.orders.every((order) => order.targetAllocationPct === 0.2), true);
});

test("draft and rejected proposals cannot be staged", () => {
  assert.match(serviceSource, /proposal\.status !== "approved"/);
  assert.match(serviceSource, /Only approved allocation proposals can be staged/);
});

test("duplicate staging requests are idempotent by proposal", () => {
  assert.match(migration, /UNIQUE\(proposal_id\)/);
  assert.match(migration, /market_data_timestamp TEXT/);
  assert.match(migration, /target_allocation_pct REAL/);
  assert.match(serviceSource, /getPaperOrderBatchByProposalId\(db, proposalId\)/);
  assert.match(serviceSource, /INSERT OR IGNORE INTO paper_order_batches/);
  assert.match(serviceSource, /INSERT OR IGNORE INTO paper_order_batch_orders/);
});

test("insufficient cash rejects the entire order set", () => {
  const preview = makePreview({ portfolio: { cashUsd: 1000, totalAccountValueUsd: 2400 } });

  assert.equal(preview.batch.validationStatus, "failed");
  assert.match(preview.batch.validationReport.reasons.join(" "), /exceeds available cash/);
});

test("minimum cash reserve violation rejects the batch", () => {
  const preview = makePreview({ portfolio: { cashUsd: 1600, totalAccountValueUsd: 2400 } });

  assert.equal(preview.batch.validationStatus, "failed");
  assert.match(preview.batch.validationReport.reasons.join(" "), /minimum required cash allocation|minimum cash allocation/);
});

test("position-size violation is caught before order creation", () => {
  const preview = makePreview({ positions: [{ symbol: "SPY", marketValueUsd: 100 }] });

  assert.equal(preview.batch.validationStatus, "failed");
  assert.match(preview.batch.validationReport.reasons.join(" "), /single-position allocation/);
});

test("prohibited security type is rejected", () => {
  const proposal = approvedProposal({
    assets: [
      asset("BTC-USD", "Bitcoin", "crypto", "U.S. broad-market equity"),
      assets[1],
      assets[2]
    ],
    prices: {
      "BTC-USD": { priceUsd: 100000, priceTimestamp: "2026-07-13T21:00:00.000Z" },
      SCHD: { priceUsd: 80, priceTimestamp: "2026-07-13T21:00:00.000Z" },
      BND: { priceUsd: 75, priceTimestamp: "2026-07-13T21:00:00.000Z" }
    }
  });
  const preview = makePreview({
    proposal,
    assets: [
      { symbol: "BTC-USD", assetClass: "crypto", fractionalSupported: 1, quantityPrecision: 8 },
      { symbol: "SCHD", assetClass: "etf", fractionalSupported: 1, quantityPrecision: 6 },
      { symbol: "BND", assetClass: "bond_fund", fractionalSupported: 1, quantityPrecision: 6 }
    ],
    prices: [
      { symbol: "BTC-USD", priceUsd: 100000, priceTimestamp: "2026-07-13T21:00:00.000Z" },
      { symbol: "SCHD", priceUsd: 80, priceTimestamp: "2026-07-13T21:00:00.000Z" },
      { symbol: "BND", priceUsd: 75, priceTimestamp: "2026-07-13T21:00:00.000Z" }
    ]
  });

  assert.equal(preview.batch.validationStatus, "failed");
  assert.match(preview.batch.validationReport.reasons.join(" "), /crypto/);
});

test("missing price rejects staging", () => {
  const preview = makePreview({
    prices: [
      { symbol: "SPY", priceUsd: 600, priceTimestamp: "2026-07-13T21:00:00.000Z" },
      { symbol: "BND", priceUsd: 75, priceTimestamp: "2026-07-13T21:00:00.000Z" }
    ]
  });

  assert.equal(preview.batch.validationStatus, "failed");
  assert.match(preview.batch.validationReport.reasons.join(" "), /SCHD/);
});

test("stale price rejects staging", () => {
  const preview = makePreview({
    prices: [
      { symbol: "SPY", priceUsd: 600, priceTimestamp: "2026-07-13T21:00:00.000Z" },
      { symbol: "SCHD", priceUsd: 80, priceTimestamp: "2026-07-10T21:00:00.000Z" },
      { symbol: "BND", priceUsd: 75, priceTimestamp: "2026-07-13T21:00:00.000Z" }
    ]
  });

  assert.equal(preview.batch.validationStatus, "failed");
  assert.match(preview.batch.validationReport.reasons.join(" "), /stale for SCHD|SCHD/);
});

test("material price deviation is flagged for re-review", () => {
  const preview = makePreview({
    prices: [
      { symbol: "SPY", priceUsd: 650, priceTimestamp: "2026-07-13T21:00:00.000Z" },
      { symbol: "SCHD", priceUsd: 80, priceTimestamp: "2026-07-13T21:00:00.000Z" },
      { symbol: "BND", priceUsd: 75, priceTimestamp: "2026-07-13T21:00:00.000Z" }
    ],
    priceDeviationThresholdPct: 0.03
  });

  assert.equal(preview.batch.validationStatus, "passed");
  assert.equal(preview.batch.priceDeviationStatus, "warning");
  assert.equal(preview.orders.find((order) => order.symbol === "SPY")?.priceDeviationWarning, true);
});

test("batch rejection, cancellation, and ready-to-execute are status-only actions", () => {
  assert.match(migration, /'Ready to Execute'/);
  assert.match(migration, /'Rejected'/);
  assert.match(migration, /'Cancelled'/);
  assert.match(serviceSource, /SET status = 'Rejected'/);
  assert.match(serviceSource, /SET status = 'Cancelled'/);
  assert.match(serviceSource, /"Ready to Execute"/);
  assert.match(serviceSource, /batch_marked_ready_to_execute/);
});

test("staging does not mutate cash, positions, execution orders, or trades", () => {
  assert.doesNotMatch(serviceSource, /UPDATE portfolios/i);
  assert.doesNotMatch(serviceSource, /UPDATE positions/i);
  assert.doesNotMatch(serviceSource, /INSERT\s+(OR\s+IGNORE\s+)?INTO\s+orders/i);
  assert.doesNotMatch(serviceSource, /INSERT\s+(OR\s+IGNORE\s+)?INTO\s+trades/i);
  assert.doesNotMatch(serviceSource, /INSERT\s+(OR\s+IGNORE\s+)?INTO\s+transactions/i);
});

function makePreview(overrides: Partial<Parameters<typeof buildPaperOrderBatchPreview>[0]> = {}) {
  return buildPaperOrderBatchPreview({
    proposal: approvedProposal(),
    portfolio: { cashUsd: 2400, totalAccountValueUsd: 2400 },
    policy,
    positions: [],
    assets: [
      { symbol: "SPY", assetClass: "etf", fractionalSupported: 1, quantityPrecision: 6 },
      { symbol: "SCHD", assetClass: "etf", fractionalSupported: 1, quantityPrecision: 6 },
      { symbol: "BND", assetClass: "bond_fund", fractionalSupported: 1, quantityPrecision: 6 }
    ],
    prices: [
      { symbol: "SPY", priceUsd: 600, priceTimestamp: "2026-07-13T21:00:00.000Z" },
      { symbol: "SCHD", priceUsd: 80, priceTimestamp: "2026-07-13T21:00:00.000Z" },
      { symbol: "BND", priceUsd: 75, priceTimestamp: "2026-07-13T21:00:00.000Z" }
    ],
    nowIso: "2026-07-13T21:00:00.000Z",
    ...overrides
  });
}

function approvedProposal(overrides: Partial<Parameters<typeof buildAllocationProposal>[0]> = {}): AllocationProposal {
  const proposal = buildAllocationProposal({
    portfolioId: "portfolio_ira",
    version: 1,
    generatedAt: "2026-07-13T21:00:00.000Z",
    totalAccountValueUsd: 2400,
    availableCashUsd: 2400,
    policy,
    assets,
    prices: {
      SPY: { priceUsd: 600, priceTimestamp: "2026-07-13T21:00:00.000Z" },
      SCHD: { priceUsd: 80, priceTimestamp: "2026-07-13T21:00:00.000Z" },
      BND: { priceUsd: 75, priceTimestamp: "2026-07-13T21:00:00.000Z" }
    },
    ...overrides
  });
  return { ...proposal, status: "approved", approvedAt: "2026-07-13T21:01:00.000Z" };
}

function asset(symbol: string, securityName: string, assetClass: ProposalAsset["assetClass"], category: string): ProposalAsset {
  return {
    symbol,
    securityName,
    assetClass,
    category,
    reason: `${securityName} fits ${category}.`,
    riskContribution: "Policy-sized risk contribution.",
    expectedRole: category,
    confidenceScore: 0.75
  };
}
