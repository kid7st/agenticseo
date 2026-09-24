// Ported from OpenSEO src/server/lib/dataforseo/serp.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49 (live organic and local SERP subset).
// Local change: local SERP rows are validated as records before callers read them.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
import { z } from "zod";
import { dataforseoPost } from "./core.js";
import {
  assertOk,
  buildTaskBilling,
  parseTaskItems,
  type DataforseoApiResponse,
  type DataforseoItemsTask,
} from "./envelope.js";

// Default depth for keyword SERP analysis. DataForSEO crawls (and bills) one
// Google page of 10 results at a time, and the crawls are sequential, so depth
// is the single lever on both latency and cost here: every 10 results is
// another page fetch against the shared 60s request budget. Keep this low —
// callers that need to see deeper ranks pass an explicit depth. There is no
// offset/cursor: a deeper request re-crawls pages 1..N/10 from the top, so it
// replaces the shallow snapshot rather than extending it.
export const SERP_ANALYSIS_DEPTH = 20;

/** DataForSEO bills SERPs in pages of 10; depth outside 10-100 is rejected. */
function clampSerpDepth(depth: number): number {
  return Math.min(100, Math.max(10, depth));
}

// Kept as a hand-written schema: the SDK's BaseSerpApiElementItem type omits
// etv / estimated_paid_traffic_cost / backlinks_info / rank_changes, which we
// rely on. The fields survive deserialization (the SDK copies unknown keys), so
// validating here is both our type-safety guard and how we read those fields.
const serpSnapshotItemSchema = z
  .object({
    type: z.string(),
    rank_group: z.number().nullable().optional(),
    rank_absolute: z.number().nullable().optional(),
    domain: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    breadcrumb: z.string().nullable().optional(),
    etv: z.number().nullable().optional(),
    estimated_paid_traffic_cost: z.number().nullable().optional(),
    backlinks_info: z
      .object({
        referring_domains: z.number().nullable().optional(),
        backlinks: z.number().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    rank_changes: z
      .object({
        previous_rank_absolute: z.number().nullable().optional(),
        is_new: z.boolean().nullable().optional(),
        is_up: z.boolean().nullable().optional(),
        is_down: z.boolean().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export type SerpLiveItem = z.infer<typeof serpSnapshotItemSchema>;

export async function fetchLiveSerp(input: {
  keyword: string;
  locationCode: number;
  languageCode: string;
  depth?: number;
}): Promise<DataforseoApiResponse<SerpLiveItem[]>> {
  const response = await dataforseoPost(
    "/v3/serp/google/organic/live/advanced",
    [
      {
        keyword: input.keyword,
        location_code: input.locationCode,
        language_code: input.languageCode,
        device: "desktop",
        os: "windows",
        depth: clampSerpDepth(input.depth ?? SERP_ANALYSIS_DEPTH),
      },
    ],
  );
  // DataForSEO uses a task error for a valid empty SERP. Keep the charged
  // response in the normal billing path and return an empty item list.
  const task = assertOk(response, { treatNoResultsAsEmpty: true });
  return {
    data: parseTaskItems(
      "google-organic-live-advanced",
      task,
      serpSnapshotItemSchema,
    ),
    billing: buildTaskBilling(task),
  };
}

// Local SERP rows stay untyped records; callers pick fields by name.
const localSerpItemSchema = z.record(z.string(), z.unknown());

export async function fetchLocalSerp(input: {
  keyword: string;
  locationCoordinate?: string;
  languageCode: string;
  searchType: "maps" | "local_finder";
  device: "desktop" | "mobile";
  depth: number;
  searchPlaces?: boolean;
}): Promise<DataforseoApiResponse<Record<string, unknown>[]>> {
  const os = input.device === "desktop" ? "windows" : "android";

  if (input.searchType === "maps") {
    const response = await dataforseoPost<
      DataforseoItemsTask<Record<string, unknown>>
    >("/v3/serp/google/maps/live/advanced", [
      {
        keyword: input.keyword,
        location_coordinate: input.locationCoordinate,
        language_code: input.languageCode,
        device: input.device,
        os,
        depth: input.depth,
        search_places: input.searchPlaces,
      },
    ]);
    // 40501 = billed empty SERP; DataForSEO returns it for some coordinate-only
    // Maps and Local Finder queries (both paths below opt in).
    const task = assertOk(response, { treatNoResultsAsEmpty: true });
    return {
      data: parseTaskItems("google-maps-live-advanced", task, localSerpItemSchema),
      billing: buildTaskBilling(task),
    };
  }

  const response = await dataforseoPost<
    DataforseoItemsTask<Record<string, unknown>>
  >("/v3/serp/google/local_finder/live/advanced", [
    {
      keyword: input.keyword,
      location_coordinate: input.locationCoordinate,
      language_code: input.languageCode,
      device: input.device,
      os,
      depth: input.depth,
    },
  ]);
  const task = assertOk(response, { treatNoResultsAsEmpty: true });
  return {
    data: parseTaskItems("google-local-finder-live-advanced", task, localSerpItemSchema),
    billing: buildTaskBilling(task),
  };
}
