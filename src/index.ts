import { getBenchmarks } from "./market/benchmarks.ts";
import { getAssets, getWatchlists } from "./market/assets.ts";
import { getPortfolio, renderPortfolioPage } from "./portfolio/service.ts";
import { getDashboardData, renderDashboard } from "./dashboard/service.ts";
import { renderHome } from "./home/service.ts";
import { getDiagnostics, getOpportunities, getPerformance, getTrades } from "./paper/service.ts";
import { PaperObservationService } from "./paper/observation.ts";
import { getProfileComparison, listPortfolioProfiles } from "./portfolio/profiles.ts";
import {
  getIntelligenceCategories,
  getIntelligenceEvents,
  getIntelligenceOverview,
  getIntelligenceToday,
  getMarketStory
} from "./intelligence/service.ts";
import { runScheduledPaperStrategy, getScheduledRuns, reconcileStaleScheduledRuns } from "./scheduler/service.ts";
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
import { DailyPortfolioReviewService, listDailyReviews } from "./reviews/dailyReview.ts";
import { RecommendationProposalService } from "./recommendations/proposalService.ts";
import { MarketDataService } from "./market/service.ts";
import { StrategyEngine } from "./strategy/engine.ts";
import { ForwardTestService, runScheduledForwardTests } from "./forward/forwardTest.ts";
import { DailyManagementCycleService } from "./management/dailyCycle.ts";
import { BenchmarkComparisonService } from "./benchmarks/comparison.ts";
import { PortfolioDecisionService } from "./decisions/portfolioDecision.ts";
import { PortfolioBriefingService } from "./briefings/portfolioBriefing.ts";
import { VerifiedMarketIntelligenceService, runScheduledMarketIntelligence } from "./intelligence/verifiedPipeline.ts";
import { DailyPortfolioOrchestrator, runScheduledDailyOrchestrations, type DailyOrchestrationTriggerType } from "./orchestration/dailyPortfolioOrchestrator.ts";
import { StrategyEvaluationLabService } from "./lab/strategyEvaluationLab.ts";
import { PortfolioResearchEngine, runScheduledResearch, type ResearchRankBy } from "./research/engine.ts";
import { EventBus } from "./events/eventBus.ts";
import { KnowledgeGraphService } from "./graph/knowledgeGraph.ts";
import { listFounderReports } from "./reports/founderReport.ts";

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

function wantsHtml(request: Request, url: URL): boolean {
  const format = url.searchParams.get("format");
  if (format === "json") {
    return false;
  }
  if (format === "html") {
    return true;
  }
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html") && !accept.includes("application/json");
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
      "/market-intelligence",
      "/market-intelligence/provider-health",
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
      "/settings",
      "/daily-reviews",
      "/recommendation-proposals",
      "/strategy-runs",
      "/forward-test",
      "/forward-test/monthly-report",
      "/benchmark-comparison",
      "/benchmark-comparison/monthly-report",
      "/benchmark-comparison/history.csv",
      "/portfolio-decisions",
      "/portfolio-briefings",
      "/portfolio-briefings/public-summary",
      "/strategy-lab",
      "/research",
      "/research/securities",
      "/research/rankings",
      "/research/candidates",
      "/founder-reports",
      "/events",
      "/events/observability",
      "/events/dead-letters",
      "/knowledge-graph",
      "/knowledge-graph/visualization"
    ]);

    if ((getRoutes.has(url.pathname) || url.pathname.startsWith("/api/analytics")) && request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }

    const stateChangingRoutes = new Set(["/paper/run", "/settings/pause", "/settings/resume", "/daily-reviews/run", "/strategy/run", "/strategy-lab/run", "/research/run", "/forward-test/run", "/forward-test/monthly-report/create", "/benchmark-comparison/run", "/benchmark-comparison/monthly-report/create", "/portfolio-decisions/run", "/portfolio-briefings/run", "/market-intelligence/run", "/events/process", "/events/replay", "/knowledge-graph/sync"]);
    const protectedGetRoutes = new Set([
      "/diagnostics",
      "/market-data/provider-health",
      "/market-data/cache",
      "/market-data/anomalies",
      "/market-data/quote-status",
      "/market-data/historical-coverage"
    ]);
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
        return json(await new PaperObservationService(env).start(new Date(), true));
      }

      if (url.pathname === "/settings/pause") {
        return json(await setAutomationPaused(env.DB, true));
      }

      if (url.pathname === "/settings/resume") {
        return json(await setAutomationPaused(env.DB, false));
      }

      if (url.pathname === "/daily-reviews/run") {
        const service = new DailyPortfolioReviewService(env.DB);
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        return dailyReviewActionResponse(request, portfolioId, await service.run(portfolioId, "manual"));
      }

      if (url.pathname === "/strategy/run") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        const snapshotId = url.searchParams.get("snapshotId");
        if (snapshotId && !/^[A-Za-z0-9_-]{1,180}$/.test(snapshotId)) {
          throw new RequestError(400, "Invalid market-data snapshot identifier.");
        }
        const run = await new StrategyEngine(env.DB).run(portfolioId, { snapshotId });
        return strategyActionResponse(request, portfolioId, run);
      }

      if (url.pathname === "/strategy-lab/run") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        const result = await new StrategyEvaluationLabService(env.DB).run(portfolioId);
        return strategyLabActionResponse(request, portfolioId, result);
      }

      if (url.pathname === "/research/run") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        const result = await new PortfolioResearchEngine(env.DB).run(portfolioId);
        return researchActionResponse(request, portfolioId, result);
      }

      if (url.pathname === "/forward-test/run") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        const result = await new ForwardTestService(env.DB).run(portfolioId, "manual");
        return forwardTestActionResponse(request, portfolioId, result);
      }

      if (url.pathname === "/forward-test/monthly-report/create") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        return json(await new ForwardTestService(env.DB).monthlyReport(portfolioId, url.searchParams.get("month") ?? undefined, url.searchParams.get("reason")));
      }

      if (url.pathname === "/benchmark-comparison/run") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        const result = await new BenchmarkComparisonService(env.DB).run(portfolioId, "manual");
        return benchmarkComparisonActionResponse(request, portfolioId, result);
      }

      if (url.pathname === "/benchmark-comparison/monthly-report/create") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        return json(await new BenchmarkComparisonService(env.DB).createMonthlyReport(portfolioId, url.searchParams.get("month") ?? undefined, url.searchParams.get("reason")));
      }

      if (url.pathname === "/portfolio-decisions/run") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        const result = await new PortfolioDecisionService(env.DB).evaluate(portfolioId);
        return portfolioDecisionActionResponse(request, portfolioId, result);
      }

      if (url.pathname === "/portfolio-briefings/run") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        const type = briefingTypeFromUrl(url);
        const result = await new PortfolioBriefingService(env.DB).generate(portfolioId, { type, length: "standard", tone: "plain", regenerate: url.searchParams.get("regenerate") === "true", regenerationReason: url.searchParams.get("reason") });
        return portfolioBriefingActionResponse(request, portfolioId, result);
      }

      const orchestrationMatch = url.pathname.match(/^\/accounts\/([A-Za-z0-9_-]+)\/daily-orchestration$/);
      if (orchestrationMatch) {
        if (request.method === "GET") {
          return json({ latest: await new DailyPortfolioOrchestrator(env.DB).latest(orchestrationMatch[1]) });
        }
        if (request.method !== "POST") {
          return json({ error: "Method not allowed" }, 405);
        }
        const auth = await authorize(request, env);
        if (auth) {
          return auth;
        }
        const body = await orchestrationBody(request);
        const result = await new DailyPortfolioOrchestrator(env.DB).run({
          portfolioId: orchestrationMatch[1],
          marketDate: body.marketDate ?? url.searchParams.get("marketDate") ?? undefined,
          refreshMode: body.refreshMode ?? parseRefreshMode(url.searchParams.get("refreshMode")),
          triggerType: body.triggerType ?? "Manual protected",
          actor: body.actor ?? "protected_manual"
        });
        return json(result);
      }

      if (url.pathname === "/market-intelligence/run") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        const service = new VerifiedMarketIntelligenceService(env.DB);
        const ingestion = await service.ingest(portfolioId, "manual");
        const summary = await service.createPortfolioSummary(portfolioId);
        return marketIntelligenceActionResponse(request, portfolioId, { ingestion, summary });
      }

      if (url.pathname === "/events/process") {
        const limit = safeLimit(url.searchParams.get("limit"), 50, 200);
        return json(await new EventBus(env.DB).processPending(limit));
      }

      if (url.pathname === "/events/replay") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url);
        const result = await new EventBus(env.DB).replay({
          eventType: url.searchParams.get("eventType"),
          portfolioId,
          fromTimestamp: url.searchParams.get("from"),
          toTimestamp: url.searchParams.get("to"),
          requestedBy: "protected_endpoint"
        });
        return json(result);
      }

      if (url.pathname === "/knowledge-graph/sync") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        const result = await new KnowledgeGraphService(env.DB).syncPortfolio(portfolioId, "protected_endpoint");
        return json(result);
      }

      const createReviewProposalMatch = url.pathname.match(/^\/daily-reviews\/([A-Za-z0-9_-]+)\/proposal$/);
      if (createReviewProposalMatch) {
        if (request.method !== "POST") {
          return json({ error: "Method not allowed" }, 405);
        }
        const auth = await authorize(request, env);
        if (auth) {
          return auth;
        }
        const service = new RecommendationProposalService(env.DB);
        const result = await service.createDraftFromReview(createReviewProposalMatch[1]);
        const portfolioId = result.proposal?.portfolioId ?? "portfolio_ira";
        return recommendationProposalActionResponse(request, portfolioId, result);
      }

      const portfolioDecisionActionMatch = url.pathname.match(/^\/portfolio-decisions\/([A-Za-z0-9_-]+)\/(accept|reject|defer|review)$/);
      if (portfolioDecisionActionMatch) {
        if (request.method !== "POST") {
          return json({ error: "Method not allowed" }, 405);
        }
        const auth = await authorize(request, env);
        if (auth) {
          return auth;
        }
        const service = new PortfolioDecisionService(env.DB);
        const reason = await actionReason(request, `${portfolioDecisionActionMatch[2]} by reviewer.`);
        const decisionId = portfolioDecisionActionMatch[1];
        const action = portfolioDecisionActionMatch[2];
        const result = action === "accept"
          ? await service.acceptForProposal(decisionId, reason)
          : action === "reject"
          ? await service.reject(decisionId, reason)
          : action === "defer"
          ? await service.defer(decisionId, reason)
          : await service.markReviewed(decisionId, reason);
        const portfolioId = "decision" in result ? result.decision.portfolioId : result.portfolioId;
        return portfolioDecisionActionResponse(request, portfolioId, result);
      }

      if (url.pathname === "/health") {
        return json({
          ok: true,
          app: "Kairox",
          databaseReachable: await checkDatabase(env.DB),
          timestamp: new Date().toISOString()
        });
      }

      if (url.pathname === "/") {
        return renderHome(env.DB, await requestedExistingPortfolioId(env.DB, url) ?? undefined);
      }

      if (url.pathname === "/status") {
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
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? undefined;
        if (wantsHtml(request, url)) {
          return renderPortfolioPage(env.DB, portfolioId);
        }
        return json(await getPortfolio(env.DB, portfolioId));
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

      if (url.pathname === "/market-data/quote-status") {
        const symbols = (url.searchParams.get("symbols") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
        const quotes = await new MarketDataService(env.DB).getQuotes(symbols, "dashboard");
        return json({ quotes: quotes.map(sanitizeDiagnosticQuote) });
      }

      if (url.pathname === "/market-data/provider-health") {
        return json({ providers: await new MarketDataService(env.DB).getProviderHealth() });
      }

      if (url.pathname === "/market-data/cache") {
        return json({ cache: await new MarketDataService(env.DB).getCacheStatus(url.searchParams.get("symbol") ?? undefined) });
      }

      if (url.pathname === "/market-data/anomalies") {
        return json({ anomalies: await new MarketDataService(env.DB).getRecentAnomalies() });
      }

      if (url.pathname === "/market-data/historical-coverage") {
        return json({ coverage: await getHistoricalCoverage(env.DB, url.searchParams.get("symbol") ?? undefined) });
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

      if (url.pathname === "/market-intelligence") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        const service = new VerifiedMarketIntelligenceService(env.DB);
        return json({ portfolioId, links: await service.listPortfolioIntelligence(portfolioId), summary: await service.latestSummary(portfolioId) });
      }

      if (url.pathname === "/market-intelligence/provider-health") {
        return json({ providers: await new VerifiedMarketIntelligenceService(env.DB).providerHealth() });
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

      const readyRecommendationProposalMatch = url.pathname.match(/^\/recommendation-proposals\/([A-Za-z0-9_-]+)\/ready$/);
      if (readyRecommendationProposalMatch) {
        if (request.method !== "POST") {
          return json({ error: "Method not allowed" }, 405);
        }
        const auth = await authorize(request, env);
        if (auth) {
          return auth;
        }
        const proposal = await new RecommendationProposalService(env.DB).markReady(readyRecommendationProposalMatch[1]);
        return recommendationProposalActionResponse(request, proposal.portfolioId, proposal);
      }

      const regenerateRecommendationProposalMatch = url.pathname.match(/^\/recommendation-proposals\/([A-Za-z0-9_-]+)\/regenerate$/);
      if (regenerateRecommendationProposalMatch) {
        if (request.method !== "POST") {
          return json({ error: "Method not allowed" }, 405);
        }
        const auth = await authorize(request, env);
        if (auth) {
          return auth;
        }
        const service = new RecommendationProposalService(env.DB);
        const existing = await service.getById(regenerateRecommendationProposalMatch[1]);
        if (!existing) {
          throw new RequestError(404, "Recommendation proposal not found.");
        }
        const result = await service.createDraftFromReview(existing.sourceDailyReviewId, { regenerate: true, reason: await actionReason(request, "Regenerated by reviewer.") });
        return recommendationProposalActionResponse(request, existing.portfolioId, result);
      }

      const rejectRecommendationProposalMatch = url.pathname.match(/^\/recommendation-proposals\/([A-Za-z0-9_-]+)\/reject$/);
      if (rejectRecommendationProposalMatch) {
        if (request.method !== "POST") {
          return json({ error: "Method not allowed" }, 405);
        }
        const auth = await authorize(request, env);
        if (auth) {
          return auth;
        }
        const proposal = await new RecommendationProposalService(env.DB).reject(rejectRecommendationProposalMatch[1], await actionReason(request, "Rejected by reviewer."));
        return recommendationProposalActionResponse(request, proposal.portfolioId, proposal);
      }

      const supersedeRecommendationProposalMatch = url.pathname.match(/^\/recommendation-proposals\/([A-Za-z0-9_-]+)\/supersede$/);
      if (supersedeRecommendationProposalMatch) {
        if (request.method !== "POST") {
          return json({ error: "Method not allowed" }, 405);
        }
        const auth = await authorize(request, env);
        if (auth) {
          return auth;
        }
        const proposal = await new RecommendationProposalService(env.DB).supersede(supersedeRecommendationProposalMatch[1], await actionReason(request, "Superseded by reviewer."));
        return recommendationProposalActionResponse(request, proposal.portfolioId, proposal);
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

      if (url.pathname === "/daily-reviews") {
        return json({ reviews: await listDailyReviews(env.DB, await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira") });
      }

      if (url.pathname === "/daily-management-cycles") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        return json({ cycles: await new DailyManagementCycleService(env.DB).list(portfolioId), latest: await new DailyManagementCycleService(env.DB).latest(portfolioId) });
      }

      if (url.pathname === "/daily-management-cycles/run") {
        if (request.method !== "POST") {
          return json({ error: "Method not allowed" }, 405);
        }
        const auth = await authorize(request, env);
        if (auth) {
          return auth;
        }
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        const refresh = url.searchParams.get("refresh") === "true";
        const result = await new DailyManagementCycleService(env.DB).run(portfolioId, "manual", new Date(), {
          refresh,
          refreshReason: refresh ? await actionReason(request, "Manual protected refresh.") : undefined
        });
        return dailyManagementCycleActionResponse(request, portfolioId, result);
      }

      if (url.pathname === "/recommendation-proposals") {
        return json({ proposals: await new RecommendationProposalService(env.DB).list(await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira") });
      }

      if (url.pathname === "/strategy-runs") {
        const engine = new StrategyEngine(env.DB);
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        return json({ runs: await engine.list(portfolioId), latest: await engine.latest(portfolioId) });
      }

      if (url.pathname === "/strategy-lab") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        return json(await new StrategyEvaluationLabService(env.DB).summary(portfolioId));
      }

      if (url.pathname === "/research") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        return json(await new PortfolioResearchEngine(env.DB).summary(portfolioId));
      }

      if (url.pathname === "/research/securities") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        return json(await new PortfolioResearchEngine(env.DB).summary(portfolioId));
      }

      if (url.pathname === "/research/rankings") {
        const rankBy = researchRankBy(url.searchParams.get("by"));
        return json({ rankBy, securities: await new PortfolioResearchEngine(env.DB).rankings(rankBy) });
      }

      if (url.pathname === "/research/candidates") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        const summary = await new PortfolioResearchEngine(env.DB).summary(portfolioId);
        return json({ candidates: summary.candidates });
      }

      if (url.pathname === "/founder-reports") {
        return json(await listFounderReports(env.DB, safeLimit(url.searchParams.get("limit"), 20, 100)));
      }

      if (url.pathname === "/events") {
        return json({
          events: await new EventBus(env.DB).timeline(await requestedExistingPortfolioId(env.DB, url) ?? undefined, safeLimit(url.searchParams.get("limit"), 40, 100))
        });
      }

      if (url.pathname === "/events/observability") {
        return json({ observability: await new EventBus(env.DB).observability() });
      }

      if (url.pathname === "/events/dead-letters") {
        return json({ deadLetters: await new EventBus(env.DB).deadLetters(safeLimit(url.searchParams.get("limit"), 50, 100)) });
      }

      if (url.pathname === "/knowledge-graph") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        const nodeId = url.searchParams.get("nodeId");
        const service = new KnowledgeGraphService(env.DB);
        if (nodeId) {
          if (!/^[A-Za-z0-9_-]{1,120}$/.test(nodeId)) {
            throw new RequestError(400, "Invalid graph node identifier.");
          }
          return json(await service.traverse(nodeId, safeLimit(url.searchParams.get("depth"), 1, 4), safeLimit(url.searchParams.get("limit"), 100, 300)));
        }
        return json(await service.summary(portfolioId, safeLimit(url.searchParams.get("limit"), 200, 500)));
      }

      if (url.pathname === "/knowledge-graph/visualization") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        return json(await new KnowledgeGraphService(env.DB).visualization(portfolioId, safeLimit(url.searchParams.get("limit"), 140, 300)));
      }

      if (url.pathname === "/forward-test") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        return json(await new ForwardTestService(env.DB).summary(portfolioId));
      }

      if (url.pathname === "/forward-test/monthly-report") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        return json(await new ForwardTestService(env.DB).monthlyReportPreview(portfolioId, url.searchParams.get("month") ?? undefined));
      }

      if (url.pathname === "/benchmark-comparison") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        return json(await new BenchmarkComparisonService(env.DB).summary(portfolioId));
      }

      if (url.pathname === "/benchmark-comparison/monthly-report") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        const format = url.searchParams.get("format");
        const report = await new BenchmarkComparisonService(env.DB).monthlyReportPreview(portfolioId, url.searchParams.get("month") ?? undefined, format === "html" ? "html" : format === "csv" ? "csv" : "json");
        return report instanceof Response ? report : json(report);
      }

      if (url.pathname === "/benchmark-comparison/history.csv") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        const report = await new BenchmarkComparisonService(env.DB).monthlyReportPreview(portfolioId, url.searchParams.get("month") ?? undefined, "csv");
        return report instanceof Response ? report : json(report);
      }

      if (url.pathname === "/portfolio-decisions") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        const service = new PortfolioDecisionService(env.DB);
        return json({ latest: await service.latest(portfolioId), decisions: await service.list(portfolioId) });
      }

      if (url.pathname === "/portfolio-briefings") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        const service = new PortfolioBriefingService(env.DB);
        return json({ latest: await service.latest(portfolioId), briefings: await service.list(portfolioId) });
      }

      if (url.pathname === "/portfolio-briefings/public-summary") {
        const portfolioId = await requestedExistingPortfolioId(env.DB, url) ?? "portfolio_ira";
        return json(await new PortfolioBriefingService(env.DB).publicSummary(portfolioId));
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
    const scheduledAt = new Date(controller.scheduledTime).toISOString();
    ctx.waitUntil(runOneScheduledWorkload(env, controller.cron, scheduledAt));
  }
} satisfies ExportedHandler<Env>;

async function runOneScheduledWorkload(env: Env, cron: string, scheduledAt: string): Promise<unknown> {
  const scheduledDate = new Date(scheduledAt);
  await reconcileStaleScheduledRuns(env.DB, scheduledDate);
  const continuedPaperObservation = await new PaperObservationService(env).processNextChild(undefined, scheduledDate);
  if (continuedPaperObservation) {
    return { prioritizedPaperObservation: true, child: continuedPaperObservation };
  }
  const halfHourIndex = Math.floor(scheduledDate.getTime() / (30 * 60 * 1000));
  const slot = halfHourIndex % 6;
  if (slot === 0) {
    return runScheduledPaperStrategy(env, cron, scheduledAt);
  }
  if (slot === 1) {
    return runScheduledDailyOrchestrations(env, scheduledAt);
  }
  if (slot === 2) {
    return runScheduledForwardTests(env, scheduledAt);
  }
  if (slot === 3) {
    return runScheduledMarketIntelligence(env, scheduledAt);
  }
  if (slot === 4) {
    return runScheduledResearch(env, scheduledAt);
  }
  if (slot === 5) {
    return new EventBus(env.DB).processPending(100, scheduledDate);
  }
  return new EventBus(env.DB).processPending(100, scheduledDate);
}

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

async function orchestrationBody(request: Request): Promise<{ marketDate?: string; refreshMode?: "normal" | "validate_only" | "administrative_refresh"; triggerType?: DailyOrchestrationTriggerType; actor?: string }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return {};
  }
  try {
    const body = await request.json<{
      marketDate?: string;
      refreshMode?: "normal" | "validate_only" | "administrative_refresh";
      triggerType?: DailyOrchestrationTriggerType;
      actor?: string;
    }>();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

function parseRefreshMode(value: string | null): "normal" | "validate_only" | "administrative_refresh" | undefined {
  return value === "normal" || value === "validate_only" || value === "administrative_refresh" ? value : undefined;
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

function dailyReviewActionResponse(request: Request, portfolioId: string, payload: unknown): Response {
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/html")) {
    return new Response(null, {
      status: 303,
      headers: { location: `/dashboard?portfolioId=${encodeURIComponent(portfolioId)}#daily-review` }
    });
  }
  return json(payload);
}

function dailyManagementCycleActionResponse(request: Request, portfolioId: string, payload: unknown): Response {
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/html")) {
    return new Response(null, {
      status: 303,
      headers: { location: `/dashboard?portfolioId=${encodeURIComponent(portfolioId)}#daily-management` }
    });
  }
  return json(payload);
}

function recommendationProposalActionResponse(request: Request, portfolioId: string, payload: unknown): Response {
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/html")) {
    return new Response(null, {
      status: 303,
      headers: { location: `/dashboard?portfolioId=${encodeURIComponent(portfolioId)}#daily-review` }
    });
  }
  return json(payload);
}

function strategyActionResponse(request: Request, portfolioId: string, payload: unknown): Response {
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/html")) {
    return new Response(null, {
      status: 303,
      headers: { location: `/dashboard?portfolioId=${encodeURIComponent(portfolioId)}#strategy-analysis` }
    });
  }
  return json(payload);
}

function strategyLabActionResponse(request: Request, portfolioId: string, payload: unknown): Response {
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/html")) {
    return new Response(null, {
      status: 303,
      headers: { location: `/dashboard?portfolioId=${encodeURIComponent(portfolioId)}#strategy-lab` }
    });
  }
  return json(payload);
}

function researchActionResponse(request: Request, portfolioId: string, payload: unknown): Response {
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/html")) {
    return new Response(null, {
      status: 303,
      headers: { location: `/dashboard?portfolioId=${encodeURIComponent(portfolioId)}#research-center` }
    });
  }
  return json(payload);
}

function forwardTestActionResponse(request: Request, portfolioId: string, payload: unknown): Response {
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/html")) {
    return new Response(null, {
      status: 303,
      headers: { location: `/dashboard?portfolioId=${encodeURIComponent(portfolioId)}#forward-test` }
    });
  }
  return json(payload);
}

function benchmarkComparisonActionResponse(request: Request, portfolioId: string, payload: unknown): Response {
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/html")) {
    return new Response(null, {
      status: 303,
      headers: { location: `/dashboard?portfolioId=${encodeURIComponent(portfolioId)}#benchmark-comparison` }
    });
  }
  return json(payload);
}

function portfolioDecisionActionResponse(request: Request, portfolioId: string, payload: unknown): Response {
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/html")) {
    return new Response(null, {
      status: 303,
      headers: { location: `/dashboard?portfolioId=${encodeURIComponent(portfolioId)}#portfolio-decision` }
    });
  }
  return json(payload);
}

function portfolioBriefingActionResponse(request: Request, portfolioId: string, payload: unknown): Response {
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/html")) {
    return new Response(null, {
      status: 303,
      headers: { location: `/dashboard?portfolioId=${encodeURIComponent(portfolioId)}#portfolio-briefing` }
    });
  }
  return json(payload);
}

function marketIntelligenceActionResponse(request: Request, portfolioId: string, payload: unknown): Response {
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/html")) {
    return new Response(null, {
      status: 303,
      headers: { location: `/dashboard?portfolioId=${encodeURIComponent(portfolioId)}#market-intelligence` }
    });
  }
  return json(payload);
}

function researchRankBy(value: string | null): ResearchRankBy {
  return value === "dividend" || value === "growth" || value === "quality" || value === "risk" || value === "momentum" || value === "income" || value === "overall"
    ? value
    : "overall";
}

function safeLimit(value: string | null, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(maximum, Math.floor(parsed)) : fallback;
}

function briefingTypeFromUrl(url: URL) {
  const value = url.searchParams.get("type") ?? "daily_close";
  const allowed = new Set(["daily_close", "weekly_summary", "monthly_report", "risk_alert", "rebalance_explanation", "hold_explanation", "data_unavailable", "public_progress"]);
  if (!allowed.has(value)) {
    throw new RequestError(400, "Invalid briefing type.");
  }
  return value as "daily_close" | "weekly_summary" | "monthly_report" | "risk_alert" | "rebalance_explanation" | "hold_explanation" | "data_unavailable" | "public_progress";
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

async function getHistoricalCoverage(db: D1Database, symbol?: string) {
  const base = `SELECT symbol, provider, MIN(trading_date) AS startDate, MAX(trading_date) AS endDate, COUNT(*) AS bars
    FROM historical_price_bars`;
  const query = symbol
    ? db.prepare(`${base} WHERE symbol = ? GROUP BY symbol, provider ORDER BY symbol ASC, provider ASC`).bind(symbol.toUpperCase())
    : db.prepare(`${base} GROUP BY symbol, provider ORDER BY symbol ASC, provider ASC`);
  const result = await query.all();
  return result.results ?? [];
}

function sanitizeDiagnosticQuote(quote: Awaited<ReturnType<MarketDataService["getQuote"]>>) {
  return {
    symbol: quote.symbol,
    securityName: quote.securityName,
    assetType: quote.assetType,
    exchange: quote.exchange,
    currency: quote.currency,
    lastPrice: quote.lastPrice,
    previousClose: quote.previousClose,
    marketSession: quote.marketSession,
    providerTimestamp: quote.providerTimestamp,
    receivedTimestamp: quote.receivedTimestamp,
    providerName: quote.providerName,
    dataQualityStatus: quote.dataQualityStatus,
    source: quote.source,
    cached: quote.cached,
    warnings: quote.warnings,
    validation: quote.validation
  };
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
