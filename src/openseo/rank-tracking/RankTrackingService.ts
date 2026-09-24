// Adapted from OpenSEO src/server/features/rank-tracking/services/RankTrackingService.ts,
// src/server/features/rank-tracking/services/RankTrackingKeywordService.ts and
// src/server/features/rank-tracking/repositories/RankTrackingRepository.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local changes: drizzle queries become node:sqlite statements on the project
// database (one project per database, so no project_id); plan gates, credit
// approvals and telemetry are dropped; keywords over the per-tracker limit and
// unknown keyword ids are reported instead of silently skipped; a location name
// the DataForSEO sandbox could not check is reported with the reason; keywords
// with no metrics are listed in the refresh result.
import { randomUUID } from "node:crypto";
import { transaction, type Store } from "../../store.js";
import type { DataforseoClient } from "../dataforseo/client.js";
import { fetchKeywordMetricsForList } from "../dataforseo/keyword-metrics.js";
import { assertSerpLocationNameAccepted } from "../dataforseo/serp-location-validate.js";
import { getIsoCountryCode, resolveKeywordDataLanguage } from "../keyword-locations.js";
import { AppError } from "../platform.js";
import {
  computeNextCheckAt,
  devicesCount,
  estimateRankCheckCost,
  estimateScheduledRankCheckCost,
  isScheduledRankTrackingInterval,
  MAX_CONFIGS_PER_PROJECT,
  MAX_KEYWORDS_PER_CONFIG,
  MAX_TRACKED_KEYWORD_LENGTH,
} from "../shared/rank-tracking.js";

export type Devices = "desktop" | "mobile" | "both";
export type ScheduleInterval = "manual" | "daily" | "weekly" | "monthly";

export interface RankTrackingConfig {
  id: string;
  domain: string;
  locationCode: number;
  languageCode: string;
  locationName: string | null;
  devices: Devices;
  serpDepth: number;
  scheduleInterval: ScheduleInterval;
  isActive: boolean;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  lastSkipReason: string | null;
  createdAt: string;
}

type ConfigRow = {
  id: string;
  domain: string;
  location_code: number;
  language_code: string;
  location_name: string | null;
  devices: Devices;
  serp_depth: number;
  schedule_interval: ScheduleInterval;
  is_active: number;
  last_checked_at: string | null;
  next_check_at: string | null;
  last_skip_reason: string | null;
  created_at: string;
};

const toConfig = (row: ConfigRow): RankTrackingConfig => ({
  id: row.id,
  domain: row.domain,
  locationCode: row.location_code,
  languageCode: row.language_code,
  locationName: row.location_name,
  devices: row.devices,
  serpDepth: row.serp_depth,
  scheduleInterval: row.schedule_interval,
  isActive: row.is_active === 1,
  lastCheckedAt: row.last_checked_at,
  nextCheckAt: row.next_check_at,
  lastSkipReason: row.last_skip_reason,
  createdAt: row.created_at,
});

export function getValidatedConfig(db: Store, configId: string) {
  const row = db.prepare(`SELECT * FROM rank_tracking_configs WHERE id = ?`).get(configId) as ConfigRow | undefined;
  if (!row) throw new AppError("VALIDATION_ERROR", `No rank tracker ${configId} in this project`);
  return toConfig(row);
}

export function getKeywordsForConfig(db: Store, configId: string) {
  return (
    db.prepare(`SELECT * FROM rank_tracking_keywords WHERE config_id = ? ORDER BY created_at, rowid`).all(configId) as Array<{
      id: string;
      keyword: string;
      match_case: number;
      search_volume: number | null;
      keyword_difficulty: number | null;
      cpc: number | null;
      metrics_fetched_at: string | null;
    }>
  ).map((row) => ({
    id: row.id,
    keyword: row.keyword,
    matchCase: row.match_case === 1,
    searchVolume: row.search_volume,
    keywordDifficulty: row.keyword_difficulty,
    cpc: row.cpc,
    metricsFetchedAt: row.metrics_fetched_at,
  }));
}

const keywordCount = (db: Store, configId: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM rank_tracking_keywords WHERE config_id = ?`).get(configId) as { n: number }).n;

function normalizeDomain(domain: string): string {
  let d = domain.trim().toLowerCase();
  // Strip protocol
  d = d.replace(/^https?:\/\//, "");
  // Strip path, query string, and fragment
  d = d.replace(/[/?#].*$/, "");
  // Strip trailing slash
  d = d.replace(/\/+$/, "");
  // Strip www. prefix
  d = d.replace(/^www\./, "");
  if (!d) {
    throw new AppError("VALIDATION_ERROR", "Invalid domain");
  }
  return d;
}

/** Check a city-level location name against the free DataForSEO sandbox; an outage leaves it unchecked. */
async function checkLocationName(locationName: string | null, locationCode: number, languageCode: string) {
  if (!locationName) return null;
  const result = await assertSerpLocationNameAccepted({ locationName, languageCode, countryCode: getIsoCountryCode(locationCode) });
  return result.checked ? null : `Location name not checked: ${result.reason}`;
}

export async function createConfig(
  db: Store,
  input: {
    domain: string;
    locationCode: number;
    languageCode: string;
    locationName?: string;
    devices: Devices;
    serpDepth: number;
    scheduleInterval: ScheduleInterval;
  },
) {
  const domain = normalizeDomain(input.domain);
  const locationName = input.locationName ?? null;
  const nextCheckAt = isScheduledRankTrackingInterval(input.scheduleInterval) ? computeNextCheckAt(input.scheduleInterval) : null;
  // Before the duplicate/limit checks so an unusable location name is the error the caller sees.
  const warning = await checkLocationName(locationName, input.locationCode, input.languageCode);

  const configId = transaction(db, () => {
    const existing = db
      .prepare(`SELECT id, is_active FROM rank_tracking_configs WHERE domain = ? AND location_code = ? AND location_name IS ?`)
      .get(domain, input.locationCode, locationName) as { id: string; is_active: number } | undefined;
    if (existing?.is_active === 1) {
      throw new AppError(
        "VALIDATION_ERROR",
        `${locationName ? "This domain + city combination" : "This domain + country combination"} is already tracked by ${existing.id}`,
      );
    }
    const active = (db.prepare(`SELECT COUNT(*) AS n FROM rank_tracking_configs WHERE is_active = 1`).get() as { n: number }).n;
    if (active >= MAX_CONFIGS_PER_PROJECT) {
      throw new AppError("VALIDATION_ERROR", `Maximum ${MAX_CONFIGS_PER_PROJECT} tracked domains per project`);
    }
    // An archived tracker for the same domain and location is reactivated, keeping its keywords and history.
    if (existing) {
      db.prepare(
        `UPDATE rank_tracking_configs SET is_active = 1, language_code = ?, devices = ?, serp_depth = ?, schedule_interval = ?, next_check_at = ?, last_skip_reason = NULL WHERE id = ?`,
      ).run(input.languageCode, input.devices, input.serpDepth, input.scheduleInterval, nextCheckAt, existing.id);
      return existing.id;
    }
    const id = randomUUID();
    db.prepare(
      `INSERT INTO rank_tracking_configs (id, domain, location_code, language_code, location_name, devices, serp_depth, schedule_interval, next_check_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, domain, input.locationCode, input.languageCode, locationName, input.devices, input.serpDepth, input.scheduleInterval, nextCheckAt, new Date().toISOString());
    return id;
  });
  return { config: getValidatedConfig(db, configId), ...(warning && { warning }) };
}

export async function updateConfig(
  db: Store,
  configId: string,
  input: {
    domain?: string;
    locationCode?: number;
    languageCode?: string;
    locationName?: string | null;
    devices?: Devices;
    serpDepth?: number;
    scheduleInterval?: ScheduleInterval;
    isActive?: boolean;
  },
) {
  const existing = getValidatedConfig(db, configId);
  // A location name is only valid together with its market, so re-check the
  // resulting (name, language, country) whenever any of the three changes.
  const marketChanged = input.locationName !== undefined || input.locationCode !== undefined || input.languageCode !== undefined;
  const warning = marketChanged
    ? await checkLocationName(
        input.locationName === undefined ? existing.locationName : input.locationName,
        input.locationCode ?? existing.locationCode,
        input.languageCode ?? existing.languageCode,
      )
    : null;

  const updates: Record<string, string | number | null> = {};
  if (input.domain !== undefined) updates.domain = normalizeDomain(input.domain);
  if (input.locationCode !== undefined) updates.location_code = input.locationCode;
  if (input.languageCode !== undefined) updates.language_code = input.languageCode;
  if (input.locationName !== undefined) updates.location_name = input.locationName;
  if (input.devices !== undefined) updates.devices = input.devices;
  if (input.serpDepth !== undefined) updates.serp_depth = input.serpDepth;
  if (input.isActive !== undefined) updates.is_active = input.isActive ? 1 : 0;
  if (input.scheduleInterval !== undefined) {
    updates.schedule_interval = input.scheduleInterval;
    updates.next_check_at = isScheduledRankTrackingInterval(input.scheduleInterval) ? computeNextCheckAt(input.scheduleInterval) : null;
  }
  const columns = Object.keys(updates);
  if (columns.length === 0) throw new AppError("VALIDATION_ERROR", "Nothing to update");
  try {
    db.prepare(`UPDATE rank_tracking_configs SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`).run(...Object.values(updates), configId);
  } catch (error) {
    if ((error as { errcode?: number }).errcode === 2067) {
      throw new AppError("VALIDATION_ERROR", "Another tracker already covers this domain and location");
    }
    throw error;
  }
  return { config: getValidatedConfig(db, configId), ...(warning && { warning }) };
}

export function addKeywords(db: Store, configId: string, keywords: string[], matchCase = false) {
  const config = getValidatedConfig(db, configId);
  const tooLong = keywords.find((keyword) => keyword.trim().length > MAX_TRACKED_KEYWORD_LENGTH);
  if (tooLong) throw new AppError("VALIDATION_ERROR", `Keywords are at most ${MAX_TRACKED_KEYWORD_LENGTH} characters: "${tooLong.slice(0, 40)}…"`);

  return transaction(db, () => {
    const existing = new Set(getKeywordsForConfig(db, configId).map((kw) => kw.keyword));
    const available = MAX_KEYWORDS_PER_CONFIG - existing.size;
    const seen = new Set<string>();
    const toAdd: string[] = [];
    const overLimit: string[] = [];
    let alreadyTracked = 0;
    for (const raw of keywords) {
      const trimmed = raw.trim();
      // Keywords are lowercased unless matchCase: Google can return a different SERP for "Nodex" than "nodex".
      const normalized = matchCase ? trimmed : trimmed.toLowerCase();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      if (existing.has(normalized)) alreadyTracked++;
      else if (toAdd.length < available) toAdd.push(normalized);
      else overLimit.push(normalized);
    }
    const insert = db.prepare(`INSERT INTO rank_tracking_keywords (id, config_id, keyword, match_case, created_at) VALUES (?, ?, ?, ?, ?)`);
    const now = new Date().toISOString();
    const addedIds = toAdd.map((keyword) => {
      const id = randomUUID();
      insert.run(id, configId, keyword, matchCase ? 1 : 0, now);
      return id;
    });
    const total = existing.size + addedIds.length;
    return {
      added: addedIds.length,
      addedIds,
      alreadyTracked,
      ...(overLimit.length > 0 && { overLimit, limit: MAX_KEYWORDS_PER_CONFIG }),
      scheduledEstimate: isScheduledRankTrackingInterval(config.scheduleInterval)
        ? estimateScheduledRankCheckCost(total, config.devices, config.serpDepth, config.scheduleInterval)
        : undefined,
    };
  });
}

/** Stops tracking keywords; their past snapshots are kept. */
export function removeKeywords(db: Store, configId: string, keywordIds: string[]) {
  getValidatedConfig(db, configId);
  const uniqueIds = [...new Set(keywordIds)];
  return transaction(db, () => {
    const remove = db.prepare(`DELETE FROM rank_tracking_keywords WHERE id = ? AND config_id = ?`);
    const removedIds = uniqueIds.filter((id) => remove.run(id, configId).changes > 0);
    const notFound = uniqueIds.filter((id) => !removedIds.includes(id));
    return { removed: removedIds.length, removedIds, ...(notFound.length > 0 && { notFound }) };
  });
}

/** Cost of one manual (live) run, and of each scheduled (queued) check when the tracker has a schedule. */
export function estimateCost(db: Store, configId: string, additionalKeywordCount = 0) {
  const config = getValidatedConfig(db, configId);
  const existingKeywordCount = keywordCount(db, configId);
  const count = Math.max(existingKeywordCount, Math.min(MAX_KEYWORDS_PER_CONFIG, existingKeywordCount + additionalKeywordCount));
  const { costUsd, totalChecks } = estimateRankCheckCost(count, config.devices, config.serpDepth, "live");
  return {
    costUsd,
    keywordCount: count,
    devicesCount: devicesCount(config.devices),
    totalChecks,
    method: "live" as const,
    existingKeywordCount,
    additionalKeywordCount: count - existingKeywordCount,
    scheduledEstimate: isScheduledRankTrackingInterval(config.scheduleInterval)
      ? estimateScheduledRankCheckCost(count, config.devices, config.serpDepth, config.scheduleInterval)
      : undefined,
  };
}

/** Active trackers with their keyword count and latest run (getConfigSummaries). */
export function getConfigSummaries(db: Store) {
  const rows = db.prepare(`SELECT * FROM rank_tracking_configs WHERE is_active = 1 ORDER BY created_at, rowid`).all() as ConfigRow[];
  const latestRun = db.prepare(`SELECT status, completed_at FROM rank_check_runs WHERE config_id = ? ORDER BY started_at DESC LIMIT 1`);
  return rows.map((row) => {
    const run = latestRun.get(row.id) as { status: string; completed_at: string | null } | undefined;
    return { ...toConfig(row), keywordCount: keywordCount(db, row.id), lastRunStatus: run?.status ?? null, lastRunCompletedAt: run?.completed_at ?? null };
  });
}

/** Volume, difficulty and CPC for the tracker's keywords; a city tracker gets city-scoped volume. */
export async function refreshKeywordMetrics(db: Store, configId: string, client: DataforseoClient) {
  const config = getValidatedConfig(db, configId);
  const keywords = getKeywordsForConfig(db, configId);
  if (keywords.length === 0) return { updated: 0, missingKeywords: [] as string[] };

  const metrics = await fetchKeywordMetricsForList(client, {
    // The keyword-data APIs are case-insensitive and echo keywords back
    // lowercased, so ask in lowercase. A match-case keyword can sit next to
    // its lowercase twin; both then map to the same metrics row and the
    // request carries no duplicates.
    keywords: [...new Set(keywords.map((kw) => kw.keyword.toLowerCase()))],
    locationCode: config.locationCode,
    // Trackers can pair any SERP language with any country; the keyword-data
    // APIs only serve the country's own languages.
    languageCode: resolveKeywordDataLanguage(config.locationCode, config.languageCode),
    // Local configs get volume/CPC scoped to the tracked city; national
    // numbers can overstate local demand by orders of magnitude.
    locationName: config.locationName ?? undefined,
  });
  const byKeyword = new Map(metrics.map((metric) => [metric.keyword.toLowerCase(), metric]));
  const now = new Date().toISOString();
  return transaction(db, () => {
    const update = db.prepare(`UPDATE rank_tracking_keywords SET search_volume = ?, keyword_difficulty = ?, cpc = ?, metrics_fetched_at = ? WHERE id = ?`);
    const missingKeywords: string[] = [];
    let updated = 0;
    for (const kw of keywords) {
      const metric = byKeyword.get(kw.keyword.toLowerCase());
      if (!metric) {
        missingKeywords.push(kw.keyword);
        continue;
      }
      update.run(metric.searchVolume, metric.keywordDifficulty, metric.cpc, now, kw.id);
      updated++;
    }
    return { updated, missingKeywords };
  });
}
