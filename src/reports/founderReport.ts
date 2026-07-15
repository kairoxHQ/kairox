import { listRows } from "../shared/db.ts";

export interface FounderReportProfileInput {
  idempotent?: boolean;
  profile?: {
    portfolioId: string;
    profileKey: string;
    displayName: string;
  };
  symbols?: Array<{
    symbol: string;
    action: string;
    executed: boolean;
    reason: string;
  }>;
}

export interface FounderReportInput {
  runKey: string;
  status: string;
  automationPaused: boolean;
  profiles: FounderReportProfileInput[];
}

export interface FounderReport {
  id: string;
  runKey: string;
  reportDate: string;
  title: string;
  body: string;
  facts: {
    status: string;
    automationPaused: boolean;
    profileCount: number;
    assetsEvaluated: number;
    tradesExecuted: number;
    decisionsLogged: number;
    providerFailures: number;
    staleDataRejections: number;
    actionCounts: Record<string, number>;
    safeguards: Array<{ profile: string; symbol: string; reason: string }>;
  };
  createdAt: string;
}

interface FounderReportRow {
  id: string;
  runKey: string;
  reportDate: string;
  title: string;
  body: string;
  factsJson: string;
  createdAt: string;
}

export async function generateFounderReport(
  db: D1Database,
  input: FounderReportInput,
  now = new Date()
): Promise<FounderReport> {
  const report = buildFounderReport(input, now);
  await db
    .prepare(
      `INSERT INTO founder_reports (
        id, run_key, report_date, title, body, facts_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_key) DO UPDATE SET
        title = excluded.title,
        body = excluded.body,
        facts_json = excluded.facts_json,
        created_at = excluded.created_at`
    )
    .bind(report.id, report.runKey, report.reportDate, report.title, report.body, JSON.stringify(report.facts), report.createdAt)
    .run();
  return report;
}

export async function listFounderReports(db: D1Database, limit = 20): Promise<{ reports: FounderReport[] }> {
  const rows = await listRows<FounderReportRow>(
    db.prepare(
      `SELECT id, run_key AS runKey, report_date AS reportDate, title, body,
        facts_json AS factsJson, created_at AS createdAt
       FROM founder_reports
       ORDER BY report_date DESC, created_at DESC
       LIMIT ?`
    ).bind(limit)
  );
  return { reports: rows.map(mapReportRow) };
}

export function buildFounderReport(input: FounderReportInput, now = new Date()): FounderReport {
  const facts = summarizeFacts(input);
  const profileLines = input.profiles.map((profile) => {
    const name = profile.profile?.displayName ?? profile.profile?.profileKey ?? "Unknown profile";
    const symbols = profile.symbols ?? [];
    const trades = symbols.filter((symbol) => symbol.executed);
    const actions = symbols.reduce<Record<string, number>>((counts, symbol) => {
      counts[symbol.action] = (counts[symbol.action] ?? 0) + 1;
      return counts;
    }, {});
    return `${name}: evaluated ${symbols.length} asset${symbols.length === 1 ? "" : "s"}, executed ${trades.length} paper trade${trades.length === 1 ? "" : "s"}, decisions ${formatCounts(actions)}.`;
  });
  const tradeLine = facts.tradesExecuted === 0
    ? "No paper trades executed. DO_NOTHING remained valid where signals, market data, market hours, or risk checks did not clear the bar."
    : `${facts.tradesExecuted} simulated paper trade${facts.tradesExecuted === 1 ? "" : "s"} executed after market-data, policy, and risk checks.`;
  const dataLine = facts.providerFailures + facts.staleDataRejections === 0
    ? "Market data supported the evaluated decisions without recorded provider or stale-data blocks."
    : `Market-data guards blocked ${facts.providerFailures} provider failure${facts.providerFailures === 1 ? "" : "s"} and ${facts.staleDataRejections} stale-data case${facts.staleDataRejections === 1 ? "" : "s"}.`;
  const safeguardLine = facts.safeguards.length === 0
    ? "No additional safety safeguard blocked an otherwise executable paper action."
    : `Safety safeguards recorded ${facts.safeguards.length} block${facts.safeguards.length === 1 ? "" : "s"} across cash, concentration, duplicate-signal, market-hours, or automation controls.`;
  const body = [
    `Autonomous paper cycle ${input.status} for ${input.runKey}.`,
    "Scope: paper simulation only. No live brokerage credentials or live order execution were used.",
    `Automation paused: ${input.automationPaused ? "yes" : "no"}.`,
    ...profileLines,
    tradeLine,
    dataLine,
    safeguardLine,
    `Decisions logged: ${facts.decisionsLogged}. Founder readout generated at ${now.toISOString()}.`
  ].join("\n");
  return {
    id: `founder_report_${hashText(input.runKey)}`,
    runKey: input.runKey,
    reportDate: now.toISOString().slice(0, 10),
    title: `Founder Report: ${input.runKey}`,
    body,
    facts,
    createdAt: now.toISOString()
  };
}

function summarizeFacts(input: FounderReportInput): FounderReport["facts"] {
  const actionCounts: Record<string, number> = {};
  const safeguards: Array<{ profile: string; symbol: string; reason: string }> = [];
  let assetsEvaluated = 0;
  let tradesExecuted = 0;
  let providerFailures = 0;
  let staleDataRejections = 0;
  for (const profile of input.profiles) {
    const profileName = profile.profile?.displayName ?? profile.profile?.profileKey ?? "Unknown profile";
    for (const symbol of profile.symbols ?? []) {
      assetsEvaluated += 1;
      if (symbol.executed) tradesExecuted += 1;
      actionCounts[symbol.action] = (actionCounts[symbol.action] ?? 0) + 1;
      if (/provider|quote|market data|unavailable|failed|failure|malformed/i.test(symbol.reason)) providerFailures += 1;
      if (/stale/i.test(symbol.reason)) staleDataRejections += 1;
      if (/risk checks|cash|drawdown|concentration|duplicate|market hours|paused|blocked|limit/i.test(symbol.reason)) {
        safeguards.push({ profile: profileName, symbol: symbol.symbol, reason: symbol.reason.slice(0, 240) });
      }
    }
  }
  return {
    status: input.status,
    automationPaused: input.automationPaused,
    profileCount: input.profiles.length,
    assetsEvaluated,
    tradesExecuted,
    decisionsLogged: assetsEvaluated,
    providerFailures,
    staleDataRejections,
    actionCounts,
    safeguards
  };
}

function mapReportRow(row: FounderReportRow): FounderReport {
  return {
    id: row.id,
    runKey: row.runKey,
    reportDate: row.reportDate,
    title: row.title,
    body: row.body,
    facts: parseJson(row.factsJson, {
      status: "unknown",
      automationPaused: false,
      profileCount: 0,
      assetsEvaluated: 0,
      tradesExecuted: 0,
      decisionsLogged: 0,
      providerFailures: 0,
      staleDataRejections: 0,
      actionCounts: {},
      safeguards: []
    }),
    createdAt: row.createdAt
  };
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  return entries.length ? entries.map(([key, value]) => `${key} ${value}`).join(", ") : "none";
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
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
