import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OperationError } from "../src/errors.js";
import { keywordMetrics } from "../src/keywords.js";
import { runCli } from "./helpers.js";

const fixture = JSON.parse(await readFile(new URL("./keyword-overview.json", import.meta.url), "utf8")) as Record<string, unknown>;
const project = { domain: "example.com", locationCode: 2840, languageCode: "en" };
const labsUrl = "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live";
const adsUrl = "https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live";

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** Swaps global fetch (the ported client calls it directly) and records each request. */
async function withFetch<T>(handler: Handler, run: () => Promise<T>, apiKey = "TEST_KEY") {
  const requests: Array<{ url: string; body: unknown; authorization: string | null }> = [];
  const original = globalThis.fetch;
  const originalKey = process.env.DATAFORSEO_API_KEY;
  process.env.DATAFORSEO_API_KEY = apiKey;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, body: JSON.parse(String(init.body)), authorization: new Headers(init.headers).get("Authorization") });
    return handler(url, init);
  };
  try {
    return { result: await run(), requests };
  } finally {
    globalThis.fetch = original;
    process.env.DATAFORSEO_API_KEY = originalKey;
  }
}

const taskResponse = (task: Record<string, unknown>) => Response.json({ status_code: 20000, tasks: [{ path: ["v3", "x"], ...task }] });

async function failure(handler: Handler, apiKey?: string) {
  const { result } = await withFetch(handler, () => keywordMetrics(project, ["seo audit"], { includeClickstreamData: false }).then(
    () => assert.fail("expected a failure"),
    (error: unknown) => (assert.ok(error instanceof OperationError, String(error)), error),
  ), apiKey);
  return result;
}

test("maps Labs metrics without inventing missing values and records the raw call", async () => {
  const { result, requests } = await withFetch(() => Response.json(fixture), () => keywordMetrics(project, ["seo audit", "seo tool"], { includeClickstreamData: false }));
  assert.deepEqual(requests, [{ url: labsUrl, authorization: "Basic TEST_KEY", body: [{ keywords: ["seo audit", "seo tool"], location_code: 2840, language_code: "en", include_clickstream_data: false }] }]);
  assert.equal(result.source, "labs");
  assert.deepEqual(result.rows, [
    { keyword: "seo audit", searchVolume: 1200, cpc: 2.5, competition: 0.42, competitionLevel: "MEDIUM", keywordDifficulty: 35, intent: "commercial", monthlySearches: [{ year: 2026, month: 8, searchVolume: 1300 }, { year: 2026, month: 7, searchVolume: null }] },
  ]);
  assert.deepEqual(result.missingKeywords, ["seo tool"], "a row with no metric at all counts as missing");
  assert.equal(result.costUsd, 0.01);
  assert.equal(result.calls[0].items.length, 2, "raw items are kept for evidence");
});

test("routes Google-Ads-only markets to search volume, as OpenSEO does", async () => {
  const andorra = { ...project, locationCode: 2020, languageCode: "ca" };
  const ads = { status_code: 20000, tasks: [{ status_code: 20000, cost: 0.075, path: ["v3", "keywords_data"], result: [
    { keyword: "seo audit", search_volume: 20, cpc: 1.1, competition: "LOW", competition_index: 12, monthly_searches: null },
    { keyword: "zzqx", search_volume: null, cpc: null, competition: null, competition_index: null, monthly_searches: null },
  ] }] };
  const { result, requests } = await withFetch(() => Response.json(ads), () => keywordMetrics(andorra, ["seo audit", "zzqx"], { includeClickstreamData: false }));
  assert.equal(requests[0].url, adsUrl);
  assert.equal(result.source, "google_ads");
  assert.deepEqual(result.rows, [{ keyword: "seo audit", searchVolume: 20, cpc: 1.1, competition: 0.12, competitionLevel: "LOW", keywordDifficulty: null, intent: null, monthlySearches: [] }]);
  assert.deepEqual(result.missingKeywords, ["zzqx"]);
  await assert.rejects(keywordMetrics(andorra, ["seo audit"], { includeClickstreamData: true }), /only to markets served by DataForSEO Labs/);
});

test("retries a transient 5xx and then succeeds", async () => {
  let attempts = 0;
  const { result } = await withFetch(() => (++attempts < 3 ? new Response("busy", { status: 503 }) : Response.json(fixture)), () => keywordMetrics(project, ["seo audit"], { includeClickstreamData: false }));
  assert.equal(attempts, 3);
  assert.equal(result.rows.length, 1);
});

test("classifies credential, transport, task and payload failures", async () => {
  const cases: Array<[string, Handler, OperationError["kind"], RegExp, string?]> = [
    ["missing key", () => Response.json(fixture), "credentials", /DATAFORSEO_API_KEY is required/, ""],
    ["HTTP 401", () => new Response("", { status: 401 }), "credentials", /HTTP 401/],
    ["HTTP 403", () => new Response("", { status: 403 }), "provider", /HTTP 403/],
    ["network", () => { throw new TypeError("fetch failed"); }, "provider", /request failed .*fetch failed/],
    ["not JSON", () => new Response("<html>", { status: 200 }), "provider", /not JSON/],
    ["charged task failure", () => taskResponse({ status_code: 40101, status_message: "Internal SE Server Error.", cost: 0.01 }), "provider", /Internal SE Server Error\. \(charged \$0\.01\)/],
    ["invalid market", () => taskResponse({ status_code: 40501, status_message: "Invalid Field: 'location_code'.", cost: 0, data: { location_code: 1 } }), "input", /location_code=1\) \(charged \$0\)/],
    ["invalid item shape", () => taskResponse({ status_code: 20000, cost: 0.01, result: [{ items: [{ keyword: 7 }] }] }), "provider", /invalid response shape: 0\.keyword/],
  ];
  for (const [name, handler, kind, message, apiKey] of cases) {
    const error = await failure(handler, apiKey);
    assert.equal(error.kind, kind, name);
    assert.match(error.message, message, name);
  }
});

test("CLI discovers a project, saves full evidence, and maps failures to exit codes", async () => {
  const root = await mkdtemp(join(tmpdir(), "agenticseo-"));
  try {
    await mkdir(join(root, ".agenticseo"));
    await writeFile(join(root, ".agenticseo", ".gitignore"), "custom-ignore\n");
    const init = runCli(root, ["init", "--domain", "example.com", "--location", "2840", "--language", "en"]);
    assert.equal(init.status, 0, init.stderr);
    assert.equal(await readFile(join(root, ".agenticseo", ".gitignore"), "utf8"), "custom-ignore\n");
    assert.match(await readFile(join(root, ".agenticseo", "evidence", ".gitignore"), "utf8"), /\*\n/);
    const nested = join(root, "nested");
    await mkdir(nested);

    const missingKey = runCli(nested, ["keywords", "seo audit"]);
    assert.equal(missingKey.status, 3);
    assert.match(missingKey.stderr, /DATAFORSEO_API_KEY is required/);

    const outage = runCli(nested, ["keywords", "provider outage"], { env: { DATAFORSEO_API_KEY: "TEST_KEY" }, mock: true });
    assert.equal(outage.status, 4);
    assert.match(outage.stderr, /DataForSEO HTTP 502/);

    const result = runCli(nested, ["keywords", "seo audit", "seo tool", "missing term"], { env: { DATAFORSEO_API_KEY: "TEST_KEY" }, mock: true });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout) as { project: typeof project; rows: unknown[]; missingKeywords: string[]; evidence: string };
    assert.equal(output.project.domain, "example.com");
    assert.equal(output.rows.length, 1);
    assert.deepEqual(output.missingKeywords, ["seo tool", "missing term"]);
    const saved = JSON.parse(await readFile(output.evidence, "utf8")) as { calls: Array<{ path: string[]; costUsd: number; items: unknown }>; rows: unknown[] };
    const task = (fixture.tasks as Array<{ path: string[]; result: Array<{ items: unknown }> }>)[0];
    assert.deepEqual(saved.calls, [{ path: task.path, costUsd: 0.01, items: task.result[0].items }]);
    assert.equal(saved.rows.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
