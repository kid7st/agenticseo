import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { auditStatus } from "../src/audit.js";
import { OwnershipLost, runSiteAudit } from "../src/openseo/workflows/siteAuditRunner.js";
import { withStore } from "../src/store.js";
import { runCliAsync, withProject } from "./helpers.js";

/** A clean page: title, description, one H1 and enough distinct words, plus the given links. */
function page(name: string, links: string[]) {
  return `<!doctype html><html><head><title>${name} page of the test site</title>
<meta name="description" content="The ${name} page of a small site that the AgenticSEO audit tests crawl end to end."></head>
<body><h1>${name}</h1><p>${`${name} words `.repeat(100)}</p>${links.map((href) => `<a href="${href}">${href}</a>`).join("")}</body></html>`;
}

/**
 * A site with one issue of each link-graph kind: a broken link (/missing), a redirect
 * (/old), an orphan only the sitemap knows (/orphan) and a robots.txt-disallowed page.
 * /busy answers its first request with a 429, as a rate-limited site would.
 */
function testSite() {
  const requests = new Map<string, number>();
  const server = createServer((req, res) => {
    const path = req.url ?? "/";
    // Page fetches only; the start-URL redirect probe is a HEAD request.
    if (req.method === "GET") requests.set(path, (requests.get(path) ?? 0) + 1);
    const origin = `http://${req.headers.host}`;
    const html = (body: string) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(body);
    };
    if (path === "/robots.txt") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end(`User-agent: *\nDisallow: /private\nSitemap: ${origin}/sitemap.xml\n`);
    }
    if (path === "/sitemap.xml") {
      res.writeHead(200, { "Content-Type": "application/xml" });
      return res.end(`<?xml version="1.0"?><urlset><url><loc>${origin}/</loc></url><url><loc>${origin}/orphan</loc></url></urlset>`);
    }
    if (path === "/") return html(page("home", ["/a", "/missing", "/old", "/private"]));
    if (path === "/a") return html(page("alpha", ["/", "/busy"]));
    if (path === "/busy") {
      if (requests.get(path) === 1) {
        res.writeHead(429, { "Retry-After": "1" });
        return res.end();
      }
      return html(page("busy", ["/"]));
    }
    if (path === "/orphan") return html(page("orphan", ["/"]));
    if (path === "/old") {
      res.writeHead(301, { Location: "/a" });
      return res.end();
    }
    res.writeHead(404, { "Content-Type": "text/html" });
    res.end("<html><head><title>Not found</title></head><body>Not found</body></html>");
  });
  return { server, requests };
}

const crawledPaths = ["/", "/a", "/busy", "/missing", "/old", "/orphan"];

function parse(result: { status: number | null; stdout: string; stderr: string }) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function auditRows(root: string, auditId: string) {
  const db = new DatabaseSync(join(root, ".agenticseo", "data", "agenticseo.db"), { readOnly: true });
  try {
    return {
      pages: (db.prepare(`SELECT url FROM audit_pages WHERE audit_id = ? ORDER BY url`).all(auditId) as Array<{ url: string }>).map((row) => new URL(row.url).pathname),
      issues: (db.prepare(`SELECT issue_type, page_url FROM audit_issues WHERE audit_id = ? ORDER BY issue_type, page_url`).all(auditId) as Array<{ issue_type: string; page_url: string }>).map(
        (row) => `${row.issue_type} ${new URL(row.page_url).pathname}`,
      ),
      scratch: (db.prepare(`SELECT (SELECT COUNT(*) FROM audit_frontier WHERE audit_id = ?) + (SELECT COUNT(*) FROM audit_page_links WHERE audit_id = ?) AS n`).get(auditId, auditId) as { n: number }).n,
    };
  } finally {
    db.close();
  }
}

const expectedIssues = ["broken-internal-link /", "broken-page /missing", "orphan-page /orphan"];

describe("site audit", () => {
  let site: ReturnType<typeof testSite>;
  let origin: string;

  before(async () => {
    site = testSite();
    await new Promise<void>((resolve) => site.server.listen(0, "127.0.0.1", resolve));
    const address = (site.server as Server).address();
    assert.ok(address && typeof address === "object");
    origin = `http://127.0.0.1:${address.port}`;
  });
  after(() => site.server.close());

  it("refuses a local target without --allow-private", async () => {
    await withProject(async (root) => {
      const result = await runCliAsync(root, ["audit", "start", origin]);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /--allow-private/);
    });
  });

  it("crawls a site within robots.txt and reports page and link-graph issues", async () => {
    await withProject(async (root) => {
      site.requests.clear();
      const status = parse(await runCliAsync(root, ["audit", "start", origin, "--allow-private", "--wait"]));
      assert.equal(status.status, "completed");
      assert.equal(status.pagesCrawled, crawledPaths.length);
      const rows = auditRows(root, status.id);
      assert.deepEqual(rows.pages, crawledPaths);
      assert.deepEqual(rows.issues, expectedIssues);
      assert.equal(rows.scratch, 0, "frontier and link rows are dropped at finalize");
      assert.equal(site.requests.get("/private"), undefined, "robots.txt disallowed /private");
      assert.equal(site.requests.get("/busy"), 2, "a 429 is retried after the cooldown");
      for (const path of crawledPaths.filter((path) => path !== "/busy")) assert.equal(site.requests.get(path), 1, `${path} fetched once`);
      assert.deepEqual(parse(await runCliAsync(root, ["audit", "status"])).id, status.id, "status defaults to the latest audit");
    });
  });

  it("resumes a crawl whose worker was killed, without losing or duplicating pages", async () => {
    await withProject(async (root) => {
      site.requests.clear();
      const started = parse(await runCliAsync(root, ["audit", "start", origin, "--allow-private"]));
      assert.equal(started.status, "running");
      // Requests are paced a second apart; kill the detached worker mid-batch.
      while ((site.requests.get("/a") ?? 0) === 0) await sleep(50);
      const running = new DatabaseSync(join(root, ".agenticseo", "data", "agenticseo.db"), { readOnly: true });
      const { worker_pid: pid } = running.prepare(`SELECT worker_pid FROM audits WHERE id = ?`).get(started.id) as { worker_pid: number };
      running.close();
      process.kill(pid, "SIGKILL");
      // A dead local process is detected at once, without waiting for the heartbeat to go stale.
      const deadline = Date.now() + 5_000;
      while (parse(await runCliAsync(root, ["audit", "status", started.id])).status !== "interrupted") {
        assert.ok(Date.now() < deadline, "the killed worker was not detected");
        await sleep(50);
      }

      const resumed = parse(await runCliAsync(root, ["audit", "resume", started.id, "--wait"]));
      assert.equal(resumed.status, "completed");
      const rows = auditRows(root, started.id);
      assert.deepEqual(rows.pages, crawledPaths);
      assert.deepEqual(rows.issues, expectedIssues);
      // The first batch (/ and the sitemap's /orphan) was persisted before the kill; the
      // second batch was leased but unfinished, so only it is fetched again.
      assert.equal(site.requests.get("/"), 1);
      assert.equal(site.requests.get("/a"), 2);

      const again = await runCliAsync(root, ["audit", "resume", started.id]);
      assert.equal(again.status, 2);
      assert.match(again.stderr, /already completed/);
    });
  });

  it("stops a worker whose audit was taken over mid-crawl, leaving the new owner's run alone", async () => {
    await withProject(async (root) => {
      site.requests.clear();
      await withStore(root, async (db) => {
        const now = new Date().toISOString();
        db.prepare(`INSERT INTO audits (id, start_url, status, config, current_phase, worker_token, heartbeat_at, started_at) VALUES ('a1', ?, 'running', '{"maxPages":10,"allowPrivate":true}', 'discovery', 'owner', ?, ?)`).run(`${origin}/`, now, now);
        const run = runSiteAudit(db, "a1", "owner");
        while ((site.requests.get("/") ?? 0) === 0) await sleep(20);
        db.prepare(`UPDATE audits SET worker_token = 'resumer' WHERE id = 'a1'`).run();
        await assert.rejects(run, OwnershipLost);
        assert.deepEqual({ ...db.prepare(`SELECT status, worker_token FROM audits WHERE id = 'a1'`).get() }, { status: "running", worker_token: "resumer" });
      });
    });
  });

  it("will not resume an audit whose worker is still alive", async () => {
    await withProject(async (root) => {
      const started = parse(await runCliAsync(root, ["audit", "start", origin, "--allow-private"]));
      const second = await runCliAsync(root, ["audit", "resume", started.id]);
      assert.equal(second.status, 2);
      assert.match(second.stderr, /still running/);
      // Let the worker finish before the project directory is removed.
      while (parse(await runCliAsync(root, ["audit", "status", started.id])).status === "running") await sleep(200);
    });
  });
});

describe("audit worker liveness", () => {
  it("reports an audit whose heartbeat went stale as interrupted, even if its process id is alive", async () => {
    await withProject(async (root) => {
      const staleAt = new Date(Date.now() - 60_000).toISOString();
      await withStore(root, (db) =>
        db
          .prepare(`INSERT INTO audits (id, start_url, status, config, current_phase, worker_token, worker_pid, heartbeat_at, started_at) VALUES ('a1', 'https://example.com/', 'running', '{"maxPages":10,"allowPrivate":false}', 'discovery', 'owner', ?, ?, ?)`)
          .run(process.pid, staleAt, staleAt),
      );
      assert.equal((await auditStatus(root, "a1")).status, "interrupted");
    });
  });
});
