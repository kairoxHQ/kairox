import { BenchmarkComparisonService, type BenchmarkComparisonSummary } from "../benchmarks/comparison.ts";
import { PortfolioDecisionService, type PortfolioDecision } from "../decisions/portfolioDecision.ts";
import { recordJourneyEvent } from "../journey/service.ts";
import { getInvestmentPolicy, type InvestmentPolicy } from "../policies/investmentPolicy.ts";
import { getPortfolioValuation, type PortfolioValuation } from "../portfolio/valuation.ts";
import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";
import { roundMoney, roundRatio } from "../shared/money.ts";

export type BriefingType = "daily_close" | "weekly_summary" | "monthly_report" | "risk_alert" | "rebalance_explanation" | "hold_explanation" | "data_unavailable" | "public_progress";
export type BriefingLength = "compact" | "standard" | "detailed";
export type BriefingTone = "plain" | "professional" | "educational";
export type NarrativeSource = "Deterministic" | "AI generated and validated" | "Fallback used";

export interface PortfolioBriefingFacts {
  factsSchemaVersion: "portfolio-briefing-facts-v1";
  portfolioId: string;
  publicAccountName: "IRA";
  accountMode: "Paper";
  strategy: "Conservative strategy";
  briefingType: BriefingType;
  evaluationDate: string;
  sourceCycleId: string | null;
  sourceDecisionId: string | null;
  sourceTimestamps: Record<string, string | null>;
  dataQualityStatus: string;
  marketDataTimestamp: string | null;
  portfolioValueUsd: number;
  dailyChangeUsd: number;
  dailyChangePct: number;
  returnSinceStartUsd: number;
  returnSinceStartPct: number;
  cashUsd: number;
  cashPct: number;
  positions: Array<{ symbol: string; valueUsd: number; quantity: number }>;
  largestPositiveContributor: string | null;
  largestNegativeContributor: string | null;
  currentAllocation: Record<string, number>;
  targetAllocation: Record<string, number>;
  policyStatus: string;
  policyFindings: string[];
  currentDrawdownPct: number;
  maximumDrawdownPct: number;
  benchmarkContext: {
    evidenceLabel: string;
    summary: string;
    bestReturnBenchmark: string | null;
    lowestDrawdownBenchmark: string | null;
  };
  recommendation: string;
  recommendationStatus: string;
  urgency: string;
  decisionSummary: string;
  triggeredRules: string[];
  supportingReasons: string[];
  risks: string[];
  dataLimitations: string[];
  unavailableFacts: string[];
  approvedComparisonStatements: string[];
  disclosure: string;
}

export interface BriefingNarrative {
  headline: string;
  summary: string;
  displayText: string;
  keyChanges: string[];
  recommendation: string;
  supportingReasons: string[];
  risks: string[];
  benchmarkContext: Record<string, unknown>;
  dataLimitations: string[];
  disclosure: string;
}

export interface BriefingNarrativeProvider {
  readonly providerName: string;
  readonly modelIdentifier: string;
  generate(facts: PortfolioBriefingFacts, options: BriefingOptions): Promise<BriefingNarrative>;
}

export interface BriefingOptions {
  type?: BriefingType;
  length?: BriefingLength;
  tone?: BriefingTone;
  regenerate?: boolean;
  regenerationReason?: string | null;
  now?: Date;
}

export interface PortfolioBriefing {
  id: string;
  portfolioId: string;
  briefingType: BriefingType;
  evaluationDate: string;
  sourceCycleId: string | null;
  sourceDecisionId: string | null;
  sourceVersionHash: string;
  version: number;
  factsSchemaVersion: string;
  facts: PortfolioBriefingFacts;
  headline: string;
  summary: string;
  keyChanges: string[];
  recommendation: string;
  supportingReasons: string[];
  risks: string[];
  benchmarkContext: Record<string, unknown>;
  dataLimitations: string[];
  disclosure: string;
  modelProvider: string;
  modelIdentifier: string;
  promptVersion: string;
  validationVersion: string;
  validationStatus: "valid" | "fallback_used";
  validationErrors: string[];
  narrativeSource: NarrativeSource;
  displayText: string;
  reviewStatus: "generated" | "reviewed" | "archived";
  generatedAt: string;
  regenerationReason: string | null;
}

interface BriefingRow {
  id: string;
  portfolioId: string;
  briefingType: BriefingType;
  evaluationDate: string;
  sourceCycleId: string | null;
  sourceDecisionId: string | null;
  sourceVersionHash: string;
  version: number;
  factsSchemaVersion: string;
  factsSnapshotJson: string;
  headline: string;
  summary: string;
  keyChangesJson: string;
  recommendation: string;
  supportingReasonsJson: string;
  risksJson: string;
  benchmarkContextJson: string;
  dataLimitationsJson: string;
  disclosure: string;
  modelProvider: string;
  modelIdentifier: string;
  promptVersion: string;
  validationVersion: string;
  validationStatus: "valid" | "fallback_used";
  validationErrorsJson: string;
  narrativeSource: NarrativeSource;
  displayText: string;
  reviewStatus: "generated" | "reviewed" | "archived";
  generatedAt: string;
  regenerationReason: string | null;
}

interface CycleRow {
  id: string;
  cycleDate: string;
  completedAt: string | null;
  dataTimestamp: string | null;
  marketDataStatus: string;
  dailyChangeUsd: number;
  dailyChangePct: number;
  returnSinceStartUsd: number;
  returnSinceStartPct: number;
  currentAllocationJson: string;
  targetAllocationJson: string;
  drawdownMetricsJson: string;
  policyFindingsJson: string;
  riskFindingsJson: string;
  recommendationExplanation: string;
}

interface PositionRow {
  symbol: string;
  quantity: number;
  marketValueUsd: number;
}

const FACTS_SCHEMA_VERSION = "portfolio-briefing-facts-v1";
const PROMPT_VERSION = "portfolio-briefing-template-v1";
const VALIDATION_VERSION = "portfolio-briefing-validation-v1";
const PAPER_DISCLOSURE = "This is a Kairox IRA paper simulation, not live brokerage activity or financial advice. No brokerage order was placed by this briefing.";

export class PortfolioBriefingService {
  private readonly db: D1Database;
  private readonly provider: BriefingNarrativeProvider;
  private readonly fallbackProvider: BriefingNarrativeProvider;

  constructor(db: D1Database, provider: BriefingNarrativeProvider = new DeterministicBriefingNarrativeProvider(), fallbackProvider: BriefingNarrativeProvider = new DeterministicBriefingNarrativeProvider("fallback-template")) {
    this.db = db;
    this.provider = provider;
    this.fallbackProvider = fallbackProvider;
  }

  async generate(portfolioId = TIM_PORTFOLIO_ID, options: BriefingOptions = {}): Promise<{ briefing: PortfolioBriefing; idempotent: boolean; fallbackUsed: boolean }> {
    const now = options.now ?? new Date();
    const type = options.type ?? "daily_close";
    const facts = await this.buildFacts(portfolioId, type, now);
    const sourceVersionHash = hashText(JSON.stringify({ type, sourceDecisionId: facts.sourceDecisionId, sourceCycleId: facts.sourceCycleId, recommendation: facts.recommendation, dataTimestamp: facts.marketDataTimestamp, portfolioValueUsd: facts.portfolioValueUsd }));
    const existing = await this.getExisting(portfolioId, type, sourceVersionHash);
    if (existing && !options.regenerate) {
      return { briefing: existing, idempotent: true, fallbackUsed: existing.narrativeSource === "Fallback used" };
    }
    const version = options.regenerate ? await this.nextVersion(portfolioId, type, sourceVersionHash) : 1;
    const generated = await this.generateNarrative(facts, options);
    const briefing = buildBriefingRecord({
      portfolioId,
      type,
      sourceVersionHash,
      version,
      facts,
      narrative: generated.narrative,
      providerName: generated.providerName,
      modelIdentifier: generated.modelIdentifier,
      narrativeSource: generated.fallbackUsed ? "Fallback used" : "Deterministic",
      validationErrors: generated.validationErrors,
      now,
      regenerationReason: options.regenerationReason ?? null
    });
    await this.insertBriefing(briefing);
    await this.recordEvent(briefing.id, portfolioId, generated.fallbackUsed ? "briefing_fallback_used" : "briefing_created", generated.fallbackUsed ? "Portfolio briefing used deterministic fallback." : "Portfolio briefing generated.", { validationErrors: generated.validationErrors }, now);
    await this.recordMeaningfulJourney(briefing, generated.fallbackUsed, now);
    return { briefing, idempotent: false, fallbackUsed: generated.fallbackUsed };
  }

  async latest(portfolioId = TIM_PORTFOLIO_ID): Promise<PortfolioBriefing | null> {
    const row = await this.db.prepare(`${BRIEFING_SELECT} WHERE portfolio_id = ? ORDER BY generated_at DESC LIMIT 1`).bind(portfolioId).first<BriefingRow>();
    return row ? mapBriefingRow(row) : null;
  }

  async list(portfolioId = TIM_PORTFOLIO_ID, limit = 20): Promise<PortfolioBriefing[]> {
    const rows = await listRows<BriefingRow>(this.db.prepare(`${BRIEFING_SELECT} WHERE portfolio_id = ? ORDER BY generated_at DESC LIMIT ?`).bind(portfolioId, limit));
    return rows.map(mapBriefingRow);
  }

  async publicSummary(portfolioId = TIM_PORTFOLIO_ID): Promise<Record<string, unknown>> {
    const briefing = await this.latest(portfolioId);
    if (!briefing) {
      return { portfolio: "IRA", simulation: "Paper simulation", strategy: "Conservative strategy", status: "No briefing available yet." };
    }
    return {
      portfolio: "IRA",
      simulation: "Paper simulation",
      strategy: "Conservative strategy",
      startingCapitalUsd: 2400,
      currentSimulatedValueUsd: briefing.facts.portfolioValueUsd,
      returnSinceStartPct: briefing.facts.returnSinceStartPct,
      holdings: briefing.facts.positions.map((position) => position.symbol),
      currentRecommendation: briefing.recommendation,
      benchmarkComparison: briefing.facts.benchmarkContext.summary,
      evidenceQuality: briefing.facts.benchmarkContext.evidenceLabel,
      disclosure: briefing.disclosure
    };
  }

  private async buildFacts(portfolioId: string, type: BriefingType, now: Date): Promise<PortfolioBriefingFacts> {
    const [decision, cycle, valuation, positions, policy, benchmarkSummary] = await Promise.all([
      new PortfolioDecisionService(this.db).latest(portfolioId),
      this.latestCycle(portfolioId),
      getPortfolioValuation(this.db, portfolioId, now),
      this.positions(portfolioId),
      getInvestmentPolicy(this.db, portfolioId),
      new BenchmarkComparisonService(this.db).summary(portfolioId)
    ]);
    if (!decision) {
      throw new Error("No portfolio decision is available for briefing generation.");
    }
    const allocation = cycle ? parseJson<Record<string, number>>(cycle.currentAllocationJson, {}) : {};
    const target = cycle ? parseJson<Record<string, number>>(cycle.targetAllocationJson, {}) : {};
    const drawdown = cycle ? parseJson<{ currentDrawdownPct: number; maximumDrawdownPct: number }>(cycle.drawdownMetricsJson, { currentDrawdownPct: decision.drawdown.currentDrawdownPct, maximumDrawdownPct: decision.drawdown.maximumDrawdownPct }) : decision.drawdown;
    const policyFindings = cycle ? parseJson<string[]>(cycle.policyFindingsJson, []) : decision.policyCompliance.reasons;
    const riskFindings = cycle ? parseJson<string[]>(cycle.riskFindingsJson, []) : decision.triggeredRules;
    const benchmark = benchmarkContext(benchmarkSummary);
    const unavailableFacts = [
      "Position-level daily attribution is unavailable until per-position daily contribution snapshots are stored.",
      benchmarkSummary.history.length === 0 ? "Benchmark daily valuation history is not available yet." : null
    ].filter((item): item is string => Boolean(item));
    return {
      factsSchemaVersion: FACTS_SCHEMA_VERSION,
      portfolioId,
      publicAccountName: "IRA",
      accountMode: "Paper",
      strategy: "Conservative strategy",
      briefingType: type,
      evaluationDate: decision.evaluationDate,
      sourceCycleId: cycle?.id ?? decision.sourceCycleId,
      sourceDecisionId: decision.id,
      sourceTimestamps: { decisionCreatedAt: decision.createdAt, cycleCompletedAt: cycle?.completedAt ?? null, valuationTimestamp: valuation.valuationTimestamp },
      dataQualityStatus: decision.dataQualityStatus,
      marketDataTimestamp: decision.dataTimestamp ?? valuation.lastSuccessfulMarketDataUpdateTime,
      portfolioValueUsd: valuation.totalAccountValueUsd,
      dailyChangeUsd: cycle?.dailyChangeUsd ?? valuation.todayChangeUsd,
      dailyChangePct: cycle?.dailyChangePct ?? valuation.todayChangePct,
      returnSinceStartUsd: cycle?.returnSinceStartUsd ?? valuation.overallReturnUsd,
      returnSinceStartPct: cycle?.returnSinceStartPct ?? valuation.overallReturnPct,
      cashUsd: valuation.cashUsd,
      cashPct: valuation.totalAccountValueUsd > 0 ? roundRatio(valuation.cashUsd / valuation.totalAccountValueUsd) : 0,
      positions: positions.map((position) => ({ symbol: position.symbol, quantity: position.quantity, valueUsd: position.marketValueUsd })),
      largestPositiveContributor: null,
      largestNegativeContributor: null,
      currentAllocation: allocation,
      targetAllocation: target,
      policyStatus: policyFindings.length === 0 ? "Within policy" : "Policy review required",
      policyFindings,
      currentDrawdownPct: drawdown.currentDrawdownPct,
      maximumDrawdownPct: drawdown.maximumDrawdownPct,
      benchmarkContext: benchmark,
      recommendation: decision.primaryRecommendation,
      recommendationStatus: decision.status,
      urgency: decision.urgency,
      decisionSummary: decision.summary,
      triggeredRules: decision.triggeredRules,
      supportingReasons: decision.supportingFacts,
      risks: [...riskFindings, ...decision.policyCompliance.reasons],
      dataLimitations: unavailableFacts,
      unavailableFacts,
      approvedComparisonStatements: [benchmark.summary],
      disclosure: PAPER_DISCLOSURE
    };
  }

  private async generateNarrative(facts: PortfolioBriefingFacts, options: BriefingOptions): Promise<{ narrative: BriefingNarrative; providerName: string; modelIdentifier: string; fallbackUsed: boolean; validationErrors: string[] }> {
    try {
      const narrative = await this.provider.generate(facts, options);
      const validation = validateBriefingNarrative(facts, narrative);
      if (validation.valid) {
        return { narrative, providerName: this.provider.providerName, modelIdentifier: this.provider.modelIdentifier, fallbackUsed: false, validationErrors: [] };
      }
      const fallback = await this.fallbackProvider.generate(facts, options);
      return { narrative: fallback, providerName: this.fallbackProvider.providerName, modelIdentifier: this.fallbackProvider.modelIdentifier, fallbackUsed: true, validationErrors: validation.errors };
    } catch (error) {
      const fallback = await this.fallbackProvider.generate(facts, options);
      return { narrative: fallback, providerName: this.fallbackProvider.providerName, modelIdentifier: this.fallbackProvider.modelIdentifier, fallbackUsed: true, validationErrors: [error instanceof Error ? error.message : "Narrative provider failed."] };
    }
  }

  private async latestCycle(portfolioId: string): Promise<CycleRow | null> {
    return this.db.prepare(
      `SELECT id, cycle_date AS cycleDate, completed_at AS completedAt,
        data_timestamp AS dataTimestamp, market_data_status AS marketDataStatus,
        daily_change_usd AS dailyChangeUsd, daily_change_pct AS dailyChangePct,
        return_since_start_usd AS returnSinceStartUsd, return_since_start_pct AS returnSinceStartPct,
        current_allocation_json AS currentAllocationJson, target_allocation_json AS targetAllocationJson,
        drawdown_metrics_json AS drawdownMetricsJson, policy_findings_json AS policyFindingsJson,
        risk_findings_json AS riskFindingsJson, recommendation_explanation AS recommendationExplanation
       FROM daily_management_cycles
       WHERE portfolio_id = ? AND status = 'completed'
       ORDER BY cycle_date DESC, updated_at DESC
       LIMIT 1`
    ).bind(portfolioId).first<CycleRow>();
  }

  private async positions(portfolioId: string): Promise<PositionRow[]> {
    return listRows<PositionRow>(
      this.db.prepare("SELECT symbol, quantity, market_value_usd AS marketValueUsd FROM positions WHERE portfolio_id = ? AND quantity > 0 ORDER BY market_value_usd DESC").bind(portfolioId)
    );
  }

  private async getExisting(portfolioId: string, type: BriefingType, sourceVersionHash: string): Promise<PortfolioBriefing | null> {
    const row = await this.db.prepare(`${BRIEFING_SELECT} WHERE portfolio_id = ? AND briefing_type = ? AND source_version_hash = ? ORDER BY version DESC LIMIT 1`).bind(portfolioId, type, sourceVersionHash).first<BriefingRow>();
    return row ? mapBriefingRow(row) : null;
  }

  private async nextVersion(portfolioId: string, type: BriefingType, sourceVersionHash: string): Promise<number> {
    const row = await this.db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM portfolio_briefings WHERE portfolio_id = ? AND briefing_type = ? AND source_version_hash = ?").bind(portfolioId, type, sourceVersionHash).first<{ version: number }>();
    return row?.version ?? 1;
  }

  private async insertBriefing(briefing: PortfolioBriefing): Promise<void> {
    await this.db.prepare(
      `INSERT INTO portfolio_briefings (
        id, portfolio_id, briefing_type, evaluation_date, source_cycle_id, source_decision_id,
        source_version_hash, version, facts_schema_version, facts_snapshot_json, headline,
        summary, key_changes_json, recommendation, supporting_reasons_json, risks_json,
        benchmark_context_json, data_limitations_json, disclosure, model_provider,
        model_identifier, prompt_version, validation_version, validation_status,
        validation_errors_json, narrative_source, display_text, review_status,
        generated_at, regeneration_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      briefing.id,
      briefing.portfolioId,
      briefing.briefingType,
      briefing.evaluationDate,
      briefing.sourceCycleId,
      briefing.sourceDecisionId,
      briefing.sourceVersionHash,
      briefing.version,
      briefing.factsSchemaVersion,
      JSON.stringify(briefing.facts),
      briefing.headline,
      briefing.summary,
      JSON.stringify(briefing.keyChanges),
      briefing.recommendation,
      JSON.stringify(briefing.supportingReasons),
      JSON.stringify(briefing.risks),
      JSON.stringify(briefing.benchmarkContext),
      JSON.stringify(briefing.dataLimitations),
      briefing.disclosure,
      briefing.modelProvider,
      briefing.modelIdentifier,
      briefing.promptVersion,
      briefing.validationVersion,
      briefing.validationStatus,
      JSON.stringify(briefing.validationErrors),
      briefing.narrativeSource,
      briefing.displayText,
      briefing.reviewStatus,
      briefing.generatedAt,
      briefing.regenerationReason
    ).run();
  }

  private async recordEvent(briefingId: string | null, portfolioId: string, eventType: string, message: string, details: Record<string, unknown>, now: Date): Promise<void> {
    await this.db.prepare(
      `INSERT OR IGNORE INTO portfolio_briefing_events (
        id, briefing_id, portfolio_id, event_type, message, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id("portfolio_briefing_event", `${portfolioId}:${briefingId ?? "none"}:${eventType}:${now.toISOString()}`), briefingId, portfolioId, eventType, message, JSON.stringify(details), now.toISOString()).run();
  }

  private async recordMeaningfulJourney(briefing: PortfolioBriefing, fallbackUsed: boolean, now: Date): Promise<void> {
    const first = await this.db.prepare("SELECT id FROM portfolio_briefings WHERE portfolio_id = ? AND briefing_type = ? AND id <> ? LIMIT 1").bind(briefing.portfolioId, briefing.briefingType, briefing.id).first<{ id: string }>();
    if (first && !fallbackUsed && briefing.briefingType !== "risk_alert") return;
    await recordJourneyEvent(this.db, {
      portfolioId: briefing.portfolioId,
      eventType: briefing.briefingType === "risk_alert" ? "risk_limit_reached" : "manual_intervention",
      timestamp: now.toISOString(),
      title: fallbackUsed ? "Portfolio briefing fallback used" : `Portfolio ${briefing.briefingType.replace(/_/g, " ")} generated`,
      description: briefing.summary,
      accountValueUsd: briefing.facts.portfolioValueUsd,
      cashValueUsd: briefing.facts.cashUsd,
      source: "system",
      severity: briefing.briefingType === "risk_alert" ? "warning" : "info",
      strategyVersion: PROMPT_VERSION,
      metadata: { briefingId: briefing.id, narrativeSource: briefing.narrativeSource, paperOnly: true }
    });
  }
}

export class DeterministicBriefingNarrativeProvider implements BriefingNarrativeProvider {
  readonly providerName = "deterministic-template";
  readonly modelIdentifier: string;

  constructor(modelIdentifier = "portfolio-briefing-template-v1") {
    this.modelIdentifier = modelIdentifier;
  }

  async generate(facts: PortfolioBriefingFacts, options: BriefingOptions): Promise<BriefingNarrative> {
    const length = options.length ?? "standard";
    const headline = `${facts.publicAccountName} ${facts.accountMode.toLowerCase()} briefing: ${facts.recommendation}`;
    const movement = facts.dailyChangeUsd >= 0 ? `up ${money(facts.dailyChangeUsd)}` : `down ${money(Math.abs(facts.dailyChangeUsd))}`;
    const attribution = facts.largestPositiveContributor || facts.largestNegativeContributor
      ? `${facts.largestPositiveContributor ?? "No positive contributor"} helped most, while ${facts.largestNegativeContributor ?? "no negative contributor"} was weakest.`
      : "The portfolio moved primarily because of price changes in the listed holdings. Kairox does not yet have enough verified information to attribute the move to a specific event.";
    const compact = `${facts.publicAccountName} closed at ${money(facts.portfolioValueUsd)}, ${movement} today (${pct(facts.dailyChangePct)}), with ${money(facts.cashUsd)} in cash. Kairox recommendation remains ${facts.recommendation}; ${facts.decisionSummary} ${facts.disclosure}`;
    const paragraphs = [
      `${facts.publicAccountName} closed at ${money(facts.portfolioValueUsd)}, ${movement} today (${pct(facts.dailyChangePct)}). Return since the paper simulation began is ${money(facts.returnSinceStartUsd)} (${pct(facts.returnSinceStartPct)}), with ${money(facts.cashUsd)} in cash.`,
      attribution,
      `Policy status: ${facts.policyStatus}. Current drawdown is ${pct(facts.currentDrawdownPct)}, and the maximum recorded drawdown is ${pct(facts.maximumDrawdownPct)}.`,
      `Kairox recommendation: ${facts.recommendation}. ${facts.decisionSummary}`,
      `Benchmark context: ${facts.benchmarkContext.summary}`,
      facts.dataLimitations.length ? `Data limitations: ${facts.dataLimitations.join(" ")}` : "Data limitations: none material in the verified facts snapshot.",
      facts.disclosure
    ];
    const displayText = length === "compact" ? compact : length === "detailed" ? [...paragraphs, `Source decision: ${facts.sourceDecisionId ?? "unavailable"}. Market-data timestamp: ${facts.marketDataTimestamp ?? "unavailable"}.`].join("\n\n") : paragraphs.join("\n\n");
    return {
      headline,
      summary: compact,
      displayText,
      keyChanges: [movement, `Cash ${money(facts.cashUsd)}`, `Drawdown ${pct(facts.currentDrawdownPct)}`],
      recommendation: facts.recommendation,
      supportingReasons: facts.supportingReasons,
      risks: facts.risks,
      benchmarkContext: facts.benchmarkContext,
      dataLimitations: facts.dataLimitations,
      disclosure: facts.disclosure
    };
  }
}

export class FailingBriefingNarrativeProvider implements BriefingNarrativeProvider {
  readonly providerName = "failing-test-provider";
  readonly modelIdentifier = "failing-test-model";
  async generate(): Promise<BriefingNarrative> {
    throw new Error("AI provider unavailable.");
  }
}

export function validateBriefingNarrative(facts: PortfolioBriefingFacts, narrative: BriefingNarrative): { valid: boolean; errors: string[] } {
  const text = `${narrative.headline}\n${narrative.summary}\n${narrative.displayText}`;
  const errors: string[] = [];
  if (narrative.recommendation !== facts.recommendation || !text.includes(facts.recommendation)) errors.push("Recommendation does not match deterministic decision.");
  if (!text.includes(facts.disclosure) || !/paper simulation/i.test(text)) errors.push("Paper-simulation disclosure is missing.");
  if (/(guarantee|guaranteed|will outperform|proven superiority|fiduciary|advisor)/i.test(text)) errors.push("Prohibited performance or advisory claim detected.");
  if (/(buy|sell|execute|order|trade)\s+(VTI|SCHD|BND|SPY|BTC)/i.test(text) && !/recommendation:\s*(Rebalance|Deploy excess cash|Increase cash|Add to existing position|Reduce existing position)/i.test(text)) errors.push("Unsupported actionable trade language detected.");
  for (const match of text.matchAll(/\b[A-Z]{2,5}(?:-[A-Z]{3})?\b/g)) {
    const symbol = match[0];
    const allowed = new Set([...facts.positions.map((position) => position.symbol), "IRA", "Kairox".toUpperCase(), "USD"]);
    if (!allowed.has(symbol) && !["VTI", "BND", "SCHD", "SPY", "CD"].includes(symbol)) {
      errors.push(`Unsupported symbol ${symbol} referenced.`);
      break;
    }
  }
  if (/because of|due to|driven by/i.test(text) && !/does not yet have enough verified information/i.test(text) && !facts.largestPositiveContributor && !facts.largestNegativeContributor) {
    errors.push("Fabricated market-cause language detected.");
  }
  const requiredNumbers = [money(facts.portfolioValueUsd), money(facts.cashUsd), pct(facts.dailyChangePct)];
  for (const required of requiredNumbers) {
    if (!text.includes(required)) errors.push(`Required verified number missing: ${required}`);
  }
  return { valid: errors.length === 0, errors };
}

function buildBriefingRecord(input: {
  portfolioId: string;
  type: BriefingType;
  sourceVersionHash: string;
  version: number;
  facts: PortfolioBriefingFacts;
  narrative: BriefingNarrative;
  providerName: string;
  modelIdentifier: string;
  narrativeSource: NarrativeSource;
  validationErrors: string[];
  now: Date;
  regenerationReason: string | null;
}): PortfolioBriefing {
  return {
    id: `portfolio_briefing_${input.portfolioId}_${input.type}_${input.sourceVersionHash.slice(0, 12)}_${input.version}`,
    portfolioId: input.portfolioId,
    briefingType: input.type,
    evaluationDate: input.facts.evaluationDate,
    sourceCycleId: input.facts.sourceCycleId,
    sourceDecisionId: input.facts.sourceDecisionId,
    sourceVersionHash: input.sourceVersionHash,
    version: input.version,
    factsSchemaVersion: FACTS_SCHEMA_VERSION,
    facts: input.facts,
    headline: input.narrative.headline,
    summary: input.narrative.summary,
    keyChanges: input.narrative.keyChanges,
    recommendation: input.narrative.recommendation,
    supportingReasons: input.narrative.supportingReasons,
    risks: input.narrative.risks,
    benchmarkContext: input.narrative.benchmarkContext,
    dataLimitations: input.narrative.dataLimitations,
    disclosure: input.narrative.disclosure,
    modelProvider: input.providerName,
    modelIdentifier: input.modelIdentifier,
    promptVersion: PROMPT_VERSION,
    validationVersion: VALIDATION_VERSION,
    validationStatus: input.validationErrors.length ? "fallback_used" : "valid",
    validationErrors: input.validationErrors,
    narrativeSource: input.narrativeSource,
    displayText: input.narrative.displayText,
    reviewStatus: "generated",
    generatedAt: input.now.toISOString(),
    regenerationReason: input.regenerationReason
  };
}

function benchmarkContext(summary: BenchmarkComparisonSummary): PortfolioBriefingFacts["benchmarkContext"] {
  const available = summary.benchmarks.filter((benchmark) => benchmark.currentValueUsd !== null);
  const best = [...available].sort((a, b) => (b.returnPct ?? -Infinity) - (a.returnPct ?? -Infinity))[0];
  const lowestDrawdown = [...available].sort((a, b) => (a.maximumDrawdownPct ?? Infinity) - (b.maximumDrawdownPct ?? Infinity))[0];
  return { evidenceLabel: summary.evidence.label, summary: summary.proofSummary, bestReturnBenchmark: best?.benchmarkName ?? null, lowestDrawdownBenchmark: lowestDrawdown?.benchmarkName ?? null };
}

const BRIEFING_SELECT = `SELECT id, portfolio_id AS portfolioId, briefing_type AS briefingType,
  evaluation_date AS evaluationDate, source_cycle_id AS sourceCycleId, source_decision_id AS sourceDecisionId,
  source_version_hash AS sourceVersionHash, version, facts_schema_version AS factsSchemaVersion,
  facts_snapshot_json AS factsSnapshotJson, headline, summary, key_changes_json AS keyChangesJson,
  recommendation, supporting_reasons_json AS supportingReasonsJson, risks_json AS risksJson,
  benchmark_context_json AS benchmarkContextJson, data_limitations_json AS dataLimitationsJson,
  disclosure, model_provider AS modelProvider, model_identifier AS modelIdentifier,
  prompt_version AS promptVersion, validation_version AS validationVersion,
  validation_status AS validationStatus, validation_errors_json AS validationErrorsJson,
  narrative_source AS narrativeSource, display_text AS displayText, review_status AS reviewStatus,
  generated_at AS generatedAt, regeneration_reason AS regenerationReason
  FROM portfolio_briefings`;

function mapBriefingRow(row: BriefingRow): PortfolioBriefing {
  return {
    id: row.id,
    portfolioId: row.portfolioId,
    briefingType: row.briefingType,
    evaluationDate: row.evaluationDate,
    sourceCycleId: row.sourceCycleId,
    sourceDecisionId: row.sourceDecisionId,
    sourceVersionHash: row.sourceVersionHash,
    version: row.version,
    factsSchemaVersion: row.factsSchemaVersion,
    facts: parseJson(row.factsSnapshotJson, {} as PortfolioBriefingFacts),
    headline: row.headline,
    summary: row.summary,
    keyChanges: parseJson(row.keyChangesJson, []),
    recommendation: row.recommendation,
    supportingReasons: parseJson(row.supportingReasonsJson, []),
    risks: parseJson(row.risksJson, []),
    benchmarkContext: parseJson(row.benchmarkContextJson, {}),
    dataLimitations: parseJson(row.dataLimitationsJson, []),
    disclosure: row.disclosure,
    modelProvider: row.modelProvider,
    modelIdentifier: row.modelIdentifier,
    promptVersion: row.promptVersion,
    validationVersion: row.validationVersion,
    validationStatus: row.validationStatus,
    validationErrors: parseJson(row.validationErrorsJson, []),
    narrativeSource: row.narrativeSource,
    displayText: row.displayText,
    reviewStatus: row.reviewStatus,
    generatedAt: row.generatedAt,
    regenerationReason: row.regenerationReason
  };
}

function money(value: number): string {
  return `$${roundMoney(value).toFixed(4)}`;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function id(prefix: string, key: string): string {
  return `${prefix}_${hashText(key)}`;
}
