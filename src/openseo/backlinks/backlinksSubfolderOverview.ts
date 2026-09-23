// Ported from OpenSEO src/server/features/backlinks/services/backlinksSubfolderOverview.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local changes: the credit-attribution parameter is removed.
import type { createDataforseoClient } from "../dataforseo/client.js";
import { buildBacklinksScopeFilter } from "../dataforseo/researchScopeFilters.js";
import type { normalizeBacklinksTarget } from "../dataforseoBacklinksTarget.js";
import type { BacklinksOverviewResult } from "./backlinksOverviewSchema.js";

/**
 * The summary and history endpoints only take a whole target, so subfolder
 * totals come from two filtered `total_count` reads of the backlinks list:
 * every link (`as_is`) and one per referring domain. Rank, spam scores,
 * new/lost, and trends have no filtered source and stay null/empty.
 * Sequenced, not parallel: hosted billing checks balance per call.
 */
export async function buildSubfolderOverview(
  dataforseo: ReturnType<typeof createDataforseoClient>,
  normalizedTarget: ReturnType<typeof normalizeBacklinksTarget>,
  now: Date,
): Promise<BacklinksOverviewResult> {
  const filters = buildBacklinksScopeFilter("url_to", normalizedTarget).clauses;

  const allLinks = await dataforseo.backlinks.rows({
    target: normalizedTarget.apiTarget,
    includeSubdomains: normalizedTarget.includeSubdomains,
    limit: 1,
    mode: "as_is",
    filters,
  });
  const perDomain = await dataforseo.backlinks.rows({
    target: normalizedTarget.apiTarget,
    includeSubdomains: normalizedTarget.includeSubdomains,
    limit: 1,
    mode: "one_per_domain",
    filters,
  });

  return {
    target: normalizedTarget.apiTarget,
    displayTarget: normalizedTarget.displayTarget,
    scope: "subfolder",
    summary: {
      rank: null,
      backlinks: allLinks.totalCount,
      referringPages: null,
      referringDomains: perDomain.totalCount,
      brokenBacklinks: null,
      brokenPages: null,
      backlinksSpamScore: null,
      targetSpamScore: null,
      newBacklinks: null,
      lostBacklinks: null,
      newReferringDomains: null,
      lostReferringDomains: null,
    },
    trends: [],
    newLostTrends: [],
    fetchedAt: now.toISOString(),
  };
}
