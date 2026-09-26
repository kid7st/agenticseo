// Ported from OpenSEO src/server/features/domain/services/domainKeywordFilters.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local changes: DomainKeywordsFilters is defined here instead of in the app's
// request schema, which this CLI does not port. Include terms match any term
// (one OR group), like backlinks, instead of requiring every term.
import {
  assertFilterConditionBudget,
  buildIncludeOrGroup,
  collectNumericRange,
  escapeLikeTerm,
  joinClauses,
  parseFilterTerms,
  type FilterClause,
} from "../dataforseo/filters.js";
import type { ScopeFilter } from "../dataforseo/researchScopeFilters.js";

/** From OpenSEO src/types/schemas/domain.ts (domainKeywordsFiltersSchema). */
export type DomainKeywordsFilters = {
  include?: string;
  exclude?: string;
  minTraffic?: number;
  maxTraffic?: number;
  minVol?: number;
  maxVol?: number;
  minCpc?: number;
  maxCpc?: number;
  minKd?: number;
  maxKd?: number;
  minRank?: number;
  maxRank?: number;
};

export type DomainKeywordsSortMode =
  | "rank"
  | "traffic"
  | "volume"
  | "score"
  | "cpc";
export type DomainKeywordsSortOrder = "asc" | "desc";

const SORT_FIELD_BY_MODE: Record<DomainKeywordsSortMode, string> = {
  rank: "ranked_serp_element.serp_item.rank_absolute",
  traffic: "ranked_serp_element.serp_item.etv",
  volume: "keyword_data.keyword_info.search_volume",
  score: "keyword_data.keyword_properties.keyword_difficulty",
  cpc: "keyword_data.keyword_info.cpc",
};

export function buildOrderBy(
  sortMode: DomainKeywordsSortMode,
  sortOrder: DomainKeywordsSortOrder,
): string[] {
  return [`${SORT_FIELD_BY_MODE[sortMode]},${sortOrder}`];
}

/**
 * Include terms form one OR group (a keyword matches any of them); each
 * exclude term is one not_ilike clause; numeric ranges add one per
 * bound; the free-text search term adds one OR-group of two (keyword OR url).
 * Scope clauses (research scope narrowing) are ANDed in front and consume
 * part of the same budget. The client surfaces the same condition count and
 * disables Apply when over the DataForSEO budget.
 */
export function buildKeywordFilters(
  filters: DomainKeywordsFilters,
  searchTerm?: string,
  scopeFilter?: ScopeFilter,
): unknown[] {
  const conditions: FilterClause[] = [];

  const includeGroup = buildIncludeOrGroup("keyword_data.keyword", filters.include);
  if (includeGroup) conditions.push(includeGroup.clause);
  for (const term of parseFilterTerms(filters.exclude)) {
    conditions.push([
      "keyword_data.keyword",
      "not_ilike",
      `%${escapeLikeTerm(term)}%`,
    ]);
  }

  collectNumericRange(
    conditions,
    "keyword_data.keyword_info.search_volume",
    filters.minVol,
    filters.maxVol,
  );
  collectNumericRange(
    conditions,
    "ranked_serp_element.serp_item.etv",
    filters.minTraffic,
    filters.maxTraffic,
  );
  collectNumericRange(
    conditions,
    "keyword_data.keyword_info.cpc",
    filters.minCpc,
    filters.maxCpc,
  );
  collectNumericRange(
    conditions,
    "keyword_data.keyword_properties.keyword_difficulty",
    filters.minKd,
    filters.maxKd,
  );
  collectNumericRange(
    conditions,
    "ranked_serp_element.serp_item.rank_absolute",
    filters.minRank,
    filters.maxRank,
  );

  const trimmedSearch = searchTerm?.trim();
  const searchGroup = trimmedSearch ? buildSearchGroup(trimmedSearch) : null;

  // The OR groups cost one slot per term (search: 2); scope clauses cost their
  // reported count; everything else is 1.
  assertFilterConditionBudget(
    (scopeFilter?.conditionCount ?? 0) +
      conditions.length +
      (includeGroup ? includeGroup.conditionCount - 1 : 0) +
      (searchGroup ? 2 : 0),
  );

  return joinClauses(
    [
      ...(scopeFilter?.clauses ?? []),
      ...conditions,
      ...(searchGroup ? [searchGroup] : []),
    ],
    "and",
  );
}

function buildSearchGroup(term: string): FilterClause {
  const escaped = escapeLikeTerm(term);
  return [
    ["keyword_data.keyword", "ilike", `%${escaped}%`],
    "or",
    ["ranked_serp_element.serp_item.url", "ilike", `%${escaped}%`],
  ];
}
