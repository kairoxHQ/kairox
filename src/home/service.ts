import { PortfolioDecisionService, type PortfolioDecision } from "../decisions/portfolioDecision.ts";
import { calculatePerformance, type PerformanceMetrics } from "../portfolio/performance.ts";
import { listPortfolioProfiles } from "../portfolio/profiles.ts";
import { TIM_PORTFOLIO_ID } from "../shared/db.ts";

const IRA_PORTFOLIO_ID = "portfolio_ira";

export interface HomeSummary {
  portfolioHealth: string;
  todaysRecommendation: string;
  portfolioValueUsd: number;
  explanation: string;
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
  const dataUnavailable = recommendation === "Data unavailable";
  const riskReview = recommendation === "Risk intervention" || recommendation === "Review required";
  const drawdownNeedsReview = performance.maxDrawdownPct >= 0.1;
  const portfolioHealth = dataUnavailable
    ? "Data Incomplete"
    : riskReview || drawdownNeedsReview
    ? "Review Needed"
    : performance.totalReturnPct >= -0.02
    ? "Healthy"
    : "Watch";
  const explanation = decision?.summary
    ?? (recommendation === "Hold"
      ? "Your retirement plan remains on track. No action is recommended today."
      : `Kairox recommends ${recommendation.toLowerCase()} based on the latest portfolio review.`);

  return {
    portfolioHealth,
    todaysRecommendation: recommendation,
    portfolioValueUsd: performance.totalValueUsd,
    explanation
  };
}

export function renderHomeHtml(data: HomeData): string {
  const quickActions = [
    { icon: "🏖", title: "Help me retire comfortably", href: `/dashboard?portfolioId=${encodeURIComponent(data.portfolioId)}#simulation-status` },
    { icon: "📈", title: "Grow my investments", href: `/dashboard?portfolioId=${encodeURIComponent(data.portfolioId)}#strategy-analysis` },
    { icon: "💵", title: "Generate income", href: `/dashboard?portfolioId=${encodeURIComponent(data.portfolioId)}#research-center` },
    { icon: "📊", title: "Review my portfolio", href: `/dashboard?portfolioId=${encodeURIComponent(data.portfolioId)}#daily-review` },
    { icon: "🔍", title: "Find opportunities", href: `/dashboard?portfolioId=${encodeURIComponent(data.portfolioId)}#opportunities` },
    { icon: "🎓", title: "Learn about investing", href: `/dashboard?portfolioId=${encodeURIComponent(data.portfolioId)}#portfolio-briefing` }
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
      --accent-soft: #eef5ff;
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
    a:focus-visible, button:focus-visible, input:focus-visible {
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
      padding: clamp(28px, 5vw, 56px);
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
      font-size: clamp(2.35rem, 7vw, 5.1rem);
      line-height: 0.96;
      letter-spacing: 0;
    }
    .prompt {
      margin: 0 0 34px;
      color: #2f3a4d;
      font-size: clamp(1.35rem, 3vw, 2.25rem);
      line-height: 1.1;
      font-weight: 650;
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
      font-size: 1.55rem;
      line-height: 1;
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
      .ask { align-items: stretch; flex-direction: column; }
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
        <div class="eyebrow">${escapeHtml(data.portfolioName)} · Paper portfolio</div>
        <h1><span data-home-greeting>Good Evening</span>, ${escapeHtml(data.userName)}.</h1>
        <p class="prompt">How can I help you today?</p>
        <form class="ask" action="/dashboard" method="get">
          <input type="hidden" name="portfolioId" value="${escapeHtml(data.portfolioId)}">
          <input name="q" autocomplete="off" placeholder="Ask Kairox anything about your portfolio..." aria-label="Ask Kairox anything about your portfolio">
          <button type="submit">Ask</button>
        </form>
        <div class="actions" aria-label="Quick actions">
          ${quickActions.map((action) => `<a class="action" href="${action.href}"><span class="icon" aria-hidden="true">${action.icon}</span><span class="title">${escapeHtml(action.title)}</span></a>`).join("")}
        </div>
      </div>
      <aside class="summary" aria-label="Today's Summary">
        <h2>Today's Summary</h2>
        <div class="summary-grid">
          ${summaryRow("Portfolio Health", data.summary.portfolioHealth)}
          ${summaryRow("Today's Recommendation", data.summary.todaysRecommendation)}
          ${summaryRow("Portfolio Value", money(data.summary.portfolioValueUsd))}
        </div>
        <p>${escapeHtml(data.summary.explanation)}</p>
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

function summaryRow(label: string, value: string): string {
  return `<div class="summary-row"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span></div>`;
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}
