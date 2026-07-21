import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";
import { calculatePerformance } from "./performance.ts";
import { listLinkedPortfolioAccounts, type LinkedPortfolioAccount } from "./accountTypes.ts";

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
  account: LinkedPortfolioAccount;
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

interface LinkedOnlyProfileRow {
  portfolioId: string;
  displayName: string;
  createdAt: string;
  startingBalanceUsd: number;
}

interface ListPortfolioProfilesOptions {
  includeReadOnly?: boolean;
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

export async function listPortfolioProfiles(db: D1Database, options: ListPortfolioProfilesOptions = {}): Promise<PortfolioProfile[]> {
  const includeReadOnly = options.includeReadOnly ?? true;
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
    const linkedOnlyRows = await listLinkedOnlyProfileRows(db);
    const portfolioIds = [...rows.map((row) => row.portfolioId), ...linkedOnlyRows.map((row) => row.portfolioId)];
    const accounts = await listLinkedPortfolioAccounts(db, portfolioIds);
    const profiles = [
      ...rows.map((row) => parseProfileRow(row, accounts.get(row.portfolioId))),
      ...linkedOnlyRows.map((row) => parseLinkedOnlyProfileRow(row, accounts.get(row.portfolioId)))
    ];
    return includeReadOnly ? profiles : profiles.filter((profile) => !profile.account.readOnly && profile.account.managedByKairox);
  }

  const fallbackProfiles: PortfolioProfile[] = [{
    id: "portfolio_profile_tim_balanced_fallback",
    portfolioId: TIM_PORTFOLIO_ID,
    profileKey: "tim_balanced",
    displayName: "Tim Balanced",
    philosophy: "Long-term wealth, moderate risk, balanced growth, and dividend preference.",
    riskPosture: "moderate",
    comparisonStartTimestamp: new Date().toISOString(),
    comparisonStartEquityUsd: 20,
    normalizedStartIndex: 100,
    parameters: DEFAULT_PARAMETERS,
    account: {
      portfolioId: TIM_PORTFOLIO_ID,
      accountType: "paper",
      linkedPortfolioId: null,
      relationshipLabel: "Standalone paper portfolio",
      manualEntryEnabled: false,
      managedByKairox: true,
      readOnly: false,
      badgeLabel: "Paper",
      tradingAllowed: true,
      orderGenerationAllowed: true,
      rebalanceAllowed: true
    }
  }];
  return includeReadOnly ? fallbackProfiles : fallbackProfiles.filter((profile) => !profile.account.readOnly && profile.account.managedByKairox);
}

export async function getPortfolioProfile(db: D1Database, portfolioId = TIM_PORTFOLIO_ID): Promise<PortfolioProfile> {
  const profiles = await listPortfolioProfiles(db, { includeReadOnly: true });
  return profiles.find((profile) => profile.portfolioId === portfolioId) ?? profiles.find((profile) => profile.portfolioId === TIM_PORTFOLIO_ID) ?? profiles[0];
}

export async function getProfileComparison(db: D1Database): Promise<unknown> {
  const profiles = await listPortfolioProfiles(db, { includeReadOnly: true });
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
        paperOnlyLabel: profile.account.badgeLabel,
        accountType: profile.account.accountType,
        linkedPortfolioId: profile.account.linkedPortfolioId,
        accountRelationship: profile.account.relationshipLabel,
        readOnly: profile.account.readOnly,
        managedByKairox: profile.account.managedByKairox,
        normalizedIndex: round(normalizedIndex),
        normalizedReturnPct: round(normalizedIndex / profile.normalizedStartIndex - 1)
      };
    })
  };
}

async function listLinkedOnlyProfileRows(db: D1Database): Promise<LinkedOnlyProfileRow[]> {
  try {
    return await listRows<LinkedOnlyProfileRow>(
      db.prepare(
        `SELECT p.id AS portfolioId, p.name AS displayName,
          p.created_at AS createdAt, p.starting_balance_usd AS startingBalanceUsd
         FROM portfolios p
         JOIN linked_portfolio_accounts lpa ON lpa.portfolio_id = p.id
         LEFT JOIN portfolio_profiles pp ON pp.portfolio_id = p.id AND pp.enabled = 1
         WHERE pp.id IS NULL
           AND lpa.account_type IN ('read_only_watchlist', 'paper_portfolio_twin')
         ORDER BY CASE lpa.account_type
           WHEN 'read_only_watchlist' THEN 90
           WHEN 'paper_portfolio_twin' THEN 91
           ELSE 99
         END, p.created_at, p.id`
      )
    );
  } catch (error) {
    if (isMissingLinkedPortfolioSchema(error)) {
      return [];
    }
    throw error;
  }
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

function parseProfileRow(row: ProfileRow, account?: LinkedPortfolioAccount): PortfolioProfile {
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
    parameters: parseParameters(row.parametersJson),
    account: account ?? {
      portfolioId: row.portfolioId,
      accountType: "paper",
      linkedPortfolioId: null,
      relationshipLabel: "Standalone paper portfolio",
      manualEntryEnabled: false,
      managedByKairox: true,
      readOnly: false,
      badgeLabel: "Paper",
      tradingAllowed: true,
      orderGenerationAllowed: true,
      rebalanceAllowed: true
    }
  };
}

function parseLinkedOnlyProfileRow(row: LinkedOnlyProfileRow, account?: LinkedPortfolioAccount): PortfolioProfile {
  const linkedAccount = account ?? {
    portfolioId: row.portfolioId,
    accountType: "paper" as const,
    linkedPortfolioId: null,
    relationshipLabel: "Standalone paper portfolio",
    manualEntryEnabled: false,
    managedByKairox: true,
    readOnly: false,
    badgeLabel: "Paper" as const,
    tradingAllowed: true,
    orderGenerationAllowed: true,
    rebalanceAllowed: true
  };
  return {
    id: `portfolio_profile_${sanitizeProfileId(row.portfolioId)}_linked`,
    portfolioId: row.portfolioId,
    profileKey: sanitizeProfileId(row.portfolioId),
    displayName: row.displayName,
    philosophy: linkedAccount.relationshipLabel ?? (linkedAccount.readOnly ? "Read-only real holdings baseline for comparison." : "Linked paper portfolio for comparison."),
    riskPosture: linkedAccount.readOnly ? "baseline" : "managed",
    comparisonStartTimestamp: row.createdAt,
    comparisonStartEquityUsd: row.startingBalanceUsd,
    normalizedStartIndex: 100,
    parameters: DEFAULT_PARAMETERS,
    account: linkedAccount
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

function sanitizeProfileId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96) || "linked_portfolio";
}

function isMissingLinkedPortfolioSchema(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /linked_portfolio_accounts|portfolio_profiles|no such table/i.test(message);
}
