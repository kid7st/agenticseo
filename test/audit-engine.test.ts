import assert from "node:assert/strict";
import dns from "node:dns";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { createCrawlThrottle } from "../src/openseo/audit/crawl-throttle.js";
import { runPageReporters } from "../src/openseo/audit/issues/page-reporters.js";
import { isCrawlableUrl, normalizeAndValidateStartUrl } from "../src/openseo/audit/url-policy.js";
import { crawlPage } from "../src/openseo/workflows/site-audit-workflow-helpers.js";

const brokenPage = `<!doctype html><html><head><title>Hi</title></head>
<body><h1>One</h1><h1>Two</h1><img src="/a.png"><p>Short.</p><a href="/next">next</a></body></html>`;

describe("ported audit engine", () => {
  let server: Server;
  let origin: string;
  let userAgent: string | undefined;

  before(async () => {
    server = createServer((req, res) => {
      userAgent = req.headers["user-agent"];
      res.writeHead(200, { "Content-Type": "text/html", "X-Robots-Tag": "noindex" });
      res.end(brokenPage);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    origin = `http://127.0.0.1:${address.port}`;
  });
  after(() => server.close());

  it("crawls a page and reports its page-level issues", async () => {
    const page = await crawlPage(`${origin}/`, 0, false, createCrawlThrottle(Date.now() + 30_000));
    assert.ok(page);
    assert.equal(userAgent, "AgenticSEO-Audit/1.0");
    const issues = runPageReporters(page).map((issue) => issue.issueType).sort();
    // Upstream skips content checks such as thin-content on noindex pages.
    assert.deepEqual(issues, ["images-missing-alt", "missing-meta-description", "multiple-h1", "noindex-page", "title-too-short"]);
  });
});

describe("audit start URL policy", () => {
  it("blocks local targets unless --allow-private is given", async () => {
    await assert.rejects(normalizeAndValidateStartUrl("http://localhost:3000"), {
      code: "CRAWL_TARGET_BLOCKED",
      kind: "input",
      message: /--allow-private/,
    });
    assert.equal(await normalizeAndValidateStartUrl("http://localhost:3000", { allowPrivate: true }), "http://localhost:3000/");
    assert.equal(isCrawlableUrl("http://192.168.0.10/page"), false);
    assert.equal(isCrawlableUrl("http://192.168.0.10/page", { allowPrivate: true }), true);
  });

  it("blocks public names that resolve to private addresses", async (t) => {
    t.mock.method(dns.promises, "lookup", async () => [{ address: "10.0.0.5", family: 4 }]);
    await assert.rejects(normalizeAndValidateStartUrl("intranet.example.com"), { code: "CRAWL_TARGET_BLOCKED" });
  });

  it("reports an unresolvable host instead of crawling blind", async (t) => {
    t.mock.method(dns.promises, "lookup", async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    });
    await assert.rejects(normalizeAndValidateStartUrl("no-such-host.example"), {
      code: "VALIDATION_ERROR",
      kind: "input",
      message: /Cannot resolve no-such-host\.example \(ENOTFOUND\)/,
    });
  });

  it("accepts public names and strips the fragment", async (t) => {
    t.mock.method(dns.promises, "lookup", async () => [{ address: "93.184.215.14", family: 4 }]);
    assert.equal(await normalizeAndValidateStartUrl("example.com/path#section"), "https://example.com/path");
  });
});
