import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";
import { roundMoney } from "../shared/money.ts";
import type { PortfolioValuation } from "../portfolio/valuation.ts";

export type JourneyEventType =
  | "account_created"
  | "first_deposit"
  | "deposit"
  | "withdrawal"
  | "trading_enabled"
  | "trading_paused"
  | "trading_resumed"
  | "trade_opened"
  | "trade_closed"
  | "stop_loss_triggered"
  | "profit_target_reached"
  | "trade_rejected"
  | "trade_skipped"
  | "daily_summary_completed"
  | "milestone_earned"
  | "new_all_time_high_value"
  | "risk_limit_reached"
  | "kill_switch_activated"
  | "broker_disconnected"
  | "broker_reconnected"
  | "kairox_version_changed"
  | "strategy_version_changed"
  | "first_autonomous_trade"
  | "manual_intervention";

export interface JourneyEventInput {
  portfolioId?: string;
  eventType: JourneyEventType;
  timestamp: string;
  title: string;
  description: string;
  technicalDetails?: string | null;
  relatedAsset?: string | null;
  relatedTradeId?: string | null;
  relatedMilestoneId?: string | null;
  accountValueUsd?: number | null;
  portfolioValueUsd?: number | null;
  cashValueUsd?: number | null;
  kairoxVersion?: string;
  strategyVersion?: string | null;
  source: "system" | "scheduler" | "strategy" | "risk" | "milestone" | "manual";
  severity?: "info" | "warning" | "critical";
  metadata?: Record<string, unknown>;
}

export async function recordJourneyEvent(db: D1Database, input: JourneyEventInput): Promise<void> {
  const portfolioId = input.portfolioId ?? TIM_PORTFOLIO_ID;
  const eventKey = journeyEventKey(portfolioId, input);
  await db
    .prepare(
      `INSERT OR IGNORE INTO journey_events (
        id, event_key, portfolio_id, event_type, timestamp, title, description,
        technical_details, related_asset, related_trade_id, related_milestone_id,
        account_value_usd, portfolio_value_usd, cash_value_usd, kairox_version,
        strategy_version, source, severity, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id("journey", eventKey),
      eventKey,
      portfolioId,
      input.eventType,
      input.timestamp,
      input.title,
      input.description,
      input.technicalDetails ?? null,
      input.relatedAsset ?? null,
      input.relatedTradeId ?? null,
      input.relatedMilestoneId ?? null,
      nullableMoney(input.accountValueUsd),
      nullableMoney(input.portfolioValueUsd),
      nullableMoney(input.cashValueUsd),
      input.kairoxVersion ?? "0.1.0",
      input.strategyVersion ?? null,
      input.source,
      input.severity ?? "info",
      JSON.stringify(input.metadata ?? {})
    )
    .run();
}

export async function recordValuationJourneyEvents(db: D1Database, valuation: PortfolioValuation): Promise<void> {
  await recordJourneyEvent(db, {
    portfolioId: valuation.portfolioId,
    eventType: "account_created",
    timestamp: valuation.valuationTimestamp,
    title: "Kairox account tracked",
    description: "Kairox is tracking this virtual paper portfolio.",
    accountValueUsd: valuation.totalAccountValueUsd,
    portfolioValueUsd: valuation.portfolioValueUsd,
    cashValueUsd: valuation.cashUsd,
    source: "system",
    metadata: { dataMode: valuation.dataMode }
  });
}

export async function getJourney(db: D1Database, portfolioId = TIM_PORTFOLIO_ID): Promise<unknown> {
  return {
    journey: await listRows(
      db
        .prepare(
          `SELECT id, event_type AS eventType, timestamp, title, description,
            technical_details AS technicalDetails, related_asset AS relatedAsset,
            related_trade_id AS relatedTradeId, related_milestone_id AS relatedMilestoneId,
            account_value_usd AS accountValueUsd, portfolio_value_usd AS portfolioValueUsd,
            cash_value_usd AS cashValueUsd, kairox_version AS kairoxVersion,
            strategy_version AS strategyVersion, source, severity, metadata_json AS metadataJson
           FROM journey_events
           WHERE portfolio_id = ?
           ORDER BY timestamp DESC
           LIMIT 100`
        )
        .bind(portfolioId)
    )
  };
}

export function journeyEventKey(portfolioId: string, input: JourneyEventInput): string {
  if (input.eventType === "account_created") {
    return `${portfolioId}:account_created:once`;
  }
  return [
    portfolioId,
    input.eventType,
    input.timestamp.slice(0, 19),
    input.relatedTradeId ?? "",
    input.relatedMilestoneId ?? "",
    input.title
  ].join(":");
}

function nullableMoney(value?: number | null): number | null {
  return value === null || value === undefined ? null : roundMoney(value);
}

function id(prefix: string, key: string): string {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(16)}`;
}
