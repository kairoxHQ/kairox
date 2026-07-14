import assert from "node:assert/strict";
import { test } from "node:test";
import { MarketDataService, quoteToMarketDataset, validateQuote, type NormalizedQuote } from "../src/market/service.ts";
import type { MarketDataProvider } from "../src/market/provider.ts";
import type { MarketDataset } from "../src/shared/types.ts";
import { buildPaperExecutionPlan } from "../src/orders/execution.ts";
import type { InvestmentPolicy } from "../src/policies/investmentPolicy.ts";

test("MarketDataService returns a valid primary quote and writes trusted cache and health", async () => {
  const db = new MemoryD1();
  const provider = providerWith("primary", dataset("SPY", 600));
  const service = new MarketDataService(db as unknown as D1Database, { primaryProvider: provider });

  const quote = await service.getQuote("SPY", "dashboard", now());

  assert.equal(quote.dataQualityStatus, "Valid");
  assert.equal(quote.source, "primary");
  assert.equal(db.cache.get("SPY")?.provider, "primary");
  assert.equal(db.health.get("primary")?.successful_requests, 1);
});

test("primary failure falls back to valid secondary and records fallback usage", async () => {
  const db = new MemoryD1();
  const service = new MarketDataService(db as unknown as D1Database, {
    primaryProvider: failingProvider("primary"),
    secondaryProvider: providerWith("secondary", dataset("SPY", 601))
  });

  const quote = await service.getQuote("SPY", "dashboard", now());

  assert.equal(quote.providerName, "secondary");
  assert.equal(quote.source, "secondary");
  assert.equal(db.health.get("secondary")?.fallback_uses, 1);
});

test("both providers unavailable returns structured unavailable result", async () => {
  const db = new MemoryD1();
  const service = new MarketDataService(db as unknown as D1Database, {
    primaryProvider: failingProvider("primary"),
    secondaryProvider: failingProvider("secondary")
  });

  const quote = await service.getQuote("SPY", "dashboard", now());

  assert.equal(quote.validation.valid, false);
  assert.equal(quote.dataQualityStatus, "Provider Failure");
  assert.equal(quote.lastPrice, null);
});

test("trusted cached fallback is allowed for dashboard and prohibited for paper execution", async () => {
  const db = new MemoryD1();
  db.cache.set("SPY", {
    normalizedQuoteJson: JSON.stringify(quote("SPY", 600, "primary")),
    provider: "primary",
    qualityStatus: "Valid",
    providerTimestamp: "2026-07-13T20:00:00.000Z",
    retrievalTimestamp: "2026-07-13T20:01:00.000Z",
    expiresAt: "2026-07-14T20:00:00.000Z",
    validationResultJson: "{}",
    quoteHash: "abc"
  });
  const service = new MarketDataService(db as unknown as D1Database, { primaryProvider: failingProvider("primary") });

  assert.equal((await service.getQuote("SPY", "dashboard", now())).cached, true);
  assert.equal((await service.getQuote("SPY", "paper_execution", now())).cached, false);
  assert.equal((await service.getQuote("SPY", "paper_execution", now())).validation.valid, false);
});

test("stale quote, weekend previous-close, and market-holiday handling are market aware", async () => {
  const stale = quote("SPY", 600, "primary", "2026-07-10T20:00:00.000Z");
  assert.equal(validateQuote(stale, new Date("2026-07-14T20:00:00.000Z"), { maxAgeMs: 60_000, allowCachedFallback: false, allowPreviousClose: false, strict: true }).status, "Stale");

  const weekend = validateQuote(stale, new Date("2026-07-12T16:00:00.000Z"), { maxAgeMs: 60_000, allowCachedFallback: false, allowPreviousClose: true, strict: false });
  assert.equal(weekend.status, "Previous Close");
  assert.equal(weekend.valid, true);

  const holiday = validateQuote(quote("SPY", 600, "primary", "2026-07-02T20:00:00.000Z"), new Date("2026-07-03T16:00:00.000Z"), { maxAgeMs: 60_000, allowCachedFallback: false, allowPreviousClose: true, strict: false });
  assert.equal(holiday.status, "Previous Close");
});

test("quote anomaly detection catches invalid price shapes", () => {
  assert.equal(validateQuote({ ...quote("SPY", 0, "primary"), lastPrice: 0 }, now()).status, "Missing");
  assert.equal(validateQuote({ ...quote("SPY", 600, "primary"), bid: 601, ask: 600 }, now()).status, "Anomalous");
  assert.equal(validateQuote(quote("SPY", 600, "primary", "2026-07-15T20:00:00.000Z"), now()).status, "Anomalous");
  assert.equal(validateQuote({ ...quote("SPY", 600, "primary"), currency: "EUR" }, now()).status, "Anomalous");
  assert.equal(validateQuote({ ...quote("SPY", 900, "primary"), previousClose: 600 }, now()).status, "Anomalous");
});

test("provider disagreement is marked conflicting and does not replace trusted cache", async () => {
  const db = new MemoryD1();
  db.cache.set("SPY", {
    normalizedQuoteJson: JSON.stringify(quote("SPY", 600, "trusted")),
    provider: "trusted",
    qualityStatus: "Valid",
    providerTimestamp: "2026-07-13T20:00:00.000Z",
    retrievalTimestamp: "2026-07-13T20:01:00.000Z",
    expiresAt: "2026-07-14T20:00:00.000Z",
    validationResultJson: "{}",
    quoteHash: "trusted"
  });
  const service = new MarketDataService(db as unknown as D1Database, {
    primaryProvider: providerWith("primary", dataset("SPY", 600)),
    secondaryProvider: providerWith("secondary", dataset("SPY", 650, 645, 655, 640)),
    providerDisagreementPct: 0.03
  });

  const result = await service.getQuote("SPY", "paper_execution", now());

  assert.equal(result.dataQualityStatus, "Conflicting");
  assert.equal(db.cache.get("SPY")?.provider, "trusted");
  assert.equal(db.anomalies.some((item) => item.anomaly_type === "provider_disagreement"), true);
});

test("historical import is idempotent and distinguishes adjusted fields", async () => {
  const db = new MemoryD1();
  const service = new MarketDataService(db as unknown as D1Database, { primaryProvider: providerWith("primary", dataset("SPY", 600)) });

  await service.getHistoricalPrices("SPY", "2026-07-10", "2026-07-13", now());
  await service.getHistoricalPrices("SPY", "2026-07-10", "2026-07-13", now());

  assert.equal(db.bars.size, 2);
  assert.equal([...db.bars.values()][0].adjusted_close, null);
  assert.equal([...db.bars.values()][0].dividend_adjustment_status, "unknown");
});

test("unknown security classification is ineligible until classified", async () => {
  const metadata = await new MarketDataService(new MemoryD1() as unknown as D1Database).getSecurityMetadata("MYSTERY");

  assert.equal(metadata.assetType, "unknown");
  assert.equal(metadata.eligibilityStatus, "unknown");
  assert.match(metadata.reasons.join(" "), /unknown/i);
});

test("request batching and deduplication reuse one provider result per workflow snapshot", async () => {
  const db = new MemoryD1();
  let calls = 0;
  const service = new MarketDataService(db as unknown as D1Database, {
    primaryProvider: {
      name: "primary",
      getLatestPrice: async () => dataset("SPY", 600),
      getMarketData: async () => {
        calls += 1;
        return dataset("SPY", 600);
      }
    }
  });

  const snapshot = await service.createSnapshot(["SPY", "SPY"], "daily_review", now());

  assert.equal(snapshot.quotes.size, 1);
  assert.equal(calls, 1);
});

test("invalid execution quote cannot reach paper execution plan or mutate cash", () => {
  const plan = buildPaperExecutionPlan({
    batch: {
      id: "batch_1",
      portfolioId: "portfolio_ira",
      proposalId: "proposal_1",
      proposalVersion: 1,
      totalEstimatedPurchaseUsd: 100,
      estimatedRemainingCashUsd: 2300,
      orderCount: 1,
      validationStatus: "passed",
      validationReport: { compliant: true, reasons: [], warnings: [] },
      priceDeviationStatus: "none",
      priceDeviationThresholdPct: 0.03,
      status: "Ready to Execute",
      rejectionReason: null,
      cancelledReason: null,
      reviewedAt: null,
      rejectedAt: null,
      cancelledAt: null,
      createdAt: now().toISOString(),
      orders: [{
        id: "order_1",
        batchId: "batch_1",
        portfolioId: "portfolio_ira",
        proposalId: "proposal_1",
        proposalVersion: 1,
        lineOrder: 1,
        symbol: "SPY",
        securityName: "SPDR S&P 500 ETF",
        side: "Buy",
        orderType: "market",
        estimatedQuantity: 0.1,
        estimatedDollarAmountUsd: 60,
        referencePriceUsd: 600,
        latestReferencePriceUsd: 600,
        marketDataTimestamp: now().toISOString(),
        assetCategory: "U.S. broad-market equity",
        assetClass: "etf",
        investmentRationale: "test",
        confidenceScore: 0.8,
        policyValidation: { allowed: true, reasons: [] },
        priceDeviationPct: 0,
        priceDeviationWarning: false,
        fractionalQuantitySupported: true,
        status: "Pending Review",
        createdAt: now().toISOString()
      }]
    },
    portfolio: { id: "portfolio_ira", cashUsd: 2400, startingBalanceUsd: 2400, mode: "paper", brokerAccountId: null },
    policy: { maxSinglePositionAllocationPct: 0.2, maxSectorAllocationPct: 0.3, minCashAllocationPct: 0.1, maxDrawdownPct: 0.1 } as InvestmentPolicy,
    positions: [],
    assets: [{ symbol: "SPY", assetClass: "etf", fractionalSupported: true, quantityPrecision: 6 }],
    prices: [],
    nowIso: now().toISOString()
  });

  assert.equal(plan.validation.compliant, false);
  assert.match(plan.validation.reasons.join(" "), /unavailable or stale/);
  assert.equal(plan.execution.cashBeforeUsd, 2400);
});

function now(): Date {
  return new Date("2026-07-14T16:00:00.000Z");
}

function providerWith(name: string, data: MarketDataset): MarketDataProvider {
  return {
    name,
    getLatestPrice: async () => data,
    getMarketData: async () => ({ ...data, source: name })
  };
}

function failingProvider(name: string): MarketDataProvider {
  return {
    name,
    getLatestPrice: async () => { throw new Error("provider failed"); },
    getMarketData: async () => { throw new Error("provider failed"); }
  };
}

function dataset(symbol: string, price: number, previousClose = 598, high = 605, low = 590): MarketDataset {
  return {
    symbol,
    assetClass: "etf",
    priceUsd: price,
    asOf: "2026-07-14T15:59:00.000Z",
    source: "mock",
    validated: price > 0,
    stale: false,
    volume: 1000000,
    candles: [
      { timestamp: "2026-07-10T20:00:00.000Z", open: previousClose - 5, high: previousClose + 5, low: previousClose - 10, close: previousClose, volume: 1000 },
      { timestamp: "2026-07-13T20:00:00.000Z", open: previousClose, high, low, close: price, volume: 1100 }
    ],
    status: price > 0 ? "validated" : "unavailable",
    quality: price > 0 ? "fresh" : "invalid"
  };
}

function quote(symbol: string, price: number, provider: string, timestamp = "2026-07-14T15:59:00.000Z"): NormalizedQuote {
  return {
    symbol,
    securityName: symbol,
    assetType: "etf",
    exchange: "US",
    currency: "USD",
    bid: null,
    ask: null,
    lastPrice: price > 0 ? price : null,
    previousClose: 598,
    marketSession: "regular",
    providerTimestamp: timestamp,
    receivedTimestamp: now().toISOString(),
    providerName: provider,
    dataQualityStatus: "Valid",
    source: "primary",
    cached: false,
    warnings: [],
    validation: { valid: true, status: "Valid", reasons: [], warnings: [] },
    candles: dataset(symbol, price || 600).candles,
    volume: 1000
  };
}

class MemoryD1 {
  assets = new Map<string, unknown>([
    ["SPY", { symbol: "SPY", displayName: "SPDR S&P 500 ETF", assetType: "etf", market: "US", currency: "USD", fractionalSupported: 1, tradable: 1 }]
  ]);
  cache = new Map<string, Record<string, unknown>>();
  health = new Map<string, Record<string, number | string | null>>();
  anomalies: Record<string, unknown>[] = [];
  bars = new Map<string, Record<string, unknown>>();
  snapshots = new Map<string, unknown>();

  prepare(sql: string) {
    const db = this;
    let params: unknown[] = [];
    return {
      bind(...values: unknown[]) {
        params = values;
        return this;
      },
      async first() {
        if (/FROM assets/i.test(sql)) return db.assets.get(String(params[0])) ?? null;
        if (/FROM trusted_quote_cache/i.test(sql)) return db.cache.get(String(params[0])) ?? null;
        return null;
      },
      async all() {
        if (/historical_price_bars/i.test(sql)) return { results: [...db.bars.values()] };
        if (/market_data_provider_health/i.test(sql)) return { results: [...db.health.values()] };
        if (/trusted_quote_cache/i.test(sql)) return { results: [...db.cache.values()] };
        if (/market_data_anomalies/i.test(sql)) return { results: db.anomalies };
        return { results: [] };
      },
      async run() {
        if (/trusted_quote_cache/i.test(sql)) {
          db.cache.set(String(params[0]), {
            symbol: params[0],
            normalizedQuoteJson: params[1],
            provider: params[2],
            qualityStatus: params[3],
            providerTimestamp: params[4],
            retrievalTimestamp: params[5],
            expiresAt: params[6],
            validationResultJson: params[7],
            quoteHash: params[8]
          });
        } else if (/historical_price_bars/i.test(sql)) {
          db.bars.set(`${params[0]}:${params[1]}:${params[10]}`, {
            symbol: params[0],
            trading_date: params[1],
            adjusted_close: params[6],
            dividend_adjustment_status: params[8],
            split_adjustment_status: params[9],
            provider: params[10]
          });
        } else if (/market_data_provider_health/i.test(sql)) {
          const provider = String(params[0]);
          const current = db.health.get(provider) ?? { provider, successful_requests: 0, failed_requests: 0, timeout_requests: 0, rate_limit_responses: 0, fallback_uses: 0, total_latency_ms: 0 };
          if (sql.includes("fallback_uses") && !sql.includes("successful_requests")) {
            current.fallback_uses = Number(current.fallback_uses) + 1;
          } else {
            current.successful_requests = Number(current.successful_requests) + Number(params[1] ?? 0);
            current.failed_requests = Number(current.failed_requests) + Number(params[2] ?? 0);
            current.timeout_requests = Number(current.timeout_requests) + Number(params[3] ?? 0);
            current.rate_limit_responses = Number(current.rate_limit_responses) + Number(params[4] ?? 0);
            current.total_latency_ms = Number(current.total_latency_ms) + Number(params[5] ?? 0);
          }
          db.health.set(provider, current);
        } else if (/market_data_anomalies/i.test(sql)) {
          db.anomalies.push({ id: params[0], symbol: params[1], provider: params[2], quality_status: params[3], anomaly_type: params[4], message: params[5] });
        } else if (/market_data_snapshots/i.test(sql)) {
          db.snapshots.set(String(params[0]), { id: params[0], use_case: params[1] });
        }
        return { success: true };
      }
    };
  }

  async batch(statements: Array<{ run: () => Promise<unknown> }>) {
    for (const statement of statements) await statement.run();
    return [];
  }
}
