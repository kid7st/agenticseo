import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { domainKeywords, domainOverview, domainPages, rankedKeywords, serpCompetitors } from "../src/domain.js";
import { OperationError } from "../src/errors.js";
import { runCli, withFetch, withProject } from "./helpers.js";

const market = { locationCode: 2840, languageCode: "en" };
const api = "https://api.dataforseo.com/v3/dataforseo_labs/google";
const labs = (items: unknown[], extra: Record<string, unknown> = {}) =>
  Response.json({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0.0101, path: ["v3", "dataforseo_labs"], result: [{ items, ...extra }] }] });

async function withCache<T>(run: (cacheDirectory: string) => Promise<T>) {
  const directory = await mkdtemp(join(tmpdir(), "agenticseo-cache-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("domain overview rounds Labs metrics, labels the scope and caches only results with data", async () => {
  await withCache(async (cacheDirectory) => {
    const live = await withFetch(
      () => labs([{ metrics: { organic: { etv: 1234.6, count: 88.2 } } }]),
      () => domainOverview(market, { target: "https://www.example.com/pricing", scope: "exact_url", cacheDirectory }),
    );
    assert.deepEqual(live.requests[0], { url: `${api}/domain_rank_overview/live`, authorization: "Basic TEST_KEY", body: [{ target: "example.com", location_code: 2840, language_code: "en", limit: 1 }] });
    assert.deepEqual(
      { traffic: live.result.organicTraffic, keywords: live.result.organicKeywords, scope: live.result.scope, target: live.result.displayTarget, cached: live.result.cached },
      { traffic: 1235, keywords: 88, scope: "exact_url", target: "example.com/pricing", cached: false },
    );
    const cached = await withFetch(() => assert.fail("a cached overview must not call DataForSEO"), () => domainOverview(market, { target: "example.com", cacheDirectory }));
    assert.equal(cached.result.cached, true);
    assert.equal(cached.result.scope, "subdomains", "one cache entry per hostname, relabeled per request");

    let calls = 0;
    const empty = () => withFetch(() => (calls++, labs([{ metrics: { organic: { etv: 0, count: 0 } } }])), () => domainOverview(market, { target: "empty.com", cacheDirectory }));
    assert.equal((await empty()).result.hasData, false);
    await empty();
    assert.equal(calls, 2, "a result without data is not cached");
  });
});

test("ranked keywords sends OpenSEO's scope filter, user filters, sort and paging, and maps rows", async () => {
  const item = { keyword_data: { keyword: "seo audit", keyword_info: { search_volume: 1200.4, cpc: 2.5 }, keyword_properties: { keyword_difficulty: 34.6 } }, ranked_serp_element: { serp_item: { url: "https://example.com/audit?x=1", relative_url: "/audit?x=1", rank_absolute: 3, etv: 45.5 } } };
  const { result, requests } = await withFetch(
    () => labs([item, { keyword_data: null }], { total_count: 120 }),
    () => rankedKeywords(market, { target: "example.com", scope: "domain", minSearchVolume: 100, maxRank: 10, excludeBrandTerms: ["acme"], sortBy: "rank", resultTypes: ["organic"], limit: 2, offset: 10 }),
  );
  assert.equal(requests[0].url, `${api}/ranked_keywords/live`);
  assert.deepEqual(requests[0].body, [{
    target: "example.com", location_code: 2840, language_code: "en", limit: 2, offset: 10,
    order_by: ["ranked_serp_element.serp_item.rank_absolute,asc"],
    filters: [
      ["ranked_serp_element.serp_item.domain", "in", ["example.com", "www.example.com"]], "and",
      ["keyword_data.keyword_info.search_volume", ">=", 100], "and",
      ["ranked_serp_element.serp_item.rank_absolute", "<=", 10], "and",
      ["keyword_data.keyword", "not_ilike", "%acme%"],
    ],
    item_types: ["organic"],
  }]);
  assert.deepEqual(result.rows, [{ keyword: "seo audit", position: 3, searchVolume: 1200, traffic: 45.5, cpc: 2.5, url: "https://example.com/audit?x=1", relativeUrl: "/audit?x=1", keywordDifficulty: 35 }]);
  assert.deepEqual([result.target, result.scope, result.totalCount, result.nextOffset], ["example.com", "domain", 120, 12]);
});

test("ranked keywords rejects targets and filters OpenSEO rejects, before any call", async () => {
  await withFetch(() => assert.fail("must not call DataForSEO"), async () => {
    await assert.rejects(rankedKeywords(market, { target: "www.example.com", limit: 50 }), /Use a domain without protocol\/www/);
    const tenTerms = Array.from({ length: 10 }, (_, index) => `brand${index}`);
    await assert.rejects(rankedKeywords(market, { target: "https://example.com/a", scope: "exact_url", excludeBrandTerms: tenTerms, limit: 50 }), /Too many filter conditions \(14 of 8 max\)/);
    await assert.rejects(rankedKeywords(market, { target: "example.com", resultTypes: ["organic", "video"], limit: 50 }), /--types/);
  });
});

test("SERP competitors defaults result types, drops excluded domains with their subdomains and sorts by visibility", async () => {
  const { result, requests } = await withFetch(
    () => labs([
      { domain: "rival.com", visibility: 0.2, keywords_count: 5, avg_position: 4, median_position: 3, etv: 90 },
      { domain: "blog.example.com", visibility: 0.9 },
      { domain: "leader.com", visibility: 0.5, keywords_count: 9, avg_position: 2, median_position: 2, etv: 300 },
    ]),
    () => serpCompetitors(market, { keywords: ["seo audit", "seo tool"], excludeDomains: ["example.com"], limit: 50 }),
  );
  assert.deepEqual(requests[0].body, [{ keywords: ["seo audit", "seo tool"], location_code: 2840, language_code: "en", item_types: ["organic", "local_pack"], limit: 50 }]);
  assert.deepEqual(result.rows.map((row) => row.domain), ["leader.com", "rival.com"]);
  assert.deepEqual(result.rows[0], { domain: "leader.com", keywordsCount: 9, avgPosition: 2, medianPosition: 2, visibility: 0.5, etv: 300 });

  await withFetch(() => labs([{ domain: "rival.com", visibility: "high" }]), () => assert.rejects(
    serpCompetitors(market, { keywords: ["seo audit"], limit: 50 }),
    (error: unknown) => error instanceof OperationError && error.kind === "provider" && /serp_competitors returned an invalid response shape/.test(error.message),
  ));
});

test("domain commands refuse markets DataForSEO Labs does not serve instead of switching markets", async () => {
  const andorra = { locationCode: 2020, languageCode: "ca" };
  await withCache((cacheDirectory) => withFetch(() => assert.fail("must not call DataForSEO"), async () => {
    for (const call of [
      domainOverview(andorra, { target: "example.com", cacheDirectory }),
      rankedKeywords(andorra, { target: "example.com", limit: 50 }),
      serpCompetitors(andorra, { keywords: ["seo"], limit: 50 }),
    ]) {
      await assert.rejects(call, (error: unknown) => error instanceof OperationError && error.kind === "input" && /Domain analytics is not available for this country/.test(error.message));
    }
  }));
});

test("domain, ranked and competitors commands validate options with the input exit code", async () => {
  await withProject(async (root) => {
    const env = { DATAFORSEO_API_KEY: "TEST_KEY" };
    for (const args of [
      ["domain", "example.com", "--scope", "site"],
      ["ranked", "example.com", "--limit", "0"],
      ["ranked", "example.com", "--sort", "volume"],
      ["ranked", "example.com", "--max-rank", "101"],
      ["competitors"],
      ["competitors", "seo", "--depth", "10"],
      ["domain-keywords", "example.com", "--min-difficulty", "101"],
      ["domain-keywords", "example.com", "--sort", "difficulty"],
      ["domain-keywords", "example.com", "--page-size", "25"],
    ]) {
      const result = runCli(root, args, { env });
      assert.equal(result.status, 2, `${args.join(" ")}: ${result.stderr}`);
    }
  });
});

test("domain pages sends OpenSEO's page filters and paging, maps pages and caches the page", async () => {
  await withCache(async (cacheDirectory) => {
    const input = {
      target: "https://example.com/blog", scope: "subfolder" as const, sortMode: "keywords" as const, sortOrder: "desc" as const, page: 2, pageSize: 50 as const,
      filters: { include: "guide", exclude: "tag", minTraffic: 10, maxVol: 500 }, cacheDirectory,
    };
    const live = await withFetch(
      () => labs([{ page_address: "https://example.com/blog/seo-guide?ref=1", metrics: { organic: { etv: 120.6, count: 42.4 } } }, { page_address: null }], { total_count: 51 }),
      () => domainPages(market, input),
    );
    assert.equal(live.requests[0].url, `${api}/relevant_pages/live`);
    const body = (live.requests[0].body as Array<Record<string, unknown>>)[0];
    assert.deepEqual([body.target, body.limit, body.offset, body.order_by], ["example.com", 50, 50, ["metrics.organic.count,desc"]]);
    assert.deepEqual((body.filters as unknown[]).slice(1), [
      "and", ["page_address", "ilike", "%guide%"],
      "and", ["page_address", "not_ilike", "%tag%"],
      "and", ["metrics.organic.etv", ">=", 10],
      "and", ["metrics.organic.count", "<=", 500],
    ], "user filters follow the subfolder scope group");
    assert.deepEqual(live.result.pages, [{ page: "https://example.com/blog/seo-guide?ref=1", relativePath: "/blog/seo-guide?ref=1", organicTraffic: 121, keywords: 42 }]);
    assert.deepEqual([live.result.totalCount, live.result.hasMore, live.result.cached], [51, false, false]);

    const again = await withFetch(() => assert.fail("a cached page must not call DataForSEO"), () => domainPages(market, input));
    assert.deepEqual([again.result.cached, again.result.costUsd], [true, 0]);

    await withFetch(() => assert.fail("must not call DataForSEO"), () => assert.rejects(
      domainPages(market, { ...input, filters: { include: "a,b,c,d,e", minTraffic: 1 } }),
      /Too many filter conditions \(10 of 8 max\)/,
    ));
    await withFetch(() => labs([{ page_address: 42 }]), () => assert.rejects(
      domainPages(market, { ...input, page: 3 }),
      (error: unknown) => error instanceof OperationError && error.kind === "provider" && /relevant_pages returned an invalid response shape/.test(error.message),
    ));
  });
});

test("domain keywords sends the app's keyword filters, search and paging, maps rows and caches the page", async () => {
  await withCache(async (cacheDirectory) => {
    const input = {
      target: "example.com", sortMode: "score" as const, sortOrder: "asc" as const, page: 3, pageSize: 50 as const, search: "audit",
      filters: { include: "seo", minVol: 100, maxCpc: 5, minKd: 10, maxKd: 40, maxRank: 20 }, cacheDirectory,
    };
    const item = { keyword_data: { keyword: "seo audit", keyword_info: { search_volume: 1200, cpc: 2.5 }, keyword_properties: { keyword_difficulty: 34 } }, ranked_serp_element: { serp_item: { url: "https://example.com/audit", relative_url: "/audit", rank_absolute: 3, etv: 45.5 } } };
    const live = await withFetch(() => labs([item], { total_count: 101 }), () => domainKeywords(market, input));
    assert.equal(live.requests[0].url, `${api}/ranked_keywords/live`);
    const body = (live.requests[0].body as Array<Record<string, unknown>>)[0];
    assert.deepEqual([body.target, body.limit, body.offset, body.order_by], ["example.com", 50, 100, ["keyword_data.keyword_properties.keyword_difficulty,asc"]]);
    assert.deepEqual(JSON.stringify(body.filters), JSON.stringify([
      ["keyword_data.keyword", "ilike", "%seo%"], "and",
      ["keyword_data.keyword_info.search_volume", ">=", 100], "and",
      ["keyword_data.keyword_info.cpc", "<=", 5], "and",
      ["keyword_data.keyword_properties.keyword_difficulty", ">=", 10], "and",
      ["keyword_data.keyword_properties.keyword_difficulty", "<=", 40], "and",
      ["ranked_serp_element.serp_item.rank_absolute", "<=", 20], "and",
      [["keyword_data.keyword", "ilike", "%audit%"], "or", ["ranked_serp_element.serp_item.url", "ilike", "%audit%"]],
    ]));
    assert.equal(live.result.keywords[0].keyword, "seo audit");
    assert.equal(live.result.keywords[0].keywordDifficulty, 34);
    assert.deepEqual([live.result.totalCount, live.result.hasMore, live.result.cached], [101, false, false]);

    const again = await withFetch(() => assert.fail("a cached page must not call DataForSEO"), () => domainKeywords(market, input));
    assert.deepEqual([again.result.cached, again.result.costUsd], [true, 0]);

    const anyTerm = await withFetch(() => labs([item]), () => domainKeywords(market, { ...input, search: undefined, filters: { include: "seo, audit" } }));
    assert.deepEqual(
      JSON.stringify((anyTerm.requests[0].body as Array<Record<string, unknown>>)[0].filters),
      JSON.stringify([[["keyword_data.keyword", "ilike", "%seo%"], "or", ["keyword_data.keyword", "ilike", "%audit%"]]]),
      "include terms match any term, not all of them",
    );
    await withFetch(() => assert.fail("must not call DataForSEO"), () => assert.rejects(
      domainKeywords(market, { ...input, page: 1, filters: { include: "a,b,c,d,e,f,g" } }),
      /Too many filter conditions \(9 of 8 max\)/,
    ));
  });
});
