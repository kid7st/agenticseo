import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { OperationError } from "../src/errors.js";
import { connectGoogle, disconnectGoogle, googleAccessToken, listGoogleAccounts } from "../src/google.js";
import { disconnectSearchConsole, exportSearchConsole, searchConsoleInspect, searchConsolePerformance, searchConsoleReport, searchConsoleSites, useSearchConsoleSite } from "../src/gsc.js";
import { readProject } from "../src/project.js";
import { withFetch, withProject } from "./helpers.js";

const realFetch = globalThis.fetch;
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SC = "https://www.googleapis.com/auth/webmasters.readonly";
const GA = "https://www.googleapis.com/auth/analytics.readonly";
const idToken = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const credentials = (kind: OperationError["kind"], message: RegExp) => (error: unknown) => error instanceof OperationError && error.kind === kind && message.test(error.message);

/** Runs with a throwaway config directory and a Desktop OAuth client in the environment. */
async function withGoogleHome(run: (home: string) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), "agenticseo-google-"));
  const saved = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET };
  Object.assign(process.env, { XDG_CONFIG_HOME: home, GOOGLE_CLIENT_ID: "1234-abc.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "client-secret" });
  try {
    await run(home);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(home, { recursive: true, force: true });
  }
}

/** Plays the browser: checks the consent URL, then follows Google's redirect back with a code. */
function consent(input: { expectScopes: string[]; state?: (state: string) => string; seen?: URL[] }) {
  return async (url: string) => {
    const consentUrl = new URL(url);
    input.seen?.push(consentUrl);
    assert.deepEqual(consentUrl.searchParams.get("scope")?.split(" "), ["openid", "email", ...input.expectScopes]);
    const redirect = new URL(consentUrl.searchParams.get("redirect_uri")!);
    const state = consentUrl.searchParams.get("state")!;
    redirect.search = new URLSearchParams({ code: "auth-code", state: input.state ? input.state(state) : state }).toString();
    // The browser's request runs after connectGoogle starts waiting for it.
    setTimeout(() => void realFetch(redirect), 0);
  };
}

/** The token endpoint: the client check's bogus code gets invalid_grant (a known client), a real code gets tokens. */
const tokenEndpoint = (tokens: () => Response) => (url: string, init: RequestInit) => {
  if (url !== TOKEN_URL) return realFetch(url);
  return String(init.body).includes("code=agenticseo-client-check") ? Response.json({ error: "invalid_grant", error_description: "Malformed auth code." }, { status: 400 }) : tokens();
};

const tokenResponse = (scope: string, extra: object = {}) =>
  Response.json({ access_token: "access-1", expires_in: 3600, refresh_token: "refresh-1", scope, id_token: idToken({ sub: "google-sub-1", email: "owner@kua.ai" }), ...extra });

async function connected(scopes = [SC, GA]) {
  await withFetch(
    tokenEndpoint(() => tokenResponse(["openid", "email", ...scopes].join(" "))),
    () => connectGoogle({ products: ["searchConsole", "analytics"], openUrl: consent({ expectScopes: [SC, GA] }) }),
  );
}

describe("Google authorization", () => {
  it("runs the loopback flow with PKCE and keeps the grant in an owner-only file outside the project", async () => {
    await withGoogleHome(async (home) => {
      const seen: URL[] = [];
      const { result, requests } = await withFetch(
        tokenEndpoint(() => tokenResponse(`openid email ${SC} ${GA}`)),
        () => connectGoogle({ products: ["searchConsole", "analytics"], openUrl: consent({ expectScopes: [SC, GA], seen }) }),
      );
      const params = seen[0].searchParams;
      assert.deepEqual([params.get("access_type"), params.get("code_challenge_method"), params.get("prompt")], ["offline", "S256", "select_account consent"]);
      assert.match(params.get("redirect_uri")!, /^http:\/\/127\.0\.0\.1:\d+$/);
      const exchange = new URLSearchParams(String(requests.filter((request) => request.url === TOKEN_URL).at(-1)?.body));
      assert.deepEqual([exchange.get("grant_type"), exchange.get("code"), exchange.get("redirect_uri")], ["authorization_code", "auth-code", params.get("redirect_uri")]);
      assert.ok((exchange.get("code_verifier") ?? "").length >= 43, "the PKCE verifier is sent with the code");
      assert.deepEqual(result.products, ["searchConsole", "analytics"]);
      assert.equal(result.email, "owner@kua.ai");

      const file = join(home, "agenticseo", "google-accounts.json");
      assert.equal((await stat(file)).mode & 0o777, 0o600);
      assert.equal((await stat(join(home, "agenticseo"))).mode & 0o777, 0o700);
      assert.match(await readFile(file, "utf8"), /refresh-1/);
      assert.deepEqual(await listGoogleAccounts(), [{ accountId: "google-sub-1", email: "owner@kua.ai", products: ["searchConsole", "analytics"], connectedAt: (await listGoogleAccounts())[0].connectedAt }]);
      assert.doesNotMatch(JSON.stringify(await listGoogleAccounts()), /refresh|access-1|secret/, "listing never prints tokens");
    });
  });

  it("says which product the user did not grant, and refuses a redirect from another attempt", async () => {
    await withGoogleHome(async () => {
      const { result } = await withFetch(
        tokenEndpoint(() => tokenResponse(`openid email ${SC}`)),
        () => connectGoogle({ products: ["searchConsole", "analytics"], openUrl: consent({ expectScopes: [SC, GA] }) }),
      );
      assert.deepEqual(result.notGranted, ["Google Analytics"]);
      await assert.rejects(googleAccessToken("google-sub-1", "analytics").then(() => undefined), credentials("credentials", /has not granted Google Analytics access/));

      await withFetch(tokenEndpoint(() => tokenResponse(`openid email ${SC}`)), () =>
        assert.rejects(
          connectGoogle({ products: ["searchConsole"], openUrl: consent({ expectScopes: [SC], state: () => "forged" }) }),
          credentials("input", /unexpected state/),
        ),
      );
    });
  });

  it("refreshes an expired access token and reports a revoked grant as a credentials failure", async () => {
    await withGoogleHome(async (home) => {
      await connected();
      const cached = await withFetch(() => Response.error(), () => googleAccessToken("google-sub-1", "searchConsole"));
      assert.deepEqual([cached.result, cached.requests.length], ["access-1", 0], "a fresh token is reused");

      const file = join(home, "agenticseo", "google-accounts.json");
      const store = JSON.parse(await readFile(file, "utf8"));
      store.accounts[0].accessTokenExpiresAt = 0;
      await import("node:fs/promises").then((fs) => fs.writeFile(file, JSON.stringify(store)));
      const refreshed = await withFetch(() => Response.json({ access_token: "access-2", expires_in: 3600 }), () => googleAccessToken("google-sub-1", "searchConsole"));
      assert.equal(refreshed.result, "access-2");
      assert.match(String(refreshed.requests[0].body), /grant_type=refresh_token/);
      assert.match(await readFile(file, "utf8"), /refresh-1/, "the refresh token is kept when Google does not rotate it");

      const expired = JSON.parse(await readFile(file, "utf8"));
      expired.accounts[0].accessTokenExpiresAt = 0;
      await import("node:fs/promises").then((fs) => fs.writeFile(file, JSON.stringify(expired)));
      await withFetch(
        () => Response.json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, { status: 400 }),
        () => assert.rejects(googleAccessToken("google-sub-1", "searchConsole"), credentials("credentials", /revoked or has expired .*run agenticseo google connect/)),
      );
    });
  });

  it("revokes at Google and forgets the account", async () => {
    await withGoogleHome(async () => {
      await connected();
      const { result, requests } = await withFetch(() => new Response("{}"), () => disconnectGoogle("OWNER@kua.ai"));
      assert.match(requests[0].url, /^https:\/\/oauth2\.googleapis\.com\/revoke\?token=refresh-1$/);
      assert.deepEqual([result.removed, result.revokedAtGoogle], [true, true]);
      assert.deepEqual(await listGoogleAccounts(), []);
    });
  });

  it("needs a well-formed Desktop OAuth client id before opening the consent page", async () => {
    await withGoogleHome(async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      await assert.rejects(connectGoogle({ products: ["searchConsole"], openUrl: async () => {} }), credentials("credentials", /GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required/));
      process.env.GOOGLE_CLIENT_ID = "1234-abc.apps.googleusercontent.com";
      const neverOpen = async () => assert.fail("the consent page must not open");
      await withFetch(
        () => Response.json({ error: "invalid_client", error_description: "The OAuth client was not found." }, { status: 401 }),
        () => assert.rejects(connectGoogle({ products: ["searchConsole"], openUrl: neverOpen }), credentials("credentials", /does not know the OAuth client .*minutes to hours/)),
      );
      await withFetch(
        () => Response.json({ error: "invalid_client", error_description: "The provided client secret is invalid." }, { status: 401 }),
        () => assert.rejects(connectGoogle({ products: ["searchConsole"], openUrl: neverOpen }), credentials("credentials", /rejected the OAuth client secret/)),
      );
      for (const wrong of ["...", "GOCSPX-secret", "123456789012", '"1234-abc.apps.googleusercontent.com"']) {
        process.env.GOOGLE_CLIENT_ID = wrong;
        await assert.rejects(connectGoogle({ products: ["searchConsole"], openUrl: async () => assert.fail("the consent page must not open") }), credentials("credentials", /is not an OAuth client id/));
      }
    });
  });
});

const SITES = "https://www.googleapis.com/webmasters/v3/sites";
const QUERY = `${SITES}/sc-domain%3Akua.ai/searchAnalytics/query`;
const INSPECT = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
const row = (keys: string[], clicks: number, impressions: number, position: number) => ({ keys, clicks, impressions, ctr: clicks / impressions, position });

/** Search Console for a project whose account can read sc-domain:kua.ai; `query` answers each Search Analytics body. */
function searchConsole(query: (body: Record<string, unknown>) => Response = () => Response.json({ rows: [] })) {
  return (url: string, init: RequestInit) => {
    if (url === SITES) return Response.json({ siteEntry: [{ siteUrl: "sc-domain:kua.ai", permissionLevel: "siteOwner" }, { siteUrl: "https://other.com/", permissionLevel: "siteUnverifiedUser" }] });
    if (url === QUERY) return query(JSON.parse(String(init.body)) as Record<string, unknown>);
    throw new Error(`Unexpected ${url}`);
  };
}

describe("Search Console", () => {
  it("lists properties, maps a verified one to the project and refuses unverified or unknown ones", async () => {
    await withGoogleHome(async () => {
      await withProject(async (root) => {
        await connected();
        const { result: sites } = await withFetch(searchConsole(), () => searchConsoleSites());
        assert.deepEqual(sites.accounts[0].sites.map((site) => site.siteUrl), ["sc-domain:kua.ai", "https://other.com/"]);
        await withFetch(searchConsole(), () => assert.rejects(useSearchConsoleSite(root, { siteUrl: "https://other.com/" }), credentials("credentials", /verified access/)));
        await withFetch(searchConsole(), () => assert.rejects(useSearchConsoleSite(root, { siteUrl: "https://kua.ai/" }), credentials("input", /isn't available .* sc-domain:/)));
        await withFetch(searchConsole(), () => useSearchConsoleSite(root, { siteUrl: "sc-domain:kua.ai" }));
        assert.deepEqual((await readProject(root)).searchConsole, { siteUrl: "sc-domain:kua.ai", accountId: "google-sub-1", accountEmail: "owner@kua.ai" });
        await disconnectSearchConsole(root);
        assert.equal((await readProject(root)).searchConsole, undefined);
        await assert.rejects(searchConsolePerformance(root, {}), credentials("input", /not connected .*gsc use/));
      });
    });
  });

  it("queries performance with filters wrapped in a group, applies metric filters locally and pages in Google's row space", async () => {
    await withGoogleHome(async () => {
      await withProject(async (root) => {
        await connected();
        await withFetch(searchConsole(), () => useSearchConsoleSite(root, { siteUrl: "sc-domain:kua.ai" }));
        const rows = [row(["fnsku"], 50, 1000, 3), row(["fnsku label"], 20, 900, 8.26), row(["amazon fnsku"], 5, 30, 12), row(["fnsku code"], 4, 400, 15)];
        const { result, requests } = await withFetch(searchConsole(() => Response.json({ rows })), () =>
          searchConsolePerformance(root, { filters: [{ dimension: "page", operator: "contains", expression: "/blog" }], minPosition: 5, maxPosition: 20, minImpressions: 50, rowLimit: 1 }),
        );
        const body = requests.find((request) => request.url === QUERY)?.body as Record<string, unknown>;
        assert.deepEqual(body.dimensionFilterGroups, [{ groupType: "and", filters: [{ dimension: "page", operator: "contains", expression: "/blog" }] }]);
        assert.equal(body.rowLimit, 1000, "a metric filter fetches the whole window");
        assert.deepEqual(result.rows, [{ keys: ["fnsku label"], clicks: 20, impressions: 900, ctr: 0.0222, position: 8.3 }]);
        assert.deepEqual([result.filteredFrom, result.hasMore, result.nextStartRow], [4, true, 2], "the next page starts after the last returned row");
        await assert.rejects(searchConsolePerformance(root, { startDate: "2026-09-01" }), credentials("input", /both --start and --end/));
      });
    });
  });

  it("builds the report's totals, previous period and striking-distance queries, and exports a table", async () => {
    await withGoogleHome(async () => {
      await withProject(async (root) => {
        await connected();
        await withFetch(searchConsole(), () => useSearchConsoleSite(root, { siteUrl: "sc-domain:kua.ai" }));
        const handler = searchConsole((body) => {
          const dimensions = (body.dimensions as string[]).join(",");
          if (dimensions === "date") return Response.json({ rows: [row(["d1"], 10, 100, 4), row(["d2"], 30, 300, 8)] });
          if (dimensions === "query,page") return Response.json({ rows: [row(["fnsku", "/a"], 1, 500, 9), row(["fnsku", "/b"], 0, 50, 3), row(["label", "/c"], 2, 400, 12)] });
          if (dimensions === "country") return Response.json({ rows: [row(["usa"], 40, 400, 7)] });
          return Response.json({ rows: [row(["fnsku"], 40, 400, 7)] });
        });
        const { result } = await withFetch(handler, () => searchConsoleReport(root, { dateRange: "last_28_days", device: "MOBILE" }));
        assert.deepEqual(result.totals, { clicks: 40, impressions: 400, ctr: 0.1, position: 7 });
        assert.deepEqual(result.strikingDistance.map((entry) => entry.query), ["label"], "a query whose best page ranks above 5 is not in striking distance");
        const exported = await withFetch(handler, () => exportSearchConsole(root, { dateRange: "last_28_days", dimension: "query", format: "csv" }));
        assert.equal((await readFile(exported.result.file, "utf8")).split("\n")[0], '"Query","Clicks","Impressions","CTR","Position"');
      });
    });
  });

  it("inspects URLs with per-URL errors, but stops when access is denied", async () => {
    await withGoogleHome(async () => {
      await withProject(async (root) => {
        await connected();
        await withFetch(searchConsole(), () => useSearchConsoleSite(root, { siteUrl: "sc-domain:kua.ai" }));
        const inspect = (deny: boolean) => (url: string, init: RequestInit) => {
          if (url !== INSPECT) throw new Error(url);
          if (deny) return new Response("forbidden", { status: 403 });
          const { inspectionUrl } = JSON.parse(String(init.body)) as { inspectionUrl: string };
          if (inspectionUrl.endsWith("/elsewhere")) return new Response("URL not in property", { status: 400 });
          return Response.json({ inspectionResult: { indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed" } } });
        };
        const { result } = await withFetch(inspect(false), () => searchConsoleInspect(root, { urls: ["https://kua.ai/", "https://kua.ai/elsewhere"] }));
        assert.equal(result.results[0].result?.indexStatusResult?.verdict, "PASS");
        assert.match(result.results[1].error ?? "", /Search Console API error \(400\)/);
        await withFetch(inspect(true), () => assert.rejects(searchConsoleInspect(root, { urls: ["https://kua.ai/"] }), credentials("credentials", /denied access/)));
      });
    });
  });
});
