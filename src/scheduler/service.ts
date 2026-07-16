import { runPaperStrategy } from "../paper/service.ts";
import { PaperObservationService } from "../paper/observation.ts";
import { recordEquityHistory } from "../portfolio/performance.ts";
import { listPortfolioProfiles } from "../portfolio/profiles.ts";
import { generateFounderReport, type FounderReportInput, type FounderReportProfileInput } from "../reports/founderReport.ts";
import { getSettings } from "../settings/service.ts";
import { listRows } from "../shared/db.ts";
import type { Env } from "../shared/types.ts";
import { generateSummaries } from "../summaries/service.ts";

const OVERLAP_WINDOW_MS = 15 * 60 * 1000;

export async function runScheduledPaperStrategy(
  env: Env,
  cron: string,
  scheduledAt = new Date().toISOString()
): Promise<unknown> {
  return runScheduledPaperObservation(env, scheduledAt);
}

export async function runScheduledPaperObservation(env: Env, scheduledAt = new Date().toISOString()): Promise<unknown> {
  const service = new PaperObservationService(env);
  const scheduledDate = new Date(scheduledAt);
  const continued = await service.processNextChild(undefined, scheduledDate);
  if (continued) {
    return { continued: true, child: continued };
  }
  const started = await service.start(scheduledDate, false);
  const child = await service.processNextChild(started.parent.id, scheduledDate);
  return { ...started, child };
}

export async function reconcileStaleScheduledRuns(
  db: D1Database,
  now = new Date(),
  staleMs = OVERLAP_WINDOW_MS
): Promise<number> {
  const cutoff = new Date(now.getTime() - staleMs).toISOString();
  const message = "Scheduled run exceeded the Worker execution budget or did not reach a terminal state.";
  const result = await db.prepare(
    `UPDATE scheduled_runs
     SET status = 'failed', error_details = ?, finished_at = ?
     WHERE status = 'running' AND started_at < ?`
  ).bind(message, now.toISOString(), cutoff).run();
  return Number(result.meta?.changes ?? 0);
}

async function runLegacyScheduledPaperStrategy(
  env: Env,
  cron: string,
  scheduledAt = new Date().toISOString()
): Promise<unknown> {
  const scheduledDate = new Date(scheduledAt);
  const runKey = buildScheduledRunKey(cron, scheduledDate);
  const existing = await env.DB.prepare("SELECT summary_json AS summaryJson FROM scheduled_runs WHERE run_key = ?")
    .bind(runKey)
    .first<{ summaryJson: string | null }>();
  if (existing) {
    return { idempotent: true, ...(existing.summaryJson ? JSON.parse(existing.summaryJson) : { runKey }) };
  }

  const cutoff = new Date(Date.now() - OVERLAP_WINDOW_MS).toISOString();
  const overlapping = await env.DB
    .prepare("SELECT id, run_key AS runKey FROM scheduled_runs WHERE status = 'running' AND started_at > ? LIMIT 1")
    .bind(cutoff)
    .first<{ id: string; runKey: string }>();

  if (overlapping) {
    const skipped = {
      runKey,
      status: "skipped",
      reason: `Overlapping scheduled run is still active: ${overlapping.runKey}`
    };
    await insertScheduledRun(env.DB, runKey, cron, scheduledDate.toISOString(), "skipped", JSON.stringify(skipped), skipped.reason);
    return skipped;
  }

  await insertScheduledRun(env.DB, runKey, cron, scheduledDate.toISOString(), "running", null, null);

  try {
    const settings = await getSettings(env.DB);
    const profiles = await listPortfolioProfiles(env.DB);
    const profileSummaries = [];
    for (const profile of profiles) {
      const profileRunKey = `${runKey}:${profile.profileKey}`;
      profileSummaries.push(await runPaperStrategy(env, {
        trigger: "scheduled",
        runKey: profileRunKey,
        now: scheduledDate,
        allowExecution: shouldAllowScheduledExecution(settings.automationPaused),
        portfolioId: profile.portfolioId
      }));
      await recordEquityHistory(env.DB, new Date().toISOString(), profile.portfolioId);
    }
    await generateSummaries(env.DB, scheduledDate);
    const storedSummary: FounderReportInput = {
      runKey,
      status: "completed",
      automationPaused: settings.automationPaused,
      profiles: profileSummaries as FounderReportProfileInput[]
    };
    const founderReport = await generateFounderReport(env.DB, storedSummary, scheduledDate);
    await finishScheduledRun(env.DB, runKey, "completed", JSON.stringify(storedSummary), null);
    return { ...storedSummary, founderReportId: founderReport.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scheduled run error";
    await finishScheduledRun(env.DB, runKey, "failed", null, message);
    throw error;
  }
}

export function buildScheduledRunKey(cron: string, scheduledAt: Date): string {
  return `scheduled:${cron}:${scheduledAt.toISOString().slice(0, 16)}`;
}

export function hasOverlappingRun(
  runningStartedAt: string | null,
  now: Date,
  overlapWindowMs = OVERLAP_WINDOW_MS
): boolean {
  if (!runningStartedAt) {
    return false;
  }
  const startedAt = new Date(runningStartedAt).getTime();
  return Number.isFinite(startedAt) && now.getTime() - startedAt < overlapWindowMs;
}

export function shouldAllowScheduledExecution(automationPaused: boolean): boolean {
  return !automationPaused;
}

export async function getScheduledRuns(db: D1Database): Promise<unknown> {
  const rows = await listRows<ScheduledRunRow>(
    db.prepare(
      `SELECT id, run_key AS runKey, cron, scheduled_at AS scheduledAt,
        started_at AS startedAt, finished_at AS finishedAt, status,
        error_details AS errorDetails, summary_json AS summaryJson, created_at AS createdAt
       FROM scheduled_runs
       ORDER BY started_at DESC
       LIMIT 50`
    )
  );
  return {
    scheduledRuns: rows,
    auditRuns: rows.map(summarizeScheduledRun)
  };
}

export interface ScheduledRunRow {
  id: string;
  runKey: string;
  cron: string;
  scheduledAt: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  errorDetails: string | null;
  summaryJson: string | null;
  createdAt: string;
}

interface PaperProfileSummary {
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

interface ScheduledRunSummaryJson {
  runKey?: string;
  status?: string;
  automationPaused?: boolean;
  profiles?: PaperProfileSummary[];
  reason?: string;
}

export function summarizeScheduledRun(row: ScheduledRunRow) {
  const parsed = parseSummary(row.summaryJson);
  const profiles = parsed?.profiles ?? [];
  const profileAudits = profiles.map((profile) => {
    const symbols = profile.symbols ?? [];
    const providerFailures = symbols.filter((symbol) => isProviderFailure(symbol.reason)).length;
    const staleDataRejections = symbols.filter((symbol) => /stale/i.test(symbol.reason)).length;
    const duplicatePrevention = profile.idempotent === true || symbols.some((symbol) => /duplicate|already processed|idempotent/i.test(symbol.reason));
    const safeguardsTriggered = symbols
      .filter((symbol) => isSafeguardReason(symbol.reason))
      .map((symbol) => ({ symbol: symbol.symbol, reason: publicReason(symbol.reason) }));
    const actions = symbols.reduce<Record<string, number>>((counts, symbol) => {
      counts[symbol.action] = (counts[symbol.action] ?? 0) + 1;
      return counts;
    }, {});
    return {
      portfolioId: profile.profile?.portfolioId ?? "unknown",
      profileKey: profile.profile?.profileKey ?? "unknown",
      displayName: profile.profile?.displayName ?? "Unknown profile",
      assetsAttempted: symbols.length,
      assetsEvaluatedSuccessfully: symbols.filter((symbol) => !isProviderFailure(symbol.reason) && !/stale|malformed|unavailable/i.test(symbol.reason)).length,
      assetsSkipped: symbols.filter((symbol) => !symbol.executed).length,
      providerFailures,
      staleDataRejections,
      recommendations: actions,
      tradesCreated: symbols.filter((symbol) => symbol.executed).length,
      duplicatePrevention,
      safeguardsTriggered
    };
  });

  const durationMs = durationBetween(row.startedAt, row.finishedAt);
  return {
    runKey: row.runKey,
    scheduledAt: row.scheduledAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    status: row.status,
    durationMs,
    finalStatus: row.status,
    automationPaused: parsed?.automationPaused ?? null,
    profileCount: profileAudits.length,
    assetsAttempted: profileAudits.reduce((sum, profile) => sum + profile.assetsAttempted, 0),
    assetsEvaluatedSuccessfully: profileAudits.reduce((sum, profile) => sum + profile.assetsEvaluatedSuccessfully, 0),
    assetsSkipped: profileAudits.reduce((sum, profile) => sum + profile.assetsSkipped, 0),
    providerFailures: profileAudits.reduce((sum, profile) => sum + profile.providerFailures, 0),
    staleDataRejections: profileAudits.reduce((sum, profile) => sum + profile.staleDataRejections, 0),
    tradesCreated: profileAudits.reduce((sum, profile) => sum + profile.tradesCreated, 0),
    duplicatePrevention: profileAudits.some((profile) => profile.duplicatePrevention),
    errorDetails: row.errorDetails ? publicReason(row.errorDetails) : null,
    skipReason: parsed?.reason ? publicReason(parsed.reason) : null,
    profiles: profileAudits
  };
}

function parseSummary(value: string | null): ScheduledRunSummaryJson | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as ScheduledRunSummaryJson;
  } catch {
    return null;
  }
}

function durationBetween(startedAt: string, finishedAt: string | null): number | null {
  if (!finishedAt) {
    return null;
  }
  const start = new Date(startedAt).getTime();
  const finish = new Date(finishedAt).getTime();
  return Number.isFinite(start) && Number.isFinite(finish) ? Math.max(0, finish - start) : null;
}

function isProviderFailure(reason: string): boolean {
  return /provider|quote|market data|unavailable|failed|failure|malformed|temporarily unavailable/i.test(reason);
}

function isSafeguardReason(reason: string): boolean {
  return /risk checks|cash|drawdown|concentration|duplicate|market hours|paused|blocked|limit/i.test(reason);
}

function publicReason(reason: string): string {
  return reason.replace(/\s+/g, " ").slice(0, 240);
}

async function insertScheduledRun(
  db: D1Database,
  runKey: string,
  cron: string,
  scheduledAt: string,
  status: "running" | "completed" | "failed" | "skipped",
  summaryJson: string | null,
  errorDetails: string | null
): Promise<void> {
  const startedAt = new Date().toISOString();
  const finishedAt = status === "running" ? null : startedAt;
  await db
    .prepare(
      `INSERT OR IGNORE INTO scheduled_runs (
        id, run_key, cron, scheduled_at, started_at, finished_at, status, summary_json, error_details
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id("scheduled", runKey), runKey, cron, scheduledAt, startedAt, finishedAt, status, summaryJson, errorDetails)
    .run();
}

async function finishScheduledRun(
  db: D1Database,
  runKey: string,
  status: "completed" | "failed",
  summaryJson: string | null,
  errorDetails: string | null
): Promise<void> {
  await db
    .prepare(
      `UPDATE scheduled_runs
       SET status = ?, finished_at = ?, summary_json = ?, error_details = ?
       WHERE run_key = ?`
    )
    .bind(status, new Date().toISOString(), summaryJson, errorDetails, runKey)
    .run();
}

function id(prefix: string, key: string): string {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(16)}`;
}
