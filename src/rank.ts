import { OperationError } from "./errors.js";
import { createFileCache } from "./openseo/cache.js";
import { createDataforseoClient, ledgerCost, type ProviderCall } from "./openseo/dataforseo/client.js";
import { closeDeadRuns, runLiveCheck } from "./openseo/rank-tracking/rankCheck.js";
import { getConfigTrend, getKeywordHistory, getLatestResults, getPositionMatrix, type ComparePeriod } from "./openseo/rank-tracking/rankTrackingResults.js";
import { fetchSerpLocationsForCountry } from "./openseo/dataforseo/serp-locations.js";
import {
  addKeywords,
  createConfig,
  estimateCost,
  getConfigSummaries,
  getKeywordsForConfig,
  getValidatedConfig,
  refreshKeywordMetrics,
  removeKeywords,
  updateConfig,
  type Devices,
  type ScheduleInterval,
} from "./openseo/rank-tracking/RankTrackingService.js";
import { rankSerpLocations } from "./openseo/shared/serp-location-search.js";
import { cacheDirectory } from "./project.js";
import { withStore } from "./store.js";

export type TrackerSettings = { devices?: Devices; serpDepth?: number; scheduleInterval?: ScheduleInterval };

/** OpenSEO's create_rank_tracker defaults: mobile, depth 40, manual, so creating a tracker never schedules spend. */
export async function createTracker(
  root: string,
  input: { domain: string; locationCode: number; languageCode: string; locationName?: string } & TrackerSettings,
) {
  return withStore(root, (db) =>
    createConfig(db, { ...input, devices: input.devices ?? "mobile", serpDepth: input.serpDepth ?? 40, scheduleInterval: input.scheduleInterval ?? "manual" }),
  );
}

export async function updateTracker(root: string, trackerId: string, input: Parameters<typeof updateConfig>[2]) {
  return withStore(root, (db) => updateConfig(db, trackerId, input));
}

export async function listTrackers(root: string) {
  return withStore(root, (db) => {
    closeDeadRuns(db);
    return { trackers: getConfigSummaries(db) };
  });
}

/**
 * OpenSEO's get_rank_tracker: the tracker, the latest run and each keyword's latest
 * position with the one before the comparison period. Untracked devices are omitted.
 */
export async function showTracker(root: string, trackerId: string, comparePeriod?: ComparePeriod) {
  return withStore(root, (db) => {
    closeDeadRuns(db, trackerId);
    const { config, rows, run, comparePeriod: period } = getLatestResults(db, trackerId, comparePeriod);
    return {
      tracker: config,
      latestRun: run,
      comparePeriod: period,
      keywords: rows.map(({ desktop, mobile, ...row }) => ({
        ...row,
        ...(config.devices !== "mobile" && { desktop }),
        ...(config.devices !== "desktop" && { mobile }),
      })),
    };
  });
}

/** OpenSEO's run_rank_tracker: a live check of every keyword (or the given ones) on every tracked device. */
export async function runTracker(root: string, trackerId: string, keywordIds?: string[]) {
  return withStore(root, async (db) => {
    const config = getValidatedConfig(db, trackerId);
    const run = await runLiveCheck(db, config, { keywordIds });
    return { provider: "DataForSEO", trackerId, market: { locationCode: config.locationCode, languageCode: config.languageCode, locationName: config.locationName }, run, next: `agenticseo rank show ${trackerId}` };
  });
}

const defaultDevice = (devices: Devices) => (devices === "both" ? "mobile" : devices);

export async function trackerHistory(root: string, trackerId: string, keywordId: string, sinceDays: number) {
  return withStore(root, (db) => ({ trackerId, trackingKeywordId: keywordId, sinceDays, points: getKeywordHistory(db, trackerId, keywordId, sinceDays) }));
}

export async function trackerTrend(root: string, trackerId: string, input: { device?: "desktop" | "mobile"; sinceDays: number }) {
  return withStore(root, (db) => {
    const device = input.device ?? defaultDevice(getValidatedConfig(db, trackerId).devices);
    return { trackerId, device, sinceDays: input.sinceDays, runs: getConfigTrend(db, trackerId, device, input.sinceDays) };
  });
}

export async function trackerMatrix(root: string, trackerId: string, input: { device?: "desktop" | "mobile"; runLimit: number }) {
  return withStore(root, (db) => ({ trackerId, ...getPositionMatrix(db, trackerId, input.device ?? defaultDevice(getValidatedConfig(db, trackerId).devices), input.runLimit) }));
}

/** Refresh the tracked keywords' volume, difficulty and CPC (billed by DataForSEO). */
export async function refreshTrackerMetrics(root: string, trackerId: string) {
  const calls: ProviderCall[] = [];
  const result = await withStore(root, (db) => refreshKeywordMetrics(db, trackerId, createDataforseoClient(calls)));
  return { provider: "DataForSEO", trackerId, ...result, costUsd: ledgerCost(calls), calls: calls.map(({ path, costUsd }) => ({ path, costUsd })) };
}

export async function addTrackerKeywords(root: string, trackerId: string, keywords: string[], matchCase: boolean) {
  return withStore(root, (db) => addKeywords(db, trackerId, keywords, matchCase));
}

export async function removeTrackerKeywords(root: string, trackerId: string, keywordIds: string[]) {
  return withStore(root, (db) => removeKeywords(db, trackerId, keywordIds));
}

export async function estimateTracker(root: string, trackerId: string, additionalKeywordCount: number) {
  return withStore(root, (db) => estimateCost(db, trackerId, additionalKeywordCount));
}

/** OpenSEO's search_serp_locations: the country's registry (free, cached 30 days), best ten matches. */
export async function searchLocations(root: string, query: string, countryCode: string) {
  if (query.length > 100) throw new OperationError("input", "The place name is at most 100 characters");
  const all = await fetchSerpLocationsForCountry(countryCode, createFileCache(await cacheDirectory(root)));
  const locations = rankSerpLocations(query, all, countryCode).map((location) => ({
    locationName: location.locationName,
    locationCode: location.locationCode,
    locationType: location.locationType,
  }));
  return { query, countryCode, locations };
}
