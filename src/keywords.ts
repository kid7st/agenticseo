import { OperationError } from "./errors.js";
import { DataforseoChargedTaskError, type DataforseoApiResponse } from "./openseo/dataforseo/envelope.js";
import { fetchAdsSearchVolume } from "./openseo/dataforseo/google-ads.js";
import { fetchKeywordMetricsForList, type KeywordMetricsClient } from "./openseo/dataforseo/keyword-metrics.js";
import { fetchKeywordOverview } from "./openseo/dataforseo/labs.js";
import { getKeywordDataProvider } from "./openseo/keyword-locations.js";
import type { Project } from "./project.js";

type ProviderCall = { path: string[]; costUsd: number; items: unknown[] };

/**
 * Wraps a section fetcher the way OpenSEO's metered client does, but records the
 * call's cost and raw items as local evidence instead of charging credits.
 */
function recorded<I, T extends unknown[]>(calls: ProviderCall[], fetcher: (input: I) => Promise<DataforseoApiResponse<T>>) {
  return async (input: I): Promise<T> => {
    try {
      const { data, billing } = await fetcher(input);
      calls.push({ ...billing, items: data });
      return data;
    } catch (error) {
      if (!(error instanceof DataforseoChargedTaskError)) throw error;
      // DataForSEO billed a failed task; the cost must stay visible. "Invalid Field"
      // means our request (the project's market) was wrong, which the user fixes.
      throw new OperationError(error.isInvalidField ? "input" : "provider", `${error.message} (charged $${error.billing.costUsd})`, { cause: error });
    }
  };
}

export async function keywordMetrics(project: Project, keywords: string[], options: { includeClickstreamData: boolean }) {
  const source = getKeywordDataProvider(project.locationCode);
  if (options.includeClickstreamData && source !== "labs") {
    throw new OperationError("input", "--clickstream applies only to markets served by DataForSEO Labs");
  }
  const calls: ProviderCall[] = [];
  const client: KeywordMetricsClient = {
    labs: { keywordOverview: recorded(calls, fetchKeywordOverview) },
    keywords: { adsSearchVolume: recorded(calls, fetchAdsSearchVolume) },
  };
  const rows = await fetchKeywordMetricsForList(client, {
    keywords,
    locationCode: project.locationCode,
    languageCode: project.languageCode,
    includeClickstreamData: options.includeClickstreamData,
  });
  const returned = new Set(rows.map((row) => row.keyword.toLowerCase()));
  return {
    source,
    rows,
    missingKeywords: keywords.filter((keyword) => !returned.has(keyword.toLowerCase())),
    // Rounded to DataForSEO's precision so summed float costs do not print as 0.030000000000000002.
    costUsd: Math.round(calls.reduce((sum, call) => sum + call.costUsd, 0) * 1e6) / 1e6,
    calls,
  };
}
