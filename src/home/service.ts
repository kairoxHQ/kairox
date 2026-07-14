import { PortfolioDecisionService, type PortfolioDecision, type PortfolioDecisionRecommendation } from "../decisions/portfolioDecision.ts";
import { calculatePerformance, type PerformanceMetrics } from "../portfolio/performance.ts";
import { listPortfolioProfiles } from "../portfolio/profiles.ts";
import { TIM_PORTFOLIO_ID } from "../shared/db.ts";

const IRA_PORTFOLIO_ID = "portfolio_ira";

type HomeAttentionLevel = "none" | "review" | "policy" | "data" | "action";

export interface HomeSummary {
  portfolioHealth: string;
  todaysRecommendation: string;
  internalRecommendation: PortfolioDecisionRecommendation;
  portfolioValueUsd: number;
  explanation: string;
  reassurance: string;
  technicalDetails: string[];
}

export interface HomeData {
  userName: string;
  portfolioId: string;
  portfolioName: string;
  summary: HomeSummary;
}

export async function renderHome(db: D1Database, portfolioId?: string): Promise<Response> {
  const data = await getHomeData(db, portfolioId);
  return new Response(renderHomeHtml(data), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export async function getHomeData(db: D1Database, requestedPortfolioId?: string): Promise<HomeData> {
  const profiles = await listPortfolioProfiles(db);
  const selectedProfile = requestedPortfolioId
    ? profiles.find((profile) => profile.portfolioId === requestedPortfolioId)
    : profiles.find((profile) => profile.portfolioId === IRA_PORTFOLIO_ID) ?? profiles.find((profile) => profile.portfolioId === TIM_PORTFOLIO_ID) ?? profiles[0];
  const portfolioId = selectedProfile?.portfolioId ?? requestedPortfolioId ?? TIM_PORTFOLIO_ID;
  const [performance, decision] = await Promise.all([
    calculatePerformance(db, portfolioId),
    new PortfolioDecisionService(db).latest(portfolioId).catch(() => null)
  ]);

  return {
    userName: "Tim",
    portfolioId,
    portfolioName: selectedProfile?.displayName ?? "Portfolio",
    summary: buildHomeSummary(performance, decision)
  };
}

export function buildHomeSummary(performance: PerformanceMetrics, decision: PortfolioDecision | null): HomeSummary {
  const recommendation = decision?.primaryRecommendation ?? "Hold";
  const presentation = presentDecision(recommendation);
  const policyViolation = recommendation === "Risk intervention" || decision?.status === "Blocked by policy" || decision?.policyCompliance.compliant === false;
  const needsReview = policyViolation || recommendation === "Review required" || performance.maxDrawdownPct >= 0.1;
  const portfolioHealth = recommendation === "Data unavailable"
    ? "Waiting for updated information"
    : needsReview
    ? "Review suggested"
    : "Within strategy";

  return {
    portfolioHealth,
    todaysRecommendation: policyViolation ? "One investment is outside your chosen limits" : presentation.label,
    internalRecommendation: recommendation,
    portfolioValueUsd: performance.totalValueUsd,
    explanation: homeExplanation(performance, decision, presentation),
    reassurance: reassuranceFor(performance, decision, presentation),
    technicalDetails: technicalDetailsFor(decision)
  };
}

export function presentDecision(value: string): { label: string; attention: HomeAttentionLevel } {
  switch (value) {
    case "Hold":
      return { label: "Stay the course", attention: "none" };
    case "Review recommended":
    case "Review required":
      return { label: "Review suggested", attention: "review" };
    case "Rebalance proposal recommended":
    case "Rebalance":
    case "Deploy excess cash":
    case "Increase cash":
    case "Add to existing position":
    case "Reduce existing position":
      return { label: "Portfolio adjustment suggested", attention: "action" };
    case "Risk intervention":
      return { label: "Attention needed", attention: "policy" };
    case "Data unavailable":
      return { label: "Waiting for updated information", attention: "data" };
    case "Policy violation":
      return { label: "One investment is outside your chosen limits", attention: "policy" };
    default:
      return { label: "Review suggested", attention: "review" };
  }
}

export function renderHomeHtml(data: HomeData): string {
  const quickActions = [
    { icon: "Plan", title: "Help me retire comfortably", href: `/dashboard?portfolioId=${encodeURIComponent(data.portfolioId)}#simulation-status` },
    { icon: "Grow", title: "Grow my investments", href: `/dashboard?portfolioId=${encodeURIComponent(data.portfolioId)}#strategy-analysis` },
    { icon: "Cash", title: "Generate income", href: `/dashboard?portfolioId=${encodeURIComponent(data.portfolioId)}#research-center` },
    { icon: "View", title: "Review my portfolio", href: `/dashboard?portfolioId=${encodeURIComponent(data.portfolioId)}#daily-review` },
    { icon: "Find", title: "Find opportunities", href: `/dashboard?portfolioId=${encodeURIComponent(data.portfolioId)}#opportunities` },
    { icon: "Learn", title: "Learn about investing", href: `/dashboard?portfolioId=${encodeURIComponent(data.portfolioId)}#portfolio-briefing` }
  ];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kairox Home</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --surface: #ffffff;
      --surface-soft: #f9fafb;
      --text: #172033;
      --muted: #647084;
      --border: #e4e8ef;
      --accent: #1f6feb;
      --shadow: 0 24px 70px rgba(31, 42, 55, 0.10);
      --radius: 22px;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(31, 111, 235, 0.08), transparent 34rem),
        linear-gradient(180deg, #ffffff 0%, var(--bg) 50%, #eef1f5 100%);
    }
    a { color: inherit; text-decoration: none; }
    a:focus-visible, button:focus-visible, input:focus-visible, summary:focus-visible {
      outline: 3px solid rgba(31, 111, 235, 0.32);
      outline-offset: 3px;
    }
    .shell {
      width: min(1120px, calc(100% - 40px));
      margin-inline: auto;
    }
    header {
      padding: 28px 0 10px;
    }
    .nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
    }
    .brand {
      font-weight: 760;
      letter-spacing: 0;
      font-size: 1.05rem;
    }
    .links {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 10px;
      color: var(--muted);
      font-size: 0.93rem;
    }
    .links a {
      padding: 8px 10px;
      border-radius: 999px;
    }
    .links a:hover {
      background: var(--surface);
      color: var(--text);
    }
    main {
      padding: 46px 0 64px;
    }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) minmax(280px, 0.75fr);
      gap: 26px;
      align-items: start;
    }
    .conversation {
      padding: 56px;
      background: rgba(255, 255, 255, 0.86);
      border: 1px solid rgba(228, 232, 239, 0.86);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      backdrop-filter: blur(18px);
    }
    .eyebrow {
      color: var(--muted);
      font-size: 0.94rem;
      margin-bottom: 18px;
    }
    h1 {
      margin: 0 0 8px;
      max-width: 11ch;
      font-size: 4.35rem;
      line-height: 0.96;
      letter-spacing: 0;
      overflow-wrap: anywhere;
    }
    .prompt {
      margin: 0 0 34px;
      color: #2f3a4d;
      font-size: 2.15rem;
      line-height: 1.1;
      font-weight: 650;
    }
    .reassurance {
      margin: -16px 0 28px;
      max-width: 48rem;
      color: var(--muted);
      font-size: 1rem;
      line-height: 1.5;
    }
    .ask {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px;
      border: 1px solid var(--border);
      background: var(--surface);
      border-radius: 18px;
      box-shadow: 0 12px 34px rgba(31, 42, 55, 0.08);
    }
    .ask input {
      min-width: 0;
      width: 100%;
      flex: 1;
      border: 0;
      background: transparent;
      color: var(--text);
      font: inherit;
      font-size: 1rem;
      padding: 14px 12px;
    }
    .ask input::placeholder { color: #8a95a6; }
    .ask button {
      border: 0;
      background: var(--accent);
      color: #ffffff;
      font-weight: 700;
      border-radius: 14px;
      padding: 13px 18px;
      cursor: pointer;
    }
    .actions {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-top: 22px;
    }
    .action {
      min-height: 98px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 14px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 18px;
      background: var(--surface-soft);
      transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
    }
    .action:hover {
      transform: translateY(-2px);
      border-color: #c5d6f6;
      background: #ffffff;
    }
    .action .icon {
      color: var(--accent);
      font-size: 0.76rem;
      font-weight: 780;
      letter-spacing: 0;
      line-height: 1;
      text-transform: uppercase;
    }
    .action .title {
      font-weight: 690;
      font-size: 0.98rem;
    }
    .summary {
      padding: 24px;
      background: #172033;
      color: #ffffff;
      border-radius: var(--radius);
      box-shadow: var(--shadow);
    }
    .summary h2 {
      margin: 0 0 18px;
      font-size: 1.1rem;
      letter-spacing: 0;
    }
    .summary-grid {
      display: grid;
      gap: 14px;
    }
    .summary-row {
      padding: 14px 0;
      border-top: 1px solid rgba(255, 255, 255, 0.14);
    }
    .summary-row:first-child { border-top: 0; }
    .label {
      display: block;
      color: rgba(255, 255, 255, 0.66);
      font-size: 0.82rem;
      margin-bottom: 5px;
    }
    .value {
      display: block;
      font-size: 1.18rem;
      font-weight: 740;
    }
    .summary p {
      margin: 20px 0 0;
      color: rgba(255, 255, 255, 0.78);
      line-height: 1.55;
    }
    .summary details {
      margin-top: 18px;
      border-top: 1px solid rgba(255, 255, 255, 0.14);
      padding-top: 14px;
    }
    .summary summary {
      width: fit-content;
      cursor: pointer;
      color: #d9e6ff;
      font-weight: 700;
    }
    .details-list {
      margin: 12px 0 0;
      padding-left: 18px;
      color: rgba(255, 255, 255, 0.74);
      line-height: 1.45;
    }
    .footer-note {
      margin-top: 18px;
      color: var(--muted);
      font-size: 0.92rem;
    }
    @media (max-width: 860px) {
      .hero { grid-template-columns: 1fr; }
      .actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 560px) {
      .shell { width: min(100% - 24px, 1120px); }
      header { padding-top: 18px; }
      .nav { align-items: flex-start; flex-direction: column; }
      .links { justify-content: flex-start; }
      main { padding-top: 22px; }
      .conversation, .summary { border-radius: 18px; }
      .conversation { padding: 26px 20px; }
      h1 { max-width: 100%; font-size: 2.65rem; }
      .prompt { font-size: 1.55rem; }
      .ask { align-items: stretch; flex-direction: column; }
      .ask input { font-size: 0.92rem; padding-inline: 10px; }
      .ask button { width: 100%; }
      .actions { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header class="shell">
    <nav class="nav" aria-label="Primary navigation">
      <a class="brand" href="/">Kairox</a>
      <div class="links">
        <a href="/dashboard?portfolioId=${encodeURIComponent(data.portfolioId)}">Dashboard</a>
        <a href="/portfolio?portfolioId=${encodeURIComponent(data.portfolioId)}">Portfolio</a>
        <a href="/research?portfolioId=${encodeURIComponent(data.portfolioId)}">Research</a>
        <a href="/strategy-runs?portfolioId=${encodeURIComponent(data.portfolioId)}">Strategy</a>
        <a href="/journey?portfolioId=${encodeURIComponent(data.portfolioId)}">Journey</a>
      </div>
    </nav>
  </header>
  <main class="shell">
    <section class="hero" aria-label="Kairox home">
      <div class="conversation">
        <div class="eyebrow">${escapeHtml(data.portfolioName)} &middot; Paper portfolio</div>
        <h1><span data-home-greeting>Good Evening</span>, ${escapeHtml(data.userName)}.</h1>
        <p class="prompt">How can I help you today?</p>
        <p class="reassurance">${escapeHtml(data.summary.reassurance)}</p>
        <form class="ask" action="/dashboard" method="get">
          <input type="hidden" name="portfolioId" value="${escapeHtml(data.portfolioId)}">
          <input name="q" autocomplete="off" placeholder="What would you like help with?" aria-label="Ask Kairox what you would like help with about your paper portfolio">
          <button type="submit">Ask</button>
        </form>
        <div class="actions" aria-label="Quick actions">
          ${quickActions.map((action) => `<a class="action" href="${action.href}" aria-label="${escapeHtml(action.title)}"><span class="icon" aria-hidden="true">${escapeHtml(action.icon)}</span><span class="title">${escapeHtml(action.title)}</span></a>`).join("")}
        </div>
      </div>
      <aside class="summary" aria-label="Today's Briefing">
        <h2>Today's Briefing</h2>
        <div class="summary-grid">
          ${summaryRow("Portfolio Health", data.summary.portfolioHealth)}
          ${summaryRow("Today's Recommendation", data.summary.todaysRecommendation)}
          ${summaryRow("Portfolio Value", money(data.summary.portfolioValueUsd))}
        </div>
        <p>${escapeHtml(data.summary.explanation)}</p>
        <details>
          <summary>View details</summary>
          <ul class="details-list">
            ${data.summary.technicalDetails.map((detail) => `<li>${escapeHtml(detail)}</li>`).join("")}
          </ul>
        </details>
      </aside>
    </section>
    <p class="footer-note">Kairox remains paper-only. Existing dashboards, APIs, and portfolio workflows are still available from the navigation.</p>
  </main>
  <script>
    (() => {
      const hour = new Date().getHours();
      const greeting = hour < 12 ? "Good Morning" : hour < 18 ? "Good Afternoon" : "Good Evening";
      document.querySelectorAll("[data-home-greeting]").forEach((node) => { node.textContent = greeting; });
    })();
  </script>
</body>
</html>`;
}

function homeExplanation(
  performance: PerformanceMetrics,
  decision: PortfolioDecision | null,
  presentation: ReturnType<typeof presentDecision>
): string {
  const reason = plainReason(decision);
  if (presentation.attention === "data") {
    return `Kairox is waiting for updated market information before making a recommendation. ${reason} No immediate trade action is available from this briefing.`;
  }
  if (presentation.attention === "policy") {
    return `One position needs review because it is outside your chosen limits. ${reason} No trade has been placed from this briefing.`;
  }
  if (presentation.attention === "action" || presentation.attention === "review") {
    return `One portfolio item needs review today. ${reason} No immediate action is required until you review the details.`;
  }
  if (performance.maxDrawdownPct >= 0.1) {
    return "Portfolio drawdown is elevated enough to review, even though the latest recommendation is to stay the course. No trade has been placed from this briefing.";
  }
  return "Nothing needs attention today. The latest paper-portfolio decision is to stay the course, and no trade has been placed.";
}

function reassuranceFor(
  performance: PerformanceMetrics,
  decision: PortfolioDecision | null,
  presentation: ReturnType<typeof presentDecision>
): string {
  if (presentation.attention === "data") {
    return "I'm waiting for updated market information before making a recommendation.";
  }
  if (presentation.attention === "policy") {
    return "One position needs review, but no trade has been placed.";
  }
  if (presentation.attention === "action" || presentation.attention === "review" || performance.maxDrawdownPct >= 0.1) {
    return "One position needs review, but no trade has been placed.";
  }
  if (decision?.policyCompliance.compliant === true || !decision) {
    return "Your portfolio remains within its current paper strategy.";
  }
  return "Nothing requires action today.";
}

function plainReason(decision: PortfolioDecision | null): string {
  const policyReason = decision?.policyCompliance.reasons.find(Boolean);
  if (policyReason) {
    return sentence(policyReason);
  }
  const actionReason = decision?.actions.find((action) => action.reason)?.reason;
  if (actionReason) {
    return sentence(actionReason);
  }
  const triggeredRule = decision?.triggeredRules.find(Boolean);
  if (triggeredRule) {
    return sentence(triggeredRule);
  }
  if (decision?.dataQualityStatus && decision.dataQualityStatus !== "fresh") {
    return `Market data status is ${decision.dataQualityStatus}.`;
  }
  return "The latest decision record does not show a material policy exception.";
}

function technicalDetailsFor(decision: PortfolioDecision | null): string[] {
  if (!decision) {
    return ["Internal recommendation: Hold", "No current decision record is available for this portfolio."];
  }
  return [
    `Internal recommendation: ${decision.primaryRecommendation}`,
    `Decision status: ${decision.status}`,
    `Confidence score: ${pct(decision.confidenceScore)}`,
    `Risk score: ${pct(decision.riskScore)}`,
    `Data quality: ${decision.dataQualityStatus}`,
    decision.triggeredRules.length ? `Triggered rules: ${decision.triggeredRules.join(" ")}` : "Triggered rules: none recorded",
    decision.suppressedRules.length ? `Suppressed rules: ${decision.suppressedRules.join(" ")}` : "Suppressed rules: none recorded"
  ];
}

function summaryRow(label: string, value: string): string {
  return `<div class="summary-row"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span></div>`;
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function sentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}
