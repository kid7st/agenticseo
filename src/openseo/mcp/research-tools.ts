// Ported from OpenSEO src/server/mcp/tools/dataforseo-research-tools.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49 (argument schemas, sorting and filter helpers
// of get_ranked_keywords, find_serp_competitors and the local business, local SERP
// and Q&A tools).
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local changes: Array.prototype.toSorted replaces remeda's sort, and the sort
// argument types are named here instead of derived from the MCP input schemas.
import { z } from "zod";
import { assertFilterConditionBudget } from "../dataforseo/filters.js";
import type { ScopeFilter } from "../dataforseo/researchScopeFilters.js";
import { formatCoordinate, pickRowFields, readPath } from "./local-seo-shared.js";

export type RankedSortBy = "rank" | "search_volume" | "traffic_estimate" | "cpc";
export type CompetitorSortBy = "visibility" | "traffic_estimate" | "avg_position" | "keyword_count";

export const rankedResultTypeSchema = z.enum([
  "organic",
  "paid",
  "featured_snippet",
  "local_pack",
  "ai_overview_reference",
]);

export const serpCompetitorResultTypeSchema = z.enum([
  "organic",
  "paid",
  "featured_snippet",
  "local_pack",
]);

export const domainTargetSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      /^(?!https?:\/\/)(?!www\.)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(
        value,
      ),
    "Use a domain or subdomain without protocol and without www.",
  );

export const rankedTargetSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (value) =>
      /^https?:\/\/\S+$/.test(value) ||
      domainTargetSchema.safeParse(value).success,
    "Use a domain without protocol/www or an absolute page URL.",
  );

export function sortOrderByRankedMode(
  sortBy: RankedSortBy = "search_volume",
): string[] {
  switch (sortBy) {
    case "rank":
      return ["ranked_serp_element.serp_item.rank_absolute,asc"];
    case "traffic_estimate":
      return ["ranked_serp_element.serp_item.etv,desc"];
    case "cpc":
      return ["keyword_data.keyword_info.cpc,desc"];
    case "search_volume":
      return ["keyword_data.keyword_info.search_volume,desc"];
  }
}

function pushAnd(filters: unknown[], condition: unknown[]) {
  if (filters.length > 0) filters.push("and");
  filters.push(condition);
}

export function buildRankedKeywordFilters(
  args: {
    minSearchVolume?: number;
    maxRank?: number;
    excludeBrandTerms?: string[];
  },
  scopeFilter?: ScopeFilter,
) {
  const filters: unknown[] = [];
  let conditionCount = 0;
  if (scopeFilter) {
    for (const clause of scopeFilter.clauses) pushAnd(filters, clause);
    conditionCount += scopeFilter.conditionCount;
  }
  if (args.minSearchVolume != null) {
    pushAnd(filters, [
      "keyword_data.keyword_info.search_volume",
      ">=",
      args.minSearchVolume,
    ]);
    conditionCount += 1;
  }
  if (args.maxRank != null) {
    pushAnd(filters, [
      "ranked_serp_element.serp_item.rank_absolute",
      "<=",
      args.maxRank,
    ]);
    conditionCount += 1;
  }
  if (args.excludeBrandTerms != null) {
    for (const term of args.excludeBrandTerms) {
      pushAnd(filters, ["keyword_data.keyword", "not_ilike", `%${term}%`]);
    }
    conditionCount += args.excludeBrandTerms.length;
  }
  assertFilterConditionBudget(conditionCount);
  return filters.length > 0 ? filters : undefined;
}

export function sortCompetitors<T extends Record<string, unknown>>(
  items: T[],
  sortBy: CompetitorSortBy,
) {
  const field =
    sortBy === "avg_position"
      ? "avg_position"
      : sortBy === "keyword_count"
        ? "keywords_count"
        : sortBy === "traffic_estimate"
          ? "etv"
          : "visibility";
  const direction = sortBy === "avg_position" ? 1 : -1;
  return items.toSorted((a, b) => {
    const aValue = typeof a[field] === "number" ? a[field] : 0;
    const bValue = typeof b[field] === "number" ? b[field] : 0;
    return (aValue - bValue) * direction;
  });
}

export function hostMatchesDomain(host: string, domain: string): boolean {
  const normalizedHost = host.replace(/^www\./, "").toLowerCase();
  const normalizedDomain = domain.replace(/^www\./, "").toLowerCase();
  return (
    normalizedHost === normalizedDomain ||
    normalizedHost.endsWith(`.${normalizedDomain}`)
  );
}

export const nearSchema = z
  .object({
    latitude: z
      .number()
      .min(-90)
      .max(90)
      .describe("Latitude of the search center."),
    longitude: z
      .number()
      .min(-180)
      .max(180)
      .describe("Longitude of the search center."),
    radiusKm: z
      .number()
      .min(1)
      .max(100000)
      .describe(
        "Search radius around the center, in whole kilometers (fractions are rounded).",
      ),
  })
  .describe("Coordinate and radius to search around.");

export function formatBusinessLocationCoordinate(near: z.infer<typeof nearSchema>) {
  // Business Listings rejects fractional radii ("Invalid Field:
  // 'location_coordinate'"), unlike the meter-based business_data radius.
  const radiusKm = Math.max(1, Math.round(near.radiusKm));
  return `${formatCoordinate(near.latitude)},${formatCoordinate(near.longitude)},${radiusKm}`;
}

export function buildLocalBusinessFilters(args: {
  minRating?: number;
  minReviews?: number;
}) {
  const filters: unknown[] = [];
  if (args.minRating != null) {
    pushAnd(filters, ["rating.value", ">=", args.minRating]);
  }
  if (args.minReviews != null) {
    pushAnd(filters, ["rating.votes_count", ">=", args.minReviews]);
  }
  return filters.length > 0 ? filters : undefined;
}

export function localBusinessOrderBy(
  sortBy: "relevance" | "rating" | "reviews" | undefined,
): string[] | undefined {
  switch (sortBy) {
    case "rating":
      return ["rating.value,desc"];
    case "reviews":
      return ["rating.votes_count,desc"];
    default:
      return undefined;
  }
}

// Full Business Listings rows are ~9KB each (popular_times for every day,
// attribute trees, photo URLs) — 10 of them overflow MCP clients' tool-result
// budgets. Return only the fields a candidate list needs; get_business_profile
// serves the full shape for one business.
export const LOCAL_BUSINESS_ROW_FIELDS = [
  "title",
  "description",
  "category",
  "additional_categories",
  "address",
  "phone",
  "url",
  "domain",
  "rating",
  "is_claimed",
  "cid",
  "place_id",
  "latitude",
  "longitude",
  "total_photos",
  "check_url",
] as const;

// Maps SERP rows likewise ship image CDN URLs, feature ids, and contributor
// links no consumer reads; keep identity, rank, rating, categories, and hours.
export const LOCAL_SERP_ROW_FIELDS = [
  "rank_group",
  "rank_absolute",
  "title",
  "domain",
  "url",
  "contact_url",
  "address",
  "address_info",
  "phone",
  "category",
  "additional_categories",
  "rating",
  "rating_distribution",
  "price_level",
  "is_claimed",
  "cid",
  "place_id",
  "latitude",
  "longitude",
  "total_photos",
  "work_hours",
  "local_justifications",
] as const;

// Q&A rows carry a ~300-char uule URL plus avatar/contributor links on every
// question AND every nested answer; keep the text, author, and timing.
const BUSINESS_QUESTION_ROW_FIELDS = [
  "rank_absolute",
  "question_id",
  "question_text",
  "original_question_text",
  "profile_name",
  "time_ago",
  "timestamp",
] as const;

const BUSINESS_ANSWER_ROW_FIELDS = [
  "answer_id",
  "answer_text",
  "original_answer_text",
  "profile_name",
  "time_ago",
  "timestamp",
] as const;

export function trimBusinessQuestionRow(row: unknown): Record<string, unknown> {
  const trimmed = pickRowFields(row, BUSINESS_QUESTION_ROW_FIELDS);
  const answers = readPath(row, "items");
  trimmed.items = Array.isArray(answers)
    ? answers.map((answer) => pickRowFields(answer, BUSINESS_ANSWER_ROW_FIELDS))
    : null;
  return trimmed;
}

export const localSerpNearSchema = z
  .object({
    latitude: z
      .number()
      .min(-90)
      .max(90)
      .describe("Latitude the SERP is fetched from."),
    longitude: z
      .number()
      .min(-180)
      .max(180)
      .describe("Longitude the SERP is fetched from."),
    zoom: z
      .number()
      .int()
      .min(4)
      .max(18)
      .optional()
      .describe("Map zoom level (4-18). Higher zoom narrows the local area."),
  })
  .describe("Coordinate (and optional map zoom) the SERP is fetched from.");
