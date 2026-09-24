import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OperationError } from "../src/errors.js";
import { localBusinesses, localCategories, localPosts, localProfile, localQuestions, localRankGrid, localReviews, localSerp } from "../src/local.js";
import { runCli, withFetch, withProject } from "./helpers.js";

const api = "https://api.dataforseo.com/v3";
const task = (result: unknown, extra: Record<string, unknown> = {}) =>
  Response.json({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0.003, path: ["v3"], result, ...extra }] });
const items = (rows: unknown[]) => task([{ items: rows }]);
const noResults = () => Response.json({ status_code: 20000, tasks: [{ status_code: 40501, status_message: "No Search Results.", cost: 0.003, path: ["v3"], result: null }] });
const sent = (request: { body: unknown }) => (request.body as Array<Record<string, unknown>>)[0];
const isInput = (message: RegExp) => (error: unknown) => error instanceof OperationError && error.kind === "input" && message.test(error.message);

test("business search sends OpenSEO's coordinate, filters and sort, trims rows and treats no results as empty", async () => {
  const row = { title: "Joe's Pizza", category: "Pizza", rating: { value: 4.6, votes_count: 812 }, cid: "123", is_claimed: false, popular_times: { monday: [1, 2, 3] }, main_image: "https://img" };
  const { result, requests } = await withFetch(() => items([row]), () => localBusinesses({
    query: "pizza", near: { latitude: 40.7128, longitude: -74.006, radiusKm: 2.6 }, categories: ["pizza_restaurant"], minRating: 4, minReviews: 50, isClaimed: false, sortBy: "reviews", limit: 10,
  }));
  assert.equal(requests[0].url, `${api}/business_data/business_listings/search/live`);
  assert.deepEqual(sent(requests[0]), {
    categories: ["pizza_restaurant"], title: "pizza", location_coordinate: "40.7128,-74.006,3", is_claimed: false,
    filters: [["rating.value", ">=", 4], "and", ["rating.votes_count", ">=", 50]], order_by: ["rating.votes_count,desc"], limit: 10,
  });
  assert.deepEqual(result.businesses, [{ title: "Joe's Pizza", category: "Pizza", rating: { value: 4.6, votes_count: 812 }, cid: "123", is_claimed: false }], "heavy fields like popular_times are dropped");
  const empty = await withFetch(noResults, () => localBusinesses({ near: { latitude: 1, longitude: 1, radiusKm: 1 }, limit: 20 }));
  assert.deepEqual([empty.result.businesses, empty.result.costUsd], [[], 0.003]);
  await withFetch(() => assert.fail("no call"), () => assert.rejects(localBusinesses({ near: { latitude: 91, longitude: 0, radiusKm: 5 }, limit: 20 }), isInput(/--near\/--radius/)));
  await withFetch(() => items(["not a business"]), () => assert.rejects(
    localBusinesses({ near: { latitude: 1, longitude: 1, radiusKm: 1 }, limit: 20 }),
    (error: unknown) => error instanceof OperationError && error.kind === "provider" && /business_listings returned an invalid response shape/.test(error.message),
  ));
});

test("local SERP targets Maps or Local Finder with OpenSEO's viewport and device defaults", async () => {
  const maps = await withFetch(() => items([{ rank_absolute: 1, title: "A", cid: "9", total_photos: 3, snippet_xpath: "//x" }]), () => localSerp({ keyword: "plumber", near: { latitude: 51.5, longitude: -0.12, zoom: 14 }, searchType: "maps", device: "mobile", depth: 20, languageCode: "en" }));
  assert.deepEqual([maps.requests[0].url, sent(maps.requests[0])], [`${api}/serp/google/maps/live/advanced`, { keyword: "plumber", location_coordinate: "51.5,-0.12,14z", language_code: "en", device: "mobile", os: "android", depth: 20, search_places: false }]);
  assert.deepEqual(maps.result.results, [{ rank_absolute: 1, title: "A", cid: "9", total_photos: 3 }]);
  await withFetch(() => items([42]), () => assert.rejects(
    localSerp({ keyword: "plumber", near: { latitude: 51.5, longitude: -0.12 }, searchType: "maps", device: "mobile", depth: 20, languageCode: "en" }),
    (error: unknown) => error instanceof OperationError && error.kind === "provider" && /google-maps-live-advanced returned an invalid response shape/.test(error.message),
  ));
  const finder = await withFetch(() => items([]), () => localSerp({ keyword: "plumber", near: { latitude: 51.5, longitude: -0.12 }, searchType: "local_finder", device: "desktop", depth: 5, languageCode: "en" }));
  assert.deepEqual([finder.requests[0].url, sent(finder.requests[0]).location_coordinate, sent(finder.requests[0]).os], [`${api}/serp/google/local_finder/live/advanced`, "51.5,-0.12", "windows"]);
});

test("categories are fetched once, cached for a week, filtered locally and validated", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agenticseo-local-"));
  try {
    const list = [{ category_name: "pizza_restaurant", business_count: 900 }, { category_name: "plumber", business_count: 800 }, { category_name: "pizza_delivery", business_count: null }];
    const first = await withFetch(() => task(list), () => localCategories({ query: "PIZZA", limit: 1, cacheDirectory: directory }));
    assert.equal(first.requests[0].url, `${api}/business_data/business_listings/categories`);
    assert.deepEqual(first.result, { totalMatched: 2, categories: [{ category: "pizza_restaurant", businessCount: 900 }], cached: false });
    const again = await withFetch(() => assert.fail("cached"), () => localCategories({ limit: 50, cacheDirectory: directory }));
    assert.deepEqual([again.result.totalMatched, again.result.cached], [3, true]);
    const fresh = await mkdtemp(join(tmpdir(), "agenticseo-local-"));
    try {
      await withFetch(() => task([{ category_name: 7 }]), () => assert.rejects(localCategories({ limit: 50, cacheDirectory: fresh }), (error: unknown) => error instanceof OperationError && error.kind === "provider" && /categories returned an invalid response shape/.test(error.message)));
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("profile lookups use the cid prefix, the market or a coordinate in meters, and merge check_url", async () => {
  const profile = { title: "Joe's Pizza", cid: "123", rating: { value: 4.6 } };
  const byMarket = await withFetch(() => task([{ check_url: "https://maps.google.com/?cid=123", items: [profile] }]), () => localProfile({ cid: "123", locationCode: 2840, languageCode: "en" }));
  assert.deepEqual(sent(byMarket.requests[0]), { keyword: "cid:123", location_code: 2840, language_code: "en" });
  assert.equal(byMarket.result.profile?.check_url, "https://maps.google.com/?cid=123");
  const byCoordinate = await withFetch(() => task([{ items: [profile] }]), () => localProfile({ businessName: "Joe's Pizza", near: { latitude: 40.7, longitude: -74, radiusKm: 0.05 + 0.2 }, locationCode: 2840, languageCode: "en" }));
  assert.deepEqual(sent(byCoordinate.requests[0]), { keyword: "Joe's Pizza", location_coordinate: "40.7,-74,250", language_code: "en" });
  const missing = await withFetch(noResults, () => localProfile({ placeId: "ChIJ", locationCode: 2840, languageCode: "en" }));
  assert.equal(missing.result.profile, null);
  await withFetch(() => assert.fail("no call"), () => assert.rejects(localProfile({ cid: "1", placeId: "2", locationCode: 2840, languageCode: "en" }), isInput(/exactly one business identifier/)));
});

test("questions merge answered and unanswered rows, trim them, and reject a malformed result", async () => {
  const { result, requests } = await withFetch(() => task([{
    items: [{ question_text: "Open late?", uule: "long", items: [{ answer_text: "Yes", profile_image_url: "x" }] }],
    items_without_answers: [{ question_text: "Parking?" }],
  }]), () => localQuestions({ placeId: "ChIJ", near: { latitude: 40.7, longitude: -74, radiusKm: 3 }, depth: 20, languageCode: "en" }));
  assert.deepEqual(sent(requests[0]), { keyword: "place_id:ChIJ", location_coordinate: "40.7,-74,3000", language_code: "en", depth: 20 });
  assert.deepEqual(result.questions, [{ question_text: "Open late?", items: [{ answer_text: "Yes" }] }, { question_text: "Parking?", items: null }]);
  await withFetch(() => task([{ items: "nope" }]), () => assert.rejects(
    localQuestions({ cid: "1", near: { latitude: 40.7, longitude: -74, radiusKm: 3 }, depth: 20, languageCode: "en" }),
    (error: unknown) => error instanceof OperationError && error.kind === "provider" && /questions_and_answers returned an invalid response shape/.test(error.message),
  ));
});

test("the rank grid searches every point north-first at a derived zoom, matches the target and reports failed points", async () => {
  const { result, requests } = await withFetch((_url, init) => {
    const [latitude, longitude] = String(sent({ body: JSON.parse(String(init.body)) }).location_coordinate).split(",").map(Number);
    if (latitude > 40.72 && longitude > -73.99) return Response.json({ status_code: 50000, status_message: "Internal Error." }, { status: 500 });
    const target = { rank_absolute: latitude > 40.72 ? 2 : 5, title: "Joe's Pizza", cid: "123", place_id: "ChIJ" };
    return items(latitude < 40.7 ? [{ rank_absolute: 1, title: "Rival", cid: "9" }] : [{ rank_absolute: 1, title: "Rival", cid: "9" }, target]);
  }, () => localRankGrid({ keyword: "pizza", center: { latitude: 40.7128, longitude: -74.006 }, target: { cid: "123" }, languageCode: "en" }));
  assert.equal(requests.length, 9 + 2, "nine points, plus two retries of the one point that answers with a transient 5xx");
  const coordinates = requests.map((request) => String(sent(request).location_coordinate));
  assert.ok(coordinates.every((coordinate) => coordinate.endsWith(",13z")), "zoom derived from 2 km spacing at this latitude");
  assert.deepEqual([result.gridSize, result.spacingKm, result.zoom, result.summary.pointsSearched], [3, 2, 13, 9]);
  assert.equal(result.grid[0].row, 0);
  assert.ok(result.grid[0].latitude > result.grid[8].latitude, "row 0 is the northern edge");
  assert.deepEqual(result.grid[2], { ...result.grid[2], rank: null, error: true });
  assert.deepEqual(result.matchedBusiness, { title: "Joe's Pizza", cid: "123", placeId: "ChIJ" });
  assert.deepEqual(result.summary, { pointsSearched: 9, pointsFound: 5, averageRank: 3.8, top3Count: 2, top10Count: 5 }, "north row ranks 2 (one point failed), middle row 5, south row not found");
  assert.equal(result.grid[8].topResult?.title, "Rival");
});

test("the rank grid stops on a credentials failure and surfaces a systemic one", async () => {
  const rejected = await withFetch(() => new Response("", { status: 401 }), () => assert.rejects(
    localRankGrid({ keyword: "pizza", center: { latitude: 40, longitude: -74 }, target: { name: "joe" }, languageCode: "en" }),
    (error: unknown) => error instanceof OperationError && error.kind === "credentials",
  ));
  assert.equal(rejected.requests.length, 3, "the first batch fails and no later batch is sent (or billed)");
  await withFetch(() => new Response("", { status: 403 }), () => assert.rejects(
    localRankGrid({ keyword: "pizza", center: { latitude: 40, longitude: -74 }, target: { name: "joe" }, languageCode: "en" }),
    /DataForSEO HTTP 403/,
  ));
  await withFetch(() => assert.fail("no call"), () => assert.rejects(localRankGrid({ keyword: "pizza", center: { latitude: 40, longitude: -74 }, target: {}, languageCode: "en" }), isInput(/target needs at least one/)));
});

const posted = (id: string, cost = 0.00375) => Response.json({ status_code: 20000, tasks: [{ id, status_code: 20100, status_message: "Task Created.", cost, path: ["v3", "business_data"] }] });
const pending = () => Response.json({ status_code: 20000, tasks: [{ status_code: 40602, status_message: "Task In Queue.", path: ["v3"] }] });
const collected = (result: Record<string, unknown>) => Response.json({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0, path: ["v3"], result: [result] }] });
const us = { locationCode: 2840, languageCode: "en" };

test("reviews post one billed task, poll for free and trim rows to OpenSEO's fields", async () => {
  let polls = 0;
  const { result, requests } = await withFetch((url) => {
    if (url.endsWith("/reviews/task_post")) return posted("t-1");
    polls += 1;
    return polls < 2 ? pending() : collected({ title: "Little Charli", reviews_count: 885, rating: { value: 4.9 }, cid: "123", items: [{ rating: { value: 5 }, review_text: "Great", profile_name: "Ann", owner_answer: null, profile_image_url: "https://img", xpath: "//x" }] });
  }, () => localReviews({ cid: "123", ...us, depth: 20, sortBy: "newest", includeOtherSources: false, pollIntervalMs: 0 }));
  assert.deepEqual(sent(requests[0]), { cid: "123", location_code: 2840, language_code: "en", depth: 20, sort_by: "newest", priority: 2 });
  assert.equal(requests[1].url, `${api}/business_data/google/reviews/task_get/t-1`);
  assert.deepEqual([result.status, result.taskId, result.costUsd], ["completed", "google:t-1", 0.00375], "only the post is billed");
  assert.ok(result.status === "completed");
  assert.deepEqual(result.reviews, [{ rating: { value: 5 }, review_text: "Great", profile_name: "Ann", owner_answer: null }]);
  assert.deepEqual(result.totals, { title: "Little Charli", reviews_count: 885, rating: { value: 4.9 }, cid: "123", place_id: null });
});

test("a billed task post is never retried, and a failed collection keeps the task id", async () => {
  const failedPost = await withFetch(() => new Response("", { status: 500 }), () => assert.rejects(localReviews({ cid: "1", ...us, depth: 20, sortBy: "newest", includeOtherSources: false, pollIntervalMs: 0 }), /HTTP 500/));
  assert.equal(failedPost.requests.length, 1, "a 5xx does not prove the post was not charged");
  await withFetch((url) => (url.endsWith("task_post") ? posted("t-2") : Response.json({ status_code: 20000, tasks: [{ status_code: 50000, status_message: "Internal Error.", path: ["v3"] }] })), () => assert.rejects(
    localReviews({ cid: "1", ...us, depth: 20, sortBy: "newest", includeOtherSources: false, pollIntervalMs: 0 }),
    (error: unknown) => error instanceof OperationError && error.kind === "provider" && /call again with taskId "google:t-2" at no extra cost/.test(error.message),
  ));
});

test("a task still queued comes back as processing and resumes by task id at no cost", async () => {
  const first = await withFetch((url) => (url.endsWith("task_post") ? posted("t-3", 0.0075) : pending()), () => localReviews({ placeId: "ChIJ", ...us, depth: 40, sortBy: "newest", includeOtherSources: true, pollIntervalMs: 0 }));
  assert.equal(first.requests[0].url, `${api}/business_data/google/extended_reviews/task_post`);
  assert.equal("sort_by" in sent(first.requests[0]), false, "the extended endpoint has no sort");
  assert.deepEqual([first.result.status, first.result.taskId, first.requests.length], ["processing", "extended:t-3", 1 + 6]);
  const resumed = await withFetch(() => collected({ items: [] }), () => localReviews({ ...us, taskId: "extended:t-3", depth: 20, sortBy: "newest", includeOtherSources: false, pollIntervalMs: 0 }));
  assert.deepEqual([resumed.requests[0].url, resumed.result.status, resumed.result.costUsd], [`${api}/business_data/google/extended_reviews/task_get/t-3`, "completed", 0]);
  await withFetch(() => assert.fail("no call"), () => assert.rejects(localReviews({ ...us, taskId: "t-3", depth: 20, sortBy: "newest", includeOtherSources: false }), isInput(/taskId must be the value/)));
});

test("posts use the business keyword prefix, trim rows and refuse a reviews task id", async () => {
  const { result, requests } = await withFetch((url) => (url.endsWith("task_post") ? posted("p-1") : collected({ items: [{ post_text: "New menu", post_date: "2026-09-01", images_url: ["x"], url: "https://g.page/p" }] })), () => localPosts({ cid: "123", ...us, depth: 10, pollIntervalMs: 0 }));
  assert.deepEqual([requests[0].url, sent(requests[0])], [`${api}/business_data/google/my_business_updates/task_post`, { keyword: "cid:123", location_code: 2840, language_code: "en", depth: 10, priority: 2 }]);
  assert.ok(result.status === "completed");
  assert.deepEqual([result.status, result.taskId, result.updates], ["completed", "p-1", [{ post_date: "2026-09-01", post_text: "New menu", url: "https://g.page/p" }]]);
  await withFetch(() => assert.fail("no call"), () => assert.rejects(localPosts({ ...us, taskId: "google:t-1", depth: 10 }), isInput(/looks like a reviews taskId/)));
});

test("local commands validate their options with the input exit code", async () => {
  await withProject(async (root) => {
    for (const args of [
      ["local", "nearby"],
      ["local", "businesses", "--near", "40.7"],
      ["local", "businesses", "--near", "40.7,-74"],
      ["local", "businesses", "--near", "40.7,-74", "--radius", "5", "--claimed", "--unclaimed"],
      ["local", "serp", "pizza"],
      ["local", "profile", "--radius", "5", "--cid", "1"],
      ["local", "grid", "pizza", "--center", "40,-74", "--cid", "1", "--size", "4"],
      ["local", "questions", "--cid", "1", "--near", "40,-74"],
    ]) {
      const result = runCli(root, args);
      assert.equal(result.status, 2, `${args.join(" ")}: ${result.stderr}`);
    }
  });
});
