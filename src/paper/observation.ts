import { EventBus } from "../events/eventBus.ts";
import { listEnabledWatchlistAssets } from "../market/assets.ts";
import { MarketDataService, type MarketDataSnapshot } from "../market/service.ts";
import { listPortfolioProfiles, type PortfolioProfile } from "../portfolio/profiles.ts";
import { generateFounderReport, type FounderReportInput, type FounderReportProfileInput } from "../reports/founderReport.ts";
import { listRows } from "../shared/db.ts";
import type { Env } from "../shared/types.ts";
import { recoverPaperStrategyRunFromPersistedWork, runPaperStrategy, type PaperRunBudget, type PaperRunOptions } from "./service.ts";

export type ObservationRunStatus = "queued" | "running" | "completed" | "no_action" | "failed" | "partial_failure" | "abandoned";
export type ObservationChildStatus = "queued" | "running" | "completed" | "no_action" | "failed" | "abandoned";

export interface RequestBudgetCounters {
  outboundProviderRequests: number;
  d1Reads: number;
  d1Writes: number;
  d1Batches: number;
  cacheHits: number;
  cacheMisses: number;
  profilesProcessed: number;
  symbolsProcessed: number;
  retries: number;
  fallbacks: number;
}

export interface PaperObservationRun {
  id: string;
  runKey: string;
  observationWindow: string;
  status: ObservationRunStatus;
  marketDataSnapshotId: string | null;
  profilesTotal: number;
  profilesCompleted: number;
  profilesNoAction: number;
  profilesFailed: number;
  requestBudget: RequestBudgetCounters;
  errorCategory: string | null;
  errorMessage: string | null;
  retryCount: number;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface PaperObservationChildRun {
  id: string;
  parentRunId: string;
  portfolioId: string;
  profileKey: string;
  runKey: string;
  status: ObservationChildStatus;
  summary: FounderReportProfileInput | null;
  requestBudget: RequestBudgetCounters;
  errorCategory: string | null;
  errorMessage: string | null;
  retryCount: number;
  idempotencyKey: string;
  phase: string;
  phaseStartedAt: string | null;
  phaseFinishedAt: string | null;
  heartbeatAt: string | null;
  phaseAttempts: number;
  phaseErrorCategory: string | null;
  phaseErrorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface PaperObservationStartResult {
  parent: PaperObservationRun;
  child?: PaperObservationChildRun | null;
  founderReportId?: string | null;
  staleRecovered: number;
}

const STALE_RUNNING_MS = 20 * 60 * 1000;

const EMPTY_BUDGET: RequestBudgetCounters = {
  outboundProviderRequests: 0,
  d1Reads: 0,
  d1Writes: 0,
  d1Batches: 0,
  cacheHits: 0,
  cacheMisses: 0,
  profilesProcessed: 0,
  symbolsProcessed: 0,
  retries: 0,
  fallbacks: 0
};

interface ParentRow {
  id: string;
  runKey: string;
  observationWindow: string;
  status: ObservationRunStatus;
  marketDataSnapshotId: string | null;
  profilesTotal: number;
  profilesCompleted: number;
  profilesNoAction: number;
  profilesFailed: number;
  requestBudgetJson: string;
  errorCategory: string | null;
  errorMessage: string | null;
  retryCount: number;
  startedAt: string | null;
  finishedAt: string | null;
}

interface ChildRow {
  id: string;
  parentRunId: string;
  portfolioId: string;
  profileKey: string;
  runKey: string;
  status: ObservationChildStatus;
  summaryJson: string | null;
  requestBudgetJson: string;
  errorCategory: string | null;
  errorMessage: string | null;
  retryCount: number;
  idempotencyKey: string;
  phase: string;
  phaseStartedAt: string | null;
  phaseFinishedAt: string | null;
  heartbeatAt: string | null;
  phaseAttempts: number;
  phaseErrorCategory: string | null;
  phaseErrorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export class PaperObservationService {
  private readonly env: Env;
  private readonly db: D1Database;

  constructor(env: Env) {
    this.env = env;
    this.db = env.DB;
  }

  async start(now = new Date(), processOneChild = true): Promise<PaperObservationStartResult> {
    const staleRecovered = await this.reconcileStaleRuns(now);
    const activeParent = await this.nextActiveParent();
    if (activeParent) {
      if (processOneChild) {
        const child = await this.processNextChild(activeParent.id, now);
        const refreshed = await this.getParent(activeParent.id);
        return { parent: refreshed ?? activeParent, child, staleRecovered };
      }
      return { parent: activeParent, child: null, staleRecovered };
    }
    const window = observationWindow(now);
    const runKey = `paper_observation:${window}`;
    const existing = await this.getParentByRunKey(runKey);
    const parent = existing ?? await this.createParent(runKey, window, now);
    if (processOneChild && parent.status !== "completed" && parent.status !== "failed" && parent.status !== "partial_failure") {
      const child = await this.processNextChild(parent.id, now);
      const refreshed = await this.getParent(parent.id);
      return { parent: refreshed ?? parent, child, staleRecovered };
    }
    return { parent, child: null, staleRecovered };
  }

  async processNextChild(parentId?: string, now = new Date()): Promise<PaperObservationChildRun | null> {
    await this.reconcileStaleRuns(now);
    const parent = parentId ? await this.getParent(parentId) : await this.nextActiveParent();
    if (!parent || parent.status === "completed" || parent.status === "failed" || parent.status === "partial_failure") {
      return null;
    }
    if (await this.hasRunningChild(parent.id)) {
      return null;
    }
    const child = await this.nextQueuedChild(parent.id);
    if (!child) {
      await this.finalizeParent(parent.id, now);
      return null;
    }
    return this.runChild(parent, child, now);
  }

  async reconcileStaleRuns(now = new Date(), staleMs = STALE_RUNNING_MS): Promise<number> {
    const cutoff = new Date(now.getTime() - staleMs).toISOString();
    const message = "Observation run exceeded the Worker execution budget or did not reach a terminal state.";
    const staleChildren = await listRows<ChildRow>(
      this.db.prepare(`${CHILD_SELECT} WHERE status = 'running' AND COALESCE(heartbeat_at, started_at) < ? ORDER BY created_at ASC`).bind(cutoff)
    );
    let recoveredOrFailed = 0;
    for (const childRow of staleChildren) {
      const child = mapChild(childRow);
      if (await this.recoverRunningChild(child, now)) {
        recoveredOrFailed += 1;
        continue;
      }
      const childResult = await this.db.prepare(
        `UPDATE paper_observation_profile_runs
         SET status = 'failed', phase = 'failed', phase_finished_at = ?, heartbeat_at = ?,
           error_category = 'stale_running', error_message = ?, phase_error_category = 'stale_running',
           phase_error_message = ?, finished_at = ?, updated_at = datetime('now')
         WHERE id = ? AND status = 'running'`
      ).bind(now.toISOString(), now.toISOString(), message, message, now.toISOString(), child.id).run();
      recoveredOrFailed += Number(childResult.meta?.changes ?? 0);
    }
    return recoveredOrFailed;
  }

  private async createParent(runKey: string, window: string, now: Date): Promise<PaperObservationRun> {
    const profiles = await listPortfolioProfiles(this.db, { includeReadOnly: false });
    const symbols = await this.uniqueSymbols(profiles);
    const marketData = new MarketDataService(this.db);
    const snapshot = await marketData.createSnapshot(symbols, "proposal", now);
    const parentId = `paper_observation_${hashText(runKey)}`;
    const budget = {
      ...EMPTY_BUDGET,
      outboundProviderRequests: symbols.length,
      d1Reads: profiles.length + 1,
      d1Writes: 1,
      d1Batches: 1,
      cacheMisses: symbols.length
    };
    await this.db.prepare(
      `INSERT OR IGNORE INTO paper_observation_runs (
        id, run_key, observation_window, status, market_data_snapshot_id, profiles_total,
        request_budget_json, started_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'running', ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(parentId, runKey, window, snapshot.id, profiles.length, JSON.stringify(budget), now.toISOString()).run();
    await this.insertChildren(parentId, runKey, profiles, now);
    await new EventBus(this.db).publish({
      eventType: "PaperObservation.Started",
      correlationId: parentId,
      sourceService: "PaperObservationService",
      payload: { parentRunId: parentId, runKey, profileCount: profiles.length, symbolCount: symbols.length, marketDataSnapshotId: snapshot.id },
      occurredAt: now
    });
    return (await this.getParent(parentId)) as PaperObservationRun;
  }

  private async insertChildren(parentId: string, parentRunKey: string, profiles: PortfolioProfile[], now: Date): Promise<void> {
    if (profiles.length === 0) return;
    await this.db.batch(profiles.map((profile) => {
      const runKey = `${parentRunKey}:${profile.profileKey}`;
      return this.db.prepare(
        `INSERT OR IGNORE INTO paper_observation_profile_runs (
          id, parent_run_id, portfolio_id, profile_key, run_key, status, idempotency_key,
          request_budget_json, phase, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, 'queued', datetime('now'), datetime('now'))`
      ).bind(
        `paper_observation_child_${hashText(runKey)}`,
        parentId,
        profile.portfolioId,
        profile.profileKey,
        runKey,
        `paper-observation:${runKey}`,
        JSON.stringify(EMPTY_BUDGET)
      );
    }));
  }

  private async runChild(parent: PaperObservationRun, child: PaperObservationChildRun, now: Date): Promise<PaperObservationChildRun> {
    const claim = await this.db.prepare(
      `UPDATE paper_observation_profile_runs
       SET status = 'running', retry_count = retry_count + CASE WHEN started_at IS NULL THEN 0 ELSE 1 END,
         phase = 'evaluate', phase_attempts = phase_attempts + 1, phase_started_at = ?,
         heartbeat_at = ?, started_at = COALESCE(started_at, ?), updated_at = datetime('now')
       WHERE id = ? AND status = 'queued'`
    ).bind(now.toISOString(), now.toISOString(), now.toISOString(), child.id).run();
    if (Number(claim.meta?.changes ?? 0) !== 1) {
      return (await this.getChild(child.id)) ?? child;
    }
    const snapshot = parent.marketDataSnapshotId ? await new MarketDataService(this.db).getSnapshot(parent.marketDataSnapshotId) : null;
    const budget: PaperRunBudget = { ...EMPTY_BUDGET, profilesProcessed: 1 };
    try {
      const summary = await runPaperStrategy(this.env, {
        trigger: "scheduled",
        runKey: child.runKey,
        now,
        allowExecution: true,
        portfolioId: child.portfolioId,
        marketDataSnapshot: snapshot ?? undefined,
        budget,
        runMaintenance: false,
        onProgress: async (progress) => {
          await this.recordChildProgress(child.id, progress.phase, budget);
        }
      } satisfies PaperRunOptions) as FounderReportProfileInput;
      const status: ObservationChildStatus = childStatusFromSummary(summary);
      await this.db.prepare(
        `UPDATE paper_observation_profile_runs
         SET status = ?, phase = 'finalized', summary_json = ?, request_budget_json = ?,
           phase_finished_at = ?, heartbeat_at = ?, error_category = NULL, error_message = NULL,
           phase_error_category = NULL, phase_error_message = NULL, finished_at = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).bind(status, JSON.stringify(summary), JSON.stringify(budget), now.toISOString(), now.toISOString(), now.toISOString(), child.id).run();
      await new EventBus(this.db).publish({
        eventType: "PaperObservation.ProfileCompleted",
        correlationId: parent.id,
        portfolioId: child.portfolioId,
        sourceService: "PaperObservationService",
        payload: { parentRunId: parent.id, childRunId: child.id, status, budget },
        occurredAt: now
      });
    } catch (error) {
      await this.db.prepare(
        `UPDATE paper_observation_profile_runs
         SET status = 'failed', phase = 'failed', request_budget_json = ?,
           error_category = ?, error_message = ?, phase_error_category = ?, phase_error_message = ?,
           phase_finished_at = ?, heartbeat_at = ?, finished_at = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).bind(
        JSON.stringify(budget),
        errorCategory(error),
        safeErrorMessage(error),
        errorCategory(error),
        safeErrorMessage(error),
        now.toISOString(),
        now.toISOString(),
        now.toISOString(),
        child.id
      ).run();
    }
    await this.finalizeParent(parent.id, now);
    return (await this.getChild(child.id)) as PaperObservationChildRun;
  }

  private async recoverRunningChild(child: PaperObservationChildRun, now: Date): Promise<boolean> {
    if (!child.startedAt) return false;
    const parent = await this.getParent(child.parentRunId);
    if (!parent) return false;
    const expectedSymbols = (await listEnabledWatchlistAssets(this.db, child.portfolioId)).length;
    const budget: PaperRunBudget = { ...child.requestBudget, profilesProcessed: Math.max(1, child.requestBudget.profilesProcessed) };
    const summary = await recoverPaperStrategyRunFromPersistedWork(this.env, {
      runKey: child.runKey,
      portfolioId: child.portfolioId,
      startedAt: child.startedAt,
      now,
      expectedSymbols,
      budget
    }) as FounderReportProfileInput | null;
    if (!summary) return false;
    const status: ObservationChildStatus = childStatusFromSummary(summary);
    await this.db.prepare(
      `UPDATE paper_observation_profile_runs
       SET status = ?, phase = 'recovered_finalized', summary_json = ?, request_budget_json = ?,
         phase_finished_at = ?, heartbeat_at = ?, error_category = NULL, error_message = NULL,
         phase_error_category = NULL, phase_error_message = NULL, finished_at = ?, updated_at = datetime('now')
       WHERE id = ? AND status = 'running'`
    ).bind(status, JSON.stringify(summary), JSON.stringify(budget), now.toISOString(), now.toISOString(), now.toISOString(), child.id).run();
    await new EventBus(this.db).publish({
      eventType: "PaperObservation.ProfileRecovered",
      correlationId: parent.id,
      portfolioId: child.portfolioId,
      sourceService: "PaperObservationService",
      payload: { parentRunId: parent.id, childRunId: child.id, status, phase: "recovered_finalized", budget },
      occurredAt: now
    });
    await this.finalizeParent(parent.id, now);
    return true;
  }

  private async recordChildProgress(childId: string, phase: string, budget: PaperRunBudget): Promise<void> {
    budget.d1Writes += 1;
    await this.db.prepare(
      `UPDATE paper_observation_profile_runs
       SET phase = ?, heartbeat_at = ?, request_budget_json = ?, updated_at = datetime('now')
       WHERE id = ? AND status = 'running'`
    ).bind(phase, new Date().toISOString(), JSON.stringify(budget), childId).run();
  }

  private async finalizeParent(parentId: string, now: Date): Promise<void> {
    const children = await this.children(parentId);
    if (children.length === 0 || children.some((child) => child.status === "queued" || child.status === "running")) {
      return;
    }
    const completed = children.filter((child) => child.status === "completed").length;
    const noAction = children.filter((child) => child.status === "no_action").length;
    const failed = children.filter((child) => child.status === "failed" || child.status === "abandoned").length;
    const status: ObservationRunStatus = failed > 0 ? (completed + noAction > 0 ? "partial_failure" : "failed") : completed > 0 ? "completed" : "no_action";
    const budget = children.reduce<RequestBudgetCounters>((sum, child) => addBudget(sum, child.requestBudget), { ...EMPTY_BUDGET });
    await this.db.prepare(
      `UPDATE paper_observation_runs
       SET status = ?, profiles_completed = ?, profiles_no_action = ?, profiles_failed = ?,
         request_budget_json = ?, finished_at = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).bind(status, completed, noAction, failed, JSON.stringify(budget), now.toISOString(), parentId).run();
    const parent = await this.getParent(parentId);
    if (!parent) return;
    const reportInput: FounderReportInput = {
      runKey: parent.runKey,
      status,
      automationPaused: false,
      profiles: children.map((child) => ({
        ...(child.summary ?? {
          profile: { portfolioId: child.portfolioId, profileKey: child.profileKey, displayName: child.profileKey },
          symbols: child.errorMessage ? [{ symbol: "profile", action: "DO_NOTHING", executed: false, reason: child.errorMessage }] : []
        }),
        status: child.status,
        errorCategory: child.errorCategory,
        errorMessage: child.errorMessage
      }))
    };
    const report = await generateFounderReport(this.db, reportInput, now);
    await new EventBus(this.db).publish({
      eventType: "PaperObservation.Completed",
      correlationId: parentId,
      sourceService: "PaperObservationService",
      payload: { parentRunId: parentId, status, completed, noAction, failed, founderReportId: report.id, budget },
      occurredAt: now
    });
  }

  private async uniqueSymbols(profiles: PortfolioProfile[]): Promise<string[]> {
    const symbols = new Set<string>();
    for (const profile of profiles) {
      const assets = await listEnabledWatchlistAssets(this.db, profile.portfolioId);
      for (const asset of assets) symbols.add(asset.providerSymbol);
    }
    return [...symbols].sort();
  }

  private async getParentByRunKey(runKey: string): Promise<PaperObservationRun | null> {
    const row = await this.db.prepare(`${PARENT_SELECT} WHERE run_key = ?`).bind(runKey).first<ParentRow>();
    return row ? mapParent(row) : null;
  }

  private async getParent(id: string): Promise<PaperObservationRun | null> {
    const row = await this.db.prepare(`${PARENT_SELECT} WHERE id = ?`).bind(id).first<ParentRow>();
    return row ? mapParent(row) : null;
  }

  private async nextActiveParent(): Promise<PaperObservationRun | null> {
    const row = await this.db.prepare(`${PARENT_SELECT} WHERE status IN ('running', 'queued') ORDER BY created_at ASC LIMIT 1`).first<ParentRow>();
    return row ? mapParent(row) : null;
  }

  private async nextQueuedChild(parentId: string): Promise<PaperObservationChildRun | null> {
    const row = await this.db.prepare(`${CHILD_SELECT} WHERE parent_run_id = ? AND status = 'queued' ORDER BY created_at ASC LIMIT 1`).bind(parentId).first<ChildRow>();
    return row ? mapChild(row) : null;
  }

  private async hasRunningChild(parentId: string): Promise<boolean> {
    const row = await this.db.prepare("SELECT id FROM paper_observation_profile_runs WHERE parent_run_id = ? AND status = 'running' LIMIT 1").bind(parentId).first<{ id: string }>();
    return !!row;
  }

  private async getChild(id: string): Promise<PaperObservationChildRun | null> {
    const row = await this.db.prepare(`${CHILD_SELECT} WHERE id = ?`).bind(id).first<ChildRow>();
    return row ? mapChild(row) : null;
  }

  private async children(parentId: string): Promise<PaperObservationChildRun[]> {
    const rows = await listRows<ChildRow>(this.db.prepare(`${CHILD_SELECT} WHERE parent_run_id = ? ORDER BY created_at ASC`).bind(parentId));
    return rows.map(mapChild);
  }
}

function childStatusFromSummary(summary: FounderReportProfileInput): ObservationChildStatus {
  const symbols = summary.symbols ?? [];
  if (symbols.some((symbol) => symbol.executed)) return "completed";
  return "no_action";
}

function addBudget(left: RequestBudgetCounters, right: RequestBudgetCounters): RequestBudgetCounters {
  return {
    outboundProviderRequests: left.outboundProviderRequests + right.outboundProviderRequests,
    d1Reads: left.d1Reads + right.d1Reads,
    d1Writes: left.d1Writes + right.d1Writes,
    d1Batches: left.d1Batches + right.d1Batches,
    cacheHits: left.cacheHits + right.cacheHits,
    cacheMisses: left.cacheMisses + right.cacheMisses,
    profilesProcessed: left.profilesProcessed + right.profilesProcessed,
    symbolsProcessed: left.symbolsProcessed + right.symbolsProcessed,
    retries: left.retries + right.retries,
    fallbacks: left.fallbacks + right.fallbacks
  };
}

function observationWindow(now: Date): string {
  return now.toISOString().slice(0, 16);
}

function errorCategory(error: unknown): string {
  const message = safeErrorMessage(error);
  if (/market|quote|provider|fetch|request/i.test(message)) return "market_data";
  if (/D1|database|SQL/i.test(message)) return "database";
  if (/risk|policy|cash|limit/i.test(message)) return "policy";
  return "unknown";
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown paper observation error").replace(/\s+/g, " ").slice(0, 500);
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapParent(row: ParentRow): PaperObservationRun {
  return {
    id: row.id,
    runKey: row.runKey,
    observationWindow: row.observationWindow,
    status: row.status,
    marketDataSnapshotId: row.marketDataSnapshotId,
    profilesTotal: Number(row.profilesTotal),
    profilesCompleted: Number(row.profilesCompleted),
    profilesNoAction: Number(row.profilesNoAction),
    profilesFailed: Number(row.profilesFailed),
    requestBudget: parseJson(row.requestBudgetJson, EMPTY_BUDGET),
    errorCategory: row.errorCategory,
    errorMessage: row.errorMessage,
    retryCount: Number(row.retryCount),
    startedAt: row.startedAt,
    finishedAt: row.finishedAt
  };
}

function mapChild(row: ChildRow): PaperObservationChildRun {
  return {
    id: row.id,
    parentRunId: row.parentRunId,
    portfolioId: row.portfolioId,
    profileKey: row.profileKey,
    runKey: row.runKey,
    status: row.status,
    summary: parseJson<FounderReportProfileInput | null>(row.summaryJson, null),
    requestBudget: parseJson(row.requestBudgetJson, EMPTY_BUDGET),
    errorCategory: row.errorCategory,
    errorMessage: row.errorMessage,
    retryCount: Number(row.retryCount),
    idempotencyKey: row.idempotencyKey,
    phase: row.phase,
    phaseStartedAt: row.phaseStartedAt,
    phaseFinishedAt: row.phaseFinishedAt,
    heartbeatAt: row.heartbeatAt,
    phaseAttempts: Number(row.phaseAttempts),
    phaseErrorCategory: row.phaseErrorCategory,
    phaseErrorMessage: row.phaseErrorMessage,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt
  };
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

const PARENT_SELECT = `SELECT id, run_key AS runKey, observation_window AS observationWindow,
  status, market_data_snapshot_id AS marketDataSnapshotId, profiles_total AS profilesTotal,
  profiles_completed AS profilesCompleted, profiles_no_action AS profilesNoAction,
  profiles_failed AS profilesFailed, request_budget_json AS requestBudgetJson,
  error_category AS errorCategory, error_message AS errorMessage, retry_count AS retryCount,
  started_at AS startedAt, finished_at AS finishedAt
  FROM paper_observation_runs`;

const CHILD_SELECT = `SELECT id, parent_run_id AS parentRunId, portfolio_id AS portfolioId,
  profile_key AS profileKey, run_key AS runKey, status, summary_json AS summaryJson,
  request_budget_json AS requestBudgetJson, error_category AS errorCategory,
  error_message AS errorMessage, retry_count AS retryCount, idempotency_key AS idempotencyKey,
  phase, phase_started_at AS phaseStartedAt, phase_finished_at AS phaseFinishedAt,
  heartbeat_at AS heartbeatAt, phase_attempts AS phaseAttempts,
  phase_error_category AS phaseErrorCategory, phase_error_message AS phaseErrorMessage,
  started_at AS startedAt, finished_at AS finishedAt
  FROM paper_observation_profile_runs`;
