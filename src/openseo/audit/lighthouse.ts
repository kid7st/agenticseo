// Ported from OpenSEO src/server/lib/audit/lighthouse.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local changes: calls go through the local ledger client and carry their cost;
// the compact payload is stored with the result row instead of in R2, so
// storeLighthouseResult is not ported; a credentials error stops the audit
// instead of being recorded as a failed check; nothing is logged. The sample
// groups pages by site section instead of URL template and skips non-HTML pages
// (see selectLighthouseSample).
import { canonicalUrlKey } from "./url-utils.js";
import { OperationError } from "../../errors.js";
import { createDataforseoClient, ledgerCost, type ProviderCall } from "../dataforseo/client.js";
import { DataforseoChargedTaskError } from "../dataforseo/envelope.js";
import type { LighthouseResult, LighthouseStrategy } from "./types.js";

interface LighthouseSamplePage {
  url: string;
  statusCode: number;
  isHtml: boolean;
}

function canonicalUrlKeyWithoutTrailingSlash(url: string): string {
  const parsed = new URL(canonicalUrlKey(url));
  if (parsed.pathname !== "/") {
    parsed.pathname = parsed.pathname.replace(/\/$/, "");
  }
  return parsed.toString();
}

type LighthouseFetchResult = {
  result: LighthouseResult;
  payloadJson: string | null;
  costUsd: number;
};

/** A check that produced no payload — provider error, or a failed fetch step. */
export function failedLighthouseFetch(
  url: string,
  pageId: string,
  strategy: "mobile" | "desktop",
  errorMessage: string,
  costUsd = 0,
): LighthouseFetchResult {
  return {
    result: {
      url,
      pageId,
      strategy,
      performanceScore: null,
      accessibilityScore: null,
      bestPracticesScore: null,
      seoScore: null,
      lcpMs: null,
      cls: null,
      inpMs: null,
      ttfbMs: null,
      errorMessage,
    },
    payloadJson: null,
    costUsd,
  };
}

export async function fetchLighthouseResult(
  url: string,
  pageId: string,
  strategy: "mobile" | "desktop",
): Promise<LighthouseFetchResult> {
  const calls: ProviderCall[] = [];
  const dataforseo = createDataforseoClient(calls);
  try {
    const data = await dataforseo.lighthouse.live({ url, strategy });

    return {
      result: {
        url,
        pageId,
        strategy,
        performanceScore: data.scores.performance,
        accessibilityScore: data.scores.accessibility,
        bestPracticesScore: data.scores["best-practices"],
        seoScore: data.scores.seo,
        lcpMs: data.metrics.largestContentfulPaint.numericValue,
        cls: data.metrics.cumulativeLayoutShift.numericValue,
        inpMs: data.metrics.interactionToNextPaint.numericValue,
        ttfbMs: data.metrics.serverResponseTime.numericValue,
      },
      payloadJson: JSON.stringify(data),
      costUsd: ledgerCost(calls),
    };
  } catch (error) {
    // A missing or rejected key would fail every check the same way: stop the audit
    // so it can be resumed after the key is fixed.
    if (error instanceof OperationError && error.kind === "credentials") throw error;
    const failed = error instanceof Error ? error : new Error(String(error));
    // Lighthouse runtime errors (ERRORED_DOCUMENT_REQUEST, NOT_HTML, NO_FCP) mean the
    // page didn't load for the provider's Chrome; the result row records why.
    const costUsd = error instanceof DataforseoChargedTaskError ? error.billing.costUsd : 0;
    return failedLighthouseFetch(url, pageId, strategy, failed.message, costUsd);
  }
}

/**
 * Select which pages to run Lighthouse on: the start page plus one page per site
 * section, largest sections first, at most ten pages.
 *
 * A section is the first path segment plus the path depth, so /blog/a/ and
 * /blog/b/ share one, /blog/tags/aws/ is another and /docs/cli/ a third. Upstream
 * grouped by URL template, which treats every one-word slug (/blog/tags/aws/,
 * /blog/tags/deploy/) as its own template, so one section of short slugs could
 * fill the whole sample. Only HTML pages count: Lighthouse cannot audit a
 * Markdown, XML or text file, and DataForSEO still bills the attempt.
 */
export function selectLighthouseSample(
  pages: LighthouseSamplePage[],
  startUrl: string,
  strategy: LighthouseStrategy,
): string[] {
  if (strategy === "none") return [];

  const validPages = pages.filter(
    (p) => p.isHtml && p.statusCode >= 200 && p.statusCode < 300,
  );

  const selected = new Set<string>();

  // Always include the start URL / homepage. Prefer an exact canonical match
  // so distinct 2xx `/path` and `/path/` pages stay distinct, then tolerate a
  // trailing-slash redirect when the exact start URL was not crawled as 2xx.
  const startKey = canonicalUrlKey(startUrl);
  const startPage =
    validPages.find((p) => canonicalUrlKey(p.url) === startKey) ??
    validPages.find(
      (p) =>
        canonicalUrlKeyWithoutTrailingSlash(p.url) ===
        canonicalUrlKeyWithoutTrailingSlash(startUrl),
    );
  if (startPage) selected.add(startPage.url);

  const sections = new Map<string, LighthouseSamplePage[]>();
  for (const page of validPages) {
    const key = sectionKey(page.url);
    const section = sections.get(key);
    if (section) section.push(page);
    else sections.set(key, [page]);
  }
  if (startPage) sections.delete(sectionKey(startPage.url));

  // Stable sort: equal-sized sections keep crawl order, and each section's
  // first page is the shallowest one the crawl reached.
  const bySize = [...sections.values()].sort((a, b) => b.length - a.length);
  for (const [first] of bySize) {
    if (selected.size >= 10) break;
    selected.add(first.url);
  }

  return Array.from(selected);
}

function sectionKey(url: string): string {
  const segments = new URL(url).pathname.split("/").filter(Boolean);
  return `${segments[0] ?? ""}/${segments.length}`;
}
