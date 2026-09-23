// Ported from OpenSEO src/server/features/domain/services/DomainService.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49 (getOverview).
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local changes: a client ledger and file cache replace the billing customer and
// R2; organization and project ids leave the cache key; the cache write is awaited
// instead of handed to waitUntil, and a failed write fails the command.
import { z } from "zod";
import { buildCacheKey, type Cache } from "../cache.js";
import type { DataforseoClient } from "../dataforseo/client.js";
import { parseResearchTargetOrThrow } from "../domainUtils.js";
import type { ResearchScope } from "../researchScope.js";

/** Domain overview data is refreshed every 12 hours. */
const DOMAIN_OVERVIEW_TTL_SECONDS = 12 * 60 * 60;

const domainOverviewResultSchema = z.object({
  domain: z.string(),
  organicTraffic: z.number().nullable(),
  organicKeywords: z.number().nullable(),
  backlinks: z.number().nullable(),
  referringDomains: z.number().nullable(),
  hasData: z.boolean(),
  fetchedAt: z.string(),
});

type DomainOverviewResult = z.infer<typeof domainOverviewResultSchema> & {
  /** Requested research scope, echoed for display. */
  scope: ResearchScope;
  displayTarget: string;
};

export async function getOverview(
  input: {
    domain: string;
    scope?: ResearchScope;
    locationCode: number;
    languageCode: string;
  },
  context: { client: DataforseoClient; cache: Cache },
): Promise<DomainOverviewResult> {
  const target = parseResearchTargetOrThrow(input.domain, input.scope);
  const domain = target.hostname;

  // domain_rank_overview has no filters and always covers the hostname plus
  // all of its subdomains, so every scope shares one cache entry per hostname.
  // Callers label the metrics as domain-wide for narrower scopes.
  const cacheKey = await buildCacheKey("domain:overview", {
    domain,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
  });

  const cachedRaw = await context.cache.get(cacheKey);
  const cached = domainOverviewResultSchema.safeParse(cachedRaw);
  if (cached.success && cached.data.hasData) {
    return {
      ...cached.data,
      scope: target.scope,
      displayTarget: target.display,
    };
  }

  const nowIso = new Date().toISOString();
  const metricsResponse = await context.client.domain.rankOverview({
    target: domain,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
  });

  const metrics = metricsResponse[0];

  const organicTraffic =
    metrics?.metrics?.organic?.etv != null
      ? Math.round(metrics.metrics.organic.etv)
      : null;
  const organicKeywords =
    metrics?.metrics?.organic?.count != null
      ? Math.round(metrics.metrics.organic.count)
      : null;

  const stored: z.infer<typeof domainOverviewResultSchema> = {
    domain,
    organicTraffic,
    organicKeywords,
    backlinks: null,
    referringDomains: null,
    hasData: organicKeywords != null && organicKeywords > 0,
    fetchedAt: nowIso,
  };

  if (stored.hasData) {
    await context.cache.set(cacheKey, stored, DOMAIN_OVERVIEW_TTL_SECONDS);
  }

  return { ...stored, scope: target.scope, displayTarget: target.display };
}
