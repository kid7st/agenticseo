import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { OperationError } from "../src/errors.js";
import { dataDirectory } from "../src/project.js";
import { upsertKeywordMetric } from "../src/openseo/keywords/savedKeywordsRepository.js";
import {
  deleteTagCommand,
  exportCommand,
  listCommand,
  refreshCommand,
  removeCommand,
  renameTagCommand,
  saveCommand,
  tagCommand,
} from "../src/saved.js";
import { openStore, queryStore, withStore } from "../src/store.js";
import { runCli, withFetch, withProject } from "./helpers.js";

const us = { locationCode: 2840, languageCode: "en" };
const page = { page: 1, pageSize: 100 };

async function withRoot(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "agenticseo-saved-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const metric = (keyword: string, searchVolume: number | null, extra: { cpc?: number; keywordDifficulty?: number } = {}) => ({
  keyword, ...us, searchVolume, cpc: extra.cpc ?? null, competition: null, keywordDifficulty: extra.keywordDifficulty ?? null,
  intent: "commercial", monthlySearchesJson: JSON.stringify([{ year: 2026, month: 8, searchVolume }]),
});

const rejectsInput = (message: RegExp) => (error: unknown) => error instanceof OperationError && error.kind === "input" && message.test(error.message);

test("saving normalizes keywords, is idempotent and appends or replaces tags", async () => {
  await withRoot(async (root) => {
    const first = await saveCommand(root, us, { keywords: [" SEO Audit ", "seo tool", "seo audit"], tags: ["topic:audit"], replaceTags: false });
    assert.equal(first.savedCount, 2);
    const again = await saveCommand(root, us, { keywords: ["seo audit"], tags: ["Page:Pricing"], replaceTags: false });
    assert.deepEqual(again.ids, [first.ids.find((id) => id === again.ids[0])], "re-saving returns the existing row");

    let listed = await listCommand(root, { ...page, sort: "keyword", order: "asc" });
    assert.deepEqual(listed.rows.map((row) => [row.keyword, row.tags]), [["seo audit", ["Page:Pricing", "topic:audit"]], ["seo tool", ["topic:audit"]]]);

    await assert.rejects(saveCommand(root, us, { keywords: ["seo audit"], replaceTags: true }), rejectsInput(/Replacement tags are required/));
    await saveCommand(root, us, { keywords: ["seo audit"], tags: ["page:pricing"], replaceTags: true });
    listed = await listCommand(root, { ...page, sort: "keyword", order: "asc" });
    assert.deepEqual(listed.rows[0].tags, ["Page:Pricing"], "replace keeps only the given tags; tag names match case-insensitively");
    assert.deepEqual(listed.tags.map((tag) => [tag.name, tag.keywordCount]), [["Page:Pricing", 1], ["topic:audit", 1]]);
  });
});

test("listing joins the latest metrics and applies OpenSEO's filters, tag match, sort and paging", async () => {
  await withRoot(async (root) => {
    await saveCommand(root, us, { keywords: ["seo audit", "seo audit tool", "free seo audit", "rank tracker"], tags: ["audit"], replaceTags: false });
    await saveCommand(root, us, { keywords: ["rank tracker"], tags: ["tracking"], replaceTags: true });
    await withStore(root, (db) => {
      upsertKeywordMetric(db, metric("seo audit", 1200, { cpc: 2.5, keywordDifficulty: 35 }));
      upsertKeywordMetric(db, metric("seo audit tool", 300, { keywordDifficulty: 20 }));
      upsertKeywordMetric(db, metric("rank tracker", 900));
    });

    const bySearch = await listCommand(root, { ...page, search: "audit", excludeTerms: ["free"], sort: "searchVolume", order: "desc" });
    assert.deepEqual(bySearch.rows.map((row) => row.keyword), ["seo audit", "seo audit tool"]);
    assert.deepEqual(bySearch.rows[0], { id: bySearch.rows[0].id, keyword: "seo audit", ...us, searchVolume: 1200, keywordDifficulty: 35, cpc: 2.5, competition: null, intent: "commercial", fetchedAt: bySearch.rows[0].fetchedAt, tags: ["audit"] });

    assert.deepEqual((await listCommand(root, { ...page, minVolume: 500, maxDifficulty: 30 })).rows.map((row) => row.keyword), [], "range filters exclude missing metrics");
    assert.deepEqual((await listCommand(root, { ...page, minVolume: 500, sort: "keyword", order: "asc" })).rows.map((row) => row.keyword), ["rank tracker", "seo audit"]);
    assert.deepEqual((await listCommand(root, { ...page, tagNames: ["tracking", "nope"] })).rows.map((row) => row.keyword), ["rank tracker"], "multiple tags match any tag");
    assert.equal((await listCommand(root, { ...page, tagNames: ["nope"] })).totalCount, 0, "only unknown tag names match nothing");

    const firstPage = await listCommand(root, { page: 1, pageSize: 3, sort: "keyword", order: "asc" });
    assert.deepEqual([firstPage.rows.length, firstPage.totalCount, firstPage.nextPage], [3, 4, 2]);
    const unmeasured = (await listCommand(root, { ...page, search: "free" })).rows[0];
    assert.deepEqual([unmeasured.searchVolume, unmeasured.fetchedAt], [null, null], "a keyword without metrics lists them as unknown");
  });
});

test("tags are managed by name: unknown names fail, renames cannot collide, in-use tags cannot be deleted", async () => {
  await withRoot(async (root) => {
    const { ids } = await saveCommand(root, us, { keywords: ["seo audit", "seo tool"], tags: ["audit", "draft"], replaceTags: false });
    await assert.rejects(tagCommand(root, { ids, remove: ["drafts"] }), rejectsInput(/Unknown tag\(s\): drafts/));
    const tagged = await tagCommand(root, { ids: [ids[0]], add: ["page:home"], remove: ["draft"] });
    assert.deepEqual([tagged.addedTags, tagged.removedAssignments], [["page:home"], 1]);

    await assert.rejects(renameTagCommand(root, { name: "audit", to: "Draft" }), rejectsInput(/A tag named "Draft" already exists/));
    await assert.rejects(renameTagCommand(root, { name: "audit", color: "pink" }), rejectsInput(/--color must be one of/));
    assert.deepEqual(await renameTagCommand(root, { name: "audit", to: "topic:audit", color: "sky" }), { tag: { name: "topic:audit", color: "sky" } });
    assert.deepEqual(await renameTagCommand(root, { name: "topic:audit", color: "none" }), { tag: { name: "topic:audit", color: null } });

    await assert.rejects(deleteTagCommand(root, "draft"), rejectsInput(/attached to 1 keyword\. Remove the tag/));
    await tagCommand(root, { ids: [ids[1]], remove: ["draft"] });
    assert.deepEqual(await deleteTagCommand(root, "draft"), { success: true });

    assert.deepEqual(await removeCommand(root, [ids[0], ids[0], "missing-id"]), { requested: 3, success: true, deletedCount: 1 });
    const left = await listCommand(root, page);
    assert.deepEqual(left.tags.map((tag) => [tag.name, tag.keywordCount]), [["page:home", 0], ["topic:audit", 1]], "removing a keyword drops its tag assignments");
  });
});

test("export writes OpenSEO's CSV columns with quoting, rounding and formula protection, or full JSONL rows", async () => {
  await withRoot(async (root) => {
    await saveCommand(root, us, { keywords: ["seo audit", "=hyperlink(\"x\")"], tags: ["a", "b"], replaceTags: false });
    await withStore(root, (db) => upsertKeywordMetric(db, metric("seo audit", 1200, { cpc: 2.456 })));
    await assert.rejects(exportCommand(root, { format: "csv", search: "nothing" }), rejectsInput(/nothing to export/));

    const csv = await exportCommand(root, { format: "csv", sort: "keyword", order: "desc" });
    const lines = (await readFile(csv.file, "utf8")).trimEnd().split("\n");
    assert.equal(lines[0], '"Keyword","Volume","CPC","Competition","Score","Intent","Tags","Fetched At"');
    assert.match(lines[1], /^"seo audit","1200","2\.46","","","commercial","a, b","\d{4}-/);
    assert.equal(lines[2], `"'=hyperlink(""x"")","","","","","","a, b",""`);

    const jsonl = await exportCommand(root, { format: "jsonl", out: join(root, "out", "saved.jsonl") });
    const rows = (await readFile(jsonl.file, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line) as { keyword: string; monthlySearches: unknown[] });
    assert.equal(jsonl.rowCount, 2);
    assert.deepEqual(rows.find((row) => row.keyword === "seo audit")?.monthlySearches, [{ year: 2026, month: 8, searchVolume: 1200 }]);
  });
});

test("refresh fetches each saved market once and overwrites the stored snapshot", async () => {
  await withRoot(async (root) => {
    await saveCommand(root, us, { keywords: ["seo audit", "seo tool"], replaceTags: false });
    await saveCommand(root, { locationCode: 2276, languageCode: "de" }, { keywords: ["seo agentur"], replaceTags: false });
    await withStore(root, (db) => upsertKeywordMetric(db, metric("seo audit", 1)));
    const labs = (body: Array<{ keywords: string[] }>) => Response.json({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0.01, path: ["v3"], result: [{ items: body[0].keywords.map((keyword) => ({ keyword, keyword_info: { search_volume: 500 }, search_intent_info: { main_intent: "informational" } })) }] }] });
    const { result, requests } = await withFetch((_url, init) => labs(JSON.parse(String(init.body))), () => refreshCommand(root));
    assert.deepEqual(requests.map((request) => (request.body as Array<{ location_code: number; keywords: string[] }>)[0]).map(({ location_code, keywords }) => [location_code, keywords.toSorted()]).toSorted(), [[2276, ["seo agentur"]], [2840, ["seo audit", "seo tool"]]]);
    assert.deepEqual([result.updated, result.costUsd], [3, 0.02]);
    const listed = await listCommand(root, { ...page, search: "seo audit" });
    assert.deepEqual([listed.rows[0].searchVolume, listed.rows[0].intent], [500, "informational"]);
  });
});

test("query runs one read-only statement and caps its rows", async () => {
  await withRoot(async (root) => {
    await saveCommand(root, us, { keywords: Array.from({ length: 100 }, (_, index) => `kw ${index}`), replaceTags: false });
    const counted = await queryStore(root, "SELECT count(*) AS n FROM saved_keywords;");
    assert.deepEqual(counted, { rowCount: 1, truncated: false, rows: [{ n: 100 }] });
    const capped = await queryStore(root, "SELECT a.keyword FROM saved_keywords a, saved_keywords b LIMIT 600");
    assert.deepEqual([capped.rows.length, capped.rowCount, capped.truncated], [500, 500, true]);
    await assert.rejects(queryStore(root, "DELETE FROM saved_keywords"), rejectsInput(/readonly/));
    await assert.rejects(queryStore(root, "SELECT 1; DELETE FROM saved_keywords"), rejectsInput(/one SQL statement/));
    await assert.rejects(queryStore(root, "SELECT nope FROM saved_keywords"), rejectsInput(/SQL error: no such column/));
  });
});

test("a writer waits for another command's write lock instead of failing", async () => {
  await withProject(async (root) => {
    const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
    const holder = await openStore(root);
    holder.exec("BEGIN IMMEDIATE");
    const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), cli, "saved", "add", "seo audit"], { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const exit = new Promise<number | null>((resolve) => child.on("exit", resolve));
    // Hold the lock well past the child's start-up, then let it through.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    holder.exec("COMMIT");
    holder.close();
    assert.equal(await exit, 0, stderr);
  });
});

test("two commands opening a fresh database at once apply the schema once", async () => {
  await withProject(async (root) => {
    const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
    // An unmigrated database whose write lock is held, so both commands read version 0 first.
    const holder = new DatabaseSync(join(await dataDirectory(root), "agenticseo.db"));
    holder.exec("PRAGMA journal_mode = WAL; BEGIN IMMEDIATE");
    const children = ["seo audit", "seo tool"].map((keyword) => {
      const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), cli, "saved", "add", keyword], { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => (stderr += chunk));
      return new Promise<string>((resolve) => child.on("exit", (code) => resolve(`${code} ${stderr}`)));
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    holder.exec("COMMIT");
    holder.close();
    assert.deepEqual(await Promise.all(children), ["0 ", "0 "]);
  });
});

test("processes opening a fresh database at the same moment all switch it to WAL", async () => {
  // SQLite refuses concurrent first WAL conversions with SQLITE_BUSY without waiting;
  // unretried, about one process in six failed this way in a synchronized spike.
  const worker = fileURLToPath(new URL("./open-store-worker.ts", import.meta.url));
  for (let round = 0; round < 3; round++) {
    await withRoot(async (root) => {
      const startAt = Date.now() + 1500;
      const results = await Promise.all(Array.from({ length: 12 }, () => new Promise<string>((resolve) => {
        const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), worker, root, String(startAt)], { stdio: ["ignore", "pipe", "inherit"] });
        let stdout = "";
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.on("exit", () => resolve(stdout.trim()));
      })));
      assert.deepEqual(results, Array(12).fill("ok"));
      const [{ journal_mode: mode }] = (await queryStore(root, "PRAGMA journal_mode")).rows as Array<{ journal_mode: string }>;
      assert.equal(mode, "wal");
    });
  }
});

test("parallel CLI writers all succeed against one project database", async () => {
  await withProject(async (root) => {
    const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
    const run = (index: number) => new Promise<string>((resolve) => {
      const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), cli, "saved", "add", ...Array.from({ length: 20 }, (_, n) => `kw ${index}-${n}`), "--tags", `batch-${index % 2}`], { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("exit", (code) => resolve(`${code} ${stderr}`));
    });
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => run(index)));
    assert.deepEqual(results, Array(8).fill("0 "));
    const listed = runCli(root, ["query", "SELECT count(*) AS n FROM saved_keywords"]);
    assert.deepEqual(JSON.parse(listed.stdout).rows, [{ n: 160 }]);
  });
});
