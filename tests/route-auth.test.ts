import assert from "node:assert/strict";
import { test } from "node:test";
import worker, { requiresMutationAuth } from "../src/index.ts";
import { assertPortfolioAllowsTradingActions } from "../src/portfolio/accountTypes.ts";
import type { Env } from "../src/shared/types.ts";

const protectedMutationRoutes = [
  "/allocation-proposals/generate",
  "/allocation-proposals/proposal_123/approve",
  "/allocation-proposals/proposal_123/reject",
  "/daily-reviews/review_123/proposal",
  "/recommendation-proposals/proposal_123/ready",
  "/recommendation-proposals/proposal_123/regenerate",
  "/recommendation-proposals/proposal_123/reject",
  "/recommendation-proposals/proposal_123/supersede",
  "/paper-order-batches/stage",
  "/paper-order-batches/batch_123/ready",
  "/paper-order-batches/batch_123/reject",
  "/paper-order-batches/batch_123/cancel",
  "/paper-order-batches/batch_123/refresh",
  "/paper-order-batches/batch_123/execute",
  "/daily-management-cycles/run",
  "/daily-reviews/run",
  "/strategy/run",
  "/portfolio-decisions/run",
  "/portfolio-decisions/decision_123/accept",
  "/portfolio-decisions/decision_123/reject",
  "/portfolio-decisions/decision_123/defer",
  "/portfolio-decisions/decision_123/review",
  "/accounts/portfolio_ira/daily-orchestration",
  "/paper/run",
  "/linked-portfolios/portfolio_real/manual-holdings"
];

test("mutating portfolio state routes require the protected secret", () => {
  for (const route of protectedMutationRoutes) {
    assert.equal(requiresMutationAuth("POST", route), true, route);
  }
});

test("read-only GET and JSON routes do not require mutation auth", () => {
  for (const route of ["/status", "/portfolio", "/portfolio?format=json", "/allocation-proposals", "/paper-order-batches", "/quotes"]) {
    const pathname = new URL(route, "https://kairox.test").pathname;
    assert.equal(requiresMutationAuth("GET", pathname), false, route);
  }
});

test("unauthenticated allocation proposal generation is rejected before database access", async () => {
  const db = failOnAccessDb();
  const response = await worker.fetch(
    new Request("https://kairox.test/allocation-proposals/generate?portfolioId=portfolio_ira", { method: "POST" }),
    fakeEnv(db)
  );

  assert.equal(response.status, 401);
  assert.equal(db.accesses, 0);
});

test("unauthenticated nearby mutation routes are rejected before database access", async () => {
  for (const route of [
    "/paper-order-batches/stage?proposalId=proposal_123",
    "/allocation-proposals/proposal_123/approve",
    "/allocation-proposals/proposal_123/reject",
    "/daily-reviews/review_123/proposal",
    "/recommendation-proposals/proposal_123/regenerate",
    "/paper-order-batches/batch_123/ready",
    "/portfolio-decisions/decision_123/accept",
    "/accounts/portfolio_ira/daily-orchestration",
    "/linked-portfolios/portfolio_real/manual-holdings"
  ]) {
    const db = failOnAccessDb();
    const response = await worker.fetch(
      new Request(`https://kairox.test${route}`, { method: "POST" }),
      fakeEnv(db)
    );

    assert.equal(response.status, 401, route);
    assert.equal(db.accesses, 0, route);
  }
});

test("authenticated allocation proposal generation reaches the existing route behavior", async () => {
  const db = failOnAccessDb("authenticated route reached database");
  const response = await worker.fetch(
    new Request("https://kairox.test/allocation-proposals/generate?portfolioId=portfolio_ira", {
      method: "POST",
      headers: { "x-cryptolab-paper-secret": "test-secret" }
    }),
    fakeEnv(db)
  );
  const payload = await response.json<{ message: string }>();

  assert.equal(response.status, 500);
  assert.match(payload.message, /authenticated route reached database/);
  assert.equal(db.accesses > 0, true);
});

test("read-only watchlists remain blocked and paper portfolios remain eligible when authenticated", async () => {
  await assert.rejects(
    () => assertPortfolioAllowsTradingActions(linkedAccountDb("read_only_watchlist") as unknown as D1Database, "portfolio_real", "generate allocation proposals"),
    /Read Only portfolios cannot generate allocation proposals/
  );

  const account = await assertPortfolioAllowsTradingActions(linkedAccountDb("paper") as unknown as D1Database, "portfolio_ira", "generate allocation proposals");
  assert.equal(account.accountType, "paper");
  assert.equal(account.tradingAllowed, true);
});

function fakeEnv(db: { accesses: number }): Env {
  return {
    DB: db as unknown as D1Database,
    PAPER_RUN_SECRET: "test-secret"
  } as Env;
}

function failOnAccessDb(message = "database should not be accessed") {
  return {
    accesses: 0,
    prepare() {
      this.accesses += 1;
      throw new Error(message);
    }
  };
}

function linkedAccountDb(accountType: "paper" | "read_only_watchlist") {
  return {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return {
                portfolioId: accountType === "paper" ? "portfolio_ira" : "portfolio_real",
                accountType,
                linkedPortfolioId: null,
                relationshipLabel: accountType === "paper" ? "Standalone paper portfolio" : "Real brokerage baseline",
                manualEntryEnabled: accountType === "read_only_watchlist" ? 1 : 0,
                managedByKairox: accountType === "paper" ? 1 : 0,
                readOnly: accountType === "read_only_watchlist" ? 1 : 0
              };
            }
          };
        }
      };
    }
  };
}
