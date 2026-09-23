// Ported from OpenSEO src/server/features/backlinks/services/BacklinksService.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local changes: the service is created per command with the project cache (upstream
// defaults to R2); the local DataforseoClient replaces the billing customer; the
// organization id leaves cache keys; the credit-attribution parameter is removed.
import { buildCacheKey } from "../cache.js";
import type { DataforseoClient } from "../dataforseo/client.js";
import { normalizeBacklinksTarget } from "../dataforseoBacklinksTarget.js";
import {
  normalizeBacklinksSpamFilterOptions,
  type BacklinksLookupInput,
  type BacklinksSpamFilterOptions,
} from "./schemas.js";
import {
  profileBacklinksOverview,
  profileBacklinksRowsPage,
  profileReferringDomainsPage,
  profileTopPagesPage,
  type BacklinksCache,
  type BacklinksRowsPageServiceInput,
  type ReferringDomainsPageServiceInput,
  type TopPagesPageServiceInput,
} from "./backlinksServiceData.js";

type BacklinksPageCacheInput = {
  target: string;
  scope?: BacklinksLookupInput["scope"];
  page: number;
  pageSize: number;
  sortField: string;
  sortOrder: string;
  filters: Record<string, unknown>;
  /** Backlinks rows only: DataForSEO result grouping. */
  mode?: string;
};

export function createBacklinksService(cache: BacklinksCache) {
  return {
    async profileOverview(
      input: BacklinksLookupInput,
      dataforseo: DataforseoClient,
    ) {
      const cacheKey = await buildCacheKey("backlinks:overview", {
        ...buildTargetCacheInput(input),
      });

      return profileBacklinksOverview(cache, cacheKey, input, dataforseo);
    },
    async profileBacklinksPage(
      input: BacklinksRowsPageServiceInput,
      dataforseo: DataforseoClient,
      options?: BacklinksSpamFilterOptions,
    ) {
      const cacheKey = await buildPageCacheKey(
        "backlinks:rows-page",
        input,
        options,
      );

      return profileBacklinksRowsPage(
        cache,
        cacheKey,
        input,
        dataforseo,
        options,
      );
    },
    async profileReferringDomainsPage(
      input: ReferringDomainsPageServiceInput,
      dataforseo: DataforseoClient,
      options?: BacklinksSpamFilterOptions,
    ) {
      const cacheKey = await buildPageCacheKey(
        "backlinks:referring-domains-page",
        input,
        options,
      );

      return profileReferringDomainsPage(
        cache,
        cacheKey,
        input,
        dataforseo,
        options,
      );
    },
    async profileTopPagesPage(
      input: TopPagesPageServiceInput,
      dataforseo: DataforseoClient,
    ) {
      const cacheKey = await buildPageCacheKey(
        "backlinks:top-pages-page",
        input,
      );

      return profileTopPagesPage(cache, cacheKey, input, dataforseo);
    },
  } as const;
}

function buildTargetCacheInput(input: BacklinksLookupInput) {
  const normalizedTarget = normalizeBacklinksTarget(input.target, {
    scope: input.scope,
  });

  return {
    target: normalizedTarget.apiTarget,
    scope: normalizedTarget.scope,
    // Subfolder scope keeps the hostname as the API target, so the path must
    // separate cache entries.
    path: normalizedTarget.path,
    // Same hostname, different result set — and keeping it in the key retires
    // entries written before scopes could exclude subdomains.
    includeSubdomains: normalizedTarget.includeSubdomains,
  };
}

async function buildPageCacheKey(
  prefix: string,
  input: BacklinksPageCacheInput,
  options?: BacklinksSpamFilterOptions,
): Promise<string> {
  const spamFilterOptions = normalizeBacklinksSpamFilterOptions(options);

  return buildCacheKey(prefix, {
    ...buildTargetCacheInput(input),
    page: input.page,
    pageSize: input.pageSize,
    sortField: input.sortField,
    sortOrder: input.sortOrder,
    filters: input.filters,
    ...(input.mode ? { mode: input.mode } : {}),
    hideSpam: String(spamFilterOptions.hideSpam),
    ...(spamFilterOptions.hideSpam
      ? { spamThreshold: String(spamFilterOptions.spamThreshold) }
      : {}),
  });
}


