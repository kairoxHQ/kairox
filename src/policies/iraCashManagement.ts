import type { AssetRegistryRecord } from "../market/assets.ts";
import type { MarketDataset } from "../shared/types.ts";

export interface IraCashManagementParameters {
  enabled: boolean;
  minOperationalCashReserveUsd: number;
  minOperationalCashReservePct: number;
  targetOperationalCashReservePct: number;
  maxUnallocatedCashPct: number;
  minimumDeploymentUsd: number;
  minimumRebalanceUsd: number;
  dailyDeploymentLimitPctOfExcess: number;
  dailyDeploymentLimitUsd: number | null;
  reviewCadence: "trading_day";
  conservativeAllowlist: IraConservativeAssetConfig[];
}

export interface IraConservativeAssetConfig {
  symbol: string;
  category: IraConservativeCategory;
  targetAllocationPct: number;
  priority: number;
}

export type IraConservativeCategory =
  | "treasury_bill_etf"
  | "ultra_short_treasury_etf"
  | "government_money_market"
  | "short_term_treasury_fund"
  | "short_duration_investment_grade_bond"
  | "broad_bond_market_etf";

export interface IraCashManagementInput {
  portfolioId: string;
  cashUsd: number;
  totalValueUsd: number;
  existingPositionValueUsd: number;
  asset: AssetRegistryRecord | null;
  marketData: MarketDataset | null;
  hasOrdinaryExecution: boolean;
  tradedTargetToday: boolean;
  maxNewTradePct: number;
  currentPositionLimitPct: number;
  feeRate: number;
  slippageBps: number;
  now: Date;
  parameters?: Partial<IraCashManagementParameters> | null;
}

export interface IraCashManagementDecision {
  action: "BUY" | "DO_NOTHING";
  reason: string;
  targetSymbol: string | null;
  targetCategory: IraConservativeCategory | null;
  targetAllocationPct: number | null;
  cashBeforeUsd: number;
  requiredReserveUsd: number;
  targetReserveUsd: number;
  deployableExcessCashUsd: number;
  maxNewTradeUsd: number;
  proposedDeploymentUsd: number;
  feeUsd: number;
  slippageUsd: number;
  decisionPriceUsd: number | null;
  quoteSource: string | null;
  quoteTimestamp: string | null;
  quoteFreshness: "fresh" | "stale" | "invalid" | "missing";
  confidenceScore: number;
  riskScore: number;
}

export const DEFAULT_IRA_CASH_MANAGEMENT: IraCashManagementParameters = {
  enabled: true,
  minOperationalCashReserveUsd: 100,
  minOperationalCashReservePct: 0.05,
  targetOperationalCashReservePct: 0.075,
  maxUnallocatedCashPct: 0.125,
  minimumDeploymentUsd: 25,
  minimumRebalanceUsd: 25,
  dailyDeploymentLimitPctOfExcess: 0.25,
  dailyDeploymentLimitUsd: null,
  reviewCadence: "trading_day",
  conservativeAllowlist: [
    {
      symbol: "BND",
      category: "broad_bond_market_etf",
      targetAllocationPct: 0.2,
      priority: 10
    }
  ]
};

const PROHIBITED_SYMBOL_PATTERN = /(2X|3X|ULTRA|LEVERAGED|INVERSE|SHORT|BEAR|BULL|OPTION|FUTURE|MARGIN|CRYPTO|HIGH.?YIELD|JUNK)/i;

export function resolveIraCashManagementParameters(input?: Partial<IraCashManagementParameters> | null): IraCashManagementParameters {
  return {
    ...DEFAULT_IRA_CASH_MANAGEMENT,
    ...(input ?? {}),
    conservativeAllowlist: sanitizeAllowlist(input?.conservativeAllowlist ?? DEFAULT_IRA_CASH_MANAGEMENT.conservativeAllowlist)
  };
}

export function evaluateIraCashManagement(input: IraCashManagementInput): IraCashManagementDecision {
  const parameters = resolveIraCashManagementParameters(input.parameters);
  const cashBeforeUsd = roundMoney(input.cashUsd);
  const totalValueUsd = Math.max(0, input.totalValueUsd);
  const requiredReserveUsd = roundMoney(Math.max(parameters.minOperationalCashReserveUsd, totalValueUsd * parameters.minOperationalCashReservePct));
  const targetReserveUsd = roundMoney(Math.max(requiredReserveUsd, totalValueUsd * parameters.targetOperationalCashReservePct));
  const maxUnallocatedCashUsd = roundMoney(totalValueUsd * parameters.maxUnallocatedCashPct);
  const deployableExcessCashUsd = roundMoney(Math.max(0, cashBeforeUsd - targetReserveUsd));
  const base = {
    targetSymbol: null,
    targetCategory: null,
    targetAllocationPct: null,
    cashBeforeUsd,
    requiredReserveUsd,
    targetReserveUsd,
    deployableExcessCashUsd,
    maxNewTradeUsd: roundMoneyDown(Math.max(0, totalValueUsd * input.maxNewTradePct)),
    proposedDeploymentUsd: 0,
    feeUsd: 0,
    slippageUsd: 0,
    decisionPriceUsd: input.marketData?.priceUsd ?? null,
    quoteSource: input.marketData?.source ?? null,
    quoteTimestamp: input.marketData?.asOf ?? null,
    quoteFreshness: quoteFreshness(input.marketData),
    confidenceScore: 0.9,
    riskScore: 0.05
  } satisfies Omit<IraCashManagementDecision, "action" | "reason">;

  if (!parameters.enabled || input.portfolioId !== "portfolio_ira") {
    return { ...base, action: "DO_NOTHING", reason: "IRA cash-management policy is not enabled for this portfolio." };
  }

  if (cashBeforeUsd <= maxUnallocatedCashUsd) {
    return { ...base, action: "DO_NOTHING", reason: "Maintain operational IRA cash reserve; unallocated cash is within policy limits." };
  }

  if (input.hasOrdinaryExecution) {
    return { ...base, action: "DO_NOTHING", reason: "Reallocate from cash only after higher-priority retirement strategy actions are complete." };
  }

  if (deployableExcessCashUsd < parameters.minimumDeploymentUsd || deployableExcessCashUsd < parameters.minimumRebalanceUsd) {
    return { ...base, action: "DO_NOTHING", reason: "Defer cash deployment because deployable amount is below minimum." };
  }

  const assetConfig = selectAllowlistedAsset(parameters, input.asset);
  if (!assetConfig || !input.asset) {
    return { ...base, action: "DO_NOTHING", reason: "Defer cash deployment because no supported allowlisted conservative IRA asset is available." };
  }

  const targetFields = {
    targetSymbol: assetConfig.symbol,
    targetCategory: assetConfig.category,
    targetAllocationPct: assetConfig.targetAllocationPct
  };

  if (input.tradedTargetToday) {
    return { ...base, ...targetFields, action: "DO_NOTHING", reason: "Defer cash deployment because the target asset already traded today; avoiding same-day cash-equivalent churn." };
  }

  if (!input.marketData || !input.marketData.validated || input.marketData.stale || input.marketData.quality === "stale" || input.marketData.quality === "invalid" || input.marketData.priceUsd <= 0) {
    return { ...base, ...targetFields, action: "DO_NOTHING", reason: "Defer cash deployment because quote is stale or invalid." };
  }

  const positionLimitUsd = roundMoneyDown(Math.max(0, totalValueUsd * Math.min(input.currentPositionLimitPct, assetConfig.targetAllocationPct) - input.existingPositionValueUsd));
  const dailyLimitUsd = roundMoneyDown(deploymentDailyLimit(parameters, deployableExcessCashUsd));
  const rawNewTradeLimitUsd = Math.max(0, totalValueUsd * input.maxNewTradePct);
  const proposedDeploymentUsd = sizeTradeDownToCap(
    Math.min(deployableExcessCashUsd, positionLimitUsd, dailyLimitUsd, rawNewTradeLimitUsd, cashBeforeUsd - requiredReserveUsd),
    rawNewTradeLimitUsd
  );

  if (proposedDeploymentUsd < parameters.minimumDeploymentUsd) {
    return { ...base, ...targetFields, action: "DO_NOTHING", reason: "Defer cash deployment because deployable amount is below minimum after reserve, allocation, and daily limits." };
  }

  const feeUsd = roundMoney(Math.max(0.01, proposedDeploymentUsd * input.feeRate));
  const slippageUsd = roundMoney(proposedDeploymentUsd * Math.max(0, input.slippageBps) / 10000);
  if (proposedDeploymentUsd + feeUsd > cashBeforeUsd - requiredReserveUsd + 0.0001) {
    return { ...base, ...targetFields, action: "DO_NOTHING", reason: "Defer cash deployment because purchase would exceed available cash after reserve and fees." };
  }

  return {
    ...base,
    ...targetFields,
    action: "BUY",
    reason: assetConfig.category === "broad_bond_market_etf"
      ? "Deploy excess IRA cash to approved conservative bond ETF."
      : "Deploy excess IRA cash to approved Treasury cash equivalent.",
    maxNewTradeUsd: roundMoneyDown(rawNewTradeLimitUsd),
    proposedDeploymentUsd,
    feeUsd,
    slippageUsd,
    riskScore: 0.2
  };
}

function selectAllowlistedAsset(parameters: IraCashManagementParameters, asset: AssetRegistryRecord | null): IraConservativeAssetConfig | null {
  if (!asset || !asset.enabled || !asset.tradable || asset.market !== "US" || asset.currency !== "USD") {
    return null;
  }
  if (asset.assetType !== "bond_fund" && asset.assetType !== "etf" && asset.assetType !== "money_market") {
    return null;
  }
  if (PROHIBITED_SYMBOL_PATTERN.test(`${asset.symbol} ${asset.displayName} ${asset.notes ?? ""}`)) {
    return null;
  }
  return parameters.conservativeAllowlist
    .filter((candidate) => candidate.symbol === asset.symbol)
    .sort((left, right) => left.priority - right.priority)[0] ?? null;
}

function sanitizeAllowlist(allowlist: IraConservativeAssetConfig[]): IraConservativeAssetConfig[] {
  return allowlist
    .filter((item) => item.symbol && item.targetAllocationPct > 0 && item.priority >= 0)
    .map((item) => ({
      ...item,
      symbol: item.symbol.toUpperCase(),
      targetAllocationPct: Math.min(1, Math.max(0, item.targetAllocationPct))
    }))
    .sort((left, right) => left.priority - right.priority);
}

function deploymentDailyLimit(parameters: IraCashManagementParameters, deployableExcessCashUsd: number): number {
  const pctLimit = deployableExcessCashUsd * parameters.dailyDeploymentLimitPctOfExcess;
  return parameters.dailyDeploymentLimitUsd === null ? pctLimit : Math.min(pctLimit, parameters.dailyDeploymentLimitUsd);
}

export function sizeTradeDownToCap(candidateUsd: number, rawCapUsd: number): number {
  const clamped = Math.min(Math.max(0, candidateUsd), Math.max(0, rawCapUsd));
  const rounded = roundMoneyDown(clamped);
  return rounded <= rawCapUsd ? rounded : roundMoneyDown(rawCapUsd);
}

function roundMoney(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function roundMoneyDown(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.floor(Math.max(0, value) * 10000) / 10000;
}

function quoteFreshness(marketData: MarketDataset | null): IraCashManagementDecision["quoteFreshness"] {
  if (!marketData) return "missing";
  if (!marketData.validated || marketData.priceUsd <= 0 || marketData.quality === "invalid") return "invalid";
  if (marketData.stale || marketData.quality === "stale") return "stale";
  return "fresh";
}
