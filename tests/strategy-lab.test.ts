import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  BUILT_IN_LAB_STRATEGIES,
  DEFAULT_STRATEGY_LAB_THRESHOLDS,
  detectOutperformance,
  rankStrategies,
  type StrategyLabValuation
} from "../src/lab/strategyEvaluationLab.ts";

const migration = readFileSync("migrations/0031_strategy_evaluation_lab.sql", "utf8");
const serviceSource = readFileSync("src/lab/strategyEvaluationLab.ts", "utf8");
const indexSource = readFileSync("src/index.ts", "utf8");
const dashboardSource = readFileSync("src/dashboard/service.ts", "utf8");

test("migration stores independent virtual strategy lab records", () => {
  assert.match(migration, /strategy_lab_programs/);
  assert.match(migration, /strategy_lab_strategies/);
  assert.match(migration, /strategy_lab_virtual_positions/);
  assert.match(migration, /strategy_lab_virtual_trades/);
  assert.match(migration, /strategy_lab_monthly_rankings/);
  assert.match(migration, /strategy_lab_audit_events/);
  assert.match(migration, /UNIQUE\(program_id, strategy_id, market_date\)/);
});

test("built-in strategies cover required lab strategies and remain configurable", () => {
  assert.deepEqual(BUILT_IN_LAB_STRATEGIES.map((strategy) => strategy.strategyName).sort(), [
    "Balanced Growth",
    "Buy & Hold",
    "Conservative Income",
    "Dividend Growth",
    "Equal Weight"
  ]);
  for (const strategy of BUILT_IN_LAB_STRATEGIES) {
    assert.equal(Object.values(strategy.targetWeights).reduce((sum, value) => sum + value, 0).toFixed(6), "1.000000");
    assert.ok(strategy.objective.length > 10);
    assert.ok(strategy.changeNotes.length > 10);
  }
});

test("rankings compare return, drawdown, volatility, Sharpe, Sortino, win rate, and turnover", () => {
  const rankings = rankStrategies(sampleValuations());
  assert.equal(rankings.length, 5);
  assert.equal(rankings[0].rank, 1);
  assert.ok(rankings[0].score > rankings[4].score);
  assert.equal(typeof rankings[0].returnPct, "number");
  assert.equal(typeof rankings[0].drawdownPct, "number");
  assert.equal(typeof rankings[0].turnover, "number");
  assert.match(serviceSource, /sharpeRatio/);
  assert.match(serviceSource, /sortinoRatio/);
  assert.match(serviceSource, /winRate/);
});

test("outperformance is not meaningful until evidence thresholds are met", () => {
  const early = detectOutperformance(sampleValuations({ returnsObserved: 10 }), DEFAULT_STRATEGY_LAB_THRESHOLDS);
  assert.equal(early.some((signal) => signal.statisticallyMeaningful), false);
  assert.equal(early.every((signal) => signal.enoughEvidence === false), true);
});

test("statistically meaningful outperformance requires excess return, Sharpe improvement, and drawdown discipline", () => {
  const signals = detectOutperformance(sampleValuations({ returnsObserved: 90, bestReturn: 0.08, bestSharpe: 0.9 }), DEFAULT_STRATEGY_LAB_THRESHOLDS);
  const balanced = signals.find((signal) => signal.strategyName === "Balanced Growth");
  assert.ok(balanced);
  assert.equal(balanced?.statisticallyMeaningful, true);
});

test("switch recommendations are gated and never automatic", () => {
  assert.match(serviceSource, /The lab never replaces the active strategy automatically/);
  assert.match(serviceSource, /minimumValuationDays/);
  assert.match(serviceSource, /minimumExcessReturnPct/);
  assert.match(dashboardSource, /Switch Evidence Gate/);
  assert.match(dashboardSource, /Switch recommendation/);
});

test("strategy lab endpoints and dashboard action are protected and paper-only", () => {
  assert.match(indexSource, /"\/strategy-lab"/);
  assert.match(indexSource, /"\/strategy-lab\/run"/);
  assert.match(indexSource, /StrategyEvaluationLabService/);
  assert.match(dashboardSource, /data-run-strategy-lab/);
  assert.match(dashboardSource, /No active IRA changes/);
  assert.match(dashboardSource, /No live brokerage/);
});

test("lab service does not mutate active IRA portfolio or invoke order execution", () => {
  assert.doesNotMatch(serviceSource, /from "\.\.\/orders\/(?:staging|execution)\.ts"/);
  assert.doesNotMatch(serviceSource, /executePaperOrderBatch|stagePaperOrdersForProposal|approveAllocationProposal/);
  assert.doesNotMatch(serviceSource, /\bUPDATE\s+(?:portfolios|positions|orders|trades)\b/i);
  assert.doesNotMatch(serviceSource, /\bINSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+(?:positions|orders|trades|paper_order_fills|paper_cash_ledger)\b/i);
  assert.match(serviceSource, /Strategy Evaluation Lab is restricted to paper portfolios/);
});

function sampleValuations(overrides: { returnsObserved?: number; bestReturn?: number; bestSharpe?: number } = {}): StrategyLabValuation[] {
  const observed = overrides.returnsObserved ?? 30;
  return [
    valuation("Conservative Income", 0.025, 0.01, 0.03, 0.32, observed),
    valuation("Balanced Growth", overrides.bestReturn ?? 0.05, 0.012, 0.04, overrides.bestSharpe ?? 0.55, observed),
    valuation("Buy & Hold", 0.03, 0.018, 0.045, 0.25, observed),
    valuation("Dividend Growth", 0.04, 0.02, 0.05, 0.35, observed),
    valuation("Equal Weight", 0.035, 0.015, 0.04, 0.3, observed)
  ];
}

function valuation(
  strategyName: StrategyLabValuation["strategyName"],
  cumulativeReturn: number,
  drawdown: number,
  volatility: number,
  sharpeRatio: number,
  returnsObserved: number
): StrategyLabValuation {
  return {
    strategyId: `strategy_${strategyName.replace(/\W+/g, "_").toLowerCase()}`,
    strategyName,
    marketDate: "2026-07-14",
    portfolioValueUsd: 2400 * (1 + cumulativeReturn),
    cashUsd: 240,
    investedValueUsd: 2160,
    dailyReturn: 0.001,
    cumulativeReturn,
    drawdown,
    highWaterMarkUsd: 2500,
    volatility,
    sharpeRatio,
    sortinoRatio: sharpeRatio + 0.1,
    winRate: 0.56,
    turnover: 0.9,
    allocation: { VTI: 0.4, SCHD: 0.2, BND: 0.3, cash: 0.1 },
    riskMetrics: { maximumDrawdown: drawdown, latestDrawdown: drawdown, returnsObserved },
    marketDataSnapshotId: "mdsnap_lab",
    dataQualityStatus: "complete"
  };
}
