import { z } from "zod";
import { OperationError } from "./errors.js";
import { buildCacheKey, createFileCache } from "./openseo/cache.js";
import { fetchBusinessListingsCategories, type BusinessTaskEndpoint } from "./openseo/dataforseo/business.js";
import { createDataforseoClient, ledgerCost, type ProviderCall } from "./openseo/dataforseo/client.js";
import {
  businessDataNearSchema,
  businessIdentifierKeyword,
  formatBusinessDataCoordinate,
  formatLocalSerpCoordinate,
  pickRowFields,
  readPath,
  resolveBusinessIdentifier,
} from "./openseo/mcp/local-seo-shared.js";
import {
  BUSINESS_CATEGORIES_CACHE_NAMESPACE,
  BUSINESS_UPDATE_ROW_FIELDS,
  encodeReviewsTaskId,
  parseReviewsTaskId,
  pollBusinessTask,
  resultItems,
  REVIEW_ROW_FIELDS,
  BUSINESS_CATEGORIES_TTL_SECONDS,
  buildRankGridPoints,
  cachedCategoriesSchema,
  GRID_ABORT_ERROR_CODES,
  localRankGridInputSchema,
  matchGridItem,
  RANK_GRID_CONCURRENCY,
  RANK_GRID_DEPTH,
  rankGridZoom,
  readString,
  resolveBusinessLocation,
  type GridPoint,
  type GridPointResult,
} from "./openseo/mcp/local-seo-tools.js";
import {
  buildLocalBusinessFilters,
  formatBusinessLocationCoordinate,
  LOCAL_BUSINESS_ROW_FIELDS,
  LOCAL_SERP_ROW_FIELDS,
  localBusinessOrderBy,
  localSerpNearSchema,
  nearSchema,
  trimBusinessQuestionRow,
} from "./openseo/mcp/research-tools.js";
import { AppError } from "./openseo/platform.js";

/** Checks input against the schema OpenSEO's MCP tool uses for it. */
function check<T extends z.ZodType>(schema: T, value: unknown, name: string): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new OperationError("input", `${name}: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "value"} ${issue.message}`).join("; ")}`);
  }
  return parsed.data;
}

function metered() {
  const calls: ProviderCall[] = [];
  return { client: createDataforseoClient(calls), done: <T extends object>(result: T) => ({ ...result, costUsd: ledgerCost(calls), calls }) };
}

type Identifier = { businessName?: string; cid?: string; placeId?: string };

/** OpenSEO's search_local_businesses: listings near a coordinate with rating, review and claim filters. */
export async function localBusinesses(input: {
  query?: string;
  near: { latitude: number; longitude: number; radiusKm: number };
  categories?: string[];
  minRating?: number;
  minReviews?: number;
  isClaimed?: boolean;
  sortBy?: "relevance" | "rating" | "reviews";
  limit: number;
  offset?: number;
}) {
  const near = check(nearSchema, input.near, "--near/--radius");
  check(z.object({ limit: z.number().int().min(1).max(50), offset: z.number().int().min(0).max(1000).optional(), minRating: z.number().min(1).max(5).optional(), categories: z.array(z.string().min(1).max(120)).min(1).max(10).optional() }), input, "options");
  const { client, done } = metered();
  const rows = await client.business.businessListings({
    categories: input.categories,
    title: input.query,
    locationCoordinate: formatBusinessLocationCoordinate(near),
    isClaimed: input.isClaimed,
    filters: buildLocalBusinessFilters(input),
    orderBy: localBusinessOrderBy(input.sortBy),
    limit: input.limit,
    offset: input.offset,
  });
  return done({ businesses: rows.map((row) => pickRowFields(row, LOCAL_BUSINESS_ROW_FIELDS)) });
}

/** OpenSEO's get_local_serp_results: one Maps or Local Finder SERP near a coordinate. */
export async function localSerp(input: {
  keyword: string;
  near: { latitude: number; longitude: number; zoom?: number };
  searchType: "maps" | "local_finder";
  device: "desktop" | "mobile";
  depth: number;
  languageCode: string;
}) {
  const near = check(localSerpNearSchema, input.near, "--near/--zoom");
  check(z.object({ keyword: z.string().min(1).max(120), depth: z.number().int().min(1).max(100) }), input, "options");
  const { client, done } = metered();
  const rows = await client.serp.local({
    keyword: input.keyword,
    locationCoordinate: formatLocalSerpCoordinate(near),
    languageCode: input.languageCode,
    searchType: input.searchType,
    device: input.device,
    depth: input.depth,
    searchPlaces: false,
  });
  return done({ results: rows.map((row) => pickRowFields(row, LOCAL_SERP_ROW_FIELDS)) });
}

/** OpenSEO's list_business_categories: free at DataForSEO, cached for seven days, filtered locally. */
export async function localCategories(input: { query?: string; limit: number; cacheDirectory: string }) {
  check(z.object({ query: z.string().min(1).max(80).optional(), limit: z.number().int().min(1).max(200) }), input, "options");
  const cache = createFileCache(input.cacheDirectory);
  // The upstream list takes no parameters, so one cache entry serves every
  // query/limit combination; filtering happens below, in memory.
  const cacheKey = await buildCacheKey(BUSINESS_CATEGORIES_CACHE_NAMESPACE, {});
  const cached = cachedCategoriesSchema.safeParse(await cache.get(cacheKey));
  let all = cached.success ? cached.data : null;
  if (!all) {
    all = (await fetchBusinessListingsCategories()).data;
    await cache.set(cacheKey, all, BUSINESS_CATEGORIES_TTL_SECONDS);
  }
  const query = input.query?.toLowerCase();
  const matched = query ? all.filter((row) => row.category.toLowerCase().includes(query)) : all;
  return { totalMatched: matched.length, categories: matched.slice(0, input.limit), cached: cached.success };
}

/** OpenSEO's get_business_profile: one Google Business Profile, by name, cid or place_id. */
export async function localProfile(input: Identifier & { near?: { latitude: number; longitude: number; radiusKm?: number }; locationCode: number; languageCode: string }) {
  const identifier = resolveBusinessIdentifier(input);
  const near = input.near && check(businessDataNearSchema, input.near, "--near/--radius");
  const { client, done } = metered();
  const profile = await client.business.myBusinessInfo({
    keyword: businessIdentifierKeyword(identifier),
    ...resolveBusinessLocation({ near, locationCode: input.locationCode, languageCode: input.languageCode }, input),
  });
  return done({ profile });
}

/** OpenSEO's get_google_business_questions: Q&A for one business near a coordinate. */
export async function localQuestions(input: Identifier & { near: { latitude: number; longitude: number; radiusKm: number }; depth: number; languageCode: string }) {
  const identifier = resolveBusinessIdentifier(input);
  const near = check(nearSchema, input.near, "--near/--radius");
  check(z.object({ depth: z.number().int().min(1).max(100) }), input, "options");
  const { client, done } = metered();
  const rows = await client.business.questionsAnswers({
    // The questions endpoint shares the cid:/place_id: keyword prefixes.
    keyword: businessIdentifierKeyword(identifier),
    locationCoordinate: formatBusinessDataCoordinate(near),
    languageCode: input.languageCode,
    depth: input.depth,
  });
  return done({ questions: rows.map(trimBusinessQuestionRow) });
}

/**
 * OpenSEO's get_local_rank_grid: one Maps search per point of a square grid around a
 * coordinate, reporting the target business's rank, the point's result count and #1.
 */
export async function localRankGrid(input: z.input<typeof localRankGridInputSchema> & { languageCode: string }) {
  const args = check(localRankGridInputSchema, input, "grid");
  if (args.target.cid == null && args.target.placeId == null && args.target.name == null) {
    throw new AppError("VALIDATION_ERROR", "target needs at least one of cid, placeId, or name.");
  }
  const gridSize = args.gridSize ?? 3;
  const spacingKm = args.spacingKm ?? 2;
  const zoom = args.zoom ?? rankGridZoom(spacingKm, args.center.latitude);
  const points = buildRankGridPoints(args.center, gridSize, spacingKm);
  const { client, done } = metered();

  let matchedBusiness: { title: string | null; cid: string | null; placeId: string | null } | null = null;
  let lastError: unknown = null;

  const searchPoint = async (point: GridPoint): Promise<GridPointResult> => {
    try {
      const items = await client.serp.local({
        keyword: args.keyword,
        locationCoordinate: formatLocalSerpCoordinate({ ...point, zoom }),
        languageCode: input.languageCode,
        searchType: "maps",
        device: args.device ?? "mobile",
        depth: RANK_GRID_DEPTH,
        searchPlaces: false,
      });
      const match = matchGridItem(items, args.target);
      if (match && !matchedBusiness) {
        matchedBusiness = { title: readString(match, "title"), cid: readString(match, "cid"), placeId: readString(match, "place_id") };
      }
      const rank = readPath(match, "rank_absolute") ?? readPath(match, "rank_group");
      const first = items[0];
      return {
        ...point,
        rank: typeof rank === "number" ? rank : null,
        resultsCount: items.length,
        topResult: first == null ? null : { title: readString(first, "title"), cid: readString(first, "cid") },
      };
    } catch (error) {
      // Upstream aborts on its hosted credit and auth codes; locally that is any
      // credentials failure, since every remaining point would fail the same way.
      if ((error instanceof AppError && GRID_ABORT_ERROR_CODES.has(error.code)) || (error instanceof OperationError && error.kind === "credentials")) throw error;
      lastError = error;
      return { ...point, rank: null, error: true };
    }
  };

  // A few points at a time; an abort-worthy failure rejects its batch and
  // stops later batches from dispatching (and billing).
  const grid: GridPointResult[] = [];
  for (let i = 0; i < points.length; i += RANK_GRID_CONCURRENCY) {
    grid.push(...(await Promise.all(points.slice(i, i + RANK_GRID_CONCURRENCY).map(searchPoint))));
  }
  // Every point failing means a systemic failure (auth, balance, bad market),
  // not a business that simply doesn't rank — surface it instead of an empty grid.
  if (grid.every((point) => point.error)) throw lastError;

  const ranks = grid.filter((point) => point.rank != null).map((point) => point.rank ?? 0);
  const summary = {
    pointsSearched: grid.length,
    pointsFound: ranks.length,
    averageRank: ranks.length ? Number((ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length).toFixed(2)) : null,
    top3Count: ranks.filter((rank) => rank <= 3).length,
    top10Count: ranks.filter((rank) => rank <= 10).length,
  };
  return done({ keyword: args.keyword, gridSize, spacingKm, zoom, depthChecked: RANK_GRID_DEPTH, grid, summary, matchedBusiness });
}

type BusinessLocation = { near?: { latitude: number; longitude: number; radiusKm?: number }; locationCode: number; languageCode: string };

function businessLocation(input: BusinessLocation) {
  const near = input.near && check(businessDataNearSchema, input.near, "--near/--radius");
  return resolveBusinessLocation({ near, locationCode: input.locationCode, languageCode: input.languageCode }, input);
}

/**
 * OpenSEO's get_business_reviews. Posting the task is billed; collection polls for free.
 * A task still running after the poll window comes back as "processing" with a taskId
 * that a later call passes back to collect it at no extra cost.
 */
export async function localReviews(
  input: Identifier & BusinessLocation & {
    depth: number;
    sortBy: "newest" | "highest_rating" | "lowest_rating" | "relevant";
    includeOtherSources: boolean;
    taskId?: string;
    pollIntervalMs?: number;
  },
) {
  const { client, done } = metered();
  let task: { endpoint: BusinessTaskEndpoint; taskId: string };
  let publicTaskId: string;
  if (input.taskId) {
    task = parseReviewsTaskId(input.taskId);
    publicTaskId = input.taskId;
  } else {
    const identifier = resolveBusinessIdentifier(input);
    check(z.object({ depth: z.number().int().min(10).max(200) }), input, "--depth");
    // Only the post is metered; the polling below collects for free.
    const postedId = await client.business.reviewsTaskPost({
      ...identifier,
      ...businessLocation(input),
      depth: input.depth,
      // The fetcher's extended branch has no sort_by and ignores this.
      sortBy: input.sortBy,
      includeOtherSources: input.includeOtherSources,
    });
    task = { endpoint: input.includeOtherSources ? "extended_reviews" : "reviews", taskId: postedId };
    publicTaskId = encodeReviewsTaskId(input.includeOtherSources, postedId);
  }

  const outcome = await pollBusinessTask(task, publicTaskId, input.pollIntervalMs);
  if (outcome.status === "pending") return done({ status: "processing" as const, taskId: publicTaskId });
  const totals = outcome.result
    ? {
        title: outcome.result.title ?? null,
        reviews_count: outcome.result.reviews_count ?? null,
        rating: outcome.result.rating ?? null,
        cid: outcome.result.cid ?? null,
        place_id: outcome.result.place_id ?? null,
      }
    : null;
  return done({
    status: "completed" as const,
    taskId: publicTaskId,
    reviews: resultItems(outcome.result).map((row) => pickRowFields(row, REVIEW_ROW_FIELDS)),
    totals,
  });
}

/** OpenSEO's get_business_updates: a profile's posts, through the same billed task queue. */
export async function localPosts(input: Identifier & BusinessLocation & { depth: number; taskId?: string; pollIntervalMs?: number }) {
  const { client, done } = metered();
  let taskId: string;
  if (input.taskId) {
    if (input.taskId.includes(":")) {
      throw new AppError("VALIDATION_ERROR", "That looks like a reviews taskId; pass the bare taskId `local posts` returned.");
    }
    taskId = input.taskId;
  } else {
    const identifier = resolveBusinessIdentifier(input);
    check(z.object({ depth: z.number().int().min(10).max(100) }), input, "--depth");
    taskId = await client.business.updatesTaskPost({
      keyword: businessIdentifierKeyword(identifier),
      ...businessLocation(input),
      depth: input.depth,
    });
  }
  const outcome = await pollBusinessTask({ endpoint: "my_business_updates", taskId }, taskId, input.pollIntervalMs);
  if (outcome.status === "pending") return done({ status: "processing" as const, taskId });
  return done({ status: "completed" as const, taskId, updates: resultItems(outcome.result).map((row) => pickRowFields(row, BUSINESS_UPDATE_ROW_FIELDS)) });
}
