import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OperationError } from "../src/errors.js";
import { eachItem, researchKeywords, serpResults } from "../src/keywords.js";
import { createFileCache } from "../src/openseo/cache.js";
import { openStore, type Store } from "../src/store.js";
import { runCli, withFetch, withProject } from "./helpers.js";

const project = { domain: "example.com", locationCode: 2840, languageCode: "en" };
const api = "https://api.dataforseo.com/v3";

const labsItem = (keyword: string, volume: number | null = 100) => ({
  keyword,
  keyword_info: { search_volume: volume, cpc: 1.5, competition: 0.3, monthly_searches: [{ year: 2026, month: 8, search_volume: volume }] },
  keyword_properties: { keyword_difficulty: 20 },
  search_intent_info: { main_intent: "commercial" },
});
const labsResponse = (items: unknown[], cost = 0.02) => Response.json({ status_code: 20000, tasks: [{ status_code: 20000, cost, path: ["v3", "dataforseo_labs"], result: [{ items }] }] });

/** A scratch project directory: its cache directory and an open project database. */
async function withCache<T>(run: (cacheDirectory: string, db: Store) => Promise<T>) {
  const directory = await mkdtemp(join(tmpdir(), "agenticseo-cache-"));
  const db = await openStore(directory);
  try {
    return await run(directory, db);
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("research uses related keywords when they cover the seed, then serves the cached result for free", async () => {
  await withCache(async (cacheDirectory, db) => {
    const related = ["seo audit", "seo audit tool", "free seo audit", "seo audit checklist", "website seo audit", "seo audit report"];
    const options = { resultLimit: 150 as const, clickstream: false, cacheDirectory, db };
    const live = await withFetch(
      () => labsResponse(related.map((keyword) => ({ keyword_data: labsItem(keyword) }))),
      () => researchKeywords(project, "SEO Audit", options),
    );
    assert.deepEqual(live.requests.map((request) => request.url), [`${api}/dataforseo_labs/google/related_keywords/live`]);
    assert.deepEqual(live.requests[0].body, [{ keyword: "seo audit", location_code: 2840, language_code: "en", limit: 150, depth: 3, include_clickstream_data: false, include_serp_info: false }]);
    assert.equal(live.result.source, "related");
    assert.equal(live.result.usedFallback, false);
    assert.equal(live.result.cached, false);
    assert.equal(live.result.costUsd, 0.02);
    assert.deepEqual(live.result.rows[1], { keyword: "seo audit tool", searchVolume: 100, trend: [{ year: 2026, month: 8, searchVolume: 100 }], cpc: 1.5, competition: 0.3, keywordDifficulty: 20, intent: "commercial" });

    const stored = db.prepare("SELECT keyword, search_volume, monthly_searches FROM keyword_metrics WHERE location_code = 2840 ORDER BY keyword").all();
    assert.equal(stored.length, 6, "every researched keyword's metrics are stored, as OpenSEO's persistRows does");
    assert.deepEqual({ ...stored[0] }, { keyword: "free seo audit", search_volume: 100, monthly_searches: JSON.stringify([{ year: 2026, month: 8, searchVolume: 100 }]) });

    const again = await withFetch(() => assert.fail("a cached research must not call DataForSEO"), () => researchKeywords(project, "seo audit", options));
    assert.equal(again.result.cached, true);
    assert.equal(again.result.costUsd, 0);
    assert.deepEqual(again.result.rows, live.result.rows);
  });
});

test("research falls back to suggestions when related keywords are too few, keeping unknown trend volumes null", async () => {
  await withCache(async (cacheDirectory, db) => {
    const { result, requests } = await withFetch(
      (url) => url.includes("related_keywords")
        ? labsResponse([{ keyword_data: labsItem("seo audit") }, { keyword_data: labsItem("seo audit tool", null) }])
        : labsResponse(["seo audit", "a", "b", "c", "d"].map((keyword) => labsItem(keyword)), 0.01),
      () => researchKeywords(project, "seo audit", { resultLimit: 150, clickstream: false, cacheDirectory, db }),
    );
    assert.deepEqual(requests.map((request) => request.url.split("/").at(-2)), ["related_keywords", "keyword_suggestions"]);
    assert.equal(result.source, "suggestions");
    assert.equal(result.usedFallback, true);
    assert.equal(result.costUsd, 0.03);
    assert.deepEqual(result.rows.map((row) => row.keyword), ["seo audit", "seo audit tool", "a", "b", "c", "d"]);
    assert.deepEqual(result.rows[1].trend, [{ year: 2026, month: 8, searchVolume: null }]);
  });
});

test("research routes Google-Ads-only markets to keywords_for_keywords and refuses clickstream there", async () => {
  await withCache(async (cacheDirectory, db) => {
    const andorra = { ...project, locationCode: 2020, languageCode: "ca" };
    const ads = { status_code: 20000, tasks: [{ status_code: 20000, cost: 0.09, path: ["v3", "keywords_data"], result: [
      { keyword: "SEO", search_volume: 50, cpc: 5.5, competition: "LOW", competition_index: 26, monthly_searches: null },
      { keyword: "seo andorra", search_volume: null, cpc: null, competition: null, competition_index: null, monthly_searches: null },
    ] }] };
    const { result, requests } = await withFetch(() => Response.json(ads), () => researchKeywords(andorra, "seo", { resultLimit: 150, clickstream: false, cacheDirectory, db }));
    assert.equal(requests[0].url, `${api}/keywords_data/google_ads/keywords_for_keywords/live`);
    assert.equal(result.source, "google_ads");
    assert.deepEqual(result.rows[0], { keyword: "seo", searchVolume: 50, trend: [], cpc: 5.5, competition: 0.26, keywordDifficulty: null, intent: "unknown" });
    await assert.rejects(researchKeywords(andorra, "seo", { resultLimit: 150, clickstream: true, cacheDirectory, db }), /only to markets served by DataForSEO Labs/);
  });
});

test("serp returns every result type trimmed like OpenSEO's MCP tool and treats no results as empty", async () => {
  const serp = { status_code: 20000, tasks: [{ status_code: 20000, cost: 0.004, path: ["v3", "serp"], result: [{ items: [
    { type: "organic", rank_group: 1, rank_absolute: 1, domain: "a.com", title: "A", url: "https://a.com/", description: "First", etv: 10 },
    { type: "people_also_ask", rank_group: 1, rank_absolute: 2, title: "People also ask" },
    { type: "organic", rank_group: 2, rank_absolute: 3, domain: "b.com", title: "B", url: "https://b.com/x", description: null },
  ] }] }] };
  const { result, requests } = await withFetch(() => Response.json(serp), () => serpResults(project, "seo audit", 20));
  assert.deepEqual(requests[0].body, [{ keyword: "seo audit", location_code: 2840, language_code: "en", device: "desktop", os: "windows", depth: 20 }]);
  assert.deepEqual(result.items.map(({ type, rank, domain }) => ({ type, rank, domain })), [
    { type: "organic", rank: 1, domain: "a.com" },
    { type: "people_also_ask", rank: 2, domain: null },
    { type: "organic", rank: 3, domain: "b.com" },
  ]);
  assert.equal(result.costUsd, 0.004);

  const empty = { status_code: 20000, tasks: [{ status_code: 40501, status_message: "No Search Results.", cost: 0.002, path: ["v3", "serp"], result: null }] };
  const none = await withFetch(() => Response.json(empty), () => serpResults(project, "zzqx nothing", 20));
  assert.deepEqual(none.result.items, []);
  assert.equal(none.result.costUsd, 0.002, "an empty SERP is still billed and reported");
});

test("research and serp commands save evidence, report cache hits and validate arguments", async () => {
  await withProject(async (root) => {
    const env = { DATAFORSEO_API_KEY: "TEST_KEY" };
    type SeedResult = { seed: string; ok: boolean; source?: string; cached?: boolean; totalRows?: number; rows?: Array<Record<string, unknown>>; error?: string };
    type ResearchOutput = { mode: string; results: SeedResult[]; costUsd: number; evidence: string };
    const first = runCli(root, ["research", "seo audit"], { env, mock: true });
    assert.equal(first.status, 0, first.stderr);
    const live = JSON.parse(first.stdout) as ResearchOutput;
    const [seed] = live.results;
    assert.deepEqual([live.mode, seed.ok, seed.source, seed.cached, live.costUsd, seed.totalRows], ["auto", true, "related", false, 0.02, 6]);
    assert.equal("trend" in (seed.rows ?? [])[0], false, "trends stay in the evidence");
    const evidence = JSON.parse(await readFile(live.evidence, "utf8")) as { results: Array<{ seed: string; ok: boolean; value: { rows: unknown[]; calls: unknown[] } }> };
    assert.equal(evidence.results[0].value.rows.length, 6);
    assert.equal(evidence.results[0].value.calls.length, 1);

    // A batch researches each seed on its own: the cached one is free, the failed one is reported.
    const batch = runCli(root, ["research", "seo audit", "provider outage", "seo tools", "--mode", "related"], { env, mock: true });
    assert.equal(batch.status, 0, batch.stderr);
    const second = JSON.parse(batch.stdout) as ResearchOutput;
    assert.deepEqual(second.results.map((result) => [result.seed, result.ok, result.cached ?? null]), [["seo audit", true, false], ["provider outage", false, null], ["seo tools", true, false]]);
    assert.match(second.results[1].error ?? "", /502/);
    assert.equal(second.costUsd, 0.04);
    assert.equal(second.results[0].rows?.length, 6, "a batch shows up to 10 rows per seed");
    const again = JSON.parse(runCli(root, ["research", "seo audit", "seo tools", "--mode", "related"], { env, mock: true }).stdout) as ResearchOutput;
    assert.deepEqual([again.results.map((result) => result.cached), again.costUsd], [[true, true], 0]);
    assert.match(await readFile(join(root, ".agenticseo", "cache", ".gitignore"), "utf8"), /\*\n/);
    assert.equal(runCli(root, ["research", "provider outage"], { env, mock: true }).status, 4, "a batch where every seed failed fails");
    assert.equal(runCli(root, ["research", "seo audit x", "rejected key"], { env, mock: true }).status, 3, "a rejected key stops the batch");

    const serp = runCli(root, ["serp", "seo audit", "--depth", "10"], { env, mock: true });
    assert.equal(serp.status, 0, serp.stderr);
    type SerpOutput = { depth: number; results: Array<{ query: string; ok: boolean; items?: Array<{ domain: string; description?: string }>; error?: string }>; costUsd: number };
    const serpOutput = JSON.parse(serp.stdout) as SerpOutput;
    assert.deepEqual([serpOutput.depth, serpOutput.results[0].items?.[0].domain, serpOutput.results[0].items?.[0].description, serpOutput.costUsd], [10, "a.com", "First", 0.004]);
    const serps = JSON.parse(runCli(root, ["serp", "seo audit", "provider outage", "seo tools"], { env, mock: true }).stdout) as SerpOutput;
    assert.deepEqual(serps.results.map((result) => [result.query, result.ok]), [["seo audit", true], ["provider outage", false], ["seo tools", true]]);
    assert.equal(serps.results[0].items?.[0].description, undefined, "a batch leaves descriptions in the evidence");
    assert.equal(serps.costUsd, 0.008);

    for (const args of [
      ["research", "seo audit", "--limit", "200"],
      ["research", "seo audit", "--mode", "fast"],
      ["research", "a", "b", "c", "d", "e", "f"],
      ["serp", "seo audit", "--depth", "15"],
      ["serp", ...Array.from({ length: 11 }, (_, index) => `query ${index}`)],
      ["serp"],
    ]) {
      const result = runCli(root, args, { env, mock: true });
      assert.equal(result.status, 2, `${args.join(" ")}: ${result.stderr}`);
    }
  });
});

test("the file cache honors expiry and treats an unreadable entry as a miss", async () => {
  await withCache(async (directory) => {
    const cache = createFileCache(directory);
    await cache.set("kw:research:fresh", { rows: 1 }, 60);
    await cache.set("kw:research:stale", { rows: 1 }, -1);
    assert.deepEqual(await cache.get("kw:research:fresh"), { rows: 1 });
    assert.equal(await cache.get("kw:research:stale"), null);
    assert.equal(await cache.get("kw:research:absent"), null);
    await writeFile(join(directory, "kw_research_broken.json"), "{ not json");
    assert.equal(await cache.get("kw:research:broken"), null);
  });
});

test("research rejects a related-keywords payload with the wrong shape as a provider failure", async () => {
  await withCache(async (cacheDirectory, db) => {
    const bad = labsResponse([{ keyword_data: { keyword: "seo audit", keyword_info: { search_volume: "many" } } }]);
    await withFetch(() => bad, () => assert.rejects(
      researchKeywords(project, "seo audit", { resultLimit: 150, clickstream: false, cacheDirectory, db }),
      (error: unknown) => error instanceof OperationError && error.kind === "provider" && /related_keywords returned an invalid response shape/.test(error.message),
    ));
  });
});

test("a bulk call reports failed items, but stops on a rejected key or a local bug and fails when nothing succeeded", async () => {
  const provider = new OperationError("provider", "down");
  const run = (failures: Record<string, unknown>) => eachItem(["a", "b"], async (item) => {
    if (item in failures) throw failures[item];
    return item.toUpperCase();
  });
  assert.deepEqual(await run({ b: provider }), [{ ok: true, value: "A" }, { ok: false, error: "down" }]);
  await assert.rejects(run({ b: new OperationError("credentials", "bad key") }), /bad key/);
  await assert.rejects(run({ b: new TypeError("bug") }), TypeError);
  await assert.rejects(run({ a: provider, b: new OperationError("input", "bad seed") }), /down/);
});
