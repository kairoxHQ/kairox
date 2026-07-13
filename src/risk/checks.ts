import type { DecisionAction, MarketDataset, MarketPrice } from "../shared/types.ts";
import { validateInvestmentPolicy, type InvestmentPolicy, type OrderIntent } from "../policies/investmentPolicy.ts";

export interface RiskAssessment {
  allowed: boolean;
  riskScore: number;
  reasons: string[];
}

export interface PaperRiskInput {
  action: DecisionAction;
  marketData: MarketDataset;
  portfolioValueUsd: number;
  cashUsd: number;
  currentPositionValueUsd: number;
  proposedTradeValueUsd: number;
  drawdownPct: number;
  duplicateSignal: boolean;
  openedNewPositionThisRun: boolean;
  hasPosition: boolean;
  maxNewTradePct?: number;
  maxPositionPct?: number;
  drawdownBlockPct?: number;
  investmentPolicy?: InvestmentPolicy | null;
  orderIntent?: OrderIntent;
  securityTags?: string[];
  resultingSectorValueUsd?: number | null;
}

export function assessRecommendation(action: DecisionAction, marketData: MarketPrice): RiskAssessment {
  const reasons: string[] = [
    "Live trading is disabled.",
    "Leverage, options, futures, and margin are disabled."
  ];

  if (!marketData.validated) {
    reasons.push("Market data is not validated, so BUY and SELL actions are blocked.");
  }

  const allowed = action === "HOLD" || action === "DO_NOTHING";

  return {
    allowed,
    riskScore: allowed ? 0.05 : 0.8,
    reasons
  };
}

export function assessPaperTrade(input: PaperRiskInput): RiskAssessment {
  const reasons = [
    "Live trading is disabled.",
    "Broker execution is disabled.",
    "Leverage and short selling are disabled."
  ];

  if (input.action === "HOLD" || input.action === "DO_NOTHING") {
    return { allowed: true, riskScore: 0.05, reasons: [...reasons, "No paper execution requested."] };
  }

  if (!input.marketData.validated) {
    reasons.push("Market data is unavailable, stale, or malformed.");
  }

  if (input.duplicateSignal) {
    reasons.push("This signal has already been processed.");
  }

  const maxNewTradePct = input.maxNewTradePct ?? 0.1;
  const maxPositionPct = input.maxPositionPct ?? 0.5;
  const drawdownBlockPct = input.drawdownBlockPct ?? 0.1;

  if (input.drawdownPct >= drawdownBlockPct && input.action === "BUY") {
    reasons.push(`Portfolio drawdown is at or above ${Math.round(drawdownBlockPct * 100)}%; new positions are blocked.`);
  }

  if (input.action === "BUY") {
    if (input.openedNewPositionThisRun && !input.hasPosition) {
      reasons.push("Maximum one new position per strategy run has already been reached.");
    }

    if (input.proposedTradeValueUsd > input.portfolioValueUsd * maxNewTradePct) {
      reasons.push(`Proposed new paper trade risks more than ${Math.round(maxNewTradePct * 100)}% of portfolio value.`);
    }

    if (input.currentPositionValueUsd + input.proposedTradeValueUsd > input.portfolioValueUsd * maxPositionPct) {
      reasons.push(`Proposed position would exceed ${Math.round(maxPositionPct * 100)}% of portfolio value.`);
    }

    if (input.proposedTradeValueUsd > input.cashUsd) {
      reasons.push("Not enough paper cash for the proposed buy.");
    }
  }

  if (input.action === "SELL" && input.currentPositionValueUsd <= 0) {
    reasons.push("Cannot sell without an existing long paper position.");
  }

  const policyAssessment = validateInvestmentPolicy({
    policy: input.investmentPolicy ?? null,
    action: input.action,
    orderIntent: input.orderIntent,
    symbol: input.marketData.symbol,
    assetClass: input.marketData.assetClass,
    portfolioValueUsd: input.portfolioValueUsd,
    cashUsd: input.cashUsd,
    currentPositionValueUsd: input.currentPositionValueUsd,
    proposedTradeValueUsd: input.proposedTradeValueUsd,
    resultingSectorValueUsd: input.resultingSectorValueUsd,
    securityTags: input.securityTags
  });
  reasons.push(...policyAssessment.reasons);

  const allowed = reasons.length === 3;
  return {
    allowed,
    riskScore: allowed ? 0.3 : 0.9,
    reasons
  };
}
