// Ported from OpenSEO src/server/features/domain/services/domainKeywordsPage.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local changes: a client ledger and file cache replace the billing customer and
// R2; organization and project ids leave the cache key; the cache write is awaited.
import { z } from "zod";
import { buildCacheKey, type Cache } from "../cache.js";
import type { DataforseoClient } from "../dataforseo/client.js";
import { parseResearchTargetOrThrow } from "../domainUtils.js";
import { buildRankedKeywordsScopeFilter } from "../dataforseo/researchScopeFilters.js";
import type { ResearchScope } from "../researchScope.js";
import { mapKeywordItem } from "./domainKeywordMapper.js";
import { computeHasMore } from "./pagination.js";
import {
  buildKeywordFilters,
  buildOrderBy,
  type DomainKeywordsFilters,
  type DomainKeywordsSortMode,
  type DomainKeywordsSortOrder,
} from "./domainKeywordFilters.js";

const DOMAIN_KEYWORDS_PAGE_TTL_SECONDS = 12 * 60 * 60;

const domainKeywordsPageResultSchema = z.object({
  domain: z.string(),
  page: z.number(),
  pageSize: z.number(),
  totalCount: z.number().nullable(),
  hasMore: z.boolean(),
  keywords: z.array(
    z.object({
      keyword: z.string(),
      position: z.number().nullable(),
      searchVolume: z.number().nullable(),
      traffic: z.number().nullable(),
      cpc: z.number().nullable(),
      url: z.string().nullable(),
      relativeUrl: z.string().nullable(),
      keywordDifficulty: z.number().nullable(),
    }),
  ),
  fetchedAt: z.string(),
});

type DomainKeywordsPageResult = z.infer<typeof domainKeywordsPageResultSchema>;

export async function getKeywordsPage(
  input: {
    domain: string;
    scope?: ResearchScope;
    locationCode: number;
    languageCode: string;
    page: number;
    pageSize: number;
    sortMode: DomainKeywordsSortMode;
    sortOrder: DomainKeywordsSortOrder;
    filters: DomainKeywordsFilters;
    search?: string;
  },
  context: { client: DataforseoClient; cache: Cache },
): Promise<DomainKeywordsPageResult> {
  const target = parseResearchTargetOrThrow(input.domain, input.scope);
  const scopeFilter = buildRankedKeywordsScopeFilter(target);
  const offset = (input.page - 1) * input.pageSize;
  const orderBy = buildOrderBy(input.sortMode, input.sortOrder);
  const filters = buildKeywordFilters(input.filters, input.search, scopeFilter);

  const cacheKey = await buildCacheKey("domain:keywords-page", {
    domain: target.hostname,
    scope: target.scope,
    path: target.path,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    page: input.page,
    pageSize: input.pageSize,
    sortMode: input.sortMode,
    sortOrder: input.sortOrder,
    filters: input.filters,
    search: input.search,
  });

  const cachedRaw = await context.cache.get(cacheKey);
  const cached = domainKeywordsPageResultSchema.safeParse(cachedRaw);
  if (cached.success) {
    return cached.data;
  }

  const response = await context.client.domain.rankedKeywords({
    target: target.hostname,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    limit: input.pageSize,
    offset,
    orderBy,
    filters: filters.length > 0 ? filters : undefined,
  });

  const keywords = response.items
    .map((item) => mapKeywordItem(item))
    .filter(
      (item): item is NonNullable<ReturnType<typeof mapKeywordItem>> =>
        item != null,
    );

  const totalCount = response.totalCount;
  const hasMore = computeHasMore(
    offset,
    response.items.length,
    totalCount,
    input.pageSize,
  );

  const result: DomainKeywordsPageResult = {
    domain: target.hostname,
    page: input.page,
    pageSize: input.pageSize,
    totalCount,
    hasMore,
    keywords,
    fetchedAt: new Date().toISOString(),
  };

  await context.cache.set(cacheKey, result, DOMAIN_KEYWORDS_PAGE_TTL_SECONDS);

  return result;
}
