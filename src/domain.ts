import { z } from "zod";
import { OperationError } from "./errors.js";
import type { Market } from "./market.js";
import { createFileCache } from "./openseo/cache.js";
import { createDataforseoClient, ledgerCost, type ProviderCall } from "./openseo/dataforseo/client.js";
import { buildRankedKeywordsScopeFilter } from "./openseo/dataforseo/researchScopeFilters.js";
import { getOverview } from "./openseo/domain/DomainService.js";
import { mapKeywordItem } from "./openseo/domain/domainKeywordMapper.js";
import { parseResearchTargetOrThrow } from "./openseo/domainUtils.js";
import { assertLabsLocationCode } from "./openseo/market.js";
import {
  buildRankedKeywordFilters,
  domainTargetSchema,
  hostMatchesDomain,
  rankedResultTypeSchema,
  rankedTargetSchema,
  serpCompetitorResultTypeSchema,
  sortCompetitors,
  sortOrderByRankedMode,
  type CompetitorSortBy,
  type RankedSortBy,
} from "./openseo/mcp/research-tools.js";
import type { ResearchScope } from "./openseo/researchScope.js";

/** Checks one argument against the schema OpenSEO's MCP tool uses for it. */
function check<T extends z.ZodType>(schema: T, value: unknown, name: string): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new OperationError("input", `${name}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  return parsed.data;
}

/**
 * Domain analytics exists only where DataForSEO Labs serves the market. OpenSEO
 * silently falls back to the United States for such a project; here the call fails
 * so the market in the result is always the one the user chose.
 */
function assertDomainMarket(market: Market) {
  assertLabsLocationCode(market.locationCode);
}

/** OpenSEO's get_domain_overview: organic traffic and keyword count, cached for 12 hours. */
export async function domainOverview(market: Market, input: { target: string; scope?: ResearchScope; cacheDirectory: string }) {
  assertDomainMarket(market);
  const calls: ProviderCall[] = [];
  const result = await getOverview(
    { domain: input.target, scope: input.scope, ...market },
    { client: createDataforseoClient(calls), cache: createFileCache(input.cacheDirectory) },
  );
  return { ...result, cached: calls.length === 0, costUsd: ledgerCost(calls), calls };
}

/** OpenSEO's get_ranked_keywords for a domain or page, with its scope, filters, sort and paging. */
export async function rankedKeywords(
  market: Market,
  input: {
    target: string;
    scope?: ResearchScope;
    resultTypes?: string[];
    minSearchVolume?: number;
    maxRank?: number;
    excludeBrandTerms?: string[];
    sortBy?: RankedSortBy;
    limit: number;
    offset?: number;
  },
) {
  assertDomainMarket(market);
  check(rankedTargetSchema, input.target, "target");
  const resultTypes = input.resultTypes && check(z.array(rankedResultTypeSchema).min(1).max(5), input.resultTypes, "--types");
  const excludeBrandTerms = input.excludeBrandTerms && check(z.array(z.string().min(1).max(80)).min(1).max(10), input.excludeBrandTerms, "--exclude");
  const target = parseResearchTargetOrThrow(input.target, input.scope);
  const calls: ProviderCall[] = [];
  const page = await createDataforseoClient(calls).domain.rankedKeywords({
    target: target.hostname,
    locationCode: market.locationCode,
    languageCode: market.languageCode,
    limit: input.limit,
    offset: input.offset,
    orderBy: sortOrderByRankedMode(input.sortBy),
    filters: buildRankedKeywordFilters(
      { minSearchVolume: input.minSearchVolume, maxRank: input.maxRank, excludeBrandTerms },
      buildRankedKeywordsScopeFilter(target),
    ),
    itemTypes: resultTypes,
  });
  const rows = page.items.map(mapKeywordItem).filter((row) => row != null);
  const offset = input.offset ?? 0;
  const nextOffset = page.totalCount != null && offset + page.items.length < page.totalCount ? offset + page.items.length : null;
  return { target: target.display, scope: target.scope, totalCount: page.totalCount, nextOffset, rows, costUsd: ledgerCost(calls), calls };
}

/** OpenSEO's find_serp_competitors: domains competing across a keyword set's SERPs. */
export async function serpCompetitors(
  market: Market,
  input: {
    keywords: string[];
    resultTypes?: string[];
    excludeDomains?: string[];
    includeSubdomains?: boolean;
    sortBy?: CompetitorSortBy;
    limit: number;
    offset?: number;
  },
) {
  assertDomainMarket(market);
  const keywords = check(z.array(z.string().min(1).max(120)).min(1).max(100), input.keywords, "keywords");
  const resultTypes = input.resultTypes && check(z.array(serpCompetitorResultTypeSchema).min(1).max(4), input.resultTypes, "--types");
  const excludeDomains = input.excludeDomains ? check(z.array(domainTargetSchema).min(1).max(50), input.excludeDomains, "--exclude-domains") : [];
  const calls: ProviderCall[] = [];
  const competitors = await createDataforseoClient(calls).labs.serpCompetitors({
    keywords,
    locationCode: market.locationCode,
    languageCode: market.languageCode,
    itemTypes: resultTypes ?? ["organic", "local_pack"],
    includeSubdomains: input.includeSubdomains,
    limit: input.limit,
    offset: input.offset,
  });
  const filtered = competitors.filter((item) => {
    const domain = typeof item.domain === "string" ? item.domain : "";
    return !excludeDomains.some((excluded) => hostMatchesDomain(domain, excluded));
  });
  const rows = sortCompetitors(filtered, input.sortBy ?? "visibility").map((item) => ({
    domain: item.domain ?? null,
    keywordsCount: item.keywords_count ?? null,
    avgPosition: item.avg_position ?? null,
    medianPosition: item.median_position ?? null,
    visibility: item.visibility ?? null,
    etv: item.etv ?? null,
  }));
  return { rows, costUsd: ledgerCost(calls), calls };
}
