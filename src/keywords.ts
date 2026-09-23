import { OperationError } from "./errors.js";
import { createFileCache } from "./openseo/cache.js";
import { createDataforseoClient, ledgerCost, type ProviderCall } from "./openseo/dataforseo/client.js";
import { fetchKeywordMetricsForList, type KeywordMetricRow } from "./openseo/dataforseo/keyword-metrics.js";
import { getKeywordDataProvider } from "./openseo/keyword-locations.js";
import { research } from "./openseo/keywords/research.js";
import type { Market } from "./market.js";
import type { Store } from "./store.js";

/** OpenSEO offers clickstream only where Labs serves the market; say so instead of ignoring the flag. */
function assertClickstreamAvailable(market: Market, clickstream: boolean) {
  if (clickstream && getKeywordDataProvider(market.locationCode) !== "labs") {
    throw new OperationError("input", "--clickstream applies only to markets served by DataForSEO Labs");
  }
}

/**
 * Labs and Google Ads both sometimes return a row whose every metric is null. For the
 * agent that is the same as no row, so such terms are reported as missing; the raw
 * items stay in the evidence either way.
 */
function hasMetrics(row: KeywordMetricRow) {
  return [row.searchVolume, row.cpc, row.competition, row.competitionLevel, row.keywordDifficulty, row.intent].some((value) => value != null)
    || row.monthlySearches.length > 0;
}

export async function keywordMetrics(market: Market, keywords: string[], options: { includeClickstreamData: boolean }) {
  assertClickstreamAvailable(market, options.includeClickstreamData);
  const calls: ProviderCall[] = [];
  const allRows = await fetchKeywordMetricsForList(createDataforseoClient(calls), {
    keywords,
    locationCode: market.locationCode,
    languageCode: market.languageCode,
    includeClickstreamData: options.includeClickstreamData,
  });
  const rows = allRows.filter(hasMetrics);
  const returned = new Set(rows.map((row) => row.keyword.toLowerCase()));
  return {
    source: getKeywordDataProvider(market.locationCode),
    rows,
    missingKeywords: keywords.filter((keyword) => !returned.has(keyword.toLowerCase())),
    costUsd: ledgerCost(calls),
    calls,
  };
}

/**
 * OpenSEO's research_keywords for one seed: auto source fallback, cached for 24 hours in
 * the project, with every researched keyword's metrics stored for saved keywords.
 */
export async function researchKeywords(
  market: Market,
  seed: string,
  options: { resultLimit: 150 | 300 | 500; clickstream: boolean; cacheDirectory: string; db: Store },
) {
  assertClickstreamAvailable(market, options.clickstream);
  const calls: ProviderCall[] = [];
  const result = await research(
    { keywords: [seed], locationCode: market.locationCode, languageCode: market.languageCode, resultLimit: options.resultLimit, mode: "auto", clickstream: options.clickstream },
    { client: createDataforseoClient(calls), cache: createFileCache(options.cacheDirectory), db: options.db },
  );
  // A cache hit makes no provider call, so nothing was spent.
  return { ...result, cached: calls.length === 0, costUsd: ledgerCost(calls), calls };
}

/** OpenSEO's get_serp_results for one query, trimmed to the same fields its MCP tool returns. */
export async function serpResults(market: Market, keyword: string, depth: number) {
  const calls: ProviderCall[] = [];
  const items = await createDataforseoClient(calls).serp.live({ keyword, locationCode: market.locationCode, languageCode: market.languageCode, depth });
  return {
    items: items.slice(0, depth).map((item) => ({
      type: item.type,
      rank: item.rank_absolute ?? item.rank_group ?? null,
      title: item.title ?? null,
      url: item.url ?? null,
      domain: item.domain ?? null,
      description: item.description ?? null,
    })),
    costUsd: ledgerCost(calls),
    calls,
  };
}
