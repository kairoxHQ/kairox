import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildFounderReport } from "../src/reports/founderReport.ts";

const migration = readFileSync("migrations/0036_paper_observation_runs.sql", "utf8");
const phaseMigration = readFileSync("migrations/0037_paper_observation_phase_progress.sql", "utf8");
const observationSource = readFileSync("src/paper/observation.ts", "utf8");
const paperSource = readFileSync("src/paper/service.ts", "utf8");
const indexSource = readFileSync("src/index.ts", "utf8");
const schedulerSource = readFileSync("src/scheduler/service.ts", "utf8");

test("paper observation migration stores parent and child lifecycle records", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS paper_observation_runs/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS paper_observation_profile_runs/);
  assert.match(migration, /status TEXT NOT NULL CHECK \(status IN \('queued', 'running', 'completed', 'no_action', 'failed', 'partial_failure', 'abandoned'\)\)/);
  assert.match(migration, /idempotency_key TEXT NOT NULL UNIQUE/);
  assert.match(migration, /request_budget_json TEXT NOT NULL DEFAULT '\{\}'/);
});

test("paper observation phase migration stores resumable child progress", () => {
  assert.match(phaseMigration, /ADD COLUMN phase TEXT NOT NULL DEFAULT 'queued'/);
  assert.match(phaseMigration, /ADD COLUMN phase_started_at TEXT/);
  assert.match(phaseMigration, /ADD COLUMN phase_finished_at TEXT/);
  assert.match(phaseMigration, /ADD COLUMN heartbeat_at TEXT/);
  assert.match(phaseMigration, /ADD COLUMN phase_attempts INTEGER NOT NULL DEFAULT 0/);
  assert.match(phaseMigration, /phase_error_category/);
  assert.match(phaseMigration, /idx_paper_observation_profile_runs_phase/);
});

test("paper run creates a parent observation and processes at most one profile child", () => {
  assert.match(indexSource, /new PaperObservationService\(env\)\.start\(new Date\(\), true\)/);
  assert.doesNotMatch(indexSource, /runAllPaperProfiles\(env\)/);
  assert.match(observationSource, /processNextChild/);
  assert.match(observationSource, /nextQueuedChild/);
  assert.match(observationSource, /return this\.runChild\(parent, child, now\)/);
});

test("multiple profiles share one persisted market-data snapshot", () => {
  assert.match(observationSource, /uniqueSymbols\(profiles\)/);
  assert.match(observationSource, /marketData\.createSnapshot\(symbols, "proposal", now\)/);
  assert.match(paperSource, /marketDataSnapshot\?: MarketDataSnapshot/);
  assert.match(paperSource, /sharedSnapshot\?\.quotes\.get\(asset\.providerSymbol\)/);
  assert.match(paperSource, /incrementBudget\(budget, "cacheHits"\)/);
});

test("profile execution has terminal statuses for no action, success, and failure", () => {
  assert.match(observationSource, /childStatusFromSummary/);
  assert.match(observationSource, /return "no_action"/);
  assert.match(observationSource, /return "completed"/);
  assert.match(observationSource, /SET status = 'failed'/);
  assert.match(observationSource, /partial_failure/);
});

test("observation child skips heavy maintenance unless a paper trade executes", () => {
  assert.match(observationSource, /runMaintenance: false/);
  assert.match(paperSource, /runMaintenance\?: boolean/);
  assert.match(paperSource, /executedTradeCount > 0/);
  assert.match(paperSource, /runPostStrategyMaintenance/);
  assert.match(paperSource, /lightweightPerformanceSummary/);
  assert.match(paperSource, /skipped_no_trade_observation/);
});

test("child phases record heartbeat and bounded progress counters", () => {
  assert.match(paperSource, /export interface PaperRunProgress/);
  assert.match(paperSource, /onProgress\?: \(progress: PaperRunProgress\) => Promise<void>/);
  assert.match(paperSource, /progressIntervalSymbols/);
  assert.match(observationSource, /recordChildProgress/);
  assert.match(observationSource, /heartbeat_at = \?/);
  assert.match(observationSource, /phase = \?/);
  assert.match(observationSource, /budget\.d1Writes \+= 1/);
});

test("stale running observations are reconciled without deletion", () => {
  assert.match(observationSource, /reconcileStaleRuns/);
  assert.match(observationSource, /COALESCE\(heartbeat_at, started_at\) < \?/);
  assert.match(observationSource, /error_category = 'stale_running'/);
  assert.match(observationSource, /recoverRunningChild/);
  assert.doesNotMatch(observationSource, /UPDATE paper_observation_runs[\s\S]*stale_running/);
  assert.doesNotMatch(observationSource, /DELETE FROM paper_observation/);
  assert.match(schedulerSource, /reconcileStaleScheduledRuns/);
  assert.match(schedulerSource, /UPDATE scheduled_runs/);
  assert.match(indexSource, /reconcileStaleScheduledRuns\(env\.DB, scheduledDate\)/);
});

test("idempotent retry uses durable run keys and does not duplicate completed trades", () => {
  assert.match(observationSource, /getParentByRunKey\(runKey\)/);
  assert.match(observationSource, /INSERT OR IGNORE INTO paper_observation_profile_runs/);
  assert.match(observationSource, /idempotencyKey/);
  assert.match(paperSource, /SELECT summary_json AS summaryJson FROM strategy_runs WHERE run_key = \?/);
  assert.match(paperSource, /INSERT OR IGNORE INTO orders/);
  assert.match(paperSource, /INSERT OR IGNORE INTO trades/);
});

test("stale child recovery uses persisted recommendations and trades before failing", () => {
  assert.match(paperSource, /recoverPaperStrategyRunFromPersistedWork/);
  assert.match(paperSource, /FROM recommendations/);
  assert.match(paperSource, /FROM trades/);
  assert.match(paperSource, /recommendations\.length < options\.expectedSymbols/);
  assert.match(paperSource, /executedTradeCount > 0[\s\S]*runPostStrategyMaintenance/);
  assert.match(paperSource, /INSERT OR IGNORE INTO strategy_runs/);
  assert.match(observationSource, /phase = 'recovered_finalized'/);
  assert.match(observationSource, /PaperObservation\.ProfileRecovered/);
});

test("paper execution accounting is atomic before recovery trusts persisted trades", () => {
  assert.match(paperSource, /await db\.batch\(\[/);
  assert.match(paperSource, /insertOrderStatement/);
  assert.match(paperSource, /insertTradeStatement/);
  assert.match(paperSource, /upsertPositionStatement|closePositionStatement/);
  assert.match(paperSource, /updateCashStatement/);
});

test("balanced Observation Day 2 failure shape can recover instead of stale-failing", () => {
  assert.match(paperSource, /expectedSymbols/);
  assert.match(paperSource, /symbolsProcessed/);
  assert.match(paperSource, /tradesExecuted/);
  assert.match(observationSource, /status = \?/);
  assert.match(observationSource, /summary_json = \?/);
  assert.doesNotMatch(observationSource, /status = 'failed'[\s\S]{0,180}WHERE id = \? AND status = 'running'[\s\S]{0,180}recoverPaperStrategyRunFromPersistedWork/);
});

test("Founder Report honestly summarizes mixed child outcomes", () => {
  const report = buildFounderReport({
    runKey: "paper_observation:2026-07-16T14:00",
    status: "partial_failure",
    automationPaused: false,
    profiles: [
      {
        profile: { portfolioId: "portfolio_tim_paper", profileKey: "tim_balanced", displayName: "Tim Balanced" },
        symbols: [{ symbol: "SPY", action: "BUY", executed: true, reason: "Paper buy filled at validated market price with estimated costs." }]
      },
      {
        profile: { portfolioId: "portfolio_ira", profileKey: "ira", displayName: "IRA" },
        symbols: [{ symbol: "BND", action: "DO_NOTHING", executed: false, reason: "Risk checks blocked execution: cash reserve limit." }]
      },
      {
        profile: { portfolioId: "portfolio_kairox_high_risk", profileKey: "kairox_high_risk", displayName: "Kairox High Risk" },
        symbols: [{ symbol: "profile", action: "DO_NOTHING", executed: false, reason: "Provider failure while fetching market data." }]
      }
    ]
  }, new Date("2026-07-16T14:05:00.000Z"));

  assert.equal(report.facts.profilesCompleted, 1);
  assert.equal(report.facts.profilesNoAction, 1);
  assert.equal(report.facts.profilesFailed, 1);
  assert.equal(report.facts.tradesPrevented, 1);
  assert.equal(report.facts.policyFindings, 1);
  assert.match(report.body, /Profiles attempted: 3\. Completed: 1\. No action: 1\. Failed: 1\./);
});

test("cron workload isolation avoids sharing one failure budget", () => {
  assert.match(indexSource, /runOneScheduledWorkload/);
  assert.doesNotMatch(indexSource, /Promise\.all\(\[\s*runScheduledPaperStrategy/);
  assert.match(indexSource, /continuedPaperObservation/);
  assert.match(indexSource, /prioritizedPaperObservation/);
  assert.match(indexSource, /slot === 0/);
  assert.match(indexSource, /slot === 5/);
  assert.match(schedulerSource, /runScheduledPaperObservation/);
  assert.match(schedulerSource, /processNextChild/);
});

test("child claiming checks the row update before strategy work", () => {
  assert.match(observationSource, /hasRunningChild\(parent\.id\)/);
  assert.match(observationSource, /status = 'running' LIMIT 1/);
  assert.match(observationSource, /const claim = await this\.db\.prepare/);
  assert.match(observationSource, /WHERE id = \? AND status = 'queued'/);
  assert.match(observationSource, /Number\(claim\.meta\?\.changes \?\? 0\) !== 1/);
  assert.match(observationSource, /return \(await this\.getChild\(child\.id\)\) \?\? child/);
});

test("final child or recovered child immediately finalizes parent and Founder Report", () => {
  assert.match(observationSource, /await this\.finalizeParent\(parent\.id, now\)/);
  assert.match(observationSource, /await this\.finalizeParent\(parent\.id, now\)/);
  assert.match(observationSource, /await this\.finalizeParent\(parent\.id, now\)/);
  assert.match(observationSource, /generateFounderReport/);
});

test("request-budget counters cover provider, D1, cache, profile, symbol, retry, and fallback dimensions", () => {
  for (const field of [
    "outboundProviderRequests",
    "d1Reads",
    "d1Writes",
    "d1Batches",
    "cacheHits",
    "cacheMisses",
    "profilesProcessed",
    "symbolsProcessed",
    "retries",
    "fallbacks"
  ]) {
    assert.match(observationSource, new RegExp(field));
  }
});
