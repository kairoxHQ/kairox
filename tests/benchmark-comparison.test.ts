import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildBenchmarkValuation,
  buildProofSummary,
  calculateBenchmarkMetrics,
  calculateInterestBenchmarkValue,
  evidenceQuality,
  initializeBenchmarkShares,
  shouldRunScheduledBenchmarkComparison,
  type BenchmarkConfiguration,
  type BenchmarkDailyValuation
} from "../src/benchmarks/comparison.ts";
import type { MarketDataSnapshot, NormalizedQuote } from "../src/market/service.ts";

const migration = readFileSync("migrations/0026_benchmark_comparison.sql", "utf8");
const serviceSource = readFileSync("src/benchmarks/comparison.ts", "utf8");
const dashboardSource = readFileSync("src/dashboard/service.ts", "utf8");
const indexSource = readFileSync("src/index.ts", "utf8");

test("benchmark configurations cover all requested IRA comparison portfolios", () => {
  assert.match(migration, /benchmark_configurations/);
  assert.match(migration, /Cash benchmark/);
  assert.match(migration, /Bank-interest benchmark/);
  assert.match(migration, /CD-style benchmark/);
  assert.match(migration, /100% VTI buy-and-hold/);
  assert.match(migration, /Conservative 60\/40 benchmark/);
  assert.match(migration, /Kairox IRA paper portfolio/);
  assert.match(migration, /p\.starting_balance_usd/);
  assert.match(migration, /simulation_began_at/);
});

test("daily valuation storage is idempotent and preserves unavailable reasons", () => {
  assert.match(migration, /benchmark_daily_valuations/);
  assert.match(migration, /UNIQUE\(benchmark_id, valuation_date\)/);
  assert.match(migration, /pricing_status TEXT NOT NULL/);
  assert.match(migration, /unavailable_reason/);
  assert.match(serviceSource, /INSERT OR IGNORE INTO benchmark_daily_valuations/);
});

test("interest benchmarks accrue from the exact configured starting capital", () => {
  assert.equal(calculateInterestBenchmarkValue(2400, 0, "2026-07-13", "2026-07-20"), 2400);
  const bank = calculateInterestBenchmarkValue(2400, 0.04, "2026-07-13", "2026-08-12");
  const cd = calculateInterestBenchmarkValue(2400, 0.045, "2026-07-13", "2026-08-12");
  assert.ok(bank > 2400);
  assert.ok(cd > bank);
});

test("fractional benchmark shares are calculated without rounding real exposure to zero", () => {
  const shares = initializeBenchmarkShares(2400, { VTI: 1 }, new Map([["VTI", 370]]));
  assert.equal(Number(shares.get("VTI")?.toFixed(6)), 6.486486);
  const balanced = initializeBenchmarkShares(2400, { VTI: 0.6, BND: 0.4 }, new Map([["VTI", 370], ["BND", 72.5]]));
  assert.ok((balanced.get("VTI") ?? 0) > 0);
  assert.ok((balanced.get("BND") ?? 0) > 0);
});

test("market benchmarks do not fabricate missing prices", () => {
  const valuation = buildBenchmarkValuation({
    config: config("vti_buy_hold", "100% VTI buy-and-hold", "market", { VTI: 1 }),
    runDate: "2026-07-14",
    now: new Date("2026-07-14T21:00:00.000Z"),
    snapshot: snapshot([]),
    previous: null,
    startingPriceBySymbol: new Map(),
    actualValueUsd: 2400,
    actualCashUsd: 2400,
    actualInvestedUsd: 0,
    actualDataTimestamp: null
  });
  assert.equal(valuation.pricingStatus, "unavailable");
  assert.match(valuation.unavailableReason ?? "", /Missing trusted pricing/);
  assert.equal(valuation.totalValueUsd, 0);
});

test("actual Kairox benchmark uses valuation inputs without changing cash or positions", () => {
  const valuation = buildBenchmarkValuation({
    config: config("kairox_actual", "Kairox IRA paper portfolio", "actual", {}),
    runDate: "2026-07-14",
    now: new Date("2026-07-14T21:00:00.000Z"),
    snapshot: snapshot([quote("VTI", 370)]),
    previous: null,
    startingPriceBySymbol: new Map([["VTI", 370]]),
    actualValueUsd: 2401.25,
    actualCashUsd: 958.5594,
    actualInvestedUsd: 1442.6906,
    actualDataTimestamp: "2026-07-14T20:00:00.000Z"
  });
  assert.equal(valuation.totalValueUsd, 2401.25);
  assert.equal(valuation.cashValueUsd, 958.5594);
  assert.equal(valuation.assumptions.noTradesCreated, true);
});

test("metrics include drawdown, positive-day percentage, and Kairox comparison", () => {
  const configs = [
    config("kairox_actual", "Kairox IRA paper portfolio", "actual", {}),
    config("cash", "Cash benchmark", "cash", { cash: 1 })
  ];
  const rows = [
    valuation(configs[0], "2026-07-14", 2400, null),
    valuation(configs[0], "2026-07-15", 2440, 0.016667),
    valuation(configs[0], "2026-07-16", 2380, -0.02459),
    valuation(configs[1], "2026-07-14", 2400, null),
    valuation(configs[1], "2026-07-15", 2400.26, 0.000108),
    valuation(configs[1], "2026-07-16", 2400.53, 0.000112)
  ];
  const metrics = calculateBenchmarkMetrics(configs, rows);
  const kairox = metrics.find((item) => item.benchmarkKey === "kairox_actual");
  const cash = metrics.find((item) => item.benchmarkKey === "cash");
  assert.equal(kairox?.returnPct, -0.008333);
  assert.equal(kairox?.positiveDayPct, 0.5);
  assert.equal(cash?.aheadBehind, "behind");
  assert.ok((kairox?.maximumDrawdownPct ?? 0) > 0);
});

test("evidence labels avoid early profitability claims", () => {
  assert.equal(evidenceQuality(0).label, "Preliminary");
  assert.equal(evidenceQuality(30).label, "Developing");
  assert.equal(evidenceQuality(90).label, "Moderate");
  assert.equal(evidenceQuality(250).label, "Strong");
  assert.match(buildProofSummary([metric("kairox_actual", 2400)], evidenceQuality(1)), /does not prove future profitability/);
});

test("monthly reports are immutable versions and avoid personal owner language", () => {
  assert.match(migration, /benchmark_monthly_reports/);
  assert.match(migration, /UNIQUE\(portfolio_id, report_month, version\)/);
  assert.match(serviceSource, /nextVersion|MAX\(version\)/);
  assert.match(serviceSource, /IRA/);
  assert.match(serviceSource, /Paper simulation/);
  assert.doesNotMatch(serviceSource, /family|owner/i);
});

test("routes, scheduler, dashboard, exports, and protected actions are wired", () => {
  assert.match(indexSource, /"\/benchmark-comparison"/);
  assert.match(indexSource, /"\/benchmark-comparison\/run"/);
  assert.match(indexSource, /"\/benchmark-comparison\/monthly-report\/create"/);
  assert.match(indexSource, /runScheduledBenchmarkComparisons/);
  assert.match(dashboardSource, /Performance Comparison/);
  assert.match(dashboardSource, /data-run-benchmark-comparison/);
  assert.match(dashboardSource, /data-benchmark-toggle/);
  assert.match(dashboardSource, /Printable report/);
  assert.match(dashboardSource, /CSV history/);
});

test("scheduled updates run only after weekday market close", () => {
  assert.equal(shouldRunScheduledBenchmarkComparison(new Date("2026-07-14T19:30:00.000Z")), false);
  assert.equal(shouldRunScheduledBenchmarkComparison(new Date("2026-07-14T21:00:00.000Z")), true);
  assert.equal(shouldRunScheduledBenchmarkComparison(new Date("2026-07-18T21:00:00.000Z")), false);
});

test("benchmark comparison service cannot create trades, fills, positions, or cash movements", () => {
  assert.doesNotMatch(serviceSource, /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+(trades|paper_order_fills|paper_order_executions|paper_cash_ledger|orders)\b/i);
  assert.doesNotMatch(serviceSource, /UPDATE\s+(portfolios|positions|trades|paper_order_batches)\b/i);
});

function config(key: BenchmarkConfiguration["benchmarkKey"], name: string, type: BenchmarkConfiguration["benchmarkType"], allocation: Record<string, number>): BenchmarkConfiguration {
  return {
    id: `benchmark_portfolio_ira_${key}_v1`,
    portfolioId: "portfolio_ira",
    benchmarkKey: key,
    benchmarkName: name,
    benchmarkType: type,
    version: 1,
    startingCapitalUsd: 2400,
    startDate: "2026-07-13",
    annualRate: key === "cash" ? 0 : null,
    apy: key === "cash" ? 0 : null,
    allocation,
    rebalanceRule: "buy and hold",
    dividendRule: "dividends included only when reliable data is available",
    dataProvider: "test",
    active: true,
    notes: "test"
  };
}

function valuation(configRow: BenchmarkConfiguration, date: string, value: number, daily: number | null): BenchmarkDailyValuation {
  const high = Math.max(2400, value);
  return {
    id: `v_${configRow.id}_${date}`,
    benchmarkId: configRow.id,
    portfolioId: "portfolio_ira",
    valuationDate: date,
    cashValueUsd: configRow.benchmarkType === "cash" ? value : 0,
    investedValueUsd: configRow.benchmarkType === "cash" ? 0 : value,
    totalValueUsd: value,
    dailyChangeUsd: daily === null ? null : value * daily,
    dailyChangePct: daily,
    cumulativeReturnPct: Number(((value - 2400) / 2400).toFixed(6)),
    highWaterMarkUsd: high,
    currentDrawdownPct: high > 0 ? (high - value) / high : 0,
    maximumDrawdownPct: high > 0 ? (high - value) / high : 0,
    marketDataSnapshotId: "snap",
    dataTimestamp: "2026-07-14T20:00:00.000Z",
    pricingStatus: "complete",
    unavailableReason: null,
    assumptions: {}
  };
}

function metric(key: BenchmarkConfiguration["benchmarkKey"], value: number) {
  return {
    benchmarkKey: key,
    benchmarkName: key,
    currentValueUsd: value,
    totalGainLossUsd: value - 2400,
    returnPct: (value - 2400) / 2400,
    annualizedReturnPct: null,
    volatilityPct: null,
    maximumDrawdownPct: 0,
    currentDrawdownPct: 0,
    bestDayPct: null,
    worstDayPct: null,
    positiveDayPct: null,
    downsideDeviationPct: null,
    sharpeRatio: null,
    sortinoRatio: null,
    returnPerDrawdown: null,
    daysSinceStart: 1,
    differenceVsKairoxUsd: 0,
    differenceVsKairoxPct: 0,
    aheadBehind: "even" as const,
    riskLevel: "Moderate" as const,
    pricingStatus: "complete" as const,
    dataTimestamp: null,
    unavailableReason: null
  };
}

function snapshot(quotes: NormalizedQuote[]): MarketDataSnapshot {
  return { id: "snapshot_test", useCase: "daily_review", createdAt: "2026-07-14T21:00:00.000Z", quotes: new Map(quotes.map((item) => [item.symbol, item])) };
}

function quote(symbol: string, price: number): NormalizedQuote {
  return {
    symbol,
    securityName: symbol,
    assetType: "etf",
    exchange: "US",
    currency: "USD",
    bid: null,
    ask: null,
    lastPrice: price,
    previousClose: price,
    marketSession: "closed",
    providerTimestamp: "2026-07-14T20:00:00.000Z",
    receivedTimestamp: "2026-07-14T20:01:00.000Z",
    providerName: "test",
    dataQualityStatus: "Valid",
    source: "primary",
    cached: false,
    warnings: [],
    validation: { valid: true, status: "Valid", reasons: [], warnings: [] },
    candles: [],
    volume: 1000
  };
}
