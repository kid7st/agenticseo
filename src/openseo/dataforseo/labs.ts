// Ported from OpenSEO src/server/lib/dataforseo/labs.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49 (keyword overview and keyword research subset).
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local change: items are validated with loose Zod schemas of the fields the
// callers read, so every other field is kept.
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

/** related_keywords wraps the keyword payload one level deeper. */
type RelatedKeywordItem = {
  keyword_data?: LabsKeywordDataItem | null;
  [key: string]: unknown;
};

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

const keywordDataItemSchema = z.looseObject({
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

const relatedKeywordItemSchema = z.looseObject({
  keyword_data: keywordDataItemSchema.nullable().optional(),
});

export async function fetchRelatedKeywords(input: {
  keyword: string;
  locationCode: number;
  languageCode: string;
  limit: number;
  depth?: number;
  includeClickstreamData?: boolean;
}): Promise<DataforseoApiResponse<RelatedKeywordItem[]>> {
  const response = await dataforseoPost<
    DataforseoItemsTask<RelatedKeywordItem>
  >("/v3/dataforseo_labs/google/related_keywords/live", [
    {
      keyword: input.keyword,
      location_code: input.locationCode,
      language_code: input.languageCode,
      limit: input.limit,
      depth: input.depth ?? 3,
      // Clickstream-refined volumes DOUBLE the request cost, so they are
      // opt-in — see specs/0004-keyword-data-source-routing.md.
      include_clickstream_data: input.includeClickstreamData ?? false,
      include_serp_info: false,
    },
  ]);
  const task = assertOk(response);
  return {
    data: parseTaskItems("related_keywords", task, relatedKeywordItemSchema),
    billing: buildTaskBilling(task),
  };
}

export async function fetchKeywordSuggestions(input: {
  keyword: string;
  locationCode: number;
  languageCode: string;
  limit: number;
  includeClickstreamData?: boolean;
}): Promise<DataforseoApiResponse<LabsKeywordDataItem[]>> {
  const response = await dataforseoPost<
    DataforseoItemsTask<LabsKeywordDataItem>
  >("/v3/dataforseo_labs/google/keyword_suggestions/live", [
    {
      keyword: input.keyword,
      location_code: input.locationCode,
      language_code: input.languageCode,
      limit: input.limit,
      include_clickstream_data: input.includeClickstreamData ?? false,
      include_serp_info: false,
      include_seed_keyword: true,
      ignore_synonyms: false,
      exact_match: false,
    },
  ]);
  const task = assertOk(response);
  return {
    data: parseTaskItems("keyword_suggestions", task, keywordDataItemSchema),
    billing: buildTaskBilling(task),
  };
}

export async function fetchKeywordIdeas(input: {
  keyword: string;
  locationCode: number;
  languageCode: string;
  limit: number;
  includeClickstreamData?: boolean;
}): Promise<DataforseoApiResponse<LabsKeywordDataItem[]>> {
  const response = await dataforseoPost<
    DataforseoItemsTask<LabsKeywordDataItem>
  >("/v3/dataforseo_labs/google/keyword_ideas/live", [
    {
      keywords: [input.keyword],
      location_code: input.locationCode,
      language_code: input.languageCode,
      limit: input.limit,
      include_clickstream_data: input.includeClickstreamData ?? false,
      include_serp_info: false,
      ignore_synonyms: false,
      closely_variants: false,
    },
  ]);
  const task = assertOk(response);
  return {
    data: parseTaskItems("keyword_ideas", task, keywordDataItemSchema),
    billing: buildTaskBilling(task),
  };
}

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
    data: parseTaskItems("keyword_overview", task, keywordDataItemSchema),
    billing: buildTaskBilling(task),
  };
}
