// Shaped after OpenSEO src/server/lib/dataforseo/client.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49 (the entries ported so far).
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local change: OpenSEO's meter charges hosted credits; here each call's path, cost
// and raw items go into a ledger the command saves as evidence, and a charged
// failure keeps its cost in the error message.
import { AppError } from "../platform.js";
import {
  DataforseoChargedTaskError,
  type DataforseoApiResponse,
} from "./envelope.js";
import {
  fetchBacklinksHistory,
  fetchBacklinksRows,
  fetchBacklinksSummary,
  fetchDomainPagesSummary,
  fetchReferringDomains,
} from "./backlinks.js";
import { fetchAdsKeywordIdeas, fetchAdsSearchVolume } from "./google-ads.js";
import {
  fetchDomainRankOverview,
  fetchKeywordIdeas,
  fetchKeywordOverview,
  fetchKeywordSuggestions,
  fetchRankedKeywords,
  fetchRelatedKeywords,
  fetchRelevantPages,
  fetchSerpCompetitors,
} from "./labs.js";
import { fetchLiveSerp } from "./serp.js";

export type ProviderCall = { path: string[]; costUsd: number; items: unknown };

function meter<I, T>(
  ledger: ProviderCall[],
  fetcher: (input: I) => Promise<DataforseoApiResponse<T>>,
): (input: I) => Promise<T> {
  return async (input) => {
    let result: DataforseoApiResponse<T>;
    try {
      result = await fetcher(input);
    } catch (error) {
      if (error instanceof DataforseoChargedTaskError) {
        // Same rule as OpenSEO's meter: an unbilled "Invalid Field" is the
        // caller's input error; anything billed stays a provider failure.
        if (error.isInvalidField && error.billing.costUsd <= 0) {
          throw new AppError("VALIDATION_ERROR", error.message);
        }
        error.message = `${error.message} (charged $${error.billing.costUsd})`;
      }
      throw error;
    }
    ledger.push({ ...result.billing, items: result.data });
    return result.data;
  };
}

export function createDataforseoClient(ledger: ProviderCall[]) {
  return {
    backlinks: {
      summary: meter(ledger, fetchBacklinksSummary),
      rows: meter(ledger, fetchBacklinksRows),
      referringDomains: meter(ledger, fetchReferringDomains),
      domainPages: meter(ledger, fetchDomainPagesSummary),
      history: meter(ledger, fetchBacklinksHistory),
    },
    keywords: {
      related: meter(ledger, fetchRelatedKeywords),
      suggestions: meter(ledger, fetchKeywordSuggestions),
      ideas: meter(ledger, fetchKeywordIdeas),
      // Google Ads endpoints for countries Labs doesn't support.
      adsIdeas: meter(ledger, fetchAdsKeywordIdeas),
      adsSearchVolume: meter(ledger, fetchAdsSearchVolume),
    },
    domain: {
      rankOverview: meter(ledger, fetchDomainRankOverview),
      rankedKeywords: meter(ledger, fetchRankedKeywords),
      relevantPages: meter(ledger, fetchRelevantPages),
    },
    serp: {
      live: meter(ledger, fetchLiveSerp),
    },
    labs: {
      keywordOverview: meter(ledger, fetchKeywordOverview),
      serpCompetitors: meter(ledger, fetchSerpCompetitors),
    },
  } as const;
}

export type DataforseoClient = ReturnType<typeof createDataforseoClient>;

/** Total cost of a ledger, rounded so summed floats do not print as 0.030000000000000002. */
export function ledgerCost(ledger: ProviderCall[]) {
  return Math.round(ledger.reduce((sum, call) => sum + call.costUsd, 0) * 1e6) / 1e6;
}
