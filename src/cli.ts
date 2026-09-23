#!/usr/bin/env node
import { resolve } from "node:path";
import { OperationError } from "./errors.js";
import { keywordMetrics, researchKeywords, serpResults } from "./keywords.js";
import { cacheDirectory, findProjectRoot, initProject, readContext, readProject, saveEvidence } from "./project.js";
import { listReports, listTemplates } from "./reports.js";

const usage = `Usage:
  agenticseo init --domain example.com --location 2840 --language en [--project DIR]
  agenticseo context [--project DIR]
  agenticseo reports [--project DIR]
  agenticseo keywords TERM... [--clickstream] [--project DIR]
  agenticseo research "SEED" [--limit 150|300|500] [--clickstream] [--project DIR]
  agenticseo serp "QUERY" [--depth 10-100] [--project DIR]`;

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

  if (command === "init") {
    const domain = option(args, "--domain");
    const locationCode = Number(option(args, "--location"));
    const languageCode = option(args, "--language");
    rejectUnknown(args);
    return initProject(resolve(projectOption ?? process.cwd()), { domain, locationCode, languageCode });
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
    const keywords = [...new Set(args.map((arg) => arg.trim()).filter(Boolean))];
    if (args.some((arg) => arg.startsWith("--")) || keywords.length === 0 || keywords.length > 700) {
      throw new OperationError("input", "Provide 1–700 non-empty keyword terms");
    }
    const root = await findProjectRoot(projectOption);
    const project = await readProject(root);
    const fetchedAt = new Date().toISOString();
    const result = await keywordMetrics(project, keywords, { includeClickstreamData });
    const evidence = await saveEvidence(root, fetchedAt, { provider: "DataForSEO", fetchedAt, project, keywords, includeClickstreamData, ...result });
    return {
      provider: "DataForSEO",
      source: result.source,
      fetchedAt,
      project,
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
    const seed = singlePhrase(args, "seed keyword");
    const root = await findProjectRoot(projectOption);
    const project = await readProject(root);
    const fetchedAt = new Date().toISOString();
    const result = await researchKeywords(project, seed, { resultLimit: limit, clickstream, cacheDirectory: await cacheDirectory(root) });
    const evidence = await saveEvidence(root, fetchedAt, { provider: "DataForSEO", fetchedAt, project, seed, resultLimit: limit, clickstream, ...result });
    return {
      provider: "DataForSEO",
      source: result.source,
      usedFallback: result.usedFallback,
      cached: result.cached,
      fetchedAt,
      project,
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
    const query = singlePhrase(args, "search query");
    const root = await findProjectRoot(projectOption);
    const project = await readProject(root);
    const fetchedAt = new Date().toISOString();
    const result = await serpResults(project, query, depth);
    const evidence = await saveEvidence(root, fetchedAt, { provider: "DataForSEO", fetchedAt, project, query, depth, ...result });
    return { provider: "DataForSEO", fetchedAt, project, query, depth, totalItems: result.items.length, items: result.items, costUsd: result.costUsd, evidence };
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
