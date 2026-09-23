// Ported from OpenSEO src/serverFunctions/ahrefs.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local changes: a plain function over the project file cache replaces the server
// function and KV; a lookup that fails is reported in `failed` instead of being
// returned as null, which means "Ahrefs has no rating"; loops replace remeda's chunk.
// Since about August 2026 Ahrefs requires a free APIv3 key on this endpoint
// (docs.ahrefs.com/en/api/reference/public/get-domain-rating-free), which the pinned
// upstream does not send: the key comes from AHREFS_API_KEY as a Bearer token, and a
// missing or rejected key fails the whole call as a credentials error.
import { z } from "zod";
import type { Cache } from "./cache.js";
import { normalizeDomainInput } from "./domainUtils.js";
import { AppError, getRequiredEnvValue } from "./platform.js";

/**
 * Ahrefs publishes a free, keyless Domain Rating lookup. We use it to enrich the
 * Backlinks table on demand — no billing, no stored data. Every result (a DR, or
 * `null` when Ahrefs has no rating) is cached in KV for a day so re-opening the
 * table is free.
 */
const AHREFS_DR_ENDPOINT =
  "https://api.ahrefs.com/v3/public/domain-rating-free";
const CACHE_PREFIX = "ahrefs-dr:";
const CACHE_TTL_SECONDS = 86_400; // 24 hours
const FETCH_TIMEOUT_MS = 5_000;
const FETCH_BATCH_SIZE = 20;
const MAX_DOMAINS_PER_CALL = 100;

const domainsSchema = z
  .array(z.string().trim().min(1).max(253))
  .min(1)
  .max(MAX_DOMAINS_PER_CALL);

const ahrefsResponseSchema = z.object({
  domain_rating: z.object({
    domain_rating: z.number().min(0).max(100),
  }),
});

export async function getAhrefsDomainRatings(input: string[], cache: Cache) {
    const parsedDomains = domainsSchema.safeParse(input);
    if (!parsedDomains.success) {
      throw new AppError("VALIDATION_ERROR", `Provide 1-${MAX_DOMAINS_PER_CALL} domains`);
    }
    const data = { domains: parsedDomains.data };
    const apiKey = await getRequiredEnvValue("AHREFS_API_KEY");
    const result: Record<string, number | null> = {};
    const failed: Record<string, string> = {};

    // Several original inputs can collapse to one normalized domain (www/non-www,
    // protocol variants). Resolve each normalized domain once, then fan the value
    // back out to every original key the client will look up by.
    const originalsByDomain = new Map<string, string[]>();
    for (const original of data.domains) {
      const domain = normalizeDomainInput(original, true);
      const existing = originalsByDomain.get(domain);
      if (existing) existing.push(original);
      else originalsByDomain.set(domain, [original]);
    }

    const ratings = new Map<string, number | null>();
    const errors = new Map<string, string>();
    const domains = [...originalsByDomain.keys()];
    for (let start = 0; start < domains.length; start += FETCH_BATCH_SIZE) {
      const batch = domains.slice(start, start + FETCH_BATCH_SIZE);
      const resolved = await Promise.all(
        batch.map(async (domain) => {
          // A single failure must not fail the whole call, but it is reported,
          // not turned into "no rating".
          try {
            return [domain, await resolveDomainRating(domain, cache, apiKey)] as const;
          } catch (error) {
            // A missing or rejected key fails every domain alike: report it once.
            if (error instanceof AppError && error.kind === "credentials") throw error;
            errors.set(domain, error instanceof Error ? error.message : String(error));
            return [domain, null] as const;
          }
        }),
      );
      for (const [domain, dr] of resolved) ratings.set(domain, dr);
    }

    for (const [domain, originals] of originalsByDomain) {
      const error = errors.get(domain);
      for (const original of originals) {
        if (error) failed[original] = error;
        else result[original] = ratings.get(domain) ?? null;
      }
    }

    return { ratings: result, failed };
}

/** Cache-first lookup for a single normalized domain. */
async function resolveDomainRating(
  domain: string,
  cache: Cache,
  apiKey: string,
): Promise<number | null> {
  const cacheKey = `${CACHE_PREFIX}${domain}`;
  // The file cache returns null on a miss, so a cached "no rating" is wrapped
  // in an object and cache hits (including nulls) skip the fetch.
  const cached = cachedRatingSchema.safeParse(await cache.get(cacheKey));
  if (cached.success) return parseCachedRating(cached.data.dr);

  const dr = await fetchDomainRating(domain, apiKey);
  await cache.set(cacheKey, { dr }, CACHE_TTL_SECONDS);
  return dr;
}

const cachedRatingSchema = z.object({ dr: z.number().nullable() });

async function fetchDomainRating(
  domain: string,
  apiKey: string,
): Promise<number | null> {
  const response = await fetch(
    `${AHREFS_DR_ENDPOINT}?target=${encodeURIComponent(domain)}`,
    {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
  );
  if (response.status === 401 || response.status === 403) {
    throw new AppError(
      "AHREFS_AUTH_FAILED",
      `Ahrefs rejected AHREFS_API_KEY (HTTP ${response.status})`,
    );
  }
  if (!response.ok) {
    throw new Error(`Ahrefs DR lookup failed with status ${response.status}`);
  }

  const parsed = ahrefsResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Ahrefs DR lookup returned an unexpected response");
  }

  // Ahrefs returns 200 with DR 0 for domains it has no rating for (new or
  // unknown), so treat 0 as "no rating" — the table renders it as "—".
  const dr = parsed.data.domain_rating.domain_rating;
  return dr > 0 ? dr : null;
}

function parseCachedRating(value: number | null): number | null {
  // Mirror fetchDomainRating: a DR of 0 means "no rating", so render it as "—".
  return typeof value === "number" && value > 0 ? value : null;
}
