import assert from "node:assert/strict";
import { test } from "node:test";
import { renderPortfolioHtml } from "../src/portfolio/service.ts";
import type { NormalizedQuote } from "../src/market/quotes.ts";

const generatedAt = "2026-07-17T14:00:00.000Z";

test("portfolio page renders an investor-focused primary view", () => {
  const html = renderPortfolioHtml({
    portfolioId: "portfolio_ira",
    accountName: "Kairox Conservative IRA",
    riskPosture: "conservative",
    generatedAt,
    guardianSummary: "Everything looks healthy. No action is recommended today.",
    valuation: {
      portfolioId: "portfolio_ira",
      valuationTimestamp: "2026-07-17T14:00:00.000Z",
      positions: [],
      availableCashUsd: 958.5594,
      cashUsd: 958.5594,
      portfolioValueUsd: 1440,
      totalPortfolioValueUsd: 1440,
      totalAccountValueUsd: 2398.5594,
      realizedProfitLossUsd: 0,
      unrealizedProfitLossUsd: 12,
      feesUsd: 0,
      todayChangeUsd: 1.25,
      todayChangePct: 0.000521,
      overallReturnUsd: -1.4406,
      overallReturnPct: -0.0006,
      lastSuccessfulMarketDataUpdateTime: "2026-07-17T13:55:00.000Z",
      dataStatus: "delayed",
      dataMode: "paper"
    },
    holdings: [
      {
        symbol: "VTI",
        displayName: "Vanguard Total Stock Market ETF",
        currentValueUsd: 480,
        todayChangeUsd: 1.2,
        todayChangePct: 0.0025,
        allocationPct: 0.2
      },
      {
        symbol: "BND",
        displayName: "Vanguard Total Bond Market ETF",
        currentValueUsd: 480,
        todayChangeUsd: -0.4,
        todayChangePct: -0.0008,
        allocationPct: 0.2
      }
    ],
    accountOptions: accountOptions("portfolio_ira"),
    marketTicker: marketTicker(),
    recentActivity: [
      {
        kind: "Decision",
        title: "DO_NOTHING",
        detail: "No action was recommended today.",
        createdAt: "2026-07-17T13:30:00.000Z"
      }
    ]
  } as never);

  assert.match(html, /Current account value/);
  assert.match(html, /\$2398\.5594/);
  assert.match(html, /Today&#39;s gain\/loss/);
  assert.match(html, /Lifetime return/);
  assert.match(html, /Cash available/);
  assert.match(html, /Guardian Summary/);
  assert.match(html, /Everything looks healthy\. No action is recommended today\./);
  assert.match(html, /VTI/);
  assert.match(html, /Vanguard Total Stock Market ETF/);
  assert.match(html, /Allocation/);
  assert.match(html, /Recent Activity/);
  assert.match(html, /No action was recommended today\./);
  assert.ok(html.indexOf('id="account-selector"') < html.indexOf('id="market-ticker"'));
  assert.ok(html.indexOf('id="market-ticker"') < html.indexOf('aria-label="Account value"'));
});

test("portfolio page keeps diagnostics and trading controls out of the primary view", () => {
  const html = renderPortfolioHtml({
    portfolioId: "portfolio_tim_paper",
    accountName: "Tim Balanced",
    riskPosture: "moderate",
    generatedAt,
    guardianSummary: "Some market data is not current. Monitoring only until fresh prices are available.",
    valuation: {
      portfolioId: "portfolio_tim_paper",
      valuationTimestamp: "2026-07-17T14:00:00.000Z",
      positions: [],
      availableCashUsd: 20,
      cashUsd: 20,
      portfolioValueUsd: 0,
      totalPortfolioValueUsd: 0,
      totalAccountValueUsd: 20,
      realizedProfitLossUsd: 0,
      unrealizedProfitLossUsd: 0,
      feesUsd: 0,
      todayChangeUsd: 0,
      todayChangePct: 0,
      overallReturnUsd: 0,
      overallReturnPct: 0,
      lastSuccessfulMarketDataUpdateTime: null,
      dataStatus: "unavailable",
      dataMode: "paper"
    },
    accountOptions: accountOptions("portfolio_tim_paper"),
    marketTicker: marketTicker(),
    holdings: [],
    recentActivity: []
  } as never);

  assert.match(html, /Advanced data and diagnostics/);
  assert.doesNotMatch(html, /data-run-|\/paper\/run|PAPER_RUN_SECRET|API_KEY|Provider Health|Scheduled Runs|raw technical/i);
  assert.doesNotMatch(html, /<button/i);
});

test("portfolio page offers mobile-friendly account switching without combining holdings", () => {
  const html = renderPortfolioHtml({
    portfolioId: "portfolio_ira",
    accountName: "IRA",
    riskPosture: "moderate",
    generatedAt,
    guardianSummary: "Everything looks healthy. No action is recommended today.",
    valuation: valuation("portfolio_ira"),
    accountOptions: accountOptions("portfolio_ira"),
    marketTicker: marketTicker(),
    holdings: [
      {
        symbol: "BND",
        displayName: "Vanguard Total Bond Market ETF",
        currentValueUsd: 1400,
        todayChangeUsd: 1,
        todayChangePct: 0.001,
        allocationPct: 0.58
      }
    ],
    recentActivity: []
  } as never);

  const selector = html.slice(html.indexOf('id="account-selector"'), html.indexOf('id="market-ticker"'));
  assert.match(selector, /data-account-selector/);
  assert.match(selector, /Kairox Conservative/);
  assert.match(selector, /Tim Balanced/);
  assert.match(selector, /Kairox High Risk/);
  assert.match(selector, /IRA/);
  assert.match(selector, /href="\/portfolio\?portfolioId=portfolio_kairox_conservative"/);
  assert.match(selector, /href="\/portfolio\?portfolioId=portfolio_tim_paper"/);
  assert.match(selector, /href="\/portfolio\?portfolioId=portfolio_kairox_high_risk"/);
  assert.match(selector, /href="\/portfolio\?portfolioId=portfolio_ira" aria-current="page"/);
  assert.match(html, /\.account-selector \{[^}]*overflow-x: auto/);
  assert.doesNotMatch(html, /SPY Combined|combined holdings|all account holdings/i);
});

test("portfolio page renders the compact five-item market ticker safely", () => {
  const html = renderPortfolioHtml({
    portfolioId: "portfolio_tim_paper",
    accountName: "Tim Balanced",
    riskPosture: "moderate",
    generatedAt,
    guardianSummary: "Everything looks healthy. No action is recommended today.",
    valuation: valuation("portfolio_tim_paper"),
    accountOptions: accountOptions("portfolio_tim_paper"),
    marketTicker: {
      generatedAt,
      instruments: [
        quote("^GSPC", "S&P 500", "up", 6400, 100, 0.015873, "Open", "Delayed", "index"),
        quote("^DJI", "Dow", "down", 45000, -50, -0.00111, "Open", "Delayed", "index"),
        quote("^IXIC", "Nasdaq", "unchanged", 21000, 0, 0, "Open", "Delayed", "index"),
        quote("^VIX", "VIX", "up", 16, 1, 0.066667, "Open", "Delayed", "index"),
        quote("BTC-USD", "BTC-USD", "down", 65000, -250, -0.003831, "Continuous", "Live", "usd"),
        quote("^RUT", "Russell 2000", "up", 2300, 20, 0.008772, "Open", "Delayed", "index")
      ]
    },
    holdings: [],
    recentActivity: []
  } as never);
  const ticker = html.slice(html.indexOf('id="market-ticker"'), html.indexOf('<section class="hero"'));

  assert.match(ticker, /data-portfolio-market-strip/);
  assert.match(ticker, /S&amp;P 500/);
  assert.match(ticker, /Dow/);
  assert.match(ticker, /Nasdaq/);
  assert.match(ticker, /VIX/);
  assert.match(ticker, /BTC-USD/);
  assert.match(ticker, /\+100\.00 \(\+1\.59%\)/);
  assert.match(ticker, /-\$250\.00 \(-0\.38%\)/);
  assert.match(ticker, /Up|Down|Flat/);
  assert.match(ticker, /Open - Delayed/);
  assert.match(ticker, /Continuous - Live/);
  assert.match(ticker, /href="\/quotes\?symbols=%5EGSPC"/);
  assert.doesNotMatch(ticker, /\^RUT|Russell|ticker-item|ticker-strip|data-market-ticker/);
  assert.match(html, /\.market-row \{[^}]*overflow-x: auto/);
  assert.ok(html.indexOf('id="market-ticker"') < html.indexOf('aria-label="Account value"'));
});

test("portfolio ticker unavailable quote states do not leak unsafe values", () => {
  const html = renderPortfolioHtml({
    portfolioId: "portfolio_ira",
    accountName: "IRA",
    riskPosture: "moderate",
    generatedAt,
    guardianSummary: "Some market data is not current. Monitoring only until fresh prices are available.",
    valuation: valuation("portfolio_ira"),
    accountOptions: accountOptions("portfolio_ira"),
    marketTicker: {
      generatedAt,
      instruments: [
        unavailableQuote("^GSPC", "S&P 500"),
        unavailableQuote("^DJI", "Dow"),
        unavailableQuote("^IXIC", "Nasdaq"),
        unavailableQuote("^VIX", "VIX"),
        unavailableQuote("BTC-USD", "BTC-USD")
      ]
    },
    holdings: [],
    recentActivity: []
  } as never);
  const ticker = html.slice(html.indexOf('id="market-ticker"'), html.indexOf('<section class="hero"'));

  assert.match(ticker, /Unavailable/);
  assert.match(ticker, /Unavailable - Unavailable/);
  assert.match(ticker, /Flat/);
  assert.doesNotMatch(ticker, /null|undefined|NaN|Illegal invocation|HTTP 429/);
});

function accountOptions(selectedPortfolioId: string) {
  return [
    { portfolioId: "portfolio_kairox_conservative", displayName: "Kairox Conservative", riskPosture: "conservative", selected: selectedPortfolioId === "portfolio_kairox_conservative" },
    { portfolioId: "portfolio_tim_paper", displayName: "Tim Balanced", riskPosture: "moderate", selected: selectedPortfolioId === "portfolio_tim_paper" },
    { portfolioId: "portfolio_kairox_high_risk", displayName: "Kairox High Risk", riskPosture: "high_risk", selected: selectedPortfolioId === "portfolio_kairox_high_risk" },
    { portfolioId: "portfolio_ira", displayName: "IRA", riskPosture: "moderate", selected: selectedPortfolioId === "portfolio_ira" }
  ];
}

function marketTicker() {
  return {
    generatedAt,
    instruments: [
      quote("^GSPC", "S&P 500", "up", 6400, 100, 0.015873, "Open", "Delayed", "index"),
      quote("^DJI", "Dow", "down", 45000, -50, -0.00111, "Open", "Delayed", "index"),
      quote("^IXIC", "Nasdaq", "unchanged", 21000, 0, 0, "Open", "Delayed", "index"),
      quote("^VIX", "VIX", "up", 16, 1, 0.066667, "Open", "Delayed", "index"),
      quote("BTC-USD", "BTC-USD", "up", 65000, 250, 0.003861, "Continuous", "Live", "usd")
    ]
  };
}

function valuation(portfolioId: string) {
  return {
    portfolioId,
    valuationTimestamp: generatedAt,
    positions: [],
    availableCashUsd: 20,
    cashUsd: 20,
    portfolioValueUsd: 0,
    totalPortfolioValueUsd: 0,
    totalAccountValueUsd: 20,
    realizedProfitLossUsd: 0,
    unrealizedProfitLossUsd: 0,
    feesUsd: 0,
    todayChangeUsd: 0,
    todayChangePct: 0,
    overallReturnUsd: 0,
    overallReturnPct: 0,
    lastSuccessfulMarketDataUpdateTime: null,
    dataStatus: "unavailable",
    dataMode: "paper"
  };
}

function quote(
  symbol: string,
  shortName: string,
  direction: NormalizedQuote["direction"],
  price: number,
  absoluteChange: number,
  percentageChange: number,
  marketStatus: NormalizedQuote["marketStatus"],
  freshnessStatus: NormalizedQuote["freshnessStatus"],
  unit: NormalizedQuote["unit"]
): NormalizedQuote {
  return {
    symbol,
    providerSymbol: symbol,
    displayName: shortName,
    shortName,
    assetType: symbol === "BTC-USD" ? "crypto" : "index",
    price,
    previousClose: price - absoluteChange,
    absoluteChange,
    percentageChange,
    direction,
    timestamp: generatedAt,
    marketStatus,
    freshnessStatus,
    source: "test",
    ageSeconds: 30,
    stale: false,
    unit,
    valuePrecision: 2,
    changePrecision: 2
  };
}

function unavailableQuote(symbol: string, shortName: string): NormalizedQuote {
  return {
    symbol,
    providerSymbol: symbol,
    displayName: shortName,
    shortName,
    assetType: symbol === "BTC-USD" ? "crypto" : "index",
    price: null,
    previousClose: null,
    absoluteChange: null,
    percentageChange: null,
    direction: "unchanged",
    timestamp: null,
    marketStatus: "Unavailable",
    freshnessStatus: "Unavailable",
    source: "test",
    ageSeconds: null,
    stale: true,
    unit: symbol === "BTC-USD" ? "usd" : "index",
    valuePrecision: 2,
    changePrecision: 2
  };
}
