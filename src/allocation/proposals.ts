import { getInvestmentPolicy, validateInvestmentPolicy, type InvestmentPolicy } from "../policies/investmentPolicy.ts";
import { listRows } from "../shared/db.ts";
import type { AssetClass } from "../shared/types.ts";
import { MarketDataService } from "../market/service.ts";

export type ProposalStatus = "draft" | "ready_for_review" | "approved" | "rejected" | "expired" | "executed";

export interface AllocationProposalLine {
  id?: string;
  symbol: string;
  securityName: string;
  assetCategory: string;
  assetClass: AssetClass;
  targetAllocationPct: number;
  targetAmountUsd: number;
  estimatedShares: number | null;
  currentPriceUsd: number | null;
  priceTimestamp: string | null;
  reason: string;
  riskContribution: string;
  expectedRole: string;
  confidenceScore: number;
  dataTimestamp: string | null;
  isCashReserve: boolean;
  policyCompliant: boolean;
  validationReasons: string[];
}

export interface AllocationProposal {
  id: string;
  portfolioId: string;
  version: number;
  status: ProposalStatus;
  generatedAt: string;
  marketDataTimestamp: string | null;
  marketDataSnapshotId: string | null;
  totalAccountValueUsd: number;
  availableCashUsd: number;
  totalProposedInvestmentUsd: number;
  remainingCashUsd: number;
  cashPct: number;
  equityPct: number;
  bondPct: number;
  incomePct: number;
  diversificationScore: number;
  riskScore: number;
  policyCompliant: boolean;
  approvalAllowed: boolean;
  rationale: string;
  warnings: string[];
  policyValidation: { compliant: boolean; reasons: string[] };
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  revisionRequired: boolean;
  revisionReason: string | null;
  lines: AllocationProposalLine[];
}

export interface ProposalBuildInput {
  portfolioId: string;
  version: number;
  generatedAt: string;
  totalAccountValueUsd: number;
  availableCashUsd: number;
  policy: InvestmentPolicy;
  assets: ProposalAsset[];
  prices: Record<string, ProposalPrice | undefined>;
  currentPositions?: Array<{ symbol: string; marketValueUsd: number }>;
  existingProposedOrdersUsd?: number;
}

export interface ProposalAsset {
  symbol: string;
  securityName: string;
  assetClass: AssetClass;
  category: string;
  reason: string;
  riskContribution: string;
  expectedRole: string;
  confidenceScore: number;
}

export interface ProposalPrice {
  priceUsd: number;
  priceTimestamp: string;
}

interface ProposalRow {
  id: string;
  portfolioId: string;
  version: number;
  status: ProposalStatus;
  generatedAt: string;
  marketDataTimestamp: string | null;
  marketDataSnapshotId: string | null;
  totalAccountValueUsd: number;
  availableCashUsd: number;
  totalProposedInvestmentUsd: number;
  remainingCashUsd: number;
  cashPct: number;
  equityPct: number;
  bondPct: number;
  incomePct: number;
  diversificationScore: number;
  riskScore: number;
  policyCompliant: number;
  approvalAllowed: number;
  rationale: string;
  warningsJson: string;
  policyValidationJson: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  revisionRequired?: number;
  revisionReason?: string | null;
}

interface LineRow {
  id: string;
  symbol: string;
  securityName: string;
  assetCategory: string;
  assetClass: AssetClass;
  targetAllocationPct: number;
  targetAmountUsd: number;
  estimatedShares: number | null;
  currentPriceUsd: number | null;
  priceTimestamp: string | null;
  reason: string;
  riskContribution: string;
  expectedRole: string;
  confidenceScore: number;
  dataTimestamp: string | null;
  isCashReserve: number;
  policyCompliant: number;
  validationReasonsJson: string;
}

const CATEGORY_TARGETS: Array<{ category: string; symbol: string; allocationPct: number; cash: boolean }> = [
  { category: "U.S. broad-market equity", symbol: "SPY", allocationPct: 0.2, cash: false },
  { category: "Dividend or low-volatility equity", symbol: "SCHD", allocationPct: 0.2, cash: false },
  { category: "Investment-grade bonds", symbol: "BND", allocationPct: 0.2, cash: false },
  { category: "Short-term Treasuries or cash equivalents", symbol: "CASH", allocationPct: 0.2, cash: true },
  { category: "Cash reserve", symbol: "CASH", allocationPct: 0.2, cash: true }
];

const CATEGORY_METADATA: Record<string, Omit<ProposalAsset, "symbol" | "securityName" | "assetClass" | "category">> = {
  "U.S. broad-market equity": {
    reason: "Broad U.S. equity exposure supports moderate long-term growth while staying below the single-position cap.",
    riskContribution: "Moderate equity beta; limited to policy position size.",
    expectedRole: "Core growth engine",
    confidenceScore: 0.78
  },
  "Dividend or low-volatility equity": {
    reason: "Dividend-oriented equity diversifies broad-market exposure and adds income-producing characteristics.",
    riskContribution: "Moderate equity risk with quality/dividend tilt.",
    expectedRole: "Income-aware equity ballast",
    confidenceScore: 0.76
  },
  "Investment-grade bonds": {
    reason: "Investment-grade bond exposure supports capital preservation and dampens equity volatility.",
    riskContribution: "Lower volatility rate-sensitive allocation.",
    expectedRole: "Defensive bond sleeve",
    confidenceScore: 0.8
  },
  "Short-term Treasuries or cash equivalents": {
    reason: "Cash-equivalent reserve keeps liquidity available while the account awaits supported Treasury or money-market instruments.",
    riskContribution: "Very low market risk.",
    expectedRole: "Liquidity and dry powder",
    confidenceScore: 0.7
  },
  "Cash reserve": {
    reason: "Policy requires at least 10% cash; this proposal keeps a larger conservative reserve before first paper trades.",
    riskContribution: "Lowest risk; opportunity cost if markets rise.",
    expectedRole: "Mandated reserve and volatility buffer",
    confidenceScore: 0.82
  }
};

export async function generateAllocationProposal(db: D1Database, portfolioId: string, now = new Date()): Promise<AllocationProposal> {
  const [portfolio, policy, assets, positions, existingOrders, versionRow] = await Promise.all([
    getPortfolioSummary(db, portfolioId),
    getInvestmentPolicy(db, portfolioId),
    getProposalAssets(db, portfolioId),
    getCurrentPositions(db, portfolioId),
    getExistingOpenOrdersUsd(db, portfolioId),
    db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS nextVersion FROM allocation_proposals WHERE portfolio_id = ?").bind(portfolioId).first<{ nextVersion: number }>()
  ]);
  if (!portfolio) {
    throw new Error("Portfolio not found.");
  }
  if (!policy) {
    throw new Error("No active investment policy is configured for this portfolio.");
  }

  const symbols = assets.map((asset) => asset.symbol).filter((symbol) => symbol !== "CASH");
  const generatedAt = now.toISOString();
  const marketSnapshot = await new MarketDataService(db).createSnapshot(symbols, "proposal", now);
  const prices = pricesFromSnapshot(marketSnapshot);
  const proposal = buildAllocationProposal({
    portfolioId,
    version: versionRow?.nextVersion ?? 1,
    generatedAt,
    totalAccountValueUsd: portfolio.totalAccountValueUsd,
    availableCashUsd: portfolio.cashUsd,
    policy,
    assets,
    prices,
    currentPositions: positions,
    existingProposedOrdersUsd: existingOrders?.openOrdersUsd ?? 0
  });
  proposal.marketDataSnapshotId = marketSnapshot.id;
  await expireOpenProposals(db, portfolioId);
  await storeProposal(db, proposal);
  return proposal;
}

export function buildAllocationProposal(input: ProposalBuildInput): AllocationProposal {
  const warnings: string[] = [];
  const validationReasons: string[] = [];
  const assetByCategory = new Map(input.assets.map((asset) => [asset.category, asset]));
  const lines = CATEGORY_TARGETS.map((target): AllocationProposalLine => {
    const metadata = CATEGORY_METADATA[target.category];
    if (target.cash) {
      const amount = roundMoney(input.totalAccountValueUsd * target.allocationPct);
      return {
        symbol: target.symbol,
        securityName: target.category,
        assetCategory: target.category,
        assetClass: "money_market",
        targetAllocationPct: target.allocationPct,
        targetAmountUsd: amount,
        estimatedShares: null,
        currentPriceUsd: null,
        priceTimestamp: null,
        reason: metadata.reason,
        riskContribution: metadata.riskContribution,
        expectedRole: metadata.expectedRole,
        confidenceScore: metadata.confidenceScore,
        dataTimestamp: input.generatedAt,
        isCashReserve: true,
        policyCompliant: true,
        validationReasons: []
      };
    }

    const asset = assetByCategory.get(target.category);
    if (!asset) {
      warnings.push(`No supported asset is configured for ${target.category}.`);
    }
    const symbol = asset?.symbol ?? target.symbol;
    const latestPrice = input.prices[symbol];
    const price = latestPrice && isFreshProposalPrice(latestPrice.priceTimestamp, input.generatedAt) ? latestPrice : undefined;
    const amount = roundMoney(input.totalAccountValueUsd * target.allocationPct);
    const position = input.currentPositions?.find((item) => item.symbol === symbol);
    const validation = validateInvestmentPolicy({
      policy: input.policy,
      action: "BUY",
      symbol,
      assetClass: asset?.assetClass ?? "etf",
      portfolioValueUsd: input.totalAccountValueUsd,
      cashUsd: input.availableCashUsd,
      currentPositionValueUsd: position?.marketValueUsd ?? 0,
      proposedTradeValueUsd: amount,
      resultingSectorValueUsd: amount
    });
    validationReasons.push(...validation.reasons);
    if (!price) {
      warnings.push(`Current validated market price is unavailable for ${symbol}; estimated shares cannot be calculated.`);
    }
    return {
      symbol,
      securityName: asset?.securityName ?? symbol,
      assetCategory: target.category,
      assetClass: asset?.assetClass ?? "etf",
      targetAllocationPct: target.allocationPct,
      targetAmountUsd: amount,
      estimatedShares: price ? roundQuantity(amount / price.priceUsd) : null,
      currentPriceUsd: price?.priceUsd ?? null,
      priceTimestamp: price?.priceTimestamp ?? null,
      reason: asset?.reason ?? metadata.reason,
      riskContribution: asset?.riskContribution ?? metadata.riskContribution,
      expectedRole: asset?.expectedRole ?? metadata.expectedRole,
      confidenceScore: asset?.confidenceScore ?? metadata.confidenceScore,
      dataTimestamp: price?.priceTimestamp ?? null,
      isCashReserve: false,
      policyCompliant: validation.allowed,
      validationReasons: validation.reasons
    };
  });

  const totalProposedInvestmentUsd = roundMoney(lines.filter((line) => !line.isCashReserve).reduce((sum, line) => sum + line.targetAmountUsd, 0));
  const remainingCashUsd = roundMoney(input.availableCashUsd - totalProposedInvestmentUsd - (input.existingProposedOrdersUsd ?? 0));
  const cashPct = roundRatio(remainingCashUsd / input.totalAccountValueUsd);
  if (cashPct < input.policy.minCashAllocationPct) {
    validationReasons.push("Proposal would leave less than the minimum required cash allocation.");
  }
  const missingPrices = lines.some((line) => !line.isCashReserve && line.currentPriceUsd === null);
  const categoryTotals = new Map<string, number>();
  for (const line of lines.filter((item) => !item.isCashReserve)) {
    categoryTotals.set(line.assetCategory, (categoryTotals.get(line.assetCategory) ?? 0) + line.targetAllocationPct);
  }
  for (const [category, pct] of categoryTotals.entries()) {
    if (pct > input.policy.maxSectorAllocationPct) {
      validationReasons.push(`${category} exceeds the maximum sector allocation.`);
    }
  }
  const policyCompliant = validationReasons.length === 0 && lines.every((line) => line.policyCompliant) && cashPct >= input.policy.minCashAllocationPct;
  const proposalComplete = !missingPrices && policyCompliant;
  const marketDataTimestamp = latestTimestamp(lines.map((line) => line.priceTimestamp).filter(Boolean) as string[]);
  const equityPct = roundRatio(lines.filter((line) => line.assetClass === "stock" || line.assetClass === "etf").reduce((sum, line) => sum + line.targetAllocationPct, 0));
  const bondPct = roundRatio(lines.filter((line) => line.assetClass === "bond_fund").reduce((sum, line) => sum + line.targetAllocationPct, 0));
  const incomePct = roundRatio(lines.filter((line) => line.symbol === "SCHD" || line.assetClass === "bond_fund" || line.assetClass === "money_market").reduce((sum, line) => sum + line.targetAllocationPct, 0));

  if (missingPrices) {
      warnings.push("Proposal is incomplete until all investable lines have current validated market prices.");
  }
  if ((input.existingProposedOrdersUsd ?? 0) > 0) {
    warnings.push("Existing open proposed orders were considered in remaining-cash calculations.");
  }

  return {
    id: proposalId(input.portfolioId, input.version, input.generatedAt),
    portfolioId: input.portfolioId,
    version: input.version,
    status: proposalComplete ? "ready_for_review" : "draft",
    generatedAt: input.generatedAt,
    marketDataTimestamp,
    marketDataSnapshotId: null,
    totalAccountValueUsd: roundMoney(input.totalAccountValueUsd),
    availableCashUsd: roundMoney(input.availableCashUsd),
    totalProposedInvestmentUsd,
    remainingCashUsd,
    cashPct,
    equityPct,
    bondPct,
    incomePct,
    diversificationScore: roundRatio(0.82),
    riskScore: roundRatio(0.32),
    policyCompliant,
    approvalAllowed: proposalComplete,
    rationale: "Conservative first allocation proposal using category targets from the account mandate. No trades are placed by proposal generation or approval.",
    warnings: [...new Set(warnings)],
    policyValidation: { compliant: policyCompliant, reasons: [...new Set(validationReasons)] },
    approvedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    revisionRequired: false,
    revisionReason: null,
    lines
  };
}

export async function getLatestAllocationProposal(db: D1Database, portfolioId: string): Promise<AllocationProposal | null> {
  const row = await db
    .prepare(
      `SELECT id, portfolio_id AS portfolioId, version, status, generated_at AS generatedAt,
        market_data_timestamp AS marketDataTimestamp, market_data_snapshot_id AS marketDataSnapshotId,
        total_account_value_usd AS totalAccountValueUsd,
        available_cash_usd AS availableCashUsd, total_proposed_investment_usd AS totalProposedInvestmentUsd,
        remaining_cash_usd AS remainingCashUsd, cash_pct AS cashPct, equity_pct AS equityPct,
        bond_pct AS bondPct, income_pct AS incomePct, diversification_score AS diversificationScore,
        risk_score AS riskScore, policy_compliant AS policyCompliant, approval_allowed AS approvalAllowed,
        rationale, warnings_json AS warningsJson, policy_validation_json AS policyValidationJson,
        approved_at AS approvedAt, rejected_at AS rejectedAt, rejection_reason AS rejectionReason,
        COALESCE(revision_required, 0) AS revisionRequired, revision_reason AS revisionReason
       FROM allocation_proposals
       WHERE portfolio_id = ? AND status IN ('draft', 'ready_for_review', 'approved')
       ORDER BY version DESC
       LIMIT 1`
    )
    .bind(portfolioId)
    .first<ProposalRow>();
  return row ? hydrateProposal(db, row) : null;
}

export async function listAllocationProposals(db: D1Database, portfolioId: string): Promise<{ proposals: AllocationProposal[] }> {
  const rows = await listRows<ProposalRow>(
    db
      .prepare(
        `SELECT id, portfolio_id AS portfolioId, version, status, generated_at AS generatedAt,
          market_data_timestamp AS marketDataTimestamp, market_data_snapshot_id AS marketDataSnapshotId,
          total_account_value_usd AS totalAccountValueUsd,
          available_cash_usd AS availableCashUsd, total_proposed_investment_usd AS totalProposedInvestmentUsd,
          remaining_cash_usd AS remainingCashUsd, cash_pct AS cashPct, equity_pct AS equityPct,
          bond_pct AS bondPct, income_pct AS incomePct, diversification_score AS diversificationScore,
          risk_score AS riskScore, policy_compliant AS policyCompliant, approval_allowed AS approvalAllowed,
          rationale, warnings_json AS warningsJson, policy_validation_json AS policyValidationJson,
          approved_at AS approvedAt, rejected_at AS rejectedAt, rejection_reason AS rejectionReason,
          COALESCE(revision_required, 0) AS revisionRequired, revision_reason AS revisionReason
         FROM allocation_proposals
         WHERE portfolio_id = ?
         ORDER BY version DESC
         LIMIT 20`
      )
      .bind(portfolioId)
  );
  return { proposals: await Promise.all(rows.map((row) => hydrateProposal(db, row))) };
}

export async function approveAllocationProposal(db: D1Database, proposalIdValue: string, now = new Date()): Promise<AllocationProposal> {
  const row = await getProposalRowById(db, proposalIdValue);
  if (!row) {
    throw new Error("Allocation proposal not found.");
  }
  const currentProposal = await hydrateProposal(db, row);
  if (row.status !== "ready_for_review" || !row.approvalAllowed || !hasCurrentPricing(currentProposal, now.toISOString())) {
    throw new Error("Allocation proposal is not approvable until policy and pricing checks pass.");
  }
  await db
    .prepare("UPDATE allocation_proposals SET status = 'approved', approved_at = ?, rejected_at = NULL, rejection_reason = NULL, revision_required = 0, revision_reason = NULL, updated_at = datetime('now') WHERE id = ?")
    .bind(now.toISOString(), proposalIdValue)
    .run();
  const updated = await getProposalRowById(db, proposalIdValue);
  if (!updated) {
    throw new Error("Allocation proposal not found after approval.");
  }
  return hydrateProposal(db, updated);
}

export async function getAllocationProposalById(db: D1Database, proposalIdValue: string): Promise<AllocationProposal | null> {
  const row = await getProposalRowById(db, proposalIdValue);
  return row ? hydrateProposal(db, row) : null;
}

export async function markAllocationProposalRevisionRequired(db: D1Database, proposalIdValue: string, reason: string): Promise<void> {
  await db
    .prepare("UPDATE allocation_proposals SET revision_required = 1, revision_reason = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(reason.slice(0, 1000), proposalIdValue)
    .run();
}

export async function rejectAllocationProposal(db: D1Database, proposalIdValue: string, reason = "Rejected by reviewer.", now = new Date()): Promise<AllocationProposal> {
  const row = await getProposalRowById(db, proposalIdValue);
  if (!row) {
    throw new Error("Allocation proposal not found.");
  }
  await db
    .prepare("UPDATE allocation_proposals SET status = 'rejected', rejected_at = ?, rejection_reason = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(now.toISOString(), reason, proposalIdValue)
    .run();
  const updated = await getProposalRowById(db, proposalIdValue);
  if (!updated) {
    throw new Error("Allocation proposal not found after rejection.");
  }
  return hydrateProposal(db, updated);
}

async function storeProposal(db: D1Database, proposal: AllocationProposal): Promise<void> {
  await db
    .prepare(
      `INSERT INTO allocation_proposals (
        id, portfolio_id, version, status, generated_at, market_data_timestamp, market_data_snapshot_id,
        total_account_value_usd, available_cash_usd, total_proposed_investment_usd,
        remaining_cash_usd, cash_pct, equity_pct, bond_pct, income_pct,
        diversification_score, risk_score, policy_compliant, approval_allowed,
        rationale, warnings_json, policy_validation_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      proposal.id,
      proposal.portfolioId,
      proposal.version,
      proposal.status,
      proposal.generatedAt,
      proposal.marketDataTimestamp,
      proposal.marketDataSnapshotId ?? null,
      proposal.totalAccountValueUsd,
      proposal.availableCashUsd,
      proposal.totalProposedInvestmentUsd,
      proposal.remainingCashUsd,
      proposal.cashPct,
      proposal.equityPct,
      proposal.bondPct,
      proposal.incomePct,
      proposal.diversificationScore,
      proposal.riskScore,
      proposal.policyCompliant ? 1 : 0,
      proposal.approvalAllowed ? 1 : 0,
      proposal.rationale,
      JSON.stringify(proposal.warnings),
      JSON.stringify(proposal.policyValidation)
    )
    .run();

  for (const [index, line] of proposal.lines.entries()) {
    await db
      .prepare(
        `INSERT INTO allocation_proposal_lines (
          id, proposal_id, line_order, symbol, security_name, asset_category,
          asset_class, target_allocation_pct, target_amount_usd, estimated_shares,
          current_price_usd, price_timestamp, reason, risk_contribution,
          expected_role, confidence_score, data_timestamp, is_cash_reserve,
          policy_compliant, validation_reasons_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        `${proposal.id}_line_${index + 1}`,
        proposal.id,
        index + 1,
        line.symbol,
        line.securityName,
        line.assetCategory,
        line.assetClass,
        line.targetAllocationPct,
        line.targetAmountUsd,
        line.estimatedShares,
        line.currentPriceUsd,
        line.priceTimestamp,
        line.reason,
        line.riskContribution,
        line.expectedRole,
        line.confidenceScore,
        line.dataTimestamp,
        line.isCashReserve ? 1 : 0,
        line.policyCompliant ? 1 : 0,
        JSON.stringify(line.validationReasons)
      )
      .run();
  }
}

async function expireOpenProposals(db: D1Database, portfolioId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE allocation_proposals
       SET status = 'expired', approval_allowed = 0, updated_at = datetime('now')
       WHERE portfolio_id = ? AND status IN ('draft', 'ready_for_review')`
    )
    .bind(portfolioId)
    .run();
}

async function hydrateProposal(db: D1Database, row: ProposalRow): Promise<AllocationProposal> {
  const lines = await listRows<LineRow>(
    db
      .prepare(
        `SELECT id, symbol, security_name AS securityName, asset_category AS assetCategory,
          asset_class AS assetClass, target_allocation_pct AS targetAllocationPct,
          target_amount_usd AS targetAmountUsd, estimated_shares AS estimatedShares,
          current_price_usd AS currentPriceUsd, price_timestamp AS priceTimestamp,
          reason, risk_contribution AS riskContribution, expected_role AS expectedRole,
          confidence_score AS confidenceScore, data_timestamp AS dataTimestamp,
          is_cash_reserve AS isCashReserve, policy_compliant AS policyCompliant,
          validation_reasons_json AS validationReasonsJson
         FROM allocation_proposal_lines
         WHERE proposal_id = ?
         ORDER BY line_order ASC`
      )
      .bind(row.id)
  );
  return {
    id: row.id,
    portfolioId: row.portfolioId,
    version: row.version,
    status: row.status,
    generatedAt: row.generatedAt,
    marketDataTimestamp: row.marketDataTimestamp,
    marketDataSnapshotId: row.marketDataSnapshotId,
    totalAccountValueUsd: row.totalAccountValueUsd,
    availableCashUsd: row.availableCashUsd,
    totalProposedInvestmentUsd: row.totalProposedInvestmentUsd,
    remainingCashUsd: row.remainingCashUsd,
    cashPct: row.cashPct,
    equityPct: row.equityPct,
    bondPct: row.bondPct,
    incomePct: row.incomePct,
    diversificationScore: row.diversificationScore,
    riskScore: row.riskScore,
    policyCompliant: row.policyCompliant === 1,
    approvalAllowed: row.approvalAllowed === 1,
    rationale: row.rationale,
    warnings: parseJsonArray<string>(row.warningsJson),
    policyValidation: parseJsonObject<{ compliant: boolean; reasons: string[] }>(row.policyValidationJson, { compliant: false, reasons: [] }),
    approvedAt: row.approvedAt,
    rejectedAt: row.rejectedAt,
    rejectionReason: row.rejectionReason,
    revisionRequired: row.revisionRequired === 1,
    revisionReason: row.revisionReason ?? null,
    lines: lines.map((line) => ({
      id: line.id,
      symbol: line.symbol,
      securityName: line.securityName,
      assetCategory: line.assetCategory,
      assetClass: line.assetClass,
      targetAllocationPct: line.targetAllocationPct,
      targetAmountUsd: line.targetAmountUsd,
      estimatedShares: line.estimatedShares,
      currentPriceUsd: line.currentPriceUsd,
      priceTimestamp: line.priceTimestamp,
      reason: line.reason,
      riskContribution: line.riskContribution,
      expectedRole: line.expectedRole,
      confidenceScore: line.confidenceScore,
      dataTimestamp: line.dataTimestamp,
      isCashReserve: line.isCashReserve === 1,
      policyCompliant: line.policyCompliant === 1,
      validationReasons: parseJsonArray<string>(line.validationReasonsJson)
    }))
  };
}

async function getProposalRowById(db: D1Database, proposalIdValue: string): Promise<ProposalRow | null> {
  return db
    .prepare(
      `SELECT id, portfolio_id AS portfolioId, version, status, generated_at AS generatedAt,
        market_data_timestamp AS marketDataTimestamp, market_data_snapshot_id AS marketDataSnapshotId,
        total_account_value_usd AS totalAccountValueUsd,
        available_cash_usd AS availableCashUsd, total_proposed_investment_usd AS totalProposedInvestmentUsd,
        remaining_cash_usd AS remainingCashUsd, cash_pct AS cashPct, equity_pct AS equityPct,
        bond_pct AS bondPct, income_pct AS incomePct, diversification_score AS diversificationScore,
        risk_score AS riskScore, policy_compliant AS policyCompliant, approval_allowed AS approvalAllowed,
        rationale, warnings_json AS warningsJson, policy_validation_json AS policyValidationJson,
        approved_at AS approvedAt, rejected_at AS rejectedAt, rejection_reason AS rejectionReason,
        COALESCE(revision_required, 0) AS revisionRequired, revision_reason AS revisionReason
       FROM allocation_proposals
       WHERE id = ?`
    )
    .bind(proposalIdValue)
    .first<ProposalRow>();
}

async function getPortfolioSummary(db: D1Database, portfolioId: string): Promise<{ cashUsd: number; totalAccountValueUsd: number } | null> {
  return db
    .prepare(
      `SELECT p.cash_usd AS cashUsd, p.cash_usd + COALESCE(SUM(pos.market_value_usd), 0) AS totalAccountValueUsd
       FROM portfolios p
       LEFT JOIN positions pos ON pos.portfolio_id = p.id AND pos.quantity > 0
       WHERE p.id = ?
       GROUP BY p.id`
    )
    .bind(portfolioId)
    .first<{ cashUsd: number; totalAccountValueUsd: number }>();
}

async function getProposalAssets(db: D1Database, portfolioId: string): Promise<ProposalAsset[]> {
  const rows = await listRows<{ symbol: string; securityName: string; assetClass: AssetClass; assetCategory: string }>(
    db
      .prepare(
        `SELECT a.symbol, a.display_name AS securityName, a.asset_type AS assetClass,
          CASE
            WHEN a.symbol IN ('SPY', 'VOO', 'VTI') THEN 'U.S. broad-market equity'
            WHEN a.symbol IN ('SCHD') THEN 'Dividend or low-volatility equity'
            WHEN a.symbol IN ('BND') THEN 'Investment-grade bonds'
            WHEN a.asset_type = 'money_market' THEN 'Short-term Treasuries or cash equivalents'
            ELSE a.asset_type
          END AS assetCategory
         FROM watchlists w
         JOIN watchlist_assets wa ON wa.watchlist_id = w.id
         JOIN assets a ON a.id = wa.asset_id
         WHERE w.portfolio_id = ? AND w.enabled = 1 AND wa.enabled = 1 AND a.enabled = 1 AND a.tradable = 1
         ORDER BY wa.ranking_priority ASC, a.symbol ASC`
      )
      .bind(portfolioId)
  );
  return rows.map((row) => {
    const metadata = CATEGORY_METADATA[row.assetCategory] ?? CATEGORY_METADATA["Cash reserve"];
    return {
      symbol: row.symbol,
      securityName: row.securityName,
      assetClass: row.assetClass,
      category: row.assetCategory,
      ...metadata
    };
  });
}

async function getLatestPrices(db: D1Database, symbols: string[], nowIso: string): Promise<Record<string, ProposalPrice | undefined>> {
  const prices: Record<string, ProposalPrice | undefined> = {};
  const snapshot = await new MarketDataService(db).createSnapshot(symbols, "proposal", new Date(nowIso));
  Object.assign(prices, pricesFromSnapshot(snapshot));
  if (Object.keys(prices).length === symbols.length) {
    return prices;
  }
  for (const symbol of symbols) {
    const row = await db
      .prepare(
        `SELECT price_usd AS priceUsd, price_as_of AS priceTimestamp
         FROM market_snapshots
         WHERE symbol = ? AND validation_status = 'validated' AND price_usd > 0
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .bind(symbol)
      .first<ProposalPrice>();
    if (row && isFreshProposalPrice(row.priceTimestamp, nowIso)) {
      prices[symbol] = row;
      continue;
    }
    prices[symbol] = row ?? undefined;
  }
  return prices;
}

function pricesFromSnapshot(snapshot: Awaited<ReturnType<MarketDataService["createSnapshot"]>>): Record<string, ProposalPrice | undefined> {
  const prices: Record<string, ProposalPrice | undefined> = {};
  for (const [symbol, quote] of snapshot.quotes) {
    if (quote.validation.valid && quote.lastPrice && quote.providerTimestamp) {
      prices[symbol] = { priceUsd: quote.lastPrice, priceTimestamp: quote.providerTimestamp };
    }
  }
  return prices;
}

async function getCurrentPositions(db: D1Database, portfolioId: string): Promise<Array<{ symbol: string; marketValueUsd: number }>> {
  return listRows(
    db
      .prepare("SELECT symbol, market_value_usd AS marketValueUsd FROM positions WHERE portfolio_id = ? AND quantity > 0")
      .bind(portfolioId)
  );
}

async function getExistingOpenOrdersUsd(db: D1Database, portfolioId: string): Promise<{ openOrdersUsd: number }> {
  return (await db
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(fill_price_usd, limit_price_usd, 0) * quantity), 0) AS openOrdersUsd
       FROM orders
       WHERE portfolio_id = ? AND status IN ('proposed', 'pending', 'open')`
    )
    .bind(portfolioId)
    .first<{ openOrdersUsd: number }>()) ?? { openOrdersUsd: 0 };
}

function proposalId(portfolioId: string, version: number, timestamp: string): string {
  return `allocation_${portfolioId}_${version}_${timestamp.replace(/[^0-9A-Za-z]/g, "").slice(0, 14)}`;
}

function latestTimestamp(values: string[]): string | null {
  if (values.length === 0) {
    return null;
  }
  return values.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
}

function hasCurrentPricing(proposal: AllocationProposal, nowIso: string): boolean {
  return proposal.lines.every((line) => line.isCashReserve || (line.priceTimestamp !== null && isFreshProposalPrice(line.priceTimestamp, nowIso)));
}

function isFreshProposalPrice(priceTimestamp: string, nowIso: string): boolean {
  const priceTime = new Date(priceTimestamp).getTime();
  const nowTime = new Date(nowIso).getTime();
  if (!Number.isFinite(priceTime) || !Number.isFinite(nowTime) || priceTime > nowTime + 5 * 60 * 1000) {
    return false;
  }
  return nowTime - priceTime <= 36 * 60 * 60 * 1000;
}

function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function parseJsonObject<T>(value: string, fallback: T): T {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as T : fallback;
  } catch {
    return fallback;
  }
}

function roundMoney(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function roundRatio(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function roundQuantity(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
