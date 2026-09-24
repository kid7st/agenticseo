#!/usr/bin/env node
import { resolve } from "node:path";
import { OperationError } from "./errors.js";
import { AppError } from "./openseo/platform.js";
import { spawn } from "node:child_process";
import { brandLookup, promptLookup } from "./ai.js";
import { analyticsHealth, analyticsOverview, analyticsProperties, analyticsReport, disconnectAnalytics, GA4_REPORTS, searchOpportunities, useAnalyticsProperty, type Ga4Report } from "./ga4.js";
import { connectGoogle, disconnectGoogle, listGoogleAccounts, type GoogleProduct } from "./google.js";
import { disconnectSearchConsole, exportSearchConsole, searchConsoleInspect, searchConsolePerformance, searchConsoleReport, searchConsoleSites, useSearchConsoleSite } from "./gsc.js";
import { GSC_DATE_RANGES, GSC_DIMENSIONS, GSC_FILTER_OPERATORS, GSC_MAX_ROW_LIMIT, GSC_SEARCH_TYPES, type GscDimension } from "./openseo/gsc/searchAnalytics.js";
import { auditIssues, auditPages, auditStatus, lighthouseIssues, lighthouseResults, deleteAudit, exportAudit, listAudits, resumeAudit, runAuditWorker, startAudit } from "./audit.js";
import { backlinksDomains, backlinksLinks, backlinksOverview, backlinksPages, domainRatings } from "./backlinks.js";
import { domainOverview, domainPages, rankedKeywords, serpCompetitors } from "./domain.js";
import { keywordMetrics, researchKeywords, serpResults } from "./keywords.js";
import { localBusinesses, localCategories, localPosts, localProfile, localQuestions, localRankGrid, localReviews, localSerp } from "./local.js";
import { countryForCall, languageForCall, marketForCall, marketForNewProject, serpMarketForCall } from "./market.js";
import {
  addTrackerKeywords,
  createTracker,
  estimateTracker,
  listTrackers,
  rankDue,
  refreshTrackerMetrics,
  removeTrackerKeywords,
  scheduleLine,
  runTracker,
  searchLocations,
  showTracker,
  trackerHistory,
  trackerMatrix,
  trackerTrend,
  updateTracker,
} from "./rank.js";
import { MAX_KEYWORDS_PER_CONFIG } from "./openseo/shared/rank-tracking.js";
import { PAGE_FETCH_CLASSES } from "./openseo/shared/audit-fetch-class.js";
import { LIGHTHOUSE_CATEGORIES } from "./openseo/shared/lighthouse.js";
import { DEFAULT_AUDIT_PAGES, MIN_AUDIT_PAGES, PAID_MAX_AUDIT_PAGES } from "./openseo/shared/audit-limits.js";
import { RESEARCH_SCOPES, type ResearchScope } from "./openseo/researchScope.js";
import { deleteTagCommand, exportCommand, listCommand, refreshCommand, removeCommand, renameTagCommand, saveCommand, tagCommand, type SavedFilters } from "./saved.js";
import { queryStore, withStore } from "./store.js";
import { cacheDirectory, findProjectRoot, initProject, readContext, readProject, saveEvidence } from "./project.js";
import { listReports, listTemplates } from "./reports.js";

const usage = `Usage:
  agenticseo init --domain example.com --location US|2840 [--language en] [--project DIR]
  agenticseo context [--project DIR]
  agenticseo reports [--project DIR]
  agenticseo keywords TERM... [--clickstream] [MARKET] [--project DIR]
  agenticseo research "SEED" [--limit 150|300|500] [--clickstream] [MARKET] [--project DIR]
  agenticseo serp "QUERY" [--depth 10-100] [MARKET] [--project DIR]
  agenticseo domain TARGET [--scope SCOPE] [MARKET] [--project DIR]
  agenticseo ranked TARGET [--scope SCOPE] [--sort rank|search_volume|traffic_estimate|cpc]
      [--min-volume N] [--max-rank N] [--exclude TERM,...] [--types TYPE,...]
      [--limit 1-100] [--offset 0-1000] [MARKET] [--project DIR]
  agenticseo pages TARGET [--scope SCOPE] [--sort traffic|keywords] [--order desc|asc]
      [--include TERM,...] [--exclude TERM,...] [--min-traffic N] [--max-traffic N]
      [--min-keywords N] [--max-keywords N] [--page N] [--page-size 50|100|200] [MARKET] [--project DIR]
  agenticseo competitors KEYWORD... [--types TYPE,...] [--exclude-domains DOMAIN,...]
      [--include-subdomains] [--sort visibility|traffic_estimate|avg_position|keyword_count]
      [--limit 1-100] [--offset 0-1000] [MARKET] [--project DIR]
  agenticseo saved add KEYWORD... [--tags TAG,...] [--replace-tags] [MARKET] [--project DIR]
  agenticseo saved list [FILTERS] [--page N] [--page-size 50|100|250] [--project DIR]
  agenticseo saved export [FILTERS] [--format csv|jsonl] [--out FILE] [--project DIR]
  agenticseo saved remove ID... [--project DIR]
  agenticseo saved tag ID... [--add TAG,...] [--remove TAG,...] [--project DIR]
  agenticseo saved rename-tag TAG [--to NEW_NAME] [--color COLOR|none] [--project DIR]
  agenticseo saved delete-tag TAG [--project DIR]
  agenticseo saved refresh [--project DIR]
  agenticseo backlinks overview TARGET [--scope SCOPE] [--include-spam] [--project DIR]
  agenticseo backlinks links TARGET [--scope SCOPE] [--mode one_per_domain|as_is] [--include-spam]
      [--sort rank|domainRank|spamScore|firstSeen] [--order desc|asc] [--page N] [--page-size 50|100|200]
      [--include TERMS] [--exclude TERMS] [--min-domain-rank N] [--max-domain-rank N]
      [--min-authority N] [--max-authority N] [--min-spam N] [--max-spam N]
      [--link-type dofollow|nofollow] [--hide-lost] [--hide-broken] [--from-domain DOMAIN] [--project DIR]
  agenticseo backlinks domains TARGET [--scope SCOPE] [--include-spam]
      [--sort domain|backlinks|referringPages|rank|spamScore|firstSeen|brokenBacklinks] [--order desc|asc]
      [--page N] [--page-size 50|100|200] [--include TERMS] [--exclude TERMS]
      [--min-backlinks N] [--max-backlinks N] [--min-rank N] [--max-rank N] [--min-spam N] [--max-spam N] [--project DIR]
  agenticseo backlinks pages TARGET [--scope SCOPE] [--sort backlinks|referringDomains|rank|brokenBacklinks]
      [--order desc|asc] [--page N] [--page-size 50|100|200] [--include TERMS] [--exclude TERMS]
      [--min-backlinks N] [--max-backlinks N] [--min-referring-domains N] [--max-referring-domains N]
      [--min-rank N] [--max-rank N] [--project DIR]
  agenticseo domain-rating DOMAIN... [--project DIR]
  agenticseo local businesses --near LAT,LNG --radius KM [--query TEXT] [--categories SLUG,...]
      [--min-rating 1-5] [--min-reviews N] [--claimed|--unclaimed] [--sort relevance|rating|reviews]
      [--limit 1-50] [--offset N] [--project DIR]
  agenticseo local serp "QUERY" --near LAT,LNG [--zoom 4-18] [--type maps|local_finder]
      [--device mobile|desktop] [--depth 1-100] [--language CODE] [--project DIR]
  agenticseo local categories [TEXT] [--limit 1-200] [--project DIR]
  agenticseo local profile BUSINESS [--near LAT,LNG [--radius KM]] [MARKET] [--project DIR]
  agenticseo local questions BUSINESS --near LAT,LNG --radius KM [--depth 1-100] [--language CODE] [--project DIR]
  agenticseo local grid "QUERY" --center LAT,LNG TARGET [--size 3|5] [--spacing KM] [--zoom 4-18]
      [--device mobile|desktop] [--language CODE] [--project DIR]
  agenticseo local reviews (BUSINESS [--near LAT,LNG [--radius KM]] [MARKET] [--depth 10-200]
      [--sort newest|highest_rating|lowest_rating|relevant] [--other-sources] | --task-id ID) [--project DIR]
  agenticseo local posts (BUSINESS [--near LAT,LNG [--radius KM]] [MARKET] [--depth 10-100] | --task-id ID) [--project DIR]
BUSINESS is one of --name TEXT, --cid ID or --place-id ID; TARGET is any of --cid, --place-id or --name
  agenticseo audit start [URL] [--max-pages 10-10000] [--allow-private] [--lighthouse] [--wait] [--project DIR]
  agenticseo audit status [ID] [--project DIR]
  agenticseo audit resume ID [--wait] [--project DIR]
  agenticseo audit issues [ID] [--severity critical|warning|info] [--type ISSUE_TYPE] [--limit 1-1000] [--project DIR]
  agenticseo audit pages [ID] [--fetch-class ok|blocked|rate_limited|error] [--status CODE]
      [--url-contains TEXT] [--limit 1-1000] [--project DIR]
  agenticseo audit lighthouse [ID] [--result RESULT_ID [--category CATEGORY]] [--project DIR]
  agenticseo audit export [ID] [--table issues|pages|performance] [--format csv|jsonl] [--out FILE] [--project DIR]
  agenticseo audit list [--project DIR]
  agenticseo audit delete ID [--project DIR]
  agenticseo rank create [DOMAIN] [MARKET] [--location-name NAME] [TRACKER_SETTINGS] [--project DIR]
  agenticseo rank update ID [--domain DOMAIN] [MARKET] [--location-name NAME|none] [TRACKER_SETTINGS] [--project DIR]
  agenticseo rank list [--project DIR]
  agenticseo rank archive ID [--project DIR]
  agenticseo rank add ID KEYWORD... [--match-case] [--project DIR]
  agenticseo rank remove ID KEYWORD_ID... [--project DIR]
  agenticseo rank estimate ID [--add N] [--project DIR]
  agenticseo rank run ID [--keywords KEYWORD_ID,...] [--project DIR]
  agenticseo rank show ID [--compare 1d|7d|30d|90d] [--project DIR]
  agenticseo rank history ID KEYWORD_ID [--days 1-730] [--project DIR]
  agenticseo rank trend ID [--device mobile|desktop] [--days 1-730] [--project DIR]
  agenticseo rank matrix ID [--device mobile|desktop] [--runs 1-26] [--project DIR]
  agenticseo rank metrics ID [--project DIR]
  agenticseo rank due [--project DIR]
  agenticseo rank schedule [--project DIR]
  agenticseo rank locations "PLACE" [--location COUNTRY] [--project DIR]
TRACKER_SETTINGS: --devices mobile|desktop|both --depth 10-100 (multiple of 10) --schedule manual|daily|weekly|monthly
  agenticseo ai brand BRAND_OR_DOMAIN [--competitors A,B,...] [--scope SCOPE] [MARKET] [--project DIR]
  agenticseo ai prompt "PROMPT" [--models chat_gpt,claude,gemini,perplexity] [--brand NAME]
      [--no-web-search] [--web-country US] [--project DIR]
  agenticseo google connect [--for search-console|analytics|all]
  agenticseo google accounts
  agenticseo google disconnect EMAIL_OR_ID
  agenticseo gsc sites [--project DIR]
  agenticseo gsc use SITE_URL [--account EMAIL] [--project DIR]
  agenticseo gsc disconnect [--project DIR]
  agenticseo gsc performance [--dimensions query,page,country,device,date,searchAppearance]
      [--range RANGE | --start YYYY-MM-DD --end YYYY-MM-DD] [--filter DIMENSION:OPERATOR:EXPRESSION]...
      [--limit 1-1000] [--start-row N] [--min-position N] [--max-position N] [--min-impressions N]
      [--type web|image|video|news|googleNews|discover] [--data-state all|final] [--project DIR]
  agenticseo gsc report [--range last_7_days|last_28_days|last_3_months] [--device DESKTOP|MOBILE|TABLET] [--country ISO3] [--project DIR]
  agenticseo gsc export [--dimension query|page] [--range ...] [--device ...] [--country ...] [--format csv|jsonl] [--out FILE] [--project DIR]
  agenticseo gsc inspect URL... [--language en-US] [--project DIR]
  agenticseo ga4 properties
  agenticseo ga4 use PROPERTY_ID [--account EMAIL] [--project DIR]
  agenticseo ga4 disconnect [--project DIR]
  agenticseo ga4 report landing-pages|page-performance|key-events|traffic-acquisition|ecommerce|site-search|audience
      [--start YYYY-MM-DD --end YYYY-MM-DD] [--limit 1-1000] [--offset N] [--channel organic_search|all]
      [--breakdown BREAKDOWN] [--compare] [--include-date] [--only-with-transactions] [--project DIR]
  agenticseo ga4 overview [--start ... --end ...] [--trend daily|weekly] [--project DIR]
  agenticseo ga4 health [--project DIR]
  agenticseo ga4 opportunities [--start ... --end ...] [--limit 1-100] [--project DIR]
RANGE: last_7_days, last_28_days, last_3_months, last_6_months, last_12_months, last_16_months
  agenticseo query "SELECT ..." [--project DIR]
MARKET overrides the project's market for one call: --location US|2840 [--language en]
FILTERS: --search TEXT --include TERM,... --exclude TERM,... --tags TAG,... --min-volume N --max-volume N
  --min-cpc N --max-cpc N --min-difficulty N --max-difficulty N
  --sort createdAt|keyword|searchVolume|cpc|competition|keywordDifficulty|fetchedAt --order desc|asc
SCOPE is exact_url, subfolder, domain or subdomains (default: subdomains for a domain, subfolder for a URL)`;

// Documented in README.md; agents branch on these instead of parsing stderr.
const exitCodes = { input: 2, credentials: 3, provider: 4 } as const;

function option(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new OperationError("input", `${name} requires a value`);
  args.splice(index, 2);
  return value;
}

function intOption(args: string[], name: string, min: number, max: number) {
  const value = option(args, name);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new OperationError("input", `${name} must be an integer from ${min} to ${max}`);
  return number;
}

function numberOption(args: string[], name: string) {
  const value = option(args, name);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new OperationError("input", `${name} must be a non-negative number`);
  return number;
}

/** The saved-keyword list filters shared by `saved list` and `saved export` (OpenSEO's list params). */
function savedFilters(args: string[]): SavedFilters {
  return {
    search: option(args, "--search"),
    includeTerms: listOption(args, "--include"),
    excludeTerms: listOption(args, "--exclude"),
    tagNames: listOption(args, "--tags"),
    minVolume: numberOption(args, "--min-volume"),
    maxVolume: numberOption(args, "--max-volume"),
    minCpc: numberOption(args, "--min-cpc"),
    maxCpc: numberOption(args, "--max-cpc"),
    minDifficulty: numberOption(args, "--min-difficulty"),
    maxDifficulty: numberOption(args, "--max-difficulty"),
    sort: enumOption(args, "--sort", ["createdAt", "keyword", "searchVolume", "cpc", "competition", "keywordDifficulty", "fetchedAt"] as const),
    order: enumOption(args, "--order", ["desc", "asc"] as const),
  };
}

function pickFields(row: unknown, fields: string[]) {
  const source = row as Record<string, unknown>;
  return Object.fromEntries(fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]));
}

/** "LAT,LNG" as two numbers; the ranges are checked by OpenSEO's schemas downstream. */
function coordinateOption(args: string[], name: string) {
  const value = option(args, name);
  if (value === undefined) return undefined;
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part))) throw new OperationError("input", `${name} must be LAT,LNG, for example 40.7128,-74.006`);
  return { latitude: parts[0], longitude: parts[1] };
}

function businessOptions(args: string[]) {
  return { businessName: option(args, "--name"), cid: option(args, "--cid"), placeId: option(args, "--place-id") };
}

/** Remaining positional arguments, after every known option was consumed. */
function positionals(args: string[], what: string, max = Infinity) {
  const unknown = args.find((arg) => arg.startsWith("--"));
  if (unknown) throw new OperationError("input", `Unexpected option ${unknown}\n${usage}`);
  const values = [...new Set(args.map((arg) => arg.trim()).filter(Boolean))];
  if (values.length === 0 || values.length > max) throw new OperationError("input", `Provide 1–${max === Infinity ? "n" : max} ${what}`);
  return values;
}

function enumOption<T extends string>(args: string[], name: string, values: readonly T[]): T | undefined {
  const value = option(args, name);
  if (value === undefined) return undefined;
  if (!values.includes(value as T)) throw new OperationError("input", `${name} must be one of ${values.join(", ")}`);
  return value as T;
}

/** A comma-separated list, e.g. --types organic,paid. */
function listOption(args: string[], name: string) {
  return option(args, name)?.split(",").map((item) => item.trim()).filter(Boolean);
}

/** Every value of a repeatable option, e.g. --filter a --filter b. */
function allOptions(args: string[], name: string) {
  const values: string[] = [];
  for (let value = option(args, name); value !== undefined; value = option(args, name)) values.push(value);
  return values;
}

/** Show a URL in the user's browser; it is printed first, so a missing browser only costs a copy and paste. */
async function openInBrowser(url: string) {
  console.error(`Open this address to authorize AgenticSEO with Google:\n${url}`);
  const [opener, ...openerArgs] = process.platform === "darwin" ? ["open"] : process.platform === "win32" ? ["cmd", "/c", "start", '""'] : ["xdg-open"];
  const child = spawn(opener, [...openerArgs, url], { detached: true, stdio: "ignore" });
  child.on("error", () => console.error("Could not open a browser; open the address above yourself."));
  child.unref();
}

function flag(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index >= 0) args.splice(index, 1);
  return index >= 0;
}

/** Research and SERP commands take exactly one quoted phrase. */
function singlePhrase(args: string[], what: string) {
  if (args.length !== 1 || args[0].startsWith("--") || !args[0].trim()) {
    throw new OperationError("input", `Provide exactly one ${what}; quote it if it has spaces\n${usage}`);
  }
  return args[0].trim();
}

function rejectUnknown(args: string[]) {
  if (args.length) throw new OperationError("input", `Unexpected argument ${args[0]}\n${usage}`);
}

async function run([command, ...args]: string[]): Promise<unknown> {
  const projectOption = option(args, "--project");

  /** The project and the market this call runs in, after any --location/--language override. */
  async function paidCallScope() {
    const root = await findProjectRoot(projectOption);
    const project = await readProject(root);
    return { root, project, market: marketForCall(project, { location: option(args, "--location"), language: option(args, "--language") }) };
  }

  if (command === "init") {
    const domain = option(args, "--domain");
    const market = marketForNewProject(option(args, "--location"), option(args, "--language"));
    rejectUnknown(args);
    return initProject(resolve(projectOption ?? process.cwd()), { domain, ...market });
  }

  if (command === "context") {
    rejectUnknown(args);
    const root = await findProjectRoot(projectOption);
    return { ...(await readContext(root)), reportTemplates: await listTemplates(root) };
  }

  if (command === "reports") {
    rejectUnknown(args);
    return listReports(await findProjectRoot(projectOption));
  }

  if (command === "keywords") {
    const includeClickstreamData = flag(args, "--clickstream");
    const { root, project, market } = await paidCallScope();
    const keywords = [...new Set(args.map((arg) => arg.trim()).filter(Boolean))];
    if (args.some((arg) => arg.startsWith("--")) || keywords.length === 0 || keywords.length > 700) {
      throw new OperationError("input", "Provide 1–700 non-empty keyword terms");
    }
    const fetchedAt = new Date().toISOString();
    const result = await withStore(root, (db) => keywordMetrics(market, keywords, { includeClickstreamData, db }));
    const evidence = await saveEvidence(root, fetchedAt, { provider: "DataForSEO", fetchedAt, project, market, keywords, includeClickstreamData, ...result });
    return {
      provider: "DataForSEO",
      source: result.source,
      fetchedAt,
      market,
      includeClickstreamData,
      totalRows: result.rows.length,
      // Monthly trends stay in the evidence file; they would dominate a short reply.
      rows: result.rows.slice(0, 10).map(({ monthlySearches: _trend, ...row }) => row),
      missingKeywords: result.missingKeywords,
      costUsd: result.costUsd,
      evidence,
    };
  }

  if (command === "research") {
    const limit = Number(option(args, "--limit") ?? 150);
    if (limit !== 150 && limit !== 300 && limit !== 500) throw new OperationError("input", "--limit must be 150, 300 or 500");
    const clickstream = flag(args, "--clickstream");
    const { root, project, market } = await paidCallScope();
    const seed = singlePhrase(args, "seed keyword");
    const fetchedAt = new Date().toISOString();
    const cache = await cacheDirectory(root);
    const result = await withStore(root, (db) => researchKeywords(market, seed, { resultLimit: limit, clickstream, cacheDirectory: cache, db }));
    const evidence = await saveEvidence(root, fetchedAt, { provider: "DataForSEO", fetchedAt, project, market, seed, resultLimit: limit, clickstream, ...result });
    return {
      provider: "DataForSEO",
      source: result.source,
      usedFallback: result.usedFallback,
      cached: result.cached,
      fetchedAt,
      market,
      seed,
      totalRows: result.rows.length,
      // The first rows in provider order; the rest and all monthly trends are in the evidence.
      rows: result.rows.slice(0, 25).map(({ trend: _trend, ...row }) => row),
      costUsd: result.costUsd,
      evidence,
    };
  }

  if (command === "serp") {
    const depth = Number(option(args, "--depth") ?? 20);
    if (!Number.isInteger(depth) || depth < 10 || depth > 100 || depth % 10 !== 0) {
      throw new OperationError("input", "--depth must be a multiple of 10 from 10 to 100");
    }
    const { root, project, market } = await paidCallScope();
    const query = singlePhrase(args, "search query");
    const fetchedAt = new Date().toISOString();
    const result = await serpResults(market, query, depth);
    const evidence = await saveEvidence(root, fetchedAt, { provider: "DataForSEO", fetchedAt, project, market, query, depth, ...result });
    return { provider: "DataForSEO", fetchedAt, market, query, depth, totalItems: result.items.length, items: result.items, costUsd: result.costUsd, evidence };
  }

  if (command === "domain") {
    const scope = enumOption<ResearchScope>(args, "--scope", RESEARCH_SCOPES);
    const { root, project, market } = await paidCallScope();
    const target = singlePhrase(args, "domain or URL");
    const result = await domainOverview(market, { target, scope, cacheDirectory: await cacheDirectory(root) });
    // result.fetchedAt is when DataForSEO produced the data, which predates now on a cache hit.
    const evidence = await saveEvidence(root, new Date().toISOString(), { provider: "DataForSEO", project, market, target, ...result });
    const { calls: _calls, ...summary } = result;
    return { provider: "DataForSEO", market, ...summary, evidence };
  }

  if (command === "ranked") {
    const input = {
      scope: enumOption<ResearchScope>(args, "--scope", RESEARCH_SCOPES),
      sortBy: enumOption(args, "--sort", ["rank", "search_volume", "traffic_estimate", "cpc"] as const),
      minSearchVolume: intOption(args, "--min-volume", 0, Number.MAX_SAFE_INTEGER),
      maxRank: intOption(args, "--max-rank", 1, 100),
      excludeBrandTerms: listOption(args, "--exclude"),
      resultTypes: listOption(args, "--types"),
      limit: intOption(args, "--limit", 1, 100) ?? 50,
      offset: intOption(args, "--offset", 0, 1000),
    };
    const { root, project, market } = await paidCallScope();
    const target = singlePhrase(args, "domain or URL");
    const fetchedAt = new Date().toISOString();
    const result = await rankedKeywords(market, { target, ...input });
    const evidence = await saveEvidence(root, fetchedAt, { provider: "DataForSEO", fetchedAt, project, market, request: { target, ...input }, ...result });
    const { calls: _calls, ...summary } = result;
    return { provider: "DataForSEO", fetchedAt, market, ...summary, evidence };
  }

  if (command === "pages") {
    const pageSize = Number(option(args, "--page-size") ?? 100);
    if (pageSize !== 50 && pageSize !== 100 && pageSize !== 200) throw new OperationError("input", "--page-size must be 50, 100 or 200");
    const input = {
      scope: enumOption<ResearchScope>(args, "--scope", RESEARCH_SCOPES),
      sortMode: enumOption(args, "--sort", ["traffic", "keywords"] as const) ?? "traffic",
      sortOrder: enumOption(args, "--order", ["desc", "asc"] as const) ?? "desc",
      page: intOption(args, "--page", 1, 1000) ?? 1,
      pageSize: pageSize as 50 | 100 | 200,
      // OpenSEO's pages view reuses the keyword filter fields: minVol/maxVol bound a page's keyword count.
      filters: {
        include: option(args, "--include"),
        exclude: option(args, "--exclude"),
        minTraffic: intOption(args, "--min-traffic", 0, Number.MAX_SAFE_INTEGER),
        maxTraffic: intOption(args, "--max-traffic", 0, Number.MAX_SAFE_INTEGER),
        minVol: intOption(args, "--min-keywords", 0, Number.MAX_SAFE_INTEGER),
        maxVol: intOption(args, "--max-keywords", 0, Number.MAX_SAFE_INTEGER),
      },
    };
    const { root, project, market } = await paidCallScope();
    const target = singlePhrase(args, "domain or URL");
    const result = await domainPages(market, { target, ...input, cacheDirectory: await cacheDirectory(root) });
    const evidence = await saveEvidence(root, new Date().toISOString(), { provider: "DataForSEO", project, market, request: { target, ...input }, ...result });
    const { calls: _calls, ...summary } = result;
    return { provider: "DataForSEO", market, ...summary, evidence };
  }

  if (command === "competitors") {
    const input = {
      resultTypes: listOption(args, "--types"),
      excludeDomains: listOption(args, "--exclude-domains"),
      includeSubdomains: flag(args, "--include-subdomains") || undefined,
      sortBy: enumOption(args, "--sort", ["visibility", "traffic_estimate", "avg_position", "keyword_count"] as const),
      limit: intOption(args, "--limit", 1, 100) ?? 50,
      offset: intOption(args, "--offset", 0, 1000),
    };
    const { root, project, market } = await paidCallScope();
    if (args.some((arg) => arg.startsWith("--"))) throw new OperationError("input", `Unexpected option ${args.find((arg) => arg.startsWith("--"))}\n${usage}`);
    const keywords = [...new Set(args.map((arg) => arg.trim()).filter(Boolean))];
    const fetchedAt = new Date().toISOString();
    const result = await serpCompetitors(market, { keywords, ...input });
    const evidence = await saveEvidence(root, fetchedAt, { provider: "DataForSEO", fetchedAt, project, market, request: { keywords, ...input }, ...result });
    const { calls: _calls, ...summary } = result;
    return { provider: "DataForSEO", fetchedAt, market, keywords: keywords.length, ...summary, evidence };
  }

  if (command === "saved") {
    const action = args.shift();
    if (action === "add") {
      const tags = listOption(args, "--tags");
      const replaceTags = flag(args, "--replace-tags");
      if (tags && (tags.length > 20 || tags.some((tag) => tag.length > 64))) throw new OperationError("input", "--tags takes up to 20 tags of at most 64 characters");
      const { root, market } = await paidCallScope();
      return saveCommand(root, market, { keywords: positionals(args, "keywords", 100), tags, replaceTags });
    }
    if (action === "list") {
      const filters = savedFilters(args);
      const page = intOption(args, "--page", 1, Number.MAX_SAFE_INTEGER) ?? 1;
      const pageSize = Number(option(args, "--page-size") ?? 100);
      if (pageSize !== 50 && pageSize !== 100 && pageSize !== 250) throw new OperationError("input", "--page-size must be 50, 100 or 250");
      rejectUnknown(args);
      return listCommand(await findProjectRoot(projectOption), { ...filters, page, pageSize });
    }
    if (action === "export") {
      const filters = savedFilters(args);
      const format = enumOption(args, "--format", ["csv", "jsonl"] as const) ?? "csv";
      const out = option(args, "--out");
      rejectUnknown(args);
      return exportCommand(await findProjectRoot(projectOption), { ...filters, format, out });
    }
    if (action === "remove") return removeCommand(await findProjectRoot(projectOption), positionals(args, "saved keyword ids"));
    if (action === "tag") {
      const add = listOption(args, "--add");
      const remove = listOption(args, "--remove");
      if (!add && !remove) throw new OperationError("input", "Pass --add TAG,... and/or --remove TAG,...");
      return tagCommand(await findProjectRoot(projectOption), { ids: positionals(args, "saved keyword ids"), add, remove });
    }
    if (action === "rename-tag") {
      const to = option(args, "--to");
      const color = option(args, "--color");
      const [name] = positionals(args, "tag name", 1);
      return renameTagCommand(await findProjectRoot(projectOption), { name, to, color });
    }
    if (action === "delete-tag") {
      const [name] = positionals(args, "tag name", 1);
      return deleteTagCommand(await findProjectRoot(projectOption), name);
    }
    if (action === "refresh") {
      rejectUnknown(args);
      const root = await findProjectRoot(projectOption);
      const project = await readProject(root);
      const fetchedAt = new Date().toISOString();
      const result = await refreshCommand(root);
      const evidence = await saveEvidence(root, fetchedAt, { provider: "DataForSEO", fetchedAt, project, ...result });
      return { provider: "DataForSEO", fetchedAt, updated: result.updated, costUsd: result.costUsd, evidence };
    }
    throw new OperationError("input", usage);
  }

  if (command === "backlinks") {
    const view = args.shift();
    if (view !== "overview" && view !== "links" && view !== "domains" && view !== "pages") throw new OperationError("input", usage);
    const scope = enumOption<ResearchScope>(args, "--scope", RESEARCH_SCOPES);
    // OpenSEO's MCP tools drop spammy referring domains by default; the web app shows them.
    const hideSpam = view === "pages" ? undefined : !flag(args, "--include-spam");
    const page = intOption(args, "--page", 1, Number.MAX_SAFE_INTEGER) ?? 1;
    const pageSize = Number(option(args, "--page-size") ?? 100);
    if (pageSize !== 50 && pageSize !== 100 && pageSize !== 200) throw new OperationError("input", "--page-size must be 50, 100 or 200");
    const sortOrder = enumOption(args, "--order", ["desc", "asc"] as const) ?? "desc";
    const range = (name: string) => numberOption(args, name);
    const text = { include: option(args, "--include"), exclude: option(args, "--exclude") };
    const list = { page, pageSize, sortOrder };
    const root = await findProjectRoot(projectOption);
    const project = await readProject(root);
    const cacheDir = await cacheDirectory(root);
    let result: { calls: unknown[]; cached: boolean; costUsd: number };
    let summary: Record<string, unknown>;
    if (view === "overview") {
      const target = singlePhrase(args, "domain or URL");
      const overview = await backlinksOverview({ target, scope, hideSpam: hideSpam ?? true, cacheDirectory: cacheDir });
      result = overview;
      const { displayTarget, scope: resolved, summary: totals, trends, fetchedAt } = overview.overview;
      summary = {
        target: displayTarget, scope: resolved, scopeNote: overview.scopeNote, fetchedAt, summary: totals, trends,
        // The first rows in the MCP tool's order; all 100 are in the evidence.
        referringDomains: overview.referringDomains && { totalCount: overview.referringDomains.totalCount, rows: overview.referringDomains.rows.slice(0, 25) },
      };
    } else if (view === "links") {
      const input = {
        ...list, scope, hideSpam: hideSpam ?? true,
        sortField: enumOption(args, "--sort", ["rank", "domainRank", "spamScore", "firstSeen"] as const) ?? "firstSeen",
        mode: enumOption(args, "--mode", ["one_per_domain", "as_is"] as const) ?? "one_per_domain",
        filters: {
          ...text,
          minDomainRank: range("--min-domain-rank"), maxDomainRank: range("--max-domain-rank"),
          minLinkAuthority: range("--min-authority"), maxLinkAuthority: range("--max-authority"),
          minSpamScore: range("--min-spam"), maxSpamScore: range("--max-spam"),
          linkType: enumOption(args, "--link-type", ["dofollow", "nofollow"] as const),
          hideLost: flag(args, "--hide-lost") || undefined,
          hideBroken: flag(args, "--hide-broken") || undefined,
          domainFrom: option(args, "--from-domain"),
        },
      };
      const links = await backlinksLinks({ target: singlePhrase(args, "domain or URL"), ...input, cacheDirectory: cacheDir });
      result = links;
      const { calls: _calls, cached: _cached, costUsd: _cost, rows, ...rest } = links;
      // The MCP tool's columns; every field of every row is in the evidence.
      summary = { ...rest, rows: rows.map(({ urlFrom, urlTo, anchor, isDofollow, rank, domainFromRank, spamScore, isLost, isBroken, firstSeen }) => ({ urlFrom, urlTo, anchor, isDofollow, rank, domainFromRank, spamScore, isLost, isBroken, firstSeen })) };
    } else if (view === "domains") {
      const input = {
        ...list, scope, hideSpam: hideSpam ?? true,
        sortField: enumOption(args, "--sort", ["domain", "backlinks", "referringPages", "rank", "spamScore", "firstSeen", "brokenBacklinks"] as const) ?? "backlinks",
        filters: {
          ...text,
          minBacklinks: range("--min-backlinks"), maxBacklinks: range("--max-backlinks"),
          minRank: range("--min-rank"), maxRank: range("--max-rank"),
          minSpamScore: range("--min-spam"), maxSpamScore: range("--max-spam"),
        },
      };
      const domains = await backlinksDomains({ target: singlePhrase(args, "domain or URL"), ...input, cacheDirectory: cacheDir });
      result = domains;
      const { calls: _calls, cached: _cached, costUsd: _cost, ...rest } = domains;
      summary = rest;
    } else {
      const input = {
        ...list, scope,
        sortField: enumOption(args, "--sort", ["backlinks", "referringDomains", "rank", "brokenBacklinks"] as const) ?? "backlinks",
        filters: {
          ...text,
          minBacklinks: range("--min-backlinks"), maxBacklinks: range("--max-backlinks"),
          minReferringDomains: range("--min-referring-domains"), maxReferringDomains: range("--max-referring-domains"),
          minRank: range("--min-rank"), maxRank: range("--max-rank"),
        },
      };
      const pages = await backlinksPages({ target: singlePhrase(args, "domain or URL"), ...input, cacheDirectory: cacheDir });
      result = pages;
      const { calls: _calls, cached: _cached, costUsd: _cost, ...rest } = pages;
      summary = rest;
    }
    const evidence = await saveEvidence(root, new Date().toISOString(), { provider: "DataForSEO", view, project, ...result });
    return { provider: "DataForSEO", view, ...summary, cached: result.cached, costUsd: result.costUsd, evidence };
  }

  if (command === "domain-rating") {
    const domains = positionals(args, "domains", 100);
    // Ahrefs' Domain Rating License requires this attribution wherever the numbers appear.
    return { provider: "Ahrefs", attribution: "Domain Rating by Ahrefs", ...(await domainRatings(domains, await cacheDirectory(await findProjectRoot(projectOption)))) };
  }

  if (command === "local") {
    const action = args.shift();
    const root = await findProjectRoot(projectOption);
    const project = await readProject(root);
    let result: { costUsd: number; calls: unknown[] } & Record<string, unknown>;
    if (action === "categories") {
      const limit = intOption(args, "--limit", 1, 200) ?? 50;
      const query = args.length === 0 ? undefined : singlePhrase(args, "category search text");
      // Free at DataForSEO and cached for a week, so no evidence record.
      return { provider: "DataForSEO", ...(await localCategories({ query, limit, cacheDirectory: await cacheDirectory(root) })) };
    }
    if (action === "businesses") {
      const near = coordinateOption(args, "--near");
      const radiusKm = numberOption(args, "--radius");
      if (!near || radiusKm === undefined) throw new OperationError("input", "--near LAT,LNG and --radius KM are required");
      const claimed = flag(args, "--claimed");
      const unclaimed = flag(args, "--unclaimed");
      if (claimed && unclaimed) throw new OperationError("input", "Pass --claimed or --unclaimed, not both");
      const input = {
        near: { ...near, radiusKm },
        query: option(args, "--query"),
        categories: listOption(args, "--categories"),
        minRating: numberOption(args, "--min-rating"),
        minReviews: intOption(args, "--min-reviews", 0, Number.MAX_SAFE_INTEGER),
        isClaimed: claimed ? true : unclaimed ? false : undefined,
        sortBy: enumOption(args, "--sort", ["relevance", "rating", "reviews"] as const),
        limit: intOption(args, "--limit", 1, 50) ?? 20,
        offset: intOption(args, "--offset", 0, 1000),
      };
      rejectUnknown(args);
      result = { request: input, ...(await localBusinesses(input)) };
    } else if (action === "serp") {
      const near = coordinateOption(args, "--near");
      if (!near) throw new OperationError("input", "--near LAT,LNG is required");
      const input = {
        near: { ...near, zoom: intOption(args, "--zoom", 4, 18) },
        searchType: enumOption(args, "--type", ["maps", "local_finder"] as const) ?? "maps",
        device: enumOption(args, "--device", ["mobile", "desktop"] as const) ?? "mobile",
        depth: intOption(args, "--depth", 1, 100) ?? 20,
        languageCode: languageForCall(project, option(args, "--language")),
      };
      const keyword = singlePhrase(args, "search query");
      result = { request: { keyword, ...input }, ...(await localSerp({ keyword, ...input })) };
    } else if (action === "profile") {
      const near = coordinateOption(args, "--near");
      const radiusKm = numberOption(args, "--radius");
      if (radiusKm !== undefined && !near) throw new OperationError("input", "--radius needs --near");
      const business = businessOptions(args);
      const market = marketForCall(project, { location: option(args, "--location"), language: option(args, "--language") });
      rejectUnknown(args);
      const profileResult = await localProfile({ ...business, near: near && { ...near, radiusKm }, ...market });
      const profile = profileResult.profile;
      // The fields OpenSEO's get_business_profile prints; the full record is in the evidence.
      const fields = ["title", "category", "additional_categories", "rating", "rating_distribution", "address", "phone", "url", "domain", "is_claimed", "work_time", "total_photos", "cid", "place_id", "check_url"];
      result = { ...profileResult, request: { ...business, near, radiusKm, market }, found: profile != null, profileSummary: profile && Object.fromEntries(fields.filter((field) => field in profile).map((field) => [field, profile[field]])) };
    } else if (action === "reviews" || action === "posts") {
      const taskId = option(args, "--task-id");
      const near = coordinateOption(args, "--near");
      const radiusKm = numberOption(args, "--radius");
      if (radiusKm !== undefined && !near) throw new OperationError("input", "--radius needs --near");
      const business = businessOptions(args);
      const market = marketForCall(project, { location: option(args, "--location"), language: option(args, "--language") });
      const common = { ...business, near: near && { ...near, radiusKm }, ...market, taskId };
      if (action === "reviews") {
        const input = {
          ...common,
          depth: intOption(args, "--depth", 10, 200) ?? 20,
          sortBy: enumOption(args, "--sort", ["newest", "highest_rating", "lowest_rating", "relevant"] as const) ?? "newest",
          includeOtherSources: flag(args, "--other-sources"),
        };
        rejectUnknown(args);
        result = { request: input, ...(await localReviews(input)) };
      } else {
        const input = { ...common, depth: intOption(args, "--depth", 10, 100) ?? 10 };
        rejectUnknown(args);
        result = { request: input, ...(await localPosts(input)) };
      }
    } else if (action === "questions") {
      const near = coordinateOption(args, "--near");
      const radiusKm = numberOption(args, "--radius");
      if (!near || radiusKm === undefined) throw new OperationError("input", "--near LAT,LNG and --radius KM are required");
      const input = { ...businessOptions(args), near: { ...near, radiusKm }, depth: intOption(args, "--depth", 1, 100) ?? 20, languageCode: languageForCall(project, option(args, "--language")) };
      rejectUnknown(args);
      result = { request: input, ...(await localQuestions(input)) };
    } else if (action === "grid") {
      const center = coordinateOption(args, "--center");
      if (!center) throw new OperationError("input", "--center LAT,LNG is required");
      const size = option(args, "--size");
      if (size !== undefined && size !== "3" && size !== "5") throw new OperationError("input", "--size must be 3 or 5");
      const input = {
        center,
        target: { cid: option(args, "--cid"), placeId: option(args, "--place-id"), name: option(args, "--name") },
        gridSize: size === undefined ? undefined : (Number(size) as 3 | 5),
        spacingKm: numberOption(args, "--spacing"),
        zoom: intOption(args, "--zoom", 4, 18),
        device: enumOption(args, "--device", ["mobile", "desktop"] as const),
        languageCode: languageForCall(project, option(args, "--language")),
      };
      const keyword = singlePhrase(args, "search query");
      result = { request: { keyword, ...input }, ...(await localRankGrid({ keyword, ...input })) };
    } else {
      throw new OperationError("input", usage);
    }
    const fetchedAt = new Date().toISOString();
    const evidence = await saveEvidence(root, fetchedAt, { provider: "DataForSEO", fetchedAt, view: `local ${action}`, project, ...result });
    const { calls: _calls, profile: _fullProfile, ...summary } = result;
    // Upstream's MCP text shows these views as short tables; the allowlisted rows
    // (hours, rating distributions, original-language review text) stay in the evidence.
    if (Array.isArray(summary.results)) summary.results = summary.results.map((row) => pickFields(row, ["rank_absolute", "rank_group", "title", "domain", "url", "category", "rating", "phone", "address", "is_claimed", "cid", "place_id", "latitude", "longitude"]));
    if (Array.isArray(summary.reviews)) summary.reviews = summary.reviews.map((row) => pickFields(row, ["rank_absolute", "timestamp", "rating", "profile_name", "source", "review_text", "owner_answer"]));
    return { provider: "DataForSEO", fetchedAt, view: `local ${action}`, ...summary, evidence };
  }

  if (command === "audit") {
    const [action, ...rest] = args;
    args = rest;
    const root = await findProjectRoot(projectOption);
    if (action === "start") {
      const input = {
        maxPages: intOption(args, "--max-pages", MIN_AUDIT_PAGES, PAID_MAX_AUDIT_PAGES) ?? DEFAULT_AUDIT_PAGES,
        allowPrivate: flag(args, "--allow-private"),
        lighthouse: flag(args, "--lighthouse"),
        wait: flag(args, "--wait"),
      };
      const url = args.length ? positionals(args, "start URL", 1)[0] : undefined;
      return startAudit(root, { ...input, url });
    }
    if (action === "status") {
      const id = args.length ? positionals(args, "audit id", 1)[0] : undefined;
      return auditStatus(root, id);
    }
    if (action === "resume") {
      const wait = flag(args, "--wait");
      return resumeAudit(root, positionals(args, "audit id", 1)[0], wait);
    }
    if (action === "issues") {
      const input = {
        severity: enumOption(args, "--severity", ["critical", "warning", "info"] as const),
        issueType: option(args, "--type"),
        limit: intOption(args, "--limit", 1, 1000) ?? 200,
      };
      const auditId = args.length ? positionals(args, "audit id", 1)[0] : undefined;
      return auditIssues(root, { ...input, auditId });
    }
    if (action === "pages") {
      const input = {
        fetchClass: enumOption(args, "--fetch-class", PAGE_FETCH_CLASSES),
        statusCode: intOption(args, "--status", 0, 999),
        urlContains: option(args, "--url-contains"),
        limit: intOption(args, "--limit", 1, 1000) ?? 100,
      };
      const auditId = args.length ? positionals(args, "audit id", 1)[0] : undefined;
      return auditPages(root, { ...input, auditId });
    }
    if (action === "export") {
      const input = {
        table: enumOption(args, "--table", ["issues", "pages", "performance"] as const) ?? "issues",
        format: enumOption(args, "--format", ["csv", "jsonl"] as const) ?? "csv",
        out: option(args, "--out"),
      };
      const auditId = args.length ? positionals(args, "audit id", 1)[0] : undefined;
      return exportAudit(root, { ...input, auditId });
    }
    if (action === "lighthouse") {
      const resultId = option(args, "--result");
      const category = enumOption(args, "--category", LIGHTHOUSE_CATEGORIES);
      const auditId = args.length ? positionals(args, "audit id", 1)[0] : undefined;
      if (resultId) return lighthouseIssues(root, { auditId, resultId, category });
      if (category) throw new OperationError("input", "--category needs --result");
      return lighthouseResults(root, auditId);
    }
    if (action === "list") {
      rejectUnknown(args);
      return listAudits(root);
    }
    if (action === "delete") {
      return deleteAudit(root, positionals(args, "audit id", 1)[0]);
    }
    // The detached worker `audit start` and `audit resume` launch; not for direct use.
    if (action === "_run") {
      const [id, token] = positionals(args, "audit id and worker token", 2);
      await runAuditWorker(root, id, token);
      return auditStatus(root, id);
    }
    throw new OperationError("input", usage);
  }

  if (command === "rank") {
    const [action, ...rest] = args;
    args = rest;
    const root = await findProjectRoot(projectOption);
    const settings = () => {
      const depth = intOption(args, "--depth", 10, 100);
      if (depth !== undefined && depth % 10 !== 0) throw new OperationError("input", "--depth must be a multiple of 10");
      return {
        devices: enumOption(args, "--devices", ["mobile", "desktop", "both"] as const),
        serpDepth: depth,
        scheduleInterval: enumOption(args, "--schedule", ["manual", "daily", "weekly", "monthly"] as const),
      };
    };
    const trackerId = () => {
      const id = args.shift();
      if (!id || id.startsWith("--")) throw new OperationError("input", `Provide a tracker id (see agenticseo rank list)\n${usage}`);
      return id;
    };
    if (action === "create") {
      const project = await readProject(root);
      const market = serpMarketForCall(project, { location: option(args, "--location"), language: option(args, "--language") });
      const input = { ...market, locationName: option(args, "--location-name"), ...settings() };
      const domain = args.length ? positionals(args, "domain", 1)[0] : project.domain;
      return createTracker(root, { ...input, domain });
    }
    if (action === "update") {
      const id = trackerId();
      const project = await readProject(root);
      const location = option(args, "--location");
      const language = option(args, "--language");
      const locationName = option(args, "--location-name");
      const market = location || language ? serpMarketForCall(project, { location, language }) : {};
      const input = { domain: option(args, "--domain"), ...market, locationName: locationName === "none" ? null : locationName, ...settings() };
      rejectUnknown(args);
      return updateTracker(root, id, input);
    }
    if (action === "list") {
      rejectUnknown(args);
      return listTrackers(root);
    }
    if (action === "show") {
      const id = trackerId();
      const compare = enumOption(args, "--compare", ["1d", "7d", "30d", "90d"] as const);
      rejectUnknown(args);
      return showTracker(root, id, compare);
    }
    if (action === "archive") {
      const id = trackerId();
      rejectUnknown(args);
      return updateTracker(root, id, { isActive: false });
    }
    if (action === "run") {
      const id = trackerId();
      const keywordIds = listOption(args, "--keywords");
      rejectUnknown(args);
      return runTracker(root, id, keywordIds);
    }
    if (action === "history") {
      const id = trackerId();
      const sinceDays = intOption(args, "--days", 1, 730) ?? 365;
      return trackerHistory(root, id, positionals(args, "keyword id", 1)[0], sinceDays);
    }
    if (action === "trend") {
      const id = trackerId();
      const input = { device: enumOption(args, "--device", ["mobile", "desktop"] as const), sinceDays: intOption(args, "--days", 1, 730) ?? 365 };
      rejectUnknown(args);
      return trackerTrend(root, id, input);
    }
    if (action === "matrix") {
      const id = trackerId();
      const input = { device: enumOption(args, "--device", ["mobile", "desktop"] as const), runLimit: intOption(args, "--runs", 1, 26) ?? 12 };
      rejectUnknown(args);
      return trackerMatrix(root, id, input);
    }
    if (action === "due" || action === "schedule") {
      rejectUnknown(args);
      return action === "due" ? rankDue(root) : scheduleLine(root);
    }
    if (action === "metrics") {
      const id = trackerId();
      rejectUnknown(args);
      return refreshTrackerMetrics(root, id);
    }
    if (action === "add") {
      const id = trackerId();
      const matchCase = flag(args, "--match-case");
      return addTrackerKeywords(root, id, positionals(args, "keywords", MAX_KEYWORDS_PER_CONFIG), matchCase);
    }
    if (action === "remove") {
      const id = trackerId();
      return removeTrackerKeywords(root, id, positionals(args, "keyword ids", MAX_KEYWORDS_PER_CONFIG));
    }
    if (action === "estimate") {
      const id = trackerId();
      const additional = intOption(args, "--add", 0, MAX_KEYWORDS_PER_CONFIG) ?? 0;
      rejectUnknown(args);
      return estimateTracker(root, id, additional);
    }
    if (action === "locations") {
      const project = await readProject(root);
      const country = countryForCall(project, option(args, "--location"));
      return searchLocations(root, singlePhrase(args, "place name"), country);
    }
    throw new OperationError("input", usage);
  }

  if (command === "ai") {
    const [action, ...rest] = args;
    args = rest;
    const { root, project, market } = await paidCallScope();
    const cache = await cacheDirectory(root);
    if (action === "brand") {
      const input = { competitors: listOption(args, "--competitors"), scope: option(args, "--scope") };
      const query = singlePhrase(args, "brand name or domain");
      const result = await brandLookup(market, { ...input, query, cacheDirectory: cache });
      const evidence = await saveEvidence(root, new Date().toISOString(), { provider: "DataForSEO", view: "ai brand", project, market, ...result });
      const { calls: _calls, topQueries, topPages, ...summary } = result;
      // Cited-source URLs and titles and every prompt behind a page stay in the evidence.
      return {
        provider: "DataForSEO",
        market,
        ...summary,
        topQueries: topQueries.map(({ citedSources, firstSeenAt: _first, ...query }) => ({ ...query, citedDomains: [...new Set(citedSources.map((source) => source.domain))] })),
        topPages: topPages.map(({ keywords, ...page }) => ({ ...page, keywordCount: keywords.length, exampleQuestions: keywords.slice(0, 3).map((keyword) => keyword.question) })),
        evidence,
      };
    }
    if (action === "prompt") {
      const input = {
        models: listOption(args, "--models") ?? ["chat_gpt", "claude", "gemini", "perplexity"],
        highlightBrand: option(args, "--brand"),
        webSearch: !flag(args, "--no-web-search"),
        webSearchCountryCode: option(args, "--web-country")?.toUpperCase(),
      };
      const prompt = singlePhrase(args, "prompt");
      const result = await promptLookup({ ...input, prompt, cacheDirectory: cache });
      const evidence = await saveEvidence(root, new Date().toISOString(), { provider: "DataForSEO", view: "ai prompt", project, ...result });
      const { calls: _calls, results, ...summary } = result;
      // Full answers and citation titles stay in the evidence.
      const answerPreview = 1500;
      return {
        provider: "DataForSEO",
        ...summary,
        results: results.map((answer) =>
          answer.status === "success"
            ? {
                ...answer,
                text: answer.text.slice(0, answerPreview),
                textLength: answer.text.length,
                citations: answer.citations.map(({ title: _title, ...citation }) => citation),
              }
            : answer,
        ),
        evidence,
      };
    }
    throw new OperationError("input", usage);
  }

  if (command === "google") {
    const [action, ...rest] = args;
    args = rest;
    if (action === "connect") {
      const target = enumOption(args, "--for", ["search-console", "analytics", "all"] as const) ?? "all";
      rejectUnknown(args);
      const products: GoogleProduct[] = target === "all" ? ["searchConsole", "analytics"] : [target === "search-console" ? "searchConsole" : "analytics"];
      return connectGoogle({ products, openUrl: openInBrowser });
    }
    if (action === "accounts") {
      rejectUnknown(args);
      return { accounts: await listGoogleAccounts() };
    }
    if (action === "disconnect") return disconnectGoogle(positionals(args, "account email or id", 1)[0]);
    throw new OperationError("input", usage);
  }

  if (command === "gsc") {
    const [action, ...rest] = args;
    args = rest;
    const root = await findProjectRoot(projectOption);
    const reportFilters = () => ({
      dateRange: enumOption(args, "--range", ["last_7_days", "last_28_days", "last_3_months"] as const) ?? "last_28_days",
      device: enumOption(args, "--device", ["DESKTOP", "MOBILE", "TABLET"] as const),
      country: option(args, "--country"),
    });
    if (action === "sites") {
      rejectUnknown(args);
      return searchConsoleSites();
    }
    if (action === "use") {
      const account = option(args, "--account");
      return useSearchConsoleSite(root, { siteUrl: positionals(args, "site URL", 1)[0], account });
    }
    if (action === "disconnect") {
      rejectUnknown(args);
      return disconnectSearchConsole(root);
    }
    if (action === "performance") {
      const filters = allOptions(args, "--filter").map((value) => {
        const [dimension, operator, ...expression] = value.split(":");
        if (!GSC_DIMENSIONS.includes(dimension as GscDimension) || !GSC_FILTER_OPERATORS.includes(operator as (typeof GSC_FILTER_OPERATORS)[number]) || expression.length === 0) {
          throw new OperationError("input", `--filter must be DIMENSION:OPERATOR:EXPRESSION with a dimension in ${GSC_DIMENSIONS.join(", ")} and an operator in ${GSC_FILTER_OPERATORS.join(", ")}`);
        }
        return { dimension: dimension as GscDimension, operator: operator as (typeof GSC_FILTER_OPERATORS)[number], expression: expression.join(":") };
      });
      const dimensions = listOption(args, "--dimensions");
      const unknownDimension = dimensions?.find((dimension) => !GSC_DIMENSIONS.includes(dimension as GscDimension));
      if (unknownDimension) throw new OperationError("input", `Unknown dimension ${unknownDimension}; use ${GSC_DIMENSIONS.join(", ")}`);
      const date = (name: string) => {
        const value = option(args, name);
        if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new OperationError("input", `${name} must be YYYY-MM-DD`);
        return value;
      };
      const input = {
        dimensions: dimensions as GscDimension[] | undefined,
        dateRange: enumOption(args, "--range", GSC_DATE_RANGES),
        startDate: date("--start"),
        endDate: date("--end"),
        filters: filters.length > 0 ? filters : undefined,
        rowLimit: intOption(args, "--limit", 1, GSC_MAX_ROW_LIMIT),
        startRow: intOption(args, "--start-row", 0, 1_000_000),
        minPosition: numberOption(args, "--min-position"),
        maxPosition: numberOption(args, "--max-position"),
        minImpressions: intOption(args, "--min-impressions", 0, Number.MAX_SAFE_INTEGER),
        type: enumOption(args, "--type", GSC_SEARCH_TYPES),
        dataState: enumOption(args, "--data-state", ["all", "final"] as const),
      };
      rejectUnknown(args);
      return searchConsolePerformance(root, input);
    }
    if (action === "report") {
      const input = reportFilters();
      rejectUnknown(args);
      return searchConsoleReport(root, input);
    }
    if (action === "export") {
      const input = {
        ...reportFilters(),
        dimension: enumOption(args, "--dimension", ["query", "page"] as const) ?? "query",
        format: enumOption(args, "--format", ["csv", "jsonl"] as const) ?? "csv",
        out: option(args, "--out"),
      };
      rejectUnknown(args);
      return exportSearchConsole(root, input);
    }
    if (action === "inspect") {
      const languageCode = option(args, "--language");
      return searchConsoleInspect(root, { urls: positionals(args, "URLs", 10), languageCode });
    }
    throw new OperationError("input", usage);
  }

  if (command === "ga4") {
    const [action, ...rest] = args;
    args = rest;
    const dates = () => {
      const read = (name: string) => {
        const value = option(args, name);
        if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new OperationError("input", `${name} must be YYYY-MM-DD`);
        return value;
      };
      return { startDate: read("--start"), endDate: read("--end") };
    };
    if (action === "properties") {
      rejectUnknown(args);
      return analyticsProperties();
    }
    const root = await findProjectRoot(projectOption);
    if (action === "use") {
      const account = option(args, "--account");
      return useAnalyticsProperty(root, { propertyId: positionals(args, "property id", 1)[0], account });
    }
    if (action === "disconnect") {
      rejectUnknown(args);
      return disconnectAnalytics(root);
    }
    if (action === "report") {
      const [report, ...reportArgs] = args;
      args = reportArgs;
      if (!GA4_REPORTS.includes(report as Ga4Report)) throw new OperationError("input", `Report must be one of ${GA4_REPORTS.join(", ")}`);
      const options = {
        ...dates(),
        limit: intOption(args, "--limit", 1, 1000),
        offset: intOption(args, "--offset", 0, Number.MAX_SAFE_INTEGER),
        channel: enumOption(args, "--channel", ["organic_search", "all"] as const),
        breakdown: option(args, "--breakdown"),
        compare: flag(args, "--compare") || undefined,
        includeDate: flag(args, "--include-date") || undefined,
        onlyWithTransactions: flag(args, "--only-with-transactions") || undefined,
      };
      rejectUnknown(args);
      return analyticsReport(root, report as Ga4Report, options);
    }
    if (action === "overview") {
      const input = { ...dates(), trend: enumOption(args, "--trend", ["daily", "weekly"] as const) };
      rejectUnknown(args);
      return analyticsOverview(root, input);
    }
    if (action === "health") {
      rejectUnknown(args);
      return analyticsHealth(root);
    }
    if (action === "opportunities") {
      const input = { ...dates(), limit: intOption(args, "--limit", 1, 100) };
      rejectUnknown(args);
      return searchOpportunities(root, input);
    }
    throw new OperationError("input", usage);
  }

  if (command === "query") {
    const [sql] = positionals(args, "SQL statement", 1);
    return queryStore(await findProjectRoot(projectOption), sql);
  }

  throw new OperationError("input", usage);
}

const argv = process.argv.slice(2);
// Asking for help is not an error, before or after a subcommand: print the usage and exit 0.
if (argv.length === 0 || argv[0] === "help" || argv.some((arg) => arg === "--help" || arg === "-h")) {
  console.log(usage);
  process.exit(0);
}

run(argv).then(
  (result) => console.log(JSON.stringify(result)),
  (error: unknown) => {
    if (error instanceof OperationError) {
      console.error(error.message);
      // A provider's own explanation (e.g. DataForSEO's reason for an HTTP 402) is kept in
      // the error details; without it the agent sees only the status code.
      const responseBody = error instanceof AppError ? error.details?.responseBody : undefined;
      if (responseBody) console.error(`Provider response: ${responseBody}`);
      process.exitCode = exitCodes[error.kind];
      return;
    }
    // Anything else is a bug or an unexpected system failure; keep the stack for diagnosis.
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  },
);
