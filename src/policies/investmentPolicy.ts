import { listRows } from "../shared/db.ts";
import type { AssetClass, DecisionAction } from "../shared/types.ts";

export type RiskProfileName = "Conservative" | "Moderate" | "High Risk";
export type PolicyStatus = "active" | "inactive";
export type OrderIntent = "long_buy" | "long_sell" | "short_sell" | "margin_buy";

export interface InvestmentPolicy {
  id: string;
  portfolioId: string;
  status: PolicyStatus;
  riskProfile: RiskProfileName;
  primaryObjective: string;
  timeHorizon: string;
  incomeNeed: string;
  liquidityRequirement: string;
  maxDrawdownPct: number;
  minCashAllocationPct: number;
  maxSinglePositionPct: number;
  maxSectorAllocationPct: number;
  allowedAssetTypes: AssetClass[];
  allowedInvestmentTypes: string[];
  prohibitedInvestmentTypes: string[];
  simulationBeganAt: string;
}

interface InvestmentPolicyRow {
  id: string;
  portfolioId: string;
  status: PolicyStatus;
  riskProfile: RiskProfileName;
  primaryObjective: string;
  timeHorizon: string;
  incomeNeed: string;
  liquidityRequirement: string;
  maxDrawdownPct: number;
  minCashAllocationPct: number;
  maxSinglePositionPct: number;
  maxSectorAllocationPct: number;
  allowedAssetTypesJson: string;
  allowedInvestmentTypesJson: string;
  prohibitedInvestmentTypesJson: string;
  simulationBeganAt: string;
}

export interface InvestmentPolicyValidationInput {
  policy: InvestmentPolicy | null;
  action: DecisionAction;
  orderIntent?: OrderIntent;
  symbol: string;
  assetClass: AssetClass;
  portfolioValueUsd: number;
  cashUsd: number;
  currentPositionValueUsd: number;
  proposedTradeValueUsd: number;
  resultingSectorValueUsd?: number | null;
  securityTags?: string[];
}

export interface InvestmentPolicyValidationResult {
  allowed: boolean;
  reasons: string[];
}

const DEFAULT_PROHIBITED_TAGS = [
  "options",
  "margin",
  "leveraged_etf",
  "inverse_etf",
  "crypto",
  "penny_stock",
  "short_selling",
  "futures",
  "concentrated_single_stock"
];

export async function getInvestmentPolicy(db: D1Database, portfolioId: string): Promise<InvestmentPolicy | null> {
  const row = await db
    .prepare(
      `SELECT id, portfolio_id AS portfolioId, status, risk_profile AS riskProfile,
        primary_objective AS primaryObjective, time_horizon AS timeHorizon,
        income_need AS incomeNeed, liquidity_requirement AS liquidityRequirement,
        max_drawdown_pct AS maxDrawdownPct, min_cash_allocation_pct AS minCashAllocationPct,
        max_single_position_pct AS maxSinglePositionPct, max_sector_allocation_pct AS maxSectorAllocationPct,
        allowed_asset_types_json AS allowedAssetTypesJson,
        allowed_investment_types_json AS allowedInvestmentTypesJson,
        prohibited_investment_types_json AS prohibitedInvestmentTypesJson,
        simulation_began_at AS simulationBeganAt
       FROM account_investment_policies
       WHERE portfolio_id = ? AND status = 'active'
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(portfolioId)
    .first<InvestmentPolicyRow>();

  return row ? parseInvestmentPolicy(row) : null;
}

export async function listInvestmentPolicies(db: D1Database): Promise<InvestmentPolicy[]> {
  const rows = await listRows<InvestmentPolicyRow>(
    db.prepare(
      `SELECT id, portfolio_id AS portfolioId, status, risk_profile AS riskProfile,
        primary_objective AS primaryObjective, time_horizon AS timeHorizon,
        income_need AS incomeNeed, liquidity_requirement AS liquidityRequirement,
        max_drawdown_pct AS maxDrawdownPct, min_cash_allocation_pct AS minCashAllocationPct,
        max_single_position_pct AS maxSinglePositionPct, max_sector_allocation_pct AS maxSectorAllocationPct,
        allowed_asset_types_json AS allowedAssetTypesJson,
        allowed_investment_types_json AS allowedInvestmentTypesJson,
        prohibited_investment_types_json AS prohibitedInvestmentTypesJson,
        simulation_began_at AS simulationBeganAt
       FROM account_investment_policies
       WHERE status = 'active'
       ORDER BY portfolio_id ASC`
    )
  );
  return rows.map(parseInvestmentPolicy);
}

export function validateInvestmentPolicy(input: InvestmentPolicyValidationInput): InvestmentPolicyValidationResult {
  if (!input.policy || input.policy.status !== "active") {
    return { allowed: true, reasons: [] };
  }

  const reasons: string[] = [];
  const orderIntent = input.orderIntent ?? (input.action === "SELL" ? "long_sell" : "long_buy");
  const portfolioValue = input.portfolioValueUsd > 0 ? input.portfolioValueUsd : 1;
  const proposedPositionValue = input.currentPositionValueUsd + (input.action === "BUY" ? input.proposedTradeValueUsd : 0);
  const endingCash = input.cashUsd - (input.action === "BUY" ? input.proposedTradeValueUsd : 0);
  const securityTags = new Set([
    ...inferSecurityTags(input.assetClass, input.symbol),
    ...(input.securityTags ?? []).map(normalizePolicyTag)
  ]);

  if (orderIntent === "margin_buy" || securityTags.has("margin")) {
    reasons.push("Policy prohibits margin.");
  }

  if (orderIntent === "short_sell" || securityTags.has("short_selling")) {
    reasons.push("Policy prohibits short selling.");
  }

  if (!input.policy.allowedAssetTypes.includes(input.assetClass)) {
    reasons.push(`${input.assetClass} is not an allowed asset type for this account policy.`);
  }

  for (const tag of input.policy.prohibitedInvestmentTypes.map(normalizePolicyTag)) {
    if (securityTags.has(tag)) {
      reasons.push(`Policy prohibits ${tag.replace(/_/g, " ")}.`);
    }
  }

  if (input.action === "BUY") {
    if (endingCash < portfolioValue * input.policy.minCashAllocationPct) {
      reasons.push(`Order would reduce cash below the ${formatPercent(input.policy.minCashAllocationPct)} minimum cash allocation.`);
    }

    if (proposedPositionValue > portfolioValue * input.policy.maxSinglePositionPct) {
      reasons.push(`Order would exceed the ${formatPercent(input.policy.maxSinglePositionPct)} maximum single-position allocation.`);
    }

    if (
      typeof input.resultingSectorValueUsd === "number" &&
      input.resultingSectorValueUsd > portfolioValue * input.policy.maxSectorAllocationPct
    ) {
      reasons.push(`Order would exceed the ${formatPercent(input.policy.maxSectorAllocationPct)} maximum sector allocation.`);
    }
  }

  return { allowed: reasons.length === 0, reasons };
}

function parseInvestmentPolicy(row: InvestmentPolicyRow): InvestmentPolicy {
  return {
    id: row.id,
    portfolioId: row.portfolioId,
    status: row.status,
    riskProfile: row.riskProfile,
    primaryObjective: row.primaryObjective,
    timeHorizon: row.timeHorizon,
    incomeNeed: row.incomeNeed,
    liquidityRequirement: row.liquidityRequirement,
    maxDrawdownPct: row.maxDrawdownPct,
    minCashAllocationPct: row.minCashAllocationPct,
    maxSinglePositionPct: row.maxSinglePositionPct,
    maxSectorAllocationPct: row.maxSectorAllocationPct,
    allowedAssetTypes: parseJsonArray<AssetClass>(row.allowedAssetTypesJson),
    allowedInvestmentTypes: parseJsonArray<string>(row.allowedInvestmentTypesJson),
    prohibitedInvestmentTypes: parseJsonArray<string>(row.prohibitedInvestmentTypesJson),
    simulationBeganAt: row.simulationBeganAt
  };
}

function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function inferSecurityTags(assetClass: AssetClass, symbol: string): string[] {
  const tags: string[] = [];
  const normalized = symbol.toUpperCase();
  if (assetClass === "crypto") {
    tags.push("crypto");
  }
  if (assetClass === "etf" && /(2X|3X|ULTRA|LEVERAGED|BULL|BEAR)/.test(normalized)) {
    tags.push("leveraged_etf");
  }
  if (assetClass === "etf" && /(INVERSE|SHORT|BEAR)/.test(normalized)) {
    tags.push("inverse_etf");
  }
  return tags;
}

function normalizePolicyTag(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
