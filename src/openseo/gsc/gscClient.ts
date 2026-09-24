// Ported from OpenSEO src/server/lib/gscClient.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local changes: access tokens come from the locally stored Google grant
// (src/google.ts) instead of Better Auth; a network failure is a GscApiError.
import { googleAccessToken } from "../../google.js";
import { GscApiError } from "./gscErrors.js";

export { GscApiError, GscTokenError } from "./gscErrors.js";

const GSC_API_BASE = "https://www.googleapis.com/webmasters/v3";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

/** A GSC REST call returned a non-2xx status. `status` drives user-facing messaging. */
export type GscSite = {
  siteUrl: string;
  permissionLevel: string;
};

export type GscSearchAnalyticsRow = {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type GscDimensionFilter = {
  dimension: string;
  operator: string;
  expression: string;
};

export type GscSearchAnalyticsRequest = {
  startDate: string;
  endDate: string;
  dimensions?: string[];
  dimensionFilterGroups?: Array<{
    groupType: "and" | "or";
    filters: GscDimensionFilter[];
  }>;
  rowLimit?: number;
  startRow?: number;
  type?: string;
  dataState?: string;
  aggregationType?: string;
};

/** Subset of the URL Inspection API `inspectionResult` we surface. The wire
 *  shape is richer; extra fields are ignored. */
export type UrlInspectionResult = {
  indexStatusResult?: {
    verdict?: string;
    coverageState?: string;
    robotsTxtState?: string;
    indexingState?: string;
    lastCrawlTime?: string;
    pageFetchState?: string;
    googleCanonical?: string;
    userCanonical?: string;
    crawledAs?: string;
    sitemap?: string[];
    referringUrls?: string[];
  };
  mobileUsabilityResult?: { verdict?: string };
  richResultsResult?: { verdict?: string };
  inspectionResultLink?: string;
};

function messageForStatus(status: number, body: string): string {
  if (status === 401 || status === 403) {
    return "Search Console denied access to this property (no verified permission, or the connection was revoked).";
  }
  if (status === 429) {
    return "Search Console rate limit reached. Retry shortly.";
  }
  if (status === 404) {
    return "Search Console property not found. It may have been removed in Search Console.";
  }
  return `Search Console API error (${status}): ${body.slice(0, 300)}`;
}

/** Free Google Search Console client. Unlike the DataForSEO client it does NOT
 *  meter credits — GSC is first-party data with no per-call cost. Access tokens
 *  come from the account's stored grant and are refreshed when they expire. */
export function createGscClient(opts: { accountId: string }) {
  async function getToken(): Promise<string> {
    return googleAccessToken(opts.accountId, "searchConsole");
  }

  async function request<T>(
    url: string,
    init?: { method?: string; body?: unknown },
  ): Promise<T> {
    const token = await getToken();
    const hasBody = init?.body !== undefined;
    let response: Response;
    try {
      response = await fetch(url, {
        method: init?.method ?? "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(hasBody ? { "Content-Type": "application/json" } : {}),
        },
        body: hasBody ? JSON.stringify(init?.body) : undefined,
      });
    } catch (error) {
      throw new GscApiError(0, `Search Console request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new GscApiError(
        response.status,
        messageForStatus(response.status, body),
        body,
      );
    }
    return (await response.json()) as T;
  }

  return {
    async getUserInfoEmail(): Promise<string | null> {
      const data = await request<{ email?: unknown }>(GOOGLE_USERINFO_URL);
      return typeof data.email === "string" ? data.email : null;
    },

    /** Webmasters API `sites.list` — the verified properties on the grant. */
    async listSites(): Promise<GscSite[]> {
      const data = await request<{ siteEntry?: GscSite[] }>(
        `${GSC_API_BASE}/sites`,
      );
      return data.siteEntry ?? [];
    },

    /** Webmasters API `searchAnalytics.query`. siteUrl is used verbatim. */
    async querySearchAnalytics(
      siteUrl: string,
      body: GscSearchAnalyticsRequest,
    ): Promise<GscSearchAnalyticsRow[]> {
      const data = await request<{ rows?: GscSearchAnalyticsRow[] }>(
        `${GSC_API_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
        { method: "POST", body },
      );
      return data.rows ?? [];
    },

    /** URL Inspection API `urlInspection.index.inspect`. This lives on a
     *  different host than the Webmasters v3 base, so the full URL is passed to
     *  the request helper. Same `webmasters.readonly` scope. */
    async inspectUrl(
      siteUrl: string,
      inspectionUrl: string,
      languageCode?: string,
    ): Promise<UrlInspectionResult | null> {
      const data = await request<{ inspectionResult?: UrlInspectionResult }>(
        "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
        {
          method: "POST",
          body: {
            siteUrl,
            inspectionUrl,
            ...(languageCode ? { languageCode } : {}),
          },
        },
      );
      return data.inspectionResult ?? null;
    },
  };
}
