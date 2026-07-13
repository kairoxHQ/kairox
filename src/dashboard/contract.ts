import { getMarketDataStatuses } from "../market/status.ts";
import { getHistoricalMetrics } from "../portfolio/historicalMetrics.ts";
import { getPortfolioValuation, type PortfolioValuation } from "../portfolio/valuation.ts";
import { TIM_PORTFOLIO_ID } from "../shared/db.ts";
import { sanitizeForUser } from "../shared/messages.ts";
import { calculateIndicators } from "../strategy/indicators.ts";

export async function getDashboardContract(db: D1Database, portfolioId = TIM_PORTFOLIO_ID): Promise<unknown> {
  const [valuation, metrics, latestDecision, statuses] = await Promise.all([
    getPortfolioValuation(db, portfolioId),
    getHistoricalMetrics(db, portfolioId),
    getLatestDecision(db, portfolioId),
    getMarketDataStatuses(db)
  ]);
  const explanation = buildDecisionExplanation(latestDecision);
  return buildDashboardContract({
    valuation,
    metrics,
    explanation,
    marketStatuses: statuses as Array<{ symbol: string; status: string; isFresh: boolean; userMessage: string }>
  });
}

export function buildDashboardContract(input: {
  valuation: PortfolioValuation;
  metrics: unknown[];
  explanation: DecisionExplanation;
  marketStatuses: Array<{ symbol: string; status: string; isFresh: boolean; userMessage: string }>;
}) {
  const latestPosition = input.valuation.positions[0];
  const indicators = input.explanation.supportingIndicators;
  const status = input.valuation.dataStatus === "unavailable" ? "waiting" : input.valuation.dataStatus === "stale" ? "waiting" : "watching";
  const shared = {
    generatedAt: input.valuation.valuationTimestamp,
    portfolioId: input.valuation.portfolioId,
    dataMode: input.valuation.dataMode,
    dataStatus: input.valuation.dataStatus,
    valuation: input.valuation,
    performance: input.metrics,
    explanation: input.explanation
  };

  return {
    shared,
    beginner: {
      marketDirection: inferMarketDirection(input.explanation.action),
      currentAction: input.explanation.action,
      riskLevel: input.explanation.riskFactors.length > 0 ? "Guarded" : "Normal",
      aiConfidence: input.explanation.confidenceScore,
      simpleReason: input.explanation.plainLanguageSummary,
      startingValueToday: input.valuation.totalAccountValueUsd - input.valuation.todayChangeUsd,
      currentValue: input.valuation.totalAccountValueUsd,
      todaysGainOrLoss: input.valuation.todayChangeUsd,
      overallProgress: input.valuation.overallReturnPct,
      currentInvestments: input.valuation.positions.map((position) => position.symbol),
      currentPositionValues: input.valuation.positions.map((position) => ({
        symbol: position.symbol,
        valueUsd: position.currentPositionValueUsd,
        gainLossUsd: position.unrealizedProfitLossUsd
      })),
      kairoxStatus: status
    },
    intermediate: {
      support: latestPosition?.currentMarketPriceUsd ? latestPosition.currentMarketPriceUsd * 0.98 : null,
      resistance: latestPosition?.currentMarketPriceUsd ? latestPosition.currentMarketPriceUsd * 1.02 : null,
      trend: input.explanation.action === "BUY" ? "Improving" : input.explanation.action === "SELL" ? "Weakening" : "Neutral or waiting",
      volume: null,
      rsi: indicators.rsi,
      movingAverages: {
        short: indicators.shortMovingAverage,
        long: indicators.longMovingAverage
      },
      riskRewardRatio: null,
      stopLoss: null,
      profitTarget: null,
      positionSize: latestPosition?.quantity ?? 0,
      explanations: {
        support: "Estimated nearby lower price area from current paper price context.",
        resistance: "Estimated nearby upper price area from current paper price context.",
        trend: "Plain-language interpretation of the latest stored strategy action.",
        rsi: "RSI is a momentum indicator; unavailable means not enough candle data.",
        movingAverages: "Short and long moving averages come from the same decision indicators used by the strategy."
      }
    },
    advanced: {
      candlestickData: input.explanation.raw?.candles ?? [],
      rsi: indicators.rsi,
      macd: null,
      emaValues: {},
      smaValues: {
        short: indicators.shortMovingAverage,
        long: indicators.longMovingAverage
      },
      bollingerBands: null,
      atr: null,
      volume: null,
      orderBook: null,
      entryPrice: latestPosition?.averageCostBasisUsd ?? null,
      stopPrice: null,
      targetPrice: null,
      positionSizingCalculation: {
        quantity: latestPosition?.quantity ?? 0,
        valueUsd: latestPosition?.currentPositionValueUsd ?? 0
      },
      riskRewardRatio: null,
      strategyIdentifier: input.explanation.strategyVersion,
      signalStrength: input.explanation.confidenceScore,
      aiConfidence: input.explanation.confidenceScore,
      rawStrategyReasons: input.explanation.reasonsForWaiting.concat(input.explanation.reasonsForRejectingTrade),
      brokerOrderStatus: "No live broker connected",
      executionPrice: null,
      slippage: null,
      fees: input.valuation.feesUsd,
      marketDataTimestamps: input.valuation.positions.map((position) => ({ symbol: position.symbol, timestamp: position.priceTimestamp })),
      apiHealth: input.marketStatuses.map((market) => ({
        symbol: market.symbol,
        status: market.status,
        message: sanitizeForUser(market.userMessage, "Market data status unavailable.")
      }))
    }
  };
}

export interface DecisionExplanation {
  action: string;
  plainLanguageSummary: string;
  detailedTechnicalExplanation: string;
  supportingIndicators: {
    shortMovingAverage: number | null;
    longMovingAverage: number | null;
    rsi: number | null;
    momentumPct: number | null;
  };
  riskFactors: string[];
  reasonsForEntering: string[];
  reasonsForWaiting: string[];
  reasonsForRejectingTrade: string[];
  confidenceScore: number;
  dataTimestamp: string | null;
  strategyVersion: string;
  generatedBy: "rules" | "ai" | "both";
  certaintyDisclaimer: string;
  raw?: Record<string, unknown>;
}

function buildDecisionExplanation(row: LatestDecisionRow | null): DecisionExplanation {
  const indicators = parseIndicators(row?.indicatorsJson);
  const action = row?.action ?? row?.decision ?? "DO_NOTHING";
  const explanation = sanitizeForUser(row?.explanation ?? "Kairox is waiting because there is not enough validated signal evidence.", "Kairox is waiting.");
  return {
    action,
    plainLanguageSummary: beginnerReason(action, explanation),
    detailedTechnicalExplanation: explanation,
    supportingIndicators: indicators,
    riskFactors: action === "DO_NOTHING" ? [explanation] : [],
    reasonsForEntering: action === "BUY" ? [explanation] : [],
    reasonsForWaiting: action === "HOLD" || action === "DO_NOTHING" ? [explanation] : [],
    reasonsForRejectingTrade: action === "DO_NOTHING" ? [explanation] : [],
    confidenceScore: row?.confidenceScore ?? 0,
    dataTimestamp: row?.priceAsOf ?? row?.createdAt ?? null,
    strategyVersion: "paper-strategy-v1",
    generatedBy: "rules",
    certaintyDisclaimer: "Kairox never guarantees profit or certainty. This is a rules-based paper decision.",
    raw: { signalKey: row?.signalKey ?? null, indicators }
  };
}

interface LatestDecisionRow {
  action: string;
  decision: string | null;
  explanation: string;
  confidenceScore: number;
  priceAsOf: string | null;
  createdAt: string;
  indicatorsJson: string | null;
  signalKey: string | null;
}

async function getLatestDecision(db: D1Database, portfolioId: string): Promise<LatestDecisionRow | null> {
  return db
    .prepare(
      `SELECT r.action, j.decision, r.explanation, r.confidence_score AS confidenceScore,
        r.price_as_of AS priceAsOf, r.created_at AS createdAt,
        r.indicators_json AS indicatorsJson, r.signal_key AS signalKey
       FROM recommendations r
       LEFT JOIN decision_journal j ON j.recommendation_id = r.id
       WHERE r.portfolio_id = ?
       ORDER BY r.created_at DESC
       LIMIT 1`
    )
    .bind(portfolioId)
    .first<LatestDecisionRow>();
}

function parseIndicators(value?: string | null): DecisionExplanation["supportingIndicators"] {
  if (!value) {
    return calculateIndicators([]);
  }
  try {
    return { ...calculateIndicators([]), ...(JSON.parse(value) as Partial<DecisionExplanation["supportingIndicators"]>) };
  } catch {
    return calculateIndicators([]);
  }
}

function beginnerReason(action: string, reason: string): string {
  if (action === "BUY") {
    return `Kairox sees enough validated evidence to open a paper position. ${reason}`;
  }
  if (action === "SELL") {
    return `Kairox sees enough validated evidence to close a paper position. ${reason}`;
  }
  if (action === "HOLD") {
    return `Kairox is keeping the current paper position. ${reason}`;
  }
  return `Kairox is waiting. ${reason}`;
}

function inferMarketDirection(action: string): string {
  if (action === "BUY") {
    return "Constructive";
  }
  if (action === "SELL") {
    return "Cautious";
  }
  return "Mixed or unclear";
}
