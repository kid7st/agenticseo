// Ported from OpenSEO src/server/lib/dataforseo/serp-locations.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local change: the slimmed list is cached in the project's file cache instead of
// Workers KV; in-isolate fill coalescing is not needed for one CLI process.
import { z } from "zod";
import type { Cache } from "../cache.js";
import { dataforseoGet } from "./core.js";
import { assertOk } from "./envelope.js";
import { formatLocationLabel } from "../keyword-locations.js";

export interface SerpLocationResult {
  locationCode: number;
  locationName: string;
  locationType: string;
  displayLabel: string;
}

// Sub-country granularities users actually target. Deliberately excludes
// Postal Code (~32k extra rows for the US alone), State (national-ish), and
// long-tail types like Airport / University.
const INCLUDED_LOCATION_TYPES = new Set([
  "City",
  "County",
  "Municipality",
  "DMA Region",
  "Region",
]);

const locationItemSchema = z.object({
  location_code: z.number(),
  location_name: z.string(),
  location_type: z.string().nullable().optional(),
});

const cachedLocationsSchema = z.array(
  z.object({
    locationCode: z.number(),
    locationName: z.string(),
    locationType: z.string(),
    displayLabel: z.string(),
  }),
);

/** Google refreshes geotargets roughly quarterly; 30 days keeps us current. */
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Full sub-country location list for one country. `countryCode` is ISO
 * 3166-1 alpha-2 ("us", "gb") — the endpoint rejects country *names* with a
 * task-level Invalid Field error, which assertOk surfaces.
 *
 * The DataForSEO response is ~9.5MB for the US and the endpoint has no search
 * parameter, so the slimmed list (~1.5MB) is cached for 30 days; only a miss
 * pays the origin fetch. The endpoint is free (cost 0), so no billing envelope.
 */
export async function fetchSerpLocationsForCountry(
  countryCode: string,
  cache: Cache,
): Promise<SerpLocationResult[]> {
  const iso = countryCode.toLowerCase();
  const key = `serp-locations-${iso}`;
  const hit = cachedLocationsSchema.safeParse(await cache.get(key));
  if (hit.success) return hit.data;

  const fresh = await fetchFromDataforseo(iso);
  await cache.set(key, fresh, CACHE_TTL_SECONDS);
  return fresh;
}

async function fetchFromDataforseo(iso: string): Promise<SerpLocationResult[]> {
  const response = await dataforseoGet(
    `/v3/serp/google/locations/${encodeURIComponent(iso)}`,
  );
  const task = assertOk(response);
  return (task.result ?? [])
    .map((item: unknown) => locationItemSchema.safeParse(item))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
    .filter((item) => INCLUDED_LOCATION_TYPES.has(item.location_type ?? ""))
    .map((item) => ({
      locationCode: item.location_code,
      locationName: item.location_name,
      displayLabel: formatLocationLabel(item.location_name),
      locationType: item.location_type ?? "",
    }));
}
