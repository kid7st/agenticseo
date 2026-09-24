import { z } from "zod";
import { OperationError } from "./errors.js";
import { getBrandLookup } from "./openseo/ai-search/services/brandLookup.js";
import { explorePrompt } from "./openseo/ai-search/services/promptExplorer.js";
import { createFileCache } from "./openseo/cache.js";
import { createDataforseoClient, ledgerCost, type ProviderCall } from "./openseo/dataforseo/client.js";
import { brandLookupInputSchema, promptExplorerInputSchema } from "./openseo/schemas/ai-search.js";
import type { Market } from "./market.js";

/** OpenSEO's input schemas, with the project implied by the working directory. */
function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new OperationError("input", z.prettifyError(parsed.error));
  return parsed.data;
}

/**
 * OpenSEO's Brand Lookup: LLM mentions of a brand or domain on ChatGPT (US/en
 * only, as DataForSEO provides it) and Google AI Overview, with share of voice
 * against competitors. Cached a day when every call succeeded.
 */
export async function brandLookup(market: Market, input: { query: string; competitors?: string[]; scope?: string; cacheDirectory: string }) {
  const parsed = parse(brandLookupInputSchema, { projectId: "local", query: input.query, competitors: input.competitors, scope: input.scope, ...market });
  const calls: ProviderCall[] = [];
  const failures: string[] = [];
  const result = await getBrandLookup(parsed, { dataforseo: createDataforseoClient(calls), cache: createFileCache(input.cacheDirectory), failures });
  return { ...result, failedCalls: failures, cached: calls.length === 0, costUsd: ledgerCost(calls), calls };
}

/** OpenSEO's Prompt Explorer: one prompt across up to four models, each answer cached for a week. */
export async function promptLookup(input: {
  prompt: string;
  models: string[];
  highlightBrand?: string;
  webSearch: boolean;
  webSearchCountryCode?: string;
  cacheDirectory: string;
}) {
  const parsed = parse(promptExplorerInputSchema, { projectId: "local", ...input });
  const calls: ProviderCall[] = [];
  const result = await explorePrompt(parsed, { dataforseo: createDataforseoClient(calls), cache: createFileCache(input.cacheDirectory) });
  return { ...result, costUsd: ledgerCost(calls), calls };
}
