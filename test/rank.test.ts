import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OperationError } from "../src/errors.js";
import { addTrackerKeywords, createTracker, estimateTracker, listTrackers, removeTrackerKeywords, searchLocations, showTracker, updateTracker } from "../src/rank.js";
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
      const manual = await updateTracker(root, config.id, { scheduleInterval: "manual" });
      assert.equal(manual.config.nextCheckAt, null);
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
