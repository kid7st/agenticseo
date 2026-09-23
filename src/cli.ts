#!/usr/bin/env node
import { resolve } from "node:path";
import { keywordMetrics } from "./dataforseo.js";
import { OperationError } from "./errors.js";
import { findProjectRoot, initProject, readContext, readProject, saveEvidence } from "./project.js";

const usage = `Usage:
  agenticseo init --domain example.com --location 2840 --language en [--project DIR]
  agenticseo context [--project DIR]
  agenticseo keywords TERM... [--project DIR]`;

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
    return readContext(await findProjectRoot(projectOption));
  }

  if (command === "keywords") {
    const keywords = [...new Set(args.map((arg) => arg.trim()).filter(Boolean))];
    if (args.some((arg) => arg.startsWith("--")) || keywords.length === 0 || keywords.length > 700) {
      throw new OperationError("input", "Provide 1–700 non-empty keyword terms");
    }
    const root = await findProjectRoot(projectOption);
    const project = await readProject(root);
    const apiKey = process.env.DATAFORSEO_API_KEY;
    if (!apiKey) throw new OperationError("credentials", "DATAFORSEO_API_KEY is required (base64 of DataForSEO login:password)");
    const fetchedAt = new Date().toISOString();
    const result = await keywordMetrics(project, keywords, apiKey);
    const evidence = await saveEvidence(root, fetchedAt, { provider: "DataForSEO", fetchedAt, project, keywords, ...result });
    return { provider: "DataForSEO", fetchedAt, project, totalRows: result.rows.length, rows: result.rows.slice(0, 10), missingKeywords: result.missingKeywords, costUsd: result.costUsd, evidence };
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
