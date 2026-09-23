// Ported from OpenSEO src/server/features/keywords/services/research/research.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local changes: a ResearchContext (client ledger, file cache, project database)
// replaces the billing customer; organization and project ids leave the cache key
// because the cache already lives in the project; cached trends allow null volumes;
// persisting researched metrics is awaited in a transaction, so a failed write
// fails the command instead of being logged and dropped.
import { AppError } from "../platform.js";
import { CACHE_TTL, buildCacheKey, type Cache } from "../cache.js";
import type { DataforseoClient } from "../dataforseo/client.js";
import type { KeywordResearchRow } from "../types.js";
import { z } from "zod";
import { getKeywordDataProvider } from "../keyword-locations.js";
import { transaction, type Store } from "../../store.js";
import { upsertKeywordMetric } from "./savedKeywordsRepository.js";
import { type EnrichedKeyword, normalizeKeyword } from "./helpers.js";
import {
  fetchGoogleAdsResearchRows,
  fetchResearchRowsBySource,
} from "./research-data.js";
import {
  AUTO_KEYWORD_SOURCES,
  MIN_NON_SEED_FOR_AUTO,
  countNonSeedKeywords,
  hasSufficientCoverage,
  type KeywordMode,
  type KeywordSource,
  type ResearchSource,
} from "./selection.js";

type SourceAttempt = {
  source: ResearchSource;
  rowCount: number;
  nonSeedCount: number;
};

type ResearchDiagnostics = {
  requestedMode: KeywordMode;
  threshold: number;
  sourceAttempts: SourceAttempt[];
};

type ResearchResult = {
  rows: KeywordResearchRow[];
  source: ResearchSource;
  usedFallback: boolean;
  diagnostics: ResearchDiagnostics;
};

type CachedResult = ResearchResult;

/**
 * What OpenSEO threads through as the billing customer: who pays and where
 * results are cached and stored. Locally that is the call ledger's client, the
 * project's cache directory and its database.
 */
export type ResearchContext = { client: DataforseoClient; cache: Cache; db: Store };

/** OpenSEO's researchKeywordsSchema input after market resolution, without projectId. */
export type ResolvedResearchKeywordsInput = {
  keywords: string[];
  locationCode: number;
  languageCode: string;
  resultLimit: 150 | 300 | 500;
  mode: KeywordMode;
  clickstream: boolean;
};

const cachedKeywordRowSchema = z.object({
  keyword: z.string(),
  searchVolume: z.number().nullable(),
  trend: z.array(
    z.object({
      year: z.number(),
      month: z.number(),
      searchVolume: z.number().nullable(),
    }),
  ),
  cpc: z.number().nullable(),
  competition: z.number().nullable(),
  keywordDifficulty: z.number().nullable(),
  intent: z.enum([
    "informational",
    "commercial",
    "transactional",
    "navigational",
    "unknown",
  ]),
});

const sourceAttemptSchema = z.object({
  source: z.enum(["related", "suggestions", "ideas", "google_ads"]),
  rowCount: z.number(),
  nonSeedCount: z.number(),
});

const cachedResultSchema = z.object({
  rows: z.array(cachedKeywordRowSchema),
  source: z.enum(["related", "suggestions", "ideas", "google_ads"]),
  usedFallback: z.boolean(),
  diagnostics: z.object({
    requestedMode: z.enum(["auto", "related", "suggestions", "ideas"]),
    threshold: z.number(),
    sourceAttempts: z.array(sourceAttemptSchema),
  }),
});

// v3: research volumes are no longer clickstream-refined, and Google-Ads-only
// locations route to keywords_for_keywords.
const CACHE_VERSION = 3;

async function fetchRowsFromSource(
  source: KeywordSource,
  input: ResolvedResearchKeywordsInput,
  seedKeyword: string,
  context: ResearchContext,
): Promise<EnrichedKeyword[]> {
  return fetchResearchRowsBySource(
    {
      source,
      seedKeyword,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
      resultLimit: input.resultLimit,
      includeClickstreamData: input.clickstream,
    },
    context.client,
  );
}

async function fetchAutoRows(
  input: ResolvedResearchKeywordsInput,
  seedKeyword: string,
  context: ResearchContext,
): Promise<ResearchResult> {
  const attempts: SourceAttempt[] = [];
  let lastSource: KeywordSource = "related";
  const accumulatedRows: EnrichedKeyword[] = [];
  const seenKeywords = new Set<string>();

  for (const source of AUTO_KEYWORD_SOURCES) {
    const rows = await fetchRowsFromSource(
      source,
      input,
      seedKeyword,
      context,
    );
    for (const row of rows) {
      if (accumulatedRows.length >= input.resultLimit) break;
      if (seenKeywords.has(row.keyword)) continue;
      seenKeywords.add(row.keyword);
      accumulatedRows.push(row);
    }

    attempts.push({
      source,
      rowCount: rows.length,
      nonSeedCount: countNonSeedKeywords(rows, seedKeyword),
    });

    lastSource = source;

    if (
      hasSufficientCoverage(accumulatedRows, seedKeyword, MIN_NON_SEED_FOR_AUTO)
    ) {
      return {
        rows: accumulatedRows,
        source,
        usedFallback: source !== AUTO_KEYWORD_SOURCES[0],
        diagnostics: {
          requestedMode: "auto",
          threshold: MIN_NON_SEED_FOR_AUTO,
          sourceAttempts: attempts,
        },
      };
    }
  }

  return {
    rows: accumulatedRows,
    source: lastSource,
    usedFallback: true,
    diagnostics: {
      requestedMode: "auto",
      threshold: MIN_NON_SEED_FOR_AUTO,
      sourceAttempts: attempts,
    },
  };
}

async function fetchGoogleAdsRows(
  input: ResolvedResearchKeywordsInput,
  seedKeyword: string,
  context: ResearchContext,
): Promise<ResearchResult> {
  const rows = await fetchGoogleAdsResearchRows(
    {
      seedKeyword,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
      resultLimit: input.resultLimit,
    },
    context.client,
  );

  return {
    rows,
    source: "google_ads",
    usedFallback: false,
    diagnostics: {
      requestedMode: "auto",
      threshold: MIN_NON_SEED_FOR_AUTO,
      sourceAttempts: [
        {
          source: "google_ads",
          rowCount: rows.length,
          nonSeedCount: countNonSeedKeywords(rows, seedKeyword),
        },
      ],
    },
  };
}

async function fetchManualRows(
  mode: Exclude<KeywordMode, "auto">,
  input: ResolvedResearchKeywordsInput,
  seedKeyword: string,
  context: ResearchContext,
): Promise<ResearchResult> {
  const rows = await fetchRowsFromSource(
    mode,
    input,
    seedKeyword,
    context,
  );
  const attempt: SourceAttempt = {
    source: mode,
    rowCount: rows.length,
    nonSeedCount: countNonSeedKeywords(rows, seedKeyword),
  };

  return {
    rows,
    source: mode,
    usedFallback: false,
    diagnostics: {
      requestedMode: mode,
      threshold: MIN_NON_SEED_FOR_AUTO,
      sourceAttempts: [attempt],
    },
  };
}

async function buildResearchCacheKey(
  input: ResolvedResearchKeywordsInput,
  normalizedKeywords: string[],
  mode: KeywordMode,
): Promise<string> {
  return buildCacheKey("kw:research", {
    cacheVersion: CACHE_VERSION,
    keywords: normalizedKeywords,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    resultLimit: input.resultLimit,
    mode,
    depth: 3,
    clickstream: input.clickstream,
  });
}

function persistRows(
  db: Store,
  input: ResolvedResearchKeywordsInput,
  rows: EnrichedKeyword[],
) {
  transaction(db, () => {
    for (const row of rows) {
      upsertKeywordMetric(db, {
        keyword: row.keyword,
        locationCode: input.locationCode,
        languageCode: input.languageCode,
        searchVolume: row.searchVolume,
        cpc: row.cpc,
        competition: row.competition,
        keywordDifficulty: row.keywordDifficulty,
        intent: row.intent,
        monthlySearchesJson: JSON.stringify(row.trend),
      });
    }
  });
}

export async function research(
  input: ResolvedResearchKeywordsInput,
  context: ResearchContext,
): Promise<ResearchResult> {
  const uniqueKeywords = [
    ...new Set(input.keywords.map(normalizeKeyword)),
  ].filter((keyword) => keyword.length > 0);

  if (uniqueKeywords.length === 0) {
    throw new AppError("VALIDATION_ERROR");
  }

  const seedKeyword = uniqueKeywords[0];
  const provider = getKeywordDataProvider(input.locationCode);
  // Labs source modes and clickstream refinement don't exist for
  // Google-Ads-served countries; collapse both so equivalent requests share
  // one cache entry.
  const effectiveInput: ResolvedResearchKeywordsInput =
    provider === "google_ads"
      ? { ...input, mode: "auto", clickstream: false }
      : input;
  const mode = effectiveInput.mode ?? "auto";
  const cacheKey = await buildResearchCacheKey(
    effectiveInput,
    uniqueKeywords,
    mode,
  );

  const cachedRaw = await context.cache.get(cacheKey);
  const cachedResult = cachedResultSchema.safeParse(cachedRaw);
  const cached: CachedResult | null = cachedResult.success
    ? cachedResult.data
    : null;

  if (cached && cached.rows.length > 0) {
    return cached;
  }

  const result =
    provider === "google_ads"
      ? await fetchGoogleAdsRows(
          effectiveInput,
          seedKeyword,
          context,
        )
      : mode === "auto"
        ? await fetchAutoRows(
            effectiveInput,
            seedKeyword,
            context,
          )
        : await fetchManualRows(
            mode,
            effectiveInput,
            seedKeyword,
            context,
          );

  await context.cache.set(cacheKey, result, CACHE_TTL.researchResult);
  persistRows(context.db, effectiveInput, result.rows);

  return result;
}
