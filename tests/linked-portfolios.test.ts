import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  assertPortfolioAllowsTradingActions,
  classifyLinkedPortfolioAccount,
  createPaperPortfolioTwinFromReadOnly,
  updateReadOnlyWatchlistManualHoldings
} from "../src/portfolio/accountTypes.ts";

const migration = readFileSync("migrations/0038_linked_portfolios.sql", "utf8");
const accountTypesSource = readFileSync("src/portfolio/accountTypes.ts", "utf8");
const indexSource = readFileSync("src/index.ts", "utf8");
const paperServiceSource = readFileSync("src/paper/service.ts", "utf8");
const allocationSource = readFileSync("src/allocation/proposals.ts", "utf8");
const stagingSource = readFileSync("src/orders/staging.ts", "utf8");
const executionSource = readFileSync("src/orders/execution.ts", "utf8");
const decisionSource = readFileSync("src/decisions/portfolioDecision.ts", "utf8");
const orchestrationSource = readFileSync("src/orchestration/dailyPortfolioOrchestrator.ts", "utf8");
const dailyReviewSource = readFileSync("src/reviews/dailyReview.ts", "utf8");
const dailyManagementSource = readFileSync("src/management/dailyCycle.ts", "utf8");
const strategySource = readFileSync("src/strategy/engine.ts", "utf8");
const recommendationProposalSource = readFileSync("src/recommendations/proposalService.ts", "utf8");

test("linked portfolio migration defines read-only watchlists and paper twins", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS linked_portfolio_accounts/);
  assert.match(migration, /read_only_watchlist/);
  assert.match(migration, /paper_portfolio_twin/);
  assert.match(migration, /linked_portfolio_id/);
  assert.match(migration, /relationship_label/);
  assert.match(migration, /read_only INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /managed_by_kairox INTEGER NOT NULL DEFAULT 1/);
  assert.match(migration, /CHECK \(/);
  assert.match(migration, /trg_linked_portfolio_twin_source_insert/);
  assert.match(migration, /trg_linked_portfolio_twin_source_update/);
  assert.match(migration, /Paper Portfolio Twin must link to a Read Only watchlist/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|LIVE_TRADING_ENABLED/i);
});

test("linked account classification exposes badges and action permissions", () => {
  const readOnly = classifyLinkedPortfolioAccount({
    portfolioId: "portfolio_real",
    accountType: "read_only_watchlist",
    linkedPortfolioId: null,
    relationshipLabel: "Real brokerage baseline",
    manualEntryEnabled: 1,
    managedByKairox: 0,
    readOnly: 1
  }, "portfolio_real");

  assert.equal(readOnly.badgeLabel, "Read Only");
  assert.equal(readOnly.tradingAllowed, false);
  assert.equal(readOnly.orderGenerationAllowed, false);
  assert.equal(readOnly.rebalanceAllowed, false);
  assert.equal(readOnly.manualEntryEnabled, true);

  const twin = classifyLinkedPortfolioAccount({
    portfolioId: "portfolio_twin",
    accountType: "paper_portfolio_twin",
    linkedPortfolioId: "portfolio_real",
    relationshipLabel: "Twin of real brokerage baseline",
    manualEntryEnabled: 0,
    managedByKairox: 1,
    readOnly: 0
  }, "portfolio_twin");

  assert.equal(twin.badgeLabel, "Paper Managed");
  assert.equal(twin.linkedPortfolioId, "portfolio_real");
  assert.equal(twin.tradingAllowed, true);
  assert.equal(twin.managedByKairox, true);
});

test("read-only watchlists fail closed for trading actions", async () => {
  const db = {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return {
                portfolioId: "portfolio_real",
                accountType: "read_only_watchlist",
                linkedPortfolioId: null,
                relationshipLabel: "Real brokerage baseline",
                manualEntryEnabled: 1,
                managedByKairox: 0,
                readOnly: 1
              };
            }
          };
        }
      };
    }
  } as unknown as D1Database;

  await assert.rejects(
    () => assertPortfolioAllowsTradingActions(db, "portfolio_real", "execute paper orders"),
    /Read Only portfolios cannot execute paper orders/
  );
});

test("paper twins are created by copying the read-only baseline once", () => {
  assert.equal(typeof createPaperPortfolioTwinFromReadOnly, "function");
  assert.match(accountTypesSource, /Paper Portfolio Twins must start from a Read Only watchlist/);
  assert.match(accountTypesSource, /INSERT INTO portfolios/);
  assert.match(accountTypesSource, /INSERT INTO positions/);
  assert.match(accountTypesSource, /paper_portfolio_twin/);
  assert.match(accountTypesSource, /linked_portfolio_id/);
  assert.match(accountTypesSource, /live_trading_allowed, created_at[\s\S]*VALUES[\s\S]*0, \?/);
});

test("paper twin cloning copies baseline data without modifying the source", async () => {
  const db = fakeLinkedDb();

  const account = await createPaperPortfolioTwinFromReadOnly(db as unknown as D1Database, {
    sourcePortfolioId: "portfolio_real",
    twinPortfolioId: "portfolio_twin",
    name: "Real Portfolio Twin",
    profileKey: "real_twin",
    now: new Date("2026-07-21T12:00:00.000Z")
  });

  assert.equal(account.badgeLabel, "Paper Managed");
  assert.equal(account.linkedPortfolioId, "portfolio_real");

  const sql = db.batched.map((statement) => statement.sql).join("\n");
  const args = db.batched.flatMap((statement) => statement.args);
  assert.match(sql, /INSERT INTO portfolios/);
  assert.match(sql, /INSERT INTO positions/);
  assert.match(sql, /INSERT INTO portfolio_goals/);
  assert.match(sql, /INSERT INTO risk_profiles/);
  assert.match(sql, /INSERT INTO linked_portfolio_accounts/);
  assert.doesNotMatch(sql, /UPDATE portfolios|DELETE FROM positions|INSERT INTO orders|INSERT INTO trades|INSERT INTO paper_order_fills/i);
  assert.ok(args.includes("portfolio_twin"));
  assert.ok(args.includes("portfolio_real"));
  assert.ok(args.includes("VTI"));
  assert.ok(args.includes(1.25));
  assert.ok(args.includes(201.23));
});

test("manual maintenance is restricted to read-only watchlists and avoids trading tables", async () => {
  const db = fakeLinkedDb();
  const result = await updateReadOnlyWatchlistManualHoldings(db as unknown as D1Database, "portfolio_real", {
    cashUsd: 123.45,
    holdings: [
      { symbol: "vti", assetClass: "etf", quantity: 1.25, averageCostUsd: 200.12, currentPriceUsd: 201.23 },
      { symbol: "BTC-USD", assetClass: "crypto", quantity: 0.003842, averageCostUsd: 65000, marketValueUsd: 260.12 }
    ],
    now: new Date("2026-07-21T12:00:00.000Z")
  });

  assert.deepEqual(result, {
    portfolioId: "portfolio_real",
    cashUsd: 123.45,
    holdingCount: 2,
    updatedAt: "2026-07-21T12:00:00.000Z",
    readOnly: true
  });

  const sql = db.batched.map((statement) => statement.sql).join("\n");
  const args = db.batched.flatMap((statement) => statement.args);
  assert.match(sql, /UPDATE portfolios SET cash_usd/);
  assert.match(sql, /DELETE FROM positions WHERE portfolio_id/);
  assert.match(sql, /INSERT INTO positions/);
  assert.doesNotMatch(sql, /INSERT INTO orders|INSERT INTO trades|INSERT INTO paper_order_fills|INSERT INTO recommendations|UPDATE orders|UPDATE trades/i);
  assert.ok(args.includes("VTI"));
  assert.ok(args.includes("BTC-USD"));
  assert.ok(args.includes(123.45));

  await assert.rejects(
    () => updateReadOnlyWatchlistManualHoldings(fakeLinkedDb({ portfolioRealAccountType: "paper" }) as unknown as D1Database, "portfolio_real", { cashUsd: 1, holdings: [] }),
    /Manual holdings maintenance is restricted to Read Only watchlists/
  );
});

test("existing trading workflow entry points enforce linked account guards", () => {
  for (const source of [
    paperServiceSource,
    allocationSource,
    stagingSource,
    executionSource,
    decisionSource,
    orchestrationSource,
    dailyReviewSource,
    dailyManagementSource,
    strategySource,
    recommendationProposalSource
  ]) {
    assert.match(source, /assertPortfolioAllowsTradingActions/);
  }
});

test("direct API routes remain guarded while manual read-only maintenance is protected", () => {
  assert.match(indexSource, /\/allocation-proposals\/generate/);
  assert.match(indexSource, /generateAllocationProposal/);
  assert.match(indexSource, /stagePaperOrdersOrConflict/);
  assert.match(indexSource, /executePaperOrderBatch/);
  assert.match(indexSource, /DailyPortfolioOrchestrator/);
  assert.match(indexSource, /linked-portfolios/);
  assert.match(indexSource, /manual-holdings/);
  assert.match(indexSource, /updateReadOnlyWatchlistManualHoldings/);
  assert.match(indexSource, /await authorize\(request, env\)/);
});

function fakeLinkedDb(options: { portfolioRealAccountType?: "paper" | "read_only_watchlist" } = {}) {
  const accountType = options.portfolioRealAccountType ?? "read_only_watchlist";
  const batched: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    batched,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const statement = {
            sql,
            args,
            async first() {
              if (/FROM linked_portfolio_accounts/i.test(sql)) {
                const portfolioId = String(args[0]);
                if (portfolioId === "portfolio_real") {
                  return {
                    portfolioId,
                    accountType,
                    linkedPortfolioId: null,
                    relationshipLabel: "Real brokerage baseline",
                    manualEntryEnabled: accountType === "read_only_watchlist" ? 1 : 0,
                    managedByKairox: accountType === "read_only_watchlist" ? 0 : 1,
                    readOnly: accountType === "read_only_watchlist" ? 1 : 0
                  };
                }
                if (portfolioId === "portfolio_twin") {
                  return {
                    portfolioId,
                    accountType: "paper_portfolio_twin",
                    linkedPortfolioId: "portfolio_real",
                    relationshipLabel: "Paper-managed twin of Real Brokerage",
                    manualEntryEnabled: 0,
                    managedByKairox: 1,
                    readOnly: 0
                  };
                }
              }
              if (/FROM portfolios/i.test(sql)) {
                return {
                  id: "portfolio_real",
                  userId: "user_tim",
                  brokerAccountId: null,
                  name: "Real Brokerage",
                  cashUsd: 123.45,
                  startingBalanceUsd: 625.55,
                  currency: "USD",
                  mode: "paper"
                };
              }
              return null;
            },
            async all() {
              if (/FROM positions/i.test(sql)) {
                return { results: [{ symbol: "VTI", assetClass: "etf", quantity: 1.25, avgEntryPriceUsd: 200.12, currentPriceUsd: 201.23, marketValueUsd: 251.54 }] };
              }
              if (/FROM portfolio_goals/i.test(sql)) {
                return { results: [{ objective: "baseline_comparison", targetDescription: "Compare real portfolio to a paper-managed twin." }] };
              }
              if (/FROM risk_profiles/i.test(sql)) {
                return { results: [{ riskLevel: "moderate", maxPositionPct: 0.5, maxDailyLossPct: 0.03, leverageAllowed: 0, optionsAllowed: 0, futuresAllowed: 0 }] };
              }
              return { results: [] };
            },
            async run() {
              return {};
            }
          };
          return statement;
        }
      };
    },
    async batch(statements: Array<{ sql: string; args: unknown[] }>) {
      batched.push(...statements);
      return statements.map(() => ({}));
    }
  };
  return db;
}
