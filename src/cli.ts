#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { keywordMetrics } from "./dataforseo.js";

const projectSchema = z.object({
  domain: z.string().min(1),
  locationCode: z.number().int().positive(),
  languageCode: z.string().regex(/^[a-z]{2}$/),
});

function option(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

async function projectRoot(explicit?: string): Promise<string> {
  if (explicit) return resolve(explicit);
  let current = process.cwd();
  while (true) {
    try {
      await readFile(join(current, ".agenticseo", "project.json"));
      return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(current);
    if (parent === current) throw new Error("No AgenticSEO project found; run 'agenticseo init' or pass --project");
    current = parent;
  }
}

async function ensureEvidenceDirectory(directory: string) {
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(join(directory, ".gitignore"), "*\n!.gitignore\n", { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "init" && command !== "keywords") {
    throw new Error("Usage: agenticseo init --domain example.com --location 2840 --language en [--project DIR] | agenticseo keywords TERM... [--project DIR]");
  }
  const root = command === "init" ? resolve(option(args, "--project") ?? process.cwd()) : await projectRoot(option(args, "--project"));
  const directory = join(root, ".agenticseo");

  if (command === "init") {
    const domainInput = option(args, "--domain");
    const locationCode = Number(option(args, "--location"));
    const languageCode = option(args, "--language");
    if (!domainInput || args.length) throw new Error("Provide --domain, --location and --language; no other arguments are accepted");
    const url = new URL(domainInput.includes("://") ? domainInput : `https://${domainInput}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("--domain must be a hostname, not a URL path or credential");
    }
    const project = projectSchema.parse({ domain: url.hostname, locationCode, languageCode });
    await ensureEvidenceDirectory(join(directory, "evidence"));
    await writeFile(join(directory, "project.json"), `${JSON.stringify(project, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ project: root, ...project }));
    return;
  }

  if (args.length === 0 || args.some((arg) => arg.startsWith("--"))) throw new Error("Provide one or more keyword terms");
  const apiKey = process.env.DATAFORSEO_API_KEY;
  if (!apiKey) throw new Error("DATAFORSEO_API_KEY is required (base64 of DataForSEO login:password)");
  const project = projectSchema.parse(JSON.parse(await readFile(join(directory, "project.json"), "utf8")));
  const keywords = [...new Set(args.map((arg) => arg.trim()).filter(Boolean))];
  if (keywords.length === 0 || keywords.length > 700) throw new Error("Provide 1–700 non-empty keywords");
  const evidenceDirectory = join(directory, "evidence");
  await ensureEvidenceDirectory(evidenceDirectory);
  const fetchedAt = new Date().toISOString();
  const result = await keywordMetrics(project, keywords, apiKey);
  const evidence = join(evidenceDirectory, `${fetchedAt.replaceAll(":", "-")}-${randomUUID()}.json`);
  const temporary = `${evidence}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ provider: "DataForSEO", fetchedAt, project, keywords, ...result }, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, evidence);
  console.log(JSON.stringify({ provider: "DataForSEO", fetchedAt, project, totalRows: result.rows.length, rows: result.rows.slice(0, 10), missingKeywords: result.missingKeywords, costUsd: result.costUsd, evidence }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
