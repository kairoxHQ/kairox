import { recordJourneyEvent } from "../journey/service.ts";
import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";
import { roundRatio } from "../shared/money.ts";

export type VerificationStatus =
  | "Unverified"
  | "Single-source verified"
  | "Multi-source verified"
  | "Primary-source verified"
  | "Conflicting"
  | "Corrected"
  | "Retracted"
  | "Stale"
  | "Unsupported";

export type IntelligenceCategory = "Security" | "Fund" | "Market" | "Economic" | "Price Context";
export type RelevanceClassification = "Direct holding impact" | "Benchmark impact" | "Asset-class impact" | "Macro relevance" | "Low relevance" | "Not relevant";
export type AlertSeverity = "Informational" | "Monitor" | "Review recommended" | "Material risk event" | "Data conflict" | "Corporate-action required";
export type AttributionStatus = "No verified attribution" | "Possible association" | "Likely associated" | "Strongly associated";

export interface MarketIntelligenceProvider {
  readonly name: string;
  readonly providerType: "primary_source" | "trusted_provider" | "deterministic_fallback";
  fetchRecords(context: IntelligenceProviderContext): Promise<ProviderIntelligenceRecord[]>;
}

export interface MarketNewsProvider extends MarketIntelligenceProvider {}
export interface CorporateEventsProvider extends MarketIntelligenceProvider {}
export interface EconomicCalendarProvider extends MarketIntelligenceProvider {}
export interface DividendEventsProvider extends MarketIntelligenceProvider {}

export interface IntelligenceProviderContext {
  portfolioId: string;
  holdings: HoldingContext[];
  now: Date;
}

export interface HoldingContext {
  symbol: string;
  assetClass: string;
  quantity: number;
  marketValueUsd: number;
  portfolioWeight: number;
}

export interface ProviderIntelligenceRecord {
  providerRecordId: string;
  eventCategory: IntelligenceCategory;
  eventType: string;
  headline: string;
  summary: string;
  relatedSymbols: string[];
  relatedAssetCategories: string[];
  eventDate: string;
  publishedAt: string | null;
  effectiveAt: string | null;
  sourceTimestamp: string | null;
  sourceUrl: string | null;
  sourceKind: "primary" | "trusted_confirmed" | "single_trusted" | "conflicting" | "unsupported";
  confidenceClassification: "Low" | "Medium" | "High";
  severity: number;
  licenseAttribution: string;
  rawReference: Record<string, unknown>;
  correctionStatus?: "Original" | "Correction" | "Corrected" | "Retracted";
  supersedingRecordId?: string | null;
}

export interface VerifiedIntelligenceRecord extends ProviderIntelligenceRecord {
  id: string;
  providerName: string;
  providerType: string;
  verifiedSummary: string;
  verificationStatus: VerificationStatus;
  materialityClassification: "Low" | "Medium" | "High" | "Material";
  materialityScore: number;
  duplicateGroupId: string;
  attribution: IntelligenceAttribution;
  ingestedAt: string;
}

export interface IntelligenceAttribution {
  status: AttributionStatus;
  confidence: "Limited" | "Moderate" | "High";
  priceMovePct: number | null;
  window: string;
  explanation: string;
}

export interface PortfolioIntelligenceLink {
  record: VerifiedIntelligenceRecord;
  relevanceClassification: RelevanceClassification;
  relevanceScore: number;
  alertSeverity: AlertSeverity;
  relatedHoldings: string[];
  rationale: string;
}

export interface PortfolioIntelligenceSummary {
  id: string;
  portfolioId: string;
  cycleId: string | null;
  summaryDate: string;
  intelligenceVersionHash: string;
  mostMaterialRecordId: string | null;
  holdingsAffected: string[];
  marketWideEvents: string[];
  upcomingEvents: string[];
  unexplainedMovements: string[];
  dataGaps: string[];
  verificationQuality: string;
  intelligenceTimestamp: string;
}

interface RecordRow {
  id: string;
  providerRecordId: string;
  providerName: string;
  providerType: string;
  eventCategory: IntelligenceCategory;
  eventType: string;
  headline: string;
  verifiedSummary: string;
  relatedSymbolsJson: string;
  relatedAssetCategoriesJson: string;
  eventDate: string;
  publishedAt: string | null;
  effectiveAt: string | null;
  ingestedAt: string;
  sourceTimestamp: string | null;
  sourceUrl: string | null;
  verificationStatus: VerificationStatus;
  confidenceClassification: "Low" | "Medium" | "High";
  materialityClassification: "Low" | "Medium" | "High" | "Material";
  materialityScore: number;
  duplicateGroupId: string;
  correctionStatus: "Original" | "Correction" | "Corrected" | "Retracted";
  supersedingRecordId: string | null;
  rawReferenceJson: string;
  attributionJson: string;
  licenseAttribution: string;
}

interface LinkRow {
  id: string;
  portfolioId: string;
  intelligenceRecordId: string;
  relevanceClassification: RelevanceClassification;
  relevanceScore: number;
  alertSeverity: AlertSeverity;
  relatedHoldingsJson: string;
  rationale: string;
}

export class IntelligenceVerificationService {
  verificationStatus(record: ProviderIntelligenceRecord, sourceCount = 1): VerificationStatus {
    if (record.correctionStatus === "Retracted") return "Retracted";
    if (record.correctionStatus === "Correction") return "Corrected";
    if (record.sourceKind === "primary") return "Primary-source verified";
    if (record.sourceKind === "trusted_confirmed") return "Multi-source verified";
    if (sourceCount > 1) return "Multi-source verified";
    if (record.sourceKind === "single_trusted") return "Single-source verified";
    if (record.sourceKind === "conflicting") return "Conflicting";
    return "Unsupported";
  }

  briefingFactAllowed(status: VerificationStatus): boolean {
    return status === "Primary-source verified" || status === "Multi-source verified";
  }
}

export class VerifiedMarketIntelligenceService {
  private readonly db: D1Database;
  private readonly providers: MarketIntelligenceProvider[];
  private readonly verifier = new IntelligenceVerificationService();

  constructor(db: D1Database, providers: MarketIntelligenceProvider[] = [new PrimarySourceSeedIntelligenceProvider()]) {
    this.db = db;
    this.providers = providers;
  }

  async ingest(portfolioId = TIM_PORTFOLIO_ID, triggerSource: "manual" | "scheduled" | "daily_cycle" = "manual", now = new Date()): Promise<{ runId: string; recordsSeen: number; recordsIngested: number; duplicates: number; rejected: number; links: number }> {
    const runId = `intel_run_${portfolioId}_${now.toISOString().replace(/[^0-9]/g, "").slice(0, 14)}_${triggerSource}`;
    const startedAt = now.toISOString();
    const holdings = await this.getHoldings(portfolioId);
    let recordsSeen = 0;
    let recordsIngested = 0;
    let duplicates = 0;
    let rejected = 0;
    let links = 0;

    await this.db.prepare(
      `INSERT OR IGNORE INTO market_intelligence_ingestion_runs
        (id, provider_name, trigger_source, started_at, status)
       VALUES (?, ?, ?, ?, 'completed')`
    ).bind(runId, this.providers.map((provider) => provider.name).join(","), triggerSource, startedAt).run();

    for (const provider of this.providers) {
      const providerStarted = Date.now();
      try {
        const providerRecords = await provider.fetchRecords({ portfolioId, holdings, now });
        recordsSeen += providerRecords.length;
        for (const record of providerRecords) {
          const normalized = this.normalize(record, provider, holdings, now);
          if (normalized.verificationStatus === "Unsupported" || normalized.verificationStatus === "Unverified") {
            rejected += 1;
            continue;
          }
          const existing = await this.db
            .prepare("SELECT id FROM verified_intelligence_records WHERE provider_name = ? AND provider_record_id = ? AND correction_status = ?")
            .bind(normalized.providerName, normalized.providerRecordId, normalized.correctionStatus ?? "Original")
            .first<{ id: string }>();
          if (existing) {
            duplicates += 1;
          } else {
            await this.insertRecord(normalized);
            recordsIngested += 1;
            await this.recordAudit(portfolioId, normalized.id, "intelligence_record_ingested", `${normalized.verificationStatus}: ${normalized.headline}`, { duplicateGroupId: normalized.duplicateGroupId }, now);
          }
          const linked = await this.linkRecordToPortfolio(portfolioId, existing?.id ?? normalized.id, holdings, now);
          links += linked ? 1 : 0;
        }
        await this.updateProviderHealth(provider, "success", Date.now() - providerStarted, providerRecords.length, 0, duplicates, 0, now);
      } catch (error) {
        rejected += 1;
        await this.updateProviderHealth(provider, "failure", Date.now() - providerStarted, 0, 1, duplicates, 1, now);
        await this.recordAudit(portfolioId, null, "provider_failure", error instanceof Error ? error.message : "Provider failed.", { provider: provider.name }, now);
      }
    }

    await this.db.prepare(
      `UPDATE market_intelligence_ingestion_runs
       SET finished_at = ?, records_seen = ?, records_ingested = ?, duplicates = ?, rejected = ?
       WHERE id = ?`
    ).bind(now.toISOString(), recordsSeen, recordsIngested, duplicates, rejected, runId).run();
    await this.recordJourneyMilestones(portfolioId, now);
    return { runId, recordsSeen, recordsIngested, duplicates, rejected, links };
  }

  async listPortfolioIntelligence(portfolioId = TIM_PORTFOLIO_ID, limit = 20): Promise<PortfolioIntelligenceLink[]> {
    const links = await listRows<LinkRow>(
      this.db.prepare(
        `SELECT id, portfolio_id AS portfolioId, intelligence_record_id AS intelligenceRecordId,
          relevance_classification AS relevanceClassification, relevance_score AS relevanceScore,
          alert_severity AS alertSeverity, related_holdings_json AS relatedHoldingsJson, rationale
         FROM portfolio_intelligence_links
         WHERE portfolio_id = ?
         ORDER BY relevance_score DESC, created_at DESC
         LIMIT ?`
      ).bind(portfolioId, limit)
    );
    if (links.length === 0) return [];
    const records = await this.listRecordsByIds(links.map((link) => link.intelligenceRecordId));
    const byId = new Map(records.map((record) => [record.id, record]));
    return links.flatMap((link) => {
      const record = byId.get(link.intelligenceRecordId);
      return record ? [{ record, relevanceClassification: link.relevanceClassification, relevanceScore: link.relevanceScore, alertSeverity: link.alertSeverity, relatedHoldings: parseJsonArray(link.relatedHoldingsJson), rationale: link.rationale }] : [];
    });
  }

  async createPortfolioSummary(portfolioId = TIM_PORTFOLIO_ID, cycleId: string | null = null, now = new Date()): Promise<{ summary: PortfolioIntelligenceSummary; idempotent: boolean }> {
    const links = await this.listPortfolioIntelligence(portfolioId, 20);
    const summaryDate = now.toISOString().slice(0, 10);
    const versionHash = hashText(JSON.stringify(links.map((link) => [link.record.id, link.record.verificationStatus, link.relevanceScore, link.record.materialityScore])));
    const existing = await this.db.prepare(
      `SELECT id, portfolio_id AS portfolioId, cycle_id AS cycleId, summary_date AS summaryDate,
        intelligence_version_hash AS intelligenceVersionHash, most_material_record_id AS mostMaterialRecordId,
        holdings_affected_json AS holdingsAffectedJson, market_wide_events_json AS marketWideEventsJson,
        upcoming_events_json AS upcomingEventsJson, unexplained_movements_json AS unexplainedMovementsJson,
        data_gaps_json AS dataGapsJson, verification_quality AS verificationQuality, intelligence_timestamp AS intelligenceTimestamp
       FROM portfolio_intelligence_summaries
       WHERE portfolio_id = ? AND summary_date = ? AND intelligence_version_hash = ?`
    ).bind(portfolioId, summaryDate, versionHash).first<SummaryRow>();
    if (existing) return { summary: mapSummary(existing), idempotent: true };

    const mostMaterial = links[0]?.record ?? null;
    const holdingsAffected = [...new Set(links.flatMap((link) => link.relatedHoldings))];
    const marketWideEvents = links.filter((link) => ["Market", "Economic", "Price Context"].includes(link.record.eventCategory)).map((link) => link.record.headline);
    const upcomingEvents = links.filter((link) => link.record.effectiveAt && daysBetween(summaryDate, link.record.effectiveAt.slice(0, 10)) >= 0 && daysBetween(summaryDate, link.record.effectiveAt.slice(0, 10)) <= 30).map((link) => link.record.headline);
    const dataGaps = links.length === 0 ? ["No verified portfolio-relevant intelligence is currently stored."] : links.filter((link) => link.record.attribution.status === "No verified attribution").map((link) => `${link.record.headline}: attribution unavailable`);
    const verificationQuality = links.some((link) => link.record.verificationStatus === "Primary-source verified") ? "Primary-source verified facts available" : links.length ? "Verified context available with limitations" : "No verified context available";
    const id = `portfolio_intel_summary_${portfolioId}_${summaryDate}_${versionHash.slice(0, 12)}`;
    const intelligenceTimestamp = now.toISOString();
    await this.db.prepare(
      `INSERT INTO portfolio_intelligence_summaries
        (id, portfolio_id, cycle_id, summary_date, intelligence_version_hash, most_material_record_id,
         holdings_affected_json, market_wide_events_json, upcoming_events_json, unexplained_movements_json,
         data_gaps_json, verification_quality, intelligence_timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, portfolioId, cycleId, summaryDate, versionHash, mostMaterial?.id ?? null, JSON.stringify(holdingsAffected), JSON.stringify(marketWideEvents), JSON.stringify(upcomingEvents), JSON.stringify(dataGaps), JSON.stringify(dataGaps), verificationQuality, intelligenceTimestamp).run();
    const summary = { id, portfolioId, cycleId, summaryDate, intelligenceVersionHash: versionHash, mostMaterialRecordId: mostMaterial?.id ?? null, holdingsAffected, marketWideEvents, upcomingEvents, unexplainedMovements: dataGaps, dataGaps, verificationQuality, intelligenceTimestamp };
    await this.recordAudit(portfolioId, mostMaterial?.id ?? null, "portfolio_intelligence_summary_created", verificationQuality, { summaryDate, links: links.length }, now);
    return { summary, idempotent: false };
  }

  async latestSummary(portfolioId = TIM_PORTFOLIO_ID): Promise<PortfolioIntelligenceSummary | null> {
    const row = await this.db.prepare(
      `SELECT id, portfolio_id AS portfolioId, cycle_id AS cycleId, summary_date AS summaryDate,
        intelligence_version_hash AS intelligenceVersionHash, most_material_record_id AS mostMaterialRecordId,
        holdings_affected_json AS holdingsAffectedJson, market_wide_events_json AS marketWideEventsJson,
        upcoming_events_json AS upcomingEventsJson, unexplained_movements_json AS unexplainedMovementsJson,
        data_gaps_json AS dataGapsJson, verification_quality AS verificationQuality, intelligence_timestamp AS intelligenceTimestamp
       FROM portfolio_intelligence_summaries
       WHERE portfolio_id = ?
       ORDER BY summary_date DESC, created_at DESC
       LIMIT 1`
    ).bind(portfolioId).first<SummaryRow>();
    return row ? mapSummary(row) : null;
  }

  async providerHealth() {
    return listRows(this.db.prepare("SELECT * FROM market_intelligence_provider_health ORDER BY provider_name ASC"));
  }

  private normalize(record: ProviderIntelligenceRecord, provider: MarketIntelligenceProvider, holdings: HoldingContext[], now: Date): VerifiedIntelligenceRecord {
    const verificationStatus = this.verifier.verificationStatus(record, record.rawReference.sourceCount as number | undefined);
    const materialityScore = calculateMaterialityScore(record, holdings);
    return {
      ...record,
      id: `intel_${hashText(`${provider.name}|${record.providerRecordId}|${record.correctionStatus ?? "Original"}`).slice(0, 24)}`,
      providerName: provider.name,
      providerType: provider.providerType,
      verifiedSummary: record.summary,
      verificationStatus,
      materialityScore,
      materialityClassification: materialityClass(materialityScore),
      duplicateGroupId: dedupeGroup(record),
      attribution: calculateAttribution(record, materialityScore),
      ingestedAt: now.toISOString()
    };
  }

  private async insertRecord(record: VerifiedIntelligenceRecord): Promise<void> {
    await this.db.prepare(
      `INSERT INTO verified_intelligence_records
        (id, provider_record_id, provider_name, provider_type, event_category, event_type, headline,
         verified_summary, related_symbols_json, related_asset_categories_json, event_date, published_at,
         effective_at, ingested_at, source_timestamp, source_url, verification_status, confidence_classification,
         materiality_classification, materiality_score, duplicate_group_id, correction_status,
         superseding_record_id, raw_reference_json, attribution_json, license_attribution)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(record.id, record.providerRecordId, record.providerName, record.providerType, record.eventCategory, record.eventType, record.headline, record.verifiedSummary, JSON.stringify(record.relatedSymbols), JSON.stringify(record.relatedAssetCategories), record.eventDate, record.publishedAt, record.effectiveAt, record.ingestedAt, record.sourceTimestamp, record.sourceUrl, record.verificationStatus, record.confidenceClassification, record.materialityClassification, record.materialityScore, record.duplicateGroupId, record.correctionStatus ?? "Original", record.supersedingRecordId ?? null, JSON.stringify(record.rawReference), JSON.stringify(record.attribution), record.licenseAttribution).run();
  }

  private async linkRecordToPortfolio(portfolioId: string, recordId: string, holdings: HoldingContext[], now: Date): Promise<boolean> {
    const record = (await this.listRecordsByIds([recordId]))[0];
    if (!record) return false;
    const relevance = scoreRelevance(record, holdings);
    if (relevance.classification === "Not relevant") return false;
    const id = `intel_link_${portfolioId}_${record.id}`;
    const result = await this.db.prepare(
      `INSERT OR IGNORE INTO portfolio_intelligence_links
        (id, portfolio_id, intelligence_record_id, relevance_classification, relevance_score, alert_severity, related_holdings_json, rationale)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, portfolioId, record.id, relevance.classification, relevance.score, relevance.alertSeverity, JSON.stringify(relevance.relatedHoldings), relevance.rationale).run();
    if ((result.meta?.changes ?? 0) > 0) {
      await this.recordAudit(portfolioId, record.id, "intelligence_linked_to_portfolio", relevance.rationale, { relevance: relevance.classification, score: relevance.score }, now);
      return true;
    }
    return false;
  }

  private async listRecordsByIds(ids: string[]): Promise<VerifiedIntelligenceRecord[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = await listRows<RecordRow>(this.db.prepare(`SELECT
      id, provider_record_id AS providerRecordId, provider_name AS providerName, provider_type AS providerType,
      event_category AS eventCategory, event_type AS eventType, headline, verified_summary AS verifiedSummary,
      related_symbols_json AS relatedSymbolsJson, related_asset_categories_json AS relatedAssetCategoriesJson,
      event_date AS eventDate, published_at AS publishedAt, effective_at AS effectiveAt, ingested_at AS ingestedAt,
      source_timestamp AS sourceTimestamp, source_url AS sourceUrl, verification_status AS verificationStatus,
      confidence_classification AS confidenceClassification, materiality_classification AS materialityClassification,
      materiality_score AS materialityScore, duplicate_group_id AS duplicateGroupId, correction_status AS correctionStatus,
      superseding_record_id AS supersedingRecordId, raw_reference_json AS rawReferenceJson,
      attribution_json AS attributionJson, license_attribution AS licenseAttribution
      FROM verified_intelligence_records WHERE id IN (${placeholders})`).bind(...ids));
    return rows.map(mapRecord);
  }

  private async getHoldings(portfolioId: string): Promise<HoldingContext[]> {
    const rows = await listRows<{ symbol: string; assetClass: string; quantity: number; marketValueUsd: number }>(
      this.db.prepare(
        `SELECT symbol, asset_class AS assetClass, quantity, market_value_usd AS marketValueUsd
         FROM positions
         WHERE portfolio_id = ? AND quantity > 0`
      ).bind(portfolioId)
    );
    const total = rows.reduce((sum, row) => sum + row.marketValueUsd, 0);
    return rows.map((row) => ({ ...row, portfolioWeight: total > 0 ? roundRatio(row.marketValueUsd / total) : 0 }));
  }

  private async updateProviderHealth(provider: MarketIntelligenceProvider, status: "success" | "failure", latencyMs: number, ingested: number, rejected: number, duplicates: number, verificationFailures: number, now: Date): Promise<void> {
    await this.db.prepare(
      `INSERT INTO market_intelligence_provider_health
        (provider_name, provider_type, last_success_at, last_failure_at, average_latency_ms, rate_limit_status,
         records_ingested, records_rejected, duplicate_count, verification_failures, data_freshness, outage_status, updated_at)
       VALUES (?, ?, ?, ?, ?, 'ok', ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider_name) DO UPDATE SET
         last_success_at = COALESCE(excluded.last_success_at, market_intelligence_provider_health.last_success_at),
         last_failure_at = COALESCE(excluded.last_failure_at, market_intelligence_provider_health.last_failure_at),
         average_latency_ms = excluded.average_latency_ms,
         records_ingested = market_intelligence_provider_health.records_ingested + excluded.records_ingested,
         records_rejected = market_intelligence_provider_health.records_rejected + excluded.records_rejected,
         duplicate_count = market_intelligence_provider_health.duplicate_count + excluded.duplicate_count,
         verification_failures = market_intelligence_provider_health.verification_failures + excluded.verification_failures,
         data_freshness = excluded.data_freshness,
         outage_status = excluded.outage_status,
         updated_at = excluded.updated_at`
    ).bind(provider.name, provider.providerType, status === "success" ? now.toISOString() : null, status === "failure" ? now.toISOString() : null, latencyMs, ingested, rejected, duplicates, verificationFailures, status === "success" ? "current" : "degraded", status === "success" ? "operational" : "degraded", now.toISOString()).run();
  }

  private async recordAudit(portfolioId: string | null, recordId: string | null, eventType: string, message: string, details: Record<string, unknown>, now: Date): Promise<void> {
    await this.db.prepare(
      `INSERT OR IGNORE INTO market_intelligence_audit_events
        (id, portfolio_id, intelligence_record_id, event_type, message, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(`intel_audit_${hashText(`${portfolioId}|${recordId}|${eventType}|${message}`).slice(0, 28)}`, portfolioId, recordId, eventType, message, JSON.stringify(details), now.toISOString()).run();
  }

  private async recordJourneyMilestones(portfolioId: string, now: Date): Promise<void> {
    const count = await this.db.prepare("SELECT COUNT(*) AS count FROM verified_intelligence_records").first<{ count: number }>();
    if ((count?.count ?? 0) > 0) {
      await recordJourneyEvent(this.db, {
        portfolioId,
        eventType: "daily_summary_completed",
        timestamp: now.toISOString(),
        title: "First verified intelligence record stored",
        description: "Kairox stored its first verified market-intelligence record for paper-portfolio context.",
        source: "system",
        metadata: { paperOnly: true, milestone: true }
      });
    }
  }
}

export class PrimarySourceSeedIntelligenceProvider implements MarketNewsProvider, CorporateEventsProvider, EconomicCalendarProvider, DividendEventsProvider {
  readonly name = "Kairox primary-source seed";
  readonly providerType = "primary_source" as const;

  async fetchRecords(context: IntelligenceProviderContext): Promise<ProviderIntelligenceRecord[]> {
    const today = context.now.toISOString().slice(0, 10);
    const holdings = new Set(context.holdings.map((holding) => holding.symbol));
    const records: ProviderIntelligenceRecord[] = [];
    if (holdings.has("VTI")) {
      records.push(primaryRecord("vanguard-vti-distribution-calendar", "Fund", "ETF distribution schedule", "VTI distribution schedule is available from fund sponsor materials.", "VTI has a fund-sponsor distribution schedule. Kairox treats this as calendar context, not a trading signal.", ["VTI"], ["Broad U.S. equity"], today, 0.42, "https://investor.vanguard.com/"));
    }
    if (holdings.has("SCHD")) {
      records.push(primaryRecord("schwab-schd-distribution-calendar", "Fund", "ETF ex-dividend schedule", "SCHD dividend-equity distribution schedule is available from fund sponsor materials.", "SCHD has a fund-sponsor distribution schedule. Kairox treats this as dividend context, not a trading signal.", ["SCHD"], ["Dividend equity"], today, 0.48, "https://www.schwabassetmanagement.com/"));
    }
    if (holdings.has("BND")) {
      records.push(primaryRecord("vanguard-bnd-distribution-calendar", "Fund", "ETF distribution schedule", "BND bond ETF distribution schedule is available from fund sponsor materials.", "BND has a fund-sponsor distribution schedule. Kairox treats this as income and bond-fund context, not a trading signal.", ["BND"], ["Investment-grade bonds"], today, 0.46, "https://investor.vanguard.com/"));
    }
    records.push(primaryRecord("federal-reserve-calendar", "Economic", "Federal Reserve calendar", "Federal Reserve policy calendar is relevant to broad equity and bond context.", "Federal Reserve policy dates are official macro calendar context for U.S. equity and bond holdings.", ["VTI", "SCHD", "BND"], ["Broad U.S. equity", "Dividend equity", "Investment-grade bonds"], today, 0.52, "https://www.federalreserve.gov/"));
    records.push(primaryRecord("nyse-market-calendar", "Market", "U.S. market calendar", "U.S. market holiday and early-close calendar is available from exchange calendar materials.", "U.S. market-calendar events affect trading-session context but do not by themselves imply portfolio action.", ["VTI", "SCHD", "BND"], ["Market calendar"], today, 0.35, "https://www.nyse.com/"));
    return records;
  }
}

export class FailingMarketIntelligenceProvider implements MarketIntelligenceProvider {
  readonly name = "Failing test provider";
  readonly providerType = "deterministic_fallback" as const;
  async fetchRecords(): Promise<ProviderIntelligenceRecord[]> {
    throw new Error("Provider outage");
  }
}

function primaryRecord(providerRecordId: string, eventCategory: IntelligenceCategory, eventType: string, headline: string, summary: string, relatedSymbols: string[], relatedAssetCategories: string[], eventDate: string, severity: number, sourceUrl: string): ProviderIntelligenceRecord {
  return {
    providerRecordId,
    eventCategory,
    eventType,
    headline,
    summary,
    relatedSymbols,
    relatedAssetCategories,
    eventDate,
    publishedAt: `${eventDate}T12:00:00.000Z`,
    effectiveAt: `${eventDate}T12:00:00.000Z`,
    sourceTimestamp: `${eventDate}T12:00:00.000Z`,
    sourceUrl,
    sourceKind: "primary",
    confidenceClassification: "High",
    severity,
    licenseAttribution: "Stores Kairox-generated factual summary and source reference only.",
    rawReference: { sourceCount: 1, redistributedFullText: false },
    correctionStatus: "Original"
  };
}

export function calculateMaterialityScore(record: ProviderIntelligenceRecord, holdings: HoldingContext[]): number {
  const affectedHoldingWeight = holdings.filter((holding) => record.relatedSymbols.includes(holding.symbol)).reduce((sum, holding) => sum + holding.portfolioWeight, 0);
  const direct = affectedHoldingWeight > 0 ? 0.3 : 0;
  const severity = Math.max(0, Math.min(1, record.severity)) * 0.25;
  const verified = record.sourceKind === "primary" || record.sourceKind === "trusted_confirmed" ? 0.2 : record.sourceKind === "single_trusted" ? 0.1 : 0;
  const category = ["Dividend", "Stock split", "ETF distribution schedule", "ETF ex-dividend schedule"].includes(record.eventType) ? 0.1 : record.eventCategory === "Economic" || record.eventCategory === "Market" ? 0.08 : 0.05;
  const breadth = record.relatedSymbols.length > 1 ? 0.07 : 0.03;
  return roundRatio(Math.min(1, direct + severity + verified + category + breadth));
}

export function scoreRelevance(record: VerifiedIntelligenceRecord, holdings: HoldingContext[]): { classification: RelevanceClassification; score: number; alertSeverity: AlertSeverity; relatedHoldings: string[]; rationale: string } {
  const relatedHoldings = holdings.filter((holding) => record.relatedSymbols.includes(holding.symbol)).map((holding) => holding.symbol);
  if (relatedHoldings.length > 0) {
    const score = roundRatio(Math.min(1, 0.55 + record.materialityScore * 0.4));
    return { classification: "Direct holding impact", score, alertSeverity: alertSeverity(record), relatedHoldings, rationale: `Verified ${record.eventType} is directly related to ${relatedHoldings.join(", ")}.` };
  }
  if (record.eventCategory === "Economic" || record.eventCategory === "Market") {
    return { classification: "Macro relevance", score: roundRatio(0.35 + record.materialityScore * 0.35), alertSeverity: alertSeverity(record), relatedHoldings: [], rationale: `Verified ${record.eventType} is relevant to broad U.S. equity and bond context.` };
  }
  return { classification: "Not relevant", score: 0, alertSeverity: "Informational", relatedHoldings: [], rationale: "No direct portfolio, benchmark, or asset-class connection." };
}

export function calculateAttribution(record: ProviderIntelligenceRecord, materialityScore: number): IntelligenceAttribution {
  const hasPriceMove = typeof record.rawReference.priceMovePct === "number";
  if (!hasPriceMove) {
    return { status: "No verified attribution", confidence: "Limited", priceMovePct: null, window: "unavailable", explanation: "Verified event is stored, but no verified price-movement window is attached." };
  }
  const priceMovePct = record.rawReference.priceMovePct as number;
  const status: AttributionStatus = Math.abs(priceMovePct) > 0.02 && materialityScore >= 0.65 ? "Strongly associated" : Math.abs(priceMovePct) > 0.01 ? "Likely associated" : "Possible association";
  return { status, confidence: status === "Strongly associated" ? "High" : status === "Likely associated" ? "Moderate" : "Limited", priceMovePct, window: String(record.rawReference.priceWindow ?? "same trading day"), explanation: `Verified event timing overlaps a ${roundRatio(priceMovePct)} price move. This is association, not proof of causation.` };
}

export function canUseAsBriefingFact(record: { verificationStatus: VerificationStatus }): boolean {
  return new IntelligenceVerificationService().briefingFactAllowed(record.verificationStatus);
}

function alertSeverity(record: VerifiedIntelligenceRecord): AlertSeverity {
  if (record.verificationStatus === "Conflicting") return "Data conflict";
  if (record.eventType.toLowerCase().includes("split") || record.eventType.toLowerCase().includes("corporate action")) return "Corporate-action required";
  if (record.materialityScore >= 0.75) return "Material risk event";
  if (record.materialityScore >= 0.55) return "Monitor";
  return "Informational";
}

function materialityClass(score: number): "Low" | "Medium" | "High" | "Material" {
  return score >= 0.75 ? "Material" : score >= 0.55 ? "High" : score >= 0.3 ? "Medium" : "Low";
}

function dedupeGroup(record: ProviderIntelligenceRecord): string {
  return hashText([record.eventType, record.relatedSymbols.slice().sort().join(","), record.effectiveAt ?? record.eventDate, fingerprint(record.headline)].join("|"));
}

function fingerprint(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 10).join("-");
}

function mapRecord(row: RecordRow): VerifiedIntelligenceRecord {
  return {
    id: row.id,
    providerRecordId: row.providerRecordId,
    providerName: row.providerName,
    providerType: row.providerType,
    eventCategory: row.eventCategory,
    eventType: row.eventType,
    headline: row.headline,
    summary: row.verifiedSummary,
    verifiedSummary: row.verifiedSummary,
    relatedSymbols: parseJsonArray(row.relatedSymbolsJson),
    relatedAssetCategories: parseJsonArray(row.relatedAssetCategoriesJson),
    eventDate: row.eventDate,
    publishedAt: row.publishedAt,
    effectiveAt: row.effectiveAt,
    ingestedAt: row.ingestedAt,
    sourceTimestamp: row.sourceTimestamp,
    sourceUrl: row.sourceUrl,
    sourceKind: row.verificationStatus === "Primary-source verified" ? "primary" : "single_trusted",
    verificationStatus: row.verificationStatus,
    confidenceClassification: row.confidenceClassification,
    severity: row.materialityScore,
    materialityClassification: row.materialityClassification,
    materialityScore: row.materialityScore,
    duplicateGroupId: row.duplicateGroupId,
    correctionStatus: row.correctionStatus,
    supersedingRecordId: row.supersedingRecordId,
    rawReference: parseJsonObject(row.rawReferenceJson),
    attribution: parseAttribution(row.attributionJson),
    licenseAttribution: row.licenseAttribution
  };
}

interface SummaryRow {
  id: string;
  portfolioId: string;
  cycleId: string | null;
  summaryDate: string;
  intelligenceVersionHash: string;
  mostMaterialRecordId: string | null;
  holdingsAffectedJson: string;
  marketWideEventsJson: string;
  upcomingEventsJson: string;
  unexplainedMovementsJson: string;
  dataGapsJson: string;
  verificationQuality: string;
  intelligenceTimestamp: string;
}

function mapSummary(row: SummaryRow): PortfolioIntelligenceSummary {
  return {
    id: row.id,
    portfolioId: row.portfolioId,
    cycleId: row.cycleId,
    summaryDate: row.summaryDate,
    intelligenceVersionHash: row.intelligenceVersionHash,
    mostMaterialRecordId: row.mostMaterialRecordId,
    holdingsAffected: parseJsonArray(row.holdingsAffectedJson),
    marketWideEvents: parseJsonArray(row.marketWideEventsJson),
    upcomingEvents: parseJsonArray(row.upcomingEventsJson),
    unexplainedMovements: parseJsonArray(row.unexplainedMovementsJson),
    dataGaps: parseJsonArray(row.dataGapsJson),
    verificationQuality: row.verificationQuality,
    intelligenceTimestamp: row.intelligenceTimestamp
  };
}

function parseJsonArray(value: string | null): string[] {
  try {
    const parsed = JSON.parse(value ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseAttribution(value: string | null): IntelligenceAttribution {
  const parsed = parseJsonObject(value);
  return {
    status: (parsed.status as AttributionStatus) ?? "No verified attribution",
    confidence: (parsed.confidence as "Limited" | "Moderate" | "High") ?? "Limited",
    priceMovePct: typeof parsed.priceMovePct === "number" ? parsed.priceMovePct : null,
    window: typeof parsed.window === "string" ? parsed.window : "unavailable",
    explanation: typeof parsed.explanation === "string" ? parsed.explanation : "Attribution unavailable."
  };
}

function daysBetween(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / 86_400_000) : 999;
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export async function runScheduledMarketIntelligence(env: { DB: D1Database }, scheduledAt = new Date().toISOString()): Promise<unknown> {
  const now = new Date(scheduledAt);
  const service = new VerifiedMarketIntelligenceService(env.DB);
  const result = await service.ingest("portfolio_ira", "scheduled", now);
  const summary = await service.createPortfolioSummary("portfolio_ira", null, now);
  return { result, summary };
}
