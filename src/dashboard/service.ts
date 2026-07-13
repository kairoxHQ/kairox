import { getBenchmarks } from "../market/benchmarks.ts";
import { calculatePerformance } from "../portfolio/performance.ts";
import { getSettings } from "../settings/service.ts";
import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";
import { getMarketDataStatuses } from "../market/status.ts";
import { sanitizeForUser } from "../shared/messages.ts";

export async function getDashboardData(db: D1Database): Promise<unknown> {
  const [settings, performance, benchmarks, positions, journal, recommendations, trades, scheduledRuns, summaries, rejected, marketStatuses, equityHistory, todayStart] =
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
            finished_at AS finishedAt, status, error_details AS errorDetails
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
        .first<{ totalValueUsd: number }>()
    ]);
  const todayGainLossUsd = performance.totalValueUsd - (todayStart?.totalValueUsd ?? performance.startingBalanceUsd);

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
    summaries,
    rejectedOpportunities: rejected,
    marketDataStatus: marketStatuses,
    equityHistory
  };
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
    journal?: Array<{ symbol?: string; decision: string; explanation: string; confidenceScore?: number }>;
    trades: Array<{ symbol: string; side: string; quantity: number; priceUsd: number; executedAt?: string }>;
    scheduledRuns: Array<{ runKey: string; status: string; startedAt: string; errorDetails?: string }>;
    summaries: Array<{ summaryType: string; title: string; body: string }>;
    rejectedOpportunities: Array<{ symbol: string; explanation: string }>;
    marketDataStatus: Array<{ symbol: string; source: string; fetchedAt: string; isFresh: boolean; status: string; userMessage: string }>;
    equityHistory: Array<{ recordedAt: string; totalValueUsd: number }>;
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
  journal?: Array<{ symbol?: string; decision: string; explanation: string; confidenceScore?: number }>;
  trades: Array<{ symbol: string; side: string; quantity: number; priceUsd: number; executedAt?: string }>;
  scheduledRuns: Array<{ runKey: string; status: string; startedAt: string; errorDetails?: string }>;
  summaries: Array<{ summaryType: string; title: string; body: string }>;
  rejectedOpportunities: Array<{ symbol: string; explanation: string }>;
  marketDataStatus?: Array<{ symbol: string; source: string; fetchedAt: string; isFresh: boolean; status: string; userMessage: string }>;
  equityHistory?: Array<{ recordedAt: string; totalValueUsd: number }>;
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
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; background: #f4f6f8; color: #17202a; }
    body { margin: 0; line-height: 1.45; }
    header { padding: 22px clamp(16px, 4vw, 44px); background: #121c2e; color: white; }
    main { padding: 18px clamp(14px, 4vw, 44px) 44px; display: grid; gap: 18px; max-width: 1180px; margin: 0 auto; }
    h1 { margin: 0 0 6px; font-size: clamp(1.55rem, 5vw, 2.35rem); letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 1.02rem; letter-spacing: 0; }
    .sub { color: #c8d2e2; margin: 0; }
    .summary { display: grid; grid-template-columns: minmax(220px, 1.35fr) repeat(3, minmax(130px, 1fr)); gap: 12px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
    .two-col { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
    .panel { background: white; border: 1px solid #dce3eb; border-radius: 8px; padding: 16px; box-shadow: 0 1px 2px rgba(16,24,40,.04); }
    .metric { font-size: clamp(1.35rem, 5vw, 2rem); font-weight: 740; overflow-wrap: anywhere; }
    .metric-sm { font-size: 1.05rem; font-weight: 700; overflow-wrap: anywhere; }
    .label { color: #657386; font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; }
    .row { display: flex; justify-content: space-between; align-items: center; gap: 12px; border-top: 1px solid #edf0f4; padding: 10px 0; }
    .row:first-child { border-top: 0; }
    .card-list { display: grid; gap: 10px; }
    .mini-card { border: 1px solid #edf0f4; border-radius: 8px; padding: 12px; background: #fbfcfd; }
    .mini-head { display: flex; justify-content: space-between; gap: 10px; align-items: center; margin-bottom: 6px; }
    .muted { color: #64748b; font-size: .86rem; }
    .pill, .badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 9px; font-size: .76rem; font-weight: 700; white-space: nowrap; }
    .pill { background: #e8f1ff; color: #123d75; }
    .badge-buy { background: #dff8ea; color: #12633a; }
    .badge-sell { background: #ffe8e5; color: #9f2f22; }
    .badge-neutral { background: #edf2f7; color: #425466; }
    .status-fresh { background: #dbf7e6; color: #12633a; }
    .status-cached { background: #fff2cc; color: #7a5400; }
    .status-stale { background: #ffe5d0; color: #8a3b12; }
    .status-unavailable { background: #ffe1e1; color: #9f1c1c; }
    .history { width: 100%; height: 150px; display: block; }
    .axis { stroke: #d9e1ea; stroke-width: 1; }
    .line { fill: none; stroke: #246bfe; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    nav { display: flex; gap: 8px; overflow-x: auto; padding: 10px 0 0; }
    nav a { color: white; text-decoration: none; border: 1px solid rgba(255,255,255,.3); border-radius: 999px; padding: 6px 10px; white-space: nowrap; }
    pre { white-space: pre-wrap; margin: 0; font-family: inherit; line-height: 1.45; }
    @media (max-width: 780px) { .summary, .two-col { grid-template-columns: 1fr; } .row { align-items: flex-start; flex-direction: column; gap: 4px; } }
  </style>
</head>
<body>
  <header>
    <h1>Kairox</h1>
    <p class="sub">Paper portfolio dashboard. Live trading is disabled.</p>
    <nav>
      <a href="#overview">Overview</a><a href="#positions">Positions</a><a href="#trades">Trades</a>
      <a href="#journal">Decision journal</a><a href="#performance">Performance</a>
      <a href="#scheduled">Scheduled runs</a><a href="#settings">Settings</a>
    </nav>
  </header>
  <main>
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
    <section class="two-col">
      ${section("trades", "Latest Trades", data.trades.map((t) => tradeCard(t)).join(""))}
      ${section("journal", "Decision Journal", (data.journal ?? []).map((j) => decisionCard(j)).join(""))}
    </section>
    ${section("performance", "Performance", renderHistoryChart(data.equityHistory ?? []) + data.performance.benchmarkReturns.map((b) => row(b.benchmarkName, `${pct(b.returnPct)} (${money(b.latestValueUsd)})`)).join(""))}
    ${section("recommendations", "Latest Recommendations", data.recommendations.map((r) => row(`${r.symbol} ${r.action}`, sanitizeForUser(r.explanation, "No action was taken."))).join(""))}
    ${section("scheduled", "Scheduled Runs", data.scheduledRuns.map((r) => row(r.status, `${r.runKey} ${r.errorDetails ?? ""}`)).join(""))}
    ${section("settings", "Settings", row("Mode", "Paper only") + row("Automation", data.settings.automationPaused ? "Paused" : "Active") + row("Live trading", "Disabled"))}
    ${section("rejected", "Deferred Opportunities", data.rejectedOpportunities.map((r) => row(r.symbol, sanitizeForUser(r.explanation, "Market data temporarily unavailable; no trade was made."))).join(""))}
    ${section("summaries", "Summaries", data.summaries.map((s) => `<div class="mini-card"><strong>${escapeHtml(s.title)}</strong><pre>${escapeHtml(sanitizeForUser(s.body, "Summary includes only user-safe market and portfolio information."))}</pre></div>`).join(""))}
  </main>
</body>
</html>`;
  return html;
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
  return `<div class="row"><span>${escapeHtml(status.symbol)}</span><span>${badge(label, statusClass(label))} ${escapeHtml(statusMessage(label, status.userMessage))}<br><span class="muted">${escapeHtml(status.source)} · ${escapeHtml(formatDateTime(status.fetchedAt))}</span></span></div>`;
}

function statusLabel(status: { isFresh: boolean; status: string; userMessage: string }): "Fresh" | "Cached" | "Stale" | "Unavailable" {
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
  return `status-${label.toLowerCase()}`;
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
  return `<div class="mini-card"><div class="mini-head"><span>${badge(trade.side, sideClass)} <strong>${escapeHtml(trade.symbol)}</strong></span><span class="muted">${escapeHtml(formatDateTime(trade.executedAt))}</span></div><div>${escapeHtml(formatQuantity(trade.quantity, trade.symbol))} @ ${escapeHtml(money(trade.priceUsd))}</div></div>`;
}

function decisionCard(decision: { symbol?: string; decision: string; explanation: string; confidenceScore?: number }): string {
  return `<div class="mini-card"><div class="mini-head"><strong>${escapeHtml(decision.symbol ?? "Portfolio")} ${escapeHtml(decision.decision)}</strong><span class="pill">${escapeHtml(confidenceLabel(decision.confidenceScore))}</span></div><div>${escapeHtml(sanitizeForUser(decision.explanation, "No action was taken."))}</div></div>`;
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
  return formatDateTime(next.toISOString());
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

function formatDateTime(value?: string): string {
  if (!value) {
    return "Not available";
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value;
  }
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}
