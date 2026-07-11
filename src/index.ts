export interface Env {
  APP_MODE: "paper";
  STARTING_BALANCE_USD: string;
  BENCHMARK_ASSET: string;
}

type RecommendationAction = "BUY" | "HOLD" | "SELL" | "DO_NOTHING";

interface Recommendation {
  asset: string;
  action: RecommendationAction;
  confidence: number;
  reasons: string[];
  createdAt: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/status") {
      return json({
        app: "CryptoLab AI",
        version: "0.1.0",
        mode: env.APP_MODE,
        startingBalanceUsd: Number(env.STARTING_BALANCE_USD),
        benchmarkAsset: env.BENCHMARK_ASSET,
        automaticTradingEnabled: false,
        message: "Paper-trading scaffold is online. No exchange is connected."
      });
    }

    if (url.pathname === "/recommendation") {
      const recommendation: Recommendation = {
        asset: env.BENCHMARK_ASSET,
        action: "DO_NOTHING",
        confidence: 100,
        reasons: [
          "No live market-data source is connected yet.",
          "The MVP defaults to no trade when evidence is unavailable."
        ],
        createdAt: new Date().toISOString()
      };

      return json(recommendation);
    }

    return json({ error: "Not found" }, 404);
  }
} satisfies ExportedHandler<Env>;
