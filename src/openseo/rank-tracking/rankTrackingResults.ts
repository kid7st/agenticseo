// Adapted from OpenSEO src/server/features/rank-tracking/services/rankTrackingResults.ts,
// src/server/features/rank-tracking/repositories/snapshotQueries.ts and the history
// server functions in src/serverFunctions/rank-tracking.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local changes: the drizzle group-by self-joins become window functions on the
// project database; the trend's "not ranking" remainder is computed in SQL; the
// position matrix is returned pivoted, one row per keyword.
import type { Store } from "../../store.js";
import { getKeywordsForConfig, getValidatedConfig } from "./RankTrackingService.js";

export type ComparePeriod = "1d" | "7d" | "30d" | "90d";
type Device = "desktop" | "mobile";

const PERIOD_DAYS: Record<ComparePeriod, number> = { "1d": 1, "7d": 7, "30d": 30, "90d": 90 };

type SnapshotRow = {
  tracking_keyword_id: string;
  device: Device;
  position: number | null;
  url: string | null;
  serp_features: string | null;
  checked_at: string;
};

const cutoffTimestamp = (sinceDays: number) => new Date(Date.now() - sinceDays * 86_400_000).toISOString();

/**
 * One snapshot per keyword and device from completed runs: the latest (optionally
 * at or before a date) or the earliest. Subset runs count, as upstream.
 */
function snapshotsForConfig(db: Store, configId: string, opts: { order: "latest" | "earliest"; beforeDate?: string }): SnapshotRow[] {
  const direction = opts.order === "latest" ? "DESC" : "ASC";
  return db
    .prepare(
      `SELECT tracking_keyword_id, device, position, url, serp_features, checked_at FROM (
         SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.tracking_keyword_id, s.device ORDER BY s.checked_at ${direction}, s.id ${direction}) AS n
         FROM rank_snapshots s JOIN rank_check_runs r ON r.id = s.run_id
         WHERE r.config_id = ? AND r.status = 'completed' AND (? IS NULL OR s.checked_at <= ?)
       ) WHERE n = 1`,
    )
    .all(configId, opts.beforeDate ?? null, opts.beforeDate ?? null) as SnapshotRow[];
}

function parseSerpFeatures(raw: string | null): string[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

/**
 * Latest position per tracked keyword and device, with the position at the start
 * of the comparison period (or the earliest one, when the keyword is newer).
 */
export function getLatestResults(db: Store, configId: string, comparePeriod: ComparePeriod = "7d") {
  const config = getValidatedConfig(db, configId);
  const targetDate = cutoffTimestamp(PERIOD_DAYS[comparePeriod]);
  const current = snapshotsForConfig(db, configId, { order: "latest" });
  const previous = new Map<string, number | null>();
  for (const snap of snapshotsForConfig(db, configId, { order: "latest", beforeDate: targetDate })) {
    previous.set(`${snap.tracking_keyword_id}:${snap.device}`, snap.position);
  }
  // Fallback: combos with no snapshot before the target date use the earliest one as the baseline.
  if (current.some((snap) => !previous.has(`${snap.tracking_keyword_id}:${snap.device}`))) {
    for (const snap of snapshotsForConfig(db, configId, { order: "earliest" })) {
      const key = `${snap.tracking_keyword_id}:${snap.device}`;
      if (!previous.has(key)) previous.set(key, snap.position);
    }
  }

  type DeviceResult = { position: number | null; previousPosition: number | null; rankingUrl: string | null; serpFeatures: string[] };
  const empty = (id: string, device: Device): DeviceResult => ({ position: null, previousPosition: previous.get(`${id}:${device}`) ?? null, rankingUrl: null, serpFeatures: [] });
  const rows = new Map(
    getKeywordsForConfig(db, configId).map((kw) => [
      kw.id,
      {
        trackingKeywordId: kw.id,
        keyword: kw.keyword,
        matchCase: kw.matchCase,
        searchVolume: kw.searchVolume,
        keywordDifficulty: kw.keywordDifficulty,
        cpc: kw.cpc,
        desktop: empty(kw.id, "desktop"),
        mobile: empty(kw.id, "mobile"),
      },
    ]),
  );
  // Freshness comes from the newest snapshot regardless of which run wrote it.
  let lastCheckedAt: string | null = null;
  for (const snap of current) {
    const row = rows.get(snap.tracking_keyword_id);
    if (!row) continue;
    row[snap.device] = {
      position: snap.position,
      previousPosition: previous.get(`${snap.tracking_keyword_id}:${snap.device}`) ?? null,
      rankingUrl: snap.url,
      serpFeatures: parseSerpFeatures(snap.serp_features),
    };
    if (!lastCheckedAt || snap.checked_at > lastCheckedAt) lastCheckedAt = snap.checked_at;
  }

  const latestRun = db.prepare(`SELECT id, status, completed_at, error_message, cost_usd FROM rank_check_runs WHERE config_id = ? ORDER BY started_at DESC LIMIT 1`).get(configId) as
    | { id: string; status: string; completed_at: string | null; error_message: string | null; cost_usd: number }
    | undefined;
  return {
    config,
    comparePeriod,
    rows: [...rows.values()],
    run: latestRun
      ? { id: latestRun.id, lastCheckedAt, completedAt: latestRun.completed_at, status: latestRun.status, errorMessage: latestRun.error_message, costUsd: latestRun.cost_usd }
      : null,
  };
}

/** Per-keyword positions across completed runs, oldest first; null = checked but not found. */
export function getKeywordHistory(db: Store, configId: string, trackingKeywordId: string, sinceDays: number) {
  getValidatedConfig(db, configId);
  return db
    .prepare(
      `SELECT s.device, s.checked_at AS checkedAt, s.position FROM rank_snapshots s JOIN rank_check_runs r ON r.id = s.run_id
       WHERE r.config_id = ? AND r.status = 'completed' AND s.tracking_keyword_id = ? AND s.checked_at >= ?
       ORDER BY s.checked_at`,
    )
    .all(configId, trackingKeywordId, cutoffTimestamp(sinceDays))
    .map((row) => ({ ...(row as { device: Device; checkedAt: string; position: number | null }) }));
}

/**
 * Per-run position distribution for one device, oldest first. The buckets are
 * disjoint and cover every checked keyword: past 20 or not found is "not ranking".
 */
export function getConfigTrend(db: Store, configId: string, device: Device, sinceDays: number) {
  getValidatedConfig(db, configId);
  return db
    .prepare(
      `SELECT s.run_id AS runId, r.started_at AS checkedAt,
              SUM(CASE WHEN s.position BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS top3,
              SUM(CASE WHEN s.position BETWEEN 4 AND 10 THEN 1 ELSE 0 END) AS top4to10,
              SUM(CASE WHEN s.position BETWEEN 11 AND 20 THEN 1 ELSE 0 END) AS top11to20,
              SUM(CASE WHEN s.position IS NULL OR s.position > 20 THEN 1 ELSE 0 END) AS notRanking
       FROM rank_snapshots s JOIN rank_check_runs r ON r.id = s.run_id
       WHERE r.config_id = ? AND r.status = 'completed' AND r.is_subset_run = 0 AND s.device = ? AND s.checked_at >= ?
       GROUP BY s.run_id, r.started_at
       ORDER BY r.started_at`,
    )
    .all(configId, device, cutoffTimestamp(sinceDays))
    .map((row) => ({ ...(row as { runId: string; checkedAt: string; top3: number; top4to10: number; top11to20: number; notRanking: number }) }));
}

// Upstream returns flat cells and a missing cell means "not checked in that run";
// pivoted here, that needs its own value, since null already means "not found".
const NOT_CHECKED = "not checked";

/** Keyword rows × the last `runLimit` full completed runs, for one device (the "by date" matrix). */
export function getPositionMatrix(db: Store, configId: string, device: Device, runLimit: number) {
  getValidatedConfig(db, configId);
  const runs = db
    .prepare(`SELECT id, started_at FROM rank_check_runs WHERE config_id = ? AND status = 'completed' AND is_subset_run = 0 ORDER BY started_at DESC LIMIT ?`)
    .all(configId, runLimit)
    .reverse() as Array<{ id: string; started_at: string }>;
  const cells = db
    .prepare(
      `SELECT s.run_id, s.tracking_keyword_id, s.keyword, s.position FROM rank_snapshots s
       WHERE s.device = ? AND s.run_id IN (SELECT value FROM json_each(?))`,
    )
    .all(device, JSON.stringify(runs.map((run) => run.id))) as Array<{ run_id: string; tracking_keyword_id: string; keyword: string; position: number | null }>;
  const columnOf = new Map(runs.map((run, index) => [run.id, index]));
  const keywords = new Map<string, { trackingKeywordId: string; keyword: string; positions: Array<number | null | typeof NOT_CHECKED> }>();
  for (const cell of cells) {
    let row = keywords.get(cell.tracking_keyword_id);
    if (!row) {
      row = { trackingKeywordId: cell.tracking_keyword_id, keyword: cell.keyword, positions: runs.map(() => NOT_CHECKED) };
      keywords.set(cell.tracking_keyword_id, row);
    }
    row.positions[columnOf.get(cell.run_id)!] = cell.position;
  }
  return { device, runs: runs.map((run) => ({ runId: run.id, checkedAt: run.started_at })), keywords: [...keywords.values()] };
}
