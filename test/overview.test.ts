import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { projectOverview } from "../src/overview.js";
import { readProject, writeProject } from "../src/project.js";
import { withStore } from "../src/store.js";
import { runCli, withFetch, withProject } from "./helpers.js";

const SUMMARY = "https://api.dataforseo.com/v3/backlinks/summary/live";
const summary = (backlinks: number) => () =>
  Response.json({
    status_code: 20000,
    tasks: [{ status_code: 20000, cost: 0.02, path: ["v3"], result: [{ target: "example.com", rank: 300, backlinks, referring_domains: 40, new_reffering_domains: 3, lost_referring_domains: 1 }] }],
  });
type Card = { backlinks?: number | null; stale?: boolean; next?: string };
const card = (overview: { backlinks: object }) => overview.backlinks as Card;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString();

describe("project overview", () => {
  it("reads as empty and says how to fill each section, without calling anything", async () => {
    await withProject(async (root) => {
      const { result, requests } = await withFetch(() => new Response("unexpected", { status: 500 }), () => projectOverview(root, { refreshBacklinks: false }));
      assert.equal(requests.length, 0);
      assert.deepEqual(result, {
        domain: "example.com",
        rank: null,
        audit: null,
        backlinks: { snapshot: null, next: "agenticseo overview --refresh-backlinks" },
        searchConsole: { connected: false, next: "agenticseo google connect, then agenticseo gsc use SITE" },
        analytics: { connected: false, next: "agenticseo google connect --for analytics, then agenticseo ga4 use PROPERTY" },
      });
    });
  });

  it("summarizes every tracker's movement against a week ago and the latest audit's worst issue types", async () => {
    await withProject(async (root) => {
      const recent = day(-1);
      const older = day(-10);
      await withStore(root, (db) => {
        const tracker = db.prepare(
          `INSERT INTO rank_tracking_configs (id, domain, location_code, language_code, devices, serp_depth, schedule_interval, created_at) VALUES (?, 'example.com', ?, 'en', ?, 40, 'manual', ?)`,
        );
        const keyword = db.prepare(`INSERT INTO rank_tracking_keywords (id, config_id, keyword, created_at) VALUES (?, ?, ?, ?)`);
        const run = db.prepare(`INSERT INTO rank_check_runs (id, config_id, status, trigger, started_at) VALUES (?, ?, 'completed', 'manual', ?)`);
        const snap = db.prepare(`INSERT INTO rank_snapshots (run_id, tracking_keyword_id, keyword, device, position, checked_at) VALUES (?, ?, 'k', ?, ?, ?)`);
        // Six trackers: upstream reads at most five, so the sixth proves every one is counted.
        for (let n = 1; n <= 6; n++) {
          tracker.run(`t${n}`, 2840 + n, n === 1 ? "both" : "mobile", day(-30));
          keyword.run(`k${n}`, `t${n}`, `keyword ${n}`, day(-30));
          run.run(`old${n}`, `t${n}`, older);
          run.run(`new${n}`, `t${n}`, recent);
        }
        // An archived tracker is left out, as upstream does.
        tracker.run("t7", 2900, "mobile", day(-30));
        db.prepare(`UPDATE rank_tracking_configs SET is_active = 0 WHERE id = 't7'`).run();
        keyword.run("k7", "t7", "keyword 7", day(-30));
        // t1 mobile 12 -> 8 (improved, top 10), t1 desktop 5 -> 9 (declined, top 10), t2 unranked now, t6 15 -> 15.
        snap.run("old1", "k1", "mobile", 12, older);
        snap.run("new1", "k1", "mobile", 8, recent);
        snap.run("old1", "k1", "desktop", 5, older);
        snap.run("new1", "k1", "desktop", 9, recent);
        snap.run("old2", "k2", "mobile", 3, older);
        snap.run("new2", "k2", "mobile", null, recent);
        snap.run("old6", "k6", "mobile", 20, older);
        snap.run("new6", "k6", "mobile", 4, day(-2));

        db.prepare(`INSERT INTO audits (id, start_url, status, config, current_phase, pages_crawled, started_at) VALUES (?, 'https://example.com/', 'completed', '{}', 'completed', ?, ?)`).run("a-old", 5, day(-9));
        db.prepare(`INSERT INTO audits (id, start_url, status, config, current_phase, pages_crawled, started_at) VALUES (?, 'https://example.com/', 'completed', '{}', 'completed', ?, ?)`).run("a-new", 12, day(-1));
        const issue = db.prepare(`INSERT INTO audit_issues (id, audit_id, page_url, issue_type, severity) VALUES (?, ?, ?, ?, ?)`);
        let id = 0;
        const add = (audit: string, type: string, severity: string, ...pages: string[]) => pages.forEach((page) => issue.run(String(id++), audit, page, type, severity));
        add("a-old", "server-error", "critical", "/old");
        add("a-new", "rate-limited-page", "warning", "/a", "/b", "/c");
        // One page with the same issue twice counts once.
        add("a-new", "blocked-page", "critical", "/x", "/x");
        add("a-new", "crawl-rate-limited", "warning", "/a");
        add("a-new", "server-error", "critical", "/y", "/z");
      });
      const { rank, audit } = await projectOverview(root, { refreshBacklinks: false });
      await withStore(root, (db) =>
        db.prepare(`INSERT INTO audits (id, start_url, status, config, current_phase, worker_pid, heartbeat_at, started_at) VALUES ('a-dead', 'https://example.com/', 'running', '{}', 'crawling', NULL, ?, ?)`).run(day(-1), day(0)),
      );
      assert.equal((await projectOverview(root, { refreshBacklinks: false })).audit?.status, "interrupted", "a running audit whose worker died reads as interrupted");
      assert.deepEqual(rank, { trackers: 6, trackedKeywords: 6, improved: 2, declined: 1, top10: 3, lastCheckedAt: recent });
      assert.deepEqual(audit, {
        id: "a-new",
        status: "completed",
        pagesCrawled: 12,
        startedAt: audit?.startedAt,
        topIssues: [
          { issueType: "server-error", title: "Server error (5xx)", severity: "critical", pages: 2 },
          { issueType: "blocked-page", title: "Crawler was blocked", severity: "critical", pages: 1 },
          { issueType: "rate-limited-page", title: "Rate limited (429)", severity: "warning", pages: 3 },
        ],
        totalIssueTypes: 4,
      });
    });
  });

  it("refreshes the backlink snapshot only on request and at most once a day, and never for another domain's snapshot", async () => {
    await withProject(async (root) => {
      const first = await withFetch(summary(900), () => projectOverview(root, { refreshBacklinks: true }));
      assert.equal(first.requests.length, 1);
      assert.equal(first.requests[0].url, SUMMARY);
      assert.equal((first.requests[0].body as Array<{ include_subdomains?: boolean }>)[0].include_subdomains, true, "the whole site, subdomains included");
      const { backlinksRefresh, backlinks } = first.result;
      assert.equal(backlinksRefresh?.costUsd, 0.02);
      assert.ok(backlinksRefresh && "evidence" in backlinksRefresh);
      assert.equal(JSON.parse(await readFile((backlinksRefresh as { evidence: string }).evidence, "utf8")).domain, "example.com");
      assert.deepEqual({ ...backlinks, capturedAt: undefined }, {
        domain: "example.com", rank: 300, backlinks: 900, referringDomains: 40, brokenBacklinks: null, newBacklinks: null, lostBacklinks: null,
        newReferringDomains: 3, lostReferringDomains: 1, capturedAt: undefined, stale: false,
      });

      const again = await withFetch(summary(1), () => projectOverview(root, { refreshBacklinks: true }));
      assert.equal(again.requests.length, 0, "a fresh snapshot is not bought twice");
      assert.deepEqual(again.result.backlinksRefresh, { refreshed: false, reason: "The snapshot is under a day old", costUsd: 0 });

      // A fresh snapshot of the previous domain neither shows nor stops a refresh for the new one.
      await writeProject(root, { ...(await readProject(root)), domain: "other.com" });
      assert.deepEqual((await projectOverview(root, { refreshBacklinks: false })).backlinks, { snapshot: null, next: "agenticseo overview --refresh-backlinks" });
      const moved = await withFetch(summary(5), () => projectOverview(root, { refreshBacklinks: true }));
      assert.equal(moved.requests.length, 1);
      assert.equal(card(moved.result).backlinks, 5);

      await withStore(root, (db) => db.prepare(`UPDATE backlink_snapshots SET captured_at = ?`).run(day(-2)));
      const stale = await projectOverview(root, { refreshBacklinks: false });
      assert.equal(card(stale).stale, true);
      assert.equal(card(stale).next, "agenticseo overview --refresh-backlinks");
      await assert.rejects(
        withFetch(() => new Response("down", { status: 502 }), () => projectOverview(root, { refreshBacklinks: true })),
        "a failed refresh fails the command instead of showing the stale snapshot",
      );
    });
  });

  it("needs a DataForSEO key only to refresh", async () => {
    await withProject(async (root) => {
      assert.equal(runCli(root, ["overview"]).status, 0);
      const refresh = runCli(root, ["overview", "--refresh-backlinks"]);
      assert.equal(refresh.status, 3, refresh.stderr);
    });
  });
});
