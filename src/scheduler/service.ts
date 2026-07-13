import { runPaperStrategy } from "../paper/service.ts";
import { recordEquityHistory } from "../portfolio/performance.ts";
import { listPortfolioProfiles } from "../portfolio/profiles.ts";
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
    const storedSummary = {
      runKey,
      status: "completed",
      automationPaused: settings.automationPaused,
      profiles: profileSummaries
    };
    await finishScheduledRun(env.DB, runKey, "completed", JSON.stringify(storedSummary), null);
    return storedSummary;
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
  return {
    scheduledRuns: await listRows(
      db.prepare(
        `SELECT id, run_key AS runKey, cron, scheduled_at AS scheduledAt,
          started_at AS startedAt, finished_at AS finishedAt, status,
          error_details AS errorDetails, summary_json AS summaryJson, created_at AS createdAt
         FROM scheduled_runs
         ORDER BY started_at DESC
         LIMIT 50`
      )
    )
  };
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
