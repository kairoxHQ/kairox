import { MarketDataService } from "../market/service.ts";
import { completeDailySnapshot, ensureDailyStartSnapshot } from "../portfolio/dailySnapshots.ts";
import { recordEquityHistory } from "../portfolio/performance.ts";
import { getPortfolioValuation, recordValuationSnapshot } from "../portfolio/valuation.ts";
import { getInvestmentPolicy, validateInvestmentPolicy, type InvestmentPolicyValidationResult } from "../policies/investmentPolicy.ts";
import { listRows } from "../shared/db.ts";
import { addMoney, roundMoney, roundRatio, subtractMoney } from "../shared/money.ts";
import type { AssetClass } from "../shared/types.ts";
import { getPaperOrderBatchById, type PaperOrderBatch, type PaperOrderLine } from "./staging.ts";
import { recordJourneyEvent } from "../journey/service.ts";

export interface PaperExecutionOptions {
  now?: Date;
  slippagePct?: number;
  feePct?: number;
  priceDeviationThresholdPct?: number;
}

export interface PaperExecutionResult {
  execution: PaperExecutionRecord | null;
  validation: ExecutionValidationReport;
  idempotent: boolean;
}

export interface PaperExecutionRecord {
  id: string;
  batchId: string;
  portfolioId: string;
  proposalId: string;
  proposalVersion: number;
  status: "Executing" | "Filled" | "Failed";
  orderCount: number;
  totalGrossAmountUsd: number;
  totalFeesUsd: number;
  totalNetAmountUsd: number;
  cashBeforeUsd: number;
  cashAfterUsd: number;
  portfolioValueAfterUsd: number | null;
  totalAccountValueAfterUsd: number | null;
  slippagePct: number;
  validationReport: ExecutionValidationReport;
  failureReason: string | null;
  startedAt: string;
  completedAt: string | null;
  fills: PaperFill[];
}

export interface PaperFill {
  id: string;
  executionId: string;
  batchId: string;
  stagedOrderId: string;
  executionOrderId: string;
  tradeId: string;
  portfolioId: string;
  proposalId: string;
  proposalVersion: number;
  symbol: string;
  assetClass: AssetClass;
  side: "Buy";
  quantity: number;
  referencePriceUsd: number;
  fillPriceUsd: number;
  slippageAmountUsd: number;
  slippagePct: number;
  grossAmountUsd: number;
  simulatedFeesUsd: number;
  netAmountUsd: number;
  marketDataTimestamp: string;
  rationale: string;
  confidenceScore: number;
  policyValidation: InvestmentPolicyValidationResult;
  filledAt: string;
}

export interface ExecutionValidationReport {
  compliant: boolean;
  reasons: string[];
  warnings: string[];
  requiresReview: boolean;
}

interface PortfolioRow {
  id: string;
  cashUsd: number;
  startingBalanceUsd: number;
  mode: string;
  brokerAccountId: string | null;
}

interface PositionRow {
  id: string;
  symbol: string;
  assetClass: AssetClass;
  quantity: number;
  avgEntryPriceUsd: number;
  currentPriceUsd: number;
  marketValueUsd: number;
}

interface AssetMetadata {
  symbol: string;
  assetClass: AssetClass;
  fractionalSupported: boolean;
  quantityPrecision: number;
}

interface LatestPrice {
  symbol: string;
  priceUsd: number;
  priceTimestamp: string;
}

interface ExecutionRow {
  id: string;
  batchId: string;
  portfolioId: string;
  proposalId: string;
  proposalVersion: number;
  status: "Executing" | "Filled" | "Failed";
  orderCount: number;
  totalGrossAmountUsd: number;
  totalFeesUsd: number;
  totalNetAmountUsd: number;
  cashBeforeUsd: number;
  cashAfterUsd: number;
  portfolioValueAfterUsd: number | null;
  totalAccountValueAfterUsd: number | null;
  slippagePct: number;
  validationReportJson: string;
  failureReason: string | null;
  startedAt: string;
  completedAt: string | null;
}

interface FillRow {
  id: string;
  executionId: string;
  batchId: string;
  stagedOrderId: string;
  executionOrderId: string;
  tradeId: string;
  portfolioId: string;
  proposalId: string;
  proposalVersion: number;
  symbol: string;
  assetClass: AssetClass;
  side: "Buy";
  quantity: number;
  referencePriceUsd: number;
  fillPriceUsd: number;
  slippageAmountUsd: number;
  slippagePct: number;
  grossAmountUsd: number;
  simulatedFeesUsd: number;
  netAmountUsd: number;
  marketDataTimestamp: string;
  rationale: string;
  confidenceScore: number;
  policyValidationJson: string;
  filledAt: string;
}

const DEFAULT_SLIPPAGE_PCT = 0.001;
const DEFAULT_FEE_PCT = 0;
const DEFAULT_PRICE_DEVIATION_THRESHOLD_PCT = 0.03;
const PRICE_FRESHNESS_MS = 36 * 60 * 60 * 1000;

export async function executePaperOrderBatch(
  db: D1Database,
  batchId: string,
  options: PaperExecutionOptions = {}
): Promise<PaperExecutionResult> {
  const existing = await getPaperExecutionByBatchId(db, batchId);
  if (existing?.status === "Filled") {
    return { execution: existing, validation: existing.validationReport, idempotent: true };
  }

  const batch = await getPaperOrderBatchById(db, batchId);
  if (batch.status === "Filled") {
    return { execution: existing, validation: existing?.validationReport ?? okReport(), idempotent: true };
  }
  if (batch.status !== "Ready to Execute") {
    throw new Error("Only Ready to Execute paper order batches can be executed.");
  }

  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const [portfolio, policy, positions, assets, prices] = await Promise.all([
    getPortfolio(db, batch.portfolioId),
    getInvestmentPolicy(db, batch.portfolioId),
    getPositions(db, batch.portfolioId),
    getAssetMetadata(db, batch.orders.map((order) => order.symbol)),
    getLatestPrices(db, batch.orders.map((order) => order.symbol), now)
  ]);

  if (!portfolio) {
    throw new Error("Portfolio not found.");
  }

  const plan = buildPaperExecutionPlan({
    batch,
    portfolio,
    policy,
    positions,
    assets,
    prices,
    nowIso,
    slippagePct: options.slippagePct ?? DEFAULT_SLIPPAGE_PCT,
    feePct: options.feePct ?? DEFAULT_FEE_PCT,
    priceDeviationThresholdPct: options.priceDeviationThresholdPct ?? batch.priceDeviationThresholdPct ?? DEFAULT_PRICE_DEVIATION_THRESHOLD_PCT
  });

  if (!plan.validation.compliant) {
    const nextStatus = plan.validation.requiresReview ? "Pending Review" : "Failed";
    await markExecutionValidationFailure(db, batch, plan.validation, nextStatus, nowIso);
    return { execution: null, validation: plan.validation, idempotent: false };
  }

  await persistExecutionPlan(db, plan);
  await recordPostExecutionArtifacts(db, plan.batch.portfolioId, now);
  return { execution: await getPaperExecutionByBatchId(db, batchId), validation: plan.validation, idempotent: false };
}

export function buildPaperExecutionPlan(input: {
  batch: PaperOrderBatch;
  portfolio: PortfolioRow;
  policy: Awaited<ReturnType<typeof getInvestmentPolicy>>;
  positions: PositionRow[];
  assets: AssetMetadata[];
  prices: LatestPrice[];
  nowIso: string;
  slippagePct?: number;
  feePct?: number;
  priceDeviationThresholdPct?: number;
}): { batch: PaperOrderBatch; execution: PaperExecutionRecord; validation: ExecutionValidationReport; positionsAfter: PositionRow[] } {
  const slippagePct = input.slippagePct ?? DEFAULT_SLIPPAGE_PCT;
  const feePct = input.feePct ?? DEFAULT_FEE_PCT;
  const deviationThreshold = input.priceDeviationThresholdPct ?? DEFAULT_PRICE_DEVIATION_THRESHOLD_PCT;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const nowMs = new Date(input.nowIso).getTime();
  const priceBySymbol = new Map(input.prices.map((price) => [price.symbol, price]));
  const assetBySymbol = new Map(input.assets.map((asset) => [asset.symbol, asset]));
  const positionsBySymbol = new Map(input.positions.map((position) => [position.symbol, { ...position }]));
  const categoryTotals = new Map<string, number>();

  if (input.portfolio.mode !== "paper") {
    reasons.push("Only paper portfolios can use the paper execution engine.");
  }
  if (input.batch.status !== "Ready to Execute") {
    reasons.push("Batch is not Ready to Execute.");
  }
  if (!input.policy) {
    reasons.push("No active investment policy is configured for this portfolio.");
  }

  let cashAfter = input.portfolio.cashUsd;
  const fills: PaperFill[] = [];
  for (const [index, order] of input.batch.orders.entries()) {
    const asset = assetBySymbol.get(order.symbol);
    const latest = priceBySymbol.get(order.symbol);
    const latestFresh = latest ? isFreshPrice(latest.priceTimestamp, nowMs) : false;
    const referencePrice = latestFresh ? latest?.priceUsd ?? 0 : 0;
    if (!latestFresh || referencePrice <= 0) {
      reasons.push(`Latest validated market price is unavailable or stale for ${order.symbol}.`);
      continue;
    }
    if (!asset) {
      reasons.push(`${order.symbol} is missing asset metadata.`);
      continue;
    }
    const movement = Math.abs(referencePrice - order.referencePriceUsd) / order.referencePriceUsd;
    if (movement > deviationThreshold) {
      reasons.push(`${order.symbol} moved ${(movement * 100).toFixed(2)}% from the staged reference price and requires re-review.`);
    }
    const fractionalPart = Math.abs(order.estimatedQuantity - Math.round(order.estimatedQuantity));
    if (!asset.fractionalSupported && fractionalPart > 0.0000001) {
      reasons.push(`${order.symbol} does not support fractional-share execution.`);
    }

    const quantity = asset.fractionalSupported ? roundQuantity(order.estimatedQuantity, asset.quantityPrecision) : Math.floor(order.estimatedQuantity);
    if (quantity <= 0) {
      reasons.push(`${order.symbol} has a zero or negative execution quantity.`);
    }
    const fillPrice = roundMoney(referencePrice * (1 + slippagePct));
    const gross = roundMoney(quantity * fillPrice);
    const fee = roundMoney(gross * feePct);
    const net = addMoney(gross, fee);
    cashAfter = subtractMoney(cashAfter, net);

    const currentPosition = positionsBySymbol.get(order.symbol);
    const nextPositionValue = addMoney(currentPosition?.marketValueUsd ?? 0, quantity * referencePrice);
    categoryTotals.set(order.assetCategory, addMoney(categoryTotals.get(order.assetCategory) ?? 0, quantity * referencePrice));
    const policyValidation = validateInvestmentPolicy({
      policy: input.policy,
      action: "BUY",
      orderIntent: "long_buy",
      symbol: order.symbol,
      assetClass: asset.assetClass,
      portfolioValueUsd: input.portfolio.cashUsd + input.positions.reduce((sum, position) => sum + position.marketValueUsd, 0),
      cashUsd: input.portfolio.cashUsd,
      currentPositionValueUsd: currentPosition?.marketValueUsd ?? 0,
      proposedTradeValueUsd: roundMoney(quantity * referencePrice),
      resultingSectorValueUsd: categoryTotals.get(order.assetCategory) ?? net
    });
    if (!policyValidation.allowed) {
      reasons.push(...policyValidation.reasons.map((reason) => `${order.symbol}: ${reason}`));
    }

    fills.push({
      id: `${executionId(input.batch.id)}_fill_${index + 1}`,
      executionId: executionId(input.batch.id),
      batchId: input.batch.id,
      stagedOrderId: order.id,
      executionOrderId: `order_${input.batch.id}_${index + 1}`.slice(0, 180),
      tradeId: `trade_${input.batch.id}_${index + 1}`.slice(0, 180),
      portfolioId: input.batch.portfolioId,
      proposalId: input.batch.proposalId,
      proposalVersion: input.batch.proposalVersion,
      symbol: order.symbol,
      assetClass: asset.assetClass,
      side: "Buy",
      quantity,
      referencePriceUsd: referencePrice,
      fillPriceUsd: fillPrice,
      slippageAmountUsd: roundMoney(fillPrice - referencePrice),
      slippagePct,
      grossAmountUsd: gross,
      simulatedFeesUsd: fee,
      netAmountUsd: net,
      marketDataTimestamp: latest?.priceTimestamp ?? input.nowIso,
      rationale: order.investmentRationale,
      confidenceScore: order.confidenceScore,
      policyValidation,
      filledAt: input.nowIso
    });

    const existingQuantity = currentPosition?.quantity ?? 0;
    const newQuantity = existingQuantity + quantity;
    const newAvg = newQuantity > 0
      ? ((existingQuantity * (currentPosition?.avgEntryPriceUsd ?? 0)) + quantity * fillPrice) / newQuantity
      : fillPrice;
    positionsBySymbol.set(order.symbol, {
      id: `pos_${input.batch.portfolioId}_${order.symbol.replace(/[^A-Z0-9]/g, "_")}`,
      symbol: order.symbol,
      assetClass: asset.assetClass,
      quantity: newQuantity,
      avgEntryPriceUsd: roundMoney(newAvg),
      currentPriceUsd: referencePrice,
      marketValueUsd: roundMoney(newQuantity * referencePrice)
    });
  }

  if (cashAfter < 0) {
    reasons.push("Execution would make paper cash negative.");
  }
  if (input.policy && cashAfter < (input.portfolio.cashUsd + input.positions.reduce((sum, position) => sum + position.marketValueUsd, 0)) * input.policy.minCashAllocationPct) {
    reasons.push("Execution would reduce cash below the minimum required reserve.");
  }
  if (input.policy) {
    const totalValue = input.portfolio.cashUsd + input.positions.reduce((sum, position) => sum + position.marketValueUsd, 0);
    for (const [category, value] of categoryTotals.entries()) {
      if (value > totalValue * input.policy.maxSectorAllocationPct) {
        reasons.push(`${category} would exceed the maximum sector allocation.`);
      }
    }
  }

  const requiresReview = reasons.some((reason) => /requires re-review|moved/i.test(reason));
  const validation = {
    compliant: reasons.length === 0,
    reasons: [...new Set(reasons)],
    warnings: [...new Set(warnings)],
    requiresReview
  };
  const totalGross = fills.reduce((sum, fill) => addMoney(sum, fill.grossAmountUsd), 0);
  const totalFees = fills.reduce((sum, fill) => addMoney(sum, fill.simulatedFeesUsd), 0);
  const totalNet = fills.reduce((sum, fill) => addMoney(sum, fill.netAmountUsd), 0);
  const positionsAfter = [...positionsBySymbol.values()];
  const portfolioValueAfter = positionsAfter.reduce((sum, position) => addMoney(sum, position.marketValueUsd), 0);
  const execution = {
    id: executionId(input.batch.id),
    batchId: input.batch.id,
    portfolioId: input.batch.portfolioId,
    proposalId: input.batch.proposalId,
    proposalVersion: input.batch.proposalVersion,
    status: validation.compliant ? "Filled" as const : "Failed" as const,
    orderCount: fills.length,
    totalGrossAmountUsd: totalGross,
    totalFeesUsd: totalFees,
    totalNetAmountUsd: totalNet,
    cashBeforeUsd: roundMoney(input.portfolio.cashUsd),
    cashAfterUsd: roundMoney(cashAfter),
    portfolioValueAfterUsd: roundMoney(portfolioValueAfter),
    totalAccountValueAfterUsd: addMoney(cashAfter, portfolioValueAfter),
    slippagePct,
    validationReport: validation,
    failureReason: validation.compliant ? null : validation.reasons.join(" "),
    startedAt: input.nowIso,
    completedAt: validation.compliant ? input.nowIso : null,
    fills
  };
  return { batch: input.batch, execution, validation, positionsAfter };
}

export async function getPaperExecutionByBatchId(db: D1Database, batchId: string): Promise<PaperExecutionRecord | null> {
  const row = await db
    .prepare(
      `SELECT id, batch_id AS batchId, portfolio_id AS portfolioId, proposal_id AS proposalId,
        proposal_version AS proposalVersion, status, order_count AS orderCount,
        total_gross_amount_usd AS totalGrossAmountUsd, total_fees_usd AS totalFeesUsd,
        total_net_amount_usd AS totalNetAmountUsd, cash_before_usd AS cashBeforeUsd,
        cash_after_usd AS cashAfterUsd, portfolio_value_after_usd AS portfolioValueAfterUsd,
        total_account_value_after_usd AS totalAccountValueAfterUsd, slippage_pct AS slippagePct,
        validation_report_json AS validationReportJson, failure_reason AS failureReason,
        started_at AS startedAt, completed_at AS completedAt
       FROM paper_order_executions
       WHERE batch_id = ?`
    )
    .bind(batchId)
    .first<ExecutionRow>();
  return row ? hydrateExecution(db, row) : null;
}

async function persistExecutionPlan(db: D1Database, plan: ReturnType<typeof buildPaperExecutionPlan>): Promise<void> {
  let runningCash = plan.execution.cashBeforeUsd;
  const statements: D1PreparedStatement[] = [];
  statements.push(db.prepare("UPDATE paper_order_batches SET status = 'Executing', execution_id = ?, execution_started_at = ?, updated_at = datetime('now') WHERE id = ? AND status = 'Ready to Execute'").bind(plan.execution.id, plan.execution.startedAt, plan.batch.id));
  statements.push(
    db.prepare(
      `INSERT OR IGNORE INTO paper_order_executions (
        id, batch_id, portfolio_id, proposal_id, proposal_version, status,
        order_count, total_gross_amount_usd, total_fees_usd, total_net_amount_usd,
        cash_before_usd, cash_after_usd, portfolio_value_after_usd,
        total_account_value_after_usd, slippage_pct, validation_report_json,
        failure_reason, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      plan.execution.id,
      plan.execution.batchId,
      plan.execution.portfolioId,
      plan.execution.proposalId,
      plan.execution.proposalVersion,
      "Filled",
      plan.execution.orderCount,
      plan.execution.totalGrossAmountUsd,
      plan.execution.totalFeesUsd,
      plan.execution.totalNetAmountUsd,
      plan.execution.cashBeforeUsd,
      plan.execution.cashAfterUsd,
      plan.execution.portfolioValueAfterUsd,
      plan.execution.totalAccountValueAfterUsd,
      plan.execution.slippagePct,
      JSON.stringify(plan.execution.validationReport),
      null,
      plan.execution.startedAt,
      plan.execution.completedAt
    )
  );

  for (const fill of plan.execution.fills) {
    const before = runningCash;
    runningCash = subtractMoney(runningCash, fill.netAmountUsd);
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO orders (
          id, portfolio_id, symbol, asset_class, side, order_type, quantity,
          status, paper_only, risk_checked, explanation, signal_key,
          estimated_fee_usd, fill_price_usd, idempotency_key
        ) VALUES (?, ?, ?, ?, 'BUY', 'market', ?, 'filled', 1, 1, ?, ?, ?, ?, ?)`
      ).bind(
        fill.executionOrderId,
        fill.portfolioId,
        fill.symbol,
        fill.assetClass,
        fill.quantity,
        fill.rationale,
        `paper_batch:${fill.batchId}:${fill.symbol}`,
        fill.simulatedFeesUsd,
        fill.fillPriceUsd,
        `paper-batch:${fill.batchId}:${fill.symbol}`
      )
    );
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO trades (
          id, order_id, portfolio_id, symbol, asset_class, side,
          quantity, price_usd, fees_usd, paper_only, signal_key, executed_at
        ) VALUES (?, ?, ?, ?, ?, 'BUY', ?, ?, ?, 1, ?, ?)`
      ).bind(fill.tradeId, fill.executionOrderId, fill.portfolioId, fill.symbol, fill.assetClass, fill.quantity, fill.fillPriceUsd, fill.simulatedFeesUsd, `paper_batch:${fill.batchId}:${fill.symbol}`, fill.filledAt)
    );
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO paper_order_fills (
          id, execution_id, batch_id, staged_order_id, execution_order_id, trade_id,
          portfolio_id, proposal_id, proposal_version, symbol, asset_class, side, quantity,
          reference_price_usd, fill_price_usd, slippage_amount_usd, slippage_pct,
          gross_amount_usd, simulated_fees_usd, net_amount_usd, market_data_timestamp,
          rationale, confidence_score, policy_validation_json, status, filled_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Buy', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Filled', ?)`
      ).bind(
        fill.id,
        fill.executionId,
        fill.batchId,
        fill.stagedOrderId,
        fill.executionOrderId,
        fill.tradeId,
        fill.portfolioId,
        fill.proposalId,
        fill.proposalVersion,
        fill.symbol,
        fill.assetClass,
        fill.quantity,
        fill.referencePriceUsd,
        fill.fillPriceUsd,
        fill.slippageAmountUsd,
        fill.slippagePct,
        fill.grossAmountUsd,
        fill.simulatedFeesUsd,
        fill.netAmountUsd,
        fill.marketDataTimestamp,
        fill.rationale,
        fill.confidenceScore,
        JSON.stringify(fill.policyValidation),
        fill.filledAt
      )
    );
    statements.push(
      db.prepare(
        `UPDATE paper_order_batch_orders SET status = 'Filled', fill_price_usd = ?,
          gross_amount_usd = ?, simulated_fees_usd = ?, net_amount_usd = ?,
          slippage_amount_usd = ?, slippage_pct = ?, filled_at = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).bind(fill.fillPriceUsd, fill.grossAmountUsd, fill.simulatedFeesUsd, fill.netAmountUsd, fill.slippageAmountUsd, fill.slippagePct, fill.filledAt, fill.stagedOrderId)
    );
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO paper_cash_ledger (
          id, portfolio_id, execution_id, batch_id, fill_id, transaction_type,
          amount_usd, cash_before_usd, cash_after_usd, description, created_at
        ) VALUES (?, ?, ?, ?, ?, 'paper_buy', ?, ?, ?, ?, ?)`
      ).bind(`cash_${fill.id}`, fill.portfolioId, fill.executionId, fill.batchId, fill.id, -fill.netAmountUsd, before, runningCash, `Simulated paper buy for ${fill.symbol}.`, fill.filledAt)
    );
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO portfolio_transactions (
          id, portfolio_id, execution_id, batch_id, fill_id, symbol,
          transaction_type, quantity, price_usd, gross_amount_usd, fees_usd,
          net_amount_usd, description, transaction_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'paper_buy_fill', ?, ?, ?, ?, ?, ?, ?)`
      ).bind(`txn_${fill.id}`, fill.portfolioId, fill.executionId, fill.batchId, fill.id, fill.symbol, fill.quantity, fill.fillPriceUsd, fill.grossAmountUsd, fill.simulatedFeesUsd, -fill.netAmountUsd, `Simulated paper fill for ${fill.symbol}.`, fill.filledAt)
    );
  }

  for (const position of plan.positionsAfter.filter((position) => plan.execution.fills.some((fill) => fill.symbol === position.symbol))) {
    statements.push(
      db.prepare(
        `INSERT INTO positions (
          id, portfolio_id, symbol, asset_class, quantity,
          avg_entry_price_usd, current_price_usd, market_value_usd, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          quantity = excluded.quantity,
          avg_entry_price_usd = excluded.avg_entry_price_usd,
          current_price_usd = excluded.current_price_usd,
          market_value_usd = excluded.market_value_usd,
          updated_at = datetime('now')`
      ).bind(position.id, plan.batch.portfolioId, position.symbol, position.assetClass, position.quantity, position.avgEntryPriceUsd, position.currentPriceUsd, position.marketValueUsd)
    );
  }

  statements.push(db.prepare("UPDATE portfolios SET cash_usd = ?, updated_at = datetime('now') WHERE id = ? AND cash_usd >= ?").bind(plan.execution.cashAfterUsd, plan.batch.portfolioId, plan.execution.totalNetAmountUsd));
  statements.push(db.prepare("UPDATE paper_order_batches SET status = 'Filled', filled_at = ?, updated_at = datetime('now') WHERE id = ?").bind(plan.execution.completedAt, plan.batch.id));
  statements.push(db.prepare("UPDATE allocation_proposals SET status = 'executed', updated_at = datetime('now') WHERE id = ?").bind(plan.batch.proposalId));
  statements.push(db.prepare("INSERT OR IGNORE INTO paper_order_batch_events (id, batch_id, portfolio_id, proposal_id, event_type, message, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(`${plan.batch.id}_execution_started`, plan.batch.id, plan.batch.portfolioId, plan.batch.proposalId, "execution_started", "Paper order batch execution started.", JSON.stringify({ paperOnly: true, simulated: true }), plan.execution.startedAt));
  for (const fill of plan.execution.fills) {
    statements.push(db.prepare("INSERT OR IGNORE INTO paper_order_batch_events (id, batch_id, portfolio_id, proposal_id, event_type, message, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(`${fill.id}_filled`, fill.batchId, fill.portfolioId, fill.proposalId, "order_filled", `${fill.symbol} paper order filled.`, JSON.stringify({ fillPriceUsd: fill.fillPriceUsd, quantity: fill.quantity }), fill.filledAt));
  }
  statements.push(db.prepare("INSERT OR IGNORE INTO paper_order_batch_events (id, batch_id, portfolio_id, proposal_id, event_type, message, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(`${plan.batch.id}_allocation_completed`, plan.batch.id, plan.batch.portfolioId, plan.batch.proposalId, "portfolio_allocation_completed", "Initial IRA paper portfolio allocation completed.", JSON.stringify({ cashRemainingUsd: plan.execution.cashAfterUsd }), plan.execution.completedAt));

  await db.batch(statements);
}

async function markExecutionValidationFailure(
  db: D1Database,
  batch: PaperOrderBatch,
  validation: ExecutionValidationReport,
  status: "Failed" | "Pending Review",
  nowIso: string
): Promise<void> {
  await db.batch([
    db.prepare("UPDATE paper_order_batches SET status = ?, failure_reason = ?, updated_at = datetime('now') WHERE id = ?").bind(status, validation.reasons.join(" "), batch.id),
    db.prepare("INSERT OR IGNORE INTO paper_order_batch_events (id, batch_id, portfolio_id, proposal_id, event_type, message, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(`${batch.id}_execution_validation_failed_${nowIso.replace(/[^0-9A-Za-z]/g, "")}`, batch.id, batch.portfolioId, batch.proposalId, "execution_validation_failed", "Paper order batch execution validation failed.", JSON.stringify(validation), nowIso)
  ]);
}

async function recordPostExecutionArtifacts(db: D1Database, portfolioId: string, now: Date): Promise<void> {
  await ensureDailyStartSnapshot(db, portfolioId, now);
  const valuation = await getPortfolioValuation(db, portfolioId, now);
  await recordValuationSnapshot(db, valuation);
  await completeDailySnapshot(db, portfolioId, now);
  await recordEquityHistory(db, now.toISOString(), portfolioId);
  await recordJourneyEvent(db, {
    portfolioId,
    eventType: "trade_opened",
    timestamp: now.toISOString(),
    title: "Initial IRA portfolio established",
    description: "Simulated paper allocation orders filled. This was not a live brokerage execution.",
    accountValueUsd: valuation.totalAccountValueUsd,
    portfolioValueUsd: valuation.portfolioValueUsd,
    cashValueUsd: valuation.cashUsd,
    source: "manual",
    metadata: { paperOnly: true, simulated: true }
  });
}

async function hydrateExecution(db: D1Database, row: ExecutionRow): Promise<PaperExecutionRecord> {
  const fills = await listRows<FillRow>(
    db.prepare(
      `SELECT id, execution_id AS executionId, batch_id AS batchId, staged_order_id AS stagedOrderId,
        execution_order_id AS executionOrderId, trade_id AS tradeId, portfolio_id AS portfolioId,
        proposal_id AS proposalId, proposal_version AS proposalVersion, symbol,
        asset_class AS assetClass,
        side, quantity, reference_price_usd AS referencePriceUsd, fill_price_usd AS fillPriceUsd,
        slippage_amount_usd AS slippageAmountUsd, slippage_pct AS slippagePct,
        gross_amount_usd AS grossAmountUsd, simulated_fees_usd AS simulatedFeesUsd,
        net_amount_usd AS netAmountUsd, market_data_timestamp AS marketDataTimestamp,
        rationale, confidence_score AS confidenceScore, policy_validation_json AS policyValidationJson,
        filled_at AS filledAt
       FROM paper_order_fills
       WHERE batch_id = ?
       ORDER BY filled_at ASC, symbol ASC`
    ).bind(row.batchId)
  );
  return {
    id: row.id,
    batchId: row.batchId,
    portfolioId: row.portfolioId,
    proposalId: row.proposalId,
    proposalVersion: row.proposalVersion,
    status: row.status,
    orderCount: row.orderCount,
    totalGrossAmountUsd: row.totalGrossAmountUsd,
    totalFeesUsd: row.totalFeesUsd,
    totalNetAmountUsd: row.totalNetAmountUsd,
    cashBeforeUsd: row.cashBeforeUsd,
    cashAfterUsd: row.cashAfterUsd,
    portfolioValueAfterUsd: row.portfolioValueAfterUsd,
    totalAccountValueAfterUsd: row.totalAccountValueAfterUsd,
    slippagePct: row.slippagePct,
    validationReport: parseJsonObject<ExecutionValidationReport>(row.validationReportJson, okReport()),
    failureReason: row.failureReason,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    fills: fills.map((fill) => ({
      id: fill.id,
      executionId: fill.executionId,
      batchId: fill.batchId,
      stagedOrderId: fill.stagedOrderId,
      executionOrderId: fill.executionOrderId,
      tradeId: fill.tradeId,
      portfolioId: fill.portfolioId,
      proposalId: fill.proposalId,
      proposalVersion: fill.proposalVersion,
      symbol: fill.symbol,
      assetClass: fill.assetClass,
      side: fill.side,
      quantity: fill.quantity,
      referencePriceUsd: fill.referencePriceUsd,
      fillPriceUsd: fill.fillPriceUsd,
      slippageAmountUsd: fill.slippageAmountUsd,
      slippagePct: fill.slippagePct,
      grossAmountUsd: fill.grossAmountUsd,
      simulatedFeesUsd: fill.simulatedFeesUsd,
      netAmountUsd: fill.netAmountUsd,
      marketDataTimestamp: fill.marketDataTimestamp,
      rationale: fill.rationale,
      confidenceScore: fill.confidenceScore,
      policyValidation: parseJsonObject<InvestmentPolicyValidationResult>(fill.policyValidationJson, { allowed: false, reasons: [] }),
      filledAt: fill.filledAt
    }))
  };
}

async function getPortfolio(db: D1Database, portfolioId: string): Promise<PortfolioRow | null> {
  return db.prepare("SELECT id, cash_usd AS cashUsd, starting_balance_usd AS startingBalanceUsd, mode, broker_account_id AS brokerAccountId FROM portfolios WHERE id = ?").bind(portfolioId).first<PortfolioRow>();
}

async function getPositions(db: D1Database, portfolioId: string): Promise<PositionRow[]> {
  return listRows(db.prepare("SELECT id, symbol, asset_class AS assetClass, quantity, avg_entry_price_usd AS avgEntryPriceUsd, current_price_usd AS currentPriceUsd, market_value_usd AS marketValueUsd FROM positions WHERE portfolio_id = ? AND quantity > 0").bind(portfolioId));
}

async function getAssetMetadata(db: D1Database, symbols: string[]): Promise<AssetMetadata[]> {
  const unique = [...new Set(symbols)];
  if (unique.length === 0) {
    return [];
  }
  const placeholders = unique.map(() => "?").join(", ");
  return (await listRows<{ symbol: string; assetClass: AssetClass; fractionalSupported: number; quantityPrecision: number }>(
    db.prepare(`SELECT symbol, asset_type AS assetClass, fractional_supported AS fractionalSupported, quantity_precision AS quantityPrecision FROM assets WHERE symbol IN (${placeholders})`).bind(...unique)
  )).map((row) => ({ ...row, fractionalSupported: row.fractionalSupported === 1 }));
}

async function getLatestPrices(db: D1Database, symbols: string[], now: Date): Promise<LatestPrice[]> {
  const prices: LatestPrice[] = [];
  const snapshot = await new MarketDataService(db).createSnapshot(symbols, "paper_execution", now);
  for (const [symbol, quote] of snapshot.quotes) {
    if (quote.validation.valid && quote.lastPrice && quote.providerTimestamp && isFreshPrice(quote.providerTimestamp, now.getTime())) {
      prices.push({ symbol, priceUsd: quote.lastPrice, priceTimestamp: quote.providerTimestamp });
    }
  }
  for (const symbol of [...new Set(symbols)]) {
    if (prices.some((price) => price.symbol === symbol)) {
      continue;
    }
  }
  return prices;
}

function executionId(batchId: string): string {
  return `paper_exec_${batchId}`.slice(0, 180);
}

function isFreshPrice(timestamp: string, nowMs: number): boolean {
  const priceMs = new Date(timestamp).getTime();
  return Number.isFinite(priceMs) && priceMs <= nowMs + 5 * 60 * 1000 && nowMs - priceMs <= PRICE_FRESHNESS_MS;
}

function okReport(): ExecutionValidationReport {
  return { compliant: true, reasons: [], warnings: [], requiresReview: false };
}

function parseJsonObject<T>(value: string, fallback: T): T {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as T : fallback;
  } catch {
    return fallback;
  }
}

function roundQuantity(value: number, precision: number): number {
  const factor = 10 ** Math.max(0, Math.min(12, precision));
  return Math.round(value * factor) / factor;
}
