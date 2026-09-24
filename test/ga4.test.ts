import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { OperationError } from "../src/errors.js";
import { analyticsHealth, analyticsOverview, analyticsProperties, analyticsReport, disconnectAnalytics, searchOpportunities, useAnalyticsProperty } from "../src/ga4.js";
import { readProject, writeProject } from "../src/project.js";
import { withFetch, withProject } from "./helpers.js";

const ADMIN = "https://analyticsadmin.googleapis.com";
const disabled_data = () =>
  new Response(
    JSON.stringify({ error: { code: 403, message: "Google Analytics analyticsdata.googleapis.com API has not been used in project 1 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/analyticsdata.googleapis.com/overview?project=1", status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED", metadata: { service: "analyticsdata.googleapis.com" } }] } }),
    { status: 403 },
  );
const DATA = "https://analyticsdata.googleapis.com/v1beta/properties/123:runReport";
const GSC_QUERY = "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Akua.ai/searchAnalytics/query";
const failsWith = (kind: OperationError["kind"], message: RegExp) => (error: unknown) => error instanceof OperationError && error.kind === kind && message.test(error.message);

/** A stored Analytics grant with a live access token, so no token refresh is needed. */
async function withAnalyticsGrant(run: () => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), "agenticseo-ga4-"));
  const saved = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = home;
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(join(home, "agenticseo"), { recursive: true });
  const account = {
    accountId: "sub-1",
    email: "owner@kua.ai",
    scopes: ["openid", "email", "https://www.googleapis.com/auth/analytics.readonly", "https://www.googleapis.com/auth/webmasters.readonly"],
    clientId: "id",
    clientSecret: "secret",
    refreshToken: "refresh",
    accessToken: "access",
    accessTokenExpiresAt: Date.now() + 3_600_000,
    connectedAt: new Date().toISOString(),
  };
  await writeFile(join(home, "agenticseo", "google-accounts.json"), JSON.stringify({ accounts: [account] }));
  try {
    await run();
  } finally {
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved;
    await rm(home, { recursive: true, force: true });
  }
}

type RunReportBody = { dimensions: Array<{ name: string }>; metrics: Array<{ name: string }>; dimensionFilter?: unknown };

/** Answers runReport with one row per landing page, echoing the requested columns. */
function dataApi(overrides: { status?: number; body?: string; headers?: Record<string, string> } = {}) {
  return (body: RunReportBody) => {
    if (overrides.status) return new Response(overrides.body ?? "{}", { status: overrides.status, headers: overrides.headers });
    const pages = ["/a", "/b"];
    return Response.json({
      dimensionHeaders: body.dimensions.map(({ name }) => ({ name })),
      metricHeaders: body.metrics.map(({ name }) => ({ name, type: "TYPE_INTEGER" })),
      rows: pages.map((page, index) => ({
        dimensionValues: body.dimensions.map(({ name }) => ({ value: name === "hostName" ? "kua.ai" : name === "landingPage" || name === "pagePath" ? page : name === "date" ? "20260901" : `${name}-${index}` })),
        metricValues: body.metrics.map(() => ({ value: String(10 * (index + 1)) })),
      })),
      rowCount: pages.length,
      metadata: { currencyCode: "USD", timeZone: "America/Los_Angeles" },
    });
  };
}

function google(data = dataApi()) {
  return (url: string, init: RequestInit) => {
    if (url.startsWith(`${ADMIN}/v1beta/accountSummaries`)) {
      return Response.json({ accountSummaries: [{ account: "accounts/1", displayName: "Kua", propertySummaries: [{ property: "properties/123", displayName: "kua.ai" }] }] });
    }
    if (url === `${ADMIN}/v1beta/properties/123`) return Response.json({ name: "properties/123", displayName: "kua.ai", timeZone: "America/Los_Angeles", currencyCode: "USD" });
    if (url.startsWith(`${ADMIN}/v1alpha/properties/123/dataStreams`)) {
      return Response.json({ dataStreams: [{ name: "properties/123/dataStreams/9", type: "WEB_DATA_STREAM", displayName: "Web", webStreamData: { measurementId: "G-1", defaultUri: "https://kua.ai" } }] });
    }
    if (url === `${ADMIN}/v1alpha/properties/123/dataStreams/9/enhancedMeasurementSettings`) return Response.json({ streamEnabled: true, siteSearchEnabled: true, searchQueryParameter: "q" });
    if (url.startsWith(`${ADMIN}/v1beta/properties/123/keyEvents`)) return Response.json({ keyEvents: [{ eventName: "sign_up", countingMethod: "ONCE_PER_EVENT" }] });
    if (url.startsWith(`${ADMIN}/v1beta/properties/123/customDimensions`)) return Response.json({});
    if (url.startsWith(`${ADMIN}/v1beta/properties/123/customMetrics`)) return Response.json({});
    if (url === DATA) return data(JSON.parse(String(init.body)) as RunReportBody);
    if (url === GSC_QUERY) return Response.json({ rows: [{ keys: ["https://kua.ai/a"], clicks: 5, impressions: 900, ctr: 0.0056, position: 11 }] });
    throw new Error(`Unexpected ${url}`);
  };
}

async function connectedProject(run: (root: string) => Promise<void>) {
  await withAnalyticsGrant(() =>
    withProject(async (root) => {
      await withFetch(google(), () => useAnalyticsProperty(root, { propertyId: "123" }));
      await run(root);
    }),
  );
}

describe("Google Analytics", () => {
  it("lists properties and records the chosen one with its time zone and currency", async () => {
    await withAnalyticsGrant(() =>
      withProject(async (root) => {
        const { result } = await withFetch(google(), () => analyticsProperties());
        assert.deepEqual(result.accounts[0].properties, [{ propertyId: "properties/123", displayName: "kua.ai", accountDisplayName: "Kua" }]);
        await withFetch(google(), () => assert.rejects(useAnalyticsProperty(root, { propertyId: "999" }), failsWith("input", /isn't available/)));
        await assert.rejects(analyticsReport(root, "landing-pages", {}), failsWith("input", /not connected for this project\. Run agenticseo ga4 properties/));
        await withFetch(google(), () => useAnalyticsProperty(root, { propertyId: "123" }));
        assert.deepEqual((await readProject(root)).analytics, {
          propertyId: "properties/123",
          propertyDisplayName: "kua.ai",
          propertyTimeZone: "America/Los_Angeles",
          propertyCurrencyCode: "USD",
          accountId: "sub-1",
          accountEmail: "owner@kua.ai",
        });
        await disconnectAnalytics(root);
        assert.equal((await readProject(root)).analytics, undefined);
      }),
    );
  });

  it("runs a report filtered to Organic Search with OpenSEO's defaults, and validates each report's options", async () => {
    await connectedProject(async (root) => {
      const { result, requests } = await withFetch(google(), () => analyticsReport(root, "landing-pages", { startDate: "2026-08-01", endDate: "2026-08-28" }));
      const body = requests.find((request) => request.url === DATA)?.body as RunReportBody;
      assert.deepEqual(body.dimensions.map((dimension) => dimension.name), ["hostName", "landingPage"]);
      assert.match(JSON.stringify(body.dimensionFilter), /sessionDefaultChannelGroup.*Organic Search/);
      assert.deepEqual(result.request.resolvedDateRange, { startDate: "2026-08-01", endDate: "2026-08-28" });
      assert.deepEqual([result.rowCount, result.request.channel, result.source.propertyId], [2, "organic_search", "properties/123"]);

      await assert.rejects(analyticsReport(root, "landing-pages", { channel: "all" }), failsWith("input", /landing-pages has no --channel/));
      await assert.rejects(analyticsReport(root, "audience", { breakdown: "item" }), failsWith("input", /device, country, new_vs_returning/));
      await assert.rejects(analyticsReport(root, "site-search", { startDate: "2026-08-01" }), failsWith("input", /both startDate and endDate/));
      const acquisition = await withFetch(google(), () => analyticsReport(root, "traffic-acquisition", { breakdown: "source_medium" }));
      assert.equal((acquisition.requests.find((request) => request.url === DATA)?.body as RunReportBody).dimensions[0].name, "sessionSourceMedium");
    });
  });

  it("turns Google's refusals into exit codes with the reason", async () => {
    await connectedProject(async (root) => {
      const run = (response: Parameters<typeof dataApi>[0]) => withFetch(google(dataApi(response)), () => analyticsReport(root, "page-performance", {}));
      await assert.rejects(run({ status: 401 }), failsWith("credentials", /expired or was revoked\. Run agenticseo google connect --for analytics\./));
      await assert.rejects(
        run({ status: 403, body: JSON.stringify({ error: { details: [{ reason: "SERVICE_DISABLED", metadata: { service: "analyticsdata.googleapis.com" } }] } }) }),
        failsWith("provider", /Data API is not enabled/),
      );
      await assert.rejects(run({ status: 403 }), failsWith("credentials", /can no longer access this property/));
      await assert.rejects(run({ status: 429, headers: { "retry-after": "120" } }), failsWith("provider", /quota is exhausted.* Retry after 120 s\./));
    });
  });

  it("passes on Google's instructions when an Analytics API is not enabled", async () => {
    await withAnalyticsGrant(async () => {
      const disabled = (service: string) =>
        new Response(
          JSON.stringify({ error: { code: 403, message: `Google Analytics ${service} API has not been used in project 1 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/${service}/overview?project=1`, status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } }),
          { status: 403 },
        );
      const { result } = await withFetch(() => disabled("analyticsadmin.googleapis.com"), () => analyticsProperties());
      assert.equal(result.accounts[0].requiresReconnect, false);
      assert.match(result.accounts[0].error ?? "", /analyticsadmin\.googleapis\.com API has not been used .*Enable it by visiting/);
    });
    await connectedProject(async (root) => {
      await withFetch(google(() => disabled_data()), () =>
        assert.rejects(analyticsReport(root, "landing-pages", {}), failsWith("provider", /analyticsdata\.googleapis\.com API has not been used .*Enable it by visiting/)),
      );
    });
  });

  it("builds the organic overview and the measurement health check", async () => {
    await connectedProject(async (root) => {
      const { result: overview } = await withFetch(google(), () => analyticsOverview(root, { startDate: "2026-08-01", endDate: "2026-08-28", trend: "weekly" }));
      assert.ok(overview.current && overview.previous, "current and previous periods are both read");
      assert.ok(Array.isArray(overview.trend));
      const { result: health } = await withFetch(google(), () => analyticsHealth(root));
      assert.equal(health.webStreams[0].measurementId, "G-1");
      assert.deepEqual(health.keyEvents.map((event) => event.eventName), ["sign_up"]);
    });
  });

  it("joins Search Console demand with GA4 landing pages, and needs both connections", async () => {
    await connectedProject(async (root) => {
      await assert.rejects(searchOpportunities(root, {}), failsWith("input", /Search Console is not connected/));
      await writeProject(root, { ...(await readProject(root)), searchConsole: { siteUrl: "sc-domain:kua.ai", accountId: "sub-1", accountEmail: "owner@kua.ai" } });
      const { result } = await withFetch(google(), () => searchOpportunities(root, { startDate: "2026-08-01", endDate: "2026-08-28", limit: 10 }));
      assert.ok(result.rows.length > 0);
      assert.match(JSON.stringify(result.rows[0]), /kua\.ai\/a/);
      assert.ok(await readFile(join(root, ".agenticseo", "project.json"), "utf8"));
    });
  });
});
