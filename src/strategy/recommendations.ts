import type { MarketDataProvider } from "../market/provider.ts";
import { assessRecommendation } from "../risk/checks.ts";
import { TIM_PORTFOLIO_ID } from "../shared/db.ts";
import type { DecisionAction, Recommendation } from "../shared/types.ts";

export async function buildRecommendation(provider: MarketDataProvider, symbol: string): Promise<Recommendation> {
  const marketData = await provider.getLatestPrice(symbol);
  const action: DecisionAction = marketData.validated ? "HOLD" : "DO_NOTHING";
  const risk = assessRecommendation(action, marketData);
  const createdAt = new Date().toISOString();

  return {
    id: `rec_${Date.now()}`,
    portfolioId: TIM_PORTFOLIO_ID,
    symbol,
    action: risk.allowed ? action : "DO_NOTHING",
    explanation: marketData.validated
      ? "Validated market data is available, but this milestone still avoids trade execution and does not optimize for trade frequency."
      : "Defaulting to DO_NOTHING because no validated market data source is configured for this milestone.",
    confidenceScore: marketData.validated ? 0.55 : 0.95,
    riskScore: risk.riskScore,
    marketData,
    createdAt
  };
}
