import { MarketDataService, type MarketDataSnapshot, type NormalizedQuote } from "../market/service.ts";
import { getInvestmentPolicy, validateInvestmentPolicy } from "../policies/investmentPolicy.ts";
import { getPortfolioValuation } from "../portfolio/valuation.ts";
import { listRows } from "../shared/db.ts";
import { pctChange, roundRatio } from "../shared/money.ts";
import type { AssetClass, Env } from "../shared/types.ts";

export type ResearchRankBy = "overall" | "dividend" | "growth" | "quality" | "risk" | "momentum" | "income";
export type ResearchWatchStatus = "Watching" | "Candidate" | "Owned" | "Rejected" | "Archived";

export interface SecurityResearchProfile {
  symbol: string;
  companyOrFund: string;
  assetType: string;
  sector: string | null;
  industry: string | null;
  marketCapUsd: number | null;
  dividendYield: number | null;
  expenseRatio: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  beta: number | null;
  averageVolume: number | null;
  volatility: number | null;
  priceHistory: number[];
  scores: ResearchScores;
  overallKairoxScore: number;
  explanation: ResearchExplanation;
  dataQualityStatus: string;
  latestMarketDataSnapshotId: string | null;
  lastScoredAt: string;
}

export interface ResearchScores {
  valuation: number;
  quality: number;
  growth: number;
  income: number;
  technicalTrend: number;
  momentum: number;
  risk: number;
  diversification: number;
  research: number;
}

export interface ResearchExplanation {
  scoreChange: string;
  rankReason: string;
  strengths: string[];
  weaknesses: string[];
  mainRisks: string[];
  moduleExplanations: Record<string, string>;
}

export interface PortfolioFit {
  symbol: string;
  diversificationContribution: number;
  incomeContribution: number;
  riskContribution: number;
  correlationScore: number;
  policyCompatibility: number;
  cashEfficiency: number;
  fitScore: number;
  explanation: ResearchExplanation;
}

export interface ResearchCandidateSnapshot {
  portfolioId: string;
  snapshotDate: string;
  topCandidates: SecurityResearchProfile[];
  topDividendEtfs: SecurityResearchProfile[];
  topBroadMarketEtfs: SecurityResearchProfile[];
  topBondEtfs: SecurityResearchProfile[];
  topDefensivePositions: SecurityResearchProfile[];
  topGrowthPositions: SecurityResearchProfile[];
}

export interface ResearchCenterSummary {
  portfolioId: string;
  latestSnapshotId: string | null;
  topRanked: SecurityResearchProfile[];
  biggestMovers: Array<{ symbol: string; scoreChange: number; explanation: string }>;
  scoreChanges: Array<{ symbol: string; periodKey: string; scoreChange: number; explanation: string }>;
  watchlist: Array<{ symbol: string; status: ResearchWatchStatus; reason: string | null }>;
  owned: SecurityResearchProfile[];
  candidates: ResearchCandidateSnapshot | null;
  history: Array<{ symbol: string; periodType: string; periodKey: string; overallKairoxScore: number; scoreChange: number }>;
  warnings: string[];
}

export interface ResearchRunResult {
  portfolioId: string;
  snapshotId: string | null;
  securitiesEvaluated: number;
  topRanked: SecurityResearchProfile[];
  candidates: ResearchCandidateSnapshot;
  warnings: string[];
}

interface KnownSecurity {
  symbol: string;
  companyOrFund: string;
  assetType: string;
  sector: string | null;
  industry: string | null;
  expenseRatio: number | null;
  dividendCapable: boolean;
  averageVolume: number | null;
  volatility: number | null;
  maximumDrawdown: number | null;
  historicalReturn: number | null;
  dividendYield: number | null;
  tradable: boolean;
}

interface ProfileRow {
  symbol: string;
  companyOrFund: string;
  assetType: string;
  sector: string | null;
  industry: string | null;
  marketCapUsd: number | null;
  dividendYield: number | null;
  expenseRatio: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  beta: number | null;
  averageVolume: number | null;
  volatility: number | null;
  priceHistoryJson: string;
  valuationScore: number;
  qualityScore: number;
  growthScore: number;
  incomeScore: number;
  technicalTrendScore: number;
  momentumScore: number;
  riskScore: number;
  diversificationScore: number;
  researchScore: number;
  overallKairoxScore: number;
  explanationJson: string;
  dataQualityStatus: string;
  latestMarketDataSnapshotId: string | null;
  lastScoredAt: string;
}

interface HistoryRow {
  symbol: string;
  periodType: string;
  periodKey: string;
  overallKairoxScore: number;
  scoreChange: number;
  changeExplanation: string;
}

interface WatchRow {
  symbol: string;
  status: ResearchWatchStatus;
  reason: string | null;
}

export const RESEARCH_ENGINE_VERSION = "research-engine-v1";

const SCORE_WEIGHTS = {
  valuation: 0.12,
  quality: 0.16,
  growth: 0.12,
  income: 0.12,
  technicalTrend: 0.12,
  momentum: 0.1,
  risk: 0.16,
  diversification: 0.1
};

export class PortfolioResearchEngine {
  private readonly db: D1Database;
  private readonly marketData: MarketDataService;

  constructor(db: D1Database, marketData = new MarketDataService(db)) {
    this.db = db;
    this.marketData = marketData;
  }

  async run(portfolioId = "portfolio_ira", now = new Date()): Promise<ResearchRunResult> {
    const securities = await this.knownSecurities();
    const symbols = securities.map((security) => security.symbol);
    const snapshot = symbols.length ? await this.marketData.createSnapshot(symbols, "daily_review", now) : null;
    const previous = await this.previousScores();
    const fits = await this.portfolioFits(portfolioId, securities, snapshot, now);
    const profiles = securities.map((security) => this.scoreSecurity(security, snapshot?.quotes.get(security.symbol) ?? null, previous.get(security.symbol), fits.get(security.symbol), snapshot?.id ?? null, now));
    for (const profile of profiles) {
      await this.persistProfile(profile, previous.get(profile.symbol), now);
    }
    await this.persistWatchlist(portfolioId, profiles, now);
    for (const fit of fits.values()) {
      await this.persistFit(portfolioId, fit, snapshot?.id ?? null, now);
    }
    const candidates = await this.persistCandidates(portfolioId, profiles, snapshot?.id ?? null, now);
    await this.audit(portfolioId, null, "research_run_completed", "Security research run completed. Research only; no proposals, orders, trades, fills, or cash changes.", { securitiesEvaluated: profiles.length, snapshotId: snapshot?.id ?? null }, now);
    return {
      portfolioId,
      snapshotId: snapshot?.id ?? null,
      securitiesEvaluated: profiles.length,
      topRanked: rankProfiles(profiles, "overall").slice(0, 10),
      candidates,
      warnings: profiles.some((profile) => profile.dataQualityStatus !== "Valid" && profile.dataQualityStatus !== "Delayed" && profile.dataQualityStatus !== "Previous Close")
        ? ["Some securities used incomplete, stale, or unavailable market data."]
        : []
    };
  }

  async summary(portfolioId = "portfolio_ira"): Promise<ResearchCenterSummary> {
    const [profiles, history, watchlist, candidates] = await Promise.all([
      this.listProfiles(),
      this.history(60),
      this.watchlist(portfolioId),
      this.latestCandidates(portfolioId)
    ]);
    const ownedSymbols = new Set(await this.ownedSymbols(portfolioId));
    const latestSnapshotId = profiles.find((profile) => profile.latestMarketDataSnapshotId)?.latestMarketDataSnapshotId ?? null;
    return {
      portfolioId,
      latestSnapshotId,
      topRanked: rankProfiles(profiles, "overall").slice(0, 10),
      biggestMovers: history
        .filter((item) => item.periodType === "daily")
        .sort((left, right) => Math.abs(right.scoreChange) - Math.abs(left.scoreChange))
        .slice(0, 10)
        .map((item) => ({ symbol: item.symbol, scoreChange: item.scoreChange, explanation: item.changeExplanation })),
      scoreChanges: history.slice(0, 20).map((item) => ({ symbol: item.symbol, periodKey: item.periodKey, scoreChange: item.scoreChange, explanation: item.changeExplanation })),
      watchlist,
      owned: profiles.filter((profile) => ownedSymbols.has(profile.symbol)),
      candidates,
      history: history.map((item) => ({ symbol: item.symbol, periodType: item.periodType, periodKey: item.periodKey, overallKairoxScore: item.overallKairoxScore, scoreChange: item.scoreChange })),
      warnings: profiles.length ? [] : ["Research profiles have not been generated yet."]
    };
  }

  async rankings(rankBy: ResearchRankBy = "overall", limit = 25): Promise<SecurityResearchProfile[]> {
    return rankProfiles(await this.listProfiles(), rankBy).slice(0, limit);
  }

  private scoreSecurity(
    security: KnownSecurity,
    quote: NormalizedQuote | null,
    previousScore: number | undefined,
    fit: PortfolioFit | undefined,
    snapshotId: string | null,
    now: Date
  ): SecurityResearchProfile {
    const priceHistory = quote?.candles?.map((candle) => candle.close).filter((value) => Number.isFinite(value) && value > 0).slice(-260) ?? [];
    const latestPrice = quote?.lastPrice ?? priceHistory.at(-1) ?? null;
    const high = priceHistory.length ? Math.max(...priceHistory) : latestPrice;
    const low = priceHistory.length ? Math.min(...priceHistory) : latestPrice;
    const volatility = security.volatility ?? volatilityFromPrices(priceHistory);
    const beta = betaProxy(security.assetType, volatility);
    const scores = scoreModules({ security, quote, priceHistory, volatility, fit });
    const research = compositeScore(scores);
    const allScores = { ...scores, research };
    const overall = roundRatio(research * 0.75 + (fit?.fitScore ?? scores.diversification) * 0.25);
    const explanation = explainResearch(security, allScores, overall, previousScore, fit, quote);
    return {
      symbol: security.symbol,
      companyOrFund: security.companyOrFund,
      assetType: security.assetType,
      sector: security.sector,
      industry: security.industry,
      marketCapUsd: null,
      dividendYield: security.dividendYield,
      expenseRatio: security.expenseRatio,
      fiftyTwoWeekHigh: high,
      fiftyTwoWeekLow: low,
      beta,
      averageVolume: security.averageVolume ?? quote?.volume ?? null,
      volatility,
      priceHistory,
      scores: allScores,
      overallKairoxScore: overall,
      explanation,
      dataQualityStatus: quote?.dataQualityStatus ?? "Missing",
      latestMarketDataSnapshotId: snapshotId,
      lastScoredAt: now.toISOString()
    };
  }

  private async knownSecurities(): Promise<KnownSecurity[]> {
    const assetRows = await listRows<{
      symbol: string;
      companyOrFund: string;
      assetType: string;
      expenseRatio: number | null;
      dividendCapable: number;
      tradable: number;
    }>(
      this.db.prepare(
        `SELECT symbol, display_name AS companyOrFund, asset_type AS assetType,
          expense_ratio AS expenseRatio, dividend_capable AS dividendCapable, tradable
         FROM assets
         WHERE enabled = 1`
      )
    );
    const strategyRows = await listRows<{
      symbol: string;
      companyOrFund: string;
      assetType: string;
      sector: string;
      assetCategory: string;
      expenseRatio: number | null;
      averageVolume: number | null;
      dividendYield: number | null;
      volatility: number | null;
      maximumDrawdown: number | null;
      historicalReturn: number | null;
      eligibilityStatus: string;
    }>(
      this.db.prepare(
        `SELECT symbol, security_name AS companyOrFund, asset_type AS assetType, sector,
          asset_category AS assetCategory, expense_ratio AS expenseRatio, average_volume AS averageVolume,
          dividend_yield AS dividendYield, volatility, maximum_drawdown AS maximumDrawdown,
          historical_return AS historicalReturn, eligibility_status AS eligibilityStatus
         FROM strategy_universe_securities
         WHERE enabled = 1`
      )
    );
    const bySymbol = new Map<string, KnownSecurity>();
    for (const row of assetRows) {
      bySymbol.set(row.symbol, {
        symbol: row.symbol,
        companyOrFund: row.companyOrFund,
        assetType: row.assetType,
        sector: null,
        industry: null,
        expenseRatio: row.expenseRatio,
        dividendCapable: row.dividendCapable === 1,
        averageVolume: null,
        volatility: null,
        maximumDrawdown: null,
        historicalReturn: null,
        dividendYield: null,
        tradable: row.tradable === 1
      });
    }
    for (const row of strategyRows) {
      bySymbol.set(row.symbol, {
        ...(bySymbol.get(row.symbol) ?? {}),
        symbol: row.symbol,
        companyOrFund: row.companyOrFund,
        assetType: row.assetType,
        sector: row.sector,
        industry: row.assetCategory,
        expenseRatio: row.expenseRatio,
        dividendCapable: (row.dividendYield ?? 0) > 0,
        averageVolume: row.averageVolume,
        volatility: row.volatility,
        maximumDrawdown: row.maximumDrawdown,
        historicalReturn: row.historicalReturn,
        dividendYield: row.dividendYield,
        tradable: row.eligibilityStatus !== "ineligible"
      });
    }
    return [...bySymbol.values()].sort((left, right) => left.symbol.localeCompare(right.symbol));
  }

  private async portfolioFits(portfolioId: string, securities: KnownSecurity[], snapshot: MarketDataSnapshot | null, now: Date): Promise<Map<string, PortfolioFit>> {
    const [valuation, policy] = await Promise.all([
      getPortfolioValuation(this.db, portfolioId, now).catch(() => null),
      getInvestmentPolicy(this.db, portfolioId)
    ]);
    const held = new Map((valuation?.positions ?? []).map((position) => [position.symbol, position]));
    const heldSectors = new Set(securities.filter((security) => held.has(security.symbol)).map((security) => security.sector).filter(Boolean));
    const result = new Map<string, PortfolioFit>();
    for (const security of securities) {
      const quote = snapshot?.quotes.get(security.symbol) ?? null;
      const price = quote?.lastPrice ?? 0;
      const policyResult = policy ? validateInvestmentPolicy({
        policy,
        action: "BUY",
        symbol: security.symbol,
        assetClass: normalizeAssetClass(security.assetType),
        portfolioValueUsd: valuation?.totalAccountValueUsd ?? 1,
        cashUsd: valuation?.cashUsd ?? 0,
        currentPositionValueUsd: held.get(security.symbol)?.currentPositionValueUsd ?? 0,
        proposedTradeValueUsd: Math.min(100, valuation?.cashUsd ?? 0),
        securityTags: [security.assetType, security.industry ?? "", security.sector ?? ""]
      }) : { allowed: false, reasons: ["No policy configured."] };
      const diversification = held.has(security.symbol) ? 45 : heldSectors.has(security.sector ?? "") ? 55 : 82;
      const income = clampScore((security.dividendYield ?? 0) * 1600 + (security.dividendCapable ? 20 : 0));
      const riskContribution = clampScore(100 - (security.volatility ?? 0.2) * 180 - (security.maximumDrawdown ?? 0.25) * 60);
      const correlation = held.has(security.symbol) ? 35 : security.assetType === "bond_fund" || security.assetType === "money_market" ? 80 : 58;
      const policyCompatibility = policyResult.allowed && security.tradable ? 100 : 10;
      const cashEfficiency = price > 0 && (valuation?.cashUsd ?? 0) >= price * 0.001 ? 85 : price > 0 ? 55 : 20;
      const fitScore = roundRatio(diversification * 0.22 + income * 0.14 + riskContribution * 0.2 + correlation * 0.14 + policyCompatibility * 0.22 + cashEfficiency * 0.08);
      result.set(security.symbol, {
        symbol: security.symbol,
        diversificationContribution: diversification,
        incomeContribution: income,
        riskContribution,
        correlationScore: correlation,
        policyCompatibility,
        cashEfficiency,
        fitScore,
        explanation: {
          scoreChange: "Portfolio fit recalculated from current holdings, policy, and market data.",
          rankReason: `Fit score ${fitScore.toFixed(2)} combines diversification, income, risk, policy, and cash efficiency.`,
          strengths: policyResult.allowed ? ["Policy compatible"] : [],
          weaknesses: policyResult.allowed ? [] : policyResult.reasons,
          mainRisks: riskContribution < 50 ? ["Risk contribution is high for this portfolio."] : [],
          moduleExplanations: { policyCompatibility: policyResult.reasons.join(" ") || "Allowed by policy." }
        }
      });
    }
    return result;
  }

  private async persistProfile(profile: SecurityResearchProfile, previousScore: number | undefined, now: Date): Promise<void> {
    await this.db.prepare(
      `INSERT INTO security_research_profiles (
        symbol, company_or_fund, asset_type, sector, industry, market_cap_usd, dividend_yield,
        expense_ratio, fifty_two_week_high, fifty_two_week_low, beta, average_volume, volatility,
        price_history_json, valuation_score, quality_score, growth_score, income_score,
        technical_trend_score, momentum_score, risk_score, diversification_score, research_score,
        overall_kairox_score, explanation_json, data_quality_status, latest_market_data_snapshot_id,
        last_scored_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET
        company_or_fund = excluded.company_or_fund,
        asset_type = excluded.asset_type,
        sector = excluded.sector,
        industry = excluded.industry,
        market_cap_usd = excluded.market_cap_usd,
        dividend_yield = excluded.dividend_yield,
        expense_ratio = excluded.expense_ratio,
        fifty_two_week_high = excluded.fifty_two_week_high,
        fifty_two_week_low = excluded.fifty_two_week_low,
        beta = excluded.beta,
        average_volume = excluded.average_volume,
        volatility = excluded.volatility,
        price_history_json = excluded.price_history_json,
        valuation_score = excluded.valuation_score,
        quality_score = excluded.quality_score,
        growth_score = excluded.growth_score,
        income_score = excluded.income_score,
        technical_trend_score = excluded.technical_trend_score,
        momentum_score = excluded.momentum_score,
        risk_score = excluded.risk_score,
        diversification_score = excluded.diversification_score,
        research_score = excluded.research_score,
        overall_kairox_score = excluded.overall_kairox_score,
        explanation_json = excluded.explanation_json,
        data_quality_status = excluded.data_quality_status,
        latest_market_data_snapshot_id = excluded.latest_market_data_snapshot_id,
        last_scored_at = excluded.last_scored_at,
        updated_at = excluded.updated_at`
    ).bind(
      profile.symbol,
      profile.companyOrFund,
      profile.assetType,
      profile.sector,
      profile.industry,
      profile.marketCapUsd,
      profile.dividendYield,
      profile.expenseRatio,
      profile.fiftyTwoWeekHigh,
      profile.fiftyTwoWeekLow,
      profile.beta,
      profile.averageVolume,
      profile.volatility,
      JSON.stringify(profile.priceHistory),
      profile.scores.valuation,
      profile.scores.quality,
      profile.scores.growth,
      profile.scores.income,
      profile.scores.technicalTrend,
      profile.scores.momentum,
      profile.scores.risk,
      profile.scores.diversification,
      profile.scores.research,
      profile.overallKairoxScore,
      JSON.stringify(profile.explanation),
      profile.dataQualityStatus,
      profile.latestMarketDataSnapshotId,
      profile.lastScoredAt,
      now.toISOString()
    ).run();
    await this.persistHistory(profile, previousScore, now);
  }

  private async persistHistory(profile: SecurityResearchProfile, previousScore: number | undefined, now: Date): Promise<void> {
    const periods = [
      ["daily", accountDate(now)],
      ["weekly", weekKey(now)],
      ["monthly", accountDate(now).slice(0, 7)]
    ] as const;
    const change = roundRatio(profile.overallKairoxScore - (previousScore ?? profile.overallKairoxScore));
    for (const [periodType, periodKey] of periods) {
      await this.db.prepare(
        `INSERT OR REPLACE INTO security_research_score_history (
          id, symbol, period_type, period_key, valuation_score, quality_score, growth_score,
          income_score, technical_trend_score, momentum_score, risk_score, diversification_score,
          research_score, overall_kairox_score, score_change, change_explanation, market_data_snapshot_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        `research_history_${profile.symbol}_${periodType}_${periodKey}`,
        profile.symbol,
        periodType,
        periodKey,
        profile.scores.valuation,
        profile.scores.quality,
        profile.scores.growth,
        profile.scores.income,
        profile.scores.technicalTrend,
        profile.scores.momentum,
        profile.scores.risk,
        profile.scores.diversification,
        profile.scores.research,
        profile.overallKairoxScore,
        change,
        profile.explanation.scoreChange,
        profile.latestMarketDataSnapshotId
      ).run();
    }
  }

  private async persistWatchlist(portfolioId: string, profiles: SecurityResearchProfile[], now: Date): Promise<void> {
    const owned = new Set(await this.ownedSymbols(portfolioId));
    for (const profile of profiles) {
      const status: ResearchWatchStatus = owned.has(profile.symbol)
        ? "Owned"
        : profile.overallKairoxScore >= 70
          ? "Candidate"
          : profile.overallKairoxScore < 30
            ? "Rejected"
            : "Watching";
      await this.db.prepare(
        `INSERT INTO security_research_watchlist (id, portfolio_id, symbol, status, reason, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(portfolio_id, symbol) DO UPDATE SET status = excluded.status, reason = excluded.reason, updated_at = excluded.updated_at`
      ).bind(`research_watch_${portfolioId}_${profile.symbol}`, portfolioId, profile.symbol, status, profile.explanation.rankReason, now.toISOString()).run();
    }
  }

  private async persistFit(portfolioId: string, fit: PortfolioFit, snapshotId: string | null, now: Date): Promise<void> {
    await this.db.prepare(
      `INSERT OR REPLACE INTO security_research_portfolio_fit (
        id, portfolio_id, symbol, diversification_contribution, income_contribution,
        risk_contribution, correlation_score, policy_compatibility, cash_efficiency,
        fit_score, explanation_json, market_data_snapshot_id, calculated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      `research_fit_${portfolioId}_${fit.symbol}_${accountDate(now)}`,
      portfolioId,
      fit.symbol,
      fit.diversificationContribution,
      fit.incomeContribution,
      fit.riskContribution,
      fit.correlationScore,
      fit.policyCompatibility,
      fit.cashEfficiency,
      fit.fitScore,
      JSON.stringify(fit.explanation),
      snapshotId,
      now.toISOString()
    ).run();
  }

  private async persistCandidates(portfolioId: string, profiles: SecurityResearchProfile[], snapshotId: string | null, now: Date): Promise<ResearchCandidateSnapshot> {
    const snapshot = buildCandidateSnapshot(portfolioId, accountDate(now), profiles);
    await this.db.prepare(
      `INSERT OR REPLACE INTO security_research_candidate_snapshots (
        id, portfolio_id, snapshot_date, market_data_snapshot_id, top_candidates_json,
        top_dividend_etfs_json, top_broad_market_etfs_json, top_bond_etfs_json,
        top_defensive_positions_json, top_growth_positions_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      `research_candidates_${portfolioId}_${snapshot.snapshotDate}`,
      portfolioId,
      snapshot.snapshotDate,
      snapshotId,
      JSON.stringify(snapshot.topCandidates),
      JSON.stringify(snapshot.topDividendEtfs),
      JSON.stringify(snapshot.topBroadMarketEtfs),
      JSON.stringify(snapshot.topBondEtfs),
      JSON.stringify(snapshot.topDefensivePositions),
      JSON.stringify(snapshot.topGrowthPositions)
    ).run();
    return snapshot;
  }

  private async previousScores(): Promise<Map<string, number>> {
    const rows = await listRows<{ symbol: string; overallKairoxScore: number }>(this.db.prepare("SELECT symbol, overall_kairox_score AS overallKairoxScore FROM security_research_profiles"));
    return new Map(rows.map((row) => [row.symbol, row.overallKairoxScore]));
  }

  private async listProfiles(): Promise<SecurityResearchProfile[]> {
    const rows = await listRows<ProfileRow>(this.db.prepare("SELECT symbol, company_or_fund AS companyOrFund, asset_type AS assetType, sector, industry, market_cap_usd AS marketCapUsd, dividend_yield AS dividendYield, expense_ratio AS expenseRatio, fifty_two_week_high AS fiftyTwoWeekHigh, fifty_two_week_low AS fiftyTwoWeekLow, beta, average_volume AS averageVolume, volatility, price_history_json AS priceHistoryJson, valuation_score AS valuationScore, quality_score AS qualityScore, growth_score AS growthScore, income_score AS incomeScore, technical_trend_score AS technicalTrendScore, momentum_score AS momentumScore, risk_score AS riskScore, diversification_score AS diversificationScore, research_score AS researchScore, overall_kairox_score AS overallKairoxScore, explanation_json AS explanationJson, data_quality_status AS dataQualityStatus, latest_market_data_snapshot_id AS latestMarketDataSnapshotId, last_scored_at AS lastScoredAt FROM security_research_profiles ORDER BY overall_kairox_score DESC, symbol ASC"));
    return rows.map(mapProfile);
  }

  private async history(limit: number): Promise<HistoryRow[]> {
    return listRows<HistoryRow>(
      this.db.prepare(
        `SELECT symbol, period_type AS periodType, period_key AS periodKey,
          overall_kairox_score AS overallKairoxScore, score_change AS scoreChange,
          change_explanation AS changeExplanation
         FROM security_research_score_history
         ORDER BY created_at DESC, ABS(score_change) DESC
         LIMIT ?`
      ).bind(limit)
    );
  }

  private async watchlist(portfolioId: string): Promise<WatchRow[]> {
    return listRows<WatchRow>(
      this.db.prepare("SELECT symbol, status, reason FROM security_research_watchlist WHERE portfolio_id = ? ORDER BY status ASC, symbol ASC").bind(portfolioId)
    );
  }

  private async latestCandidates(portfolioId: string): Promise<ResearchCandidateSnapshot | null> {
    const row = await this.db.prepare(
      `SELECT portfolio_id AS portfolioId, snapshot_date AS snapshotDate,
        top_candidates_json AS topCandidatesJson, top_dividend_etfs_json AS topDividendEtfsJson,
        top_broad_market_etfs_json AS topBroadMarketEtfsJson, top_bond_etfs_json AS topBondEtfsJson,
        top_defensive_positions_json AS topDefensivePositionsJson, top_growth_positions_json AS topGrowthPositionsJson
       FROM security_research_candidate_snapshots
       WHERE portfolio_id = ?
       ORDER BY snapshot_date DESC
       LIMIT 1`
    ).bind(portfolioId).first<{
      portfolioId: string;
      snapshotDate: string;
      topCandidatesJson: string;
      topDividendEtfsJson: string;
      topBroadMarketEtfsJson: string;
      topBondEtfsJson: string;
      topDefensivePositionsJson: string;
      topGrowthPositionsJson: string;
    }>();
    return row ? {
      portfolioId: row.portfolioId,
      snapshotDate: row.snapshotDate,
      topCandidates: parseJson(row.topCandidatesJson, []),
      topDividendEtfs: parseJson(row.topDividendEtfsJson, []),
      topBroadMarketEtfs: parseJson(row.topBroadMarketEtfsJson, []),
      topBondEtfs: parseJson(row.topBondEtfsJson, []),
      topDefensivePositions: parseJson(row.topDefensivePositionsJson, []),
      topGrowthPositions: parseJson(row.topGrowthPositionsJson, [])
    } : null;
  }

  private async ownedSymbols(portfolioId: string): Promise<string[]> {
    const rows = await listRows<{ symbol: string }>(this.db.prepare("SELECT symbol FROM positions WHERE portfolio_id = ? AND quantity > 0").bind(portfolioId));
    return rows.map((row) => row.symbol);
  }

  private async audit(portfolioId: string | null, symbol: string | null, eventType: string, message: string, details: Record<string, unknown>, now: Date): Promise<void> {
    await this.db.prepare(
      `INSERT INTO security_research_audit_events (id, portfolio_id, symbol, event_type, message, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(`research_audit_${hash(`${portfolioId}:${symbol}:${eventType}:${now.toISOString()}`)}`, portfolioId, symbol, eventType, message, JSON.stringify(details), now.toISOString()).run();
  }
}

export async function runScheduledResearch(env: Env, scheduledAt = new Date().toISOString()): Promise<ResearchRunResult> {
  return new PortfolioResearchEngine(env.DB).run("portfolio_ira", new Date(scheduledAt));
}

export function scoreModules(input: {
  security: KnownSecurity;
  quote: NormalizedQuote | null;
  priceHistory: number[];
  volatility: number | null;
  fit?: PortfolioFit;
}): Omit<ResearchScores, "research"> {
  const price = input.quote?.lastPrice ?? input.priceHistory.at(-1) ?? null;
  const previous = input.quote?.previousClose ?? input.priceHistory.at(-2) ?? null;
  const high = input.priceHistory.length ? Math.max(...input.priceHistory) : price;
  const low = input.priceHistory.length ? Math.min(...input.priceHistory) : price;
  const momentum = price && previous ? pctChange(previous, price) : 0;
  return {
    valuation: scoreValuation(price, high, low, input.security.expenseRatio),
    quality: scoreQuality(input.security, input.quote),
    growth: scoreGrowth(input.security.historicalReturn, input.priceHistory),
    income: scoreIncome(input.security),
    technicalTrend: scoreTechnicalTrend(price, input.priceHistory),
    momentum: clampScore(50 + momentum * 400),
    risk: scoreRisk(input.volatility, input.security.maximumDrawdown, input.quote),
    diversification: input.fit?.diversificationContribution ?? 55
  };
}

export function compositeScore(scores: Omit<ResearchScores, "research">): number {
  return roundRatio(
    scores.valuation * SCORE_WEIGHTS.valuation +
    scores.quality * SCORE_WEIGHTS.quality +
    scores.growth * SCORE_WEIGHTS.growth +
    scores.income * SCORE_WEIGHTS.income +
    scores.technicalTrend * SCORE_WEIGHTS.technicalTrend +
    scores.momentum * SCORE_WEIGHTS.momentum +
    scores.risk * SCORE_WEIGHTS.risk +
    scores.diversification * SCORE_WEIGHTS.diversification
  );
}

export function rankProfiles(profiles: SecurityResearchProfile[], rankBy: ResearchRankBy): SecurityResearchProfile[] {
  const scoreFor = (profile: SecurityResearchProfile) => {
    if (rankBy === "dividend" || rankBy === "income") return profile.scores.income;
    if (rankBy === "growth") return profile.scores.growth;
    if (rankBy === "quality") return profile.scores.quality;
    if (rankBy === "risk") return profile.scores.risk;
    if (rankBy === "momentum") return profile.scores.momentum;
    return profile.overallKairoxScore;
  };
  return [...profiles].sort((left, right) => scoreFor(right) - scoreFor(left) || right.overallKairoxScore - left.overallKairoxScore || left.symbol.localeCompare(right.symbol));
}

export function buildCandidateSnapshot(portfolioId: string, snapshotDate: string, profiles: SecurityResearchProfile[]): ResearchCandidateSnapshot {
  const overall = rankProfiles(profiles, "overall");
  const isEtf = (profile: SecurityResearchProfile) => /etf|bond_fund/i.test(profile.assetType);
  return {
    portfolioId,
    snapshotDate,
    topCandidates: overall.slice(0, 10),
    topDividendEtfs: rankProfiles(profiles.filter((profile) => isEtf(profile) && profile.dividendYield !== null), "income").slice(0, 10),
    topBroadMarketEtfs: overall.filter((profile) => /broad|total|s&p|market/i.test(`${profile.companyOrFund} ${profile.industry}`) && isEtf(profile)).slice(0, 10),
    topBondEtfs: overall.filter((profile) => /bond|treasury/i.test(`${profile.assetType} ${profile.companyOrFund} ${profile.industry}`)).slice(0, 10),
    topDefensivePositions: overall.filter((profile) => profile.scores.risk >= 65 || /bond|treasury|dividend/i.test(`${profile.companyOrFund} ${profile.industry}`)).slice(0, 10),
    topGrowthPositions: rankProfiles(profiles, "growth").slice(0, 10)
  };
}

function scoreValuation(price: number | null, high: number | null, low: number | null, expenseRatio: number | null): number {
  const rangeScore = price && high && low && high > low ? 100 - ((price - low) / (high - low)) * 55 : 55;
  const feePenalty = expenseRatio === null ? 6 : Math.min(28, expenseRatio * 3500);
  return clampScore(rangeScore - feePenalty);
}

function scoreQuality(security: KnownSecurity, quote: NormalizedQuote | null): number {
  const liquidity = security.averageVolume ? Math.min(25, Math.log10(Math.max(1, security.averageVolume)) * 3) : 8;
  const fee = security.expenseRatio === null ? 12 : Math.max(0, 24 - security.expenseRatio * 4000);
  const data = quote?.validation.valid ? 24 : 4;
  const structure = /etf|bond_fund|money_market/i.test(security.assetType) ? 18 : security.tradable ? 12 : 4;
  return clampScore(25 + liquidity + fee + data + structure);
}

function scoreGrowth(historicalReturn: number | null, prices: number[]): number {
  const priceReturn = prices.length >= 2 ? pctChange(prices[0], prices.at(-1) ?? prices[0]) : null;
  const growth = historicalReturn ?? priceReturn ?? 0;
  return clampScore(50 + growth * 260);
}

function scoreIncome(security: KnownSecurity): number {
  return clampScore((security.dividendYield ?? 0) * 1400 + (security.dividendCapable ? 28 : 8));
}

function scoreTechnicalTrend(price: number | null, prices: number[]): number {
  if (!price || prices.length < 5) return 50;
  const short = average(prices.slice(-5));
  const long = average(prices.slice(-20));
  return clampScore(50 + pctChange(long || short, short) * 450 + pctChange(prices[0], price) * 80);
}

function scoreRisk(volatility: number | null, maxDrawdown: number | null, quote: NormalizedQuote | null): number {
  const volPenalty = (volatility ?? 0.2) * 160;
  const ddPenalty = (maxDrawdown ?? 0.25) * 90;
  const dataPenalty = quote?.validation.valid ? 0 : 28;
  return clampScore(100 - volPenalty - ddPenalty - dataPenalty);
}

function explainResearch(security: KnownSecurity, scores: ResearchScores, overall: number, previous: number | undefined, fit: PortfolioFit | undefined, quote: NormalizedQuote | null): ResearchExplanation {
  const change = previous === undefined ? 0 : roundRatio(overall - previous);
  const strengths = Object.entries(scores).filter(([, value]) => value >= 70).map(([key]) => `${key} score is strong`);
  const weaknesses = Object.entries(scores).filter(([, value]) => value < 45).map(([key]) => `${key} score is weak`);
  const risks = [
    ...(quote?.validation.valid ? [] : ["Market data is incomplete or unavailable."]),
    ...(scores.risk < 45 ? ["Risk score is weak."] : []),
    ...(fit && fit.policyCompatibility < 50 ? ["Portfolio policy compatibility is weak."] : [])
  ];
  return {
    scoreChange: previous === undefined ? "Initial research score recorded." : `Overall score changed by ${change.toFixed(2)} points from the previous profile.`,
    rankReason: `${security.symbol} ranks from a composite of valuation, quality, growth, income, trend, momentum, risk, diversification, and portfolio fit.`,
    strengths,
    weaknesses,
    mainRisks: risks,
    moduleExplanations: {
      valuation: "Valuation considers price location in available range and fund expense drag.",
      quality: "Quality considers liquidity, expense ratio, fund structure, tradability, and data quality.",
      growth: "Growth uses configured historical return or available price history.",
      income: "Income uses dividend capability and yield when available.",
      technicalTrend: "Technical trend compares recent price behavior with longer available history.",
      momentum: "Momentum uses latest move versus previous close or price point.",
      risk: "Risk penalizes volatility, drawdown, and invalid market data.",
      diversification: "Diversification estimates contribution to the selected portfolio."
    }
  };
}

function mapProfile(row: ProfileRow): SecurityResearchProfile {
  const explanation = parseJson<ResearchExplanation>(row.explanationJson, { scoreChange: "", rankReason: "", strengths: [], weaknesses: [], mainRisks: [], moduleExplanations: {} });
  return {
    symbol: row.symbol,
    companyOrFund: row.companyOrFund,
    assetType: row.assetType,
    sector: row.sector,
    industry: row.industry,
    marketCapUsd: row.marketCapUsd,
    dividendYield: row.dividendYield,
    expenseRatio: row.expenseRatio,
    fiftyTwoWeekHigh: row.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: row.fiftyTwoWeekLow,
    beta: row.beta,
    averageVolume: row.averageVolume,
    volatility: row.volatility,
    priceHistory: parseJson(row.priceHistoryJson, []),
    scores: {
      valuation: row.valuationScore,
      quality: row.qualityScore,
      growth: row.growthScore,
      income: row.incomeScore,
      technicalTrend: row.technicalTrendScore,
      momentum: row.momentumScore,
      risk: row.riskScore,
      diversification: row.diversificationScore,
      research: row.researchScore
    },
    overallKairoxScore: row.overallKairoxScore,
    explanation,
    dataQualityStatus: row.dataQualityStatus,
    latestMarketDataSnapshotId: row.latestMarketDataSnapshotId,
    lastScoredAt: row.lastScoredAt
  };
}

function volatilityFromPrices(prices: number[]): number | null {
  if (prices.length < 3) return null;
  const returns = prices.slice(1).map((price, index) => pctChange(prices[index], price));
  return standardDeviation(returns);
}

function betaProxy(assetType: string, volatility: number | null): number | null {
  if (volatility === null) return null;
  if (/bond|money_market/i.test(assetType)) return roundRatio(Math.min(0.8, volatility * 6));
  if (/crypto/i.test(assetType)) return roundRatio(Math.max(1.5, volatility * 8));
  return roundRatio(Math.max(0.4, Math.min(1.8, volatility * 7)));
}

function normalizeAssetClass(value: string): AssetClass {
  if (value === "bond_fund" || value === "money_market" || value === "crypto" || value === "mutual_fund" || value === "reit" || value === "stock" || value === "etf") return value;
  return "stock";
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values: number[]): number {
  const avg = average(values);
  return roundRatio(Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1 || 1)));
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, roundRatio(value)));
}

function accountDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

function weekKey(now: Date): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function hash(key: string): string {
  let value = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    value ^= key.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(16);
}
