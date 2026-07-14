CREATE TABLE IF NOT EXISTS knowledge_graph_nodes (
  id TEXT PRIMARY KEY,
  node_type TEXT NOT NULL CHECK (node_type IN (
    'Account',
    'Portfolio',
    'Position',
    'Security',
    'ETF',
    'Company',
    'Sector',
    'Industry',
    'Asset Class',
    'Strategy',
    'Investment Policy',
    'Research Profile',
    'Benchmark',
    'Daily Snapshot',
    'Valuation',
    'Decision',
    'Briefing',
    'Journey Event',
    'Milestone',
    'Market Event'
  )),
  external_id TEXT NOT NULL,
  label TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_service TEXT NOT NULL,
  properties_json TEXT NOT NULL DEFAULT '{}',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(node_type, external_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_graph_nodes_type_label
  ON knowledge_graph_nodes(node_type, label);

CREATE TABLE IF NOT EXISTS knowledge_graph_relationships (
  id TEXT PRIMARY KEY,
  relationship_type TEXT NOT NULL CHECK (relationship_type IN (
    'OWNS',
    'TRACKS',
    'BELONGS_TO',
    'COMPARES_WITH',
    'GENERATED',
    'REFERENCES',
    'AFFECTED_BY',
    'RELATED_TO',
    'CONTAINS',
    'SUPPORTS',
    'MEASURED_BY',
    'PART_OF'
  )),
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_service TEXT NOT NULL,
  properties_json TEXT NOT NULL DEFAULT '{}',
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (from_node_id) REFERENCES knowledge_graph_nodes(id),
  FOREIGN KEY (to_node_id) REFERENCES knowledge_graph_nodes(id),
  UNIQUE(relationship_type, from_node_id, to_node_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_graph_relationships_from
  ON knowledge_graph_relationships(from_node_id, relationship_type, active);

CREATE INDEX IF NOT EXISTS idx_knowledge_graph_relationships_to
  ON knowledge_graph_relationships(to_node_id, relationship_type, active);

CREATE TABLE IF NOT EXISTS knowledge_graph_sync_runs (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT,
  trigger_source TEXT NOT NULL,
  source_event_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  nodes_upserted INTEGER NOT NULL DEFAULT 0,
  relationships_upserted INTEGER NOT NULL DEFAULT 0,
  error_details TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_knowledge_graph_sync_runs_portfolio
  ON knowledge_graph_sync_runs(portfolio_id, started_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_graph_snapshots (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT,
  snapshot_type TEXT NOT NULL CHECK (snapshot_type IN ('visualization', 'ai_context', 'audit')),
  node_count INTEGER NOT NULL,
  relationship_count INTEGER NOT NULL,
  graph_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_knowledge_graph_snapshots_portfolio
  ON knowledge_graph_snapshots(portfolio_id, generated_at DESC);
