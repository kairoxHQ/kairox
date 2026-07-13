import { canExecuteAt } from "../market/hours.ts";
import type { AssetRegistryRecord } from "../market/assets.ts";
import type { MarketDataset } from "../shared/types.ts";
import type { Indicators } from "./indicators.ts";
import type { StrategyDecision } from "./paperStrategy.ts";

export interface ExposureState {
  portfolioValueUsd: number;
  drawdownPct: number;
  symbolExposurePct: number;
  categoryExposurePct: number;
}

export interface ScreenResult {
  symbol: string;
  assetType: string;
  eligible: boolean;
  score: number;
  rank: number | null;
  reason: string;
  dataFreshness: "Fresh" | "Cached" | "Stale" | "Unavailable";
  currentExposurePct: number;
  categoryExposurePct: number;
  marketHoursEligible: boolean;
}

export interface RankedOpportunity {
  asset: AssetRegistryRecord;
  marketData: MarketDataset;
  decision: StrategyDecision;
  screen: ScreenResult;
  positionValueUsd: number;
  hasPosition: boolean;
}

export function screenAsset(input: {
  asset: AssetRegistryRecord;
  marketData: MarketDataset;
  now: Date;
  exposure: ExposureState;
}): ScreenResult {
  const { asset, marketData, now, exposure } = input;
  const marketHours = canExecuteAt(asset.assetType, now, asset.marketHoursMode);
  const reasons: string[] = [];

  if (!asset.enabled) {
    reasons.push("Asset is disabled.");
  }
  if (!asset.tradable) {
    reasons.push("Asset is tracked but not enabled for production paper execution.");
  }
  if (asset.assetType === "mutual_fund") {
    reasons.push("Mutual funds require reliable daily NAV and execution assumptions before production paper trading.");
  }
  if (!marketData.validated || marketData.stale || marketData.priceUsd <= 0) {
    reasons.push(marketData.userMessage ?? marketData.error ?? "Market data is unavailable, stale, or malformed.");
  }
  if (!marketHours.allowed && marketHours.reason) {
    reasons.push(marketHours.reason);
  }
  if (exposure.drawdownPct >= 0.1) {
    reasons.push("Portfolio drawdown is at or above 10%; new positions are blocked.");
  }
  if (exposure.symbolExposurePct >= 0.5) {
    reasons.push("Current position already meets or exceeds the 50% concentration limit.");
  }

  const dataFreshness = freshnessLabel(marketData);
  const base = marketData.validated && !marketData.stale ? 55 : 0;
  const liquidity = typeof marketData.volume === "number" && marketData.volume > 0 ? Math.min(15, Math.log10(marketData.volume + 1) * 2) : 0;
  const freshness = dataFreshness === "Fresh" ? 15 : dataFreshness === "Cached" ? 8 : 0;
  const priority = Math.max(0, 10 - ((asset.rankingPriority ?? 100) / 20));
  const concentrationPenalty = concentrationPenaltyScore(exposure.symbolExposurePct, exposure.categoryExposurePct, asset.assetType);
  const score = clampScore(base + liquidity + freshness + priority - concentrationPenalty);

  return {
    symbol: asset.symbol,
    assetType: asset.assetType,
    eligible: reasons.length === 0,
    score,
    rank: null,
    reason: reasons.length > 0 ? reasons.join(" ") : "Eligible for deterministic strategy evaluation.",
    dataFreshness,
    currentExposurePct: round(exposure.symbolExposurePct),
    categoryExposurePct: round(exposure.categoryExposurePct),
    marketHoursEligible: marketHours.allowed
  };
}

export function rankOpportunities(items: RankedOpportunity[]): RankedOpportunity[] {
  const ranked = items.map((item) => ({
    ...item,
    screen: {
      ...item.screen,
      score: item.screen.eligible ? rankScore(item) : item.screen.score
    }
  }));

  const eligible = ranked
    .filter((item) => item.screen.eligible)
    .sort((left, right) => right.screen.score - left.screen.score || (left.asset.rankingPriority ?? 999) - (right.asset.rankingPriority ?? 999));

  eligible.forEach((item, index) => {
    item.screen.rank = index + 1;
  });

  return ranked.sort((left, right) => {
    const leftRank = left.screen.rank ?? 9999;
    const rightRank = right.screen.rank ?? 9999;
    return leftRank - rightRank || (left.asset.rankingPriority ?? 999) - (right.asset.rankingPriority ?? 999);
  });
}

export function concentrationPenaltyScore(symbolExposurePct: number, categoryExposurePct: number, assetType: string): number {
  const symbolPenalty = symbolExposurePct >= 0.25 ? 18 : symbolExposurePct >= 0.1 ? 9 : 0;
  const categoryThreshold = assetType === "etf" || assetType === "stock" ? 0.35 : 0.5;
  const categoryPenalty = categoryExposurePct >= categoryThreshold ? 12 : categoryExposurePct >= 0.2 ? 6 : 0;
  return symbolPenalty + categoryPenalty;
}

function rankScore(item: RankedOpportunity): number {
  const indicators = item.decision.indicators;
  const signal = indicatorScore(indicators);
  const actionBias = item.decision.action === "BUY" ? 10 : item.decision.action === "HOLD" ? 4 : item.decision.action === "SELL" ? 2 : 0;
  const confidence = item.decision.confidenceScore * 20;
  return clampScore(item.screen.score + signal + actionBias + confidence);
}

function indicatorScore(indicators: Indicators): number {
  let score = 0;
  if (
    indicators.shortMovingAverage !== null &&
    indicators.longMovingAverage !== null &&
    indicators.shortMovingAverage > indicators.longMovingAverage
  ) {
    score += 8;
  }
  if (indicators.momentumPct !== null) {
    score += Math.max(-6, Math.min(8, indicators.momentumPct * 100));
  }
  if (indicators.rsi !== null && indicators.rsi >= 35 && indicators.rsi <= 70) {
    score += 6;
  }
  return score;
}

function freshnessLabel(data: MarketDataset): "Fresh" | "Cached" | "Stale" | "Unavailable" {
  if (!data.validated) {
    return data.stale ? "Stale" : "Unavailable";
  }
  if (data.status === "cached" || data.quality === "acceptable_cached") {
    return "Cached";
  }
  return data.stale ? "Stale" : "Fresh";
}

function clampScore(value: number): number {
  return round(Math.max(0, Math.min(100, value)));
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
