import { getAllocationProposalById, markAllocationProposalRevisionRequired, type AllocationProposal } from "../allocation/proposals.ts";
import { YahooFinanceMarketDataProvider } from "../market/yahooFinanceProvider.ts";
import { getInvestmentPolicy, validateInvestmentPolicy, type InvestmentPolicyValidationResult } from "../policies/investmentPolicy.ts";
import { listRows } from "../shared/db.ts";
import type { AssetClass } from "../shared/types.ts";

export type PaperOrderBatchStatus =
  | "Pending Review"
  | "Ready to Execute"
  | "Rejected"
  | "Cancelled"
  | "Expired"
  | "Executing"
  | "Partially Filled"
  | "Filled"
  | "Failed";

export type PaperOrderValidationStatus = "passed" | "failed";
export type PriceDeviationStatus = "none" | "warning";

export interface PaperOrderBatch {
  id: string;
  portfolioId: string;
  proposalId: string;
  proposalVersion: number;
  totalEstimatedPurchaseUsd: number;
  estimatedRemainingCashUsd: number;
  orderCount: number;
  validationStatus: PaperOrderValidationStatus;
  validationReport: PaperOrderValidationReport;
  priceDeviationStatus: PriceDeviationStatus;
  priceDeviationThresholdPct: number;
  status: PaperOrderBatchStatus;
  rejectionReason: string | null;
  cancelledReason: string | null;
  reviewedAt: string | null;
  rejectedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  orders: PaperOrderLine[];
}

export interface PaperOrderLine {
  id: string;
  batchId: string;
  portfolioId: string;
  proposalId: string;
  proposalVersion: number;
  lineOrder: number;
  symbol: string;
  securityName: string;
  side: "Buy";
  orderType: "market";
  estimatedQuantity: number;
  estimatedDollarAmountUsd: number;
  referencePriceUsd: number;
  latestReferencePriceUsd: number;
  marketDataTimestamp: string;
  assetCategory: string;
  assetClass: AssetClass;
  investmentRationale: string;
  confidenceScore: number;
  policyValidation: InvestmentPolicyValidationResult;
  priceDeviationPct: number;
  priceDeviationWarning: boolean;
  fractionalQuantitySupported: boolean;
  status: PaperOrderBatchStatus;
  createdAt: string;
}

export interface PaperOrderValidationReport {
  compliant: boolean;
  reasons: string[];
  warnings: string[];
}

export interface PaperOrderBatchPreview {
  batch: Omit<PaperOrderBatch, "orders">;
  orders: PaperOrderLine[];
}

export interface PaperOrderStagingResult {
  batch: PaperOrderBatch | null;
  validationReport: PaperOrderValidationReport;
  idempotent: boolean;
}

export interface PaperOrderStagingOptions {
  priceDeviationThresholdPct?: number;
  now?: Date;
}

interface PortfolioSummary {
  cashUsd: number;
  totalAccountValueUsd: number;
}

interface PositionSummary {
  symbol: string;
  marketValueUsd: number;
}

interface AssetMetadata {
  symbol: string;
  assetClass: AssetClass;
  fractionalSupported: number;
  quantityPrecision: number;
}

interface LatestPrice {
  symbol: string;
  priceUsd: number;
  priceTimestamp: string;
}

interface BatchRow {
  id: string;
  portfolioId: string;
  proposalId: string;
  proposalVersion: number;
  totalEstimatedPurchaseUsd: number;
  estimatedRemainingCashUsd: number;
  orderCount: number;
  validationStatus: PaperOrderValidationStatus;
  validationReportJson: string;
  priceDeviationStatus: PriceDeviationStatus;
  priceDeviationThresholdPct: number;
  status: PaperOrderBatchStatus;
  rejectionReason: string | null;
  cancelledReason: string | null;
  reviewedAt: string | null;
  rejectedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

interface OrderRow {
  id: string;
  batchId: string;
  portfolioId: string;
  proposalId: string;
  proposalVersion: number;
  lineOrder: number;
  symbol: string;
  securityName: string;
  side: "Buy";
  orderType: "market";
  estimatedQuantity: number;
  estimatedDollarAmountUsd: number;
  referencePriceUsd: number;
  latestReferencePriceUsd: number;
  marketDataTimestamp: string;
  assetCategory: string;
  assetClass: AssetClass;
  investmentRationale: string;
  confidenceScore: number;
  policyValidationJson: string;
  priceDeviationPct: number;
  priceDeviationWarning: number;
  fractionalQuantitySupported: number;
  status: PaperOrderBatchStatus;
  createdAt: string;
}

const DEFAULT_PRICE_DEVIATION_THRESHOLD_PCT = 0.03;
const PRICE_FRESHNESS_MS = 36 * 60 * 60 * 1000;

export async function stagePaperOrdersForProposal(
  db: D1Database,
  proposalId: string,
  options: PaperOrderStagingOptions = {}
): Promise<PaperOrderStagingResult> {
  const existing = await getPaperOrderBatchByProposalId(db, proposalId);
  if (existing) {
    return { batch: existing, validationReport: existing.validationReport, idempotent: true };
  }

  const proposal = await getAllocationProposalById(db, proposalId);
  if (!proposal) {
    throw new Error("Allocation proposal not found.");
  }
  if (proposal.status !== "approved") {
    throw new Error("Only approved allocation proposals can be staged as paper orders.");
  }

  const now = options.now ?? new Date();
  const [portfolio, policy, positions, assets, prices] = await Promise.all([
    getPortfolioSummary(db, proposal.portfolioId),
    getInvestmentPolicy(db, proposal.portfolioId),
    getPositionSummaries(db, proposal.portfolioId),
    getAssetMetadata(db, proposal.lines.map((line) => line.symbol)),
    getLatestPrices(db, proposal.lines.filter((line) => !line.isCashReserve).map((line) => line.symbol), now.toISOString())
  ]);

  if (!portfolio) {
    throw new Error("Portfolio not found.");
  }

  const preview = buildPaperOrderBatchPreview({
    proposal,
    portfolio,
    policy,
    positions,
    assets,
    prices,
    nowIso: now.toISOString(),
    priceDeviationThresholdPct: options.priceDeviationThresholdPct ?? DEFAULT_PRICE_DEVIATION_THRESHOLD_PCT
  });

  if (!preview.batch.validationReport.compliant) {
    const reason = preview.batch.validationReport.reasons.join(" ") || "Paper order staging validation failed.";
    await markAllocationProposalRevisionRequired(db, proposal.id, reason);
    await insertAuditEvent(db, {
      batchId: null,
      portfolioId: proposal.portfolioId,
      proposalId: proposal.id,
      eventType: "validation_failed",
      message: "Paper order staging validation failed.",
      details: preview.batch.validationReport,
      nowIso: now.toISOString()
    });
    return { batch: null, validationReport: preview.batch.validationReport, idempotent: false };
  }

  await insertPaperOrderBatch(db, preview);
  await insertAuditEvent(db, {
    batchId: preview.batch.id,
    portfolioId: proposal.portfolioId,
    proposalId: proposal.id,
    eventType: "validation_passed",
    message: "Paper order staging validation passed.",
    details: preview.batch.validationReport,
    nowIso: now.toISOString()
  });
  await insertAuditEvent(db, {
    batchId: preview.batch.id,
    portfolioId: proposal.portfolioId,
    proposalId: proposal.id,
    eventType: "order_batch_created",
    message: "Pending paper order batch created for review.",
    details: { orderCount: preview.orders.length, totalEstimatedPurchaseUsd: preview.batch.totalEstimatedPurchaseUsd },
    nowIso: now.toISOString()
  });

  return { batch: await getPaperOrderBatchById(db, preview.batch.id), validationReport: preview.batch.validationReport, idempotent: false };
}

export function buildPaperOrderBatchPreview(input: {
  proposal: AllocationProposal;
  portfolio: PortfolioSummary;
  policy: Awaited<ReturnType<typeof getInvestmentPolicy>>;
  positions: PositionSummary[];
  assets: AssetMetadata[];
  prices: LatestPrice[];
  nowIso: string;
  priceDeviationThresholdPct?: number;
}): PaperOrderBatchPreview {
  const threshold = input.priceDeviationThresholdPct ?? DEFAULT_PRICE_DEVIATION_THRESHOLD_PCT;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const nowMs = new Date(input.nowIso).getTime();
  const priceBySymbol = new Map(input.prices.map((price) => [price.symbol, price]));
  const assetBySymbol = new Map(input.assets.map((asset) => [asset.symbol, asset]));
  const positionBySymbol = new Map(input.positions.map((position) => [position.symbol, position]));
  const investableLines = input.proposal.lines.filter((line) => !line.isCashReserve && line.targetAmountUsd > 0);
  const duplicateSymbols = duplicates(investableLines.map((line) => line.symbol));
  const categoryTotals = new Map<string, number>();
  const createdAt = input.nowIso;
  const batchId = paperOrderBatchId(input.proposal.id);
  const orders: PaperOrderLine[] = [];

  if (!input.policy) {
    reasons.push("No active investment policy is configured for this portfolio.");
  }
  if (duplicateSymbols.length > 0) {
    reasons.push(`Duplicate symbols require explicit support before staging: ${duplicateSymbols.join(", ")}.`);
  }

  let totalEstimatedPurchaseUsd = 0;
  for (const [index, line] of investableLines.entries()) {
    const asset = assetBySymbol.get(line.symbol);
    const latestPrice = priceBySymbol.get(line.symbol);
    const referencePrice = line.currentPriceUsd;
    const quantityPrecision = asset?.quantityPrecision ?? 6;
    const fractionalSupported = asset?.fractionalSupported === 1;
    const latestPriceFresh = latestPrice ? isFreshPrice(latestPrice.priceTimestamp, nowMs) : false;
    const latestReferencePrice = latestPriceFresh ? latestPrice?.priceUsd ?? null : null;
    const estimatedQuantity = latestReferencePrice
      ? roundQuantity(line.targetAmountUsd / latestReferencePrice, fractionalSupported ? quantityPrecision : 0)
      : 0;

    if (!latestReferencePrice) {
      reasons.push(`Current validated market price is unavailable or stale for ${line.symbol}.`);
    }
    if (!referencePrice || referencePrice <= 0) {
      reasons.push(`Proposal reference price is missing for ${line.symbol}.`);
    }
    if (line.targetAmountUsd <= 0) {
      reasons.push(`${line.symbol} has a zero or negative estimated dollar amount.`);
    }
    if (estimatedQuantity <= 0) {
      reasons.push(`${line.symbol} has a zero or negative estimated quantity.`);
    }

    const dollarAmount = roundMoney(line.targetAmountUsd);
    totalEstimatedPurchaseUsd = roundMoney(totalEstimatedPurchaseUsd + dollarAmount);
    categoryTotals.set(line.assetCategory, roundMoney((categoryTotals.get(line.assetCategory) ?? 0) + dollarAmount));
    const priceDeviationPct = referencePrice && latestReferencePrice ? Math.abs(latestReferencePrice - referencePrice) / referencePrice : 0;
    const priceDeviationWarning = priceDeviationPct > threshold;
    if (priceDeviationWarning) {
      warnings.push(`${line.symbol} latest price moved ${(priceDeviationPct * 100).toFixed(2)}% from the proposal reference price.`);
    }

    const currentPositionValueUsd = positionBySymbol.get(line.symbol)?.marketValueUsd ?? 0;
    const policyValidation = validateInvestmentPolicy({
      policy: input.policy,
      action: "BUY",
      orderIntent: "long_buy",
      symbol: line.symbol,
      assetClass: asset?.assetClass ?? line.assetClass,
      portfolioValueUsd: input.portfolio.totalAccountValueUsd,
      cashUsd: input.portfolio.cashUsd,
      currentPositionValueUsd,
      proposedTradeValueUsd: dollarAmount,
      resultingSectorValueUsd: categoryTotals.get(line.assetCategory) ?? dollarAmount
    });
    if (!policyValidation.allowed) {
      reasons.push(...policyValidation.reasons.map((reason) => `${line.symbol}: ${reason}`));
    }

    orders.push({
      id: `${batchId}_order_${index + 1}`,
      batchId,
      portfolioId: input.proposal.portfolioId,
      proposalId: input.proposal.id,
      proposalVersion: input.proposal.version,
      lineOrder: index + 1,
      symbol: line.symbol,
      securityName: line.securityName,
      side: "Buy",
      orderType: "market",
      estimatedQuantity,
      estimatedDollarAmountUsd: dollarAmount,
      referencePriceUsd: referencePrice ?? 0,
      latestReferencePriceUsd: latestReferencePrice ?? 0,
      marketDataTimestamp: latestPriceFresh ? latestPrice?.priceTimestamp ?? createdAt : createdAt,
      assetCategory: line.assetCategory,
      assetClass: asset?.assetClass ?? line.assetClass,
      investmentRationale: line.reason,
      confidenceScore: line.confidenceScore,
      policyValidation,
      priceDeviationPct: roundRatio(priceDeviationPct),
      priceDeviationWarning,
      fractionalQuantitySupported: fractionalSupported,
      status: "Pending Review",
      createdAt
    });
  }

  const estimatedRemainingCashUsd = roundMoney(input.portfolio.cashUsd - totalEstimatedPurchaseUsd);
  if (totalEstimatedPurchaseUsd > input.portfolio.cashUsd) {
    reasons.push("Order set exceeds available cash.");
  }
  if (input.policy && estimatedRemainingCashUsd < input.portfolio.totalAccountValueUsd * input.policy.minCashAllocationPct) {
    reasons.push("Order set would reduce cash below the minimum required cash allocation.");
  }
  if (input.policy) {
    for (const [category, value] of categoryTotals.entries()) {
      if (value > input.portfolio.totalAccountValueUsd * input.policy.maxSectorAllocationPct) {
        reasons.push(`${category} would exceed the maximum sector allocation.`);
      }
    }
  }

  const uniqueReasons = [...new Set(reasons)];
  const uniqueWarnings = [...new Set(warnings)];
  const validationReport = {
    compliant: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    warnings: uniqueWarnings
  };
  const batch = {
    id: batchId,
    portfolioId: input.proposal.portfolioId,
    proposalId: input.proposal.id,
    proposalVersion: input.proposal.version,
    totalEstimatedPurchaseUsd,
    estimatedRemainingCashUsd,
    orderCount: orders.length,
    validationStatus: validationReport.compliant ? "passed" as const : "failed" as const,
    validationReport,
    priceDeviationStatus: orders.some((order) => order.priceDeviationWarning) ? "warning" as const : "none" as const,
    priceDeviationThresholdPct: threshold,
    status: "Pending Review" as const,
    rejectionReason: null,
    cancelledReason: null,
    reviewedAt: null,
    rejectedAt: null,
    cancelledAt: null,
    createdAt
  };

  return { batch, orders };
}

export async function getLatestPaperOrderBatch(db: D1Database, portfolioId: string): Promise<PaperOrderBatch | null> {
  const row = await db
    .prepare(
      `SELECT id, portfolio_id AS portfolioId, proposal_id AS proposalId, proposal_version AS proposalVersion,
        total_estimated_purchase_usd AS totalEstimatedPurchaseUsd, estimated_remaining_cash_usd AS estimatedRemainingCashUsd,
        order_count AS orderCount, validation_status AS validationStatus, validation_report_json AS validationReportJson,
        price_deviation_status AS priceDeviationStatus, price_deviation_threshold_pct AS priceDeviationThresholdPct,
        status, rejection_reason AS rejectionReason, cancelled_reason AS cancelledReason, reviewed_at AS reviewedAt,
        rejected_at AS rejectedAt, cancelled_at AS cancelledAt, created_at AS createdAt
       FROM paper_order_batches
       WHERE portfolio_id = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(portfolioId)
    .first<BatchRow>();
  return row ? hydrateBatch(db, row) : null;
}

export async function getPaperOrderBatchById(db: D1Database, batchId: string): Promise<PaperOrderBatch> {
  const row = await db
    .prepare(
      `SELECT id, portfolio_id AS portfolioId, proposal_id AS proposalId, proposal_version AS proposalVersion,
        total_estimated_purchase_usd AS totalEstimatedPurchaseUsd, estimated_remaining_cash_usd AS estimatedRemainingCashUsd,
        order_count AS orderCount, validation_status AS validationStatus, validation_report_json AS validationReportJson,
        price_deviation_status AS priceDeviationStatus, price_deviation_threshold_pct AS priceDeviationThresholdPct,
        status, rejection_reason AS rejectionReason, cancelled_reason AS cancelledReason, reviewed_at AS reviewedAt,
        rejected_at AS rejectedAt, cancelled_at AS cancelledAt, created_at AS createdAt
       FROM paper_order_batches
       WHERE id = ?`
    )
    .bind(batchId)
    .first<BatchRow>();
  if (!row) {
    throw new Error("Paper order batch not found.");
  }
  return hydrateBatch(db, row);
}

export async function getPaperOrderBatchByProposalId(db: D1Database, proposalId: string): Promise<PaperOrderBatch | null> {
  const row = await db
    .prepare(
      `SELECT id, portfolio_id AS portfolioId, proposal_id AS proposalId, proposal_version AS proposalVersion,
        total_estimated_purchase_usd AS totalEstimatedPurchaseUsd, estimated_remaining_cash_usd AS estimatedRemainingCashUsd,
        order_count AS orderCount, validation_status AS validationStatus, validation_report_json AS validationReportJson,
        price_deviation_status AS priceDeviationStatus, price_deviation_threshold_pct AS priceDeviationThresholdPct,
        status, rejection_reason AS rejectionReason, cancelled_reason AS cancelledReason, reviewed_at AS reviewedAt,
        rejected_at AS rejectedAt, cancelled_at AS cancelledAt, created_at AS createdAt
       FROM paper_order_batches
       WHERE proposal_id = ?`
    )
    .bind(proposalId)
    .first<BatchRow>();
  return row ? hydrateBatch(db, row) : null;
}

export async function markPaperOrderBatchReady(db: D1Database, batchId: string, now = new Date()): Promise<PaperOrderBatch> {
  const batch = await getPaperOrderBatchById(db, batchId);
  if (batch.validationStatus !== "passed") {
    throw new Error("Paper order batch cannot be marked ready until validation passes.");
  }
  await updateBatchStatus(db, batchId, "Ready to Execute", now.toISOString());
  await insertAuditEvent(db, {
    batchId,
    portfolioId: batch.portfolioId,
    proposalId: batch.proposalId,
    eventType: "batch_marked_ready_to_execute",
    message: "Paper order batch marked Ready to Execute for later review.",
    details: { status: "Ready to Execute" },
    nowIso: now.toISOString()
  });
  return getPaperOrderBatchById(db, batchId);
}

export async function rejectPaperOrderBatch(db: D1Database, batchId: string, reason = "Rejected by reviewer.", now = new Date()): Promise<PaperOrderBatch> {
  const batch = await getPaperOrderBatchById(db, batchId);
  await db
    .prepare("UPDATE paper_order_batches SET status = 'Rejected', rejection_reason = ?, rejected_at = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(reason.slice(0, 500), now.toISOString(), batchId)
    .run();
  await db.prepare("UPDATE paper_order_batch_orders SET status = 'Rejected', updated_at = datetime('now') WHERE batch_id = ?").bind(batchId).run();
  await insertAuditEvent(db, {
    batchId,
    portfolioId: batch.portfolioId,
    proposalId: batch.proposalId,
    eventType: "batch_rejected",
    message: "Paper order batch rejected.",
    details: { reason },
    nowIso: now.toISOString()
  });
  return getPaperOrderBatchById(db, batchId);
}

export async function cancelPaperOrderBatch(db: D1Database, batchId: string, reason = "Cancelled by reviewer.", now = new Date()): Promise<PaperOrderBatch> {
  const batch = await getPaperOrderBatchById(db, batchId);
  await db
    .prepare("UPDATE paper_order_batches SET status = 'Cancelled', cancelled_reason = ?, cancelled_at = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(reason.slice(0, 500), now.toISOString(), batchId)
    .run();
  await db.prepare("UPDATE paper_order_batch_orders SET status = 'Cancelled', updated_at = datetime('now') WHERE batch_id = ?").bind(batchId).run();
  await insertAuditEvent(db, {
    batchId,
    portfolioId: batch.portfolioId,
    proposalId: batch.proposalId,
    eventType: "batch_cancelled",
    message: "Paper order batch cancelled.",
    details: { reason },
    nowIso: now.toISOString()
  });
  return getPaperOrderBatchById(db, batchId);
}

export async function refreshPaperOrderBatchPrices(db: D1Database, batchId: string, now = new Date()): Promise<PaperOrderBatch> {
  const batch = await getPaperOrderBatchById(db, batchId);
  const proposal = await getAllocationProposalById(db, batch.proposalId);
  if (!proposal) {
    throw new Error("Allocation proposal not found.");
  }
  const [portfolio, policy, positions, assets, prices] = await Promise.all([
    getPortfolioSummary(db, proposal.portfolioId),
    getInvestmentPolicy(db, proposal.portfolioId),
    getPositionSummaries(db, proposal.portfolioId),
    getAssetMetadata(db, proposal.lines.map((line) => line.symbol)),
    getLatestPrices(db, proposal.lines.filter((line) => !line.isCashReserve).map((line) => line.symbol), now.toISOString())
  ]);
  if (!portfolio) {
    throw new Error("Portfolio not found.");
  }
  const preview = buildPaperOrderBatchPreview({
    proposal,
    portfolio,
    policy,
    positions,
    assets,
    prices,
    nowIso: now.toISOString(),
    priceDeviationThresholdPct: batch.priceDeviationThresholdPct
  });
  await updateExistingPaperOrderBatch(db, batch.id, batch.status, preview);
  if (!preview.batch.validationReport.compliant) {
    await markAllocationProposalRevisionRequired(db, proposal.id, preview.batch.validationReport.reasons.join(" "));
    await insertAuditEvent(db, {
      batchId,
      portfolioId: batch.portfolioId,
      proposalId: batch.proposalId,
      eventType: "validation_failed",
      message: "Paper order batch revalidation failed after price refresh.",
      details: preview.batch.validationReport,
      nowIso: now.toISOString()
    });
  } else {
    await insertAuditEvent(db, {
      batchId,
      portfolioId: batch.portfolioId,
      proposalId: batch.proposalId,
      eventType: "validation_passed",
      message: "Paper order batch revalidation passed after price refresh.",
      details: preview.batch.validationReport,
      nowIso: now.toISOString()
    });
  }
  await insertAuditEvent(db, {
    batchId,
    portfolioId: batch.portfolioId,
    proposalId: batch.proposalId,
    eventType: "prices_refreshed",
    message: "Paper order batch prices were refreshed for revalidation.",
    details: { status: batch.status },
    nowIso: now.toISOString()
  });
  return getPaperOrderBatchById(db, batchId);
}

async function insertPaperOrderBatch(db: D1Database, preview: PaperOrderBatchPreview): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO paper_order_batches (
        id, portfolio_id, proposal_id, proposal_version, total_estimated_purchase_usd,
        estimated_remaining_cash_usd, order_count, validation_status, validation_report_json,
        price_deviation_status, price_deviation_threshold_pct, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      preview.batch.id,
      preview.batch.portfolioId,
      preview.batch.proposalId,
      preview.batch.proposalVersion,
      preview.batch.totalEstimatedPurchaseUsd,
      preview.batch.estimatedRemainingCashUsd,
      preview.batch.orderCount,
      preview.batch.validationStatus,
      JSON.stringify(preview.batch.validationReport),
      preview.batch.priceDeviationStatus,
      preview.batch.priceDeviationThresholdPct,
      preview.batch.status,
      preview.batch.createdAt
    )
    .run();

  for (const order of preview.orders) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO paper_order_batch_orders (
          id, batch_id, portfolio_id, proposal_id, proposal_version, line_order,
          symbol, security_name, side, order_type, estimated_quantity,
          estimated_dollar_amount_usd, reference_price_usd, latest_reference_price_usd,
          market_data_timestamp, asset_category, asset_class, investment_rationale,
          confidence_score, policy_validation_json, price_deviation_pct,
          price_deviation_warning, fractional_quantity_supported, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        order.id,
        order.batchId,
        order.portfolioId,
        order.proposalId,
        order.proposalVersion,
        order.lineOrder,
        order.symbol,
        order.securityName,
        order.side,
        order.orderType,
        order.estimatedQuantity,
        order.estimatedDollarAmountUsd,
        order.referencePriceUsd,
        order.latestReferencePriceUsd,
        order.marketDataTimestamp,
        order.assetCategory,
        order.assetClass,
        order.investmentRationale,
        order.confidenceScore,
        JSON.stringify(order.policyValidation),
        order.priceDeviationPct,
        order.priceDeviationWarning ? 1 : 0,
        order.fractionalQuantitySupported ? 1 : 0,
        order.status,
        order.createdAt
      )
      .run();
  }
}

async function updateExistingPaperOrderBatch(
  db: D1Database,
  batchId: string,
  status: PaperOrderBatchStatus,
  preview: PaperOrderBatchPreview
): Promise<void> {
  await db
    .prepare(
      `UPDATE paper_order_batches
       SET total_estimated_purchase_usd = ?, estimated_remaining_cash_usd = ?,
        order_count = ?, validation_status = ?, validation_report_json = ?,
        price_deviation_status = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(
      preview.batch.totalEstimatedPurchaseUsd,
      preview.batch.estimatedRemainingCashUsd,
      preview.batch.orderCount,
      preview.batch.validationStatus,
      JSON.stringify(preview.batch.validationReport),
      preview.batch.priceDeviationStatus,
      batchId
    )
    .run();

  for (const order of preview.orders) {
    await db
      .prepare(
        `UPDATE paper_order_batch_orders
         SET estimated_quantity = ?, estimated_dollar_amount_usd = ?,
          reference_price_usd = ?, latest_reference_price_usd = ?,
          market_data_timestamp = ?, policy_validation_json = ?,
          price_deviation_pct = ?, price_deviation_warning = ?,
          status = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .bind(
        order.estimatedQuantity,
        order.estimatedDollarAmountUsd,
        order.referencePriceUsd,
        order.latestReferencePriceUsd,
        order.marketDataTimestamp,
        JSON.stringify(order.policyValidation),
        order.priceDeviationPct,
        order.priceDeviationWarning ? 1 : 0,
        status,
        order.id
      )
      .run();
  }
}

async function hydrateBatch(db: D1Database, row: BatchRow): Promise<PaperOrderBatch> {
  const orders = await listRows<OrderRow>(
    db
      .prepare(
        `SELECT id, batch_id AS batchId, portfolio_id AS portfolioId, proposal_id AS proposalId,
          proposal_version AS proposalVersion, line_order AS lineOrder, symbol, security_name AS securityName,
          side, order_type AS orderType, estimated_quantity AS estimatedQuantity,
          estimated_dollar_amount_usd AS estimatedDollarAmountUsd, reference_price_usd AS referencePriceUsd,
          latest_reference_price_usd AS latestReferencePriceUsd, market_data_timestamp AS marketDataTimestamp,
          asset_category AS assetCategory, asset_class AS assetClass, investment_rationale AS investmentRationale,
          confidence_score AS confidenceScore, policy_validation_json AS policyValidationJson,
          price_deviation_pct AS priceDeviationPct, price_deviation_warning AS priceDeviationWarning,
          fractional_quantity_supported AS fractionalQuantitySupported, status, created_at AS createdAt
         FROM paper_order_batch_orders
         WHERE batch_id = ?
         ORDER BY line_order ASC`
      )
      .bind(row.id)
  );
  return {
    id: row.id,
    portfolioId: row.portfolioId,
    proposalId: row.proposalId,
    proposalVersion: row.proposalVersion,
    totalEstimatedPurchaseUsd: row.totalEstimatedPurchaseUsd,
    estimatedRemainingCashUsd: row.estimatedRemainingCashUsd,
    orderCount: row.orderCount,
    validationStatus: row.validationStatus,
    validationReport: parseJsonObject<PaperOrderValidationReport>(row.validationReportJson, { compliant: false, reasons: [], warnings: [] }),
    priceDeviationStatus: row.priceDeviationStatus,
    priceDeviationThresholdPct: row.priceDeviationThresholdPct,
    status: row.status,
    rejectionReason: row.rejectionReason,
    cancelledReason: row.cancelledReason,
    reviewedAt: row.reviewedAt,
    rejectedAt: row.rejectedAt,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    orders: orders.map((order) => ({
      id: order.id,
      batchId: order.batchId,
      portfolioId: order.portfolioId,
      proposalId: order.proposalId,
      proposalVersion: order.proposalVersion,
      lineOrder: order.lineOrder,
      symbol: order.symbol,
      securityName: order.securityName,
      side: order.side,
      orderType: order.orderType,
      estimatedQuantity: order.estimatedQuantity,
      estimatedDollarAmountUsd: order.estimatedDollarAmountUsd,
      referencePriceUsd: order.referencePriceUsd,
      latestReferencePriceUsd: order.latestReferencePriceUsd,
      marketDataTimestamp: order.marketDataTimestamp,
      assetCategory: order.assetCategory,
      assetClass: order.assetClass,
      investmentRationale: order.investmentRationale,
      confidenceScore: order.confidenceScore,
      policyValidation: parseJsonObject<InvestmentPolicyValidationResult>(order.policyValidationJson, { allowed: false, reasons: [] }),
      priceDeviationPct: order.priceDeviationPct,
      priceDeviationWarning: order.priceDeviationWarning === 1,
      fractionalQuantitySupported: order.fractionalQuantitySupported === 1,
      status: order.status,
      createdAt: order.createdAt
    }))
  };
}

async function getPortfolioSummary(db: D1Database, portfolioId: string): Promise<PortfolioSummary | null> {
  return db
    .prepare(
      `SELECT p.cash_usd AS cashUsd, p.cash_usd + COALESCE(SUM(pos.market_value_usd), 0) AS totalAccountValueUsd
       FROM portfolios p
       LEFT JOIN positions pos ON pos.portfolio_id = p.id AND pos.quantity > 0
       WHERE p.id = ?
       GROUP BY p.id`
    )
    .bind(portfolioId)
    .first<PortfolioSummary>();
}

async function getPositionSummaries(db: D1Database, portfolioId: string): Promise<PositionSummary[]> {
  return listRows(
    db
      .prepare("SELECT symbol, market_value_usd AS marketValueUsd FROM positions WHERE portfolio_id = ? AND quantity > 0")
      .bind(portfolioId)
  );
}

async function getAssetMetadata(db: D1Database, symbols: string[]): Promise<AssetMetadata[]> {
  if (symbols.length === 0) {
    return [];
  }
  const placeholders = symbols.map(() => "?").join(", ");
  return listRows(
    db
      .prepare(
        `SELECT symbol, asset_type AS assetClass, fractional_supported AS fractionalSupported,
          quantity_precision AS quantityPrecision
         FROM assets
         WHERE symbol IN (${placeholders})`
      )
      .bind(...symbols)
  );
}

async function getLatestPrices(db: D1Database, symbols: string[], nowIso: string): Promise<LatestPrice[]> {
  const uniqueSymbols = [...new Set(symbols)];
  const prices: LatestPrice[] = [];
  const provider = new YahooFinanceMarketDataProvider();
  const nowMs = new Date(nowIso).getTime();
  for (const symbol of uniqueSymbols) {
    const row = await db
      .prepare(
        `SELECT symbol, price_usd AS priceUsd, price_as_of AS priceTimestamp
         FROM market_snapshots
         WHERE symbol = ? AND validation_status = 'validated' AND price_usd > 0
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .bind(symbol)
      .first<LatestPrice>();
    if (row && isFreshPrice(row.priceTimestamp, nowMs)) {
      prices.push(row);
      continue;
    }
    try {
      const live = await provider.getMarketData(symbol);
      if (live.validated && live.priceUsd > 0) {
        prices.push({ symbol, priceUsd: live.priceUsd, priceTimestamp: live.asOf });
      } else if (row) {
        prices.push(row);
      }
    } catch {
      if (row) {
        prices.push(row);
      }
    }
  }
  return prices;
}

async function updateBatchStatus(db: D1Database, batchId: string, status: PaperOrderBatchStatus, nowIso: string): Promise<void> {
  await db
    .prepare("UPDATE paper_order_batches SET status = ?, reviewed_at = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(status, nowIso, batchId)
    .run();
  await db.prepare("UPDATE paper_order_batch_orders SET status = ?, updated_at = datetime('now') WHERE batch_id = ?").bind(status, batchId).run();
}

async function insertAuditEvent(db: D1Database, input: {
  batchId: string | null;
  portfolioId: string;
  proposalId: string | null;
  eventType: string;
  message: string;
  details: unknown;
  nowIso: string;
}): Promise<void> {
  const base = `${input.batchId ?? input.proposalId ?? input.portfolioId}_${input.eventType}_${input.nowIso}`.replace(/[^A-Za-z0-9_-]/g, "");
  await db
    .prepare(
      `INSERT OR IGNORE INTO paper_order_batch_events (
        id, batch_id, portfolio_id, proposal_id, event_type, message, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(base.slice(0, 180), input.batchId, input.portfolioId, input.proposalId, input.eventType, input.message, JSON.stringify(input.details), input.nowIso)
    .run();
}

function paperOrderBatchId(proposalId: string): string {
  return `paper_order_batch_${proposalId}`.slice(0, 180);
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicate.add(value);
    }
    seen.add(value);
  }
  return [...duplicate];
}

function isFreshPrice(timestamp: string, nowMs: number): boolean {
  const priceMs = new Date(timestamp).getTime();
  return Number.isFinite(priceMs) && priceMs <= nowMs + 5 * 60 * 1000 && nowMs - priceMs <= PRICE_FRESHNESS_MS;
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

function roundQuantity(value: number, precision: number): number {
  const factor = 10 ** Math.max(0, Math.min(12, precision));
  return Math.round(value * factor) / factor;
}
