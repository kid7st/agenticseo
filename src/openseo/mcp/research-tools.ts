// Ported from OpenSEO src/server/mcp/tools/dataforseo-research-tools.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49 (argument schemas, sorting and filter helpers
// of get_ranked_keywords and find_serp_competitors).
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local changes: Array.prototype.toSorted replaces remeda's sort, and the sort
// argument types are named here instead of derived from the MCP input schemas.
import { z } from "zod";
import { assertFilterConditionBudget } from "../dataforseo/filters.js";
import type { ScopeFilter } from "../dataforseo/researchScopeFilters.js";

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
