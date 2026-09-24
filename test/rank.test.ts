import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OperationError } from "../src/errors.js";
import { runDueChecks } from "../src/openseo/rank-tracking/scheduledRankChecks.js";
import { withStore, type Store } from "../src/store.js";
import { readFileSync } from "node:fs";
import {
  addTrackerKeywords,
  createTracker,
  estimateTracker,
  listTrackers,
  refreshTrackerMetrics,
  removeTrackerKeywords,
  runTracker,
  searchLocations,
  showTracker,
  trackerHistory,
  trackerMatrix,
  trackerTrend,
  updateTracker,
} from "../src/rank.js";
import { runCli, withFetch, withProject } from "./helpers.js";

const us = { domain: "https://www.Example.com/pricing", locationCode: 2840, languageCode: "en" };
const rejectsInput = (message: RegExp) => (error: unknown) => error instanceof OperationError && error.kind === "input" && message.test(error.message);

describe("rank trackers", () => {
  it("creates with OpenSEO's agent defaults, refuses duplicates and reactivates an archived tracker with its keywords", async () => {
    await withProject(async (root) => {
      const { config } = await createTracker(root, us);
      assert.deepEqual(
        { domain: config.domain, devices: config.devices, serpDepth: config.serpDepth, scheduleInterval: config.scheduleInterval, nextCheckAt: config.nextCheckAt },
        { domain: "example.com", devices: "mobile", serpDepth: 40, scheduleInterval: "manual", nextCheckAt: null },
      );
      await assert.rejects(createTracker(root, { ...us, domain: "example.com" }), rejectsInput(/already tracked by/));
      await addTrackerKeywords(root, config.id, ["seo audit"], false);

      await updateTracker(root, config.id, { isActive: false });
      assert.deepEqual((await listTrackers(root)).trackers, []);
      const again = await createTracker(root, { ...us, devices: "both", scheduleInterval: "weekly" });
      assert.equal(again.config.id, config.id, "the archived row is reused");
      assert.equal(again.config.devices, "both");
      assert.ok(again.config.nextCheckAt && Date.parse(again.config.nextCheckAt) > Date.now());
      assert.deepEqual((await showTracker(root, config.id)).keywords.map((kw) => kw.keyword), ["seo audit"]);
      assert.equal((await listTrackers(root)).trackers[0].keywordCount, 1);
    });
  });

  it("adds keywords lowercased and deduplicated, keeps case on request, and reports the rest", async () => {
    await withProject(async (root) => {
      const { config } = await createTracker(root, us);
      const first = await addTrackerKeywords(root, config.id, [" SEO Audit ", "seo audit", "seo tool"], false);
      assert.equal(first.added, 2);
      const second = await addTrackerKeywords(root, config.id, ["SEO audit", "Nodex"], false);
      assert.deepEqual([second.added, second.alreadyTracked], [1, 1]);
      const cased = await addTrackerKeywords(root, config.id, ["Nodex"], true);
      assert.equal(cased.added, 1, "a match-case keyword is tracked separately from its lowercase twin");
      assert.deepEqual((await showTracker(root, config.id)).keywords.map((kw) => [kw.keyword, kw.matchCase]), [
        ["seo audit", false],
        ["seo tool", false],
        ["nodex", false],
        ["Nodex", true],
      ]);

      const many = Array.from({ length: 1000 }, (_, index) => `keyword ${index}`);
      const capped = await addTrackerKeywords(root, config.id, many, false);
      assert.equal(capped.added, 996);
      assert.deepEqual(capped.overLimit, ["keyword 996", "keyword 997", "keyword 998", "keyword 999"], "keywords past the limit are named, not dropped silently");

      const removed = await removeTrackerKeywords(root, config.id, [first.addedIds[0], "no-such-id"]);
      assert.deepEqual([removed.removed, removed.notFound], [1, ["no-such-id"]]);
    });
  });

  it("estimates live and scheduled cost with OpenSEO's page pricing", async () => {
    await withProject(async (root) => {
      const { config } = await createTracker(root, { ...us, devices: "both", scheduleInterval: "weekly" });
      await addTrackerKeywords(root, config.id, ["a", "b"], false);
      const estimate = await estimateTracker(root, config.id, 48);
      // Depth 40 is four pages: live $0.002 + 3 × $0.0015, queued $0.0006 + 3 × $0.00045.
      assert.deepEqual(
        { ...estimate },
        {
          costUsd: 0.65,
          keywordCount: 50,
          devicesCount: 2,
          totalChecks: 100,
          method: "live",
          existingKeywordCount: 2,
          additionalKeywordCount: 48,
          scheduledEstimate: { scheduleInterval: "weekly", costUsd: 0.195, checksPerMonth: 4, monthlyCostUsd: 0.78 },
        },
      );
      const daily = await updateTracker(root, config.id, { scheduleInterval: "daily" });
      assert.deepEqual(daily.scheduledEstimate, { scheduleInterval: "daily", costUsd: 0.0078, checksPerMonth: 30, monthlyCostUsd: 0.234 }, "turning a schedule on shows its recurring cost");
      const manual = await updateTracker(root, config.id, { scheduleInterval: "manual" });
      assert.equal(manual.config.nextCheckAt, null);
      assert.equal(manual.scheduledEstimate, undefined);
      assert.equal((await estimateTracker(root, config.id, 0)).scheduledEstimate, undefined);
    });
  });

  it("checks a city name with the free sandbox, and says when it could not", async () => {
    await withProject(async (root) => {
      const sandbox = (status_code: number, status_message: string) => () => Response.json({ status_code: 20000, tasks: [{ status_code, status_message }] });
      const { requests } = await withFetch(sandbox(40501, "Invalid Field: 'location_name'."), () =>
        assert.rejects(createTracker(root, { ...us, locationName: "Enid, OK" }), rejectsInput(/rank locations "Enid" --location US/)),
      );
      assert.equal(requests[0].url, "https://sandbox.dataforseo.com/v3/serp/google/organic/live/advanced");

      const { result } = await withFetch(() => new Response("down", { status: 503 }), () => createTracker(root, { ...us, locationName: "Enid,Oklahoma,United States" }));
      assert.equal(result.config.locationName, "Enid,Oklahoma,United States");
      assert.match(result.warning ?? "", /Location name not checked: DataForSEO sandbox unavailable/);
      // A city tracker and the national one are separate trackers.
      await withFetch(sandbox(20000, "Ok."), () => createTracker(root, us));
      assert.equal((await listTrackers(root)).trackers.length, 2);
    });
  });

  it("finds canonical location names from the cached country registry", async () => {
    await withProject(async (root) => {
      const registry = [
        { location_code: 1, location_name: "Portland,Maine,United States", location_type: "City" },
        { location_code: 2, location_name: "Portland,Oregon,United States", location_type: "City" },
        { location_code: 3, location_name: "97201,Oregon,United States", location_type: "Postal Code" },
      ];
      const { result, requests } = await withFetch(() => Response.json({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0, path: ["v3"], result: registry }] }), () =>
        searchLocations(root, "Portland OR", "us"),
      );
      assert.equal(requests[0].url, "https://api.dataforseo.com/v3/serp/google/locations/us");
      assert.equal(result.locations[0].locationName, "Portland,Oregon,United States");
      const cached = await withFetch(() => Response.error(), () => searchLocations(root, "Portland", "us"));
      assert.equal(cached.requests.length, 0, "the registry is served from the project cache");
      assert.ok(cached.result.locations.every((location) => location.locationType === "City"), "postal codes are not offered");
    });
  });

  it("validates tracker settings on the command line", async () => {
    await withProject(async (root) => {
      const depth = runCli(root, ["rank", "create", "--depth", "35"]);
      assert.equal(depth.status, 2);
      assert.match(depth.stderr, /multiple of 10/);
      const created = runCli(root, ["rank", "create", "--devices", "both"]);
      assert.equal(created.status, 0, created.stderr);
      assert.equal(JSON.parse(created.stdout).config.domain, "example.com", "the domain defaults to the project's");
      assert.equal(runCli(root, ["rank", "show"]).status, 2);
    });
  });
});

const serpPath = "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";
const organic = (rank: number, domain: string) => ({ type: "organic", rank_group: rank, rank_absolute: rank + 2, domain, url: `https://${domain}/page`, title: "t" });
const serpTask = (items: unknown[]) => Response.json({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0.008, path: ["v3", "serp"], result: [{ items }] }] });

/** Answers live rank checks from a keyword → items table; "boom" is a charged task failure. */
function serpHandler(positions: Record<string, number | null>) {
  return (url: string, init: RequestInit) => {
    assert.equal(url, serpPath);
    const [task] = JSON.parse(String(init.body)) as Array<{ keyword: string }>;
    if (task.keyword === "boom") return Response.json({ status_code: 20000, tasks: [{ status_code: 40000, status_message: "Task failed.", cost: 0.002, path: ["v3", "serp"] }] });
    const position = positions[task.keyword];
    return serpTask([{ type: "people_also_ask" }, organic(1, "other.com"), ...(position === null ? [] : [organic(position, "www.example.com")])]);
  };
}

const withDb = <T>(root: string, work: (db: Store) => T) => withStore(root, work);

describe("rank checks", () => {
  it("checks every keyword on every device, keeps partial results and records the cost", async () => {
    await withProject(async (root) => {
      const { config } = await createTracker(root, { ...us, devices: "both", serpDepth: 20 });
      await addTrackerKeywords(root, config.id, ["found", "missing", "boom"], false);
      const { result, requests } = await withFetch(serpHandler({ found: 3, missing: null }), () => runTracker(root, config.id));
      assert.equal(requests.length, 6, "three keywords on two devices");
      assert.deepEqual(requests.find((r) => (r.body as Array<{ keyword: string; device: string }>)[0].keyword === "found" && (r.body as Array<{ device: string }>)[0].device === "desktop")?.body, [
        {
          keyword: "found",
          location_code: 2840,
          language_code: "en",
          device: "desktop",
          os: "windows",
          depth: 20,
          stop_crawl_on_match: [{ match_value: "example.com", match_type: "with_subdomains" }],
          find_targets_in: ["organic"],
        },
      ]);
      assert.equal(result.run.status, "completed");
      assert.match(result.run.errorMessage ?? "", /^Checked 2 of 3 keyword\(s\): Task failed\./);
      assert.equal(result.run.costUsd, 0.036, "four found checks at $0.008 plus two charged failures at $0.002");

      const shown = await showTracker(root, config.id);
      assert.deepEqual(shown.keywords.find((kw) => kw.keyword === "found")?.desktop, { position: 3, previousPosition: 3, rankingUrl: "https://www.example.com/page", serpFeatures: ["people_also_ask", "organic"] });
      assert.equal(shown.keywords.find((kw) => kw.keyword === "missing")?.mobile?.position, null);
      assert.ok(shown.tracker.lastCheckedAt);
    });
  });

  it("compares with the period's baseline and builds history, trend and matrix from completed runs", async () => {
    await withProject(async (root) => {
      const { config } = await createTracker(root, { ...us, serpDepth: 20 });
      const { addedIds } = await addTrackerKeywords(root, config.id, ["alpha", "beta"], false);
      const first = await withFetch(serpHandler({ alpha: 8, beta: null }), () => runTracker(root, config.id));
      // Age the first run past the 7-day comparison window.
      const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
      await withDb(root, (db) => {
        db.prepare(`UPDATE rank_snapshots SET checked_at = ? WHERE run_id = ?`).run(tenDaysAgo, first.result.run.id);
        db.prepare(`UPDATE rank_check_runs SET started_at = ? WHERE id = ?`).run(tenDaysAgo, first.result.run.id);
      });
      await addTrackerKeywords(root, config.id, ["gamma"], false);
      await withFetch(serpHandler({ alpha: 2, beta: 15, gamma: 30 }), () => runTracker(root, config.id));

      const shown = await showTracker(root, config.id);
      const mobile = (keyword: string) => shown.keywords.find((kw) => kw.keyword === keyword)?.mobile;
      assert.deepEqual([mobile("alpha")?.position, mobile("alpha")?.previousPosition], [2, 8]);
      assert.deepEqual([mobile("gamma")?.position, mobile("gamma")?.previousPosition], [30, 30], "a new keyword's baseline is its earliest check");
      assert.equal(shown.keywords[0].desktop, undefined, "a mobile tracker shows no desktop column");

      const history = await trackerHistory(root, config.id, addedIds[0], 365);
      assert.deepEqual(history.points.map((point) => (point as { position: number }).position), [8, 2]);
      const trend = await trackerTrend(root, config.id, { sinceDays: 365 });
      assert.deepEqual(trend.runs.map(({ top3, top4to10, top11to20, notRanking }) => [top3, top4to10, top11to20, notRanking]), [
        [0, 1, 0, 1],
        [1, 0, 1, 1],
      ]);
      const matrix = await trackerMatrix(root, config.id, { runLimit: 12 });
      assert.deepEqual(
        matrix.keywords.map((row) => [row.keyword, row.positions]).sort(),
        [
          ["alpha", [8, 2]],
          ["beta", [null, 15]],
          ["gamma", ["not checked", 30]],
        ],
      );
    });
  });

  it("stops at a rejected key after the batch that found it", async () => {
    await withProject(async (root) => {
      const { config } = await createTracker(root, us);
      await addTrackerKeywords(root, config.id, Array.from({ length: 15 }, (_, index) => `keyword ${index}`), false);
      const { requests } = await withFetch(
        () => new Response("Unauthorized", { status: 401 }),
        () => assert.rejects(runTracker(root, config.id), (error: unknown) => error instanceof OperationError && error.kind === "credentials"),
      );
      assert.equal(requests.length, 10, "the second batch of five is never sent");
      const shown = await showTracker(root, config.id);
      assert.equal(shown.latestRun?.status, "failed");
      assert.match(shown.latestRun?.errorMessage ?? "", /HTTP 401/);
      assert.equal(shown.tracker.lastCheckedAt, null, "a failed run does not count as a check");
    });
  });

  it("allows one running check per tracker and closes a dead one, keeping what it paid for", async () => {
    await withProject(async (root) => {
      const { config } = await createTracker(root, us);
      const { addedIds } = await addTrackerKeywords(root, config.id, ["alpha", "beta"], false);
      const now = new Date().toISOString();
      await withDb(root, (db) => {
        db.prepare(`INSERT INTO rank_check_runs (id, config_id, status, trigger, keywords_total, worker_pid, heartbeat_at, started_at) VALUES ('live', ?, 'running', 'manual', 2, ?, ?, ?)`).run(config.id, process.pid, now, now);
      });
      await assert.rejects(runTracker(root, config.id), rejectsInput(/already running for tracker .* \(run live, process \d+\)/));

      // A running check's results are not shown until it finishes.
      await withDb(root, (db) => {
        db.prepare(`INSERT INTO rank_snapshots (run_id, tracking_keyword_id, keyword, device, position, checked_at) VALUES ('live', ?, 'alpha', 'mobile', 4, ?)`).run(addedIds[0], now);
      });
      assert.equal((await showTracker(root, config.id)).keywords[0].mobile?.position, null);

      // The worker dies after checking one keyword: its snapshot stays visible.
      await withDb(root, (db) => db.prepare(`UPDATE rank_check_runs SET worker_pid = 2147483646 WHERE id = 'live'`).run());
      const shown = await showTracker(root, config.id);
      assert.equal(shown.latestRun?.status, "completed");
      assert.match(shown.latestRun?.errorMessage ?? "", /exited after checking 1 of 2 keyword/);
      assert.equal(shown.keywords[0].mobile?.position, 4);
      const { result } = await withFetch(serpHandler({ alpha: 5, beta: 6 }), () => runTracker(root, config.id));
      assert.equal(result.run.status, "completed");
    });
  });

  it("refreshes keyword metrics and names keywords without data", async () => {
    await withProject(async (root) => {
      const { config } = await createTracker(root, us);
      await addTrackerKeywords(root, config.id, ["SEO Audit", "unknown term"], true);
      const { result, requests } = await withFetch(
        () => new Response(readFileSync(new URL("./keyword-overview.json", import.meta.url)), { headers: { "Content-Type": "application/json" } }),
        () => refreshTrackerMetrics(root, config.id),
      );
      assert.deepEqual((requests[0].body as Array<{ keywords: string[] }>)[0].keywords, ["seo audit", "unknown term"], "asked in lowercase");
      assert.deepEqual([result.updated, result.missingKeywords, result.costUsd], [1, ["unknown term"], 0.01]);
      const shown = await showTracker(root, config.id);
      assert.deepEqual([shown.keywords[0].searchVolume, shown.keywords[0].keywordDifficulty, shown.keywords[0].cpc], [1200, 35, 2.5]);
    });
  });
});

const api = "https://api.dataforseo.com/v3/serp/google/organic";

/**
 * A DataForSEO stand-in for the queued path. `queue` maps a keyword to its
 * task_get outcomes in order ("pending", "failed" or a position); "reject" keywords
 * are refused at task_post; live checks answer from `live`.
 */
function queueHandler(input: { queue: Record<string, Array<"pending" | "failed" | number>>; reject?: string[]; live?: Record<string, number | null> }) {
  const outcomes = new Map(Object.entries(input.queue).map(([keyword, list]) => [keyword, [...list]]));
  return (url: string, init: RequestInit) => {
    if (url === `${api}/task_post`) {
      const tasks = JSON.parse(String(init.body)) as Array<{ keyword: string; tag: string }>;
      return Response.json({
        status_code: 20000,
        tasks: tasks.map((task) =>
          input.reject?.includes(task.keyword)
            ? { status_code: 40501, status_message: "Invalid Field: 'keyword'.", cost: 0 }
            : { id: `task-${task.keyword}`, status_code: 20100, status_message: "Task Created.", cost: 0.0024, data: { tag: task.tag } },
        ),
      });
    }
    if (url.startsWith(`${api}/task_get/advanced/`)) {
      const keyword = decodeURIComponent(url.slice(`${api}/task_get/advanced/task-`.length));
      const next = outcomes.get(keyword)?.shift();
      if (next === undefined) throw new Error(`Unexpected task_get for ${keyword}`);
      if (next === "pending") return Response.json({ status_code: 20000, tasks: [{ id: `task-${keyword}`, status_code: 40602, status_message: "Task In Queue." }] });
      if (next === "failed") return Response.json({ status_code: 20000, tasks: [{ id: `task-${keyword}`, status_code: 40000, status_message: "Task failed in queue." }] });
      return Response.json({ status_code: 20000, tasks: [{ id: `task-${keyword}`, status_code: 20000, result: [{ items: [organic(next, "example.com")] }] }] });
    }
    return serpHandler(input.live ?? {})(url, init);
  };
}

const makeDue = (root: string, trackerId: string) =>
  withDb(root, (db) => db.prepare(`UPDATE rank_tracking_configs SET next_check_at = ? WHERE id = ?`).run(new Date(Date.now() - 3_600_000).toISOString(), trackerId));

const due = (root: string) => withDb(root, (db) => runDueChecks(db, { pollIntervalsMs: [0, 0] }));

describe("scheduled rank checks", () => {
  it("queues due trackers, polls, falls back live for stragglers, and advances the schedule once", async () => {
    await withProject(async (root) => {
      const { config } = await createTracker(root, { ...us, scheduleInterval: "weekly" });
      await addTrackerKeywords(root, config.id, ["alpha", "beta", "gamma", "delta"], false);
      await makeDue(root, config.id);
      const before = (await showTracker(root, config.id)).tracker.nextCheckAt!;

      const { result, requests } = await withFetch(queueHandler({ queue: { alpha: ["pending", 5], beta: ["failed"], delta: ["pending", "pending"] }, reject: ["gamma"], live: { beta: 7, gamma: 9, delta: 12 } }), () => due(root));
      assert.deepEqual([result.due, result.started, result.adopted], [1, 1, 0]);
      const [run] = result.runs;
      assert.ok("stats" in run && run.stats);
      // beta failed in the queue, gamma was rejected at post time, delta never finished.
      assert.deepEqual(run.stats, { queueTasks: 3, queueCollected: 1, fallbackTasks: 3, fallbackChecked: 3 });
      assert.equal(run.run.status, "completed");
      assert.equal(run.run.trigger, "scheduled");
      assert.equal(run.run.costUsd, 0.0312, "three queued posts at $0.0024 plus three live fallbacks at $0.008");
      const post = requests.find((request) => request.url === `${api}/task_post`)?.body as Array<Record<string, unknown>>;
      assert.equal(post.length, 4, "all pairs go in one post");
      const stored = await withDb(root, (db) => db.prepare(`SELECT task_id FROM rank_check_tasks ORDER BY task_id`).all().map((row) => (row as { task_id: string }).task_id));
      assert.deepEqual(stored, ["task-alpha", "task-beta", "task-delta"], "accepted task ids are stored, so an interrupted run can collect them");
      assert.equal(post[0].tag, `${(await showTracker(root, config.id)).keywords[0].trackingKeywordId}:mobile`);

      const shown = await showTracker(root, config.id);
      assert.deepEqual(shown.keywords.map((kw) => kw.mobile?.position), [5, 7, 9, 12]);
      assert.ok(Date.parse(shown.tracker.nextCheckAt!) - Date.parse(before) === 7 * 86_400_000, "the next slot is anchored to the missed one");

      const again = await withFetch(() => Response.error(), () => due(root));
      assert.deepEqual([again.result.due, again.result.started, again.requests.length], [0, 0, 0], "a repeated call starts nothing");
    });
  });

  it("skips a due tracker with no keywords and records why", async () => {
    await withProject(async (root) => {
      const { config } = await createTracker(root, { ...us, scheduleInterval: "daily" });
      await makeDue(root, config.id);
      const result = await due(root);
      assert.deepEqual(result.skipped, [{ trackerId: config.id, reason: "no_keywords" }]);
      const tracker = (await showTracker(root, config.id)).tracker;
      assert.equal(tracker.lastSkipReason, "no_keywords");
      assert.ok(Date.parse(tracker.nextCheckAt!) > Date.now());
    });
  });

  it("adopts an interrupted scheduled run and collects its paid tasks without posting again", async () => {
    await withProject(async (root) => {
      const { config } = await createTracker(root, { ...us, scheduleInterval: "weekly" });
      const { addedIds } = await addTrackerKeywords(root, config.id, ["alpha", "beta"], false);
      const long = new Date(Date.now() - 3_600_000).toISOString();
      await withDb(root, (db) => {
        db.prepare(`INSERT INTO rank_check_runs (id, config_id, status, trigger, keywords_total, cost_usd, worker_pid, heartbeat_at, started_at) VALUES ('queued', ?, 'running', 'scheduled', 2, 0.0048, 2147483646, ?, ?)`).run(config.id, long, long);
        const task = db.prepare(`INSERT INTO rank_check_tasks (run_id, tracking_keyword_id, keyword, device, task_id, posted_at) VALUES ('queued', ?, ?, 'mobile', ?, ?)`);
        task.run(addedIds[0], "alpha", "task-alpha", long);
        task.run(addedIds[1], "beta", "task-beta", long);
      });

      const shown = await showTracker(root, config.id);
      assert.equal(shown.latestRun?.status, "interrupted", "a dead run with paid tasks is not closed by other commands");
      await assert.rejects(runTracker(root, config.id), rejectsInput(/interrupted with paid tasks to collect; run agenticseo rank due/));

      const { result, requests } = await withFetch(queueHandler({ queue: { alpha: [3], beta: [11] } }), () => due(root));
      assert.equal(result.adopted, 1);
      assert.ok(requests.every((request) => request.url.includes("/task_get/")), "no task is posted or checked live again");
      const run = result.runs[0];
      assert.ok("run" in run && run.run);
      assert.deepEqual([run.run.status, run.run.keywordsChecked, run.run.costUsd], ["completed", 2, 0.0048]);
      assert.deepEqual((await showTracker(root, config.id)).keywords.map((kw) => kw.mobile?.position), [3, 11]);
    });
  });

  it("starts one run when two calls race for the same due tracker", async () => {
    await withProject(async (root) => {
      const { config } = await createTracker(root, { ...us, scheduleInterval: "weekly" });
      await addTrackerKeywords(root, config.id, ["alpha"], false);
      await makeDue(root, config.id);
      const { result } = await withFetch(queueHandler({ queue: { alpha: [1] } }), () => Promise.all([due(root), due(root)]));
      assert.equal(result[0].started + result[1].started, 1);
      const runs = await withDb(root, (db) => db.prepare(`SELECT COUNT(*) AS n FROM rank_check_runs`).get() as { n: number });
      assert.equal(runs.n, 1);
    });
  });

  it("fails the call on a rejected key and closes the run", async () => {
    await withProject(async (root) => {
      const { config } = await createTracker(root, { ...us, scheduleInterval: "weekly" });
      await addTrackerKeywords(root, config.id, ["alpha"], false);
      await makeDue(root, config.id);
      await withFetch(
        () => new Response("Unauthorized", { status: 401 }),
        () => assert.rejects(due(root), (error: unknown) => error instanceof OperationError && error.kind === "credentials"),
      );
      const shown = await showTracker(root, config.id);
      assert.equal(shown.latestRun?.status, "failed");
      assert.match(shown.latestRun?.errorMessage ?? "", /HTTP 401/);
    });
  });

  it("prints a crontab line for this project without installing it", async () => {
    await withProject(async (root) => {
      const result = runCli(root, ["rank", "schedule"]);
      assert.equal(result.status, 0, result.stderr);
      const { cron, notes } = JSON.parse(result.stdout) as { cron: string; notes: string[] };
      assert.match(cron, /^\d{1,2} \* \* \* \* cd '.+' && '.+node' .+ rank due >> '.+rank-due\.log' 2>&1$/);
      assert.ok(notes.some((note) => note.includes("DATAFORSEO_API_KEY")));
    });
  });
});
