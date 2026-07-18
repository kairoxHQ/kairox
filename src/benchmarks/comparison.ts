import { MarketDataService, type MarketDataSnapshot, type NormalizedQuote } from "../market/service.ts";
import { getInvestmentPolicy } from "../policies/investmentPolicy.ts";
import { accountDate, getPortfolioValuation } from "../portfolio/valuation.ts";
import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";
import { formatCurrency, formatPercent } from "../shared/displayFormat.ts";
import { addMoney, pctChange, roundMoney, roundRatio, subtractMoney } from "../shared/money.ts";
import type { Env } from "../shared/types.ts";

export type BenchmarkKey =
  | "kairox_actual"
  | "cash"
  | "bank_interest"
  | "cd_style"
  | "vti_buy_hold"
  | "conservative_60_40";

export type BenchmarkPricingStatus = "complete" | "carried_forward" | "unavailable";

export interface BenchmarkConfiguration {
  id: string;
  portfolioId: string;
  benchmarkKey: BenchmarkKey;
  benchmarkName: string;
  benchmarkType: "actual" | "cash" | "interest" | "market";
  version: number;
  startingCapitalUsd: number;
  startDate: string;
  annualRate: number | null;
  apy: number | null;
  allocation: Record<string, number>;
  rebalanceRule: string;
  dividendRule: string;
  dataProvider: string;
  active: boolean;
  notes: string;
}

export interface BenchmarkDailyValuation {
  id: string;
  benchmarkId: string;
  portfolioId: string;
  valuationDate: string;
  cashValueUsd: number;
  investedValueUsd: number;
  totalValueUsd: number;
  dailyChangeUsd: number | null;
  dailyChangePct: number | null;
  cumulativeReturnPct: number;
  highWaterMarkUsd: number;
  currentDrawdownPct: number;
  maximumDrawdownPct: number;
  marketDataSnapshotId: string | null;
  dataTimestamp: string | null;
  pricingStatus: BenchmarkPricingStatus;
  unavailableReason: string | null;
  assumptions: Record<string, unknown>;
}

export interface BenchmarkMetrics {
  benchmarkKey: BenchmarkKey;
  benchmarkName: string;
  currentValueUsd: number | null;
  totalGainLossUsd: number | null;
  returnPct: number | null;
  annualizedReturnPct: number | null;
  volatilityPct: number | null;
  maximumDrawdownPct: number | null;
  currentDrawdownPct: number | null;
  bestDayPct: number | null;
  worstDayPct: number | null;
  positiveDayPct: number | null;
  downsideDeviationPct: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  returnPerDrawdown: number | null;
  daysSinceStart: number;
  differenceVsKairoxUsd: number | null;
  differenceVsKairoxPct: number | null;
  aheadBehind: "ahead" | "behind" | "even" | "unavailable";
  riskLevel: "Cash-like" | "Low" | "Moderate" | "Equity" | "Unavailable";
  pricingStatus: BenchmarkPricingStatus;
  dataTimestamp: string | null;
  unavailableReason: string | null;
}

export interface BenchmarkComparisonSummary {
  portfolioId: string;
  startDate: string | null;
  startingCapitalUsd: number | null;
  evidence: EvidenceQuality;
  proofSummary: string;
  configurations: BenchmarkConfiguration[];
  benchmarks: BenchmarkMetrics[];
  history: BenchmarkDailyValuation[];
  monthlyReport: {
    status: "available" | "insufficient_history" | "none";
    reportMonth: string;
    latestVersion: number;
    previewUrl: string;
    csvUrl: string;
  };
  warnings: string[];
}

export interface BenchmarkRunResult {
  runId: string;
  portfolioId: string;
  runDate: string;
  skipped: boolean;
  idempotent: boolean;
  message: string;
  valuations: BenchmarkDailyValuation[];
  summary: BenchmarkComparisonSummary;
}

export interface EvidenceQuality {
  label: "Preliminary" | "Developing" | "Moderate" | "Strong";
  days: number;
  description: string;
}

interface ConfigRow {
  id: string;
  portfolioId: string;
  benchmarkKey: BenchmarkKey;
  benchmarkName: string;
  benchmarkType: "actual" | "cash" | "interest" | "market";
  version: number;
  startingCapitalUsd: number;
  startDate: string;
  annualRate: number | null;
  apy: number | null;
  allocationJson: string;
  rebalanceRule: string;
  dividendRule: string;
  dataProvider: string;
  active: number;
  notes: string;
}

interface ValuationRow {
  id: string;
  benchmarkId: string;
  portfolioId: string;
  valuationDate: string;
  cashValueUsd: number;
  investedValueUsd: number;
  totalValueUsd: number;
  dailyChangeUsd: number | null;
  dailyChangePct: number | null;
  cumulativeReturnPct: number;
  highWaterMarkUsd: number;
  currentDrawdownPct: number;
  maximumDrawdownPct: number;
  marketDataSnapshotId: string | null;
  dataTimestamp: string | null;
  pricingStatus: BenchmarkPricingStatus;
  unavailableReason: string | null;
  assumptionsJson: string;
}

interface PortfolioRow {
  id: string;
  mode: string;
  startingBalanceUsd: number;
  createdAt: string;
}

interface PositionRow {
  symbol: string;
  assetClass: string;
  quantity: number;
  marketValueUsd: number;
}

const TIMEZONE = "America/New_York";
const MARKET_BENCHMARK_SYMBOLS = ["VTI", "BND"];

export class BenchmarkComparisonService {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async summary(portfolioId = "portfolio_ira"): Promise<BenchmarkComparisonSummary> {
    const configs = await this.ensureConfigurations(portfolioId);
    const rows = await this.listValuations(portfolioId);
    const history = rows.map(mapValuationRow);
    const startDate = configs[0]?.startDate ?? null;
    const startingCapitalUsd = configs[0]?.startingCapitalUsd ?? null;
    const benchmarks = calculateBenchmarkMetrics(configs, history);
    const evidence = evidenceQuality(new Set(history.map((item) => item.valuationDate)).size);
    return {
      portfolioId,
      startDate,
      startingCapitalUsd,
      evidence,
      proofSummary: buildProofSummary(benchmarks, evidence),
      configurations: configs,
      benchmarks,
      history,
      monthlyReport: await this.monthlyReportStatus(portfolioId),
      warnings: benchmarks.filter((item) => item.pricingStatus === "unavailable").map((item) => `${item.benchmarkName}: ${item.unavailableReason ?? "pricing unavailable"}`)
    };
  }

  async run(portfolioId = "portfolio_ira", triggerSource: "manual" | "scheduled" = "manual", now = new Date()): Promise<BenchmarkRunResult> {
    const portfolio = await this.getPortfolio(portfolioId);
    if (!portfolio) {
      throw new Error("Portfolio not found.");
    }
    if (portfolio.mode !== "paper") {
      throw new Error("Benchmark comparison is restricted to paper portfolios.");
    }
    const runDate = accountDate(now, TIMEZONE);
    const configs = await this.ensureConfigurations(portfolioId);
    const existing = await this.valuationsForDate(portfolioId, runDate);
    if (existing.length >= configs.length) {
      const runId = await this.recordRun(portfolioId, runDate, triggerSource, "skipped", null, "Benchmark valuations already exist for this date.", null, now);
      return { runId, portfolioId, runDate, skipped: true, idempotent: true, message: "Benchmark valuations already exist for this date.", valuations: existing.map(mapValuationRow), summary: await this.summary(portfolioId) };
    }

    const runId = await this.recordRun(portfolioId, runDate, triggerSource, "started", null, "Benchmark comparison started.", null, now);
    try {
      const marketData = new MarketDataService(this.db);
      const snapshot = await marketData.createSnapshot(MARKET_BENCHMARK_SYMBOLS, "daily_review", now);
      const previous = await this.latestValuationsBefore(portfolioId, runDate);
      const startPrices = await this.startPricesFor(configs, snapshot);
      const valuation = await getPortfolioValuation(this.db, portfolioId, now);
      const positions = await this.listPositions(portfolioId);
      const valuations = configs.map((config) => buildBenchmarkValuation({
        config,
        runDate,
        now,
        snapshot,
        previous: previous.get(config.id) ?? null,
        startingPriceBySymbol: startPrices,
        actualValueUsd: valuation.totalAccountValueUsd,
        actualCashUsd: valuation.cashUsd,
        actualInvestedUsd: positions.reduce((sum, position) => addMoney(sum, position.marketValueUsd), 0),
        actualDataTimestamp: valuation.lastSuccessfulMarketDataUpdateTime
      }));
      await this.persistValuations(valuations);
      await this.recordRun(portfolioId, runDate, triggerSource, "completed", snapshot.id, "Benchmark comparison completed.", null, now, runId);
      return { runId, portfolioId, runDate, skipped: false, idempotent: false, message: "Benchmark comparison completed.", valuations, summary: await this.summary(portfolioId) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown benchmark comparison error.";
      await this.recordRun(portfolioId, runDate, triggerSource, "failed", null, "Benchmark comparison failed.", message, now, runId);
      throw error;
    }
  }

  async monthlyReportPreview(portfolioId = "portfolio_ira", reportMonth?: string, format: "json" | "html" | "csv" = "json"): Promise<Response | unknown> {
    const month = reportMonth ?? new Date().toISOString().slice(0, 7);
    const summary = await this.summary(portfolioId);
    const payload = buildMonthlyReport(summary, month, 0);
    if (format === "html") {
      return new Response(payload.html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    if (format === "csv") {
      return new Response(payload.csv, { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" } });
    }
    return payload.json;
  }

  async createMonthlyReport(portfolioId = "portfolio_ira", reportMonth?: string, reason?: string | null): Promise<unknown> {
    const month = reportMonth ?? previousMonth(new Date());
    const summary = await this.summary(portfolioId);
    const monthRows = summary.history.filter((item) => item.valuationDate.startsWith(month));
    if (monthRows.length === 0) {
      return { created: false, reason: "No completed benchmark valuation exists for the requested reporting month.", reportMonth: month };
    }
    const next = await this.db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM benchmark_monthly_reports WHERE portfolio_id = ? AND report_month = ?").bind(portfolioId, month).first<{ version: number }>();
    const version = next?.version ?? 1;
    const payload = buildMonthlyReport(summary, month, version);
    await this.db.prepare(
      `INSERT INTO benchmark_monthly_reports (
        id, portfolio_id, report_month, version, status, report_html, report_csv,
        report_json, evidence_label, revision_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      `benchmark_report_${portfolioId}_${month}_${version}`,
      portfolioId,
      month,
      version,
      version === 1 ? "published" : "revised",
      payload.html,
      payload.csv,
      JSON.stringify(payload.json),
      summary.evidence.label,
      version === 1 ? null : reason ?? "Recalculated report version."
    ).run();
    return { created: true, reportMonth: month, version, evidence: summary.evidence, report: payload.json };
  }

  private async ensureConfigurations(portfolioId: string): Promise<BenchmarkConfiguration[]> {
    let configs = await this.listConfigurations(portfolioId);
    if (configs.length > 0) {
      return configs;
    }
    const portfolio = await this.getPortfolio(portfolioId);
    if (!portfolio) {
      return [];
    }
    const policy = await getInvestmentPolicy(this.db, portfolioId);
    const startDate = (policy?.simulationBeganAt ?? portfolio.createdAt).slice(0, 10);
    const definitions = defaultDefinitions(portfolioId, portfolio.startingBalanceUsd, startDate);
    for (const config of definitions) {
      await this.db.prepare(
        `INSERT OR IGNORE INTO benchmark_configurations (
          id, portfolio_id, benchmark_key, benchmark_name, benchmark_type, version,
          starting_capital_usd, start_date, annual_rate, apy, allocation_json,
          rebalance_rule, dividend_rule, data_provider, active, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
      ).bind(
        config.id,
        config.portfolioId,
        config.benchmarkKey,
        config.benchmarkName,
        config.benchmarkType,
        config.version,
        config.startingCapitalUsd,
        config.startDate,
        config.annualRate,
        config.apy,
        JSON.stringify(config.allocation),
        config.rebalanceRule,
        config.dividendRule,
        config.dataProvider,
        config.notes
      ).run();
    }
    configs = await this.listConfigurations(portfolioId);
    return configs;
  }

  private async listConfigurations(portfolioId: string): Promise<BenchmarkConfiguration[]> {
    try {
      const rows = await listRows<ConfigRow>(
        this.db.prepare(
          `SELECT id, portfolio_id AS portfolioId, benchmark_key AS benchmarkKey,
            benchmark_name AS benchmarkName, benchmark_type AS benchmarkType, version,
            starting_capital_usd AS startingCapitalUsd, start_date AS startDate,
            annual_rate AS annualRate, apy, allocation_json AS allocationJson,
            rebalance_rule AS rebalanceRule, dividend_rule AS dividendRule,
            data_provider AS dataProvider, active, notes
           FROM benchmark_configurations
           WHERE portfolio_id = ? AND active = 1
           ORDER BY CASE benchmark_key
             WHEN 'kairox_actual' THEN 0
             WHEN 'cash' THEN 1
             WHEN 'bank_interest' THEN 2
             WHEN 'cd_style' THEN 3
             WHEN 'vti_buy_hold' THEN 4
             WHEN 'conservative_60_40' THEN 5
             ELSE 9 END`
        ).bind(portfolioId)
      );
      return rows.map(mapConfigRow);
    } catch (error) {
      if (isMissingBenchmarkTable(error)) {
        return [];
      }
      throw error;
    }
  }

  private async listValuations(portfolioId: string): Promise<ValuationRow[]> {
    try {
      return listRows<ValuationRow>(
        this.db.prepare(
          `SELECT id, benchmark_id AS benchmarkId, portfolio_id AS portfolioId,
            valuation_date AS valuationDate, cash_value_usd AS cashValueUsd,
            invested_value_usd AS investedValueUsd, total_value_usd AS totalValueUsd,
            daily_change_usd AS dailyChangeUsd, daily_change_pct AS dailyChangePct,
            cumulative_return_pct AS cumulativeReturnPct, high_water_mark_usd AS highWaterMarkUsd,
            current_drawdown_pct AS currentDrawdownPct, maximum_drawdown_pct AS maximumDrawdownPct,
            market_data_snapshot_id AS marketDataSnapshotId, data_timestamp AS dataTimestamp,
            pricing_status AS pricingStatus, unavailable_reason AS unavailableReason,
            assumptions_json AS assumptionsJson
           FROM benchmark_daily_valuations
           WHERE portfolio_id = ?
           ORDER BY valuation_date ASC, benchmark_id ASC`
        ).bind(portfolioId)
      );
    } catch (error) {
      if (isMissingBenchmarkTable(error)) {
        return [];
      }
      throw error;
    }
  }

  private async valuationsForDate(portfolioId: string, date: string): Promise<ValuationRow[]> {
    return listRows<ValuationRow>(
      this.db.prepare(
        `SELECT id, benchmark_id AS benchmarkId, portfolio_id AS portfolioId,
          valuation_date AS valuationDate, cash_value_usd AS cashValueUsd,
          invested_value_usd AS investedValueUsd, total_value_usd AS totalValueUsd,
          daily_change_usd AS dailyChangeUsd, daily_change_pct AS dailyChangePct,
          cumulative_return_pct AS cumulativeReturnPct, high_water_mark_usd AS highWaterMarkUsd,
          current_drawdown_pct AS currentDrawdownPct, maximum_drawdown_pct AS maximumDrawdownPct,
          market_data_snapshot_id AS marketDataSnapshotId, data_timestamp AS dataTimestamp,
          pricing_status AS pricingStatus, unavailable_reason AS unavailableReason,
          assumptions_json AS assumptionsJson
         FROM benchmark_daily_valuations
         WHERE portfolio_id = ? AND valuation_date = ?`
      ).bind(portfolioId, date)
    );
  }

  private async latestValuationsBefore(portfolioId: string, date: string): Promise<Map<string, BenchmarkDailyValuation>> {
    const rows = await listRows<ValuationRow>(
      this.db.prepare(
        `SELECT v.id, v.benchmark_id AS benchmarkId, v.portfolio_id AS portfolioId,
          v.valuation_date AS valuationDate, v.cash_value_usd AS cashValueUsd,
          v.invested_value_usd AS investedValueUsd, v.total_value_usd AS totalValueUsd,
          v.daily_change_usd AS dailyChangeUsd, v.daily_change_pct AS dailyChangePct,
          v.cumulative_return_pct AS cumulativeReturnPct, v.high_water_mark_usd AS highWaterMarkUsd,
          v.current_drawdown_pct AS currentDrawdownPct, v.maximum_drawdown_pct AS maximumDrawdownPct,
          v.market_data_snapshot_id AS marketDataSnapshotId, v.data_timestamp AS dataTimestamp,
          v.pricing_status AS pricingStatus, v.unavailable_reason AS unavailableReason,
          v.assumptions_json AS assumptionsJson
         FROM benchmark_daily_valuations v
         JOIN (
           SELECT benchmark_id, MAX(valuation_date) AS latest_date
           FROM benchmark_daily_valuations
           WHERE portfolio_id = ? AND valuation_date < ?
           GROUP BY benchmark_id
         ) latest ON latest.benchmark_id = v.benchmark_id AND latest.latest_date = v.valuation_date`
      ).bind(portfolioId, date)
    );
    return new Map(rows.map((row) => [row.benchmarkId, mapValuationRow(row)]));
  }

  private async startPricesFor(configs: BenchmarkConfiguration[], snapshot: MarketDataSnapshot): Promise<Map<string, number>> {
    const prices = new Map<string, number>();
    for (const symbol of requiredSymbols(configs)) {
      const quote = snapshot.quotes.get(symbol);
      if (quote?.lastPrice && quote.lastPrice > 0) {
        prices.set(symbol, quote.lastPrice);
      }
    }
    return prices;
  }

  private async getPortfolio(portfolioId: string): Promise<PortfolioRow | null> {
    return this.db.prepare("SELECT id, mode, starting_balance_usd AS startingBalanceUsd, created_at AS createdAt FROM portfolios WHERE id = ?").bind(portfolioId).first<PortfolioRow>();
  }

  private async listPositions(portfolioId: string): Promise<PositionRow[]> {
    return listRows<PositionRow>(
      this.db.prepare("SELECT symbol, asset_class AS assetClass, quantity, market_value_usd AS marketValueUsd FROM positions WHERE portfolio_id = ? AND quantity > 0").bind(portfolioId)
    );
  }

  private async persistValuations(valuations: BenchmarkDailyValuation[]): Promise<void> {
    for (const valuation of valuations) {
      await this.db.prepare(
        `INSERT OR IGNORE INTO benchmark_daily_valuations (
          id, benchmark_id, portfolio_id, valuation_date, cash_value_usd, invested_value_usd,
          total_value_usd, daily_change_usd, daily_change_pct, cumulative_return_pct,
          high_water_mark_usd, current_drawdown_pct, maximum_drawdown_pct,
          market_data_snapshot_id, data_timestamp, pricing_status, unavailable_reason, assumptions_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        valuation.id,
        valuation.benchmarkId,
        valuation.portfolioId,
        valuation.valuationDate,
        valuation.cashValueUsd,
        valuation.investedValueUsd,
        valuation.totalValueUsd,
        valuation.dailyChangeUsd,
        valuation.dailyChangePct,
        valuation.cumulativeReturnPct,
        valuation.highWaterMarkUsd,
        valuation.currentDrawdownPct,
        valuation.maximumDrawdownPct,
        valuation.marketDataSnapshotId,
        valuation.dataTimestamp,
        valuation.pricingStatus,
        valuation.unavailableReason,
        JSON.stringify(valuation.assumptions)
      ).run();
    }
  }

  private async recordRun(portfolioId: string, runDate: string, triggerSource: "manual" | "scheduled", status: "started" | "completed" | "skipped" | "failed", snapshotId: string | null, message: string | null, error: string | null, now: Date, existingId?: string): Promise<string> {
    const id = existingId ?? `benchmark_run_${portfolioId}_${runDate}_${triggerSource}_${now.toISOString().replace(/[^0-9A-Za-z]/g, "")}`;
    await this.db.prepare(
      `INSERT OR REPLACE INTO benchmark_comparison_runs (
        id, portfolio_id, run_date, trigger_source, status, market_data_snapshot_id,
        message, error_details, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, portfolioId, runDate, triggerSource, status, snapshotId, message, error, now.toISOString(), status === "started" ? null : now.toISOString()).run();
    return id;
  }

  private async monthlyReportStatus(portfolioId: string): Promise<BenchmarkComparisonSummary["monthlyReport"]> {
    const month = new Date().toISOString().slice(0, 7);
    try {
      const latest = await this.db.prepare(
        "SELECT version FROM benchmark_monthly_reports WHERE portfolio_id = ? ORDER BY report_month DESC, version DESC LIMIT 1"
      ).bind(portfolioId).first<{ version: number }>();
      return {
        status: latest ? "available" : "insufficient_history",
        reportMonth: month,
        latestVersion: latest?.version ?? 0,
        previewUrl: `/benchmark-comparison/monthly-report?portfolioId=${encodeURIComponent(portfolioId)}&month=${encodeURIComponent(month)}&format=html`,
        csvUrl: `/benchmark-comparison/history.csv?portfolioId=${encodeURIComponent(portfolioId)}`
      };
    } catch (error) {
      if (isMissingBenchmarkTable(error)) {
        return { status: "none", reportMonth: month, latestVersion: 0, previewUrl: "", csvUrl: "" };
      }
      throw error;
    }
  }
}

export async function runScheduledBenchmarkComparisons(env: Env, scheduledAt: Date | string = new Date()): Promise<BenchmarkRunResult[]> {
  const runAt = typeof scheduledAt === "string" ? new Date(scheduledAt) : scheduledAt;
  if (!shouldRunScheduledBenchmarkComparison(runAt)) {
    return [];
  }
  const portfolios = await listRows<{ id: string }>(env.DB.prepare("SELECT id FROM portfolios WHERE mode = 'paper' AND status = 'active' ORDER BY id"));
  const service = new BenchmarkComparisonService(env.DB);
  const results: BenchmarkRunResult[] = [];
  for (const portfolio of portfolios) {
    results.push(await service.run(portfolio.id, "scheduled", runAt));
  }
  return results;
}

export function shouldRunScheduledBenchmarkComparison(now: Date): boolean {
  const day = now.getUTCDay();
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, hour: "2-digit", hourCycle: "h23" }).format(now));
  return day !== 0 && day !== 6 && hour >= 16;
}

export function buildBenchmarkValuation(input: {
  config: BenchmarkConfiguration;
  runDate: string;
  now: Date;
  snapshot: MarketDataSnapshot;
  previous: BenchmarkDailyValuation | null;
  startingPriceBySymbol: Map<string, number>;
  actualValueUsd: number;
  actualCashUsd: number;
  actualInvestedUsd: number;
  actualDataTimestamp: string | null;
}): BenchmarkDailyValuation {
  const start = input.config.startingCapitalUsd;
  const value = valueBenchmark(input.config, input.runDate, input.now, input.snapshot, input.startingPriceBySymbol, {
    totalValueUsd: input.actualValueUsd,
    cashUsd: input.actualCashUsd,
    investedUsd: input.actualInvestedUsd,
    dataTimestamp: input.actualDataTimestamp
  });
  const previousValue = input.previous?.totalValueUsd ?? null;
  const highWater = Math.max(value.totalValueUsd, input.previous?.highWaterMarkUsd ?? start);
  const drawdown = highWater > 0 ? roundRatio((highWater - value.totalValueUsd) / highWater) : 0;
  const maxDrawdown = Math.max(drawdown, input.previous?.maximumDrawdownPct ?? 0);
  return {
    id: `benchmark_val_${input.config.id}_${input.runDate}`,
    benchmarkId: input.config.id,
    portfolioId: input.config.portfolioId,
    valuationDate: input.runDate,
    cashValueUsd: value.cashValueUsd,
    investedValueUsd: value.investedValueUsd,
    totalValueUsd: value.totalValueUsd,
    dailyChangeUsd: previousValue === null ? null : subtractMoney(value.totalValueUsd, previousValue),
    dailyChangePct: previousValue === null ? null : pctChange(previousValue, value.totalValueUsd),
    cumulativeReturnPct: pctChange(start, value.totalValueUsd),
    highWaterMarkUsd: roundMoney(highWater),
    currentDrawdownPct: drawdown,
    maximumDrawdownPct: maxDrawdown,
    marketDataSnapshotId: value.marketDataSnapshotId,
    dataTimestamp: value.dataTimestamp,
    pricingStatus: value.pricingStatus,
    unavailableReason: value.unavailableReason,
    assumptions: value.assumptions
  };
}

export function calculateInterestBenchmarkValue(startingCapitalUsd: number, annualRate: number, startDate: string, valuationDate: string): number {
  const days = Math.max(0, daysBetween(startDate, valuationDate));
  return roundMoney(startingCapitalUsd * Math.pow(1 + annualRate / 365, days));
}

export function initializeBenchmarkShares(startingCapitalUsd: number, allocation: Record<string, number>, priceBySymbol: Map<string, number>): Map<string, number> {
  const shares = new Map<string, number>();
  for (const [symbol, weight] of Object.entries(allocation)) {
    if (symbol.toLowerCase() === "cash") {
      continue;
    }
    const price = priceBySymbol.get(symbol);
    if (!price || price <= 0) {
      continue;
    }
    shares.set(symbol, (startingCapitalUsd * weight) / price);
  }
  return shares;
}

export function calculateBenchmarkMetrics(configs: BenchmarkConfiguration[], valuations: BenchmarkDailyValuation[]): BenchmarkMetrics[] {
  const kairox = latestFor(valuations.filter((item) => configFor(configs, item.benchmarkId)?.benchmarkKey === "kairox_actual"));
  return configs.map((config) => {
    const rows = valuations.filter((item) => item.benchmarkId === config.id).sort((a, b) => a.valuationDate.localeCompare(b.valuationDate));
    const latest = latestFor(rows);
    const returns = rows.map((row) => row.dailyChangePct).filter((value): value is number => value !== null);
    const downside = returns.filter((value) => value < 0);
    const totalGainLossUsd = latest ? subtractMoney(latest.totalValueUsd, config.startingCapitalUsd) : null;
    const difference = latest && kairox ? subtractMoney(kairox.totalValueUsd, latest.totalValueUsd) : null;
    const diffPct = latest && latest.totalValueUsd > 0 && kairox ? roundRatio(difference as number / latest.totalValueUsd) : null;
    return {
      benchmarkKey: config.benchmarkKey,
      benchmarkName: config.benchmarkName,
      currentValueUsd: latest?.totalValueUsd ?? null,
      totalGainLossUsd,
      returnPct: latest?.cumulativeReturnPct ?? null,
      annualizedReturnPct: rows.length >= 252 && latest ? annualizedReturn(config.startingCapitalUsd, latest.totalValueUsd, rows.length) : null,
      volatilityPct: returns.length >= 2 ? stdDev(returns) : null,
      maximumDrawdownPct: latest?.maximumDrawdownPct ?? null,
      currentDrawdownPct: latest?.currentDrawdownPct ?? null,
      bestDayPct: returns.length ? Math.max(...returns) : null,
      worstDayPct: returns.length ? Math.min(...returns) : null,
      positiveDayPct: returns.length ? roundRatio(returns.filter((value) => value > 0).length / returns.length) : null,
      downsideDeviationPct: downside.length >= 2 ? stdDev(downside) : null,
      sharpeRatio: returns.length >= 30 ? sharpe(returns, config.annualRate ?? 0) : null,
      sortinoRatio: returns.length >= 30 && downside.length >= 2 ? sortino(returns, downside, config.annualRate ?? 0) : null,
      returnPerDrawdown: latest && latest.maximumDrawdownPct > 0 ? roundRatio(latest.cumulativeReturnPct / latest.maximumDrawdownPct) : null,
      daysSinceStart: rows.length,
      differenceVsKairoxUsd: config.benchmarkKey === "kairox_actual" ? 0 : difference,
      differenceVsKairoxPct: config.benchmarkKey === "kairox_actual" ? 0 : diffPct,
      aheadBehind: aheadBehind(config.benchmarkKey, difference),
      riskLevel: riskLevelFor(config),
      pricingStatus: latest?.pricingStatus ?? "unavailable",
      dataTimestamp: latest?.dataTimestamp ?? null,
      unavailableReason: latest?.unavailableReason ?? null
    };
  });
}

export function evidenceQuality(days: number): EvidenceQuality {
  if (days >= 250) {
    return { label: "Strong", days, description: "At least 250 market days; evidence is stronger but still not a guarantee." };
  }
  if (days >= 90) {
    return { label: "Moderate", days, description: "At least 90 market days; comparisons are becoming more informative." };
  }
  if (days >= 30) {
    return { label: "Developing", days, description: "At least 30 market days; evidence remains limited." };
  }
  return { label: "Preliminary", days, description: "Fewer than 30 market days; comparisons are early and should not be treated as proof." };
}

export function buildProofSummary(benchmarks: BenchmarkMetrics[], evidence: EvidenceQuality): string {
  const kairox = benchmarks.find((item) => item.benchmarkKey === "kairox_actual");
  if (!kairox || kairox.currentValueUsd === null) {
    return "Benchmark comparison is initialized, but Kairox portfolio valuation is not available yet.";
  }
  const completed = benchmarks.filter((item) => item.currentValueUsd !== null).length;
  return `${evidence.label} evidence across ${evidence.days} valuation day${evidence.days === 1 ? "" : "s"}. ${completed} comparison series have usable values. This is a paper IRA simulation and does not prove future profitability.`;
}

function valueBenchmark(config: BenchmarkConfiguration, valuationDate: string, now: Date, snapshot: MarketDataSnapshot, startingPriceBySymbol: Map<string, number>, actual: { totalValueUsd: number; cashUsd: number; investedUsd: number; dataTimestamp: string | null }): {
  cashValueUsd: number;
  investedValueUsd: number;
  totalValueUsd: number;
  marketDataSnapshotId: string | null;
  dataTimestamp: string | null;
  pricingStatus: BenchmarkPricingStatus;
  unavailableReason: string | null;
  assumptions: Record<string, unknown>;
} {
  if (config.benchmarkType === "actual") {
    return {
      cashValueUsd: roundMoney(actual.cashUsd),
      investedValueUsd: roundMoney(actual.investedUsd),
      totalValueUsd: roundMoney(actual.totalValueUsd),
      marketDataSnapshotId: snapshot.id,
      dataTimestamp: actual.dataTimestamp ?? now.toISOString(),
      pricingStatus: "complete",
      unavailableReason: null,
      assumptions: { source: "actual_paper_portfolio", noTradesCreated: true }
    };
  }
  if (config.benchmarkType === "cash" || config.benchmarkType === "interest") {
    const rate = config.annualRate ?? 0;
    const total = calculateInterestBenchmarkValue(config.startingCapitalUsd, rate, config.startDate, valuationDate);
    return {
      cashValueUsd: total,
      investedValueUsd: 0,
      totalValueUsd: total,
      marketDataSnapshotId: null,
      dataTimestamp: now.toISOString(),
      pricingStatus: "complete",
      unavailableReason: null,
      assumptions: { annualRate: rate, apy: config.apy ?? rate, accrual: "daily", rateIsAssumption: true }
    };
  }
  const shares = initializeBenchmarkShares(config.startingCapitalUsd, config.allocation, startingPriceBySymbol);
  const missing = Object.keys(config.allocation).filter((symbol) => symbol.toLowerCase() !== "cash" && !shares.has(symbol));
  if (missing.length > 0) {
    return {
      cashValueUsd: 0,
      investedValueUsd: 0,
      totalValueUsd: 0,
      marketDataSnapshotId: snapshot.id,
      dataTimestamp: snapshot.createdAt,
      pricingStatus: "unavailable",
      unavailableReason: `Missing trusted pricing for ${missing.join(", ")}.`,
      assumptions: { allocation: config.allocation, dividendRule: config.dividendRule, noFabricatedPrices: true }
    };
  }
  let invested = 0;
  let latestTimestamp: string | null = null;
  for (const [symbol, quantity] of shares) {
    const quote = snapshot.quotes.get(symbol);
    if (!isTrustedQuote(quote)) {
      return {
        cashValueUsd: 0,
        investedValueUsd: 0,
        totalValueUsd: 0,
        marketDataSnapshotId: snapshot.id,
        dataTimestamp: snapshot.createdAt,
        pricingStatus: "unavailable",
        unavailableReason: `Current trusted pricing is unavailable for ${symbol}.`,
        assumptions: { allocation: config.allocation, noFabricatedPrices: true }
      };
    }
    invested += quantity * (quote.lastPrice as number);
    latestTimestamp = maxTimestamp(latestTimestamp, quote.providerTimestamp ?? quote.receivedTimestamp);
  }
  const cashWeight = config.allocation.cash ?? 0;
  const cash = roundMoney(config.startingCapitalUsd * cashWeight);
  return {
    cashValueUsd: cash,
    investedValueUsd: roundMoney(invested),
    totalValueUsd: roundMoney(invested + cash),
    marketDataSnapshotId: snapshot.id,
    dataTimestamp: latestTimestamp ?? snapshot.createdAt,
    pricingStatus: "complete",
    unavailableReason: null,
    assumptions: { allocation: config.allocation, shares: Object.fromEntries(shares), dividendRule: config.dividendRule, adjustedDividendsAvailable: false }
  };
}

function defaultDefinitions(portfolioId: string, startingCapitalUsd: number, startDate: string): BenchmarkConfiguration[] {
  return [
    definition(portfolioId, "kairox_actual", "Kairox IRA paper portfolio", "actual", startingCapitalUsd, startDate, null, {}),
    definition(portfolioId, "cash", "Cash benchmark", "cash", startingCapitalUsd, startDate, 0, { cash: 1 }),
    definition(portfolioId, "bank_interest", "Bank-interest benchmark", "interest", startingCapitalUsd, startDate, 0.04, { cash: 1 }),
    definition(portfolioId, "cd_style", "CD-style benchmark", "interest", startingCapitalUsd, startDate, 0.045, { cash: 1 }),
    definition(portfolioId, "vti_buy_hold", "100% VTI buy-and-hold", "market", startingCapitalUsd, startDate, null, { VTI: 1 }),
    definition(portfolioId, "conservative_60_40", "Conservative 60/40 benchmark", "market", startingCapitalUsd, startDate, 0, { VTI: 0.6, BND: 0.4 })
  ];
}

function definition(portfolioId: string, key: BenchmarkKey, name: string, type: BenchmarkConfiguration["benchmarkType"], startingCapitalUsd: number, startDate: string, rate: number | null, allocation: Record<string, number>): BenchmarkConfiguration {
  return {
    id: `benchmark_${portfolioId}_${key}_v1`,
    portfolioId,
    benchmarkKey: key,
    benchmarkName: name,
    benchmarkType: type,
    version: 1,
    startingCapitalUsd,
    startDate,
    annualRate: rate,
    apy: rate,
    allocation,
    rebalanceRule: type === "market" ? "buy and hold" : "none",
    dividendRule: type === "market" ? "dividends included only when reliable data is available" : "interest only; no dividends",
    dataProvider: type === "market" ? "MarketDataService" : type === "actual" ? "Kairox valuation" : "internal assumption",
    active: true,
    notes: "Seeded benchmark comparison configuration."
  };
}

function mapConfigRow(row: ConfigRow): BenchmarkConfiguration {
  return {
    id: row.id,
    portfolioId: row.portfolioId,
    benchmarkKey: row.benchmarkKey,
    benchmarkName: row.benchmarkName,
    benchmarkType: row.benchmarkType,
    version: row.version,
    startingCapitalUsd: row.startingCapitalUsd,
    startDate: row.startDate,
    annualRate: row.annualRate,
    apy: row.apy,
    allocation: parseJson(row.allocationJson, {}),
    rebalanceRule: row.rebalanceRule,
    dividendRule: row.dividendRule,
    dataProvider: row.dataProvider,
    active: row.active === 1,
    notes: row.notes
  };
}

function mapValuationRow(row: ValuationRow): BenchmarkDailyValuation {
  return {
    id: row.id,
    benchmarkId: row.benchmarkId,
    portfolioId: row.portfolioId,
    valuationDate: row.valuationDate,
    cashValueUsd: row.cashValueUsd,
    investedValueUsd: row.investedValueUsd,
    totalValueUsd: row.totalValueUsd,
    dailyChangeUsd: row.dailyChangeUsd,
    dailyChangePct: row.dailyChangePct,
    cumulativeReturnPct: row.cumulativeReturnPct,
    highWaterMarkUsd: row.highWaterMarkUsd,
    currentDrawdownPct: row.currentDrawdownPct,
    maximumDrawdownPct: row.maximumDrawdownPct,
    marketDataSnapshotId: row.marketDataSnapshotId,
    dataTimestamp: row.dataTimestamp,
    pricingStatus: row.pricingStatus,
    unavailableReason: row.unavailableReason,
    assumptions: parseJson(row.assumptionsJson, {})
  };
}

function configFor(configs: BenchmarkConfiguration[], benchmarkId: string): BenchmarkConfiguration | undefined {
  return configs.find((config) => config.id === benchmarkId);
}

function latestFor(rows: BenchmarkDailyValuation[]): BenchmarkDailyValuation | null {
  return rows.length ? rows[rows.length - 1] : null;
}

function requiredSymbols(configs: BenchmarkConfiguration[]): string[] {
  return [...new Set(configs.flatMap((config) => Object.keys(config.allocation).filter((symbol) => symbol.toLowerCase() !== "cash")))];
}

function isTrustedQuote(quote: NormalizedQuote | undefined): quote is NormalizedQuote {
  return Boolean(quote && quote.lastPrice !== null && quote.lastPrice > 0 && ["Valid", "Delayed", "Previous Close"].includes(quote.dataQualityStatus));
}

function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
  return Math.floor((end - start) / 86400000);
}

function annualizedReturn(start: number, end: number, days: number): number | null {
  if (start <= 0 || days < 252) {
    return null;
  }
  return roundRatio(Math.pow(end / start, 252 / days) - 1);
}

function stdDev(values: number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function sharpe(returns: number[], annualRate: number): number | null {
  const dailyRiskFree = annualRate / 252;
  const excess = returns.map((value) => value - dailyRiskFree);
  const deviation = stdDev(excess);
  if (deviation === 0) {
    return null;
  }
  return roundRatio((excess.reduce((sum, value) => sum + value, 0) / excess.length / deviation) * Math.sqrt(252));
}

function sortino(returns: number[], downside: number[], annualRate: number): number | null {
  const dailyRiskFree = annualRate / 252;
  const downsideDeviation = stdDev(downside);
  if (downsideDeviation === 0) {
    return null;
  }
  const averageExcess = returns.reduce((sum, value) => sum + value - dailyRiskFree, 0) / returns.length;
  return roundRatio((averageExcess / downsideDeviation) * Math.sqrt(252));
}

function aheadBehind(key: BenchmarkKey, difference: number | null): BenchmarkMetrics["aheadBehind"] {
  if (key === "kairox_actual") return "even";
  if (difference === null) return "unavailable";
  if (Math.abs(difference) < 0.005) return "even";
  return difference > 0 ? "ahead" : "behind";
}

function riskLevelFor(config: BenchmarkConfiguration): BenchmarkMetrics["riskLevel"] {
  if (config.benchmarkType === "cash" || config.benchmarkType === "interest") return "Cash-like";
  if (config.benchmarkKey === "conservative_60_40") return "Moderate";
  if (config.benchmarkKey === "vti_buy_hold") return "Equity";
  if (config.benchmarkKey === "kairox_actual") return "Moderate";
  return "Unavailable";
}

function buildMonthlyReport(summary: BenchmarkComparisonSummary, month: string, version: number): { html: string; csv: string; json: Record<string, unknown> } {
  const rows = summary.benchmarks.map((item) => ({
    benchmark: item.benchmarkName,
    valueUsd: item.currentValueUsd,
    returnPct: item.returnPct,
    drawdownPct: item.maximumDrawdownPct,
    differenceVsKairoxUsd: item.differenceVsKairoxUsd,
    status: item.pricingStatus
  }));
  const csv = [
    "benchmark,value_usd,return_pct,max_drawdown_pct,difference_vs_kairox_usd,pricing_status",
    ...rows.map((row) => [row.benchmark, row.valueUsd ?? "", row.returnPct ?? "", row.drawdownPct ?? "", row.differenceVsKairoxUsd ?? "", row.status].join(","))
  ].join("\n");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Kairox IRA Benchmark Report ${escapeHtml(month)}</title></head><body><h1>Kairox IRA benchmark report</h1><p>Paper simulation. Conservative strategy. Not live brokerage performance.</p><p>${escapeHtml(summary.proofSummary)}</p><table><thead><tr><th>Benchmark</th><th>Value</th><th>Return</th><th>Drawdown</th><th>Status</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.benchmark)}</td><td>${escapeHtml(formatCurrency(row.valueUsd))}</td><td>${escapeHtml(formatPercent(row.returnPct))}</td><td>${escapeHtml(formatPercent(row.drawdownPct))}</td><td>${escapeHtml(row.status)}</td></tr>`).join("")}</tbody></table></body></html>`;
  return {
    html,
    csv,
    json: {
      reportMonth: month,
      version,
      account: "IRA",
      simulation: "Paper",
      strategy: "Conservative",
      disclaimer: "Paper simulation. Not live brokerage performance. Past simulated performance does not guarantee future results.",
      evidence: summary.evidence,
      rows,
      proofSummary: summary.proofSummary
    }
  };
}

function previousMonth(now: Date): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return date.toISOString().slice(0, 7);
}

function maxTimestamp(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isMissingBenchmarkTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /benchmark_configurations|benchmark_daily_valuations|no such table/i.test(message);
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
