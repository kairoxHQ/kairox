import { getBenchmarks } from "../market/benchmarks.ts";
import { calculatePerformance } from "../portfolio/performance.ts";
import { getSettings } from "../settings/service.ts";
import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";
import { getMarketDataStatuses } from "../market/status.ts";
import { sanitizeForUser } from "../shared/messages.ts";
import { listEnabledWatchlistAssets } from "../market/assets.ts";
import { getOpportunities } from "../paper/service.ts";
import { getProfileComparison } from "../portfolio/profiles.ts";
import { getIntelligenceOverview } from "../intelligence/service.ts";
import { summarizeScheduledRun } from "../scheduler/service.ts";
import { getAllProfileHoldingQuotes, getMarketTickerQuotes, type HoldingQuote, type NormalizedQuote } from "../market/quotes.ts";

export async function getDashboardData(db: D1Database): Promise<unknown> {
  const [settings, performance, benchmarks, positions, journal, recommendations, trades, scheduledRuns, summaries, rejected, marketStatuses, equityHistory, todayStart, assets, opportunityData, latestPrices, profileComparison, intelligence, marketTicker, profileHoldingQuotes] =
    await Promise.all([
      getSettings(db),
      calculatePerformance(db),
      getBenchmarks(db),
      listRows(
        db
          .prepare(
            `SELECT symbol, asset_class AS assetClass, quantity,
              avg_entry_price_usd AS avgEntryPriceUsd, current_price_usd AS currentPriceUsd,
              market_value_usd AS marketValueUsd, updated_at AS updatedAt
             FROM positions
             WHERE portfolio_id = ? AND quantity > 0
             ORDER BY market_value_usd DESC`
          )
          .bind(TIM_PORTFOLIO_ID)
      ),
      listRows(
        db
          .prepare(
            `SELECT json_extract(price_data_json, '$.symbol') AS symbol,
              decision, explanation, confidence_score AS confidenceScore,
              risk_score AS riskScore, created_at AS createdAt
             FROM decision_journal
             WHERE portfolio_id = ?
             ORDER BY created_at DESC
             LIMIT 8`
          )
          .bind(TIM_PORTFOLIO_ID)
      ),
      listRows(
        db
          .prepare(
            `SELECT symbol, action, explanation, confidence_score AS confidenceScore,
              risk_score AS riskScore, price_usd AS priceUsd, price_as_of AS priceAsOf,
              created_at AS createdAt
             FROM recommendations
             WHERE portfolio_id = ?
             ORDER BY created_at DESC
             LIMIT 8`
          )
          .bind(TIM_PORTFOLIO_ID)
      ),
      listRows(
        db
          .prepare(
            `SELECT symbol, side, quantity, price_usd AS priceUsd, fees_usd AS feesUsd,
              executed_at AS executedAt
             FROM trades
             WHERE portfolio_id = ?
             ORDER BY executed_at DESC
             LIMIT 8`
          )
          .bind(TIM_PORTFOLIO_ID)
      ),
      listRows(
        db.prepare(
          `SELECT run_key AS runKey, scheduled_at AS scheduledAt, started_at AS startedAt,
            finished_at AS finishedAt, status, error_details AS errorDetails,
            summary_json AS summaryJson, id, cron, created_at AS createdAt
           FROM scheduled_runs
           ORDER BY started_at DESC
           LIMIT 8`
        )
      ),
      listRows(
        db.prepare(
          `SELECT summary_type AS summaryType, summary_date AS summaryDate, title, body
           FROM system_summaries
           ORDER BY summary_date DESC, summary_type ASC
           LIMIT 4`
        )
      ),
      listRows(
        db
          .prepare(
            `SELECT symbol, action, explanation, created_at AS createdAt
             FROM recommendations
             WHERE portfolio_id = ? AND action = 'DO_NOTHING'
               AND explanation NOT LIKE 'Market data temporarily unavailable%'
               AND explanation NOT LIKE '%latest quote was stale%'
             ORDER BY created_at DESC
             LIMIT 8`
          )
          .bind(TIM_PORTFOLIO_ID)
      ),
      getMarketDataStatuses(db),
      listRows(
        db
          .prepare(
            `SELECT recorded_at AS recordedAt, total_value_usd AS totalValueUsd
             FROM portfolio_equity_history
             WHERE portfolio_id = ?
             ORDER BY recorded_at ASC
             LIMIT 60`
          )
          .bind(TIM_PORTFOLIO_ID)
      ),
      db
        .prepare(
          `SELECT total_value_usd AS totalValueUsd
           FROM portfolio_equity_history
           WHERE portfolio_id = ? AND date(recorded_at) = date('now')
           ORDER BY recorded_at ASC
           LIMIT 1`
        )
        .bind(TIM_PORTFOLIO_ID)
        .first<{ totalValueUsd: number }>(),
      listEnabledWatchlistAssets(db),
      getOpportunities(db) as Promise<{ opportunities: Array<DashboardOpportunity> }>,
      listRows(
        db.prepare(
          `SELECT ms.symbol, ms.price_usd AS priceUsd, ms.price_as_of AS priceAsOf
           FROM market_snapshots ms
           JOIN (
             SELECT symbol, MAX(created_at) AS createdAt
             FROM market_snapshots
             GROUP BY symbol
           ) latest ON latest.symbol = ms.symbol AND latest.createdAt = ms.created_at`
        )
      ),
      getProfileComparison(db),
      getIntelligenceOverview(db),
      getMarketTickerQuotes(db),
      getAllProfileHoldingQuotes(db)
    ]);
  const todayGainLossUsd = performance.totalValueUsd - (todayStart?.totalValueUsd ?? performance.startingBalanceUsd);
  const positionsBySymbol = new Map((positions as Array<{ symbol: string; marketValueUsd: number }>).map((position) => [position.symbol, position.marketValueUsd]));
  const statusBySymbol = new Map((marketStatuses as Array<{ symbol: string }>).map((status) => [status.symbol, status]));
  const priceBySymbol = new Map((latestPrices as Array<{ symbol: string; priceUsd: number; priceAsOf: string }>).map((price) => [price.symbol, price]));

  return {
    settings,
    automation: {
      active: !settings.automationPaused,
      paused: settings.automationPaused,
      latestScheduledRun: scheduledRuns[0] ?? null
    },
    performance: { ...performance, todayGainLossUsd },
    benchmarks,
    positions,
    recommendations,
    journal,
    trades,
    scheduledRuns,
    scheduledRunAudits: scheduledRuns.map((run) => summarizeScheduledRun(run as DashboardScheduledRunRow)),
    summaries,
    rejectedOpportunities: rejected,
    marketDataStatus: marketStatuses,
    equityHistory,
    assetUniverse: assets.map((asset) => ({
      symbol: asset.symbol,
      assetType: asset.assetType,
      enabled: asset.enabled,
      tradable: asset.tradable,
      priceUsd: priceBySymbol.get(asset.symbol)?.priceUsd ?? null,
      priceAsOf: priceBySymbol.get(asset.symbol)?.priceAsOf ?? null,
      freshness: statusLabel(statusBySymbol.get(asset.symbol) as DashboardMarketStatus | undefined),
      status: statusMessage(statusLabel(statusBySymbol.get(asset.symbol) as DashboardMarketStatus | undefined), (statusBySymbol.get(asset.symbol) as DashboardMarketStatus | undefined)?.userMessage ?? ""),
      currentPositionValueUsd: positionsBySymbol.get(asset.symbol) ?? 0
    })),
    opportunities: opportunityData.opportunities
    ,
    profileComparison,
    intelligence,
    marketTicker,
    profileHoldingQuotes
  };
}

interface DashboardOpportunity {
  symbol: string;
  assetType: string;
  eligible: boolean;
  screenScore: number | null;
  rank: number | null;
  latestPriceOrNav: number | null;
  freshness: string;
  decision: string;
  confidence: number;
  exclusionOrSkipReason: string;
  currentExposure: number | null;
}

interface DashboardMarketStatus {
  symbol: string;
  source: string;
  fetchedAt: string;
  isFresh: boolean;
  status: string;
  userMessage: string;
}

export async function renderDashboard(db: D1Database): Promise<Response> {
  const data = await getDashboardData(db) as {
    settings: { automationPaused: boolean };
    performance: {
      totalValueUsd: number;
      cashUsd: number;
      todayGainLossUsd?: number;
      totalReturnUsd: number;
      priceReturnUsd: number;
      dividendReturnUsd: number;
      tradeCount: number;
      maxDrawdownPct: number;
      benchmarkReturns: Array<{ benchmarkName: string; returnPct: number; latestValueUsd: number }>;
    };
    positions: Array<{ symbol: string; assetClass?: string; quantity: number; marketValueUsd: number }>;
    recommendations: Array<{ symbol: string; action: string; explanation: string }>;
    journal?: Array<{ symbol?: string; decision: string; explanation: string; confidenceScore?: number; createdAt?: string }>;
    trades: Array<{ symbol: string; side: string; quantity: number; priceUsd: number; executedAt?: string }>;
    scheduledRuns: Array<{ runKey: string; status: string; startedAt: string; errorDetails?: string }>;
    scheduledRunAudits: DashboardScheduledRunAudit[];
    summaries: Array<{ summaryType: string; summaryDate?: string; title: string; body: string }>;
    rejectedOpportunities: Array<{ symbol: string; explanation: string }>;
    marketDataStatus: Array<{ symbol: string; source: string; fetchedAt: string; isFresh: boolean; status: string; userMessage: string }>;
    equityHistory: Array<{ recordedAt: string; totalValueUsd: number }>;
    assetUniverse: Array<{ symbol: string; assetType: string; enabled: boolean; tradable: boolean; priceUsd: number | null; freshness: string; status: string; currentPositionValueUsd: number }>;
    opportunities: Array<DashboardOpportunity>;
    profileComparison: DashboardComparison;
    intelligence: DashboardIntelligence;
    marketTicker?: { instruments: NormalizedQuote[]; generatedAt: string };
    profileHoldingQuotes?: { profiles: Array<{ portfolioId: string; holdings: HoldingQuote[] }>; generatedAt: string };
  };
  const html = renderDashboardHtml(data);

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export function renderDashboardHtml(data: {
  settings: { automationPaused: boolean };
  performance: {
    totalValueUsd: number;
    cashUsd: number;
    todayGainLossUsd?: number;
    totalReturnUsd: number;
    priceReturnUsd: number;
    dividendReturnUsd: number;
    tradeCount: number;
    maxDrawdownPct: number;
    benchmarkReturns: Array<{ benchmarkName: string; returnPct: number; latestValueUsd: number }>;
  };
  positions: Array<{ symbol: string; assetClass?: string; quantity: number; marketValueUsd: number }>;
  recommendations: Array<{ symbol: string; action: string; explanation: string }>;
  journal?: Array<{ symbol?: string; decision: string; explanation: string; confidenceScore?: number; createdAt?: string }>;
  trades: Array<{ symbol: string; side: string; quantity: number; priceUsd: number; executedAt?: string }>;
  scheduledRuns: Array<{ runKey: string; status: string; startedAt: string; errorDetails?: string }>;
  scheduledRunAudits?: DashboardScheduledRunAudit[];
  summaries: Array<{ summaryType: string; summaryDate?: string; title: string; body: string }>;
  rejectedOpportunities: Array<{ symbol: string; explanation: string }>;
  marketDataStatus?: Array<{ symbol: string; source: string; fetchedAt: string; isFresh: boolean; status: string; userMessage: string }>;
  equityHistory?: Array<{ recordedAt: string; totalValueUsd: number }>;
  assetUniverse?: Array<{ symbol: string; assetType: string; enabled: boolean; tradable: boolean; priceUsd: number | null; freshness: string; status: string; currentPositionValueUsd: number }>;
  opportunities?: Array<DashboardOpportunity>;
  profileComparison?: DashboardComparison;
  intelligence?: DashboardIntelligence;
  marketTicker?: { instruments: NormalizedQuote[]; generatedAt: string };
  profileHoldingQuotes?: { profiles: Array<{ portfolioId: string; holdings: HoldingQuote[] }>; generatedAt: string };
}): string {
  const latestDecision = data.journal?.[0];
  const latestRecommendation = data.recommendations[0];
  const latestDecisionText = latestDecision
    ? `${latestDecision.symbol ?? latestRecommendation?.symbol ?? "Portfolio"} ${latestDecision.decision}`
    : latestRecommendation
      ? `${latestRecommendation.symbol} ${latestRecommendation.action}`
      : "None";
  const nextRun = nextScheduledRunLabel();
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kairox Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
      background: #f4f6f8;
      color: #17202a;
      --page-max: 1360px;
      --page-pad: clamp(16px, 3.5vw, 40px);
      --space-2: 8px;
      --space-3: 12px;
      --space-4: 16px;
      --space-5: 20px;
      --space-6: 24px;
    }
    * { box-sizing: border-box; }
    html, body { max-width: 100%; overflow-x: clip; }
    body { margin: 0; line-height: 1.45; }
    header { padding-block: 24px 18px; background: #121c2e; color: white; }
    .page-shell { width: 100%; max-width: var(--page-max); margin-inline: auto; padding-inline: var(--page-pad); }
    .header-inner { display: grid; justify-items: center; text-align: center; gap: var(--space-2); overflow: hidden; }
    main.page-shell { padding-block: var(--space-5) 44px; display: grid; gap: var(--space-5); min-width: 0; }
    h1 { margin: 0 0 6px; font-size: clamp(1.55rem, 5vw, 2.35rem); letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 1.02rem; letter-spacing: 0; }
    .sub { color: #c8d2e2; margin: 0; }
    .summary, .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-4); align-items: stretch; }
    .two-col { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-5); align-items: start; }
    .panel { background: white; border: 1px solid #dce3eb; border-radius: 8px; padding: var(--space-4); box-shadow: 0 1px 2px rgba(16,24,40,.04); min-width: 0; overflow: hidden; }
    .metric { font-size: clamp(1.35rem, 5vw, 2rem); font-weight: 740; overflow-wrap: anywhere; }
    .metric-sm { font-size: 1.05rem; font-weight: 700; overflow-wrap: anywhere; }
    .label { color: #657386; font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; }
    .row { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); border-top: 1px solid #edf0f4; padding: var(--space-3) 0; }
    .row:first-child { border-top: 0; }
    .card-list { display: grid; gap: var(--space-3); }
    .mini-card { border: 1px solid #edf0f4; border-radius: 8px; padding: var(--space-3); background: #fbfcfd; min-width: 0; }
    .mini-head { display: flex; justify-content: space-between; gap: var(--space-3); align-items: center; margin-bottom: 6px; }
    .muted { color: #64748b; font-size: .86rem; }
    .pill, .badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 9px; font-size: .76rem; font-weight: 700; white-space: nowrap; }
    .pill { background: #e8f1ff; color: #123d75; }
    .badge-buy { background: #dff8ea; color: #12633a; }
    .badge-sell { background: #ffe8e5; color: #9f2f22; }
    .badge-neutral { background: #edf2f7; color: #425466; }
    .status-fresh { background: #dbf7e6; color: #12633a; }
    .status-live { background: #dbf7e6; color: #12633a; }
    .status-delayed { background: #e8f1ff; color: #123d75; }
    .status-cached { background: #fff2cc; color: #7a5400; }
    .status-market-closed { background: #edf2f7; color: #425466; }
    .status-stale { background: #ffe5d0; color: #8a3b12; }
    .status-unavailable { background: #ffe1e1; color: #9f1c1c; }
    .ticker-strip { display: flex; gap: var(--space-3); width: 100%; max-width: 100%; overflow-x: auto; overflow-y: hidden; padding-block: 2px 6px; scrollbar-width: thin; scroll-padding-inline: var(--space-3); contain: layout paint; }
    .ticker-item { width: 190px; min-height: 126px; flex: 0 0 190px; border: 1px solid #dce3eb; border-radius: 8px; padding: var(--space-3); color: inherit; text-decoration: none; background: #fbfcfd; display: grid; gap: 4px; align-content: start; }
    .ticker-top, .quote-line { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-2); }
    .ticker-value { font-weight: 760; font-size: 1rem; }
    .quote-up { color: #12633a; }
    .quote-down { color: #9f2f22; }
    .quote-flat { color: #425466; }
    .holding-quotes { display: grid; gap: var(--space-3); }
    .holding-profile { border-top: 1px solid #edf0f4; padding-top: var(--space-3); }
    .holding-profile:first-child { border-top: 0; padding-top: 0; }
    .holding-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--space-3); }
    .holding-card { color: inherit; text-decoration: none; }
    .history { width: 100%; height: 150px; display: block; }
    .filters { display: flex; gap: var(--space-2); overflow-x: auto; padding-bottom: var(--space-3); scrollbar-width: thin; }
    .filter { border: 1px solid #cfd8e3; background: #f7fafc; color: #1f2a37; border-radius: 999px; padding: 6px 10px; font-size: .78rem; font-weight: 700; }
    .asset-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--space-3); }
    .axis { stroke: #d9e1ea; stroke-width: 1; }
    .line { fill: none; stroke: #246bfe; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    nav { display: flex; justify-content: center; flex-wrap: wrap; gap: var(--space-2); width: 100%; max-width: 100%; padding-top: var(--space-2); contain: layout paint; }
    nav a { color: white; text-decoration: none; border: 1px solid rgba(255,255,255,.3); border-radius: 999px; padding: 6px 10px; white-space: nowrap; }
    a:focus-visible, button:focus-visible, [tabindex]:focus-visible { outline: 3px solid #7db2ff; outline-offset: 3px; }
    pre { white-space: pre-wrap; margin: 0; font-family: inherit; line-height: 1.45; }
    @media (max-width: 1100px) { .summary, .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .two-col { grid-template-columns: 1fr; } }
    @media (max-width: 640px) {
      :root { --page-pad: 14px; }
      header { padding-block: 20px 14px; }
      .summary, .grid, .asset-grid, .holding-grid { grid-template-columns: 1fr; }
      .row { align-items: flex-start; flex-direction: column; gap: 4px; }
      nav { justify-content: flex-start; flex-wrap: wrap; overflow: hidden; padding-bottom: 2px; scrollbar-width: thin; }
      .header-inner { text-align: left; justify-items: start; }
      .ticker-item { flex-basis: 166px; width: 166px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="page-shell header-inner">
      <h1>Kairox</h1>
      <p class="sub">Paper portfolio dashboard. Live trading is disabled.</p>
      <nav>
        <a href="#overview">Overview</a><a href="#positions">Positions</a><a href="#trades">Trades</a>
        <a href="#journal">Decision journal</a><a href="#performance">Performance</a>
        <a href="#scheduled">Scheduled runs</a><a href="#settings">Settings</a>
      </nav>
    </div>
  </header>
  <main class="page-shell">
    ${section("market-ticker", "Market Ticker", `<div class="ticker-strip" data-market-ticker>${(data.marketTicker?.instruments ?? []).map(tickerItem).join("")}</div>`)}
    <section id="overview" class="summary">
      ${summaryMetric("Portfolio value", money(data.performance.totalValueUsd), `Cash ${money(data.performance.cashUsd)}`)}
      ${summaryMetric("Today's gain/loss", signedMoney(data.performance.todayGainLossUsd ?? 0), "Since first snapshot today")}
      ${summaryMetric("Total gain/loss", signedMoney(data.performance.totalReturnUsd), `Max drawdown ${pct(data.performance.maxDrawdownPct)}`)}
      ${summaryMetric("Open positions", String(data.positions.length), data.positions.map((p) => p.symbol).join(", ") || "None")}
      ${summaryMetric("Latest decision", latestDecisionText, latestDecision ? confidenceLabel(latestDecision.confidenceScore) : "No decision yet")}
      ${summaryMetric("Next scheduled run", nextRun, "Every 30 minutes")}
      ${summaryMetric("Automation", data.settings.automationPaused ? "Paused" : "Active", "Paper trading only")}
    </section>
    <section class="grid">
      ${metric("Price return", signedMoney(data.performance.priceReturnUsd))}
      ${metric("Dividend return", signedMoney(data.performance.dividendReturnUsd))}
      ${metric("Trades", String(data.performance.tradeCount))}
      ${metric("Automation", data.settings.automationPaused ? "Paused" : "Active")}
    </section>
    <section class="two-col">
      ${section("positions", "Positions", data.positions.map((p) => positionRow(p)).join(""))}
      ${section("market-data", "Market Data Status", (data.marketDataStatus ?? []).map((m) => marketStatusRow(m)).join(""))}
    </section>
    ${section("holding-quotes", "Holding Quotes", renderHoldingQuotes(data.profileHoldingQuotes?.profiles ?? [], data.profileComparison))}
    ${section("asset-universe", "Asset Universe", renderFilters() + `<div class="asset-grid">${(data.assetUniverse ?? []).map(assetCard).join("")}</div>`)}
    ${section("profiles", "Simulation Profiles", `<div class="asset-grid">${(data.profileComparison?.profiles ?? []).map(profileCard).join("")}</div>`)}
    ${section("intelligence", "Intelligence", renderIntelligence(data.intelligence))}
    ${section("opportunities", "Opportunities", renderFilters() + `<div class="card-list">${(data.opportunities ?? []).map(opportunityCard).join("")}</div>`)}
    <section class="two-col">
      ${section("trades", "Latest Trades", data.trades.map((t) => tradeCard(t)).join(""))}
      ${section("journal", "Decision Journal", (data.journal ?? []).map((j) => decisionCard(j)).join(""))}
    </section>
    ${section("performance", "Performance", renderHistoryChart(data.equityHistory ?? []) + data.performance.benchmarkReturns.map((b) => row(b.benchmarkName, `${pct(b.returnPct)} (${money(b.latestValueUsd)})`)).join(""))}
    ${section("recommendations", "Latest Recommendations", data.recommendations.map((r) => row(`${r.symbol} ${r.action}`, sanitizeForUser(r.explanation, "No action was taken."))).join(""))}
    ${section("scheduled", "Scheduled Runs", renderScheduledAudit(data.scheduledRunAudits ?? []))}
    ${section("settings", "Settings", row("Mode", "Paper only") + row("Automation", data.settings.automationPaused ? "Paused" : "Active") + row("Live trading", "Disabled"))}
    ${section("rejected", "Deferred Opportunities", data.rejectedOpportunities.map((r) => row(r.symbol, sanitizeForUser(r.explanation, "Market data temporarily unavailable; no trade was made."))).join(""))}
    ${section("summaries", "Summaries", data.summaries.map((s) => summaryCard(s)).join(""))}
  </main>
  <script>
    (() => {
      const formatter = new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short"
      });
      function relativeAge(date, mode) {
        const diffMs = Math.max(0, Date.now() - date.getTime());
        const units = [["day", 86400000], ["hour", 3600000], ["minute", 60000], ["second", 1000]];
        const unit = units.find(([, size]) => diffMs >= size) || units[units.length - 1];
        const amount = Math.floor(diffMs / unit[1]);
        const plural = amount === 1 ? unit[0] : unit[0] + "s";
        return (mode === "cached" ? "Cached from " : "Updated ") + amount + " " + plural + " ago";
      }
      document.querySelectorAll("[data-kairox-time]").forEach((node) => {
        const raw = node.getAttribute("data-kairox-time");
        const date = raw ? new Date(raw) : null;
        if (!date || !Number.isFinite(date.getTime())) {
          node.textContent = "Timestamp unavailable";
          return;
        }
        if (date.getTime() - Date.now() > 5 * 60 * 1000) {
          node.textContent = "Timestamp unavailable";
          node.setAttribute("data-kairox-time-status", "clock_skew");
          return;
        }
        const mode = node.getAttribute("data-kairox-time-mode") || "updated";
        node.textContent = formatter.format(date) + " - " + relativeAge(date, mode);
      });
      const marketTicker = document.querySelector("[data-market-ticker]");
      const holdingQuotes = document.querySelector("[data-holding-quotes]");
      const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 8 });
      const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });
      function esc(value) {
        return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
      }
      function quoteChange(item) {
        if (item.absoluteChange === null || item.percentageChange === null) return "Unavailable";
        const arrow = item.direction === "up" ? "▲" : item.direction === "down" ? "▼" : "■";
        const sign = item.absoluteChange > 0 ? "+" : "";
        return arrow + " " + sign + number.format(item.absoluteChange) + " (" + sign + (item.percentageChange * 100).toFixed(2) + "%)";
      }
      function quoteClass(item) {
        return item.direction === "up" ? "quote-up" : item.direction === "down" ? "quote-down" : "quote-flat";
      }
      function quoteValue(item) {
        if (item.price === null) return "Unavailable";
        if (item.unit === "usd") return money.format(item.price);
        if (item.unit === "percent") return number.format(item.price) + "%";
        return number.format(item.price);
      }
      function timeText(value, mode) {
        if (!value) return "Timestamp unavailable";
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? formatter.format(date) + " - " + relativeAge(date, mode) : "Timestamp unavailable";
      }
      function renderTicker(items) {
        if (!marketTicker) return;
        marketTicker.innerHTML = items.map((item) => '<a class="ticker-item" href="/quotes?symbols=' + encodeURIComponent(item.symbol) + '" aria-label="' + esc(item.displayName) + ' quote"><div class="ticker-top"><strong>' + esc(item.shortName) + '</strong><span class="badge status-' + esc(item.freshnessStatus.toLowerCase().replace(/ /g, "-")) + '">' + esc(item.freshnessStatus) + '</span></div><div class="ticker-value">' + esc(quoteValue(item)) + '</div><div class="' + quoteClass(item) + '">' + esc(quoteChange(item)) + '</div><div class="muted">' + esc(item.marketStatus) + " · " + esc(timeText(item.timestamp, item.freshnessStatus === "Cached" ? "cached" : "updated")) + '</div></a>').join("");
      }
      function renderHoldings(profiles) {
        if (!holdingQuotes) return;
        holdingQuotes.innerHTML = profiles.map((profile) => '<div class="holding-profile"><div class="mini-head"><strong>' + esc(profile.displayName || profile.portfolioId) + '</strong><span class="pill">PAPER ONLY</span></div><div class="holding-grid">' + (profile.holdings.length ? profile.holdings.map((item) => '<a class="mini-card holding-card" href="#asset-' + esc(item.symbol.replace(/[^A-Za-z0-9_-]/g, "-")) + '"><div class="mini-head"><strong>' + esc(item.symbol) + '</strong><span class="badge status-' + esc(item.freshnessStatus.toLowerCase().replace(/ /g, "-")) + '">' + esc(item.freshnessStatus) + '</span></div><div class="quote-line"><span>Qty</span><span>' + esc(number.format(item.quantity)) + '</span></div><div class="quote-line"><span>Price</span><span>' + esc(quoteValue(item)) + '</span></div><div class="' + quoteClass(item) + '">' + esc(quoteChange(item)) + '</div><div class="quote-line"><span>Value</span><span>' + esc(item.currentPositionValue === null ? "Unavailable" : money.format(item.currentPositionValue)) + '</span></div><div class="quote-line"><span>Avg cost</span><span>' + esc(money.format(item.averageCost)) + '</span></div><div class="quote-line"><span>Unrealized</span><span>' + esc(item.unrealizedGainLoss === null ? "Unavailable" : money.format(item.unrealizedGainLoss) + " (" + (item.unrealizedGainLossPercentage * 100).toFixed(2) + "%)") + '</span></div><div class="muted">' + esc(item.marketStatus) + " · " + esc(timeText(item.timestamp, item.freshnessStatus === "Cached" ? "cached" : "updated")) + '</div></a>').join("") : '<span class="pill">No open holdings</span>') + '</div></div>').join("");
      }
      function profileNameMap() {
        const map = new Map();
        document.querySelectorAll("[data-profile-name]").forEach((node) => map.set(node.getAttribute("data-profile-id"), node.getAttribute("data-profile-name")));
        return map;
      }
      async function refreshQuotes() {
        try {
          const [tickerResponse, holdingsResponse] = await Promise.all([fetch("/market-ticker"), fetch("/profiles/holdings/quotes")]);
          if (tickerResponse.ok) {
            renderTicker((await tickerResponse.json()).instruments || []);
          }
          if (holdingsResponse.ok) {
            const names = profileNameMap();
            const payload = await holdingsResponse.json();
            renderHoldings((payload.profiles || []).map((profile) => ({ ...profile, displayName: names.get(profile.portfolioId) || profile.portfolioId })));
          }
        } catch {
          return;
        }
      }
      let timer = null;
      function scheduleQuotes() {
        if (timer) clearTimeout(timer);
        const delay = document.hidden ? 10 * 60 * 1000 : 60 * 1000;
        timer = setTimeout(async () => {
          await refreshQuotes();
          scheduleQuotes();
        }, delay);
      }
      document.addEventListener("visibilitychange", scheduleQuotes);
      scheduleQuotes();
    })();
  </script>
</body>
</html>`;
  return html;
}

interface DashboardComparison {
  comparisonPolicy: { normalizedStartIndex: number; explanation: string };
  profiles: Array<{
    portfolioId: string;
    profileKey: string;
    displayName: string;
    philosophy: string;
    riskPosture: string;
    comparisonStartTimestamp: string;
    comparisonStartEquityUsd: number;
    actualEquityUsd: number;
    cashUsd?: number;
    cashPct?: number;
    openPositions?: number;
    latestDecision?: string;
    latestDecisionReason?: string;
    totalReturnPct?: number;
    maxDrawdownPct?: number;
    volatilityPct?: number | null;
    tradeCount?: number;
    recommendationCount?: number;
    journalEntryCount?: number;
    equityHistoryCount?: number;
    paperOnlyLabel?: string;
    normalizedIndex: number;
    normalizedReturnPct: number;
  }>;
}

interface DashboardScheduledRunRow {
  id: string;
  runKey: string;
  cron: string;
  scheduledAt: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  errorDetails: string | null;
  summaryJson: string | null;
  createdAt: string;
}

interface DashboardScheduledRunAudit {
  runKey: string;
  scheduledAt: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  durationMs: number | null;
  finalStatus: string;
  profileCount: number;
  assetsAttempted: number;
  assetsEvaluatedSuccessfully: number;
  assetsSkipped: number;
  providerFailures: number;
  staleDataRejections: number;
  tradesCreated: number;
  duplicatePrevention: boolean;
  errorDetails: string | null;
  skipReason: string | null;
  profiles: Array<{
    displayName: string;
    profileKey: string;
    assetsAttempted: number;
    assetsEvaluatedSuccessfully: number;
    assetsSkipped: number;
    providerFailures: number;
    staleDataRejections: number;
    recommendations: Record<string, number>;
    tradesCreated: number;
    duplicatePrevention: boolean;
    safeguardsTriggered: Array<{ symbol: string; reason: string }>;
  }>;
}

interface DashboardIntelligence {
  story: {
    title: string;
    overallOutlook: string;
    keyEvents: Array<{ title: string; category: string; evidenceScore: number; sampleData: boolean }>;
    importantThemes: string[];
    potentialRisks: string[];
    opportunitiesBeingMonitored: string[];
    noRecommendations: boolean;
    sampleDataNotice?: string;
  };
  categories: { categories: Array<{ name: string; enabled: boolean }> };
  recentEvents: Array<{
    title: string;
    category: string;
    evidenceScore: number;
    affectedSymbols: string[];
    affectedAssetClasses: string[];
    sampleData: boolean;
    summary: string;
  }>;
}

function metric(label: string, value: string): string {
  return `<div class="panel"><div class="label">${escapeHtml(label)}</div><div class="metric">${escapeHtml(value)}</div></div>`;
}

function summaryMetric(label: string, value: string, detail: string): string {
  return `<div class="panel"><div class="label">${escapeHtml(label)}</div><div class="metric-sm">${escapeHtml(value)}</div><div class="muted">${escapeHtml(detail)}</div></div>`;
}

function section(id: string, title: string, body: string): string {
  return `<section id="${id}" class="panel"><h2>${escapeHtml(title)}</h2>${body || '<span class="pill">No records yet</span>'}</section>`;
}

function row(left: string, right: string): string {
  return `<div class="row"><span>${escapeHtml(left)}</span><span>${escapeHtml(right)}</span></div>`;
}

function money(value: number): string {
  return `$${round(value).toFixed(4)}`;
}

function signedMoney(value: number): string {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${money(value)}`;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function positionRow(position: { symbol: string; assetClass?: string; quantity: number; marketValueUsd: number }): string {
  const unit =
    position.assetClass === "crypto"
      ? position.symbol.split("-")[0]
      : position.assetClass === "stock" || position.assetClass === "etf" || position.assetClass === "reit"
        ? "shares"
        : "units";
  return row(position.symbol, `${formatQuantity(position.quantity, position.symbol)} ${unit} · ${money(position.marketValueUsd)}`);
}

function formatQuantity(quantity: number, symbol: string, assetClass?: string): string {
  if (assetClass === "crypto" || symbol.includes("-")) {
    return quantity.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
  }
  return quantity.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function marketStatusRow(status: { symbol: string; source: string; fetchedAt: string; isFresh: boolean; status: string; userMessage: string }): string {
  const label = statusLabel(status);
  return `<div class="row"><span>${escapeHtml(status.symbol)}</span><span>${badge(label, statusClass(label))} ${escapeHtml(statusMessage(label, status.userMessage))}<br><span class="muted">${escapeHtml(status.source)} - ${formatTimestampElement(status.fetchedAt, label === "Cached" ? "cached" : "updated")}</span></span></div>`;
}

function statusLabel(status?: { isFresh: boolean; status: string; userMessage: string }): "Fresh" | "Cached" | "Stale" | "Unavailable" {
  if (!status) {
    return "Unavailable";
  }
  if (/stale/i.test(status.userMessage)) {
    return "Stale";
  }
  if (status.status === "cached") {
    return "Cached";
  }
  if (status.isFresh || status.status === "validated") {
    return "Fresh";
  }
  return "Unavailable";
}

function statusClass(label: string): string {
  return `status-${label.toLowerCase().replace(/\s+/g, "-")}`;
}

function statusMessage(label: string, message: string): string {
  if (label === "Fresh") {
    return "Fresh quote available.";
  }
  if (label === "Cached") {
    return "Using a recent cached market snapshot.";
  }
  if (label === "Stale") {
    return "Latest quote is stale; evaluation may be deferred.";
  }
  return sanitizeForUser(message, "Market data temporarily unavailable; no trade was made.");
}

function tradeCard(trade: { symbol: string; side: string; quantity: number; priceUsd: number; executedAt?: string }): string {
  const sideClass = trade.side === "BUY" ? "badge-buy" : trade.side === "SELL" ? "badge-sell" : "badge-neutral";
  return `<div class="mini-card"><div class="mini-head"><span>${badge(trade.side, sideClass)} <strong>${escapeHtml(trade.symbol)}</strong></span><span class="muted">${formatTimestampElement(trade.executedAt)}</span></div><div>${escapeHtml(formatQuantity(trade.quantity, trade.symbol))} @ ${escapeHtml(money(trade.priceUsd))}</div></div>`;
}

function renderFilters(): string {
  return `<div class="filters">
    ${["All assets", "ETFs", "Stocks", "Crypto", "REITs", "Mutual funds", "Eligible only"].map((label) => `<span class="filter">${escapeHtml(label)}</span>`).join("")}
  </div>`;
}

function assetCard(asset: { symbol: string; assetType: string; enabled: boolean; tradable: boolean; priceUsd: number | null; freshness: string; status: string; currentPositionValueUsd: number }): string {
  const status = asset.enabled ? (asset.tradable ? "Tracked and paper-tradable" : "Tracked only") : "Disabled";
  return `<div class="mini-card" id="asset-${escapeHtml(safeDomId(asset.symbol))}">
    <div class="mini-head"><strong>${escapeHtml(asset.symbol)}</strong>${badge(asset.freshness, statusClass(asset.freshness))}</div>
    <div class="muted">${escapeHtml(asset.assetType.replace("_", " "))} · ${escapeHtml(status)}</div>
    <div>${escapeHtml(asset.priceUsd === null ? "Price/NAV unavailable" : money(asset.priceUsd))}</div>
    <div class="muted">${escapeHtml(asset.status)}</div>
    <div class="muted">Position ${escapeHtml(money(asset.currentPositionValueUsd))}</div>
  </div>`;
}

function opportunityCard(opportunity: DashboardOpportunity): string {
  const decisionClass = opportunity.decision === "BUY" ? "badge-buy" : opportunity.decision === "SELL" ? "badge-sell" : "badge-neutral";
  return `<div class="mini-card">
    <div class="mini-head">
      <span><strong>${escapeHtml(opportunity.rank ? `#${opportunity.rank} ${opportunity.symbol}` : opportunity.symbol)}</strong> <span class="muted">${escapeHtml(opportunity.assetType)}</span></span>
      ${badge(opportunity.decision, decisionClass)}
    </div>
    <div class="row"><span>Score</span><span>${escapeHtml(formatNullableNumber(opportunity.screenScore))}</span></div>
    <div class="row"><span>Confidence</span><span>${escapeHtml(confidenceLabel(opportunity.confidence))}</span></div>
    <div class="row"><span>Price/NAV</span><span>${escapeHtml(opportunity.latestPriceOrNav === null ? "Unavailable" : money(opportunity.latestPriceOrNav))}</span></div>
    <div class="row"><span>Exposure</span><span>${escapeHtml(opportunity.currentExposure === null ? "Unavailable" : pct(opportunity.currentExposure))}</span></div>
    <div class="muted">${escapeHtml(sanitizeForUser(opportunity.exclusionOrSkipReason, "No action was taken."))}</div>
  </div>`;
}

function profileCard(profile: DashboardComparison["profiles"][number]): string {
  return `<div class="mini-card" data-profile-id="${escapeHtml(profile.portfolioId)}" data-profile-name="${escapeHtml(profile.displayName)}">
    <div class="mini-head"><strong>${escapeHtml(profile.displayName)}</strong><span class="pill">${escapeHtml(profile.paperOnlyLabel ?? "VIRTUAL / PAPER ONLY")}</span></div>
    <div class="muted">${escapeHtml(profile.riskPosture)}</div>
    <div>${escapeHtml(money(profile.actualEquityUsd))}</div>
    <div class="muted">Normalized ${escapeHtml(profile.normalizedIndex.toFixed(2))} (${escapeHtml(pct(profile.normalizedReturnPct))})</div>
    <div class="muted">Cash ${escapeHtml(pct(profile.cashPct ?? 0))} · Positions ${escapeHtml(String(profile.openPositions ?? 0))}</div>
    <div class="muted">Latest decision ${escapeHtml(profile.latestDecision ?? "None")}</div>
    <div class="muted">Total return ${escapeHtml(pct(profile.totalReturnPct ?? profile.normalizedReturnPct))} · Max drawdown ${escapeHtml(pct(profile.maxDrawdownPct ?? 0))}</div>
    <div class="muted">Volatility ${escapeHtml(profile.volatilityPct === null || profile.volatilityPct === undefined ? "Needs more history" : pct(profile.volatilityPct))}</div>
    <div class="muted">Isolation: ${escapeHtml(String(profile.tradeCount ?? 0))} trades · ${escapeHtml(String(profile.recommendationCount ?? 0))} recommendations · ${escapeHtml(String(profile.journalEntryCount ?? 0))} journal entries · ${escapeHtml(String(profile.equityHistoryCount ?? 0))} equity points</div>
    <div class="muted">Start ${escapeHtml(money(profile.comparisonStartEquityUsd))} - ${formatTimestampElement(profile.comparisonStartTimestamp)}</div>
    <div class="muted">${escapeHtml(profile.philosophy)}</div>
  </div>`;
}

function tickerItem(item: NormalizedQuote): string {
  return `<a class="ticker-item" href="/quotes?symbols=${encodeURIComponent(item.symbol)}" aria-label="${escapeHtml(item.displayName)} quote">
    <div class="ticker-top"><strong>${escapeHtml(item.shortName)}</strong>${badge(item.freshnessStatus, statusClass(item.freshnessStatus))}</div>
    <div class="ticker-value">${escapeHtml(formatQuoteValue(item))}</div>
    <div class="${escapeHtml(quoteDirectionClass(item.direction))}">${escapeHtml(formatQuoteChange(item))}</div>
    <div class="muted">${escapeHtml(item.marketStatus)} &middot; ${formatTimestampElement(item.timestamp ?? undefined, item.freshnessStatus === "Cached" ? "cached" : "updated")}</div>
  </a>`;
}

function renderHoldingQuotes(
  profiles: Array<{ portfolioId: string; holdings: HoldingQuote[] }>,
  comparison?: DashboardComparison
): string {
  const nameByPortfolio = new Map((comparison?.profiles ?? []).map((profile) => [profile.portfolioId, profile.displayName]));
  if (profiles.length === 0) {
    return '<span class="pill">No quote data yet</span>';
  }
  return `<div class="holding-quotes" data-holding-quotes>${profiles.map((profile) => `
    <div class="holding-profile">
      <div class="mini-head"><strong>${escapeHtml(nameByPortfolio.get(profile.portfolioId) ?? profile.portfolioId)}</strong><span class="pill">PAPER ONLY</span></div>
      <div class="holding-grid">${profile.holdings.length ? profile.holdings.map(holdingQuoteCard).join("") : '<span class="pill">No open holdings</span>'}</div>
    </div>`).join("")}</div>`;
}

function holdingQuoteCard(item: HoldingQuote): string {
  return `<a class="mini-card holding-card" href="#asset-${escapeHtml(safeDomId(item.symbol))}">
    <div class="mini-head"><strong>${escapeHtml(item.symbol)}</strong>${badge(item.freshnessStatus, statusClass(item.freshnessStatus))}</div>
    <div class="quote-line"><span>Qty</span><span>${escapeHtml(formatQuantity(item.quantity, item.symbol, item.assetType))}</span></div>
    <div class="quote-line"><span>Price</span><span>${escapeHtml(formatQuoteValue(item))}</span></div>
    <div class="${escapeHtml(quoteDirectionClass(item.direction))}">${escapeHtml(formatQuoteChange(item))}</div>
    <div class="quote-line"><span>Value</span><span>${escapeHtml(item.currentPositionValue === null ? "Unavailable" : money(item.currentPositionValue))}</span></div>
    <div class="quote-line"><span>Avg cost</span><span>${escapeHtml(money(item.averageCost))}</span></div>
    <div class="quote-line"><span>Unrealized</span><span>${escapeHtml(formatUnrealized(item))}</span></div>
    <div class="muted">${escapeHtml(item.marketStatus)} &middot; ${formatTimestampElement(item.timestamp ?? undefined, item.freshnessStatus === "Cached" ? "cached" : "updated")}</div>
  </a>`;
}

function formatQuoteValue(item: NormalizedQuote): string {
  if (item.price === null) {
    return "Unavailable";
  }
  if (item.unit === "usd") {
    return money(item.price);
  }
  if (item.unit === "percent") {
    return `${item.price.toFixed(item.valuePrecision)}%`;
  }
  return item.price.toFixed(item.valuePrecision);
}

function formatQuoteChange(item: NormalizedQuote): string {
  if (item.absoluteChange === null || item.percentageChange === null) {
    return "Unavailable";
  }
  const arrow = item.direction === "up" ? "▲" : item.direction === "down" ? "▼" : "■";
  const sign = item.absoluteChange > 0 ? "+" : "";
  return `${arrow} ${sign}${item.absoluteChange.toFixed(item.changePrecision)} (${sign}${(item.percentageChange * 100).toFixed(2)}%)`;
}

function formatUnrealized(item: HoldingQuote): string {
  if (item.unrealizedGainLoss === null || item.unrealizedGainLossPercentage === null) {
    return "Unavailable";
  }
  return `${signedMoney(item.unrealizedGainLoss)} (${pct(item.unrealizedGainLossPercentage)})`;
}

function quoteDirectionClass(direction: string): string {
  return direction === "up" ? "quote-up" : direction === "down" ? "quote-down" : "quote-flat";
}

function safeDomId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-");
}

function renderScheduledAudit(audits: DashboardScheduledRunAudit[]): string {
  if (audits.length === 0) {
    return '<span class="pill">No scheduled runs yet</span>';
  }
  return `<div class="card-list">${audits.map((audit) => `<div class="mini-card">
    <div class="mini-head"><strong>${escapeHtml(audit.status)}</strong><span class="pill">${formatTimestampElement(audit.startedAt)}</span></div>
    <div class="muted">${escapeHtml(audit.runKey)}</div>
    <div class="grid">
      ${miniMetric("Profiles", String(audit.profileCount))}
      ${miniMetric("Assets attempted", String(audit.assetsAttempted))}
      ${miniMetric("Successful", String(audit.assetsEvaluatedSuccessfully))}
      ${miniMetric("Skipped", String(audit.assetsSkipped))}
      ${miniMetric("Provider failures", String(audit.providerFailures))}
      ${miniMetric("Stale rejections", String(audit.staleDataRejections))}
      ${miniMetric("Trades", String(audit.tradesCreated))}
      ${miniMetric("Duplicate guard", audit.duplicatePrevention ? "Triggered" : "Clear")}
    </div>
    ${audit.errorDetails ? `<div class="muted">Error: ${escapeHtml(audit.errorDetails)}</div>` : ""}
    ${audit.skipReason ? `<div class="muted">Skipped: ${escapeHtml(audit.skipReason)}</div>` : ""}
    <div class="card-list">${audit.profiles.map(scheduledProfileAudit).join("")}</div>
  </div>`).join("")}</div>`;
}

function scheduledProfileAudit(profile: DashboardScheduledRunAudit["profiles"][number]): string {
  const recommendations = Object.entries(profile.recommendations).map(([action, count]) => `${action}: ${count}`).join(", ") || "None";
  const safeguards = profile.safeguardsTriggered.slice(0, 3).map((item) => `${item.symbol}: ${item.reason}`).join(" | ");
  return `<div class="mini-card">
    <div class="mini-head"><strong>${escapeHtml(profile.displayName)}</strong><span class="pill">VIRTUAL / PAPER ONLY</span></div>
    <div class="muted">Attempted ${escapeHtml(String(profile.assetsAttempted))} · successful ${escapeHtml(String(profile.assetsEvaluatedSuccessfully))} · skipped ${escapeHtml(String(profile.assetsSkipped))}</div>
    <div class="muted">Recommendations: ${escapeHtml(recommendations)} · trades ${escapeHtml(String(profile.tradesCreated))}</div>
    <div class="muted">Provider failures ${escapeHtml(String(profile.providerFailures))} · stale ${escapeHtml(String(profile.staleDataRejections))} · duplicate guard ${escapeHtml(profile.duplicatePrevention ? "triggered" : "clear")}</div>
    ${safeguards ? `<div class="muted">Safeguards: ${escapeHtml(safeguards)}</div>` : ""}
  </div>`;
}

function miniMetric(label: string, value: string): string {
  return `<div class="mini-card"><div class="label">${escapeHtml(label)}</div><div class="metric-sm">${escapeHtml(value)}</div></div>`;
}

function renderIntelligence(intelligence?: DashboardIntelligence): string {
  if (!intelligence) {
    return '<span class="pill">No intelligence records yet</span>';
  }
  const story = intelligence.story;
  return `<div class="card-list">
    <div class="mini-card">
      <div class="mini-head"><strong>${escapeHtml(story.title)}</strong><span class="pill">${escapeHtml(story.overallOutlook)}</span></div>
      <div class="muted">${escapeHtml(story.noRecommendations ? "No buy/sell recommendations. Intelligence only." : "Intelligence summary.")}</div>
      ${story.sampleDataNotice ? `<div class="muted">${escapeHtml(story.sampleDataNotice)}</div>` : ""}
      <div class="muted">Themes: ${escapeHtml(story.importantThemes.join(", ") || "None")}</div>
      <div class="muted">Watching: ${escapeHtml(story.opportunitiesBeingMonitored.join(", ") || "None")}</div>
    </div>
    <div class="asset-grid">${intelligence.recentEvents.slice(0, 6).map(intelligenceCard).join("")}</div>
  </div>`;
}

function intelligenceCard(event: DashboardIntelligence["recentEvents"][number]): string {
  return `<div class="mini-card">
    <div class="mini-head"><strong>${escapeHtml(event.title)}</strong><span class="pill">${escapeHtml(event.category)}</span></div>
    <div class="metric-sm">${escapeHtml((event.evidenceScore * 100).toFixed(1))}% evidence</div>
    <div class="muted">Affected: ${escapeHtml([...event.affectedSymbols, ...event.affectedAssetClasses].join(", ") || "None listed")}</div>
    <div>${escapeHtml(sanitizeForUser(event.summary, "Intelligence summary unavailable."))}</div>
    ${event.sampleData ? '<div class="muted">Sample fixture, not current news.</div>' : ""}
  </div>`;
}

function formatNullableNumber(value: number | null): string {
  return value === null ? "Unavailable" : value.toFixed(2);
}

function decisionCard(decision: { symbol?: string; decision: string; explanation: string; confidenceScore?: number; createdAt?: string }): string {
  return `<div class="mini-card"><div class="mini-head"><strong>${escapeHtml(decision.symbol ?? "Portfolio")} ${escapeHtml(decision.decision)}</strong><span class="pill">${escapeHtml(confidenceLabel(decision.confidenceScore))}</span></div><div class="muted">${formatTimestampElement(decision.createdAt)}</div><div>${escapeHtml(sanitizeForUser(decision.explanation, "No action was taken."))}</div></div>`;
}

function confidenceLabel(value?: number): string {
  return typeof value === "number" ? `${Math.round(value * 100)}% confidence` : "Confidence unavailable";
}

function badge(label: string, className: string): string {
  return `<span class="badge ${className}">${escapeHtml(label)}</span>`;
}

function nextScheduledRunLabel(now = new Date()): string {
  const next = new Date(now);
  const minutes = next.getUTCMinutes();
  const addMinutes = minutes < 30 ? 30 - minutes : 60 - minutes;
  next.setUTCMinutes(minutes + addMinutes, 0, 0);
  return formatDashboardTimestamp(next.toISOString()).text;
}

function renderHistoryChart(history: Array<{ recordedAt: string; totalValueUsd: number }>): string {
  if (history.length < 2) {
    return `<div class="mini-card"><strong>Portfolio History</strong><div class="muted">Chart will appear after more portfolio snapshots are recorded.</div></div>`;
  }
  const width = 640;
  const height = 150;
  const values = history.map((point) => point.totalValueUsd);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = history.map((point, index) => {
    const x = history.length === 1 ? 0 : (index / (history.length - 1)) * width;
    const y = height - ((point.totalValueUsd - min) / range) * (height - 18) - 9;
    return `${round(x)},${round(y)}`;
  }).join(" ");
  return `<div class="mini-card"><strong>Portfolio History</strong><svg class="history" viewBox="0 0 ${width} ${height}" role="img" aria-label="Portfolio value history"><line class="axis" x1="0" y1="${height - 8}" x2="${width}" y2="${height - 8}"></line><polyline class="line" points="${points}"></polyline></svg><div class="muted">${escapeHtml(money(values[0]))} to ${escapeHtml(money(values.at(-1) ?? values[0]))}</div></div>`;
}

function summaryCard(summary: { summaryType: string; summaryDate?: string; title: string; body: string }): string {
  return `<div class="mini-card"><div class="mini-head"><strong>${escapeHtml(summary.title)}</strong><span class="muted">${escapeHtml(summary.summaryDate ?? summary.summaryType)}</span></div><pre>${escapeHtml(sanitizeForUser(summary.body, "Summary includes only user-safe market and portfolio information."))}</pre></div>`;
}

function formatTimestampElement(value?: string, mode: "updated" | "cached" = "updated"): string {
  const formatted = formatDashboardTimestamp(value, new Date(), undefined, mode);
  const fallback = formatted.status === "clock_skew" || formatted.status === "missing" || formatted.status === "invalid" ? "Timestamp unavailable" : "Loading timestamp";
  return `<time data-kairox-time="${escapeHtml(value ?? "")}" data-kairox-time-mode="${mode}" data-kairox-time-status="${formatted.status}">${escapeHtml(fallback)}</time>`;
}

export function formatDashboardTimestamp(
  value?: string,
  now = new Date(),
  timeZone?: string,
  mode: "updated" | "cached" = "updated"
): { text: string; status: "ok" | "missing" | "invalid" | "clock_skew" } {
  if (!value) {
    return { text: "Timestamp unavailable", status: "missing" };
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return { text: "Timestamp unavailable", status: "invalid" };
  }
  if (date.getTime() - now.getTime() > 5 * 60 * 1000) {
    return { text: "Timestamp unavailable", status: "clock_skew" };
  }
  const absolute = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    ...(timeZone ? { timeZone } : {})
  }).format(date);
  return { text: `${absolute} - ${relativeAge(date, now, mode)}`, status: "ok" };
}

export function relativeAge(date: Date, now = new Date(), mode: "updated" | "cached" = "updated"): string {
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const value =
    diffMs >= day
      ? { amount: Math.floor(diffMs / day), unit: "day" }
      : diffMs >= hour
        ? { amount: Math.floor(diffMs / hour), unit: "hour" }
        : diffMs >= minute
          ? { amount: Math.floor(diffMs / minute), unit: "minute" }
          : { amount: Math.floor(diffMs / 1000), unit: "second" };
  const plural = value.amount === 1 ? value.unit : `${value.unit}s`;
  const prefix = mode === "cached" ? "Cached from" : "Updated";
  return `${prefix} ${value.amount} ${plural} ago`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}
