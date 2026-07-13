import { listRows, PERMANENT_PORTFOLIO_IDS, TIM_PORTFOLIO_ID } from "../shared/db.ts";

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
  const rows = await listRows<{
    portfolioId: string;
    cashUsd: number;
    startingBalanceUsd: number;
    positionsValueUsd: number;
  }>(
    db.prepare(
      `SELECT p.id AS portfolioId, p.cash_usd AS cashUsd,
        p.starting_balance_usd AS startingBalanceUsd,
        COALESCE(SUM(pos.market_value_usd), 0) AS positionsValueUsd
       FROM portfolios p
       LEFT JOIN positions pos ON pos.portfolio_id = p.id AND pos.quantity > 0
       WHERE p.id IN (${PERMANENT_PORTFOLIO_IDS.map(() => "?").join(",")})
       GROUP BY p.id`
    ).bind(...PERMANENT_PORTFOLIO_IDS)
  );
  const byPortfolio = new Map(rows.map((row) => [row.portfolioId, row]));

  return {
    comparisonPolicy: {
      lifetimeReturnsCompared: false,
      normalizedStartIndex: 100,
      explanation: "Profiles are compared from their shared comparison_start_timestamp, not from Tim Balanced lifetime history."
    },
    profiles: profiles.map((profile) => {
      const row = byPortfolio.get(profile.portfolioId);
      const actualEquityUsd = (row?.cashUsd ?? 0) + (row?.positionsValueUsd ?? 0);
      const normalizedIndex =
        profile.comparisonStartEquityUsd > 0 ? (actualEquityUsd / profile.comparisonStartEquityUsd) * profile.normalizedStartIndex : profile.normalizedStartIndex;
      return {
        ...profile,
        actualEquityUsd: round(actualEquityUsd),
        normalizedIndex: round(normalizedIndex),
        normalizedReturnPct: round(normalizedIndex / profile.normalizedStartIndex - 1)
      };
    })
  };
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
