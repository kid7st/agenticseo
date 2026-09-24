// Adapted from OpenSEO src/server/features/rank-tracking/services/scheduledRankChecks.ts
// and the queued path of src/server/workflows/rankCheckPaths.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local changes: the host scheduler invokes `rank due`, one project per call,
// instead of a Worker cron over every organization. The same process posts,
// polls and falls back, where upstream used durable Workflow steps and sleeps.
// Each accepted task id is stored when it is posted, so an interrupted run is
// adopted by the next call, which collects the paid tasks instead of posting again.
// Plan checks, the wall-clock tick deadline and telemetry are dropped.
import { setTimeout as sleep } from "node:timers/promises";
import { OperationError } from "../../errors.js";
import { transaction, type Store } from "../../store.js";
import { fetchRankCheckTaskResult, type PostedRankCheckTask, type RankCheckTaskInput } from "../dataforseo/serp.js";
import { computeNextCheckAt, devicesCount, isScheduledRankTrackingInterval, KEYWORDS_PER_BATCH, MAX_TASKS_PER_POST } from "../shared/rank-tracking.js";
import {
  adoptRun,
  beginRun,
  checkBatchLive,
  closeDeadRuns,
  closeOnFailure,
  expandToTaskInputs,
  finalizeRun,
  interruptedRuns,
  RunLedger,
  saveSnapshots,
  withHeartbeat,
} from "./rankCheck.js";
import { getValidatedConfig, type RankTrackingConfig } from "./RankTrackingService.js";

/**
 * Poll cadence for queued tasks. Standard-priority tasks complete in ~5 minutes
 * on average, so the first check waits 4 minutes; cumulative waits are
 * 4 / 6 / 8 / 10 / 12 / 15 minutes, after which stragglers fall back to the live
 * endpoint.
 */
export const QUEUED_POLL_INTERVALS_MS = [4, 2, 2, 2, 2, 3].map((minutes) => minutes * 60_000);

/** Concurrent task_get requests within a collect round. */
const TASK_GET_CONCURRENCY = 25;
/** Max task_get calls per collect round (bounds one round's fan-out). */
const TASK_GETS_PER_COLLECT = 500;
/**
 * Work admitted per call, in task units (keywords × devices). The first start is
 * always admitted, so a tracker bigger than the budget can never starve; the rest
 * stay due for the next call.
 */
const SCHEDULED_TASK_UNIT_BUDGET = 1000;

/** Per-run accounting for the queued path, in keyword/device task units. */
export interface QueuedCheckStats {
  /** Tasks accepted into DataForSEO's queue. */
  queueTasks: number;
  /** Task results collected from the queue within the polling window. */
  queueCollected: number;
  /** Tasks routed to the live fallback (rejected, failed, or timed out). */
  fallbackTasks: number;
  /** Fallback tasks that produced a snapshot. */
  fallbackChecked: number;
}

function storedUncollectedTasks(db: Store, runId: string): PostedRankCheckTask[] {
  return (
    db
      .prepare(
        `SELECT t.tracking_keyword_id, t.keyword, t.device, t.task_id FROM rank_check_tasks t
         WHERE t.run_id = ? AND NOT EXISTS (SELECT 1 FROM rank_snapshots s WHERE s.run_id = t.run_id AND s.tracking_keyword_id = t.tracking_keyword_id AND s.device = t.device)`,
      )
      .all(runId) as Array<{ tracking_keyword_id: string; keyword: string; device: "desktop" | "mobile"; task_id: string }>
  ).map((row) => ({ keywordId: row.tracking_keyword_id, keyword: row.keyword, device: row.device, taskId: row.task_id }));
}

/**
 * Post every pair to DataForSEO's standard queue (<= 100 per request), storing
 * each accepted task id at once. A failed or partly rejected post sends those
 * pairs to the live fallback; earlier posts were already charged.
 */
async function postTasks(db: Store, config: RankTrackingConfig, runId: string, ledger: RunLedger, pairs: RankCheckTaskInput[]) {
  const posted: PostedRankCheckTask[] = [];
  const fallback: RankCheckTaskInput[] = [];
  let firstError: string | null = null;
  for (let i = 0; i < pairs.length; i += MAX_TASKS_PER_POST) {
    const chunk = pairs.slice(i, i + MAX_TASKS_PER_POST);
    let accepted: PostedRankCheckTask[];
    try {
      accepted = await ledger.client.serp.rankCheckTaskPost({
        tasks: chunk,
        locationCode: config.locationCode,
        languageCode: config.languageCode,
        locationName: config.locationName ?? undefined,
        depth: config.serpDepth,
        targetDomain: config.domain,
      });
    } catch (error) {
      ledger.charged(error);
      // Every later post would fail the same way; no task was accepted.
      if (error instanceof OperationError && error.kind === "credentials") throw error;
      firstError ??= error instanceof Error ? error.message : String(error);
      fallback.push(...chunk);
      continue;
    }
    transaction(db, () => {
      const insert = db.prepare(`INSERT INTO rank_check_tasks (run_id, tracking_keyword_id, keyword, device, task_id, posted_at) VALUES (?, ?, ?, ?, ?, ?)`);
      const now = new Date().toISOString();
      for (const task of accepted) insert.run(runId, task.keywordId, task.keyword, task.device, task.taskId, now);
      db.prepare(`UPDATE rank_check_runs SET cost_usd = ? WHERE id = ?`).run(ledger.costUsd, runId);
    });
    posted.push(...accepted);
    const acceptedKeys = new Set(accepted.map((task) => `${task.keywordId}:${task.device}`));
    fallback.push(...chunk.filter((task) => !acceptedKeys.has(`${task.keywordId}:${task.device}`)));
  }
  if (firstError) saveSnapshots(db, runId, [], { firstError, costUsd: ledger.costUsd });
  return { posted, fallback };
}

/**
 * Fetch results for queued tasks (one free task_get each) and persist completed
 * snapshots. Transient task_get failures stay pending for the next round.
 */
async function collectRound(db: Store, config: RankTrackingConfig, runId: string, ledger: RunLedger, tasks: PostedRankCheckTask[]) {
  const completed: Parameters<typeof saveSnapshots>[2] = [];
  const stillPending: PostedRankCheckTask[] = [];
  const failed: PostedRankCheckTask[] = [];
  let firstError: string | null = null;
  for (let i = 0; i < tasks.length; i += TASK_GET_CONCURRENCY) {
    const chunk = tasks.slice(i, i + TASK_GET_CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map((task) => fetchRankCheckTaskResult({ taskId: task.taskId, keywordId: task.keywordId, keyword: task.keyword, targetDomain: config.domain })),
    );
    settled.forEach((result, index) => {
      const task = chunk[index];
      if (result.status === "rejected") {
        if (result.reason instanceof OperationError && result.reason.kind === "credentials") throw result.reason;
        stillPending.push(task);
      } else if (result.value.status === "pending") {
        stillPending.push(task);
      } else if (result.value.status === "failed") {
        firstError ??= result.value.message;
        failed.push(task);
      } else {
        completed.push({ ...result.value.result, device: task.device });
      }
    });
  }
  saveSnapshots(db, runId, completed, { firstError, costUsd: ledger.costUsd });
  return { collected: completed.length, stillPending, failed };
}

/**
 * A scheduled check through DataForSEO's standard task queue (~30% of live cost):
 * post (or, for an adopted run, reuse the stored tasks), poll ~15 minutes writing
 * snapshots as tasks complete, then give anything unfinished, failed or rejected
 * one live check so a run never hangs on a stuck queue.
 */
export async function runQueuedCheck(
  db: Store,
  config: RankTrackingConfig,
  runId: string,
  input: { pairs: RankCheckTaskInput[]; adopted: boolean; pollIntervalsMs: number[] },
) {
  const ledger = new RunLedger();
  // An adopted run keeps the cost it recorded before it was interrupted.
  if (input.adopted) ledger.carryOver((db.prepare(`SELECT cost_usd FROM rank_check_runs WHERE id = ?`).get(runId) as { cost_usd: number }).cost_usd);
  const stats: QueuedCheckStats = { queueTasks: 0, queueCollected: 0, fallbackTasks: 0, fallbackChecked: 0 };

  await closeOnFailure(db, runId, config.id, () =>
    withHeartbeat(db, runId, async () => {
      let pending: PostedRankCheckTask[];
      let fallback: RankCheckTaskInput[] = [];
      if (input.adopted) {
        pending = storedUncollectedTasks(db, runId);
      } else {
        ({ posted: pending, fallback } = await postTasks(db, config, runId, ledger, input.pairs));
      }
      stats.queueTasks = pending.length;

      for (let round = 0; round < input.pollIntervalsMs.length && pending.length > 0; round++) {
        // An adopted run's tasks have usually finished long ago: collect at once.
        await sleep(input.adopted && round === 0 ? 0 : input.pollIntervalsMs[round]);
        const batch = pending.slice(0, TASK_GETS_PER_COLLECT);
        const outcome = await collectRound(db, config, runId, ledger, batch);
        stats.queueCollected += outcome.collected;
        pending = [...outcome.stillPending, ...pending.slice(TASK_GETS_PER_COLLECT)];
        fallback.push(...outcome.failed);
      }

      // Live fallback: queued tasks that never finished, failed, or were rejected
      // at post time. A straggler is paid twice (the queued post and now the live
      // call), fractions of a cent.
      const stragglers: RankCheckTaskInput[] = [...fallback, ...pending];
      stats.fallbackTasks = stragglers.length;
      for (let i = 0; i < stragglers.length; i += KEYWORDS_PER_BATCH) {
        const { checked, credentialsError } = await checkBatchLive(db, config, runId, ledger, stragglers.slice(i, i + KEYWORDS_PER_BATCH));
        stats.fallbackChecked += checked;
        if (credentialsError) throw credentialsError;
      }
    }),
  );
  return { run: finalizeRun(db, runId, config.id), stats };
}

/**
 * Conditionally advance a due config's schedule; false when it changed underneath
 * us (another `rank due`, a manual edit, archiving). `next_check_at` is the
 * compare-and-set token.
 */
function claimDueConfig(db: Store, input: { configId: string; observedNextCheckAt: string; nextCheckAt: string; lastSkipReason?: string | null }) {
  const skip = input.lastSkipReason !== undefined;
  return (
    db
      .prepare(
        `UPDATE rank_tracking_configs SET next_check_at = ?${skip ? ", last_skip_reason = ?" : ""}
         WHERE id = ? AND is_active = 1 AND next_check_at = ?`,
      )
      .run(...[input.nextCheckAt, ...(skip ? [input.lastSkipReason ?? null] : []), input.configId, input.observedNextCheckAt]).changes > 0
  );
}

/**
 * The scheduler entry point: finish interrupted scheduled runs, then start a
 * queued check for every tracker that is due. Safe to call repeatedly and
 * concurrently; a missed slot runs once, not once per missed interval.
 */
export async function runDueChecks(db: Store, options: { pollIntervalsMs?: number[] } = {}) {
  const pollIntervalsMs = options.pollIntervalsMs ?? QUEUED_POLL_INTERVALS_MS;
  closeDeadRuns(db);
  const work: Array<{ config: RankTrackingConfig; runId: string; pairs: RankCheckTaskInput[]; adopted: boolean }> = [];
  const skipped: Array<{ trackerId: string; reason: string; blockingRunId?: string }> = [];

  for (const run of interruptedRuns(db)) {
    if (adoptRun(db, run)) work.push({ config: getValidatedConfig(db, run.config_id), runId: run.id, pairs: [], adopted: true });
  }

  const due = db
    .prepare(`SELECT id, next_check_at FROM rank_tracking_configs WHERE is_active = 1 AND schedule_interval != 'manual' AND next_check_at <= ? ORDER BY next_check_at, id`)
    .all(new Date().toISOString()) as Array<{ id: string; next_check_at: string }>;
  let unitsStarted = 0;
  let stoppedByBudget = false;
  for (const row of due) {
    const config = getValidatedConfig(db, row.id);
    if (!isScheduledRankTrackingInterval(config.scheduleInterval)) continue;
    const keywordCount = (db.prepare(`SELECT COUNT(*) AS n FROM rank_tracking_keywords WHERE config_id = ?`).get(config.id) as { n: number }).n;
    const taskUnits = keywordCount * devicesCount(config.devices);
    if (unitsStarted > 0 && unitsStarted + taskUnits > SCHEDULED_TASK_UNIT_BUDGET) {
      stoppedByBudget = true;
      break;
    }
    const nextCheckAt = computeNextCheckAt(config.scheduleInterval, row.next_check_at);
    if (keywordCount === 0) {
      if (claimDueConfig(db, { configId: config.id, observedNextCheckAt: row.next_check_at, nextCheckAt, lastSkipReason: "no_keywords" })) {
        skipped.push({ trackerId: config.id, reason: "no_keywords" });
      }
      continue;
    }
    if (!claimDueConfig(db, { configId: config.id, observedNextCheckAt: row.next_check_at, nextCheckAt, lastSkipReason: null })) continue;
    const begun = beginRun(db, config, { trigger: "scheduled" });
    if (!begun.ok) {
      // Nothing was started, so give the slot back for the next call once the blocking run clears.
      claimDueConfig(db, { configId: config.id, observedNextCheckAt: nextCheckAt, nextCheckAt: row.next_check_at });
      skipped.push({ trackerId: config.id, reason: "already_running", blockingRunId: begun.blockingRunId });
      continue;
    }
    unitsStarted += taskUnits;
    work.push({ config, runId: begun.runId, pairs: expandToTaskInputs(begun.keywords, config.devices), adopted: false });
  }

  const settled = await Promise.allSettled(
    work.map((item) => runQueuedCheck(db, item.config, item.runId, { pairs: item.pairs, adopted: item.adopted, pollIntervalsMs })),
  );
  const runs = settled.map((outcome, index) => ({
    trackerId: work[index].config.id,
    adopted: work[index].adopted,
    ...(outcome.status === "fulfilled" ? outcome.value : { error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) }),
  }));
  // A rejected key fails every run the same way: surface it as the command's failure.
  const credentials = settled.find((outcome) => outcome.status === "rejected" && outcome.reason instanceof OperationError && outcome.reason.kind === "credentials");
  if (credentials?.status === "rejected") throw credentials.reason;
  return {
    checkedAt: new Date().toISOString(),
    due: due.length,
    started: work.filter((item) => !item.adopted).length,
    adopted: work.filter((item) => item.adopted).length,
    unitsStarted,
    stoppedByBudget,
    skipped,
    runs,
  };
}
