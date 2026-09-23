#!/usr/bin/env node
import { resolve } from "node:path";
import { OperationError } from "./errors.js";
import { domainOverview, rankedKeywords, serpCompetitors } from "./domain.js";
import { keywordMetrics, researchKeywords, serpResults } from "./keywords.js";
import { marketForCall, marketForNewProject } from "./market.js";
import { RESEARCH_SCOPES, type ResearchScope } from "./openseo/researchScope.js";
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
  agenticseo competitors KEYWORD... [--types TYPE,...] [--exclude-domains DOMAIN,...]
      [--include-subdomains] [--sort visibility|traffic_estimate|avg_position|keyword_count]
      [--limit 1-100] [--offset 0-1000] [MARKET] [--project DIR]
MARKET overrides the project's market for one call: --location US|2840 [--language en]
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
    const result = await researchKeywords(market, seed, { resultLimit: limit, clickstream, cacheDirectory: await cacheDirectory(root) });
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
