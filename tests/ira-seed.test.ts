import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderDashboardHtml } from "../src/dashboard/service.ts";

const migration = readFileSync("migrations/0013_seed_ira_account.sql", "utf8");

test("IRA seed creates a standard active paper investment account", () => {
  assert.doesNotMatch(migration, /'user_ira'/);
  assert.match(migration, /'user_tim'/);
  assert.match(migration, /'broker_paper_ira'/);
  assert.match(migration, /'paper'/);
  assert.match(migration, /'active'/);
  assert.match(migration, /'portfolio_ira'/);
  assert.match(migration, /'IRA'/);
  assert.match(migration, /2400/);
  assert.match(migration, /'USD'/);
  assert.match(migration, /'paper'/);
});

test("IRA seed initializes cash and valuation history at 2400 with no invested positions", () => {
  assert.match(migration, /INSERT OR IGNORE INTO daily_snapshots/);
  assert.match(migration, /'snapshot_portfolio_ira_initial_cash'/);
  assert.match(migration, /INSERT OR IGNORE INTO portfolio_equity_history/);
  assert.match(migration, /'equity_portfolio_ira_initial_funding'/);
  assert.match(migration, /INSERT OR IGNORE INTO valuation_snapshots/);
  assert.match(migration, /'valuation_portfolio_ira_initial_funding'/);
  assert.match(migration, /INSERT OR IGNORE INTO account_daily_snapshots/);
  assert.match(migration, /'daily_portfolio_ira_initial_funding'/);
  assert.match(migration, /'initial_funding'/);
  assert.match(migration, /2400,\s*0,\s*2400/);
  assert.match(migration, /'unavailable'/);
  assert.match(migration, /'\[\]'/);
});

test("IRA seed records account opening and initial funding journey events", () => {
  assert.match(migration, /INSERT OR IGNORE INTO journey_events/);
  assert.match(migration, /'portfolio_ira:account_created:once'/);
  assert.match(migration, /'account_created'/);
  assert.match(migration, /'IRA account opened'/);
  assert.match(migration, /'portfolio_ira:first_deposit:initial_funding'/);
  assert.match(migration, /'first_deposit'/);
  assert.match(migration, /Initial paper funding of \$2,400\.00 was recorded/);
});

test("IRA seed does not create positions, orders, recommendations, or trades", () => {
  assert.doesNotMatch(migration, /INSERT\s+(OR\s+IGNORE\s+)?INTO\s+positions/i);
  assert.doesNotMatch(migration, /INSERT\s+(OR\s+IGNORE\s+)?INTO\s+orders/i);
  assert.doesNotMatch(migration, /INSERT\s+(OR\s+IGNORE\s+)?INTO\s+trades/i);
  assert.doesNotMatch(migration, /INSERT\s+(OR\s+IGNORE\s+)?INTO\s+recommendations/i);
  assert.doesNotMatch(migration, /DELETE FROM|DROP TABLE|UPDATE portfolios/i);
});

test("IRA seed adds an enabled portfolio profile so dashboard paths can discover it normally", () => {
  assert.match(migration, /INSERT OR IGNORE INTO portfolio_profiles/);
  assert.match(migration, /'portfolio_profile_ira'/);
  assert.match(migration, /'ira'/);
  assert.match(migration, /comparison_start_equity_usd/);
  assert.match(migration, /2400,\s*100/);
  assert.match(migration, /INSERT OR IGNORE INTO watchlists/);
  assert.match(migration, /'watchlist_ira_core'/);
});

test("dashboard renders visible paper account cards without frontend hardcoding", () => {
  const html = renderDashboardHtml({
    selectedPortfolioId: "portfolio_ira",
    accountProfiles: [
      { portfolioId: "portfolio_tim_paper", profileKey: "tim_balanced", displayName: "Tim Balanced", riskPosture: "moderate" },
      { portfolioId: "portfolio_ira", profileKey: "ira", displayName: "IRA", riskPosture: "moderate" }
    ],
    settings: { automationPaused: false },
    performance: {
      totalValueUsd: 2400,
      cashUsd: 2400,
      todayGainLossUsd: 0,
      totalReturnUsd: 0,
      priceReturnUsd: 0,
      dividendReturnUsd: 0,
      tradeCount: 0,
      maxDrawdownPct: 0,
      benchmarkReturns: []
    },
    positions: [],
    recommendations: [],
    journal: [],
    trades: [],
    scheduledRuns: [],
    summaries: [],
    rejectedOpportunities: [],
    equityHistory: [{ recordedAt: "2026-07-13T21:00:00.000Z", totalValueUsd: 2400 }]
  });

  assert.match(html, /Accounts/);
  assert.match(html, /href="\/portfolio\?portfolioId=portfolio_tim_paper"/);
  assert.match(html, /href="\/portfolio\?portfolioId=portfolio_ira"/);
  assert.match(html, /<strong>IRA<\/strong>/);
  assert.match(html, /Paper/);
  assert.match(html, /Combined value/);
  assert.match(html, /\$2400\.0000/);
  assert.match(html, /Attention Needed/);
});
