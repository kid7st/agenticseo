import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { backlinksDomains, backlinksLinks, backlinksOverview, backlinksPages, domainRatings } from "../src/backlinks.js";
import { OperationError } from "../src/errors.js";
import { runCli, withFetch, withProject } from "./helpers.js";

const api = "https://api.dataforseo.com/v3/backlinks";
const task = (result: unknown[], extra: Record<string, unknown> = {}) =>
  Response.json({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0.02, path: ["v3", "backlinks"], result, ...extra }] });
const items = (rows: unknown[], totalCount = rows.length) => task([{ items: rows, total_count: totalCount }]);

async function withCache<T>(run: (cacheDirectory: string) => Promise<T>) {
  const directory = await mkdtemp(join(tmpdir(), "agenticseo-backlinks-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const body = (requests: Array<{ url: string; body: unknown }>, endpoint: string) =>
  (requests.find((request) => request.url === `${api}/${endpoint}/live`)?.body as Array<Record<string, unknown>> | undefined)?.[0];

test("overview sends OpenSEO's payloads, maps summary and trends, and serves repeats from cache", async () => {
  await withCache(async (cacheDirectory) => {
    const handler = (url: string) => {
      if (url.endsWith("/summary/live")) return task([{ rank: 61, backlinks: 5000, referring_domains: 300, new_reffering_domains: 7, info: { target_spam_score: 3 } }]);
      if (url.endsWith("/history/live")) return items([{ date: "2026-08-01 00:00:00 +00:00", backlinks: 4900, referring_domains: 290, rank: 60, new_backlinks: 40 }]);
      if (url.endsWith("/referring_domains/live")) return items([{ domain: "news.example", backlinks: 12, referring_pages: 9, rank: 55 }], 300);
      throw new Error(`unexpected ${url}`);
    };
    const live = await withFetch(handler, () => backlinksOverview({ target: "www.Example.com", scope: "domain", hideSpam: true, cacheDirectory }));
    assert.deepEqual(body(live.requests, "summary"), { target: "example.com", include_subdomains: false, include_indirect_links: true, exclude_internal_backlinks: true, backlinks_status_type: "live", rank_scale: "one_hundred" });
    assert.deepEqual(body(live.requests, "referring_domains")?.filters, [["backlinks_spam_score", "<=", 40]], "spammy domains are hidden by default");
    const history = body(live.requests, "history");
    assert.match(String(history?.date_from), /^\d{4}-\d{2}-\d{2}$/);
    const { summary, trends, scope } = live.result.overview;
    assert.deepEqual([summary.rank, summary.backlinks, summary.newReferringDomains, summary.targetSpamScore, summary.lostBacklinks], [61, 5000, 7, 3, null]);
    assert.deepEqual(trends, [{ date: "2026-08-01", backlinks: 4900, referringDomains: 290, rank: 60 }]);
    assert.equal(scope, "domain");
    assert.match(live.result.scopeNote ?? "", /trend data includes subdomains/);
    assert.deepEqual([live.result.referringDomains?.totalCount, live.result.referringDomains?.rows[0].domain], [300, "news.example"]);
    assert.deepEqual([live.result.cached, live.result.costUsd], [false, 0.06]);

    const again = await withFetch(() => assert.fail("a cached overview must not call DataForSEO"), () => backlinksOverview({ target: "example.com", scope: "domain", hideSpam: true, cacheDirectory }));
    assert.deepEqual([again.result.cached, again.result.costUsd], [true, 0]);
  });
});

test("a subfolder overview counts filtered backlinks and skips what the provider cannot scope", async () => {
  await withCache(async (cacheDirectory) => {
    const { result, requests } = await withFetch(
      (_url, init) => items([{}], JSON.parse(String(init.body))[0].mode === "as_is" ? 120 : 45),
      () => backlinksOverview({ target: "https://example.com/blog", hideSpam: true, cacheDirectory }),
    );
    assert.deepEqual(requests.map((request) => [request.url, (request.body as Array<{ mode: string; limit: number }>)[0].mode]), [[`${api}/backlinks/live`, "as_is"], [`${api}/backlinks/live`, "one_per_domain"]]);
    assert.match(JSON.stringify((requests[0].body as Array<{ filters: unknown }>)[0].filters), /url_to.*like.*example\.com\/blog/);
    assert.deepEqual([result.overview.scope, result.overview.summary.backlinks, result.overview.summary.referringDomains, result.overview.summary.rank], ["subfolder", 120, 45, null]);
    assert.equal(result.referringDomains, null);
    await assert.rejects(
      backlinksDomains({ target: "https://example.com/blog", page: 1, pageSize: 100, sortField: "backlinks", sortOrder: "desc", filters: {}, hideSpam: true, cacheDirectory }),
      (error: unknown) => error instanceof OperationError && error.kind === "input" && /can't be broken down for a subfolder/.test(error.message),
    );
  });
});

test("backlink rows apply OpenSEO's filters, spam cutoff, sort and mapping", async () => {
  await withCache(async (cacheDirectory) => {
    const row = { domain_from: "blog.example", url_from: "https://blog.example/post", url_to: "https://example.com/", anchor: "example", dofollow: true, rank: 30, domain_from_rank: 50, backlinks_spam_score: 4, first_seen: "2026-01-02", lost_date: "2026-09-01" };
    const { result, requests } = await withFetch(() => items([row], 900), () => backlinksLinks({
      target: "example.com", page: 2, pageSize: 50, sortField: "domainRank", sortOrder: "desc", mode: "as_is", hideSpam: true, cacheDirectory,
      filters: { include: "blog,news", exclude: "spam", minDomainRank: 20, linkType: "dofollow", hideBroken: true },
    }));
    const sent = (requests[0].body as Array<Record<string, unknown>>)[0];
    assert.deepEqual([sent.limit, sent.offset, sent.order_by, sent.mode], [50, 50, ["domain_from_rank,desc"], "as_is"]);
    assert.deepEqual(sent.filters, [
      [["url_from", "ilike", "%blog%"], "or", ["url_from", "ilike", "%news%"]], "and",
      ["url_from", "not_ilike", "%spam%"], "and",
      ["domain_from_rank", ">=", 20], "and",
      ["dofollow", "=", true], "and",
      ["is_broken", "=", false], "and",
      ["backlink_spam_score", "<=", 40],
    ]);
    assert.deepEqual([result.rows[0].spamScore, result.rows[0].isLost, result.rows[0].lastSeen, result.totalCount, result.hasMore], [4, true, "2026-09-01", 900, true]);
    await withFetch(() => items([{ ...row, dofollow: "yes" }]), () => assert.rejects(
      backlinksLinks({ target: "example.com", page: 3, pageSize: 50, sortField: "rank", sortOrder: "desc", mode: "as_is", hideSpam: true, cacheDirectory, filters: {} }),
      (error: unknown) => error instanceof OperationError && error.kind === "provider" && /backlinks-live returned an invalid response shape: 0\.dofollow/.test(error.message),
    ));
    await assert.rejects(
      backlinksLinks({ target: "https://example.com/a", scope: "exact_url", page: 1, pageSize: 50, sortField: "rank", sortOrder: "desc", mode: "one_per_domain", hideSpam: true, cacheDirectory, filters: { include: "a,b,c,d,e,f,g,h,i" } }),
      /Too many filter conditions/,
    );
  });
});

test("top pages and referring domains map rows and page like OpenSEO", async () => {
  await withCache(async (cacheDirectory) => {
    const pages = await withFetch(() => items([{ page: "https://example.com/guide", backlinks: 80, referring_domains: 20, rank: 40 }], 1), () => backlinksPages({ target: "example.com", page: 1, pageSize: 100, sortField: "referringDomains", sortOrder: "desc", filters: { minReferringDomains: 5 }, cacheDirectory }));
    assert.deepEqual((pages.requests[0].body as Array<Record<string, unknown>>)[0].filters, [["referring_domains", ">=", 5]]);
    assert.deepEqual([pages.result.rows[0], pages.result.hasMore], [{ page: "https://example.com/guide", backlinks: 80, referringDomains: 20, rank: 40, brokenBacklinks: null }, false]);
    const domains = await withFetch(() => items([{ domain: "a.example", backlinks: 3 }], 1), () => backlinksDomains({ target: "example.com", page: 1, pageSize: 100, sortField: "rank", sortOrder: "asc", filters: {}, hideSpam: false, cacheDirectory }));
    const sent = (domains.requests[0].body as Array<Record<string, unknown>>)[0];
    assert.deepEqual([sent.order_by, sent.filters], [["rank,asc"], undefined], "no spam cutoff when spam is included");
  });
});

test("a DataForSEO balance problem on the Backlinks API is reported as a billing issue", async () => {
  await withCache(async (cacheDirectory) => {
    await withFetch(
      () => Response.json({ status_code: 20000, tasks: [{ status_code: 40200, status_message: "Payment Required.", path: ["v3", "backlinks", "summary", "live"] }] }),
      () => assert.rejects(
        backlinksOverview({ target: "example.com", hideSpam: true, cacheDirectory }),
        (error: unknown) => error instanceof OperationError && error.kind === "provider" && /billing or balance issue/.test(error.message),
      ),
    );
  });
});

test("Ahrefs ratings send the APIv3 key, merge equivalent inputs, treat 0 as no rating, cache results and report failures separately", async () => {
  await withCache(async (cacheDirectory) => {
    const previous = process.env.AHREFS_API_KEY;
    try {
      delete process.env.AHREFS_API_KEY;
      await withFetch(() => assert.fail("no request without a key"), () => assert.rejects(
        domainRatings(["example.com"], cacheDirectory),
        (error: unknown) => error instanceof OperationError && error.kind === "credentials" && /AHREFS_API_KEY is required: .*free APIv3 key/.test(error.message),
      ));

      process.env.AHREFS_API_KEY = "AHREFS_TEST";
      const handler = (url: string) => {
        const target = new URL(url).searchParams.get("target");
        if (target === "down-site.com") return new Response("", { status: 503 });
        return Response.json({ domain_rating: { domain_rating: target === "new-site.com" ? 0 : 72 } });
      };
      const first = await withFetch(handler, () => domainRatings(["https://www.example.com/x", "example.com", "new-site.com", "down-site.com"], cacheDirectory));
      assert.equal(first.requests.length, 3, "equivalent inputs are fetched once");
      assert.ok(first.requests.every((request) => request.authorization === "Bearer AHREFS_TEST"));
      assert.deepEqual(first.result, {
        ratings: { "https://www.example.com/x": 72, "example.com": 72, "new-site.com": null },
        failed: { "down-site.com": "Ahrefs DR lookup failed with status 503" },
      });
      const again = await withFetch(handler, () => domainRatings(["example.com", "new-site.com"], cacheDirectory));
      assert.equal(again.requests.length, 0, "ratings and 'no rating' are both cached");
      assert.deepEqual(again.result.ratings, { "example.com": 72, "new-site.com": null });

      await withFetch(() => Response.json(["Error", "Forbidden"], { status: 403 }), () => assert.rejects(
        domainRatings(["other-site.com", "third-site.com"], cacheDirectory),
        (error: unknown) => error instanceof OperationError && error.kind === "credentials" && /Ahrefs rejected AHREFS_API_KEY \(HTTP 403\)/.test(error.message),
      ));
    } finally {
      if (previous === undefined) delete process.env.AHREFS_API_KEY;
      else process.env.AHREFS_API_KEY = previous;
    }
  });
});

test("backlinks commands hide spammy domains unless --include-spam is passed", async () => {
  await withProject(async (root) => {
    const env = { DATAFORSEO_API_KEY: "TEST_KEY" };
    const domain = (args: string[]) => {
      const result = runCli(root, ["backlinks", "domains", "example.com", ...args], { env, mock: true });
      assert.equal(result.status, 0, result.stderr);
      return (JSON.parse(result.stdout) as { rows: Array<{ domain: string }> }).rows[0].domain;
    };
    assert.equal(domain([]), "without-spam.com");
    assert.equal(domain(["--include-spam"]), "with-spam.com");
  });
});

test("backlinks commands validate views and options with the input exit code", async () => {
  await withProject(async (root) => {
    for (const args of [
      ["backlinks", "profile", "example.com"],
      ["backlinks", "links", "example.com", "--sort", "backlinks"],
      ["backlinks", "domains", "example.com", "--page-size", "25"],
      ["backlinks", "pages", "example.com", "--include-spam"],
      ["backlinks", "overview", "example.com", "--scope", "site"],
      ["domain-rating"],
    ]) {
      const result = runCli(root, args);
      assert.equal(result.status, 2, `${args.join(" ")}: ${result.stderr}`);
    }
  });
});
