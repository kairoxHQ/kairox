import { recordJourneyEvent } from "../journey/service.ts";
import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";
import { roundMoney } from "../shared/money.ts";
import type { PortfolioValuation } from "../portfolio/valuation.ts";

export interface MilestoneDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  badgeId: string;
  conditionType: string;
  threshold: number | null;
  comparisonOperator: "gte" | "lte" | "eq" | "exists";
  repeatable: boolean;
  displayMessage: string;
  enabled: boolean;
  version: number;
}

export interface MilestoneProgress {
  definition: MilestoneDefinition;
  progressValue: number;
  qualified: boolean;
  earnedAt: string | null;
}

export interface MilestoneContext {
  valuation: PortfolioValuation;
  tradeCount: number;
  winningTrades: number;
  winningDays: number;
  staleDataRejections: number;
  livePriceUpdates: number;
  strategyEvaluations: number;
  allTimeHighValueUsd: number;
  timestamp: string;
}

export async function evaluateAndAwardMilestones(
  db: D1Database,
  portfolioId = TIM_PORTFOLIO_ID,
  valuation: PortfolioValuation
): Promise<{ awarded: MilestoneProgress[]; progress: MilestoneProgress[] }> {
  const definitions = await getMilestoneDefinitions(db);
  const context = await buildMilestoneContext(db, portfolioId, valuation);
  const existingAwards = await getExistingAwardKeys(db, portfolioId);
  const progress = definitions.map((definition) => evaluateMilestone(definition, context, existingAwards, portfolioId));
  const awarded = progress.filter((item) => item.qualified && !item.earnedAt);

  for (const award of awarded) {
    const awardKey = milestoneAwardKey(portfolioId, award.definition, context);
    await db
      .prepare(
        `INSERT OR IGNORE INTO milestone_awards (
          id, award_key, milestone_id, portfolio_id, progress_value,
          earned_at, display_message, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id("award", awardKey),
        awardKey,
        award.definition.id,
        portfolioId,
        award.progressValue,
        context.timestamp,
        award.definition.displayMessage,
        JSON.stringify({ conditionType: award.definition.conditionType, version: award.definition.version })
      )
      .run();
    await recordJourneyEvent(db, {
      portfolioId,
      eventType: "milestone_earned",
      timestamp: context.timestamp,
      title: award.definition.name,
      description: award.definition.displayMessage,
      relatedMilestoneId: award.definition.id,
      accountValueUsd: valuation.totalAccountValueUsd,
      portfolioValueUsd: valuation.portfolioValueUsd,
      cashValueUsd: valuation.cashUsd,
      source: "milestone",
      metadata: { progressValue: award.progressValue }
    });
  }

  return { awarded, progress };
}

export async function getMilestones(db: D1Database, portfolioId = TIM_PORTFOLIO_ID): Promise<unknown> {
  return {
    definitions: await getMilestoneDefinitions(db),
    awards: await listRows(
      db
        .prepare(
          `SELECT ma.id, ma.milestone_id AS milestoneId, md.name, md.category,
            md.badge_id AS badgeId, ma.progress_value AS progressValue,
            ma.earned_at AS earnedAt, ma.display_message AS displayMessage
           FROM milestone_awards ma
           JOIN milestone_definitions md ON md.id = ma.milestone_id
           WHERE ma.portfolio_id = ?
           ORDER BY ma.earned_at DESC`
        )
        .bind(portfolioId)
    )
  };
}

export async function getMilestoneDefinitions(db: D1Database): Promise<MilestoneDefinition[]> {
  const rows = await listRows<{
    id: string;
    name: string;
    description: string;
    category: string;
    badgeId: string;
    conditionType: string;
    threshold: number | null;
    comparisonOperator: "gte" | "lte" | "eq" | "exists";
    repeatable: number;
    displayMessage: string;
    enabled: number;
    version: number;
  }>(
    db.prepare(
      `SELECT id, name, description, category, badge_id AS badgeId,
        condition_type AS conditionType, threshold,
        comparison_operator AS comparisonOperator, repeatable,
        display_message AS displayMessage, enabled, version
       FROM milestone_definitions
       WHERE enabled = 1
       ORDER BY category, threshold`
    )
  );
  return rows.map((row) => ({
    ...row,
    repeatable: row.repeatable === 1,
    enabled: row.enabled === 1
  }));
}

export function evaluateMilestone(
  definition: MilestoneDefinition,
  context: MilestoneContext,
  existingAwardKeys: Set<string>,
  portfolioId: string
): MilestoneProgress {
  const progressValue = progressForCondition(definition.conditionType, context);
  const qualified = compare(progressValue, definition.threshold, definition.comparisonOperator);
  const awardKey = milestoneAwardKey(portfolioId, definition, context);
  const alreadyEarned = existingAwardKeys.has(awardKey) || (!definition.repeatable && [...existingAwardKeys].some((key) => key.startsWith(`${portfolioId}:${definition.id}:once`)));
  return {
    definition,
    progressValue,
    qualified,
    earnedAt: alreadyEarned ? context.timestamp : null
  };
}

function progressForCondition(conditionType: string, context: MilestoneContext): number {
  const values: Record<string, number> = {
    account_value: context.valuation.totalAccountValueUsd,
    all_time_high: context.valuation.totalAccountValueUsd >= context.allTimeHighValueUsd ? context.valuation.totalAccountValueUsd : 0,
    trade_count: context.tradeCount,
    winning_trades: context.winningTrades,
    winning_days: context.winningDays,
    stale_data_rejection: context.staleDataRejections,
    live_price_update: context.livePriceUpdates,
    strategy_evaluations: context.strategyEvaluations
  };
  return roundMoney(values[conditionType] ?? 0);
}

function compare(value: number, threshold: number | null, operator: MilestoneDefinition["comparisonOperator"]): boolean {
  if (operator === "exists") {
    return value > 0;
  }
  const target = threshold ?? 0;
  if (operator === "gte") {
    return value >= target;
  }
  if (operator === "lte") {
    return value <= target;
  }
  return value === target;
}

async function buildMilestoneContext(db: D1Database, portfolioId: string, valuation: PortfolioValuation): Promise<MilestoneContext> {
  const counts = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM trades WHERE portfolio_id = ?) AS tradeCount,
        (SELECT COUNT(*) FROM trades WHERE portfolio_id = ? AND side = 'SELL') AS winningTrades,
        (SELECT COUNT(*) FROM account_daily_snapshots WHERE portfolio_id = ? AND daily_pl_usd > 0) AS winningDays,
        (SELECT COUNT(*) FROM recommendations WHERE portfolio_id = ? AND action = 'DO_NOTHING' AND (data_freshness = 'Stale' OR data_freshness = 'Unavailable')) AS staleDataRejections,
        (SELECT COUNT(*) FROM market_snapshots WHERE validation_status = 'validated') AS livePriceUpdates,
        (SELECT COUNT(*) FROM strategy_runs) AS strategyEvaluations,
        (SELECT COALESCE(MAX(total_value_usd), 0) FROM portfolio_equity_history WHERE portfolio_id = ?) AS allTimeHighValueUsd`
    )
    .bind(portfolioId, portfolioId, portfolioId, portfolioId, portfolioId)
    .first<{
      tradeCount: number;
      winningTrades: number;
      winningDays: number;
      staleDataRejections: number;
      livePriceUpdates: number;
      strategyEvaluations: number;
      allTimeHighValueUsd: number;
    }>();
  return {
    valuation,
    tradeCount: counts?.tradeCount ?? 0,
    winningTrades: counts?.winningTrades ?? 0,
    winningDays: counts?.winningDays ?? 0,
    staleDataRejections: counts?.staleDataRejections ?? 0,
    livePriceUpdates: counts?.livePriceUpdates ?? 0,
    strategyEvaluations: counts?.strategyEvaluations ?? 0,
    allTimeHighValueUsd: counts?.allTimeHighValueUsd ?? valuation.totalAccountValueUsd,
    timestamp: valuation.valuationTimestamp
  };
}

async function getExistingAwardKeys(db: D1Database, portfolioId: string): Promise<Set<string>> {
  const rows = await listRows<{ awardKey: string }>(
    db.prepare("SELECT award_key AS awardKey FROM milestone_awards WHERE portfolio_id = ?").bind(portfolioId)
  );
  return new Set(rows.map((row) => row.awardKey));
}

export function milestoneAwardKey(portfolioId: string, definition: MilestoneDefinition, context: MilestoneContext): string {
  const scope = definition.repeatable ? context.timestamp.slice(0, 10) : "once";
  return `${portfolioId}:${definition.id}:${scope}`;
}

function id(prefix: string, key: string): string {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(16)}`;
}
