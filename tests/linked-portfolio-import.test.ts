import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approveLinkedPortfolioImport,
  renderLinkedPortfolioImportApproved,
  renderLinkedPortfolioImportPreview,
  TIM_REAL_TWIN_NAME,
  TIM_REAL_TWIN_PORTFOLIO_ID,
  TIM_REAL_WATCHLIST_NAME,
  TIM_REAL_WATCHLIST_PORTFOLIO_ID,
  validateLinkedPortfolioImport
} from "../src/portfolio/linkedImport.ts";

test("import preview displays all screenshot review fields without writing data", async () => {
  const response = renderLinkedPortfolioImportPreview();
  const html = await response.text();

  assert.match(html, /Review Tim Real Watchlist Import/);
  assert.match(html, /Symbol/);
  assert.match(html, /Shares/);
  assert.match(html, /Average Cost\/Share/);
  assert.match(html, /Total Cost/);
  assert.match(html, /Market Value/);
  assert.match(html, /Today&#39;s Gain\/Loss|Today/);
  assert.match(html, /Total Gain\/Loss/);
  assert.match(html, /Dividend Income/);
  assert.match(html, /Import Validation/);
  assert.match(html, /Calculated total gain\/loss/);
  assert.match(html, /name="totalGainLossUsd" readonly/);
  assert.match(html, /Go to next issue/);
  assert.match(html, /Overall confidence/);
  assert.match(html, /disabled>Approve And Create Read Only Watchlist/);
  assert.match(html, /High confidence/);
  assert.match(html, /Verified by user/);
  assert.match(html, /No database records are created/);
  assert.doesNotMatch(html, /INSERT INTO|UPDATE portfolios|DELETE FROM positions/);
});

test("import validation blocks unreconciled totals and duplicate or invalid rows", () => {
  const invalid = validateLinkedPortfolioImport({
    cashUsd: 0,
    expectedTotals: { portfolioTotalUsd: 100, totalCostBasisUsd: 90, todayGainLossUsd: 0, totalGainLossUsd: 10 },
    holdings: [
      { symbol: "VTI", companyName: "Vanguard", assetClass: "etf", quantity: 1, averageCostUsd: 50, totalCostUsd: 50, marketValueUsd: 55, todayGainLossUsd: 0, totalGainLossUsd: 5, dividendIncomeUsd: 0 },
      { symbol: "VTI", companyName: "Duplicate", assetClass: "etf", quantity: -1, averageCostUsd: 40, totalCostUsd: 40, marketValueUsd: 45, todayGainLossUsd: null, totalGainLossUsd: 5, dividendIncomeUsd: 0 },
      { symbol: "", companyName: "Blank", assetClass: "stock", quantity: 1, averageCostUsd: 10, totalCostUsd: 10, marketValueUsd: 9, todayGainLossUsd: null, totalGainLossUsd: null, dividendIncomeUsd: 0 }
    ]
  });
  assert.equal(invalid.passed, false);
  assert.equal(invalid.confidence, "Low");
  assert.match(invalid.issues.map((issue) => issue.message).join(" "), /duplicated|positive share quantity|missing today gain loss|Every holding needs a symbol|Market values/);

  const valid = validateLinkedPortfolioImport({
    cashUsd: 0,
    expectedTotals: { portfolioTotalUsd: 55, totalCostBasisUsd: 50, todayGainLossUsd: 1, totalGainLossUsd: 5 },
    holdings: [{ symbol: "BTC-USD", companyName: "Bitcoin", assetClass: "crypto", quantity: 0.0005, averageCostUsd: 100000, totalCostUsd: 50, marketValueUsd: 55, todayGainLossUsd: 1, totalGainLossUsd: 5, dividendIncomeUsd: 0 }]
  });
  assert.equal(valid.passed, true);
  assert.equal(valid.confidence, "High");
});

test("portfolio total gain loss is calculated from reviewed rows and screenshot mismatch is non-blocking", () => {
  const validation = validateLinkedPortfolioImport({
    cashUsd: 0,
    expectedTotals: {
      portfolioTotalUsd: 401.79,
      totalCostBasisUsd: 340.19,
      todayGainLossUsd: 0.75,
      totalGainLossUsd: 61.84
    },
    holdings: [
      { symbol: "VTI", companyName: "Vanguard Total Stock Market ETF", assetClass: "etf", quantity: 1, averageCostUsd: 100, totalCostUsd: 200.1, marketValueUsd: 230.55, todayGainLossUsd: 0.5, totalGainLossUsd: 30.7, dividendIncomeUsd: 0 },
      { symbol: "SCHD", companyName: "Schwab US Dividend Equity ETF", assetClass: "etf", quantity: 2, averageCostUsd: 70, totalCostUsd: 140.09, marketValueUsd: 171.24, todayGainLossUsd: 0.25, totalGainLossUsd: 31.14, dividendIncomeUsd: 0 }
    ]
  });

  assert.equal(validation.passed, true);
  assert.equal(validation.sums.totalGainLossUsd, 61.60000000000002);
  assert.equal(validation.issues.length, 1);
  assert.equal(validation.issues[0].severity, "warning");
  assert.match(validation.issues[0].message, /Screenshot total gain\/loss differs/);
});

test("approved import creates Tim Real Watchlist as read-only without creating twin or trading records", async () => {
  const db = fakeImportDb();
  const result = await approveLinkedPortfolioImport(db as unknown as D1Database, {
    cashUsd: 123.45,
    expectedTotals: {
      portfolioTotalUsd: 383.45,
      totalCostBasisUsd: 250,
      todayGainLossUsd: 1.5,
      totalGainLossUsd: 133.45
    },
    holdings: [
      {
        symbol: "vti",
        companyName: "Vanguard Total Stock Market ETF",
        assetClass: "etf",
        quantity: 1.25,
        averageCostUsd: 200,
        totalCostUsd: 250,
        marketValueUsd: 260,
        todayGainLossUsd: 1.5,
        totalGainLossUsd: 133.45,
        dividendIncomeUsd: 0.25
      }
    ]
  }, new Date("2026-07-21T12:00:00.000Z"));

  assert.equal(result.watchlistPortfolioId, TIM_REAL_WATCHLIST_PORTFOLIO_ID);
  assert.equal(result.watchlistName, TIM_REAL_WATCHLIST_NAME);
  assert.equal(result.holdingCount, 1);
  assert.equal(result.createTwinLabel, "Create Paper Twin");
  assert.equal(result.watchlist.readOnly, true);
  assert.equal(result.watchlist.managedByKairox, false);

  const sql = db.batched.map((statement) => statement.sql).join("\n");
  const args = db.batched.flatMap((statement) => statement.args);
  assert.match(sql, /INSERT INTO portfolios/);
  assert.match(sql, /read_only_watchlist/);
  assert.match(sql, /INSERT INTO positions/);
  assert.match(sql, /INSERT INTO portfolio_goals/);
  assert.match(sql, /INSERT INTO risk_profiles/);
  assert.match(sql, /INSERT INTO journey_events/);
  assert.doesNotMatch(sql, /paper_portfolio_twin|INSERT INTO orders|INSERT INTO trades|INSERT INTO paper_order_fills|INSERT INTO recommendations|paper_order_executions/i);
  assert.doesNotMatch(args.join(" "), /confidence|High confidence|Verified by user/i);
  assert.match(args.join(" "), /"importSource":"Screenshot"/);
  assert.match(args.join(" "), /"validationPassed":true/);
  assert.match(args.join(" "), /"userApproved":true/);
  assert.ok(args.includes(TIM_REAL_WATCHLIST_PORTFOLIO_ID));
  assert.ok(args.includes(TIM_REAL_WATCHLIST_NAME));
  assert.ok(args.includes(373.45));
  assert.ok(args.includes("VTI"));
  assert.ok(args.includes(1.25));
  assert.ok(args.includes(200));
  assert.ok(args.includes(260));
});

test("approved import result offers paper twin as a separate action", async () => {
  const db = fakeImportDb();
  const result = await approveLinkedPortfolioImport(db as unknown as D1Database, {
    cashUsd: 0,
    expectedTotals: {
      portfolioTotalUsd: 55,
      totalCostBasisUsd: 50,
      todayGainLossUsd: 0,
      totalGainLossUsd: 5
    },
    holdings: [{ symbol: "SCHD", companyName: "Schwab US Dividend Equity ETF", assetClass: "etf", quantity: 2, averageCostUsd: 25, totalCostUsd: 50, marketValueUsd: 55, todayGainLossUsd: 0, totalGainLossUsd: 5 }]
  });
  const response = renderLinkedPortfolioImportApproved(result);
  const html = await response.text();

  assert.match(html, /Create Paper Twin/);
  assert.match(html, new RegExp(TIM_REAL_TWIN_NAME));
  assert.match(html, new RegExp(TIM_REAL_TWIN_PORTFOLIO_ID));
  assert.match(html, /will not keep synchronizing after creation/);
});

function fakeImportDb() {
  const batched: Array<{ sql: string; args: unknown[] }> = [];
  return {
    batched,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            sql,
            args,
            async run() {
              batched.push({ sql, args });
              return {};
            },
            async first() {
              if (/SELECT id FROM portfolios WHERE id = \?/i.test(sql)) {
                return null;
              }
              if (/FROM linked_portfolio_accounts/i.test(sql)) {
                return {
                  portfolioId: String(args[0]),
                  accountType: "read_only_watchlist",
                  linkedPortfolioId: null,
                  relationshipLabel: "Real brokerage holdings baseline",
                  manualEntryEnabled: 1,
                  managedByKairox: 0,
                  readOnly: 1
                };
              }
              return null;
            }
          };
        }
      };
    },
    async batch(statements: Array<{ sql: string; args: unknown[] }>) {
      batched.push(...statements);
      return [];
    }
  };
}
