import { getBenchmarks } from "./market/benchmarks.ts";
import { getAssets, getWatchlists } from "./market/assets.ts";
import { getPortfolio } from "./portfolio/service.ts";
import { getDashboardData, renderDashboard } from "./dashboard/service.ts";
import { getDiagnostics, getOpportunities, getPerformance, getTrades, runAllPaperProfiles } from "./paper/service.ts";
import { getProfileComparison, listPortfolioProfiles } from "./portfolio/profiles.ts";
import {
  getIntelligenceCategories,
  getIntelligenceEvents,
  getIntelligenceOverview,
  getIntelligenceToday,
  getMarketStory
} from "./intelligence/service.ts";
import { runScheduledPaperStrategy, getScheduledRuns } from "./scheduler/service.ts";
import { getSettings, setAutomationPaused } from "./settings/service.ts";
import { checkDatabase } from "./shared/db.ts";
import { json, notFound } from "./shared/http.ts";
import type { Env } from "./shared/types.ts";
import { getJournal, getRecommendations } from "./journal/service.ts";
import { getMarket } from "./paper/service.ts";
import { getSummaries } from "./summaries/service.ts";

function safetyStatus(env: Env) {
  return {
    appMode: env.APP_MODE,
    paperTradingOnly: true,
    liveTradingEnabled: false,
    liveBrokerageCredentialsRequired: false,
    automaticOrderExecutionEnabled: false,
    leverageEnabled: false,
    optionsExecutionEnabled: false,
    futuresExecutionEnabled: false,
    paidAiApiCallsEnabled: false
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const getRoutes = new Set([
      "/",
      "/health",
      "/status",
      "/portfolio",
      "/recommendations",
      "/journal",
      "/benchmarks",
      "/market",
      "/assets",
      "/watchlists",
      "/opportunities",
      "/profiles",
      "/comparison",
      "/intelligence",
      "/intelligence/today",
      "/intelligence/events",
      "/intelligence/categories",
      "/market-story",
      "/trades",
      "/performance",
      "/dashboard",
      "/dashboard/data",
      "/scheduled-runs",
      "/summaries",
      "/settings"
    ]);

    if (getRoutes.has(url.pathname) && request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }

    const stateChangingRoutes = new Set(["/paper/run", "/settings/pause", "/settings/resume"]);
    const protectedGetRoutes = new Set(["/diagnostics"]);
    if (stateChangingRoutes.has(url.pathname) && request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    try {
      if (stateChangingRoutes.has(url.pathname)) {
        const auth = await authorize(request, env);
        if (auth) {
          return auth;
        }
      }

      if (protectedGetRoutes.has(url.pathname)) {
        if (request.method !== "GET") {
          return json({ error: "Method not allowed" }, 405);
        }
        const auth = await authorize(request, env);
        if (auth) {
          return auth;
        }
      }

      if (url.pathname === "/paper/run") {
        return json(await runAllPaperProfiles(env));
      }

      if (url.pathname === "/settings/pause") {
        return json(await setAutomationPaused(env.DB, true));
      }

      if (url.pathname === "/settings/resume") {
        return json(await setAutomationPaused(env.DB, false));
      }

      if (url.pathname === "/health") {
        return json({
          ok: true,
          app: "Kairox",
          databaseReachable: await checkDatabase(env.DB),
          timestamp: new Date().toISOString()
        });
      }

      if (url.pathname === "/" || url.pathname === "/status") {
        return json({
          app: "Kairox",
          version: "0.1.0",
          user: "Tim",
          startingBalanceUsd: Number(env.STARTING_BALANCE_USD),
          benchmarkAsset: env.BENCHMARK_ASSET,
          principles: [
            "Broker-agnostic adapters only.",
            "Risk checks happen before execution.",
            "Every recommendation and trade is logged.",
            "Doing nothing is a valid decision."
          ],
          safety: safetyStatus(env)
        });
      }

      if (url.pathname === "/portfolio") {
        return json(await getPortfolio(env.DB));
      }

      if (url.pathname === "/recommendations") {
        return json({
          recommendations: await getRecommendations(env.DB),
          policy: {
            defaultAction: "DO_NOTHING",
            explanation: "Recommendations are read from the decision record. New recommendations must be logged before they are returned as recommendations of record."
          }
        });
      }

      if (url.pathname === "/journal") {
        return json({ decisions: await getJournal(env.DB) });
      }

      if (url.pathname === "/benchmarks") {
        return json({
          benchmarks: await getBenchmarks(env.DB),
          supported: ["cash", "bitcoin_buy_and_hold"]
        });
      }

      if (url.pathname === "/market") {
        return json(await getMarket(env.DB));
      }

      if (url.pathname === "/assets") {
        return json(await getAssets(env.DB));
      }

      if (url.pathname === "/watchlists") {
        return json(await getWatchlists(env.DB));
      }

      if (url.pathname === "/opportunities") {
        return json(await getOpportunities(env.DB));
      }

      if (url.pathname === "/profiles") {
        return json({ profiles: await listPortfolioProfiles(env.DB) });
      }

      if (url.pathname === "/comparison") {
        return json(await getProfileComparison(env.DB));
      }

      if (url.pathname === "/intelligence") {
        return json(await getIntelligenceOverview(env.DB));
      }

      if (url.pathname === "/intelligence/today") {
        return json(await getIntelligenceToday(env.DB));
      }

      if (url.pathname === "/intelligence/events") {
        return json(await getIntelligenceEvents(env.DB));
      }

      if (url.pathname === "/intelligence/categories") {
        return json(await getIntelligenceCategories(env.DB));
      }

      if (url.pathname === "/market-story") {
        return json(await getMarketStory(env.DB));
      }

      if (url.pathname === "/trades") {
        return json(await getTrades(env.DB));
      }

      if (url.pathname === "/performance") {
        return json(await getPerformance(env.DB));
      }

      if (url.pathname === "/scheduled-runs") {
        return json(await getScheduledRuns(env.DB));
      }

      if (url.pathname === "/summaries") {
        return json(await getSummaries(env.DB));
      }

      if (url.pathname === "/settings") {
        return json(await getSettings(env.DB));
      }

      if (url.pathname === "/dashboard/data") {
        return json(await getDashboardData(env.DB));
      }

      if (url.pathname === "/dashboard") {
        return renderDashboard(env.DB);
      }

      if (url.pathname === "/diagnostics") {
        return json(await getDiagnostics(env.DB));
      }

      return notFound();
    } catch (error) {
      return json(
        {
          error: "Request failed",
          message: error instanceof Error ? error.message : "Unknown error"
        },
        500
      );
    }
  },

  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(runScheduledPaperStrategy(env, controller.cron, new Date(controller.scheduledTime).toISOString()));
  }
} satisfies ExportedHandler<Env>;

async function authorize(request: Request, env: Env): Promise<Response | null> {
  if (!env.PAPER_RUN_SECRET) {
    return json({ error: "Paper run secret is not configured." }, 503);
  }

  const provided = request.headers.get("x-cryptolab-paper-secret") ?? "";
  if (!(await constantTimeEquals(provided, env.PAPER_RUN_SECRET))) {
    return json({ error: "Unauthorized" }, 401);
  }

  return null;
}

async function constantTimeEquals(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) {
    await crypto.subtle.digest("SHA-256", leftBytes);
    return false;
  }

  const leftDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", leftBytes));
  const rightDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", rightBytes));
  let diff = 0;
  for (let index = 0; index < leftDigest.length; index += 1) {
    diff |= leftDigest[index] ^ rightDigest[index];
  }
  return diff === 0;
}
