// Ported from OpenSEO src/server/mcp/tools/local-seo-tools.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49 (business location, category cache and local rank
// grid helpers and the rank grid input schema; the handlers live in src/local.ts).
// Local change: the grid schema omits projectId and languageCode, which the CLI
// resolves from the project.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
import { z } from "zod";
import {
  formatBusinessDataCoordinate,
  readPath,
  type businessDataNearSchema,
} from "./local-seo-shared.js";

type BusinessLocationArgs = {
  near?: z.infer<typeof businessDataNearSchema>;
  locationCode?: number;
  languageCode?: string;
};

/** Coordinate when `near` is supplied, otherwise the project's market. */
export function resolveBusinessLocation(
  args: BusinessLocationArgs,
  project: { locationCode: number; languageCode: string },
) {
  return {
    locationCoordinate: args.near
      ? formatBusinessDataCoordinate(args.near)
      : undefined,
    locationCode: args.near
      ? undefined
      : (args.locationCode ?? project.locationCode),
    languageCode: args.languageCode ?? project.languageCode,
  };
}

export function readString(source: unknown, key: string): string | null {
  const value = readPath(source, key);
  return typeof value === "string" ? value : null;
}

export function resultItems(result: Record<string, unknown> | null): unknown[] {
  const items = result?.items;
  return Array.isArray(items) ? items : [];
}

export const BUSINESS_CATEGORIES_CACHE_NAMESPACE = "local:business-categories";
export const BUSINESS_CATEGORIES_TTL_SECONDS = 7 * 24 * 60 * 60;

export const cachedCategoriesSchema = z.array(
  z.object({ category: z.string(), businessCount: z.number().nullable() }),
);

// Degrees per kilometre. Longitude degrees shrink with latitude; the cosine is
// floored so a near-polar center can't blow the spacing up.
const KM_PER_DEGREE_LATITUDE = 110.574;
const KM_PER_DEGREE_LONGITUDE = 111.32;
const MIN_LONGITUDE_COSINE = 0.01;
export const RANK_GRID_DEPTH = 20;
export const RANK_GRID_CONCURRENCY = 3;
// Without an explicit zoom DataForSEO infers one per coordinate, which yields
// "No Search Results" for some points and makes ranks incomparable across the
// grid. A fixed zoom fails the other way: a mobile viewport at zoom 14 spans
// only ~±1.5 km east-west at mid latitudes, so a business one 2-3 km grid step
// to the side falls outside the viewport and reads as "not ranked" (verified
// live: a rank-3 business vanished at zoom 14 and reappeared at zoom 12).
// Derive the zoom from the spacing instead: a world tile is 40075·cos(lat)/2^z
// km wide and a portrait viewport ~1.5 tiles, so the largest zoom whose
// viewport still spans ~1.25× the spacing is log2(24045·cos(lat)/spacing).
const RANK_GRID_ZOOM_NUMERATOR_KM = 24045;
const MIN_RANK_GRID_ZOOM = 4;
const MAX_RANK_GRID_ZOOM = 18;

export function rankGridZoom(spacingKm: number, latitude: number): number {
  const cosine = Math.max(
    Math.abs(Math.cos((latitude * Math.PI) / 180)),
    MIN_LONGITUDE_COSINE,
  );
  const zoom = Math.floor(
    Math.log2((RANK_GRID_ZOOM_NUMERATOR_KM * cosine) / spacingKm),
  );
  return Math.min(MAX_RANK_GRID_ZOOM, Math.max(MIN_RANK_GRID_ZOOM, zoom));
}

export type GridPoint = {
  row: number;
  col: number;
  latitude: number;
  longitude: number;
};

export type GridPointResult = GridPoint & {
  rank: number | null;
  // How many businesses the SERP returned there, and who ranked first: a null
  // rank with a full result set means outranked; with a near-empty one it
  // means a sparse SERP. Both absent when the point's search failed.
  resultsCount?: number;
  topResult?: { title: string | null; cid: string | null } | null;
  error?: boolean;
};

export function buildRankGridPoints(
  center: { latitude: number; longitude: number },
  gridSize: number,
  spacingKm: number,
): GridPoint[] {
  const middle = (gridSize - 1) / 2;
  const latitudeStep = spacingKm / KM_PER_DEGREE_LATITUDE;
  const longitudeStep =
    spacingKm /
    (KM_PER_DEGREE_LONGITUDE *
      Math.max(
        Math.abs(Math.cos((center.latitude * Math.PI) / 180)),
        MIN_LONGITUDE_COSINE,
      ));

  const points: GridPoint[] = [];
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      points.push({
        row,
        col,
        // Row 0 is the northernmost line so the rendered grid reads like a map.
        latitude: Number(
          (center.latitude + (middle - row) * latitudeStep).toFixed(7),
        ),
        longitude: Number(
          (center.longitude + (col - middle) * longitudeStep).toFixed(7),
        ),
      });
    }
  }
  return points;
}

export function matchGridItem(
  items: unknown[],
  target: { cid?: string; placeId?: string; name?: string },
) {
  const name = target.name?.toLowerCase();
  return items.find((item) => {
    if (target.cid != null && readPath(item, "cid") === target.cid) return true;
    if (target.placeId != null && readPath(item, "place_id") === target.placeId)
      return true;
    if (name == null) return false;
    const title = readPath(item, "title");
    return typeof title === "string" && title.toLowerCase().includes(name);
  });
}

// A per-point failure usually means only that point's SERP failed, but these
// codes mean every remaining call would fail (and possibly bill) the same way —
// surface them instead of rendering a misleading grid.
export const GRID_ABORT_ERROR_CODES = new Set<string>([
  "INSUFFICIENT_CREDITS",
  "DATAFORSEO_AUTH_FAILED",
]);

export const localRankGridInputSchema = z.object({
  keyword: z
    .string()
    .min(1)
    .max(120)
    .describe("Search query to run on Google Maps at every grid point."),
  target: z
    .object({
      cid: z
        .string()
        .min(1)
        .max(64)
        .optional()
        .describe("Match rows whose cid equals this value (most reliable)."),
      placeId: z
        .string()
        .min(1)
        .max(256)
        .optional()
        .describe("Match rows whose place_id equals this value."),
      name: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe(
          "Match rows whose title contains this text (case-insensitive). Used only when cid/placeId do not match.",
        ),
    })
    .describe(
      "The business to locate in each result set. Supply at least one of cid, placeId, or name.",
    ),
  center: z
    .object({
      latitude: z.number().min(-90).max(90).describe("Latitude of the center."),
      longitude: z
        .number()
        .min(-180)
        .max(180)
        .describe("Longitude of the center."),
    })
    .describe("Coordinate the grid is centered on (usually the storefront)."),
  gridSize: z
    .union([z.literal(3), z.literal(5)])
    .optional()
    .describe("Grid width: 3 (9 searches) or 5 (25 searches). Defaults to 3."),
  spacingKm: z
    .number()
    .min(0.25)
    .max(10)
    .optional()
    .describe(
      "Distance between neighbouring grid points, in km. Defaults to 2.",
    ),
  device: z
    .enum(["desktop", "mobile"])
    .optional()
    .describe("Device the SERP is rendered for. Defaults to mobile."),
  zoom: z
    .number()
    .int()
    .min(4)
    .max(18)
    .optional()
    .describe(
      "Map zoom every point is searched at. Defaults to a zoom derived from spacingKm and latitude so each point's viewport spans the grid spacing; override only when you need a specific viewport.",
    ),
});
