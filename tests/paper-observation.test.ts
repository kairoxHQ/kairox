import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildFounderReport } from "../src/reports/founderReport.ts";
import { decidePaperAction } from "../src/strategy/paperStrategy.ts";
import type { MarketCandle, MarketDataset } from "../src/shared/types.ts";

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

test("paper run creates a parent observation and processes a bounded profile-child batch", () => {
  assert.match(indexSource, /const continued = await service\.processQueuedChildren\(undefined, now\)/);
  assert.match(indexSource, /return json\(await service\.start\(now, true\)\)/);
  assert.doesNotMatch(indexSource, /runAllPaperProfiles\(env\)/);
  assert.match(observationSource, /DEFAULT_CHILD_BATCH_LIMIT = 2/);
  assert.match(observationSource, /DEFAULT_INVOCATION_SAFETY_MS = 110_000/);
  assert.match(observationSource, /processQueuedChildren/);
  assert.match(observationSource, /while \(children\.length < batchLimit\)/);
  assert.match(observationSource, /createdParent \? \{ batchLimit: 1 \} : \{\}/);
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

test("scheduled paper observation uses the shared paper candidate resolver", () => {
  assert.match(observationSource, /import \{ resolvePaperCandidateUniverse \} from "\.\.\/market\/assets\.ts"/);
  assert.match(observationSource, /resolvePaperCandidateUniverse\(this\.db, profile\.portfolioId\)/);
  assert.match(observationSource, /resolvePaperCandidateUniverse\(this\.db, child\.portfolioId\)\)\.assets\.length/);
  assert.match(paperSource, /resolvePaperCandidateUniverse\(env\.DB, portfolioId\)/);
  assert.match(paperSource, /const assets = candidateUniverse\.assets/);
  assert.match(paperSource, /candidateUniverse: \{/);
});

test("paper strategy summaries disclose empty candidate universes", () => {
  assert.match(paperSource, /source: candidateUniverse\.source/);
  assert.match(paperSource, /reason: candidateUniverse\.reason/);
  assert.match(paperSource, /symbols: assets\.map\(\(asset\) => asset\.symbol\)/);
  assert.match(readFileSync("src/market/assets.ts", "utf8"), /NO_ENABLED_CANDIDATES/);
});

test("profile execution has terminal statuses for no action, success, and failure", () => {
  assert.match(observationSource, /childStatusFromSummary/);
  assert.match(observationSource, /return "no_action"/);
  assert.match(observationSource, /return "completed"/);
  assert.match(observationSource, /SET status = 'failed'/);
  assert.match(observationSource, /partial_failure/);
});

test("observation child skips heavy maintenance unless explicitly requested", () => {
  assert.match(observationSource, /runMaintenance: false/);
  assert.match(paperSource, /runMaintenance\?: boolean/);
  assert.match(paperSource, /options\.runMaintenance \?\? true/);
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
  assert.match(observationSource, /await this\.refreshParentCounters\(child\.parentRunId\)/);
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
  assert.match(observationSource, /runMaintenance: false/);
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
  assert.match(indexSource, /processQueuedChildren\(undefined, scheduledDate\)/);
  assert.match(indexSource, /const continued = await service\.processQueuedChildren\(undefined, now\)/);
  assert.match(indexSource, /slot === 0/);
  assert.match(indexSource, /slot === 5/);
  assert.match(schedulerSource, /runScheduledPaperObservation/);
  assert.match(schedulerSource, /processQueuedChildren/);
});

test("child claiming checks the row update before strategy work", () => {
  assert.doesNotMatch(observationSource, /hasRunningChild\(parent\.id\)/);
  assert.doesNotMatch(observationSource, /status = 'running' LIMIT 1/);
  assert.match(observationSource, /const claim = await this\.db\.prepare/);
  assert.match(observationSource, /WHERE id = \? AND status = 'queued'/);
  assert.match(observationSource, /Number\(claim\.meta\?\.changes \?\? 0\) !== 1/);
  assert.match(observationSource, /return \(await this\.getChild\(child\.id\)\) \?\? child/);
});

test("one running child does not block queued child processing", () => {
  assert.doesNotMatch(observationSource, /if \(await this\.hasRunningChild\(parent\.id\)\)/);
  assert.match(observationSource, /const child = await this\.nextQueuedChild\(parent\.id\)/);
  assert.match(observationSource, /WHERE id = \? AND status = 'queued'/);
});

test("regular-hours batch processing can advance multiple IRA alternatives children", () => {
  assert.match(schedulerSource, /processQueuedChildren\(started\.parent\.id, scheduledDate\)/);
  assert.match(observationSource, /children\.push\(child\)/);
  assert.match(observationSource, /stoppedReason: "batch_limit"/);
  assert.match(observationSource, /stoppedReason: "no_runnable_child"/);
});

test("active queued parent is reused before creating a duplicate current-window parent", () => {
  assert.match(observationSource, /nextActiveParentWithQueuedChildren/);
  assert.match(observationSource, /const reusableParent = await this\.nextActiveParentWithQueuedChildren\(\)/);
  assert.match(observationSource, /return \{ parent: reusableParent, child: null, staleRecovered \}/);
  assert.match(observationSource, /processQueuedChildren\(reusableParent\.id, now\)/);
  assert.match(observationSource, /const existing = await this\.getParentByRunKey\(runKey\)/);
  assert.match(observationSource, /INSERT OR IGNORE INTO paper_observation_runs/);
  assert.match(observationSource, /AND EXISTS \([\s\S]*paper_observation_profile_runs child[\s\S]*child\.status = 'queued'/);
});

test("duplicate queued children are reconciled without duplicate strategy execution", () => {
  assert.match(observationSource, /reconcileDuplicateQueuedChildren/);
  assert.match(observationSource, /WHERE child\.status = 'queued'/);
  assert.match(observationSource, /latestTerminalChild/);
  assert.match(observationSource, /status IN \('completed', 'no_action'\)/);
  assert.match(observationSource, /cadenceMinutesForProfile\(profile\)/);
  assert.match(observationSource, /phase = 'duplicate_superseded'/);
  assert.match(observationSource, /error_category = 'duplicate_superseded'/);
  assert.match(observationSource, /action: "DO_NOTHING"/);
  assert.match(observationSource, /WHERE id = \? AND status = 'queued'/);
  assert.match(observationSource, /staleRecovered \+= await this\.reconcileDuplicateQueuedChildren\(now\)/);
  assert.match(observationSource, /await this\.refreshParentCounters\(parentId\)/);
  assert.match(observationSource, /await this\.finalizeParent\(parentId, now\)/);
  assert.doesNotMatch(observationSource, /duplicate_superseded[\s\S]{0,400}runPaperStrategy/);
});

test("stale child isolation keeps later queued profiles runnable", () => {
  assert.match(observationSource, /WHERE status = 'running' AND COALESCE\(heartbeat_at, started_at\) < \?/);
  assert.match(observationSource, /WHERE id = \? AND status = 'running'/);
  assert.match(observationSource, /return this\.runChild\(parent, child, now\)/);
  assert.doesNotMatch(observationSource, /throw new Error\("Observation run exceeded/);
});

test("parent counters are refreshed from child states before finalization", () => {
  assert.match(observationSource, /refreshParentCounters/);
  assert.match(observationSource, /childCounters/);
  assert.match(observationSource, /SUM\(CASE WHEN status = 'completed'/);
  assert.match(observationSource, /SUM\(CASE WHEN status = 'no_action'/);
  assert.match(observationSource, /SUM\(CASE WHEN status IN \('failed', 'abandoned'\)/);
  assert.match(observationSource, /profiles_completed = \?, profiles_no_action = \?, profiles_failed = \?/);
});

test("all-cash strategy path can emit a normal BUY without a forced initialization shortcut", () => {
  const closes = [
    100, 102, 101, 103, 102,
    104, 103, 105, 104, 106,
    105, 107, 106, 108, 107,
    109, 108, 110, 109, 111,
    110, 112
  ];
  const candles: MarketCandle[] = closes.map((close, index) => ({
    timestamp: new Date(Date.UTC(2026, 7, 3, 14, index)).toISOString(),
    open: close - 0.2,
    high: close + 0.5,
    low: close - 0.5,
    close,
    volume: 1_000_000 + index
  }));
  const marketData: MarketDataset = {
    symbol: "SPY",
    assetClass: "etf",
    priceUsd: 112,
    asOf: "2026-08-03T15:01:06.000Z",
    source: "test",
    validated: true,
    stale: false,
    candles,
    volume: 1_000_000,
    status: "validated",
    quality: "fresh"
  };

  const decision = decidePaperAction({ marketData, hasPosition: false });

  assert.equal(decision.action, "BUY");
  assert.match(decision.explanation, /Bullish moving-average/);
});

test("duplicate deterministic signals update evaluation audit metadata without duplicate orders", () => {
  assert.match(paperSource, /ON CONFLICT\(portfolio_id, signal_key\) DO UPDATE SET/);
  assert.match(paperSource, /scheduler_parent_run_id = excluded\.scheduler_parent_run_id/);
  assert.match(paperSource, /scheduler_child_run_id = excluded\.scheduler_child_run_id/);
  assert.match(paperSource, /created_at = datetime\('now'\)/);
  assert.match(paperSource, /INSERT OR IGNORE INTO orders/);
  assert.match(paperSource, /INSERT OR IGNORE INTO trades/);
});

test("final child or recovered child immediately finalizes parent and Founder Report", () => {
  assert.match(observationSource, /await this\.finalizeParent\(parent\.id, now\)/);
  assert.match(observationSource, /await this\.finalizeParent\(parent\.id, now\)/);
  assert.match(observationSource, /await this\.finalizeParent\(parent\.id, now\)/);
  assert.match(observationSource, /generateFounderReport/);
});

test("failed children are terminal and stale recovery re-finalizes affected parents", () => {
  assert.match(observationSource, /const affectedParentIds = new Set<string>\(\)/);
  assert.match(observationSource, /affectedParentIds\.add\(child\.parentRunId\)/);
  assert.match(observationSource, /for \(const parentId of affectedParentIds\)[\s\S]*await this\.finalizeParent\(parentId, now\)/);
  assert.match(observationSource, /finalizeTerminalActiveParents\(now\)/);
  assert.match(observationSource, /SELECT id FROM paper_observation_runs WHERE status IN \('running', 'queued'\)/);
  assert.match(observationSource, /status = 'failed', phase = 'failed'/);
});

test("zero-profile parent runs finalize as no action instead of staying running", () => {
  assert.match(observationSource, /children\.length === 0/);
  assert.match(observationSource, /SET status = 'no_action', profiles_completed = 0, profiles_no_action = 0/);
});

test("scheduler passes parent child and profile audit context into paper execution", () => {
  assert.match(observationSource, /auditContext: \{/);
  assert.match(observationSource, /schedulerParentRunId: parent\.id/);
  assert.match(observationSource, /schedulerChildRunId: child\.id/);
  assert.match(observationSource, /strategyProfileKey: child\.profileKey/);
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
