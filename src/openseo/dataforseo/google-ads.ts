// Ported from OpenSEO src/server/lib/dataforseo/google-ads.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49 (search volume subset).
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local change: search volume items are validated with a loose Zod schema of the
// fields keyword-metrics reads.
import { z } from "zod";
import { AppError } from "../platform.js";
import { dataforseoPost } from "./core.js";
import { monthlySearchesSchema, type LabsMonthlySearch } from "./labs.js";
import {
  assertOk,
  buildTaskBilling,
  type DataforseoApiResponse,
  type DataforseoTaskLike,
} from "./envelope.js";

const nullableNumber = z.number().nullable().optional();

const adsKeywordItemSchema = z.looseObject({
  keyword: z.string().nullable().optional(),
  search_volume: nullableNumber,
  cpc: nullableNumber,
  competition: z.string().nullable().optional(),
  competition_index: nullableNumber,
  monthly_searches: monthlySearchesSchema,
});

// Google Ads keyword data for countries DataForSEO Labs doesn't cover (see
// specs/0004-keyword-data-source-routing.md). Flat-priced per request; items
// carry volume / CPC / competition but no keyword difficulty or intent.
export interface AdsKeywordItem {
  keyword?: string | null;
  search_volume?: number | null;
  cpc?: number | null;
  /** "LOW" | "MEDIUM" | "HIGH" bucket (Labs reports a 0-1 ratio instead). */
  competition?: string | null;
  /** 0-100 competition scale; the app stores a 0-1 ratio. */
  competition_index?: number | null;
  monthly_searches?: LabsMonthlySearch[] | null;
  [key: string]: unknown;
}

type KeywordsDataTask<T> = DataforseoTaskLike & { result?: T[] };

function taskItems<T>(task: KeywordsDataTask<T>): T[] {
  // keywords_data tasks return keyword items directly in `result` (no nested
  // `items` wrapper like Labs).
  return task.result ?? [];
}

export async function fetchAdsSearchVolume(input: {
  keywords: string[];
  locationCode: number;
  languageCode: string;
  /**
   * Canonical DataForSEO location_name (e.g. "Pittsburgh,Pennsylvania,United
   * States"). Google Ads accepts any geotarget, so this scopes volume / CPC /
   * competition to a city or region instead of the whole country.
   */
  locationName?: string;
}): Promise<DataforseoApiResponse<AdsKeywordItem[]>> {
  const locationParams = input.locationName
    ? { location_name: input.locationName }
    : { location_code: input.locationCode };
  const response = await dataforseoPost<KeywordsDataTask<AdsKeywordItem>>(
    "/v3/keywords_data/google_ads/search_volume/live",
    [
      {
        keywords: input.keywords,
        ...locationParams,
        language_code: input.languageCode,
      },
    ],
  );
  const task = assertOk(response);
  const items = z.array(adsKeywordItemSchema).safeParse(taskItems(task));
  if (!items.success) {
    throw new AppError(
      "INTERNAL_ERROR",
      `DataForSEO google_ads search_volume returned an invalid response shape: ${items.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}`,
    );
  }
  return {
    data: items.data,
    billing: buildTaskBilling(task),
  };
}
