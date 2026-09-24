// Adapted from OpenSEO src/server/workflows/RankCheckWorkflow.ts,
// src/server/workflows/rankCheckPaths.ts,
// src/server/features/rank-tracking/services/rankCheckRunGuards.ts and
// src/server/features/rank-tracking/repositories/runQueries.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local changes: the checking process runs the steps itself and proves it is
// alive with a heartbeat on its run row, replacing the Workflow instance.
// A run whose process died keeps what it checked (completed, with a note) instead
// of being failed with its paid snapshots hidden. A rejected DataForSEO key
// stops the run after its batch instead of failing every remaining keyword.
// Each run records its DataForSEO cost. Plan, credit and telemetry steps are dropped.
import { randomUUID } from "node:crypto";
import { OperationError } from "../../errors.js";
import { transaction, type Store } from "../../store.js";
import { HEARTBEAT_INTERVAL_MS, workerAlive } from "../../worker.js";
import { createDataforseoClient, ledgerCost, type ProviderCall } from "../dataforseo/client.js";
import { DataforseoChargedTaskError } from "../dataforseo/envelope.js";
import type { RankCheckResult, RankCheckTaskInput } from "../dataforseo/serp.js";
import { AppError } from "../platform.js";
import { KEYWORDS_PER_BATCH } from "../shared/rank-tracking.js";
import { getKeywordsForConfig, type RankTrackingConfig } from "./RankTrackingService.js";

type KeywordEntry = { id: string; keyword: string };
type RankCheckResultWithDevice = RankCheckResult & { device: "desktop" | "mobile" };

type RunRow = {
  id: string;
  config_id: string;
  status: "running" | "completed" | "failed";
  keywords_total: number;
  error_message: string | null;
  worker_pid: number | null;
  heartbeat_at: string | null;
};

/** Another process closed this run (its heartbeat looked dead); this one must stop writing. */
export class RunClosed extends OperationError {
  constructor(runId: string) {
    super("input", `Rank check ${runId} was closed by another process; this check stopped`);
  }
}

/** Refresh the run's heartbeat, proving this process still owns the running run. */
function claim(db: Store, runId: string) {
  const result = db
    .prepare(`UPDATE rank_check_runs SET heartbeat_at = ?, worker_pid = ? WHERE id = ? AND status = 'running'`)
    .run(new Date().toISOString(), process.pid, runId);
  if (result.changes === 0) throw new RunClosed(runId);
}

const checkedKeywordCount = (db: Store, runId: string) =>
  (db.prepare(`SELECT COUNT(DISTINCT tracking_keyword_id) AS n FROM rank_snapshots WHERE run_id = ?`).get(runId) as { n: number }).n;

/**
 * Close running checks whose process is gone, freeing the tracker for a new run.
 * Snapshots they already paid for stay visible: such a run completes with a note.
 */
export function closeDeadRuns(db: Store, configId?: string) {
  const running = db
    .prepare(`SELECT * FROM rank_check_runs WHERE status = 'running' AND (? IS NULL OR config_id = ?)`)
    .all(configId ?? null, configId ?? null) as RunRow[];
  for (const run of running.filter((candidate) => !workerAlive(candidate))) {
    const checked = checkedKeywordCount(db, run.id);
    const now = new Date().toISOString();
    const note = `The process running this check exited after checking ${checked} of ${run.keywords_total} keyword(s)`;
    db.prepare(`UPDATE rank_check_runs SET status = ?, keywords_checked = ?, error_message = ?, completed_at = ? WHERE id = ? AND status = 'running'`).run(
      checked > 0 ? "completed" : "failed",
      checked,
      run.error_message ? `${note}: ${run.error_message}` : note,
      now,
      run.id,
    );
    if (checked > 0) db.prepare(`UPDATE rank_tracking_configs SET last_checked_at = ? WHERE id = ?`).run(now, run.config_id);
  }
}

/**
 * Start a run: at most one running check per tracker, enforced by the partial
 * unique index on rank_check_runs, after closing a blocker whose process died.
 */
export function beginRun(db: Store, config: RankTrackingConfig, input: { trigger: "manual" | "scheduled"; keywordIds?: string[] }) {
  return transaction(db, () => {
    closeDeadRuns(db, config.id);
    let keywords: KeywordEntry[] = getKeywordsForConfig(db, config.id);
    if (input.keywordIds && input.keywordIds.length > 0) {
      const known = new Set(keywords.map((kw) => kw.id));
      const unknown = input.keywordIds.filter((id) => !known.has(id));
      if (unknown.length > 0) throw new AppError("VALIDATION_ERROR", `Unknown keyword id(s) for tracker ${config.id}: ${unknown.join(", ")}`);
      const wanted = new Set(input.keywordIds);
      keywords = keywords.filter((kw) => wanted.has(kw.id));
    }
    if (keywords.length === 0) throw new AppError("VALIDATION_ERROR", `No keywords to track. Add keywords with agenticseo rank add ${config.id} KEYWORD...`);

    const blocker = db.prepare(`SELECT id, worker_pid FROM rank_check_runs WHERE config_id = ? AND status = 'running'`).get(config.id) as
      | { id: string; worker_pid: number | null }
      | undefined;
    if (blocker) {
      throw new AppError("VALIDATION_ERROR", `A rank check is already running for tracker ${config.id} (run ${blocker.id}, process ${blocker.worker_pid ?? "unknown"})`);
    }
    const runId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO rank_check_runs (id, config_id, status, trigger, keywords_total, is_subset_run, worker_pid, heartbeat_at, started_at) VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?)`,
    ).run(runId, config.id, input.trigger, keywords.length, input.keywordIds?.length ? 1 : 0, process.pid, now, now);
    return { runId, keywords: keywords.map((kw) => ({ id: kw.id, keyword: kw.keyword })) };
  });
}

/** Expand keywords into one task input per keyword/device pair. */
export function expandToTaskInputs(keywords: KeywordEntry[], devices: RankTrackingConfig["devices"]): RankCheckTaskInput[] {
  const deviceList: Array<"desktop" | "mobile"> = devices === "both" ? ["desktop", "mobile"] : [devices];
  return keywords.flatMap((kw) => deviceList.map((device) => ({ keyword: kw.keyword, keywordId: kw.id, device })));
}

/** One run's DataForSEO spending, including failed calls that were still charged. */
export class RunLedger {
  readonly calls: ProviderCall[] = [];
  private chargedFailuresUsd = 0;
  readonly client = createDataforseoClient(this.calls);
  charged(error: unknown) {
    if (error instanceof DataforseoChargedTaskError) this.chargedFailuresUsd += error.billing.costUsd;
  }
  get costUsd() {
    return Math.round((ledgerCost(this.calls) + this.chargedFailuresUsd) * 1e6) / 1e6;
  }
}

/** Persist completed results in one transaction with the ownership check and progress. */
export function saveSnapshots(db: Store, runId: string, results: RankCheckResultWithDevice[], input: { firstError: string | null; costUsd: number }) {
  transaction(db, () => {
    claim(db, runId);
    const insert = db.prepare(
      `INSERT OR IGNORE INTO rank_snapshots (run_id, tracking_keyword_id, keyword, device, position, url, serp_features, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = new Date().toISOString();
    for (const r of results) {
      insert.run(runId, r.keywordId, r.keyword, r.device, r.position, r.url, r.serpFeatures.length > 0 ? JSON.stringify(r.serpFeatures) : null, now);
    }
    // First rejection wins, so a failed run shows the vendor's reason rather than a count.
    if (input.firstError) db.prepare(`UPDATE rank_check_runs SET error_message = ? WHERE id = ? AND error_message IS NULL`).run(input.firstError, runId);
    db.prepare(`UPDATE rank_check_runs SET keywords_checked = ?, cost_usd = ? WHERE id = ?`).run(checkedKeywordCount(db, runId), input.costUsd, runId);
  });
}

/**
 * Check keyword/device pairs against the live endpoint and persist snapshots.
 * Per-call failures are recorded and skipped; a credentials failure is returned
 * so the run can stop, since every later call would fail the same way.
 */
export async function checkBatchLive(db: Store, config: RankTrackingConfig, runId: string, ledger: RunLedger, tasks: RankCheckTaskInput[]) {
  const settled = await Promise.allSettled(
    tasks.map((task) =>
      ledger.client.serp
        .rankCheck({
          keyword: task.keyword,
          keywordId: task.keywordId,
          locationCode: config.locationCode,
          languageCode: config.languageCode,
          locationName: config.locationName ?? undefined,
          device: task.device,
          targetDomain: config.domain,
          depth: config.serpDepth,
        })
        .then((r) => ({ ...r, device: task.device })),
    ),
  );
  const results: RankCheckResultWithDevice[] = [];
  let firstError: string | null = null;
  let credentialsError: unknown = null;
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") {
      results.push(outcome.value);
      continue;
    }
    const reason: unknown = outcome.reason;
    ledger.charged(reason);
    if (reason instanceof OperationError && reason.kind === "credentials") credentialsError ??= reason;
    firstError ??= reason instanceof Error ? reason.message : String(reason);
  }
  saveSnapshots(db, runId, results, { firstError, costUsd: ledger.costUsd });
  return { checked: results.length, credentialsError };
}

/** Upstream's finalize: completed unless nothing could be checked; a partial run says how many. */
export function finalizeRun(db: Store, runId: string, configId: string) {
  return transaction(db, () => {
    claim(db, runId);
    const run = db.prepare(`SELECT * FROM rank_check_runs WHERE id = ?`).get(runId) as RunRow;
    const keywordsChecked = checkedKeywordCount(db, runId);
    const keywordsTotal = run.keywords_total || keywordsChecked;
    const incompleteCount = keywordsTotal - keywordsChecked;
    const status = keywordsChecked === 0 && keywordsTotal > 0 ? "failed" : "completed";
    const errorMessage =
      status === "failed"
        ? (run.error_message ?? "No keywords could be checked.")
        : incompleteCount > 0
          ? `Checked ${keywordsChecked} of ${keywordsTotal} keyword(s)${run.error_message ? `: ${run.error_message}` : ""}`
          : null;
    const now = new Date().toISOString();
    db.prepare(`UPDATE rank_check_runs SET status = ?, keywords_checked = ?, completed_at = ?, error_message = ? WHERE id = ?`).run(
      status,
      keywordsChecked,
      now,
      errorMessage,
      runId,
    );
    // A failed run must not advance lastCheckedAt: nothing was actually checked.
    if (status === "completed") db.prepare(`UPDATE rank_tracking_configs SET last_checked_at = ?, last_skip_reason = NULL WHERE id = ?`).run(now, configId);
    return getRun(db, runId);
  });
}

export function getRun(db: Store, runId: string) {
  const row = db.prepare(`SELECT * FROM rank_check_runs WHERE id = ?`).get(runId) as Record<string, string | number | null>;
  return {
    id: row.id as string,
    status: row.status as RunRow["status"],
    trigger: row.trigger as "manual" | "scheduled",
    keywordsTotal: row.keywords_total as number,
    keywordsChecked: row.keywords_checked as number,
    isSubsetRun: row.is_subset_run === 1,
    errorMessage: row.error_message as string | null,
    costUsd: row.cost_usd as number,
    startedAt: row.started_at as string,
    completedAt: row.completed_at as string | null,
  };
}

/** Keep the run's heartbeat fresh while `work` runs, so other commands see it alive. */
export async function withHeartbeat<T>(db: Store, runId: string, work: () => Promise<T>): Promise<T> {
  let lost: unknown;
  const heartbeat = setInterval(() => {
    try {
      claim(db, runId);
    } catch (error) {
      lost = error;
    }
  }, HEARTBEAT_INTERVAL_MS);
  try {
    const result = await work();
    if (lost) throw lost;
    return result;
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * A manual check: every keyword/device pair on the live endpoint, ten keywords per
 * batch, snapshots saved per batch so partial results survive a failure.
 */
export async function runLiveCheck(db: Store, config: RankTrackingConfig, input: { keywordIds?: string[] }) {
  const { runId, keywords } = beginRun(db, config, { trigger: "manual", keywordIds: input.keywordIds });
  const ledger = new RunLedger();
  let stop: unknown = null;
  await closeOnFailure(db, runId, config.id, () =>
    withHeartbeat(db, runId, async () => {
      for (let i = 0; i < keywords.length && !stop; i += KEYWORDS_PER_BATCH) {
        const batch = expandToTaskInputs(keywords.slice(i, i + KEYWORDS_PER_BATCH), config.devices);
        stop = (await checkBatchLive(db, config, runId, ledger, batch)).credentialsError;
      }
    }),
  );
  const run = finalizeRun(db, runId, config.id);
  if (stop) throw stop;
  return run;
}

/** An unexpected error still closes the run it owns, keeping what was checked. */
export async function closeOnFailure<T>(db: Store, runId: string, configId: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof RunClosed)) {
      db.prepare(`UPDATE rank_check_runs SET error_message = COALESCE(error_message, ?) WHERE id = ?`).run(error instanceof Error ? error.message : String(error), runId);
      finalizeRun(db, runId, configId);
    }
    throw error;
  }
}
