import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";
import { getMarketTickerQuotes, type NormalizedQuote } from "../market/quotes.ts";
import { roundMoney, roundRatio } from "../shared/money.ts";
import { getPortfolioProfile, listPortfolioProfiles } from "./profiles.ts";
import { getPortfolioValuation, type PortfolioValuation, type ValuedPosition } from "./valuation.ts";

interface PortfolioRow {
  id: string;
  userId: string;
  brokerAccountId: string | null;
  name: string;
  cashUsd: number;
  startingBalanceUsd: number;
  currency: string;
  mode: string;
  createdAt: string;
  updatedAt: string;
  accountStatus: string | null;
  accountType: string | null;
}

export async function getPortfolio(db: D1Database, portfolioId = TIM_PORTFOLIO_ID) {
  const portfolio = await db
    .prepare(
      `SELECT p.id, p.user_id AS userId, p.broker_account_id AS brokerAccountId,
        p.name, p.cash_usd AS cashUsd, p.starting_balance_usd AS startingBalanceUsd,
        p.currency, p.mode, p.created_at AS createdAt, p.updated_at AS updatedAt,
        ba.status AS accountStatus, ba.account_type AS accountType
       FROM portfolios p
       LEFT JOIN broker_accounts ba ON ba.id = p.broker_account_id
       WHERE p.id = ?`
    )
    .bind(portfolioId)
    .first<PortfolioRow>();
  const user = portfolio
    ? await db.prepare("SELECT id, name, created_at AS createdAt FROM users WHERE id = ?").bind(portfolio.userId).first()
    : null;
  const positions = await listRows(
    db
      .prepare(
        `SELECT symbol, asset_class AS assetClass, quantity, avg_entry_price_usd AS avgEntryPriceUsd,
          current_price_usd AS currentPriceUsd, market_value_usd AS marketValueUsd, updated_at AS updatedAt
         FROM positions WHERE portfolio_id = ? ORDER BY symbol`
      )
      .bind(portfolioId)
  );
  const goals = await listRows(
    db
      .prepare(
        `SELECT objective, target_description AS targetDescription, created_at AS createdAt
         FROM portfolio_goals WHERE portfolio_id = ?`
      )
      .bind(portfolioId)
  );
  const riskProfile = await db
    .prepare(
      `SELECT risk_level AS riskLevel, max_position_pct AS maxPositionPct,
        max_daily_loss_pct AS maxDailyLossPct, leverage_allowed AS leverageAllowed,
        options_allowed AS optionsAllowed, futures_allowed AS futuresAllowed,
        live_trading_allowed AS liveTradingAllowed
       FROM risk_profiles WHERE portfolio_id = ?`
    )
    .bind(portfolioId)
    .first();

  return { user, portfolio, positions, goals, riskProfile };
}

interface PortfolioPageAsset {
  symbol: string;
  displayName: string;
  assetType: string;
}

interface PortfolioPageActivityRow {
  kind: string;
  title: string;
  detail: string;
  createdAt: string;
}

interface PortfolioPagePriceHistory {
  symbol: string;
  candlesJson: string;
}

interface PortfolioPageHolding {
  symbol: string;
  displayName: string;
  currentValueUsd: number;
  todayChangeUsd: number | null;
  todayChangePct: number | null;
  allocationPct: number;
}

interface PortfolioPageAccountOption {
  portfolioId: string;
  displayName: string;
  riskPosture: string;
  selected: boolean;
}

interface PortfolioPageData {
  portfolioId: string;
  accountName: string;
  riskPosture: string;
  accountOptions?: PortfolioPageAccountOption[];
  marketTicker?: { instruments: NormalizedQuote[]; generatedAt: string };
  valuation: PortfolioValuation;
  holdings: PortfolioPageHolding[];
  guardianSummary: string;
  recentActivity: PortfolioPageActivityRow[];
  generatedAt: string;
}

export async function renderPortfolioPage(db: D1Database, portfolioId = TIM_PORTFOLIO_ID): Promise<Response> {
  const data = await getPortfolioPageData(db, portfolioId);
  return new Response(renderPortfolioHtml(data), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

async function getPortfolioPageData(db: D1Database, portfolioId: string): Promise<PortfolioPageData> {
  const [portfolioData, profile, profiles, marketTicker, valuation, assetRows, priceHistoryRows, recentActivity] = await Promise.all([
    getPortfolio(db, portfolioId),
    getPortfolioProfile(db, portfolioId),
    listPortfolioProfiles(db),
    getMarketTickerQuotes(db),
    getPortfolioValuation(db, portfolioId),
    listRows<PortfolioPageAsset>(
      db.prepare(
        `SELECT symbol, display_name AS displayName, asset_type AS assetType
         FROM assets`
      )
    ),
    listRows<PortfolioPagePriceHistory>(
      db.prepare(
        `SELECT ms.symbol, ms.candles_json AS candlesJson
         FROM market_snapshots ms
         JOIN (
           SELECT symbol, MAX(created_at) AS createdAt
           FROM market_snapshots
           WHERE validation_status = 'validated' AND price_usd > 0
           GROUP BY symbol
         ) latest ON latest.symbol = ms.symbol AND latest.createdAt = ms.created_at`
      )
    ),
    getRecentPortfolioActivity(db, portfolioId)
  ]);
  const assets = new Map(assetRows.map((asset) => [asset.symbol, asset]));
  const previousCloseBySymbol = new Map(priceHistoryRows.map((row) => [row.symbol, previousCloseFromCandles(row.candlesJson)]));
  const holdings = valuation.positions
    .map((position) => portfolioHolding(position, assets.get(position.symbol), valuation.totalAccountValueUsd, previousCloseBySymbol.get(position.symbol) ?? null))
    .sort((left, right) => right.currentValueUsd - left.currentValueUsd || left.symbol.localeCompare(right.symbol));

  return {
    portfolioId,
    accountName: portfolioData.portfolio?.name ?? profile.displayName,
    riskPosture: profile.riskPosture,
    accountOptions: profiles.map((item) => ({
      portfolioId: item.portfolioId,
      displayName: item.displayName,
      riskPosture: item.riskPosture,
      selected: item.portfolioId === portfolioId
    })),
    marketTicker: {
      generatedAt: marketTicker.generatedAt,
      instruments: portfolioTickerInstruments(marketTicker.instruments)
    },
    valuation,
    holdings,
    guardianSummary: guardianSummary(valuation, holdings),
    recentActivity,
    generatedAt: new Date().toISOString()
  };
}

async function getRecentPortfolioActivity(db: D1Database, portfolioId: string): Promise<PortfolioPageActivityRow[]> {
  return listRows<PortfolioPageActivityRow>(
    db
      .prepare(
        `SELECT kind, title, detail, createdAt FROM (
          SELECT 'Trade' AS kind,
            symbol || ' ' || side AS title,
            'Paper trade for ' || quantity || ' shares at $' || printf('%.2f', price_usd) AS detail,
            executed_at AS createdAt
          FROM trades
          WHERE portfolio_id = ?
          UNION ALL
          SELECT 'Decision' AS kind,
            decision AS title,
            explanation AS detail,
            created_at AS createdAt
          FROM decision_journal
          WHERE portfolio_id = ?
          UNION ALL
          SELECT 'Recommendation' AS kind,
            symbol || ' ' || action AS title,
            explanation AS detail,
            created_at AS createdAt
          FROM recommendations
          WHERE portfolio_id = ?
        )
        ORDER BY createdAt DESC
        LIMIT 8`
      )
      .bind(portfolioId, portfolioId, portfolioId)
  );
}

function portfolioHolding(position: ValuedPosition, asset: PortfolioPageAsset | undefined, totalAccountValueUsd: number, previousClose: number | null): PortfolioPageHolding {
  const currentPrice = position.currentMarketPriceUsd;
  const todayChangeUsd = currentPrice !== null && previousClose !== null ? roundMoney((currentPrice - previousClose) * position.quantity) : null;
  return {
    symbol: position.symbol,
    displayName: asset?.displayName ?? friendlySymbolName(position.symbol),
    currentValueUsd: position.currentPositionValueUsd,
    todayChangeUsd,
    todayChangePct: previousClose && previousClose > 0 && todayChangeUsd !== null ? roundRatio((currentPrice! - previousClose) / previousClose) : null,
    allocationPct: totalAccountValueUsd > 0 ? roundRatio(position.currentPositionValueUsd / totalAccountValueUsd) : 0
  };
}

function previousCloseFromCandles(value: string): number | null {
  try {
    const candles = JSON.parse(value) as Array<{ timestamp?: string; close?: number }>;
    const valid = candles.filter((candle) => Number.isFinite(candle.close) && (candle.close ?? 0) > 0);
    return valid.length > 1 ? valid[valid.length - 2].close ?? null : valid.at(-1)?.close ?? null;
  } catch {
    return null;
  }
}

function friendlySymbolName(symbol: string): string {
  if (symbol === "BTC-USD") return "Bitcoin";
  if (symbol === "SPY") return "SPDR S&P 500 ETF Trust";
  return symbol;
}

function guardianSummary(valuation: PortfolioValuation, holdings: PortfolioPageHolding[]): string {
  if (valuation.dataStatus === "unavailable" || valuation.dataStatus === "stale") {
    return "Some market data is not current. Monitoring only until fresh prices are available.";
  }
  const largest = holdings[0];
  if (largest && largest.allocationPct > 0.5) {
    return `${largest.symbol} is more than half of this account. Monitoring concentration; no automatic action is being taken.`;
  }
  if (valuation.todayChangeUsd < 0) {
    return "The account is down slightly today. No action is recommended until the strategy has stronger evidence.";
  }
  return "Everything looks healthy. No action is recommended today.";
}

export function renderPortfolioHtml(data: PortfolioPageData): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(data.accountName)} - Portfolio - Kairox</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
      background: #f7f8fa;
      color: #17202a;
      --page-max: 1120px;
      --page-pad: clamp(16px, 4vw, 40px);
      --line: #dde4ec;
      --muted: #667488;
      --panel: #ffffff;
      --good: #12633a;
      --bad: #9f2f22;
      --ink-soft: #3b4758;
    }
    * { box-sizing: border-box; }
    body { margin: 0; line-height: 1.45; }
    header { background: #101827; color: white; padding-block: 22px 18px; }
    .page-shell { width: 100%; max-width: var(--page-max); margin-inline: auto; padding-inline: var(--page-pad); }
    .header-inner { display: grid; gap: 10px; }
    h1 { margin: 0; font-size: clamp(1.35rem, 4vw, 2rem); letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 1rem; letter-spacing: 0; }
    p { margin: 0; }
    .sub { color: #cbd5e1; }
    nav { display: flex; flex-wrap: wrap; gap: 8px; }
    nav a { color: white; text-decoration: none; border: 1px solid rgba(255,255,255,.28); border-radius: 999px; padding: 6px 10px; }
    main.page-shell { padding-block: 22px 44px; display: grid; gap: 16px; }
    .hero { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: clamp(18px, 4vw, 28px); display: grid; gap: 18px; }
    .hero-grid { display: grid; grid-template-columns: minmax(0, 1.4fr) repeat(2, minmax(170px, .8fr)); gap: 14px; align-items: end; }
    .value { font-size: clamp(2.1rem, 8vw, 4.4rem); font-weight: 780; letter-spacing: 0; line-height: 1; overflow-wrap: anywhere; }
    .metric-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .metric, .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px; min-width: 0; }
    .label { color: var(--muted); font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; }
    .metric-value { font-size: 1.22rem; font-weight: 740; overflow-wrap: anywhere; }
    .muted { color: var(--muted); font-size: .9rem; }
    .good { color: var(--good); }
    .bad { color: var(--bad); }
    .flat { color: var(--ink-soft); }
    .guardian { border-left: 4px solid #2a6fdb; background: #f8fbff; }
    .holdings { display: grid; gap: 8px; }
    .holding { display: grid; grid-template-columns: minmax(150px, 1.2fr) minmax(110px, .7fr) minmax(110px, .7fr) minmax(90px, .45fr); gap: 12px; align-items: center; padding: 12px 0; border-top: 1px solid #edf1f5; }
    .holding:first-child { border-top: 0; }
    .symbol { font-weight: 760; }
    .activity { position: relative; display: grid; gap: 0; }
    .activity-item { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 10px; padding: 0 0 16px; }
    .dot { width: 10px; height: 10px; border-radius: 999px; background: #2a6fdb; margin-top: 6px; box-shadow: 0 0 0 4px #e8f1ff; }
    .activity-title { font-weight: 720; }
    .empty { color: var(--muted); padding: 10px 0; }
    .account-selector { display: flex; gap: 10px; overflow-x: auto; padding: 2px 2px 8px; scrollbar-width: thin; }
    .account-choice { flex: 0 0 178px; border: 1px solid var(--line); border-radius: 8px; padding: 10px; color: inherit; text-decoration: none; background: #fbfcfd; display: grid; gap: 3px; }
    .account-choice[aria-current="page"] { border-color: #2a6fdb; background: #f4f8ff; box-shadow: inset 0 0 0 1px #2a6fdb; }
    .account-choice-name { font-weight: 740; }
    .account-choice-state { color: #1f5ed8; font-size: .78rem; font-weight: 720; }
    .market-strip { display: grid; gap: 10px; }
    .market-strip-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
    .market-strip-head h2 { margin: 0; }
    .market-row { display: flex; gap: 10px; overflow-x: auto; padding: 2px 2px 8px; scrollbar-width: thin; }
    .market-quote { flex: 0 0 170px; border: 1px solid #edf1f5; border-radius: 8px; background: #fbfcfd; padding: 10px; color: inherit; text-decoration: none; display: grid; gap: 3px; }
    .market-quote-top { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
    .market-symbol { font-weight: 740; }
    .market-value { font-weight: 760; }
    .market-change, .freshness { font-size: .84rem; }
    .quote-up { color: var(--good); }
    .quote-down { color: var(--bad); }
    .quote-flat { color: var(--ink-soft); }
    details { background: transparent; border-top: 1px solid #edf1f5; padding-top: 12px; }
    summary { cursor: pointer; color: var(--ink-soft); font-weight: 700; }
    .advanced-links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .advanced-links a { color: #1f5ed8; text-decoration: none; border: 1px solid var(--line); border-radius: 999px; padding: 6px 10px; background: white; }
    a:focus-visible, summary:focus-visible { outline: 3px solid #7db2ff; outline-offset: 3px; }
    @media (max-width: 860px) { .hero-grid, .metric-grid { grid-template-columns: 1fr; } .holding { grid-template-columns: 1fr 1fr; } }
    @media (max-width: 560px) { :root { --page-pad: 14px; } .holding { grid-template-columns: 1fr; gap: 4px; } }
  </style>
</head>
<body>
  <header>
    <div class="page-shell header-inner">
      <h1>${escapeHtml(data.accountName)}</h1>
      <p class="sub">Investor-focused account view. Paper trading protections remain active.</p>
      <nav aria-label="Primary navigation">
        <a href="/">Home</a>
        <a href="/dashboard?portfolioId=${encodeURIComponent(data.portfolioId)}">Dashboard</a>
        <a href="/daily-reviews?portfolioId=${encodeURIComponent(data.portfolioId)}">Daily Review</a>
        <a href="/research?portfolioId=${encodeURIComponent(data.portfolioId)}">Research</a>
      </nav>
    </div>
  </header>
  <main class="page-shell">
    ${renderAccountSelector(data.accountOptions, data.portfolioId)}
    ${renderCompactMarketTicker(data.marketTicker)}
    <section class="hero" aria-label="Account value">
      <div class="hero-grid">
        <div>
          <div class="label">Current account value</div>
          <div class="value">${escapeHtml(money(data.valuation.totalAccountValueUsd))}</div>
          <div class="muted">${escapeHtml(paperModeLabel(data.riskPosture))}</div>
        </div>
        ${metric("Today's gain/loss", `${signedMoney(data.valuation.todayChangeUsd)} (${signedPct(data.valuation.todayChangePct)})`, "Since today's opening snapshot", signedClass(data.valuation.todayChangeUsd))}
        ${metric("Lifetime return", `${signedMoney(data.valuation.overallReturnUsd)} (${signedPct(data.valuation.overallReturnPct)})`, "Since account funding", signedClass(data.valuation.overallReturnUsd))}
      </div>
      <div class="metric-grid">
        ${metric("Cash available", money(data.valuation.cashUsd), "Available for future paper trades")}
        ${metric("Holdings value", money(data.valuation.totalPortfolioValueUsd), `${data.holdings.length} holding${data.holdings.length === 1 ? "" : "s"}`)}
        ${metric("Market data", plainDataStatus(data.valuation.dataStatus), "Used for account valuation")}
      </div>
    </section>
    <section class="panel guardian" id="guardian-summary">
      <h2>Guardian Summary</h2>
      <p>${escapeHtml(data.guardianSummary)}</p>
    </section>
    <section class="panel" id="holdings">
      <h2>Holdings</h2>
      <div class="holdings">
        ${data.holdings.length ? data.holdings.map(holdingRow).join("") : '<p class="empty">No holdings yet. This account is currently in cash.</p>'}
      </div>
    </section>
    <section class="panel" id="recent-activity">
      <h2>Recent Activity</h2>
      <div class="activity">
        ${data.recentActivity.length ? data.recentActivity.map(activityItem).join("") : '<p class="empty">No recent account activity has been recorded.</p>'}
      </div>
    </section>
    <section class="panel">
      <details>
        <summary>Advanced data and diagnostics</summary>
        <div class="advanced-links">
          <a href="/portfolio?portfolioId=${encodeURIComponent(data.portfolioId)}&format=json">Raw portfolio data</a>
          <a href="/valuation?portfolioId=${encodeURIComponent(data.portfolioId)}">Valuation API</a>
          <a href="/historical-performance?portfolioId=${encodeURIComponent(data.portfolioId)}">Analytics</a>
          <a href="/portfolio-decisions?portfolioId=${encodeURIComponent(data.portfolioId)}">Decisions</a>
          <a href="/portfolio-briefings?portfolioId=${encodeURIComponent(data.portfolioId)}">Briefings</a>
        </div>
      </details>
    </section>
  </main>
</body>
</html>`;
}

const PORTFOLIO_TICKER_SYMBOLS = new Set(["^GSPC", "^DJI", "^IXIC", "^VIX", "BTC-USD"]);

function portfolioTickerInstruments(instruments: NormalizedQuote[]): NormalizedQuote[] {
  return instruments.filter((instrument) => PORTFOLIO_TICKER_SYMBOLS.has(instrument.symbol));
}

function renderAccountSelector(options: PortfolioPageAccountOption[] | undefined, selectedPortfolioId: string): string {
  const choices = (options ?? []).filter((option) => option.portfolioId);
  if (choices.length === 0) {
    return "";
  }
  return `<section class="panel" id="account-selector" aria-label="Account selector">
    <h2>Accounts</h2>
    <div class="account-selector" data-account-selector>${choices.map((option) => accountChoice(option, selectedPortfolioId)).join("")}</div>
  </section>`;
}

function accountChoice(option: PortfolioPageAccountOption, selectedPortfolioId: string): string {
  const selected = option.selected || option.portfolioId === selectedPortfolioId;
  return `<a class="account-choice" href="/portfolio?portfolioId=${encodeURIComponent(option.portfolioId)}" ${selected ? 'aria-current="page"' : ""}>
    <span class="account-choice-name">${escapeHtml(option.displayName)}</span>
    <span class="muted">${escapeHtml(titleCase(option.riskPosture))}</span>
    <span class="account-choice-state">${selected ? "Selected" : "View account"}</span>
  </a>`;
}

function renderCompactMarketTicker(ticker?: { instruments: NormalizedQuote[]; generatedAt: string }): string {
  const instruments = portfolioTickerInstruments(ticker?.instruments ?? []);
  if (instruments.length === 0) {
    return "";
  }
  return `<section id="market-ticker" class="panel market-strip" aria-label="Market ticker">
    <div class="market-strip-head">
      <h2>Markets</h2>
      <a class="muted" href="/quotes?symbols=%5EGSPC,%5EDJI,%5EIXIC,%5EVIX,BTC-USD">Full quotes</a>
    </div>
    <div class="market-row" data-portfolio-market-strip>${instruments.map(compactTickerItem).join("")}</div>
  </section>`;
}

function compactTickerItem(item: NormalizedQuote): string {
  return `<a class="market-quote" href="/quotes?symbols=${encodeURIComponent(item.symbol)}" aria-label="${escapeHtml(item.displayName)} quote">
    <div class="market-quote-top"><span class="market-symbol">${escapeHtml(item.shortName)}</span><span class="${escapeHtml(quoteDirectionClass(item.direction))}">${escapeHtml(quoteIndicator(item.direction))}</span></div>
    <div class="market-value">${escapeHtml(formatQuoteValue(item))}</div>
    <div class="market-change ${escapeHtml(quoteDirectionClass(item.direction))}">${escapeHtml(formatCompactQuoteChange(item))}</div>
    <div class="freshness">${escapeHtml(item.marketStatus)} - ${escapeHtml(item.freshnessStatus)}</div>
  </a>`;
}

function quoteIndicator(direction: string): string {
  if (direction === "up") return "Up";
  if (direction === "down") return "Down";
  return "Flat";
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

function formatCompactQuoteChange(item: NormalizedQuote): string {
  if (item.absoluteChange === null || item.percentageChange === null) {
    return "Unavailable";
  }
  const sign = item.absoluteChange > 0 ? "+" : "";
  const value = item.unit === "usd"
    ? `${item.absoluteChange >= 0 ? "+" : "-"}$${Math.abs(item.absoluteChange).toFixed(item.changePrecision)}`
    : `${sign}${item.absoluteChange.toFixed(item.changePrecision)}`;
  const pctSign = item.percentageChange > 0 ? "+" : "";
  return `${value} (${pctSign}${(item.percentageChange * 100).toFixed(2)}%)`;
}

function quoteDirectionClass(direction: string): string {
  return direction === "up" ? "quote-up" : direction === "down" ? "quote-down" : "quote-flat";
}

function metric(label: string, value: string, detail: string, className = ""): string {
  return `<div class="metric"><div class="label">${escapeHtml(label)}</div><div class="metric-value ${className}">${escapeHtml(value)}</div><div class="muted">${escapeHtml(detail)}</div></div>`;
}

function holdingRow(holding: PortfolioPageHolding): string {
  const today = holding.todayChangeUsd === null || holding.todayChangePct === null
    ? "No daily price change available"
    : `${signedMoney(holding.todayChangeUsd)} (${signedPct(holding.todayChangePct)})`;
  return `<article class="holding">
    <div><div class="symbol">${escapeHtml(holding.symbol)}</div><div class="muted">${escapeHtml(holding.displayName)}</div></div>
    <div><div class="label">Current value</div><div>${escapeHtml(money(holding.currentValueUsd))}</div></div>
    <div><div class="label">Today</div><div class="${signedClass(holding.todayChangeUsd ?? 0)}">${escapeHtml(today)}</div></div>
    <div><div class="label">Allocation</div><div>${escapeHtml(pct(holding.allocationPct))}</div></div>
  </article>`;
}

function activityItem(item: PortfolioPageActivityRow): string {
  return `<article class="activity-item">
    <div class="dot" aria-hidden="true"></div>
    <div><div class="activity-title">${escapeHtml(item.title)}</div><div class="muted">${escapeHtml(sanitizeActivity(item.detail))}</div><div class="muted">${escapeHtml(item.kind)} - ${formatDate(item.createdAt)}</div></div>
  </article>`;
}

function sanitizeActivity(value: string): string {
  return value.replace(/PAPER_RUN_SECRET|API_KEY|token|authorization/gi, "protected setting");
}

function paperModeLabel(riskPosture: string): string {
  return `${titleCase(riskPosture)} paper account`;
}

function plainDataStatus(status: string): string {
  if (status === "live") return "Current";
  if (status === "delayed") return "Delayed";
  if (status === "stale") return "Needs refresh";
  return "Unavailable";
}

function money(value: number): string {
  return `$${value.toFixed(4)}`;
}

function signedMoney(value: number): string {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(4)}`;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function signedPct(value: number): string {
  return `${value >= 0 ? "+" : "-"}${Math.abs(value * 100).toFixed(2)}%`;
}

function signedClass(value: number): string {
  if (value > 0) return "good";
  if (value < 0) return "bad";
  return "flat";
}

function titleCase(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "Time unavailable";
  }
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
