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
import { getPortfolioValuation, PortfolioNotFoundError } from "./portfolio/valuation.ts";
import { getLatestDailySnapshots } from "./portfolio/dailySnapshots.ts";
import { getHistoricalMetrics } from "./portfolio/historicalMetrics.ts";
import { getDashboardContract } from "./dashboard/contract.ts";
import { getMilestones } from "./milestones/service.ts";
import { getJourney } from "./journey/service.ts";
import { getDailySummaryData } from "./summaries/service.ts";
import { getAllProfileHoldingQuotes, getHoldingQuotes, getMarketTickerQuotes, getQuotesForSymbols } from "./market/quotes.ts";
import { PerformanceAnalyticsService } from "./analytics/performance.ts";
import {
  approveAllocationProposal,
  generateAllocationProposal,
  listAllocationProposals,
  rejectAllocationProposal
} from "./allocation/proposals.ts";
import {
  cancelPaperOrderBatch,
  getLatestPaperOrderBatch,
  getPaperOrderBatchById,
  markPaperOrderBatchReady,
  refreshPaperOrderBatchPrices,
  rejectPaperOrderBatch,
  stagePaperOrdersForProposal
} from "./orders/staging.ts";
import { executePaperOrderBatch, getPaperExecutionByBatchId } from "./orders/execution.ts";

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

function requestedPortfolioId(url: URL): string | undefined {
  const value = url.searchParams.get("portfolioId") ?? url.searchParams.get("portfolio_id") ?? undefined;
  if (!value) {
    return undefined;
  }
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(value)) {
    throw new RequestError(400, "Invalid portfolio identifier.");
  }
  return value;
}

async function requestedExistingPortfolioId(db: D1Database, url: URL): Promise<string | undefined> {
  const portfolioId = requestedPortfolioId(url);
  if (!portfolioId) {
    return undefined;
  }
  const row = await db.prepare("SELECT id FROM portfolios WHERE id = ?").bind(portfolioId).first<{ id: string }>();
  if (!row) {
    throw new PortfolioNotFoundError(portfolioId);
  }
  return portfolioId;
}

class RequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "RequestError";
    this.status = status;
  }
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
      "/market-ticker",
      "/quotes",
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
      "/dashboard/contract",
      "/allocation-proposals",
      "/paper-order-batches",
      "/valuation",
      "/daily-snapshots",
      "/historical-performance",
      "/daily-summary",
      "/milestones",
      "/journey",
      "/scheduled-runs",
      "/summaries",
      "/settings"
    ]);

    if ((getRoutes.has(url.pathname) || url.pathname.startsWith("/api/analytics")) && request.method !== "GET") {
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
        return json(await getPortfolio(env.DB, await requestedExistingPortfolioId(env.DB, url) ?? undefined));
      }

      if (url.pathname === "/recommendations") {
        return json({
          recommendations: await getRecommendations(env.DB, await requestedExistingPortfolioId(env.DB, url) ?? undefined),
          policy: {
            defaultAction: "DO_NOTHING",
            explanation: "Recommendations are read from the decision record. New recommendations must be logged before they are returned as recommendations of record."
          }
        });
      }

      if (url.pathname === "/journal") {
        return json({ decisions: await getJournal(env.DB, await requestedExistingPortfolioId(env.DB, url) ?? undefined) });
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

      if (url.pathname === "/market-ticker") {
        return json(await getMarketTickerQuotes(env.DB));
      }

      if (url.pathname === "/quotes") {
        return json(await getQuotesForSymbols(env.DB, url.searchParams.get("symbols") ?? ""));
      }

      if (url.pathname === "/assets") {
        return json(await getAssets(env.DB));
      }

      if (url.pathname === "/watchlists") {
        return json(await getWatchlists(env.DB));
      }

      if (url.pathname === "/opportunities") {
        return json(await getOpportunities(env.DB, await requestedExistingPortfolioId(env.DB, url) ?? undefined));
      }

      if (url.pathname === "/profiles") {
        return json({ profiles: await listPortfolioProfiles(env.DB) });
      }

      const holdingsQuoteMatch = url.pathname.match(/^\/profiles\/([A-Za-z0-9_-]+)\/holdings\/quotes$/);
      if (holdingsQuoteMatch) {
        if (request.method !== "GET") {
          return json({ error: "Method not allowed" }, 405);
        }
        return json(await getHoldingQuotes(env.DB, holdingsQuoteMatch[1]));
      }

      if (url.pathname === "/profiles/holdings/quotes") {
        return json(await getAllProfileHoldingQuotes(env.DB));
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
        return json(await getTrades(env.DB, await requestedExistingPortfolioId(env.DB, url) ?? undefined));
      }

      if (url.pathname === "/performance") {
        return json(await getPerformance(env.DB, await requestedExistingPortfolioId(env.DB, url) ?? undefined));
      }

      if (url.pathname === "/allocation-proposals") {
        return json(await listAllocationProposals(env.DB, await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_tim_paper"));
      }

      if (url.pathname === "/paper-order-batches") {
        const batchId = url.searchParams.get("batchId");
        if (batchId) {
          return json(await getPaperOrderBatchById(env.DB, batchId));
        }
        return json({
          batch: await getLatestPaperOrderBatch(env.DB, await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_tim_paper")
        });
      }

      if (url.pathname === "/allocation-proposals/generate") {
        if (request.method !== "POST") {
          return json({ error: "Method not allowed" }, 405);
        }
        const proposal = await generateAllocationProposal(env.DB, await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_tim_paper");
        return proposalActionResponse(request, proposal.portfolioId, proposal);
      }

      const approveProposalMatch = url.pathname.match(/^\/allocation-proposals\/([A-Za-z0-9_-]+)\/approve$/);
      if (approveProposalMatch) {
        if (request.method !== "POST") {
          return json({ error: "Method not allowed" }, 405);
        }
        const proposal = await approveProposalOrConflict(env.DB, approveProposalMatch[1]);
        return proposalActionResponse(request, proposal.portfolioId, proposal);
      }

      const rejectProposalMatch = url.pathname.match(/^\/allocation-proposals\/([A-Za-z0-9_-]+)\/reject$/);
      if (rejectProposalMatch) {
        if (request.method !== "POST") {
          return json({ error: "Method not allowed" }, 405);
        }
        const proposal = await rejectAllocationProposal(env.DB, rejectProposalMatch[1], await proposalRejectionReason(request));
        return proposalActionResponse(request, proposal.portfolioId, proposal);
      }

      if (url.pathname === "/paper-order-batches/stage") {
        if (request.method !== "POST") {
          return json({ error: "Method not allowed" }, 405);
        }
        const proposalId = url.searchParams.get("proposalId") ?? "";
        if (!/^[A-Za-z0-9_-]{1,180}$/.test(proposalId)) {
          throw new RequestError(400, "Invalid proposal identifier.");
        }
        const result = await stagePaperOrdersOrConflict(env.DB, proposalId);
        const portfolioId = result.batch?.portfolioId ?? "portfolio_ira";
        return paperOrderActionResponse(request, portfolioId, result);
      }

      const readyBatchMatch = url.pathname.match(/^\/paper-order-batches\/([A-Za-z0-9_-]+)\/ready$/);
      if (readyBatchMatch) {
        if (request.method !== "POST") {
          return json({ error: "Method not allowed" }, 405);
        }
        const batch = await markPaperOrderBatchReady(env.DB, readyBatchMatch[1]);
        return paperOrderActionResponse(request, batch.portfolioId, batch);
      }

      const rejectBatchMatch = url.pathname.match(/^\/paper-order-batches\/([A-Za-z0-9_-]+)\/reject$/);
      if (rejectBatchMatch) {
        if (request.method !== "POST") {
          return json({ error: "Method not allowed" }, 405);
        }
        const batch = await rejectPaperOrderBatch(env.DB, rejectBatchMatch[1], await actionReason(request, "Rejected by reviewer."));
        return paperOrderActionResponse(request, batch.portfolioId, batch);
      }

      const cancelBatchMatch = url.pathname.match(/^\/paper-order-batches\/([A-Za-z0-9_-]+)\/cancel$/);
      if (cancelBatchMatch) {
        if (request.method !== "POST") {
          return json({ error: "Method not allowed" }, 405);
        }
        const batch = await cancelPaperOrderBatch(env.DB, cancelBatchMatch[1], await actionReason(request, "Cancelled by reviewer."));
        return paperOrderActionResponse(request, batch.portfolioId, batch);
      }

      const refreshBatchMatch = url.pathname.match(/^\/paper-order-batches\/([A-Za-z0-9_-]+)\/refresh$/);
      if (refreshBatchMatch) {
        if (request.method !== "POST") {
          return json({ error: "Method not allowed" }, 405);
        }
        const batch = await refreshPaperOrderBatchPrices(env.DB, refreshBatchMatch[1]);
        return paperOrderActionResponse(request, batch.portfolioId, batch);
      }

      const executeBatchMatch = url.pathname.match(/^\/paper-order-batches\/([A-Za-z0-9_-]+)\/execute$/);
      if (executeBatchMatch) {
        if (request.method !== "POST") {
          return json({ error: "Method not allowed" }, 405);
        }
        const auth = await authorize(request, env);
        if (auth) {
          return auth;
        }
        const result = await executePaperOrderBatch(env.DB, executeBatchMatch[1]);
        if (!result.execution) {
          throw new RequestError(409, result.validation.reasons.join(" ") || "Paper execution validation failed.");
        }
        return json(result);
      }

      const executionMatch = url.pathname.match(/^\/paper-order-batches\/([A-Za-z0-9_-]+)\/execution$/);
      if (executionMatch) {
        if (request.method !== "GET") {
          return json({ error: "Method not allowed" }, 405);
        }
        return json({ execution: await getPaperExecutionByBatchId(env.DB, executionMatch[1]) });
      }

      if (url.pathname.startsWith("/api/analytics")) {
        const analytics = new PerformanceAnalyticsService(env.DB);
        const portfolioId = requestedPortfolioId(url);
        if (url.pathname === "/api/analytics" || url.pathname === "/api/analytics/performance") {
          return json(await analytics.getPerformance(portfolioId));
        }
        if (url.pathname === "/api/analytics/summary") {
          return json(await analytics.getSummary(portfolioId));
        }
        if (url.pathname === "/api/analytics/history") {
          return json(await analytics.getHistory(portfolioId));
        }
        if (url.pathname === "/api/analytics/records") {
          return json(await analytics.getRecords(portfolioId));
        }
        return notFound();
      }

      if (url.pathname === "/valuation") {
        return json(await getPortfolioValuation(env.DB, requestedPortfolioId(url)));
      }

      if (url.pathname === "/daily-snapshots") {
        return json({
          snapshots: await getLatestDailySnapshots(env.DB, await requestedExistingPortfolioId(env.DB, url))
        });
      }

      if (url.pathname === "/historical-performance") {
        return json({ metrics: await getHistoricalMetrics(env.DB, requestedPortfolioId(url)) });
      }

      if (url.pathname === "/daily-summary") {
        return json(await getDailySummaryData(env.DB, requestedPortfolioId(url)));
      }

      if (url.pathname === "/milestones") {
        return json(await getMilestones(env.DB, await requestedExistingPortfolioId(env.DB, url)));
      }

      if (url.pathname === "/journey") {
        return json(await getJourney(env.DB, await requestedExistingPortfolioId(env.DB, url)));
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
        return json(await getDashboardData(env.DB, await requestedExistingPortfolioId(env.DB, url) ?? undefined));
      }

      if (url.pathname === "/dashboard/contract") {
        return json(await getDashboardContract(env.DB, requestedPortfolioId(url)));
      }

      if (url.pathname === "/dashboard") {
        return renderDashboard(env.DB, await requestedExistingPortfolioId(env.DB, url) ?? undefined);
      }

      if (url.pathname === "/diagnostics") {
        return json(await getDiagnostics(env.DB));
      }

      return notFound();
    } catch (error) {
      if (error instanceof RequestError) {
        return json({ error: error.message }, error.status);
      }
      if (error instanceof PortfolioNotFoundError) {
        return json({ error: "Portfolio not found" }, 404);
      }
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

async function proposalRejectionReason(request: Request): Promise<string> {
  return actionReason(request, "Rejected by reviewer.");
}

async function actionReason(request: Request, fallback: string): Promise<string> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = await request.json<{ reason?: string }>();
      return body.reason?.slice(0, 500) || fallback;
    } catch {
      return fallback;
    }
  }
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const reason = form.get("reason");
    return typeof reason === "string" && reason ? reason.slice(0, 500) : fallback;
  }
  return fallback;
}

function proposalActionResponse(request: Request, portfolioId: string, payload: unknown): Response {
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/html")) {
    return new Response(null, {
      status: 303,
      headers: { location: `/dashboard?portfolioId=${encodeURIComponent(portfolioId)}#allocation-proposal` }
    });
  }
  return json(payload);
}

function paperOrderActionResponse(request: Request, portfolioId: string, payload: unknown): Response {
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/html")) {
    return new Response(null, {
      status: 303,
      headers: { location: `/dashboard?portfolioId=${encodeURIComponent(portfolioId)}#paper-order-batch` }
    });
  }
  return json(payload);
}

async function approveProposalOrConflict(db: D1Database, proposalId: string) {
  try {
    return await approveAllocationProposal(db, proposalId);
  } catch (error) {
    if (error instanceof Error && /not approvable/i.test(error.message)) {
      throw new RequestError(409, error.message);
    }
    throw error;
  }
}

async function stagePaperOrdersOrConflict(db: D1Database, proposalId: string) {
  try {
    const result = await stagePaperOrdersForProposal(db, proposalId);
    if (!result.batch) {
      throw new RequestError(409, result.validationReport.reasons.join(" ") || "Paper order staging validation failed.");
    }
    return result;
  } catch (error) {
    if (error instanceof RequestError) {
      throw error;
    }
    if (error instanceof Error && /approved allocation proposals|validation failed|cannot be staged/i.test(error.message)) {
      throw new RequestError(409, error.message);
    }
    throw error;
  }
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
