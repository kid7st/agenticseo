// Ported from OpenSEO src/server/lib/dataforseo/labs.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49 (keyword overview subset).
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local change: keyword overview items are validated with a Zod schema of the
// fields keyword-metrics reads; the schema is loose, so every other field is kept.
import { z } from "zod";
import { dataforseoPost } from "./core.js";
import {
  assertOk,
  buildTaskBilling,
  parseTaskItems,
  type DataforseoApiResponse,
  type DataforseoItemsTask,
} from "./envelope.js";

// Labs payload types: the fields the app reads, typed honestly (the wire nulls
// any of them); the index signature carries everything else through untyped,
// like the SDK's item models did. These are claims about the payload, not
// validation — fields that must hold get a Zod schema (see below).

export interface LabsMonthlySearch {
  year?: number | null;
  month?: number | null;
  search_volume?: number | null;
  [key: string]: unknown;
}

export interface LabsKeywordInfo {
  search_volume?: number | null;
  cpc?: number | null;
  /** 0-1 paid-competition ratio (Google Ads reports a 0-100 index instead). */
  competition?: number | null;
  competition_level?: string | null;
  monthly_searches?: LabsMonthlySearch[] | null;
  [key: string]: unknown;
}

export interface LabsKeywordDataItem {
  keyword?: string | null;
  keyword_info?: LabsKeywordInfo | null;
  keyword_info_normalized_with_clickstream?: LabsKeywordInfo | null;
  keyword_properties?: {
    keyword_difficulty?: number | null;
    [key: string]: unknown;
  } | null;
  search_intent_info?: {
    main_intent?: string | null;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

/** keyword_overview items share the keyword-data field surface. */
export type KeywordOverviewItem = LabsKeywordDataItem;

const nullableNumber = z.number().nullable().optional();

const labsKeywordInfoSchema = z.looseObject({
  search_volume: nullableNumber,
  cpc: nullableNumber,
  competition: nullableNumber,
  competition_level: z.string().nullable().optional(),
  monthly_searches: z
    .array(
      z.looseObject({
        year: nullableNumber,
        month: nullableNumber,
        search_volume: nullableNumber,
      }),
    )
    .nullable()
    .optional(),
});

export const monthlySearchesSchema = labsKeywordInfoSchema.shape.monthly_searches;

const keywordOverviewItemSchema = z.looseObject({
  keyword: z.string().nullable().optional(),
  keyword_info: labsKeywordInfoSchema.nullable().optional(),
  keyword_info_normalized_with_clickstream: labsKeywordInfoSchema
    .nullable()
    .optional(),
  keyword_properties: z
    .looseObject({ keyword_difficulty: nullableNumber })
    .nullable()
    .optional(),
  search_intent_info: z
    .looseObject({ main_intent: z.string().nullable().optional() })
    .nullable()
    .optional(),
});

export async function fetchKeywordOverview(input: {
  keywords: string[];
  locationCode: number;
  languageCode: string;
  includeClickstreamData?: boolean;
}): Promise<DataforseoApiResponse<KeywordOverviewItem[]>> {
  const response = await dataforseoPost<
    DataforseoItemsTask<KeywordOverviewItem>
  >("/v3/dataforseo_labs/google/keyword_overview/live", [
    {
      keywords: input.keywords,
      location_code: input.locationCode,
      language_code: input.languageCode,
      include_clickstream_data: input.includeClickstreamData ?? false,
    },
  ]);
  const task = assertOk(response);
  return {
    data: parseTaskItems("keyword_overview", task, keywordOverviewItemSchema),
    billing: buildTaskBilling(task),
  };
}
