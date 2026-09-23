import { createFileCache } from "./openseo/cache.js";
import { getAhrefsDomainRatings } from "./openseo/ahrefs.js";
import { createBacklinksService } from "./openseo/backlinks/BacklinksService.js";
import type {
  BacklinksRowsFilters,
  BacklinksRowsSortField,
  BacklinksSortOrder,
  ReferringDomainsFilters,
  ReferringDomainsSortField,
  TopPagesFilters,
  TopPagesSortField,
} from "./openseo/backlinks/schemas.js";
import { createDataforseoClient, ledgerCost, type ProviderCall } from "./openseo/dataforseo/client.js";
import { normalizeBacklinksTarget } from "./openseo/dataforseoBacklinksTarget.js";
import type { ResearchScope } from "./openseo/researchScope.js";

type Lookup = { target: string; scope?: ResearchScope; cacheDirectory: string };
type Page<TSort, TFilters> = Lookup & { page: number; pageSize: number; sortField: TSort; sortOrder: BacklinksSortOrder; filters: TFilters };

/** One command's service, client ledger and cost; a cache hit makes no call, so it costs nothing. */
function session(cacheDirectory: string) {
  const calls: ProviderCall[] = [];
  return {
    service: createBacklinksService(createFileCache(cacheDirectory)),
    client: createDataforseoClient(calls),
    done: <T extends object>(result: T) => ({ ...result, cached: calls.length === 0, costUsd: ledgerCost(calls), calls }),
  };
}

/**
 * OpenSEO's get_backlinks_overview: the summary and trends plus the top referring
 * domains, which subfolder scope cannot break down. Cached for six hours.
 */
export async function backlinksOverview(input: Lookup & { hideSpam: boolean }) {
  const { service, client, done } = session(input.cacheDirectory);
  const lookup = { target: input.target, scope: input.scope };
  const resolvedScope = normalizeBacklinksTarget(input.target, { scope: input.scope }).scope;
  const [overview, referringDomains] = await Promise.all([
    service.profileOverview(lookup, client),
    resolvedScope === "subfolder"
      ? Promise.resolve(null)
      : service.profileReferringDomainsPage(
          { ...lookup, page: 1, pageSize: 100, sortField: "backlinks", sortOrder: "desc", filters: {} },
          client,
          { hideSpam: input.hideSpam },
        ),
  ]);
  const { scope } = overview.overview;
  // backlinks/history has no include_subdomains, so trend series stay
  // subdomain-inclusive even when the summary excludes subdomains.
  const scopeNote = scope === "domain"
    ? "Summary excludes subdomains; trend data includes subdomains (provider limitation)."
    : scope === "subfolder"
      ? "Counts are computed from filtered backlink totals; rank, trends, and the referring-domains breakdown aren't available for subfolders."
      : undefined;
  return done({ overview: overview.overview, scopeNote, referringDomains });
}

/** OpenSEO's get_backlinks_profile: one page of backlink rows. */
export async function backlinksLinks(input: Page<BacklinksRowsSortField, BacklinksRowsFilters> & { mode: "one_per_domain" | "as_is"; hideSpam: boolean }) {
  const { service, client, done } = session(input.cacheDirectory);
  const { cacheDirectory: _dir, hideSpam, ...request } = input;
  const target = normalizeBacklinksTarget(request.target, { scope: request.scope });
  const page = await service.profileBacklinksPage(request, client, { hideSpam });
  return done({ target: target.displayTarget, scope: target.scope, ...page });
}

/** The app's referring-domains tab. */
export async function backlinksDomains(input: Page<ReferringDomainsSortField, ReferringDomainsFilters> & { hideSpam: boolean }) {
  const { service, client, done } = session(input.cacheDirectory);
  const { cacheDirectory: _dir, hideSpam, ...request } = input;
  const target = normalizeBacklinksTarget(request.target, { scope: request.scope });
  const page = await service.profileReferringDomainsPage(request, client, { hideSpam });
  return done({ target: target.displayTarget, scope: target.scope, ...page });
}

/** The app's top-pages tab: the target's pages by backlinks. */
export async function backlinksPages(input: Page<TopPagesSortField, TopPagesFilters>) {
  const { service, client, done } = session(input.cacheDirectory);
  const { cacheDirectory: _dir, ...request } = input;
  const target = normalizeBacklinksTarget(request.target, { scope: request.scope });
  const page = await service.profileTopPagesPage(request, client);
  return done({ target: target.displayTarget, scope: target.scope, ...page });
}

/** Ahrefs' free public Domain Rating for up to 100 domains, cached for a day. */
export function domainRatings(domains: string[], cacheDirectory: string) {
  return getAhrefsDomainRatings(domains, createFileCache(cacheDirectory));
}
