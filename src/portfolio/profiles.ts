import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";
import { calculatePerformance } from "./performance.ts";

export interface PortfolioProfile {
  id: string;
  portfolioId: string;
  profileKey: string;
  displayName: string;
  philosophy: string;
  riskPosture: string;
  comparisonStartTimestamp: string;
  comparisonStartEquityUsd: number;
  normalizedStartIndex: number;
  parameters: ProfileParameters;
}

export interface ProfileParameters {
  minConfidence: number;
  maxNewTradePct: number;
  maxPositionPct: number;
  cashReservePct: number;
  drawdownBlockPct: number;
  concentrationMultiplier: number;
  cryptoPreference: number;
  dividendPreference: number;
}

interface ProfileRow {
  id: string;
  portfolioId: string;
  profileKey: string;
  displayName: string;
  philosophy: string;
  riskPosture: string;
  comparisonStartTimestamp: string;
  comparisonStartEquityUsd: number;
  normalizedStartIndex: number;
  parametersJson: string;
}

const DEFAULT_PARAMETERS: ProfileParameters = {
  minConfidence: 0.6,
  maxNewTradePct: 0.1,
  maxPositionPct: 0.5,
  cashReservePct: 0.05,
  drawdownBlockPct: 0.1,
  concentrationMultiplier: 1,
  cryptoPreference: 1,
  dividendPreference: 1
};

export async function listPortfolioProfiles(db: D1Database): Promise<PortfolioProfile[]> {
  const rows = await listRows<ProfileRow>(
    db.prepare(
      `SELECT id, portfolio_id AS portfolioId, profile_key AS profileKey,
        display_name AS displayName, philosophy, risk_posture AS riskPosture,
        comparison_start_timestamp AS comparisonStartTimestamp,
        comparison_start_equity_usd AS comparisonStartEquityUsd,
        normalized_start_index AS normalizedStartIndex,
        parameters_json AS parametersJson
       FROM portfolio_profiles
       WHERE enabled = 1
       ORDER BY CASE profile_key
         WHEN 'kairox_conservative' THEN 1
         WHEN 'tim_balanced' THEN 2
         WHEN 'kairox_high_risk' THEN 3
         ELSE 99
       END`
    )
  );

  if (rows.length > 0) {
    return rows.map(parseProfileRow);
  }

  return [{
    id: "portfolio_profile_tim_balanced_fallback",
    portfolioId: TIM_PORTFOLIO_ID,
    profileKey: "tim_balanced",
    displayName: "Tim Balanced",
    philosophy: "Long-term wealth, moderate risk, balanced growth, and dividend preference.",
    riskPosture: "moderate",
    comparisonStartTimestamp: new Date().toISOString(),
    comparisonStartEquityUsd: 20,
    normalizedStartIndex: 100,
    parameters: DEFAULT_PARAMETERS
  }];
}

export async function getPortfolioProfile(db: D1Database, portfolioId = TIM_PORTFOLIO_ID): Promise<PortfolioProfile> {
  const profiles = await listPortfolioProfiles(db);
  return profiles.find((profile) => profile.portfolioId === portfolioId) ?? profiles.find((profile) => profile.portfolioId === TIM_PORTFOLIO_ID) ?? profiles[0];
}

export async function getProfileComparison(db: D1Database): Promise<unknown> {
  const profiles = await listPortfolioProfiles(db);
  const metrics = await Promise.all(profiles.map((profile) => getProfileReadinessMetrics(db, profile.portfolioId)));
  const metricsByPortfolio = new Map(metrics.map((metric) => [metric.portfolioId, metric]));

  return {
    comparisonPolicy: {
      lifetimeReturnsCompared: false,
      normalizedStartIndex: 100,
      explanation: "Profiles are compared from their shared comparison_start_timestamp, not from Tim Balanced lifetime history."
    },
    profiles: profiles.map((profile) => {
      const readiness = metricsByPortfolio.get(profile.portfolioId);
      const actualEquityUsd = readiness?.totalValueUsd ?? 0;
      const normalizedIndex =
        profile.comparisonStartEquityUsd > 0 ? (actualEquityUsd / profile.comparisonStartEquityUsd) * profile.normalizedStartIndex : profile.normalizedStartIndex;
      return {
        ...profile,
        actualEquityUsd: round(actualEquityUsd),
        cashUsd: round(readiness?.cashUsd ?? 0),
        cashPct: round(actualEquityUsd > 0 ? (readiness?.cashUsd ?? 0) / actualEquityUsd : 0),
        openPositions: readiness?.openPositions ?? 0,
        latestDecision: readiness?.latestDecision ?? "None",
        latestDecisionReason: readiness?.latestDecisionReason ?? "No decisions recorded yet.",
        totalReturnPct: readiness?.totalReturnPct ?? 0,
        maxDrawdownPct: readiness?.maxDrawdownPct ?? 0,
        volatilityPct: readiness?.volatilityPct ?? null,
        tradeCount: readiness?.tradeCount ?? 0,
        recommendationCount: readiness?.recommendationCount ?? 0,
        journalEntryCount: readiness?.journalEntryCount ?? 0,
        equityHistoryCount: readiness?.equityHistoryCount ?? 0,
        paperOnlyLabel: "VIRTUAL / PAPER ONLY",
        normalizedIndex: round(normalizedIndex),
        normalizedReturnPct: round(normalizedIndex / profile.normalizedStartIndex - 1)
      };
    })
  };
}

async function getProfileReadinessMetrics(db: D1Database, portfolioId: string) {
  const [performance, latestDecision, counts, equityHistory] = await Promise.all([
    calculatePerformance(db, portfolioId),
    db
      .prepare(
        `SELECT decision, explanation
         FROM decision_journal
         WHERE portfolio_id = ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .bind(portfolioId)
      .first<{ decision: string; explanation: string }>(),
    db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM positions WHERE portfolio_id = ? AND quantity > 0) AS openPositions,
          (SELECT COUNT(*) FROM recommendations WHERE portfolio_id = ?) AS recommendationCount,
          (SELECT COUNT(*) FROM decision_journal WHERE portfolio_id = ?) AS journalEntryCount,
          (SELECT COUNT(*) FROM portfolio_equity_history WHERE portfolio_id = ?) AS equityHistoryCount`
      )
      .bind(portfolioId, portfolioId, portfolioId, portfolioId)
      .first<{
        openPositions: number;
        recommendationCount: number;
        journalEntryCount: number;
        equityHistoryCount: number;
      }>(),
    listRows<{ totalValueUsd: number }>(
      db
        .prepare(
          `SELECT total_value_usd AS totalValueUsd
           FROM portfolio_equity_history
           WHERE portfolio_id = ?
           ORDER BY recorded_at ASC`
        )
        .bind(portfolioId)
    )
  ]);

  return {
    portfolioId,
    openPositions: counts?.openPositions ?? 0,
    latestDecision: latestDecision?.decision ?? "None",
    latestDecisionReason: latestDecision?.explanation ?? "No decisions recorded yet.",
    totalReturnPct: performance.totalReturnPct,
    cashUsd: performance.cashUsd,
    totalValueUsd: performance.totalValueUsd,
    maxDrawdownPct: performance.maxDrawdownPct,
    volatilityPct: calculateSimpleVolatility(equityHistory.map((row) => row.totalValueUsd)),
    tradeCount: performance.tradeCount,
    recommendationCount: counts?.recommendationCount ?? 0,
    journalEntryCount: counts?.journalEntryCount ?? 0,
    equityHistoryCount: counts?.equityHistoryCount ?? 0
  };
}

function calculateSimpleVolatility(values: number[]): number | null {
  if (values.length < 3) {
    return null;
  }
  const returns: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous > 0) {
      returns.push((current - previous) / previous);
    }
  }
  if (returns.length < 2) {
    return null;
  }
  const average = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / (returns.length - 1);
  return round(Math.sqrt(variance));
}

function parseProfileRow(row: ProfileRow): PortfolioProfile {
  return {
    id: row.id,
    portfolioId: row.portfolioId,
    profileKey: row.profileKey,
    displayName: row.displayName,
    philosophy: row.philosophy,
    riskPosture: row.riskPosture,
    comparisonStartTimestamp: row.comparisonStartTimestamp,
    comparisonStartEquityUsd: row.comparisonStartEquityUsd,
    normalizedStartIndex: row.normalizedStartIndex,
    parameters: parseParameters(row.parametersJson)
  };
}

function parseParameters(value: string): ProfileParameters {
  try {
    return { ...DEFAULT_PARAMETERS, ...(JSON.parse(value) as Partial<ProfileParameters>) };
  } catch {
    return DEFAULT_PARAMETERS;
  }
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
