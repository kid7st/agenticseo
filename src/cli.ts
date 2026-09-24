#!/usr/bin/env node
import { resolve } from "node:path";
import { OperationError } from "./errors.js";
import { backlinksDomains, backlinksLinks, backlinksOverview, backlinksPages, domainRatings } from "./backlinks.js";
import { domainOverview, domainPages, rankedKeywords, serpCompetitors } from "./domain.js";
import { keywordMetrics, researchKeywords, serpResults } from "./keywords.js";
import { localBusinesses, localCategories, localProfile, localQuestions, localRankGrid, localSerp } from "./local.js";
import { languageForCall, marketForCall, marketForNewProject } from "./market.js";
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
BUSINESS is one of --name TEXT, --cid ID or --place-id ID; TARGET is any of --cid, --place-id or --name
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
    const result = await keywordMetrics(market, keywords, { includeClickstreamData });
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
      return localCategories({ query, limit, cacheDirectory: await cacheDirectory(root) });
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
    return { provider: "DataForSEO", fetchedAt, view: `local ${action}`, ...summary, evidence };
  }

  if (command === "query") {
    const [sql] = positionals(args, "SQL statement", 1);
    return queryStore(await findProjectRoot(projectOption), sql);
  }

  throw new OperationError("input", usage);
}

run(process.argv.slice(2)).then(
  (result) => console.log(JSON.stringify(result)),
  (error: unknown) => {
    if (error instanceof OperationError) {
      console.error(error.message);
      process.exitCode = exitCodes[error.kind];
      return;
    }
    // Anything else is a bug or an unexpected system failure; keep the stack for diagnosis.
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  },
);
