import { listRows } from "../shared/db.ts";

export const INTELLIGENCE_CATEGORIES = [
  "Economic",
  "Monetary Policy",
  "Corporate",
  "Earnings",
  "Dividend",
  "Commodity",
  "Energy",
  "Geopolitical",
  "Regulatory",
  "Supply Chain",
  "Technology",
  "Healthcare",
  "Financial",
  "Natural Disaster"
] as const;

export type IntelligenceCategory = (typeof INTELLIGENCE_CATEGORIES)[number];
export type IntelligenceStatus = "sample" | "watching" | "verified" | "rejected" | "archived";
export type ImpactDirection = "positive" | "negative" | "mixed" | "neutral" | "unknown";

export interface IntelligenceEventInput {
  title: string;
  summary: string;
  category: string;
  sourceReliability: number;
  verificationCount: number;
  severity: number;
  marketImpact: number;
  freshness: number;
}

export interface EvidenceScoreInput {
  sourceReliability: number;
  verificationCount: number;
  severity: number;
  marketImpact: number;
  freshness: number;
}

interface IntelligenceEventRow {
  eventId: string;
  timestamp: string;
  title: string;
  summary: string;
  category: string;
  secondaryCategory: string | null;
  source: string;
  sourceType: string;
  sourceUrl: string | null;
  sourceReliability: number;
  country: string | null;
  affectedRegionsJson: string;
  affectedAssetClassesJson: string;
  affectedSymbolsJson: string;
  potentialDuration: string;
  immediateImpact: string;
  downstreamImpactsJson: string;
  severity: number;
  confidence: number;
  status: IntelligenceStatus;
  verificationCount: number;
  sampleData: number;
  sourceReliabilityScore: number | null;
  verificationScore: number | null;
  severityScore: number | null;
  marketImpactScore: number | null;
  freshnessScore: number | null;
  evidenceScore: number | null;
  evidenceExplanation: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AssetImpactRow {
  eventId: string;
  assetClass: string;
  symbol: string | null;
  impactDirection: ImpactDirection;
  impactMagnitude: number;
  rationale: string;
}

export function validateIntelligenceEvent(input: IntelligenceEventInput): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.title.trim()) {
    reasons.push("Title is required.");
  }
  if (!input.summary.trim()) {
    reasons.push("Summary is required.");
  }
  if (!INTELLIGENCE_CATEGORIES.includes(input.category as IntelligenceCategory)) {
    reasons.push("Category is not supported.");
  }
  for (const [name, value] of [
    ["source reliability", input.sourceReliability],
    ["severity", input.severity],
    ["market impact", input.marketImpact],
    ["freshness", input.freshness]
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      reasons.push(`${name} must be between 0 and 1.`);
    }
  }
  if (!Number.isInteger(input.verificationCount) || input.verificationCount < 0) {
    reasons.push("Verification count must be a non-negative integer.");
  }
  return { valid: reasons.length === 0, reasons };
}

export function calculateEvidenceScore(input: EvidenceScoreInput): number {
  const verificationScore = Math.min(1, Math.max(0, input.verificationCount / 3));
  return round(
    clamp(input.sourceReliability) * 0.3 +
      verificationScore * 0.2 +
      clamp(input.severity) * 0.2 +
      clamp(input.marketImpact) * 0.2 +
      clamp(input.freshness) * 0.1
  );
}

export async function getIntelligenceOverview(db: D1Database): Promise<unknown> {
  const [events, categories, story] = await Promise.all([
    getIntelligenceEvents(db, 10),
    getIntelligenceCategories(db),
    getMarketStory(db)
  ]);
  return {
    policy: {
      noTradingDecisions: true,
      noLlmDecisions: true,
      sampleDataNotice: "Sample intelligence events are deterministic development fixtures, not current news."
    },
    story,
    categories,
    recentEvents: (events as { events: unknown[] }).events
  };
}

export async function getIntelligenceToday(db: D1Database): Promise<unknown> {
  const events = await getJoinedEvents(db, 20);
  const today = new Date().toISOString().slice(0, 10);
  const todayEvents = events.filter((event) => event.timestamp.slice(0, 10) === today);
  return {
    date: today,
    currentNewsFabricated: false,
    sampleDataNotice: todayEvents.length === 0 ? "No current-day verified intelligence is stored. Development sample fixtures are available separately." : undefined,
    events: mapEvents(todayEvents)
  };
}

export async function getIntelligenceEvents(db: D1Database, limit = 50): Promise<unknown> {
  const rows = await getJoinedEvents(db, limit);
  const impacts = await getAssetImpacts(db);
  return {
    events: mapEvents(rows, impacts)
  };
}

export async function getIntelligenceCategories(db: D1Database): Promise<unknown> {
  const categories = await listRows<{ id: string; name: string; description: string; enabled: number }>(
    db.prepare(
      `SELECT id, name, description, enabled
       FROM event_categories
       ORDER BY name ASC`
    )
  );
  return {
    supported: INTELLIGENCE_CATEGORIES,
    categories: categories.map((category) => ({ ...category, enabled: category.enabled === 1 }))
  };
}

export async function getMarketStory(db: D1Database): Promise<unknown> {
  const events = mapEvents(await getJoinedEvents(db, 20), await getAssetImpacts(db));
  const activeEvents = events.filter((event) => event.status !== "rejected" && event.status !== "archived");
  const bullish = activeEvents.filter((event) => event.assetImpacts.some((impact) => impact.impactDirection === "positive"));
  const bearish = activeEvents.filter((event) => event.assetImpacts.some((impact) => impact.impactDirection === "negative"));
  const mixed = activeEvents.filter((event) => event.assetImpacts.some((impact) => impact.impactDirection === "mixed"));
  const averageEvidence = activeEvents.length > 0 ? activeEvents.reduce((sum, event) => sum + event.evidenceScore, 0) / activeEvents.length : 0;
  const outlook = bullish.length > bearish.length && averageEvidence >= 0.45 ? "Bullish" : bearish.length > bullish.length && averageEvidence >= 0.45 ? "Bearish" : "Neutral";
  const themes = [...new Set(activeEvents.flatMap((event) => [event.category, event.secondaryCategory].filter(Boolean) as string[]))];
  const monitored = [...new Set(activeEvents.flatMap((event) => event.affectedSymbols))];

  return {
    title: "Today's Market Story",
    overallOutlook: outlook,
    bullish: bullish.map((event) => event.title),
    bearish: bearish.map((event) => event.title),
    neutral: mixed.map((event) => event.title),
    keyEvents: activeEvents.slice(0, 5).map((event) => ({
      title: event.title,
      category: event.category,
      evidenceScore: event.evidenceScore,
      sampleData: event.sampleData
    })),
    importantThemes: themes,
    potentialRisks: activeEvents
      .filter((event) => event.severity >= 0.55)
      .map((event) => event.immediateImpact),
    opportunitiesBeingMonitored: monitored,
    noRecommendations: true,
    sampleDataNotice: activeEvents.some((event) => event.sampleData)
      ? "Includes deterministic sample fixtures for development and testing. These are not current news."
      : undefined
  };
}

export async function getRelationshipMap(db: D1Database): Promise<unknown> {
  const relationships = await listRows<{
    fromTheme: string;
    toTheme: string;
    relationshipType: string;
    explanation: string;
  }>(
    db.prepare(
      `SELECT from_theme AS fromTheme, to_theme AS toTheme,
        relationship_type AS relationshipType, explanation
       FROM intelligence_relationships
       WHERE enabled = 1
       ORDER BY from_theme ASC, to_theme ASC`
    )
  );
  return { relationships };
}

async function getJoinedEvents(db: D1Database, limit: number): Promise<IntelligenceEventRow[]> {
  return listRows<IntelligenceEventRow>(
    db
      .prepare(
        `SELECT
          e.event_id AS eventId,
          e.event_timestamp AS timestamp,
          e.title,
          e.summary,
          pc.name AS category,
          sc.name AS secondaryCategory,
          s.name AS source,
          s.source_type AS sourceType,
          e.source_url AS sourceUrl,
          s.reliability_score AS sourceReliability,
          e.country,
          e.affected_regions_json AS affectedRegionsJson,
          e.affected_asset_classes_json AS affectedAssetClassesJson,
          e.affected_symbols_json AS affectedSymbolsJson,
          e.potential_duration AS potentialDuration,
          e.immediate_impact AS immediateImpact,
          e.downstream_impacts_json AS downstreamImpactsJson,
          e.severity,
          e.confidence,
          e.status,
          e.verification_count AS verificationCount,
          e.sample_data AS sampleData,
          ec.source_reliability AS sourceReliabilityScore,
          ec.verification_score AS verificationScore,
          ec.severity_score AS severityScore,
          ec.market_impact_score AS marketImpactScore,
          ec.freshness_score AS freshnessScore,
          ec.evidence_score AS evidenceScore,
          ec.explanation AS evidenceExplanation,
          e.created_at AS createdAt,
          e.updated_at AS updatedAt
         FROM intelligence_events e
         JOIN event_categories pc ON pc.id = e.primary_category_id
         LEFT JOIN event_categories sc ON sc.id = e.secondary_category_id
         JOIN event_sources s ON s.id = e.source_id
         LEFT JOIN event_confidence ec ON ec.event_id = e.event_id
         ORDER BY e.event_timestamp DESC
         LIMIT ?`
      )
      .bind(limit)
  );
}

async function getAssetImpacts(db: D1Database): Promise<Map<string, AssetImpactRow[]>> {
  const rows = await listRows<AssetImpactRow>(
    db.prepare(
      `SELECT event_id AS eventId, asset_class AS assetClass, symbol,
        impact_direction AS impactDirection, impact_magnitude AS impactMagnitude,
        rationale
       FROM asset_impacts
       ORDER BY impact_magnitude DESC`
    )
  );
  const byEvent = new Map<string, AssetImpactRow[]>();
  for (const row of rows) {
    byEvent.set(row.eventId, [...(byEvent.get(row.eventId) ?? []), row]);
  }
  return byEvent;
}

function mapEvents(rows: IntelligenceEventRow[], impacts = new Map<string, AssetImpactRow[]>()) {
  return rows.map((row) => {
    const marketImpact = Math.max(0, ...(impacts.get(row.eventId) ?? []).map((impact) => impact.impactMagnitude));
    const evidenceScore =
      row.evidenceScore ??
      calculateEvidenceScore({
        sourceReliability: row.sourceReliability,
        verificationCount: row.verificationCount,
        severity: row.severity,
        marketImpact,
        freshness: 0.35
      });
    return {
      eventId: row.eventId,
      timestamp: row.timestamp,
      title: row.title,
      summary: row.summary,
      category: row.category,
      secondaryCategory: row.secondaryCategory,
      source: row.source,
      sourceType: row.sourceType,
      sourceUrl: row.sourceUrl,
      sourceReliability: row.sourceReliability,
      country: row.country,
      affectedRegions: parseJsonArray(row.affectedRegionsJson),
      affectedAssetClasses: parseJsonArray(row.affectedAssetClassesJson),
      affectedSymbols: parseJsonArray(row.affectedSymbolsJson),
      potentialDuration: row.potentialDuration,
      immediateImpact: row.immediateImpact,
      downstreamImpacts: parseJsonArray(row.downstreamImpactsJson),
      severity: row.severity,
      confidence: row.confidence,
      status: row.status,
      verificationCount: row.verificationCount,
      sampleData: row.sampleData === 1,
      evidenceScore,
      evidence: {
        sourceReliability: row.sourceReliabilityScore ?? row.sourceReliability,
        verificationScore: row.verificationScore ?? Math.min(1, row.verificationCount / 3),
        severityScore: row.severityScore ?? row.severity,
        marketImpactScore: row.marketImpactScore ?? marketImpact,
        freshnessScore: row.freshnessScore ?? 0.35,
        explanation: row.evidenceExplanation ?? "Evidence score calculated deterministically from stored event fields."
      },
      assetImpacts: impacts.get(row.eventId) ?? [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  });
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
