import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { keywordMetrics } from "../src/dataforseo.js";

const fixture = JSON.parse(await readFile(new URL("./keyword-overview.json", import.meta.url), "utf8")) as Record<string, unknown>;
const project = { domain: "example.com", locationCode: 2840, languageCode: "en" };

function fakeFetch(body: unknown): typeof fetch {
  return async (_url, init) => {
    assert.equal(init?.method, "POST");
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

test("CLI discovers a project, saves full evidence, and fails visibly without credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "agenticseo-"));
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const tsx = import.meta.resolve("tsx");
  const run = (cwd: string, args: string[], env = process.env, mock = false) => spawnSync(process.execPath, ["--import", tsx, ...(mock ? ["--import", new URL("./mock-fetch.ts", import.meta.url).href] : []), cli, ...args], { cwd, env, encoding: "utf8" });
  try {
    await mkdir(join(root, ".agenticseo"));
    await writeFile(join(root, ".agenticseo", ".gitignore"), "custom-ignore\n");
    const init = run(root, ["init", "--domain", "example.com", "--location", "2840", "--language", "en"]);
    assert.equal(init.status, 0, init.stderr);
    assert.equal(await readFile(join(root, ".agenticseo", ".gitignore"), "utf8"), "custom-ignore\n");
    assert.match(await readFile(join(root, ".agenticseo", "evidence", ".gitignore"), "utf8"), /\*\n/);
    await mkdir(join(root, "nested"));
    const missing = run(join(root, "nested"), ["keywords", "seo audit"], { ...process.env, DATAFORSEO_API_KEY: "" });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /DATAFORSEO_API_KEY is required/);
    const result = run(join(root, "nested"), ["keywords", "seo audit", "seo tool", "missing term"], { ...process.env, DATAFORSEO_API_KEY: "TEST_KEY" }, true);
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
