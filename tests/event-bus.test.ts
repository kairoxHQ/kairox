import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildDomainEvent, DOMAIN_EVENT_TYPES } from "../src/events/eventBus.ts";

const migration = readFileSync("migrations/0033_event_bus.sql", "utf8");
const eventBusSource = readFileSync("src/events/eventBus.ts", "utf8");
const orchestratorSource = readFileSync("src/orchestration/dailyPortfolioOrchestrator.ts", "utf8");
const journeySource = readFileSync("src/journey/service.ts", "utf8");
const researchSource = readFileSync("src/research/engine.ts", "utf8");
const strategyLabSource = readFileSync("src/lab/strategyEvaluationLab.ts", "utf8");
const intelligenceSource = readFileSync("src/intelligence/verifiedPipeline.ts", "utf8");
const dashboardSource = readFileSync("src/dashboard/service.ts", "utf8");
const indexSource = readFileSync("src/index.ts", "utf8");

test("event bus migration persists immutable history, subscriptions, delivery attempts, dead letters, replay, and observability", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS domain_events/);
  assert.match(migration, /immutable_hash TEXT NOT NULL/);
  assert.match(migration, /correlation_id TEXT NOT NULL/);
  assert.match(migration, /account_id TEXT/);
  assert.match(migration, /portfolio_id TEXT/);
  assert.match(migration, /source_service TEXT NOT NULL/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS domain_event_subscriptions/);
  assert.match(migration, /handler_mode TEXT NOT NULL CHECK \(handler_mode IN \('synchronous', 'asynchronous', 'scheduled'\)\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS domain_event_delivery_attempts/);
  assert.match(migration, /retry_scheduled/);
  assert.match(migration, /dead_lettered/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS domain_event_dead_letters/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS domain_event_replay_requests/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS domain_event_observability/);
});

test("event bus seeds subscriptions for every required subsystem", () => {
  for (const eventType of [
    "PortfolioValuation.Completed",
    "DailyManagement.Completed",
    "PortfolioDecision.Generated",
    "Benchmark.Updated",
    "Research.Completed",
    "StrategyLab.Ranked",
    "MarketIntelligence.Completed",
    "Journey.EventRecorded",
    "MarketData.Refreshed"
  ]) {
    assert.match(migration, new RegExp(eventType.replace(".", "\\.")));
  }
  for (const service of ["Journey", "Decision Engine", "Briefings", "Dashboard", "Strategy Lab", "Research", "Portfolio Valuation"]) {
    assert.match(migration, new RegExp(service));
  }
});

test("domain event builder creates stable metadata and immutable hashes without provider secrets", () => {
  const event = buildDomainEvent({
    eventType: "PortfolioValuation.Completed",
    portfolioId: "portfolio_ira",
    sourceService: "PortfolioValuation",
    payload: { totalAccountValueUsd: 2400 },
    occurredAt: "2026-07-14T20:00:00.000Z"
  });
  const same = buildDomainEvent({
    eventType: "PortfolioValuation.Completed",
    portfolioId: "portfolio_ira",
    sourceService: "PortfolioValuation",
    payload: { totalAccountValueUsd: 2400 },
    occurredAt: "2026-07-14T20:00:00.000Z"
  });
  assert.equal(event.id, same.id);
  assert.equal(event.eventVersion, 1);
  assert.equal(event.portfolioId, "portfolio_ira");
  assert.equal(event.accountId, null);
  assert.ok(event.correlationId.startsWith("corr_"));
  assert.ok(event.immutableHash.length >= 6);
  assert.doesNotMatch(JSON.stringify(event), /PAPER_RUN_SECRET|API_KEY|SECRET/i);
});

test("event bus supports sync async scheduled handlers, retries, dead letters, replay, and timeline queries", () => {
  assert.match(eventBusSource, /subscribe\(eventType: string, handlerName: string, mode: EventHandlerMode/);
  assert.match(eventBusSource, /handlerMode === "synchronous"/);
  assert.match(eventBusSource, /processPending/);
  assert.match(eventBusSource, /retry_scheduled/);
  assert.match(eventBusSource, /dead_lettered/);
  assert.match(eventBusSource, /domain_event_dead_letters/);
  assert.match(eventBusSource, /replay\(filter/);
  assert.match(eventBusSource, /timeline\(portfolioId/);
  assert.match(eventBusSource, /observability/);
});

test("meaningful Kairox services publish domain events through the central bus", () => {
  for (const eventType of DOMAIN_EVENT_TYPES) {
    assert.match(eventBusSource, new RegExp(eventType.replace(".", "\\.")));
  }
  assert.match(orchestratorSource, /MarketData\.Refreshed/);
  assert.match(orchestratorSource, /PortfolioValuation\.Completed/);
  assert.match(orchestratorSource, /Benchmark\.Updated/);
  assert.match(orchestratorSource, /DailyManagement\.Completed/);
  assert.match(orchestratorSource, /PortfolioDecision\.Generated/);
  assert.match(orchestratorSource, /Briefing\.Generated/);
  assert.match(journeySource, /Journey\.EventRecorded/);
  assert.match(researchSource, /Research\.Completed/);
  assert.match(strategyLabSource, /StrategyLab\.Ranked/);
  assert.match(intelligenceSource, /MarketIntelligence\.Completed/);
});

test("event publishing is non-blocking for existing behavior and does not call trading execution paths", () => {
  assert.match(orchestratorSource, /safePublishDomainEvent/);
  assert.match(researchSource, /safePublishDomainEvent/);
  assert.match(strategyLabSource, /safePublishDomainEvent/);
  assert.match(intelligenceSource, /safePublishDomainEvent/);
  assert.match(journeySource, /safePublishDomainEvent/);
  const eventSources = [eventBusSource, orchestratorSource, researchSource, strategyLabSource, intelligenceSource, journeySource].join("\n");
  assert.doesNotMatch(eventSources, /executePaperOrderBatch|stagePaperOrdersForProposal|approveAllocationProposal|liveBrokerage|BrokerAdapter/);
});

test("API exposes read-only timeline diagnostics and protected replay or queue processing", () => {
  assert.match(indexSource, /"\/events"/);
  assert.match(indexSource, /"\/events\/observability"/);
  assert.match(indexSource, /"\/events\/dead-letters"/);
  assert.match(indexSource, /"\/events\/process"/);
  assert.match(indexSource, /"\/events\/replay"/);
  assert.match(indexSource, /protectedPostRoutes[\s\S]*\/events\/process/);
  assert.match(indexSource, /protectedPostRoutes[\s\S]*\/events\/replay/);
  assert.match(indexSource, /const auth = await authorize\(request, env\)/);
  assert.match(indexSource, /new EventBus\(env\.DB\)\.processPending/);
});

test("dashboard displays the event timeline without exposing secrets", () => {
  assert.match(dashboardSource, /Event Timeline/);
  assert.match(dashboardSource, /renderEventTimeline/);
  assert.match(dashboardSource, /\/events\?portfolioId=/);
  assert.match(dashboardSource, /\/events\/observability/);
  assert.match(dashboardSource, /\/events\/dead-letters/);
  assert.match(dashboardSource, /Immutable history/);
  assert.match(dashboardSource, /No trading side effects/);
  assert.doesNotMatch(dashboardSource, /PAPER_RUN_SECRET/);
});
