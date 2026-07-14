import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildAllocationProposal, type ProposalAsset } from "../src/allocation/proposals.ts";
import type { InvestmentPolicy } from "../src/policies/investmentPolicy.ts";

const migration = readFileSync("migrations/0015_allocation_proposals.sql", "utf8");
const serviceSource = readFileSync("src/allocation/proposals.ts", "utf8");

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

test("valid conservative allocation respects IRA cash, position, and category limits", () => {
  const allocation = makeProposal();

  assert.equal(allocation.status, "ready_for_review");
  assert.equal(allocation.policyCompliant, true);
  assert.equal(allocation.approvalAllowed, true);
  assert.equal(allocation.totalAccountValueUsd, 2400);
  assert.equal(allocation.availableCashUsd, 2400);
  assert.equal(allocation.totalProposedInvestmentUsd, 1440);
  assert.equal(allocation.remainingCashUsd, 960);
  assert.equal(allocation.cashPct >= 0.1, true);
  assert.equal(allocation.lines.every((line) => line.targetAllocationPct <= 0.2), true);
  assert.match(allocation.rationale, /account mandate/);
  assert.doesNotMatch(allocation.rationale, /IRA/);
  assert.deepEqual(allocation.lines.map((line) => line.assetCategory), [
    "U.S. broad-market equity",
    "Dividend or low-volatility equity",
    "Investment-grade bonds",
    "Short-term Treasuries or cash equivalents",
    "Cash reserve"
  ]);
});

test("minimum cash compliance blocks over-invested proposals", () => {
  const lowCash = makeProposal({ availableCashUsd: 1500 });

  assert.equal(lowCash.policyCompliant, false);
  assert.equal(lowCash.approvalAllowed, false);
  assert.match(lowCash.policyValidation.reasons.join(" "), /minimum required cash/);
});

test("single-position limit blocks proposals that would exceed twenty percent", () => {
  const concentrated = makeProposal({ currentPositions: [{ symbol: "SPY", marketValueUsd: 250 }] });

  assert.equal(concentrated.policyCompliant, false);
  assert.equal(concentrated.approvalAllowed, false);
  assert.match(concentrated.policyValidation.reasons.join(" "), /single-position/);
});

test("sector concentration limit blocks oversized category allocation", () => {
  const strictPolicy = { ...policy, maxSectorAllocationPct: 0.1 };
  const concentrated = makeProposal({ policy: strictPolicy });

  assert.equal(concentrated.policyCompliant, false);
  assert.match(concentrated.policyValidation.reasons.join(" "), /maximum sector allocation|exceeds/);
});

test("prohibited security rejection keeps proposal unapprovable", () => {
  const withCrypto = makeProposal({
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

  assert.equal(withCrypto.policyCompliant, false);
  assert.equal(withCrypto.approvalAllowed, false);
  assert.match(withCrypto.policyValidation.reasons.join(" "), /crypto/);
});

test("missing market data marks proposal incomplete and omits estimated shares", () => {
  const incomplete = makeProposal({ prices: { SPY: { priceUsd: 600, priceTimestamp: "2026-07-13T21:00:00.000Z" } } });

  assert.equal(incomplete.status, "draft");
  assert.equal(incomplete.approvalAllowed, false);
  assert.equal(incomplete.lines.find((line) => line.symbol === "SCHD")?.estimatedShares, null);
  assert.match(incomplete.warnings.join(" "), /Current validated market price is unavailable/);
});

test("stale market data marks proposal incomplete and blocks approval", () => {
  const stale = makeProposal({
    prices: {
      SPY: { priceUsd: 600, priceTimestamp: "2026-07-13T21:00:00.000Z" },
      SCHD: { priceUsd: 80, priceTimestamp: "2026-07-10T20:00:00.000Z" },
      BND: { priceUsd: 75, priceTimestamp: "2026-07-13T21:00:00.000Z" }
    }
  });

  assert.equal(stale.status, "draft");
  assert.equal(stale.approvalAllowed, false);
  assert.equal(stale.lines.find((line) => line.symbol === "SCHD")?.estimatedShares, null);
});

test("proposal approval and rejection are status-only workflow operations", () => {
  assert.match(migration, /status TEXT NOT NULL CHECK \(status IN \('draft', 'ready_for_review', 'approved', 'rejected', 'expired', 'executed'\)\)/);
  assert.match(serviceSource, /UPDATE allocation_proposals SET status = 'approved'/);
  assert.match(serviceSource, /UPDATE allocation_proposals SET status = 'rejected'/);
  assert.doesNotMatch(serviceSource, /INSERT INTO orders|INSERT INTO trades|executePaperTrade/);
});

test("proposal version history is append-only by portfolio version", () => {
  const first = makeProposal({ version: 1 });
  const second = makeProposal({ version: 2 });

  assert.notEqual(first.id, second.id);
  assert.match(migration, /UNIQUE\(portfolio_id, version\)/);
  assert.match(serviceSource, /INSERT INTO allocation_proposals/);
  assert.match(serviceSource, /status IN \('draft', 'ready_for_review'\)/);
  assert.doesNotMatch(serviceSource, /INSERT OR REPLACE INTO allocation_proposals/);
});

test("proposal workflow does not create orders or trades", () => {
  assert.doesNotMatch(migration, /INSERT\s+(OR\s+IGNORE\s+)?INTO\s+orders/i);
  assert.doesNotMatch(migration, /INSERT\s+(OR\s+IGNORE\s+)?INTO\s+trades/i);
  assert.doesNotMatch(serviceSource, /INSERT\s+(OR\s+IGNORE\s+)?INTO\s+orders/i);
  assert.doesNotMatch(serviceSource, /INSERT\s+(OR\s+IGNORE\s+)?INTO\s+trades/i);
});

function makeProposal(overrides: Partial<Parameters<typeof buildAllocationProposal>[0]> = {}) {
  return buildAllocationProposal({
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
