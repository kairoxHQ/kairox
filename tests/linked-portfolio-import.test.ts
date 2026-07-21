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
  assert.match(html, /Imported from user-provided CSV/);
  assert.doesNotMatch(html, /High confidence/);
  assert.match(html, /Verified by user/);
  assert.match(html, /No database records are created/);
  assert.doesNotMatch(html, /INSERT INTO|UPDATE portfolios|DELETE FROM positions/);
});

test("import preview uses aggregated CSV rows and approval-ready reconciliation totals", () => {
  const csvInput = {
    cashUsd: 0,
    expectedTotals: {
      portfolioTotalUsd: 401.7712368,
      totalCostBasisUsd: 339.934075447,
      todayGainLossUsd: -2.979362433747,
      totalGainLossUsd: 61.837161352999985
    },
    holdings: [
      { symbol: "GEN", companyName: "Gen Digital", assetClass: "stock", quantity: 7.606, averageCostUsd: 17.925, totalCostUsd: 136.33755, marketValueUsd: 198.59266, todayGainLossUsd: -4.2973793516, totalGainLossUsd: 62.25511, dividendIncomeUsd: 0 },
      { symbol: "FXAIX", companyName: "Fidelity 500", assetClass: "mutual_fund", quantity: 0.411, averageCostUsd: 252.40513381995137, totalCostUsd: 103.73851, marketValueUsd: 106.32569999999998, todayGainLossUsd: -0.20138999999999999, totalGainLossUsd: 2.5871899999999783, dividendIncomeUsd: 0 },
      { symbol: "SOXX", companyName: "iShares Semiconductor ETF", assetClass: "etf", quantity: 0.05069, averageCostUsd: 591.8036654172421, totalCostUsd: 29.9985278, marketValueUsd: 28.0158561, todayGainLossUsd: 1.44719889172, totalGainLossUsd: -1.982671700000001, dividendIncomeUsd: 0 },
      { symbol: "MSFT", companyName: "Microsoft", assetClass: "stock", quantity: 0.060762, averageCostUsd: 411.44, totalCostUsd: 24.99991728, marketValueUsd: 24.1680855, todayGainLossUsd: -0.275859996477, totalGainLossUsd: -0.8318317799999981, dividendIncomeUsd: 0 },
      { symbol: "VOO", companyName: "Vanguard S&P 500 ETF", assetClass: "etf", quantity: 0.022435999999999998, averageCostUsd: 669.0143682920307, totalCostUsd: 15.010006366999999, marketValueUsd: 15.433051319999999, todayGainLossUsd: 0.12698708692, totalGainLossUsd: 0.4230449529999998, dividendIncomeUsd: 0 },
      { symbol: "KO", companyName: "Coca-Cola", assetClass: "stock", quantity: 0.128205, averageCostUsd: 78, totalCostUsd: 9.99999, marketValueUsd: 10.50896385, todayGainLossUsd: -0.01923100641, totalGainLossUsd: 0.5089738500000003, dividendIncomeUsd: 0 },
      { symbol: "VOOG", companyName: "Vanguard S&P 500 Growth ETF", assetClass: "etf", quantity: 0.1228, averageCostUsd: 81.53, totalCostUsd: 10.011884, marketValueUsd: 10.067144, todayGainLossUsd: 0.1228, totalGainLossUsd: 0.05526000000000053, dividendIncomeUsd: 0 },
      { symbol: "ETH-USD", companyName: "Ethereum", assetClass: "crypto", quantity: 0.0024, averageCostUsd: 2122.79, totalCostUsd: 5.094696, marketValueUsd: 4.611191999999999, todayGainLossUsd: 0.0486717768, totalGainLossUsd: -0.4835040000000008, dividendIncomeUsd: 0 },
      { symbol: "BTC-USD", companyName: "Bitcoin", assetClass: "crypto", quantity: 0.000061, averageCostUsd: 77754, totalCostUsd: 4.7429939999999995, marketValueUsd: 4.04858403, todayGainLossUsd: 0.06884016529999999, totalGainLossUsd: -0.6944099699999997, dividendIncomeUsd: 0 }
    ]
  };

  const validation = validateLinkedPortfolioImport(csvInput);
  assert.equal(validation.passed, true);
  assert.equal(Number(validation.sums.portfolioTotalUsd.toFixed(2)), 401.77);
  assert.equal(Number(validation.sums.totalCostBasisUsd.toFixed(2)), 339.93);
  assert.equal(Number(validation.sums.todayGainLossUsd.toFixed(2)), -2.98);
  assert.equal(Number(validation.sums.totalGainLossUsd.toFixed(2)), 61.84);
  assert.equal(validation.issues.length, 0);

  const html = renderLinkedPortfolioImportPreview().text();
  return html.then((body) => {
    assert.match(body, /value="401.77"/);
    assert.match(body, /value="339.93"/);
    assert.match(body, /value="-2.98"/);
    assert.match(body, /value="61.84"/);
    assert.match(body, /value="7.606"/);
    assert.match(body, /value="0.000061"/);
    assert.match(body, /data-raw-value="339.934075447"/);
    assert.match(body, /data-raw-value="591.8036654172421"/);
  });
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
  assert.match(args.join(" "), /"importSource":"CSV"/);
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
