import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  calculateApyAccrualValue,
  getIraAlternativesComparison,
  initializeIraAlternativesComparison,
  IRA_ALTERNATIVE_BENCHMARKS,
  IRA_ALTERNATIVE_STRATEGIES,
  IRA_ALTERNATIVES_BASELINE_ID,
  IRA_ALTERNATIVES_COMPARISON_ID,
  IRA_ALTERNATIVES_STARTING_VALUE_USD,
  renderIraAlternativesHtml
} from "../src/benchmarks/iraAlternatives.ts";
import { requiresMutationAuth } from "../src/index.ts";

const migration = readFileSync("migrations/0042_ira_alternatives_2400.sql", "utf8");
const activationMigration = readFileSync("migrations/0043_ira_alternatives_activation.sql", "utf8");
const serviceSource = readFileSync("src/benchmarks/iraAlternatives.ts", "utf8");
const indexSource = readFileSync("src/index.ts", "utf8");

test("IRA alternatives migration creates dedicated paper-only comparison tables", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ira_alternative_comparisons/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ira_alternative_baselines/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ira_alternative_benchmarks/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ira_alternative_strategy_portfolios/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ira_alternative_daily_snapshots/);
  assert.match(migration, /starting_value_usd REAL NOT NULL CHECK \(starting_value_usd = 2400\)/);
  assert.match(migration, /paper_only INTEGER NOT NULL DEFAULT 1 CHECK \(paper_only = 1\)/);
  assert.match(migration, /live_trading_enabled INTEGER NOT NULL DEFAULT 0 CHECK \(live_trading_enabled = 0\)/);
  assert.match(migration, /automatic_live_execution_enabled INTEGER NOT NULL DEFAULT 0 CHECK \(automatic_live_execution_enabled = 0\)/);
  assert.match(migration, /profile_enabled INTEGER NOT NULL DEFAULT 0 CHECK \(profile_enabled = 0\)/);
  assert.match(migration, /UNIQUE \(comparison_id, strategy_key\)/);
  assert.match(migration, /UNIQUE \(comparison_id, alternative_id, snapshot_date\)/);
});

test("definitions include six alternatives with requested ids and starting amount", () => {
  assert.equal(IRA_ALTERNATIVES_COMPARISON_ID, "ira_alternatives_2400_v1");
  assert.equal(IRA_ALTERNATIVES_BASELINE_ID, "ira_alternatives_2400_baseline_v1");
  assert.equal(IRA_ALTERNATIVES_STARTING_VALUE_USD, 2400);
  assert.deepEqual(IRA_ALTERNATIVE_BENCHMARKS.map((benchmark) => benchmark.id), [
    "benchmark_ira_share_150apy_2400_v1",
    "benchmark_ira_certificate_370apy_2400_v1"
  ]);
  assert.deepEqual(IRA_ALTERNATIVE_BENCHMARKS.map((benchmark) => benchmark.apy), [0.015, 0.037]);
  assert.deepEqual(IRA_ALTERNATIVE_STRATEGIES.map((strategy) => strategy.portfolioId), [
    "portfolio_ira_alternatives_2400_v1_conservative",
    "portfolio_ira_alternatives_2400_v1_guardian",
    "portfolio_ira_alternatives_2400_v1_growth",
    "portfolio_ira_alternatives_2400_v1_aggressive"
  ]);
});

test("strategy definitions are disabled paper strategy candidates with materially different risk settings", () => {
  assert.deepEqual(IRA_ALTERNATIVE_STRATEGIES.map((strategy) => strategy.key), ["conservative", "guardian", "growth", "aggressive"]);
  const uniqueRisk = new Set(IRA_ALTERNATIVE_STRATEGIES.map((strategy) => [
    strategy.parameters.minConfidence,
    strategy.parameters.maxNewTradePct,
    strategy.parameters.maxPositionPct,
    strategy.parameters.cashReservePct,
    strategy.parameters.drawdownBlockPct,
    strategy.parameters.turnoverLimitPct,
    strategy.parameters.decisionCadence
  ].join("|")));
  assert.equal(uniqueRisk.size, 4);
  const conservative = IRA_ALTERNATIVE_STRATEGIES[0];
  const aggressive = IRA_ALTERNATIVE_STRATEGIES[3];
  assert.ok(conservative.parameters.minConfidence > aggressive.parameters.minConfidence);
  assert.ok(conservative.parameters.maxNewTradePct < aggressive.parameters.maxNewTradePct);
  assert.ok(conservative.parameters.cashReservePct > aggressive.parameters.cashReservePct);
  assert.ok(conservative.parameters.drawdownBlockPct < aggressive.parameters.drawdownBlockPct);
  assert.equal(conservative.parameters.decisionCadence, "low");
  assert.equal(IRA_ALTERNATIVE_STRATEGIES[1].parameters.decisionCadence, "low");
  assert.equal(IRA_ALTERNATIVE_STRATEGIES[2].parameters.decisionCadence, "normal");
  assert.equal(aggressive.parameters.decisionCadence, "fast");
  assert.equal(conservative.assetUniverse.futureTreasurySupportStatus, "not_activated_without_registry_and_provider_verification");
});

test("activation migration records a shared activation timestamp without rewriting the baseline", () => {
  assert.match(activationMigration, /ALTER TABLE ira_alternative_strategy_portfolios/);
  assert.match(activationMigration, /ADD COLUMN activation_timestamp TEXT/);
  assert.match(activationMigration, /ADD COLUMN activated_by TEXT/);
  assert.doesNotMatch(activationMigration, /ira_alternative_comparisons[\s\S]*start_timestamp/i);
  assert.doesNotMatch(activationMigration, /ira_alternative_baselines[\s\S]*start_timestamp/i);
});

test("APY benchmark uses daily effective accrual from exact elapsed days", () => {
  const start = "2026-07-30T12:00:00.000Z";
  assert.equal(calculateApyAccrualValue(2400, 0.015, start, start), 2400);
  assert.equal(calculateApyAccrualValue(2400, 0.015, start, "2027-07-30T12:00:00.000Z"), 2436);
  assert.equal(calculateApyAccrualValue(2400, 0.037, start, "2027-07-30T12:00:00.000Z"), 2488.8);
  const halfDay = calculateApyAccrualValue(2400, 0.037, start, "2026-07-31T00:00:00.000Z");
  assert.ok(halfDay > 2400);
  assert.ok(halfDay < calculateApyAccrualValue(2400, 0.037, start, "2026-07-31T12:00:00.000Z"));
});

test("initializer creates six alternatives from one timestamp and is idempotent", async () => {
  const db = iraDb();
  const first = await initializeIraAlternativesComparison(db, new Date("2026-07-30T18:00:00.000Z"));
  const second = await initializeIraAlternativesComparison(db, new Date("2026-07-30T19:00:00.000Z"));

  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(first.alternatives.length, 6);
  assert.equal(second.startTimestamp, "2026-07-30T18:00:00.000Z");
  assert.ok(first.alternatives.every((alternative) => alternative.startingValueUsd === 2400));
  assert.ok(first.portfolios.every((portfolio) => portfolio.startingCashUsd === 2400));
  assert.ok(first.portfolios.every((portfolio) => portfolio.profileEnabled === false));
  assert.ok(first.portfolios.every((portfolio) => portfolio.tradeCount === 0));
  assert.ok(first.portfolios.every((portfolio) => portfolio.orderCount === 0));
  assert.ok(first.portfolios.every((portfolio) => portfolio.positionCount === 0));
  assert.equal(db.state.tradesInserted, 0);
  assert.equal(db.state.ordersInserted, 0);
  assert.equal(db.state.positionsInserted, 0);
});

test("uninitialized page is explicit and the initialized page has required disclosures", async () => {
  const uninitialized = await renderIraAlternativesHtml(await getIraAlternativesComparison(iraDb())).text();
  assert.match(uninitialized, /IRA alternatives comparison is not initialized yet/);
  assert.match(uninitialized, /Initialization is a separate protected operation/);

  const db = iraDb();
  const initialized = await initializeIraAlternativesComparison(db, new Date("2026-07-30T18:00:00.000Z"));
  const html = await renderIraAlternativesHtml(initialized).text();
  assert.match(html, /IRA alternatives: \$2,400\.00/);
  assert.match(html, /Actual IRA Share Account/);
  assert.match(html, /12-Month IRA Certificate/);
  assert.match(html, /Conservative IRA Strategy/);
  assert.match(html, /early-withdrawal penalty is unknown/);
  assert.match(html, /Paper strategies can gain or lose/);
  for (const symbol of ["SGOV", "BIL", "SHV", "VGSH", "SCHO"]) {
    assert.ok(html.includes(symbol));
  }
});

test("routes expose read-only comparison and protected initializer", () => {
  assert.match(indexSource, /"\/ira-alternatives"/);
  assert.match(indexSource, /"\/ira-alternatives\/initialize"/);
  assert.match(indexSource, /"\/ira-alternatives\/dry-run"/);
  assert.match(indexSource, /"\/ira-alternatives\/activate"/);
  assert.equal(requiresMutationAuth("POST", "/ira-alternatives/initialize"), true);
  assert.equal(requiresMutationAuth("POST", "/ira-alternatives/dry-run"), true);
  assert.equal(requiresMutationAuth("POST", "/ira-alternatives/activate"), true);
  assert.equal(requiresMutationAuth("GET", "/ira-alternatives"), false);
});

test("IRA alternatives source does not create trades, orders, or touch existing IRA/five-strategy ids", () => {
  assert.doesNotMatch(serviceSource, /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+trades\b/i);
  assert.doesNotMatch(serviceSource, /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+orders\b/i);
  assert.doesNotMatch(serviceSource, /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+positions\b/i);
  assert.doesNotMatch(serviceSource, /portfolio_ira['"]/);
  assert.doesNotMatch(serviceSource, /portfolio_tim_real_five_strategy_400_v2/);
  assert.match(serviceSource, /live_trading_allowed, created_at[\s\S]*0, 0, 0, 0/);
  assert.match(serviceSource, /enabled, created_at, updated_at[\s\S]*\?, 0, \?, \?/);
  assert.match(serviceSource, /STARTUP_MAX_TRADES_PER_DAY[\s\S]*conservative: 2[\s\S]*guardian: 1[\s\S]*growth: 4[\s\S]*aggressive: 8/);
  assert.match(serviceSource, /WATCHLIST_PRIORITY[\s\S]*BND[\s\S]*SCHD[\s\S]*VTI[\s\S]*VOO[\s\S]*SPY/);
  assert.match(serviceSource, /SGOV[\s\S]*BIL[\s\S]*SHV[\s\S]*VGSH[\s\S]*SCHO/);
  assert.match(serviceSource, /UPDATE portfolio_profiles[\s\S]*SET enabled = 1/);
  assert.doesNotMatch(serviceSource, /UPDATE ira_alternative_comparisons[\s\S]*start_timestamp/i);
  assert.doesNotMatch(serviceSource, /UPDATE ira_alternative_baselines[\s\S]*start_timestamp/i);
});

function iraDb() {
  const state = {
    comparison: null as null | Record<string, unknown>,
    benchmarks: [] as Record<string, unknown>[],
    strategies: [] as Record<string, unknown>[],
    portfolios: [] as Record<string, unknown>[],
    profileEnabled: new Map<string, number>(),
    snapshots: [] as Record<string, unknown>[],
    tradesInserted: 0,
    ordersInserted: 0,
    positionsInserted: 0
  };
  const db = {
    state,
    prepare(sql: string) {
      return statement(sql, [], state);
    },
    async batch(statements: Array<{ sql: string; params: unknown[] }>) {
      for (const item of statements) {
        applyStatement(item.sql, item.params, state);
      }
      return statements.map(() => ({ success: true }));
    }
  };
  return db as unknown as D1Database & { state: typeof state };
}

function statement(sql: string, params: unknown[], state: ReturnType<typeof iraDb>["state"]) {
  return {
    sql,
    params,
    bind(...values: unknown[]) {
      return statement(sql, values, state);
    },
    async first() {
      if (/FROM ira_alternative_comparisons/i.test(sql)) return state.comparison;
      if (/SELECT\s+\(SELECT COUNT\(\*\) FROM positions/i.test(sql)) {
        const portfolioId = String(params[3]);
        const portfolio = state.portfolios.find((row) => row.id === portfolioId);
        return {
          positionCount: 0,
          orderCount: 0,
          tradeCount: 0,
          startingCashUsd: portfolio?.cashUsd ?? 0,
          profileEnabled: state.profileEnabled.get(portfolioId) ?? 0
        };
      }
      if (/FROM portfolios p/i.test(sql)) {
        const portfolioId = String(params[0]);
        const portfolio = state.portfolios.find((row) => row.id === portfolioId);
        return {
          cashUsd: portfolio?.cashUsd ?? 0,
          holdingsValueUsd: 0,
          tradeCount: 0,
          feesUsd: 0
        };
      }
      return null;
    },
    async all() {
      if (/FROM ira_alternative_benchmarks/i.test(sql)) return { results: state.benchmarks };
      if (/FROM ira_alternative_strategy_portfolios/i.test(sql)) return { results: state.strategies };
      return { results: [] };
    },
    async run() {
      applyStatement(sql, params, state);
      return { success: true, meta: { changes: 1 } };
    }
  };
}

function applyStatement(sql: string, params: unknown[], state: ReturnType<typeof iraDb>["state"]) {
  if (/INSERT OR IGNORE INTO ira_alternative_comparisons/i.test(sql) && !state.comparison) {
    state.comparison = {
      id: params[0],
      baselineId: params[1],
      displayName: params[2],
      startingValueUsd: params[3],
      startTimestamp: params[4],
      status: "initialized",
      paperOnly: 1,
      liveTradingEnabled: 0,
      automaticLiveExecutionEnabled: 0,
      createdAt: params[5]
    };
  } else if (/INSERT OR IGNORE INTO ira_alternative_benchmarks/i.test(sql)) {
    const id = String(params[0]);
    if (!state.benchmarks.some((row) => row.id === id)) {
      state.benchmarks.push({
        id,
        alternativeKey: params[2],
        displayName: params[3],
        benchmarkType: params[4],
        startingValueUsd: params[5],
        apy: params[6],
        sourceLabel: params[7],
        liquidityClassification: params[8],
        lockTermMonths: params[9],
        earlyWithdrawalPenaltyStatus: params[10],
        earlyWithdrawalPenaltyJson: null
      });
    }
  } else if (/INSERT OR IGNORE INTO portfolios/i.test(sql)) {
    const id = String(params[0]);
    if (!state.portfolios.some((row) => row.id === id)) {
      state.portfolios.push({ id, cashUsd: params[3], startingBalanceUsd: params[4] });
    }
  } else if (/INSERT OR IGNORE INTO portfolio_profiles/i.test(sql)) {
    state.profileEnabled.set(String(params[1]), 0);
  } else if (/INSERT OR IGNORE INTO ira_alternative_strategy_portfolios/i.test(sql)) {
    const id = String(params[0]);
    if (!state.strategies.some((row) => row.id === id)) {
      state.strategies.push({
        id,
        portfolioId: params[2],
        strategyKey: params[3],
        displayName: params[4],
        startingValueUsd: params[5],
        startTimestamp: params[6],
        parametersJson: params[7],
        assetUniverseJson: params[8],
        profileEnabled: 0,
        paperOnly: 1,
        liveTradingEnabled: 0,
        automaticLiveExecutionEnabled: 0,
        status: "initialized"
      });
    }
  } else if (/INSERT OR IGNORE INTO ira_alternative_daily_snapshots/i.test(sql)) {
    const id = String(params[0]);
    if (!state.snapshots.some((row) => row.id === id)) state.snapshots.push({ id });
  } else if (/INSERT/i.test(sql) && /\btrades\b/i.test(sql)) {
    state.tradesInserted += 1;
  } else if (/INSERT/i.test(sql) && /\borders\b/i.test(sql)) {
    state.ordersInserted += 1;
  } else if (/INSERT/i.test(sql) && /\bpositions\b/i.test(sql)) {
    state.positionsInserted += 1;
  }
}
