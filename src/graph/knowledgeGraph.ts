import { listRows } from "../shared/db.ts";

export const KNOWLEDGE_GRAPH_NODE_TYPES = [
  "Account",
  "Portfolio",
  "Position",
  "Security",
  "ETF",
  "Company",
  "Sector",
  "Industry",
  "Asset Class",
  "Strategy",
  "Investment Policy",
  "Research Profile",
  "Benchmark",
  "Daily Snapshot",
  "Valuation",
  "Decision",
  "Briefing",
  "Journey Event",
  "Milestone",
  "Market Event"
] as const;

export const KNOWLEDGE_GRAPH_RELATIONSHIP_TYPES = [
  "OWNS",
  "TRACKS",
  "BELONGS_TO",
  "COMPARES_WITH",
  "GENERATED",
  "REFERENCES",
  "AFFECTED_BY",
  "RELATED_TO",
  "CONTAINS",
  "SUPPORTS",
  "MEASURED_BY",
  "PART_OF"
] as const;

export type KnowledgeGraphNodeType = typeof KNOWLEDGE_GRAPH_NODE_TYPES[number];
export type KnowledgeGraphRelationshipType = typeof KNOWLEDGE_GRAPH_RELATIONSHIP_TYPES[number];

export interface KnowledgeGraphNode {
  id: string;
  nodeType: KnowledgeGraphNodeType;
  externalId: string;
  label: string;
  sourceTable: string;
  sourceService: string;
  properties: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
  active: boolean;
}

export interface KnowledgeGraphRelationship {
  id: string;
  relationshipType: KnowledgeGraphRelationshipType;
  fromNodeId: string;
  toNodeId: string;
  externalId: string;
  sourceTable: string;
  sourceService: string;
  properties: Record<string, unknown>;
  validFrom: string;
  validTo: string | null;
  active: boolean;
}

export interface KnowledgeGraphSummary {
  portfolioId: string | null;
  nodes: KnowledgeGraphNode[];
  relationships: KnowledgeGraphRelationship[];
  nodeCounts: Record<string, number>;
  relationshipCounts: Record<string, number>;
  latestSync: KnowledgeGraphSyncRun | null;
}

export interface KnowledgeGraphSyncRun {
  id: string;
  portfolioId: string | null;
  triggerSource: string;
  sourceEventId: string | null;
  status: "started" | "completed" | "failed";
  nodesUpserted: number;
  relationshipsUpserted: number;
  errorDetails: string | null;
  startedAt: string;
  completedAt: string | null;
}

interface NodeInput {
  nodeType: KnowledgeGraphNodeType;
  externalId: string;
  label: string;
  sourceTable: string;
  sourceService: string;
  properties?: Record<string, unknown>;
}

interface RelationshipInput {
  relationshipType: KnowledgeGraphRelationshipType;
  from: NodeInput;
  to: NodeInput;
  externalId?: string;
  sourceTable: string;
  sourceService: string;
  properties?: Record<string, unknown>;
}

interface GraphCounters {
  nodes: number;
  relationships: number;
}

export class KnowledgeGraphService {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async syncPortfolio(portfolioId = "portfolio_ira", triggerSource = "manual", sourceEventId: string | null = null, now = new Date()): Promise<KnowledgeGraphSyncRun> {
    const runId = `kg_sync_${hashKey(`${portfolioId}:${triggerSource}:${sourceEventId ?? ""}:${now.toISOString()}`)}`;
    await this.db.prepare(
      `INSERT INTO knowledge_graph_sync_runs (
        id, portfolio_id, trigger_source, source_event_id, status, started_at
      ) VALUES (?, ?, ?, ?, 'started', ?)`
    ).bind(runId, portfolioId, triggerSource, sourceEventId, now.toISOString()).run();

    const counters: GraphCounters = { nodes: 0, relationships: 0 };
    try {
      await this.syncPortfolioCore(portfolioId, counters, now);
      await this.syncPositions(portfolioId, counters, now);
      await this.syncPolicies(portfolioId, counters, now);
      await this.syncStrategies(portfolioId, counters, now);
      await this.syncResearch(portfolioId, counters, now);
      await this.syncBenchmarks(portfolioId, counters, now);
      await this.syncSnapshots(portfolioId, counters, now);
      await this.syncDecisions(portfolioId, counters, now);
      await this.syncBriefings(portfolioId, counters, now);
      await this.syncJourneyAndMilestones(portfolioId, counters, now);
      await this.syncMarketEvents(portfolioId, counters, now);
      await this.db.prepare(
        `UPDATE knowledge_graph_sync_runs
         SET status = 'completed', nodes_upserted = ?, relationships_upserted = ?, completed_at = ?
         WHERE id = ?`
      ).bind(counters.nodes, counters.relationships, new Date().toISOString(), runId).run();
      return this.requiredSyncRun(runId);
    } catch (error) {
      await this.db.prepare(
        `UPDATE knowledge_graph_sync_runs
         SET status = 'failed', error_details = ?, completed_at = ?
         WHERE id = ?`
      ).bind(messageOf(error), new Date().toISOString(), runId).run();
      throw error;
    }
  }

  async syncFromEvent(event: { id: string; portfolioId: string | null; eventType: string; occurredAt: string }): Promise<KnowledgeGraphSyncRun | null> {
    if (!event.portfolioId) {
      return null;
    }
    return this.syncPortfolio(event.portfolioId, `domain_event:${event.eventType}`, event.id, new Date(event.occurredAt));
  }

  async summary(portfolioId: string | null = "portfolio_ira", limit = 200): Promise<KnowledgeGraphSummary> {
    const [nodes, relationships, latestSync] = await Promise.all([
      this.nodes(portfolioId, limit),
      this.relationships(portfolioId, limit),
      this.latestSync(portfolioId)
    ]);
    return {
      portfolioId,
      nodes,
      relationships,
      nodeCounts: countBy(nodes, (node) => node.nodeType),
      relationshipCounts: countBy(relationships, (edge) => edge.relationshipType),
      latestSync
    };
  }

  async visualization(portfolioId: string | null = "portfolio_ira", limit = 140): Promise<{ nodes: Array<{ id: string; label: string; type: string }>; edges: Array<{ id: string; from: string; to: string; label: string }>; generatedAt: string }> {
    const summary = await this.summary(portfolioId, limit);
    const nodeIds = new Set(summary.nodes.map((node) => node.id));
    return {
      nodes: summary.nodes.map((node) => ({ id: node.id, label: node.label, type: node.nodeType })),
      edges: summary.relationships
        .filter((edge) => nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId))
        .map((edge) => ({ id: edge.id, from: edge.fromNodeId, to: edge.toNodeId, label: edge.relationshipType })),
      generatedAt: new Date().toISOString()
    };
  }

  async traverse(nodeId: string, depth = 1, limit = 100): Promise<{ root: KnowledgeGraphNode | null; nodes: KnowledgeGraphNode[]; relationships: KnowledgeGraphRelationship[] }> {
    const root = await this.nodeById(nodeId);
    if (!root) {
      return { root: null, nodes: [], relationships: [] };
    }
    const seen = new Set([root.id]);
    const rels = new Map<string, KnowledgeGraphRelationship>();
    let frontier = [root.id];
    for (let level = 0; level < Math.max(1, depth); level += 1) {
      if (frontier.length === 0 || rels.size >= limit) break;
      const placeholders = frontier.map(() => "?").join(",");
      const rows = await listRows<RelationshipRow>(
        this.db.prepare(
          `${RELATIONSHIP_SELECT}
           WHERE active = 1 AND (from_node_id IN (${placeholders}) OR to_node_id IN (${placeholders}))
           ORDER BY updated_at DESC
           LIMIT ?`
        ).bind(...frontier, ...frontier, limit)
      );
      frontier = [];
      for (const row of rows) {
        const edge = mapRelationship(row);
        rels.set(edge.id, edge);
        for (const next of [edge.fromNodeId, edge.toNodeId]) {
          if (!seen.has(next)) {
            seen.add(next);
            frontier.push(next);
          }
        }
      }
    }
    const nodes = await this.nodesByIds([...seen]);
    return { root, nodes, relationships: [...rels.values()] };
  }

  private async syncPortfolioCore(portfolioId: string, counters: GraphCounters, now: Date): Promise<void> {
    const portfolio = await this.db.prepare(
      `SELECT p.id, p.name, p.mode, p.currency, p.cash_usd AS cashUsd,
        p.starting_balance_usd AS startingBalanceUsd, p.created_at AS createdAt,
        ba.id AS accountId, ba.broker_name AS brokerName, ba.account_type AS accountType, ba.status AS accountStatus
       FROM portfolios p
       LEFT JOIN broker_accounts ba ON ba.id = p.broker_account_id
       WHERE p.id = ?`
    ).bind(portfolioId).first<PortfolioCoreRow>();
    if (!portfolio) return;
    const portfolioNode = portfolioNodeInput(portfolio);
    counters.nodes += await this.upsertNode(portfolioNode, now);
    if (portfolio.accountId) {
      const accountNode: NodeInput = {
        nodeType: "Account",
        externalId: portfolio.accountId,
        label: portfolio.brokerName ?? portfolio.accountId,
        sourceTable: "broker_accounts",
        sourceService: "PortfolioAccounts",
        properties: { accountType: portfolio.accountType, status: portfolio.accountStatus, mode: portfolio.mode }
      };
      counters.nodes += await this.upsertNode(accountNode, now);
      counters.relationships += await this.upsertRelationship({
        relationshipType: "TRACKS",
        from: portfolioNode,
        to: accountNode,
        sourceTable: "portfolios",
        sourceService: "PortfolioAccounts",
        properties: { mode: portfolio.mode }
      }, now);
      counters.relationships += await this.upsertRelationship({
        relationshipType: "CONTAINS",
        from: accountNode,
        to: portfolioNode,
        sourceTable: "portfolios",
        sourceService: "PortfolioAccounts"
      }, now);
    }
  }

  private async syncPositions(portfolioId: string, counters: GraphCounters, now: Date): Promise<void> {
    const portfolio = await this.portfolioInput(portfolioId);
    if (!portfolio) return;
    const positions = await listRows<PositionRow>(
      this.db.prepare("SELECT id, symbol, asset_class AS assetClass, quantity, market_value_usd AS marketValueUsd, updated_at AS updatedAt FROM positions WHERE portfolio_id = ?").bind(portfolioId)
    );
    for (const position of positions) {
      const positionNode: NodeInput = {
        nodeType: "Position",
        externalId: position.id,
        label: `${position.symbol} position`,
        sourceTable: "positions",
        sourceService: "PortfolioPositions",
        properties: { symbol: position.symbol, quantity: position.quantity, marketValueUsd: position.marketValueUsd }
      };
      const security = securityNodeInput(position.symbol, position.symbol, position.assetClass, "positions");
      counters.nodes += await this.upsertNode(positionNode, now);
      counters.nodes += await this.upsertNode(security, now);
      counters.nodes += await this.upsertNode(assetClassNode(position.assetClass, "positions"), now);
      counters.relationships += await this.upsertRelationship({ relationshipType: "OWNS", from: portfolio, to: positionNode, sourceTable: "positions", sourceService: "PortfolioPositions", properties: { quantity: position.quantity, marketValueUsd: position.marketValueUsd } }, now);
      counters.relationships += await this.upsertRelationship({ relationshipType: "REFERENCES", from: positionNode, to: security, sourceTable: "positions", sourceService: "PortfolioPositions" }, now);
      counters.relationships += await this.upsertRelationship({ relationshipType: "BELONGS_TO", from: security, to: assetClassNode(position.assetClass, "positions"), sourceTable: "positions", sourceService: "PortfolioPositions" }, now);
    }
  }

  private async syncPolicies(portfolioId: string, counters: GraphCounters, now: Date): Promise<void> {
    const portfolio = await this.portfolioInput(portfolioId);
    if (!portfolio) return;
    const policies = await listRows<PolicyRow>(
      this.db.prepare("SELECT id, risk_profile AS riskProfile, primary_objective AS primaryObjective, status, simulation_began_at AS simulationBeganAt FROM account_investment_policies WHERE portfolio_id = ?").bind(portfolioId)
    );
    for (const policy of policies) {
      const policyNode: NodeInput = { nodeType: "Investment Policy", externalId: policy.id, label: `${policy.riskProfile} policy`, sourceTable: "account_investment_policies", sourceService: "PolicyEngine", properties: { ...policy } };
      counters.nodes += await this.upsertNode(policyNode, now);
      counters.relationships += await this.upsertRelationship({ relationshipType: "SUPPORTS", from: policyNode, to: portfolio, sourceTable: "account_investment_policies", sourceService: "PolicyEngine" }, now);
      counters.relationships += await this.upsertRelationship({ relationshipType: "REFERENCES", from: portfolio, to: policyNode, sourceTable: "account_investment_policies", sourceService: "PolicyEngine" }, now);
    }
  }

  private async syncStrategies(portfolioId: string, counters: GraphCounters, now: Date): Promise<void> {
    const portfolio = await this.portfolioInput(portfolioId);
    if (!portfolio) return;
    const strategies = await listRows<StrategyRow>(this.db.prepare("SELECT id, strategy_name AS strategyName, strategy_version AS strategyVersion, objective, status FROM strategy_versions"));
    for (const strategy of strategies) {
      const strategyNode: NodeInput = { nodeType: "Strategy", externalId: strategy.id, label: `${strategy.strategyName} ${strategy.strategyVersion}`, sourceTable: "strategy_versions", sourceService: "StrategyEngine", properties: { ...strategy } };
      counters.nodes += await this.upsertNode(strategyNode, now);
      counters.relationships += await this.upsertRelationship({ relationshipType: "SUPPORTS", from: strategyNode, to: portfolio, sourceTable: "strategy_versions", sourceService: "StrategyEngine" }, now);
    }
  }

  private async syncResearch(portfolioId: string, counters: GraphCounters, now: Date): Promise<void> {
    const profiles = await listRows<ResearchRow>(
      this.db.prepare("SELECT symbol, company_or_fund AS companyOrFund, asset_type AS assetType, sector, industry, overall_kairox_score AS overallKairoxScore, last_scored_at AS lastScoredAt FROM security_research_profiles ORDER BY overall_kairox_score DESC LIMIT 100")
    );
    for (const profile of profiles) {
      const security = securityNodeInput(profile.symbol, profile.companyOrFund, profile.assetType, "security_research_profiles");
      const research: NodeInput = { nodeType: "Research Profile", externalId: `research_${profile.symbol}`, label: `${profile.symbol} research`, sourceTable: "security_research_profiles", sourceService: "ResearchEngine", properties: { overallKairoxScore: profile.overallKairoxScore, lastScoredAt: profile.lastScoredAt } };
      counters.nodes += await this.upsertNode(security, now);
      counters.nodes += await this.upsertNode(research, now);
      counters.relationships += await this.upsertRelationship({ relationshipType: "MEASURED_BY", from: security, to: research, sourceTable: "security_research_profiles", sourceService: "ResearchEngine" }, now);
      if (profile.sector) await this.linkClassification(security, "Sector", profile.sector, "security_research_profiles", counters, now);
      if (profile.industry) await this.linkClassification(security, "Industry", profile.industry, "security_research_profiles", counters, now);
      counters.nodes += await this.upsertNode(assetClassNode(profile.assetType, "security_research_profiles"), now);
      counters.relationships += await this.upsertRelationship({ relationshipType: "BELONGS_TO", from: security, to: assetClassNode(profile.assetType, "security_research_profiles"), sourceTable: "security_research_profiles", sourceService: "ResearchEngine" }, now);
      if (/etf|bond_fund/i.test(profile.assetType)) {
        const etf: NodeInput = { nodeType: "ETF", externalId: profile.symbol, label: profile.companyOrFund, sourceTable: "security_research_profiles", sourceService: "ResearchEngine", properties: { symbol: profile.symbol } };
        counters.nodes += await this.upsertNode(etf, now);
        counters.relationships += await this.upsertRelationship({ relationshipType: "REFERENCES", from: etf, to: security, sourceTable: "security_research_profiles", sourceService: "ResearchEngine" }, now);
      }
    }
    const fits = await listRows<{ symbol: string; fitScore: number }>(
      this.db.prepare("SELECT symbol, fit_score AS fitScore FROM security_research_portfolio_fit WHERE portfolio_id = ? ORDER BY calculated_at DESC LIMIT 100").bind(portfolioId)
    );
    const portfolio = await this.portfolioInput(portfolioId);
    if (portfolio) {
      for (const fit of fits) {
        counters.relationships += await this.upsertRelationship({
          relationshipType: "RELATED_TO",
          from: portfolio,
          to: { nodeType: "Research Profile", externalId: `research_${fit.symbol}`, label: `${fit.symbol} research`, sourceTable: "security_research_profiles", sourceService: "ResearchEngine" },
          sourceTable: "security_research_portfolio_fit",
          sourceService: "ResearchEngine",
          properties: { fitScore: fit.fitScore }
        }, now);
      }
    }
  }

  private async syncBenchmarks(portfolioId: string, counters: GraphCounters, now: Date): Promise<void> {
    const portfolio = await this.portfolioInput(portfolioId);
    if (!portfolio) return;
    const benchmarks = await listRows<BenchmarkRow>(
      this.db.prepare("SELECT id, benchmark_name AS benchmarkName, benchmark_type AS benchmarkType, benchmark_key AS benchmarkKey, active FROM benchmark_configurations WHERE portfolio_id = ?").bind(portfolioId)
    );
    for (const benchmark of benchmarks) {
      const node: NodeInput = { nodeType: "Benchmark", externalId: benchmark.id, label: benchmark.benchmarkName, sourceTable: "benchmark_configurations", sourceService: "BenchmarkEngine", properties: { ...benchmark } };
      counters.nodes += await this.upsertNode(node, now);
      counters.relationships += await this.upsertRelationship({ relationshipType: "COMPARES_WITH", from: portfolio, to: node, sourceTable: "benchmark_configurations", sourceService: "BenchmarkEngine" }, now);
    }
  }

  private async syncSnapshots(portfolioId: string, counters: GraphCounters, now: Date): Promise<void> {
    const portfolio = await this.portfolioInput(portfolioId);
    if (!portfolio) return;
    const daily = await listRows<{ id: string; snapshotDate: string; totalValueUsd: number | null }>(
      this.db.prepare("SELECT id, snapshot_date AS snapshotDate, ending_total_account_value_usd AS totalValueUsd FROM account_daily_snapshots WHERE portfolio_id = ? ORDER BY snapshot_date DESC LIMIT 20").bind(portfolioId)
    );
    for (const snapshot of daily) {
      const node: NodeInput = { nodeType: "Daily Snapshot", externalId: snapshot.id, label: `Daily snapshot ${snapshot.snapshotDate}`, sourceTable: "account_daily_snapshots", sourceService: "PerformanceAnalytics", properties: snapshot };
      counters.nodes += await this.upsertNode(node, now);
      counters.relationships += await this.upsertRelationship({ relationshipType: "MEASURED_BY", from: portfolio, to: node, sourceTable: "account_daily_snapshots", sourceService: "PerformanceAnalytics" }, now);
    }
    const valuations = await listRows<{ id: string; valuationTimestamp: string; totalAccountValueUsd: number; dataStatus: string }>(
      this.db.prepare("SELECT id, valuation_timestamp AS valuationTimestamp, total_account_value_usd AS totalAccountValueUsd, data_status AS dataStatus FROM valuation_snapshots WHERE portfolio_id = ? ORDER BY valuation_timestamp DESC LIMIT 20").bind(portfolioId)
    );
    for (const valuation of valuations) {
      const node: NodeInput = { nodeType: "Valuation", externalId: valuation.id, label: `Valuation ${valuation.valuationTimestamp.slice(0, 10)}`, sourceTable: "valuation_snapshots", sourceService: "PortfolioValuation", properties: valuation };
      counters.nodes += await this.upsertNode(node, now);
      counters.relationships += await this.upsertRelationship({ relationshipType: "MEASURED_BY", from: portfolio, to: node, sourceTable: "valuation_snapshots", sourceService: "PortfolioValuation" }, now);
    }
  }

  private async syncDecisions(portfolioId: string, counters: GraphCounters, now: Date): Promise<void> {
    const portfolio = await this.portfolioInput(portfolioId);
    if (!portfolio) return;
    const rows = await listRows<DecisionRow>(
      this.db.prepare("SELECT id, primary_recommendation AS primaryRecommendation, status, confidence_score AS confidenceScore, risk_score AS riskScore, data_timestamp AS dataTimestamp FROM portfolio_decisions WHERE portfolio_id = ? ORDER BY created_at DESC LIMIT 30").bind(portfolioId)
    );
    for (const row of rows) {
      const node: NodeInput = { nodeType: "Decision", externalId: row.id, label: row.primaryRecommendation, sourceTable: "portfolio_decisions", sourceService: "DecisionEngine", properties: { ...row } };
      counters.nodes += await this.upsertNode(node, now);
      counters.relationships += await this.upsertRelationship({ relationshipType: "GENERATED", from: portfolio, to: node, sourceTable: "portfolio_decisions", sourceService: "DecisionEngine" }, now);
    }
  }

  private async syncBriefings(portfolioId: string, counters: GraphCounters, now: Date): Promise<void> {
    const portfolio = await this.portfolioInput(portfolioId);
    if (!portfolio) return;
    const rows = await listRows<BriefingRow>(
      this.db.prepare("SELECT id, briefing_type AS briefingType, source_decision_id AS sourceDecisionId, headline, recommendation, generated_at AS generatedAt FROM portfolio_briefings WHERE portfolio_id = ? ORDER BY generated_at DESC LIMIT 30").bind(portfolioId)
    );
    for (const row of rows) {
      const node: NodeInput = { nodeType: "Briefing", externalId: row.id, label: row.headline, sourceTable: "portfolio_briefings", sourceService: "Briefings", properties: { ...row } };
      counters.nodes += await this.upsertNode(node, now);
      counters.relationships += await this.upsertRelationship({ relationshipType: "GENERATED", from: portfolio, to: node, sourceTable: "portfolio_briefings", sourceService: "Briefings" }, now);
      if (row.sourceDecisionId) {
        counters.relationships += await this.upsertRelationship({ relationshipType: "REFERENCES", from: node, to: { nodeType: "Decision", externalId: row.sourceDecisionId, label: row.sourceDecisionId, sourceTable: "portfolio_decisions", sourceService: "DecisionEngine" }, sourceTable: "portfolio_briefings", sourceService: "Briefings" }, now);
      }
    }
  }

  private async syncJourneyAndMilestones(portfolioId: string, counters: GraphCounters, now: Date): Promise<void> {
    const portfolio = await this.portfolioInput(portfolioId);
    if (!portfolio) return;
    const journeys = await listRows<JourneyRow>(
      this.db.prepare("SELECT id, event_type AS eventType, title, related_asset AS relatedAsset, related_milestone_id AS relatedMilestoneId, timestamp FROM journey_events WHERE portfolio_id = ? ORDER BY timestamp DESC LIMIT 50").bind(portfolioId)
    );
    for (const journey of journeys) {
      const node: NodeInput = { nodeType: "Journey Event", externalId: journey.id, label: journey.title, sourceTable: "journey_events", sourceService: "Journey", properties: { ...journey } };
      counters.nodes += await this.upsertNode(node, now);
      counters.relationships += await this.upsertRelationship({ relationshipType: "GENERATED", from: portfolio, to: node, sourceTable: "journey_events", sourceService: "Journey" }, now);
      if (journey.relatedAsset) counters.relationships += await this.upsertRelationship({ relationshipType: "REFERENCES", from: node, to: securityNodeInput(journey.relatedAsset, journey.relatedAsset, "unknown", "journey_events"), sourceTable: "journey_events", sourceService: "Journey" }, now);
      if (journey.relatedMilestoneId) counters.relationships += await this.upsertRelationship({ relationshipType: "RELATED_TO", from: node, to: { nodeType: "Milestone", externalId: journey.relatedMilestoneId, label: journey.relatedMilestoneId, sourceTable: "milestone_awards", sourceService: "Milestones" }, sourceTable: "journey_events", sourceService: "Journey" }, now);
    }
    const milestones = await listRows<MilestoneRow>(
      this.db.prepare("SELECT ma.id, md.name, ma.earned_at AS earnedAt, ma.progress_value AS progressValue FROM milestone_awards ma JOIN milestone_definitions md ON md.id = ma.milestone_id WHERE ma.portfolio_id = ? ORDER BY ma.earned_at DESC LIMIT 50").bind(portfolioId)
    );
    for (const milestone of milestones) {
      const node: NodeInput = { nodeType: "Milestone", externalId: milestone.id, label: milestone.name, sourceTable: "milestone_awards", sourceService: "Milestones", properties: { ...milestone } };
      counters.nodes += await this.upsertNode(node, now);
      counters.relationships += await this.upsertRelationship({ relationshipType: "GENERATED", from: portfolio, to: node, sourceTable: "milestone_awards", sourceService: "Milestones" }, now);
    }
  }

  private async syncMarketEvents(portfolioId: string, counters: GraphCounters, now: Date): Promise<void> {
    const rows = await listRows<MarketEventRow>(
      this.db.prepare(
        `SELECT pil.id, pil.portfolio_id AS portfolioId, vir.headline, vir.event_type AS eventType,
          vir.related_symbols_json AS relatedSymbolsJson, vir.event_date AS eventDate,
          vir.verification_status AS verificationStatus
         FROM portfolio_intelligence_links pil
         JOIN verified_intelligence_records vir ON vir.id = pil.intelligence_record_id
         WHERE pil.portfolio_id = ?
         ORDER BY vir.event_date DESC
         LIMIT 50`
      ).bind(portfolioId)
    );
    const portfolio = await this.portfolioInput(portfolioId);
    for (const row of rows) {
      const node: NodeInput = { nodeType: "Market Event", externalId: row.id, label: row.headline, sourceTable: "verified_intelligence_records", sourceService: "MarketIntelligence", properties: { ...row } };
      counters.nodes += await this.upsertNode(node, now);
      if (portfolio) counters.relationships += await this.upsertRelationship({ relationshipType: "AFFECTED_BY", from: portfolio, to: node, sourceTable: "portfolio_intelligence_links", sourceService: "MarketIntelligence" }, now);
      for (const symbol of parseJsonArray(row.relatedSymbolsJson)) {
        counters.relationships += await this.upsertRelationship({ relationshipType: "RELATED_TO", from: node, to: securityNodeInput(symbol, symbol, "unknown", "verified_intelligence_records"), sourceTable: "verified_intelligence_records", sourceService: "MarketIntelligence" }, now);
      }
    }
  }

  private async portfolioInput(portfolioId: string): Promise<NodeInput | null> {
    const row = await this.db.prepare("SELECT id, name, mode, currency, cash_usd AS cashUsd, starting_balance_usd AS startingBalanceUsd FROM portfolios WHERE id = ?").bind(portfolioId).first<PortfolioCoreRow>();
    return row ? portfolioNodeInput(row) : null;
  }

  private async upsertNode(input: NodeInput, now: Date): Promise<number> {
    const graphNodeId = nodeId(input.nodeType, input.externalId);
    const result = await this.db.prepare(
      `INSERT INTO knowledge_graph_nodes (
        id, node_type, external_id, label, source_table, source_service,
        properties_json, first_seen_at, last_seen_at, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(node_type, external_id) DO UPDATE SET
        label = excluded.label,
        source_table = excluded.source_table,
        source_service = excluded.source_service,
        properties_json = excluded.properties_json,
        last_seen_at = excluded.last_seen_at,
        active = 1,
        updated_at = datetime('now')`
    ).bind(graphNodeId, input.nodeType, input.externalId, input.label, input.sourceTable, input.sourceService, JSON.stringify(input.properties ?? {}), now.toISOString(), now.toISOString()).run();
    return result.success ? 1 : 0;
  }

  private async upsertRelationship(input: RelationshipInput, now: Date): Promise<number> {
    await this.upsertNode(input.from, now);
    await this.upsertNode(input.to, now);
    const fromNodeId = nodeId(input.from.nodeType, input.from.externalId);
    const toNodeId = nodeId(input.to.nodeType, input.to.externalId);
    const externalId = input.externalId ?? `${input.from.nodeType}:${input.from.externalId}:${input.relationshipType}:${input.to.nodeType}:${input.to.externalId}`;
    const edgeId = relationshipId(input.relationshipType, fromNodeId, toNodeId, externalId);
    const result = await this.db.prepare(
      `INSERT INTO knowledge_graph_relationships (
        id, relationship_type, from_node_id, to_node_id, external_id,
        source_table, source_service, properties_json, valid_from, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(relationship_type, from_node_id, to_node_id, external_id) DO UPDATE SET
        source_table = excluded.source_table,
        source_service = excluded.source_service,
        properties_json = excluded.properties_json,
        active = 1,
        updated_at = datetime('now')`
    ).bind(edgeId, input.relationshipType, fromNodeId, toNodeId, externalId, input.sourceTable, input.sourceService, JSON.stringify(input.properties ?? {}), now.toISOString()).run();
    return result.success ? 1 : 0;
  }

  private async linkClassification(security: NodeInput, type: "Sector" | "Industry", value: string, sourceTable: string, counters: GraphCounters, now: Date): Promise<void> {
    const node: NodeInput = { nodeType: type, externalId: value, label: value, sourceTable, sourceService: "KnowledgeGraphService" };
    counters.nodes += await this.upsertNode(node, now);
    counters.relationships += await this.upsertRelationship({ relationshipType: "BELONGS_TO", from: security, to: node, sourceTable, sourceService: "KnowledgeGraphService" }, now);
  }

  private async nodes(portfolioId: string | null, limit: number): Promise<KnowledgeGraphNode[]> {
    const rows = portfolioId
      ? await listRows<NodeRow>(
        this.db.prepare(
          `${NODE_SELECT}
           WHERE id IN (
             SELECT from_node_id FROM knowledge_graph_relationships WHERE to_node_id = ? OR from_node_id = ?
             UNION
             SELECT to_node_id FROM knowledge_graph_relationships WHERE to_node_id = ? OR from_node_id = ?
             UNION SELECT ?
           )
           ORDER BY node_type ASC, label ASC
           LIMIT ?`
        ).bind(nodeId("Portfolio", portfolioId), nodeId("Portfolio", portfolioId), nodeId("Portfolio", portfolioId), nodeId("Portfolio", portfolioId), nodeId("Portfolio", portfolioId), limit)
      )
      : await listRows<NodeRow>(this.db.prepare(`${NODE_SELECT} ORDER BY updated_at DESC LIMIT ?`).bind(limit));
    return rows.map(mapNode);
  }

  private async relationships(portfolioId: string | null, limit: number): Promise<KnowledgeGraphRelationship[]> {
    const portfolioNodeId = portfolioId ? nodeId("Portfolio", portfolioId) : null;
    const rows = portfolioNodeId
      ? await listRows<RelationshipRow>(
        this.db.prepare(`${RELATIONSHIP_SELECT} WHERE active = 1 AND (from_node_id = ? OR to_node_id = ? OR from_node_id IN (SELECT to_node_id FROM knowledge_graph_relationships WHERE from_node_id = ?) OR to_node_id IN (SELECT to_node_id FROM knowledge_graph_relationships WHERE from_node_id = ?)) ORDER BY updated_at DESC LIMIT ?`).bind(portfolioNodeId, portfolioNodeId, portfolioNodeId, portfolioNodeId, limit)
      )
      : await listRows<RelationshipRow>(this.db.prepare(`${RELATIONSHIP_SELECT} WHERE active = 1 ORDER BY updated_at DESC LIMIT ?`).bind(limit));
    return rows.map(mapRelationship);
  }

  private async nodeById(id: string): Promise<KnowledgeGraphNode | null> {
    const row = await this.db.prepare(`${NODE_SELECT} WHERE id = ? LIMIT 1`).bind(id).first<NodeRow>();
    return row ? mapNode(row) : null;
  }

  private async nodesByIds(ids: string[]): Promise<KnowledgeGraphNode[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = await listRows<NodeRow>(this.db.prepare(`${NODE_SELECT} WHERE id IN (${placeholders})`).bind(...ids));
    return rows.map(mapNode);
  }

  private async latestSync(portfolioId: string | null): Promise<KnowledgeGraphSyncRun | null> {
    const query = portfolioId
      ? this.db.prepare(`${SYNC_SELECT} WHERE portfolio_id = ? ORDER BY started_at DESC LIMIT 1`).bind(portfolioId)
      : this.db.prepare(`${SYNC_SELECT} ORDER BY started_at DESC LIMIT 1`);
    const row = await query.first<SyncRow>();
    return row ? mapSyncRun(row) : null;
  }

  private async requiredSyncRun(runId: string): Promise<KnowledgeGraphSyncRun> {
    const row = await this.db.prepare(`${SYNC_SELECT} WHERE id = ?`).bind(runId).first<SyncRow>();
    if (!row) throw new Error("Knowledge graph sync run was not found after persistence.");
    return mapSyncRun(row);
  }
}

export async function safeSyncKnowledgeGraphForEvent(db: D1Database, event: { id: string; portfolioId: string | null; eventType: string; occurredAt: string }): Promise<void> {
  try {
    await new KnowledgeGraphService(db).syncFromEvent(event);
  } catch (error) {
    console.error("Knowledge graph sync failed", { eventId: event.id, eventType: event.eventType, message: messageOf(error) });
  }
}

function portfolioNodeInput(row: PortfolioCoreRow): NodeInput {
  return {
    nodeType: "Portfolio",
    externalId: row.id,
    label: row.name,
    sourceTable: "portfolios",
    sourceService: "PortfolioAccounts",
    properties: { mode: row.mode, currency: row.currency, cashUsd: row.cashUsd, startingBalanceUsd: row.startingBalanceUsd }
  };
}

function securityNodeInput(symbol: string, label: string, assetType: string, sourceTable: string): NodeInput {
  return { nodeType: "Security", externalId: symbol, label, sourceTable, sourceService: "SecurityRegistry", properties: { symbol, assetType } };
}

function assetClassNode(value: string, sourceTable: string): NodeInput {
  return { nodeType: "Asset Class", externalId: value || "unknown", label: value || "Unknown", sourceTable, sourceService: "SecurityRegistry" };
}

function nodeId(type: string, externalId: string): string {
  return `kg_node_${hashKey(`${type}:${externalId}`)}`;
}

function relationshipId(type: string, fromNodeId: string, toNodeId: string, externalId: string): string {
  return `kg_rel_${hashKey(`${type}:${fromNodeId}:${toNodeId}:${externalId}`)}`;
}

function mapNode(row: NodeRow): KnowledgeGraphNode {
  return {
    id: row.id,
    nodeType: row.nodeType,
    externalId: row.externalId,
    label: row.label,
    sourceTable: row.sourceTable,
    sourceService: row.sourceService,
    properties: parseJsonObject(row.propertiesJson),
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    active: row.active === 1
  };
}

function mapRelationship(row: RelationshipRow): KnowledgeGraphRelationship {
  return {
    id: row.id,
    relationshipType: row.relationshipType,
    fromNodeId: row.fromNodeId,
    toNodeId: row.toNodeId,
    externalId: row.externalId,
    sourceTable: row.sourceTable,
    sourceService: row.sourceService,
    properties: parseJsonObject(row.propertiesJson),
    validFrom: row.validFrom,
    validTo: row.validTo,
    active: row.active === 1
  };
}

function mapSyncRun(row: SyncRow): KnowledgeGraphSyncRun {
  return {
    id: row.id,
    portfolioId: row.portfolioId,
    triggerSource: row.triggerSource,
    sourceEventId: row.sourceEventId,
    status: row.status,
    nodesUpserted: row.nodesUpserted,
    relationshipsUpserted: row.relationshipsUpserted,
    errorDetails: row.errorDetails,
    startedAt: row.startedAt,
    completedAt: row.completedAt
  };
}

function countBy<T>(items: T[], keyFor: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: string | null): string[] {
  try {
    const parsed = JSON.parse(value ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function hashKey(key: string): string {
  let value = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    value ^= key.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(16);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown knowledge graph error.";
}

interface PortfolioCoreRow {
  id: string;
  name: string;
  mode: string;
  currency: string;
  cashUsd: number;
  startingBalanceUsd: number;
  createdAt?: string;
  accountId?: string | null;
  brokerName?: string | null;
  accountType?: string | null;
  accountStatus?: string | null;
}

interface PositionRow { id: string; symbol: string; assetClass: string; quantity: number; marketValueUsd: number; updatedAt: string }
interface PolicyRow { id: string; riskProfile: string; primaryObjective: string; status: string; simulationBeganAt: string }
interface StrategyRow { id: string; strategyName: string; strategyVersion: string; objective: string; status: string }
interface ResearchRow { symbol: string; companyOrFund: string; assetType: string; sector: string | null; industry: string | null; overallKairoxScore: number; lastScoredAt: string }
interface BenchmarkRow { id: string; benchmarkName: string; benchmarkType: string; benchmarkKey: string; active: number }
interface DecisionRow { id: string; primaryRecommendation: string; status: string; confidenceScore: number; riskScore: number; dataTimestamp: string | null }
interface BriefingRow { id: string; briefingType: string; sourceDecisionId: string | null; headline: string; recommendation: string; generatedAt: string }
interface JourneyRow { id: string; eventType: string; title: string; relatedAsset: string | null; relatedMilestoneId: string | null; timestamp: string }
interface MilestoneRow { id: string; name: string; earnedAt: string; progressValue: number }
interface MarketEventRow { id: string; portfolioId: string; headline: string; eventType: string; relatedSymbolsJson: string; eventDate: string; verificationStatus: string }

interface NodeRow {
  id: string;
  nodeType: KnowledgeGraphNodeType;
  externalId: string;
  label: string;
  sourceTable: string;
  sourceService: string;
  propertiesJson: string;
  firstSeenAt: string;
  lastSeenAt: string;
  active: number;
}

interface RelationshipRow {
  id: string;
  relationshipType: KnowledgeGraphRelationshipType;
  fromNodeId: string;
  toNodeId: string;
  externalId: string;
  sourceTable: string;
  sourceService: string;
  propertiesJson: string;
  validFrom: string;
  validTo: string | null;
  active: number;
}

interface SyncRow {
  id: string;
  portfolioId: string | null;
  triggerSource: string;
  sourceEventId: string | null;
  status: "started" | "completed" | "failed";
  nodesUpserted: number;
  relationshipsUpserted: number;
  errorDetails: string | null;
  startedAt: string;
  completedAt: string | null;
}

const NODE_SELECT = `SELECT id, node_type AS nodeType, external_id AS externalId, label,
  source_table AS sourceTable, source_service AS sourceService, properties_json AS propertiesJson,
  first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, active
  FROM knowledge_graph_nodes`;

const RELATIONSHIP_SELECT = `SELECT id, relationship_type AS relationshipType,
  from_node_id AS fromNodeId, to_node_id AS toNodeId, external_id AS externalId,
  source_table AS sourceTable, source_service AS sourceService, properties_json AS propertiesJson,
  valid_from AS validFrom, valid_to AS validTo, active
  FROM knowledge_graph_relationships`;

const SYNC_SELECT = `SELECT id, portfolio_id AS portfolioId, trigger_source AS triggerSource,
  source_event_id AS sourceEventId, status, nodes_upserted AS nodesUpserted,
  relationships_upserted AS relationshipsUpserted, error_details AS errorDetails,
  started_at AS startedAt, completed_at AS completedAt
  FROM knowledge_graph_sync_runs`;
