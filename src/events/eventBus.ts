import { listRows } from "../shared/db.ts";

export const DOMAIN_EVENT_TYPES = [
  "PortfolioValuation.Completed",
  "DailyManagement.Completed",
  "PortfolioDecision.Generated",
  "Briefing.Generated",
  "Benchmark.Updated",
  "Research.Completed",
  "StrategyLab.Ranked",
  "MarketIntelligence.Completed",
  "Journey.EventRecorded",
  "MarketData.Refreshed"
] as const;

export type DomainEventType = typeof DOMAIN_EVENT_TYPES[number] | (string & {});
export type EventHandlerMode = "synchronous" | "asynchronous" | "scheduled";
export type DeliveryStatus = "pending" | "processing" | "delivered" | "retry_scheduled" | "dead_lettered" | "skipped";

export interface PublishDomainEventInput {
  eventType: DomainEventType;
  version?: number;
  correlationId?: string;
  accountId?: string | null;
  portfolioId?: string | null;
  sourceService: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  occurredAt?: Date | string;
}

export interface DomainEvent {
  id: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  correlationId: string;
  accountId: string | null;
  portfolioId: string | null;
  sourceService: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  immutableHash: string;
}

export interface EventSubscription {
  id: string;
  eventType: string;
  handlerName: string;
  handlerMode: EventHandlerMode;
  targetService: string;
  enabled: number;
  retryLimit: number;
  scheduleHint: string | null;
}

export interface EventDeliveryAttempt {
  id: string;
  eventId: string;
  subscriptionId: string;
  handlerName: string;
  handlerMode: EventHandlerMode;
  status: DeliveryStatus;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
}

export interface EventTimelineItem extends DomainEvent {
  deliveryStatus: DeliveryStatus | "not_subscribed";
  deliveryAttempts: number;
}

export interface EventObservabilitySummary {
  eventType: string;
  publishedCount: number;
  deliveredCount: number;
  retryCount: number;
  deadLetterCount: number;
  pendingCount: number;
}

type EventHandler = (event: DomainEvent) => Promise<void> | void;

interface ReplayFilter {
  eventType?: string | null;
  portfolioId?: string | null;
  fromTimestamp?: string | null;
  toTimestamp?: string | null;
  requestedBy?: string;
}

interface EventRow {
  id: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  correlationId: string;
  accountId: string | null;
  portfolioId: string | null;
  sourceService: string;
  payloadJson: string;
  metadataJson: string;
  immutableHash: string;
  deliveryStatus?: DeliveryStatus | null;
  deliveryAttempts?: number | null;
}

export class EventBus {
  private readonly handlers = new Map<string, EventHandler>();
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  subscribe(eventType: string, handlerName: string, mode: EventHandlerMode, handler: EventHandler): this {
    this.handlers.set(handlerKey(eventType, handlerName, mode), handler);
    return this;
  }

  async publish(input: PublishDomainEventInput): Promise<DomainEvent> {
    const event = buildDomainEvent(input);
    await this.db.prepare(
      `INSERT OR IGNORE INTO domain_events (
        id, event_type, event_version, occurred_at, correlation_id, account_id,
        portfolio_id, source_service, payload_json, metadata_json, immutable_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      event.id,
      event.eventType,
      event.eventVersion,
      event.occurredAt,
      event.correlationId,
      event.accountId,
      event.portfolioId,
      event.sourceService,
      JSON.stringify(event.payload),
      JSON.stringify(event.metadata),
      event.immutableHash
    ).run();

    const subscriptions = await this.subscriptionsFor(event.eventType);
    for (const subscription of subscriptions) {
      await this.ensureDeliveryAttempt(event, subscription);
      if (subscription.handlerMode === "synchronous") {
        await this.processSubscription(event, subscription);
      }
    }
    return event;
  }

  async processPending(limit = 50, now = new Date()): Promise<{ processed: number; delivered: number; retryScheduled: number; deadLettered: number }> {
    const rows = await listRows<EventDeliveryAttempt & EventSubscription & { eventType: string }>(
      this.db.prepare(
        `SELECT da.id, da.event_id AS eventId, da.subscription_id AS subscriptionId,
          da.handler_name AS handlerName, da.handler_mode AS handlerMode, da.status,
          da.attempt_count AS attemptCount, da.next_attempt_at AS nextAttemptAt,
          da.last_attempt_at AS lastAttemptAt, da.last_error AS lastError,
          s.event_type AS eventType, s.target_service AS targetService, s.enabled,
          s.retry_limit AS retryLimit, s.schedule_hint AS scheduleHint
         FROM domain_event_delivery_attempts da
         JOIN domain_event_subscriptions s ON s.id = da.subscription_id
         WHERE da.status IN ('pending', 'retry_scheduled')
           AND (da.next_attempt_at IS NULL OR da.next_attempt_at <= ?)
           AND s.enabled = 1
         ORDER BY da.created_at ASC
         LIMIT ?`
      ).bind(now.toISOString(), limit)
    );
    let delivered = 0;
    let retryScheduled = 0;
    let deadLettered = 0;
    for (const row of rows) {
      const event = await this.getEvent(row.eventId);
      if (!event) {
        continue;
      }
      const result = await this.processSubscription(event, row);
      if (result === "delivered" || result === "skipped") delivered += 1;
      if (result === "retry_scheduled") retryScheduled += 1;
      if (result === "dead_lettered") deadLettered += 1;
    }
    return { processed: rows.length, delivered, retryScheduled, deadLettered };
  }

  async replay(filter: ReplayFilter = {}): Promise<{ replayRequestId: string; replayedCount: number }> {
    const now = new Date();
    const replayRequestId = `event_replay_${hashKey(JSON.stringify(filter))}_${hashKey(now.toISOString())}`;
    await this.db.prepare(
      `INSERT INTO domain_event_replay_requests (
        id, requested_by, event_type, portfolio_id, from_timestamp, to_timestamp,
        status, requested_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?)`
    ).bind(
      replayRequestId,
      filter.requestedBy ?? "protected_action",
      filter.eventType ?? null,
      filter.portfolioId ?? null,
      filter.fromTimestamp ?? null,
      filter.toTimestamp ?? null,
      now.toISOString()
    ).run();
    try {
      const events = await this.eventsForReplay(filter);
      let replayedCount = 0;
      for (const event of events) {
        const subscriptions = await this.subscriptionsFor(event.eventType);
        for (const subscription of subscriptions) {
          await this.ensureDeliveryAttempt(event, subscription);
        }
        replayedCount += 1;
      }
      await this.db.prepare("UPDATE domain_event_replay_requests SET status = 'completed', replayed_count = ?, completed_at = ? WHERE id = ?")
        .bind(replayedCount, new Date().toISOString(), replayRequestId).run();
      return { replayRequestId, replayedCount };
    } catch (error) {
      await this.db.prepare("UPDATE domain_event_replay_requests SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?")
        .bind(messageOf(error), new Date().toISOString(), replayRequestId).run();
      throw error;
    }
  }

  async timeline(portfolioId?: string | null, limit = 40): Promise<EventTimelineItem[]> {
    const query = portfolioId
      ? this.db.prepare(
        `${EVENT_SELECT_BASE}
         WHERE e.portfolio_id = ?
         GROUP BY e.id
         ORDER BY e.occurred_at DESC
         LIMIT ?`
      ).bind(portfolioId, limit)
      : this.db.prepare(`${EVENT_SELECT_BASE} GROUP BY e.id ORDER BY e.occurred_at DESC LIMIT ?`).bind(limit);
    const rows = await listRows<EventRow>(query);
    return rows.map(mapTimelineRow);
  }

  async observability(): Promise<EventObservabilitySummary[]> {
    const rows = await listRows<{
      eventType: string;
      publishedCount: number;
      deliveredCount: number;
      retryCount: number;
      deadLetterCount: number;
      pendingCount: number;
    }>(
      this.db.prepare(
        `SELECT e.event_type AS eventType,
          COUNT(DISTINCT e.id) AS publishedCount,
          SUM(CASE WHEN da.status IN ('delivered', 'skipped') THEN 1 ELSE 0 END) AS deliveredCount,
          SUM(CASE WHEN da.status = 'retry_scheduled' THEN 1 ELSE 0 END) AS retryCount,
          SUM(CASE WHEN da.status = 'dead_lettered' THEN 1 ELSE 0 END) AS deadLetterCount,
          SUM(CASE WHEN da.status IN ('pending', 'processing') THEN 1 ELSE 0 END) AS pendingCount
         FROM domain_events e
         LEFT JOIN domain_event_delivery_attempts da ON da.event_id = e.id
         GROUP BY e.event_type
         ORDER BY MAX(e.occurred_at) DESC`
      )
    );
    return rows.map((row) => ({
      eventType: row.eventType,
      publishedCount: Number(row.publishedCount ?? 0),
      deliveredCount: Number(row.deliveredCount ?? 0),
      retryCount: Number(row.retryCount ?? 0),
      deadLetterCount: Number(row.deadLetterCount ?? 0),
      pendingCount: Number(row.pendingCount ?? 0)
    }));
  }

  async deadLetters(limit = 50): Promise<Array<{ eventId: string; handlerName: string; failureReason: string; failedAt: string; payload: unknown }>> {
    const rows = await listRows<{ eventId: string; handlerName: string; failureReason: string; failedAt: string; payloadJson: string }>(
      this.db.prepare(
        `SELECT event_id AS eventId, handler_name AS handlerName, failure_reason AS failureReason,
          failed_at AS failedAt, payload_json AS payloadJson
         FROM domain_event_dead_letters
         ORDER BY failed_at DESC
         LIMIT ?`
      ).bind(limit)
    );
    return rows.map((row) => ({ ...row, payload: parseJson(row.payloadJson, {}) }));
  }

  private async subscriptionsFor(eventType: string): Promise<EventSubscription[]> {
    return listRows<EventSubscription>(
      this.db.prepare(
        `SELECT id, event_type AS eventType, handler_name AS handlerName, handler_mode AS handlerMode,
          target_service AS targetService, enabled, retry_limit AS retryLimit, schedule_hint AS scheduleHint
         FROM domain_event_subscriptions
         WHERE event_type = ? AND enabled = 1
         ORDER BY handler_mode ASC, handler_name ASC`
      ).bind(eventType)
    );
  }

  private async ensureDeliveryAttempt(event: DomainEvent, subscription: EventSubscription): Promise<void> {
    const attemptId = `event_delivery_${hashKey(`${event.id}:${subscription.id}`)}`;
    await this.db.prepare(
      `INSERT OR IGNORE INTO domain_event_delivery_attempts (
        id, event_id, subscription_id, handler_name, handler_mode, status
      ) VALUES (?, ?, ?, ?, ?, 'pending')`
    ).bind(attemptId, event.id, subscription.id, subscription.handlerName, subscription.handlerMode).run();
  }

  private async processSubscription(event: DomainEvent, subscription: EventSubscription): Promise<DeliveryStatus> {
    const now = new Date();
    const handler = this.handlers.get(handlerKey(event.eventType, subscription.handlerName, subscription.handlerMode));
    const current = await this.db.prepare(
      `SELECT id, attempt_count AS attemptCount
       FROM domain_event_delivery_attempts
       WHERE event_id = ? AND subscription_id = ?`
    ).bind(event.id, subscription.id).first<{ id: string; attemptCount: number }>();
    if (!current) {
      await this.ensureDeliveryAttempt(event, subscription);
    }
    const attemptId = current?.id ?? `event_delivery_${hashKey(`${event.id}:${subscription.id}`)}`;
    const attemptCount = Number(current?.attemptCount ?? 0) + 1;
    await this.db.prepare("UPDATE domain_event_delivery_attempts SET status = 'processing', attempt_count = ?, last_attempt_at = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(attemptCount, now.toISOString(), attemptId).run();
    try {
      if (handler) {
        await handler(event);
      }
      const status: DeliveryStatus = handler ? "delivered" : "skipped";
      await this.db.prepare("UPDATE domain_event_delivery_attempts SET status = ?, last_error = NULL, next_attempt_at = NULL, updated_at = datetime('now') WHERE id = ?")
        .bind(status, attemptId).run();
      return status;
    } catch (error) {
      const retryLimit = Math.max(1, subscription.retryLimit);
      if (attemptCount < retryLimit) {
        const nextAttemptAt = new Date(now.getTime() + attemptCount * 60_000).toISOString();
        await this.db.prepare("UPDATE domain_event_delivery_attempts SET status = 'retry_scheduled', last_error = ?, next_attempt_at = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(messageOf(error), nextAttemptAt, attemptId).run();
        return "retry_scheduled";
      }
      await this.db.prepare("UPDATE domain_event_delivery_attempts SET status = 'dead_lettered', last_error = ?, next_attempt_at = NULL, updated_at = datetime('now') WHERE id = ?")
        .bind(messageOf(error), attemptId).run();
      await this.db.prepare(
        `INSERT OR IGNORE INTO domain_event_dead_letters (
          id, event_id, subscription_id, handler_name, failure_reason, payload_json, failed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        `dead_letter_${hashKey(`${event.id}:${subscription.id}`)}`,
        event.id,
        subscription.id,
        subscription.handlerName,
        messageOf(error),
        JSON.stringify(event.payload),
        now.toISOString()
      ).run();
      return "dead_lettered";
    }
  }

  private async getEvent(eventId: string): Promise<DomainEvent | null> {
    const row = await this.db.prepare(`${EVENT_SELECT_BASE} WHERE e.id = ? GROUP BY e.id LIMIT 1`).bind(eventId).first<EventRow>();
    return row ? mapEventRow(row) : null;
  }

  private async eventsForReplay(filter: ReplayFilter): Promise<DomainEvent[]> {
    const clauses: string[] = [];
    const binds: string[] = [];
    if (filter.eventType) {
      clauses.push("event_type = ?");
      binds.push(filter.eventType);
    }
    if (filter.portfolioId) {
      clauses.push("portfolio_id = ?");
      binds.push(filter.portfolioId);
    }
    if (filter.fromTimestamp) {
      clauses.push("occurred_at >= ?");
      binds.push(filter.fromTimestamp);
    }
    if (filter.toTimestamp) {
      clauses.push("occurred_at <= ?");
      binds.push(filter.toTimestamp);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await listRows<EventRow>(
      this.db.prepare(
        `SELECT id, event_type AS eventType, event_version AS eventVersion,
          occurred_at AS occurredAt, correlation_id AS correlationId, account_id AS accountId,
          portfolio_id AS portfolioId, source_service AS sourceService, payload_json AS payloadJson,
          metadata_json AS metadataJson, immutable_hash AS immutableHash
         FROM domain_events
         ${where}
         ORDER BY occurred_at ASC
         LIMIT 500`
      ).bind(...binds)
    );
    return rows.map(mapEventRow);
  }
}

export function buildDomainEvent(input: PublishDomainEventInput): DomainEvent {
  const occurredAt = typeof input.occurredAt === "string" ? input.occurredAt : (input.occurredAt ?? new Date()).toISOString();
  const eventVersion = input.version ?? 1;
  const metadata = input.metadata ?? {};
  const correlationId = input.correlationId ?? `corr_${hashKey(`${input.eventType}:${occurredAt}:${JSON.stringify(input.payload)}`)}`;
  const immutableSource = JSON.stringify({
    eventType: input.eventType,
    eventVersion,
    occurredAt,
    correlationId,
    accountId: input.accountId ?? null,
    portfolioId: input.portfolioId ?? null,
    sourceService: input.sourceService,
    payload: input.payload,
    metadata
  });
  const immutableHash = hashKey(immutableSource);
  return {
    id: `evt_${immutableHash}`,
    eventType: input.eventType,
    eventVersion,
    occurredAt,
    correlationId,
    accountId: input.accountId ?? null,
    portfolioId: input.portfolioId ?? null,
    sourceService: input.sourceService,
    payload: input.payload,
    metadata,
    immutableHash
  };
}

export async function publishDomainEvent(db: D1Database, input: PublishDomainEventInput): Promise<DomainEvent> {
  return new EventBus(db).publish(input);
}

export async function safePublishDomainEvent(db: D1Database, input: PublishDomainEventInput): Promise<DomainEvent | null> {
  try {
    return await publishDomainEvent(db, input);
  } catch (error) {
    console.error("Domain event publish failed", { eventType: input.eventType, sourceService: input.sourceService, message: messageOf(error) });
    return null;
  }
}

function handlerKey(eventType: string, handlerName: string, mode: EventHandlerMode): string {
  return `${eventType}:${handlerName}:${mode}`;
}

function mapTimelineRow(row: EventRow): EventTimelineItem {
  return {
    ...mapEventRow(row),
    deliveryStatus: row.deliveryStatus ?? "not_subscribed",
    deliveryAttempts: Number(row.deliveryAttempts ?? 0)
  };
}

function mapEventRow(row: EventRow): DomainEvent {
  return {
    id: row.id,
    eventType: row.eventType,
    eventVersion: Number(row.eventVersion),
    occurredAt: row.occurredAt,
    correlationId: row.correlationId,
    accountId: row.accountId,
    portfolioId: row.portfolioId,
    sourceService: row.sourceService,
    payload: parseJson(row.payloadJson, {}),
    metadata: parseJson(row.metadataJson, {}),
    immutableHash: row.immutableHash
  };
}

function hashKey(key: string): string {
  let value = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    value ^= key.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(16);
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown event-bus error.";
}

const EVENT_SELECT_BASE = `SELECT e.id, e.event_type AS eventType, e.event_version AS eventVersion,
  e.occurred_at AS occurredAt, e.correlation_id AS correlationId, e.account_id AS accountId,
  e.portfolio_id AS portfolioId, e.source_service AS sourceService, e.payload_json AS payloadJson,
  e.metadata_json AS metadataJson, e.immutable_hash AS immutableHash,
  COALESCE(
    MAX(CASE
      WHEN da.status = 'dead_lettered' THEN 'dead_lettered'
      WHEN da.status = 'retry_scheduled' THEN 'retry_scheduled'
      WHEN da.status = 'pending' THEN 'pending'
      WHEN da.status = 'processing' THEN 'processing'
      WHEN da.status = 'delivered' THEN 'delivered'
      WHEN da.status = 'skipped' THEN 'skipped'
      ELSE NULL
    END),
    'not_subscribed'
  ) AS deliveryStatus,
  COALESCE(SUM(da.attempt_count), 0) AS deliveryAttempts
  FROM domain_events e
  LEFT JOIN domain_event_delivery_attempts da ON da.event_id = e.id`;
