import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KNOWLEDGE_GRAPH_NODE_TYPES,
  KNOWLEDGE_GRAPH_RELATIONSHIP_TYPES
} from "../src/graph/knowledgeGraph.ts";

const migration = readFileSync("migrations/0034_knowledge_graph.sql", "utf8");
const graphSource = readFileSync("src/graph/knowledgeGraph.ts", "utf8");
const eventBusSource = readFileSync("src/events/eventBus.ts", "utf8");
const dashboardSource = readFileSync("src/dashboard/service.ts", "utf8");
const indexSource = readFileSync("src/index.ts", "utf8");

test("knowledge graph migration stores every required node type with history metadata", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS knowledge_graph_nodes/);
  for (const nodeType of [
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
  ]) {
    assert.match(migration, new RegExp(`'${nodeType.replace(" ", " ")}'`));
  }
  assert.match(migration, /first_seen_at TEXT NOT NULL/);
  assert.match(migration, /last_seen_at TEXT NOT NULL/);
  assert.match(migration, /UNIQUE\(node_type, external_id\)/);
});

test("knowledge graph migration stores deduped relationships, replayable sync runs, and visualization snapshots", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS knowledge_graph_relationships/);
  for (const relationship of ["OWNS", "TRACKS", "BELONGS_TO", "COMPARES_WITH", "GENERATED", "REFERENCES", "AFFECTED_BY", "RELATED_TO", "CONTAINS", "SUPPORTS", "MEASURED_BY", "PART_OF"]) {
    assert.match(migration, new RegExp(`'${relationship}'`));
  }
  assert.match(migration, /valid_from TEXT NOT NULL/);
  assert.match(migration, /valid_to TEXT/);
  assert.match(migration, /UNIQUE\(relationship_type, from_node_id, to_node_id, external_id\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS knowledge_graph_sync_runs/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS knowledge_graph_snapshots/);
});

test("graph service exposes provider-neutral sync, traversal, summary, and visualization APIs", () => {
  for (const nodeType of KNOWLEDGE_GRAPH_NODE_TYPES) {
    assert.match(graphSource, new RegExp(nodeType.replace(" ", "\\s")));
  }
  for (const relationshipType of KNOWLEDGE_GRAPH_RELATIONSHIP_TYPES) {
    assert.match(graphSource, new RegExp(relationshipType));
  }
  assert.match(graphSource, /class KnowledgeGraphService/);
  assert.match(graphSource, /syncPortfolio/);
  assert.match(graphSource, /syncFromEvent/);
  assert.match(graphSource, /summary/);
  assert.match(graphSource, /visualization/);
  assert.match(graphSource, /traverse/);
  assert.match(graphSource, /upsertNode/);
  assert.match(graphSource, /upsertRelationship/);
});

test("graph service derives nodes and relationships from existing Kairox source tables", () => {
  for (const source of [
    "portfolios",
    "broker_accounts",
    "positions",
    "account_investment_policies",
    "strategy_versions",
    "security_research_profiles",
    "benchmark_configurations",
    "account_daily_snapshots",
    "valuation_snapshots",
    "portfolio_decisions",
    "portfolio_briefings",
    "journey_events",
    "milestone_awards",
    "verified_intelligence_records"
  ]) {
    assert.match(graphSource, new RegExp(source));
  }
});

test("domain events automatically refresh the knowledge graph without blocking existing workflows", () => {
  assert.match(eventBusSource, /safeSyncKnowledgeGraphForEvent/);
  assert.match(eventBusSource, /await safeSyncKnowledgeGraphForEvent\(this\.db, event\)/);
  assert.match(graphSource, /console\.error\("Knowledge graph sync failed"/);
});

test("knowledge graph APIs include read queries and protected sync", () => {
  assert.match(indexSource, /"\/knowledge-graph"/);
  assert.match(indexSource, /"\/knowledge-graph\/visualization"/);
  assert.match(indexSource, /"\/knowledge-graph\/sync"/);
  assert.match(indexSource, /protectedPostRoutes[\s\S]*\/knowledge-graph\/sync/);
  assert.match(indexSource, /new KnowledgeGraphService\(env\.DB\)\.syncPortfolio/);
  assert.match(indexSource, /service\.traverse/);
  assert.match(indexSource, /service\.summary/);
});

test("dashboard exposes graph visualization and protected sync without secrets", () => {
  assert.match(dashboardSource, /Knowledge Graph/);
  assert.match(dashboardSource, /renderKnowledgeGraph/);
  assert.match(dashboardSource, /renderKnowledgeGraphSvg/);
  assert.match(dashboardSource, /data-run-knowledge-graph/);
  assert.match(dashboardSource, /\/knowledge-graph\?portfolioId=/);
  assert.match(dashboardSource, /\/knowledge-graph\/visualization/);
  assert.match(dashboardSource, /AI traversal ready/);
  assert.doesNotMatch(dashboardSource, /PAPER_RUN_SECRET/);
});

test("knowledge graph layer cannot alter trading state", () => {
  const graphSurfaces = [graphSource, eventBusSource].join("\n");
  assert.doesNotMatch(graphSurfaces, /executePaperOrderBatch|stagePaperOrdersForProposal|approveAllocationProposal/);
  assert.doesNotMatch(graphSource, /UPDATE portfolios|UPDATE positions|INSERT INTO positions|INSERT INTO trades|INSERT INTO orders|INSERT INTO paper_order_fills|cash_ledger/);
});
