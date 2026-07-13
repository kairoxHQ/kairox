CREATE TABLE IF NOT EXISTS event_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS event_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL,
  reliability_score REAL NOT NULL CHECK (reliability_score >= 0 AND reliability_score <= 1),
  notes TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS intelligence_events (
  event_id TEXT PRIMARY KEY,
  event_timestamp TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  primary_category_id TEXT NOT NULL,
  secondary_category_id TEXT,
  source_id TEXT NOT NULL,
  source_url TEXT,
  country TEXT,
  affected_regions_json TEXT NOT NULL DEFAULT '[]',
  affected_asset_classes_json TEXT NOT NULL DEFAULT '[]',
  affected_symbols_json TEXT NOT NULL DEFAULT '[]',
  potential_duration TEXT NOT NULL,
  immediate_impact TEXT NOT NULL,
  downstream_impacts_json TEXT NOT NULL DEFAULT '[]',
  severity REAL NOT NULL CHECK (severity >= 0 AND severity <= 1),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status TEXT NOT NULL CHECK (status IN ('sample', 'watching', 'verified', 'rejected', 'archived')),
  verification_count INTEGER NOT NULL DEFAULT 0 CHECK (verification_count >= 0),
  sample_data INTEGER NOT NULL DEFAULT 0 CHECK (sample_data IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (primary_category_id) REFERENCES event_categories(id),
  FOREIGN KEY (secondary_category_id) REFERENCES event_categories(id),
  FOREIGN KEY (source_id) REFERENCES event_sources(id)
);

CREATE INDEX IF NOT EXISTS idx_intelligence_events_timestamp
  ON intelligence_events(event_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_intelligence_events_category_status
  ON intelligence_events(primary_category_id, status, event_timestamp DESC);

CREATE TABLE IF NOT EXISTS asset_impacts (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  symbol TEXT,
  impact_direction TEXT NOT NULL CHECK (impact_direction IN ('positive', 'negative', 'mixed', 'neutral', 'unknown')),
  impact_magnitude REAL NOT NULL CHECK (impact_magnitude >= 0 AND impact_magnitude <= 1),
  rationale TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES intelligence_events(event_id)
);

CREATE INDEX IF NOT EXISTS idx_asset_impacts_event
  ON asset_impacts(event_id);

CREATE TABLE IF NOT EXISTS event_history (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES intelligence_events(event_id)
);

CREATE TABLE IF NOT EXISTS event_confidence (
  event_id TEXT PRIMARY KEY,
  source_reliability REAL NOT NULL CHECK (source_reliability >= 0 AND source_reliability <= 1),
  verification_score REAL NOT NULL CHECK (verification_score >= 0 AND verification_score <= 1),
  severity_score REAL NOT NULL CHECK (severity_score >= 0 AND severity_score <= 1),
  market_impact_score REAL NOT NULL CHECK (market_impact_score >= 0 AND market_impact_score <= 1),
  freshness_score REAL NOT NULL CHECK (freshness_score >= 0 AND freshness_score <= 1),
  evidence_score REAL NOT NULL CHECK (evidence_score >= 0 AND evidence_score <= 1),
  scoring_version TEXT NOT NULL,
  explanation TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES intelligence_events(event_id)
);

CREATE TABLE IF NOT EXISTS intelligence_relationships (
  id TEXT PRIMARY KEY,
  from_theme TEXT NOT NULL,
  to_theme TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  explanation TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_intelligence_relationships_from
  ON intelligence_relationships(from_theme, enabled);

INSERT OR IGNORE INTO event_categories (id, name, description) VALUES
  ('category_economic', 'Economic', 'Broad economic indicators, growth, labor, inflation, and demand signals.'),
  ('category_monetary_policy', 'Monetary Policy', 'Central-bank policy, interest-rate expectations, liquidity, and guidance.'),
  ('category_corporate', 'Corporate', 'Company-specific operational, strategic, financing, or management information.'),
  ('category_earnings', 'Earnings', 'Company earnings, guidance, revenue, margin, and analyst-day information.'),
  ('category_dividend', 'Dividend', 'Dividend declarations, cuts, increases, sustainability, and payout policy.'),
  ('category_commodity', 'Commodity', 'Commodity supply, demand, inventories, production, and pricing pressure.'),
  ('category_energy', 'Energy', 'Oil, gas, power, renewable energy, refining, and energy infrastructure.'),
  ('category_geopolitical', 'Geopolitical', 'International conflict, sanctions, trade restrictions, and political risk.'),
  ('category_regulatory', 'Regulatory', 'Government, agency, legal, compliance, and rulemaking information.'),
  ('category_supply_chain', 'Supply Chain', 'Production, logistics, shipping, supplier, inventory, and bottleneck information.'),
  ('category_technology', 'Technology', 'Technology adoption, infrastructure, semiconductors, software, AI, and cloud trends.'),
  ('category_healthcare', 'Healthcare', 'Healthcare policy, biotech, pharma, medtech, insurers, and clinical/regulatory signals.'),
  ('category_financial', 'Financial', 'Banks, credit, lending, capital markets, insurance, and financial-system signals.'),
  ('category_natural_disaster', 'Natural Disaster', 'Weather, earthquakes, fires, floods, and other natural disruptions.');

INSERT OR IGNORE INTO event_sources (id, name, source_type, reliability_score, notes) VALUES
  ('source_government', 'Government', 'official', 0.92, 'Configurable default for official government releases.'),
  ('source_federal_reserve', 'Federal Reserve', 'official', 0.96, 'Configurable default for Federal Reserve releases, speeches, and policy materials.'),
  ('source_sec', 'SEC', 'official_filing', 0.95, 'Configurable default for SEC filings and official regulatory records.'),
  ('source_company_filings', 'Company filings', 'official_filing', 0.93, 'Configurable default for company filings and official disclosures.'),
  ('source_reuters', 'Reuters', 'newswire', 0.86, 'Configurable default for major wire-service reporting.'),
  ('source_associated_press', 'Associated Press', 'newswire', 0.84, 'Configurable default for major wire-service reporting.'),
  ('source_major_financial_publications', 'Major financial publications', 'publication', 0.78, 'Configurable default for established financial publications.'),
  ('source_issuer_press_releases', 'Issuer press releases', 'issuer', 0.72, 'Configurable default for issuer-produced announcements.'),
  ('source_unknown_blogs', 'Unknown blogs', 'blog', 0.25, 'Configurable default for unverified blogs or unknown publishers.'),
  ('source_anonymous_social_media', 'Anonymous social media', 'social', 0.12, 'Configurable default for anonymous or unattributed social posts.'),
  ('source_kairox_sample_fixture', 'Kairox sample fixture', 'sample', 0.50, 'Development-only deterministic sample source. Not current news.');

INSERT OR IGNORE INTO intelligence_relationships (id, from_theme, to_theme, relationship_type, explanation) VALUES
  ('rel_oil_energy', 'Oil', 'Energy', 'cost_chain', 'Oil supply and price changes can affect energy producers, refiners, and input costs.'),
  ('rel_energy_transportation', 'Energy', 'Transportation', 'cost_chain', 'Fuel costs can affect transportation margins and pricing.'),
  ('rel_transportation_airlines', 'Transportation', 'Airlines', 'sector_chain', 'Airlines are sensitive to transportation fuel and demand conditions.'),
  ('rel_energy_inflation', 'Energy', 'Inflation', 'macro_chain', 'Energy price pressure can feed headline inflation.'),
  ('rel_inflation_interest_rates', 'Inflation', 'Interest Rates', 'policy_chain', 'Persistent inflation can influence interest-rate expectations.'),
  ('rel_interest_rates_banks', 'Interest Rates', 'Banks', 'financial_chain', 'Rates can affect bank net interest margins and credit demand.'),
  ('rel_interest_rates_housing', 'Interest Rates', 'Housing', 'macro_chain', 'Higher rates can reduce housing affordability and activity.'),
  ('rel_semiconductor_demand_chip_manufacturers', 'Semiconductor demand', 'Chip manufacturers', 'demand_chain', 'Semiconductor demand can affect chip manufacturer revenue expectations.'),
  ('rel_chip_ai_infrastructure', 'Chip manufacturers', 'AI infrastructure', 'technology_chain', 'Chip availability affects AI infrastructure buildout.'),
  ('rel_ai_cloud_providers', 'AI infrastructure', 'Cloud providers', 'technology_chain', 'AI infrastructure demand can flow into cloud providers.'),
  ('rel_cloud_data_centers', 'Cloud providers', 'Data centers', 'infrastructure_chain', 'Cloud growth can increase data-center demand.'),
  ('rel_data_centers_technology_etfs', 'Data centers', 'Technology ETFs', 'asset_chain', 'Data-center and AI infrastructure themes can affect technology ETFs.');

INSERT OR IGNORE INTO intelligence_events (
  event_id, event_timestamp, title, summary, primary_category_id, secondary_category_id,
  source_id, source_url, country, affected_regions_json, affected_asset_classes_json,
  affected_symbols_json, potential_duration, immediate_impact, downstream_impacts_json,
  severity, confidence, status, verification_count, sample_data
) VALUES
  (
    'sample_event_energy_transport_inflation',
    '2026-01-02T14:00:00.000Z',
    'Sample Fixture: Energy supply pressure could affect transportation and inflation',
    'Development fixture showing how an energy event can map through transportation, inflation, rates, banks, and housing. This is not current news.',
    'category_energy',
    'category_economic',
    'source_kairox_sample_fixture',
    NULL,
    'US',
    '["United States","Global"]',
    '["commodity","energy","stock","etf"]',
    '["BND","SPY","VTI"]',
    'multi_week',
    'Potential cost pressure for transportation-sensitive sectors.',
    '["Inflation expectations could rise","Interest-rate expectations could shift","Bank and housing sensitivity could increase"]',
    0.62,
    0.70,
    'sample',
    2,
    1
  ),
  (
    'sample_event_semiconductor_ai_cloud',
    '2026-01-03T14:00:00.000Z',
    'Sample Fixture: Semiconductor demand could support AI infrastructure themes',
    'Development fixture showing semiconductor demand mapping into chip manufacturers, AI infrastructure, cloud providers, data centers, and technology ETFs. This is not current news.',
    'category_technology',
    'category_supply_chain',
    'source_kairox_sample_fixture',
    NULL,
    'US',
    '["United States","Asia","Global"]',
    '["stock","etf"]',
    '["SOXX","QQQ","MSFT","AAPL"]',
    'multi_month',
    'Potential support for technology and semiconductor-related assets.',
    '["Cloud capital spending may rise","Data-center demand may strengthen","Technology ETF concentration risk may increase"]',
    0.58,
    0.68,
    'sample',
    2,
    1
  ),
  (
    'sample_event_policy_rate_sensitivity',
    '2026-01-04T14:00:00.000Z',
    'Sample Fixture: Monetary-policy uncertainty could affect bonds and growth assets',
    'Development fixture showing how rate expectations can affect bonds, growth ETFs, banks, housing, and portfolio risk. This is not current news.',
    'category_monetary_policy',
    'category_financial',
    'source_kairox_sample_fixture',
    NULL,
    'US',
    '["United States"]',
    '["bond_fund","stock","etf","reit"]',
    '["BND","QQQ","SPY","O"]',
    'multi_week',
    'Potential valuation pressure for rate-sensitive assets.',
    '["Bond prices may move with yields","Growth assets may reprice","REIT financing sensitivity may increase"]',
    0.55,
    0.66,
    'sample',
    2,
    1
  );

INSERT OR IGNORE INTO asset_impacts (id, event_id, asset_class, symbol, impact_direction, impact_magnitude, rationale) VALUES
  ('impact_sample_energy_bnd', 'sample_event_energy_transport_inflation', 'bond_fund', 'BND', 'mixed', 0.45, 'Inflation pressure can affect rate expectations and bond prices.'),
  ('impact_sample_energy_spy', 'sample_event_energy_transport_inflation', 'etf', 'SPY', 'mixed', 0.35, 'Broad-market ETFs can be affected by inflation and margin pressure.'),
  ('impact_sample_semi_soxx', 'sample_event_semiconductor_ai_cloud', 'etf', 'SOXX', 'positive', 0.58, 'Semiconductor demand may support chip-related ETFs.'),
  ('impact_sample_semi_qqq', 'sample_event_semiconductor_ai_cloud', 'etf', 'QQQ', 'positive', 0.42, 'AI infrastructure demand may support growth-heavy technology ETFs.'),
  ('impact_sample_policy_bnd', 'sample_event_policy_rate_sensitivity', 'bond_fund', 'BND', 'mixed', 0.60, 'Rate expectations are directly relevant to bond-fund pricing.'),
  ('impact_sample_policy_o', 'sample_event_policy_rate_sensitivity', 'reit', 'O', 'mixed', 0.46, 'REITs can be sensitive to financing costs and yield competition.');

INSERT OR IGNORE INTO event_history (id, event_id, status, note) VALUES
  ('history_sample_energy_created', 'sample_event_energy_transport_inflation', 'sample', 'Development fixture inserted for deterministic testing.'),
  ('history_sample_semi_created', 'sample_event_semiconductor_ai_cloud', 'sample', 'Development fixture inserted for deterministic testing.'),
  ('history_sample_policy_created', 'sample_event_policy_rate_sensitivity', 'sample', 'Development fixture inserted for deterministic testing.');

INSERT OR IGNORE INTO event_confidence (
  event_id, source_reliability, verification_score, severity_score,
  market_impact_score, freshness_score, evidence_score, scoring_version, explanation
)
SELECT
  e.event_id,
  s.reliability_score,
  MIN(1.0, e.verification_count / 3.0),
  e.severity,
  COALESCE(MAX(ai.impact_magnitude), 0),
  0.35,
  ROUND(
    (s.reliability_score * 0.30) +
    (MIN(1.0, e.verification_count / 3.0) * 0.20) +
    (e.severity * 0.20) +
    (COALESCE(MAX(ai.impact_magnitude), 0) * 0.20) +
    (0.35 * 0.10),
    4
  ),
  'deterministic_v1',
  'Sample fixture evidence score from configurable source reliability, verification count, severity, potential market impact, and freshness.'
FROM intelligence_events e
JOIN event_sources s ON s.id = e.source_id
LEFT JOIN asset_impacts ai ON ai.event_id = e.event_id
WHERE e.sample_data = 1
GROUP BY e.event_id, s.reliability_score, e.verification_count, e.severity;
