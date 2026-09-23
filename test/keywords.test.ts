import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { keywordMetrics } from "../src/dataforseo.js";
import { OperationError } from "../src/errors.js";
import { runCli } from "./helpers.js";

const fixture = JSON.parse(await readFile(new URL("./keyword-overview.json", import.meta.url), "utf8")) as Record<string, unknown>;
const project = { domain: "example.com", locationCode: 2840, languageCode: "en" };

function fakeFetch(body: unknown): typeof fetch {
  return async (_url, init) => {
    assert.ok(init, "fetch was called without request options");
    assert.equal(init.method, "POST");
    assert.equal(new Headers(init.headers).get("Authorization"), "Basic TEST_KEY");
    assert.deepEqual(JSON.parse(String(init.body)), [{ keywords: ["seo audit", "seo tool"], location_code: 2840, language_code: "en", include_clickstream_data: false }]);
    return Response.json(body);
  };
}

test("maps live keyword metrics without inventing missing values", async () => {
  const result = await keywordMetrics(project, ["seo audit", "seo tool"], "TEST_KEY", fakeFetch(fixture));
  assert.deepEqual(result.rows, [
    { keyword: "seo audit", searchVolume: 1200, difficulty: 35, cpc: 2.5, intent: "commercial" },
    { keyword: "seo tool", searchVolume: null, difficulty: null, cpc: null, intent: null },
  ]);
  assert.equal(result.costUsd, 0.01);
});

test("reports charged task failures and invalid provider payloads", async () => {
  const failed = structuredClone(fixture);
  const task = (failed.tasks as Array<Record<string, unknown>>)[0];
  task.status_code = 40101;
  task.status_message = "Internal SE Server Error";
  await assert.rejects(keywordMetrics(project, ["seo audit", "seo tool"], "TEST_KEY", fakeFetch(failed)), /charged \$0\.01/);
  await assert.rejects(keywordMetrics(project, ["seo audit", "seo tool"], "TEST_KEY", fakeFetch({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0.01, path: [], result: [{ items: "invalid" }] }] })), /Unexpected DataForSEO/);
});

test("classifies provider transport, auth and payload failures", async () => {
  const kind = (fetcher: typeof fetch) => keywordMetrics(project, ["seo audit"], "TEST_KEY", fetcher).then(
    () => assert.fail("expected a provider failure"),
    (error: unknown) => (assert.ok(error instanceof OperationError, String(error)), error.kind),
  );
  assert.equal(await kind(async () => { throw new TypeError("fetch failed"); }), "provider");
  assert.equal(await kind(async () => new Response("", { status: 401 })), "credentials");
  assert.equal(await kind(async () => new Response("", { status: 403 })), "provider");
  assert.equal(await kind(async () => new Response("<html>", { status: 200 })), "provider");
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
    assert.equal(output.rows.length, 2);
    assert.deepEqual(output.missingKeywords, ["missing term"]);
    const saved = JSON.parse(await readFile(output.evidence, "utf8")) as { raw: unknown; rows: unknown[] };
    assert.deepEqual(saved.raw, fixture);
    assert.equal(saved.rows.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
