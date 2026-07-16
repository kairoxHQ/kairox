import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildFounderReport } from "../src/reports/founderReport.ts";

const migration = readFileSync("migrations/0035_founder_reports.sql", "utf8");
const schedulerSource = readFileSync("src/scheduler/service.ts", "utf8");
const indexSource = readFileSync("src/index.ts", "utf8");

test("founder report migration stores one immutable report per scheduled run key", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS founder_reports/);
  assert.match(migration, /run_key TEXT NOT NULL UNIQUE/);
  assert.match(migration, /facts_json TEXT NOT NULL/);
  assert.match(migration, /idx_founder_reports_date/);
});

test("founder report explains a no-trade autonomous cycle", () => {
  const report = buildFounderReport({
    runKey: "scheduled:*/30 * * * *:2026-07-15T14:00",
    status: "completed",
    automationPaused: false,
    profiles: [{
      profile: { portfolioId: "portfolio_ira", profileKey: "kairox_conservative", displayName: "Kairox Conservative" },
      symbols: [
        { symbol: "VTI", action: "DO_NOTHING", executed: false, reason: "No deterministic buy signal met the threshold." },
        { symbol: "BND", action: "DO_NOTHING", executed: false, reason: "Market data temporarily unavailable; no trade was made." }
      ]
    }]
  }, new Date("2026-07-15T14:01:00.000Z"));

  assert.equal(report.facts.tradesExecuted, 0);
  assert.equal(report.facts.decisionsLogged, 2);
  assert.equal(report.facts.providerFailures, 1);
  assert.match(report.body, /No paper trades executed/);
  assert.match(report.body, /DO_NOTHING remained valid/);
  assert.match(report.body, /No live brokerage credentials or live order execution/);
});

test("founder report explains executed paper trades and safeguards", () => {
  const report = buildFounderReport({
    runKey: "scheduled:*/30 * * * *:2026-07-15T15:00",
    status: "completed",
    automationPaused: false,
    profiles: [{
      profile: { portfolioId: "portfolio_ira", profileKey: "kairox_conservative", displayName: "Kairox Conservative" },
      symbols: [
        { symbol: "SCHD", action: "BUY", executed: true, reason: "Paper buy filled at validated market price with estimated costs." },
        { symbol: "VTI", action: "DO_NOTHING", executed: false, reason: "Risk checks blocked execution: duplicate signal blocked." }
      ]
    }]
  }, new Date("2026-07-15T15:01:00.000Z"));

  assert.equal(report.facts.tradesExecuted, 1);
  assert.equal(report.facts.safeguards.length, 1);
  assert.match(report.body, /1 simulated paper trade executed/);
  assert.match(report.body, /Safety safeguards recorded 1 block/);
});

test("founder report classifies stale child failure from terminal child status", () => {
  const report = buildFounderReport({
    runKey: "paper_observation:2026-07-16T11:24",
    status: "partial_failure",
    automationPaused: false,
    profiles: [
      {
        status: "no_action",
        profile: { portfolioId: "portfolio_kairox_conservative", profileKey: "kairox_conservative", displayName: "Kairox Conservative" },
        symbols: [{ symbol: "BND", action: "DO_NOTHING", executed: false, reason: "No paper execution requested." }]
      },
      {
        status: "no_action",
        profile: { portfolioId: "portfolio_tim_paper", profileKey: "tim_balanced", displayName: "Tim Balanced" },
        symbols: [{ symbol: "BTC-USD", action: "HOLD", executed: false, reason: "No paper execution requested." }]
      },
      {
        status: "failed",
        errorCategory: "stale_running",
        errorMessage: "Observation run exceeded the Worker execution budget or did not reach a terminal state.",
        profile: { portfolioId: "portfolio_kairox_high_risk", profileKey: "kairox_high_risk", displayName: "Kairox High Risk" },
        symbols: [{ symbol: "profile", action: "DO_NOTHING", executed: false, reason: "Observation run exceeded the Worker execution budget or did not reach a terminal state." }]
      },
      {
        status: "no_action",
        profile: { portfolioId: "portfolio_ira", profileKey: "ira", displayName: "IRA" },
        symbols: [{ symbol: "SPY", action: "DO_NOTHING", executed: false, reason: "No paper execution requested." }]
      }
    ]
  }, new Date("2026-07-16T13:00:27.000Z"));

  assert.equal(report.facts.status, "partial_failure");
  assert.equal(report.facts.profilesCompleted, 0);
  assert.equal(report.facts.profilesNoAction, 3);
  assert.equal(report.facts.profilesFailed, 1);
  assert.match(report.body, /Autonomous paper cycle partial_failure/);
  assert.match(report.body, /Profiles attempted: 4\. Completed: 0\. No action: 3\. Failed: 1\./);
});

test("scheduled paper cycle writes a founder report without changing execution logic", () => {
  assert.match(schedulerSource, /generateFounderReport/);
  assert.match(schedulerSource, /founderReportId/);
  assert.match(schedulerSource, /runPaperStrategy/);
  assert.match(schedulerSource, /recordEquityHistory/);
  assert.match(schedulerSource, /generateSummaries/);
});

test("founder reports are available through a read-only endpoint", () => {
  assert.match(indexSource, /"\/founder-reports"/);
  assert.match(indexSource, /listFounderReports/);
  assert.doesNotMatch(indexSource, /founder-reports\/run/);
});
