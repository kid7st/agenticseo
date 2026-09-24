import { OperationError } from "./errors.js";
import { createFileCache } from "./openseo/cache.js";
import { fetchSerpLocationsForCountry } from "./openseo/dataforseo/serp-locations.js";
import {
  addKeywords,
  createConfig,
  estimateCost,
  getConfigSummaries,
  getKeywordsForConfig,
  getValidatedConfig,
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
  return withStore(root, (db) => ({ trackers: getConfigSummaries(db) }));
}

export async function showTracker(root: string, trackerId: string) {
  return withStore(root, (db) => ({ tracker: getValidatedConfig(db, trackerId), keywords: getKeywordsForConfig(db, trackerId) }));
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
