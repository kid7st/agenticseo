import { z } from "zod";

const endpoint = "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live";

const itemSchema = z.object({
  keyword: z.string().nullable().optional(),
  keyword_info: z.object({
    search_volume: z.number().nullable().optional(),
    cpc: z.number().nullable().optional(),
  }).nullable().optional(),
  keyword_properties: z.object({
    keyword_difficulty: z.number().nullable().optional(),
  }).nullable().optional(),
  search_intent_info: z.object({
    main_intent: z.string().nullable().optional(),
  }).nullable().optional(),
});

const responseSchema = z.object({
  status_code: z.number(),
  status_message: z.string().optional(),
  tasks: z.array(z.object({
    status_code: z.number(),
    status_message: z.string().optional(),
    cost: z.number().optional(),
    path: z.array(z.string()).optional(),
    result: z.array(z.object({ items: z.array(itemSchema).nullable().optional() })).nullable().optional(),
  })).optional(),
});

export type Project = { domain: string; locationCode: number; languageCode: string };

export async function keywordMetrics(
  project: Project,
  keywords: string[],
  apiKey: string,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([{ keywords, location_code: project.locationCode, language_code: project.languageCode, include_clickstream_data: false }]),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`DataForSEO HTTP ${response.status}`);

  const raw: unknown = await response.json();
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Unexpected DataForSEO keyword overview response shape");
  const body = parsed.data;
  if (body.status_code !== 20000) throw new Error(`DataForSEO ${body.status_code}: ${body.status_message ?? "request failed"}`);
  const task = body.tasks?.[0];
  if (!task) throw new Error("DataForSEO response missing task");
  if (task.status_code !== 20000) throw new Error(`DataForSEO task ${task.status_code}: ${task.status_message ?? "failed"}${task.cost != null ? ` (charged $${task.cost})` : ""}`);
  if (task.cost == null || !task.path) throw new Error("DataForSEO task missing cost/path");

  const rows = (task.result?.[0]?.items ?? [])
    .filter((item) => item.keyword != null)
    .map((item) => ({
      keyword: item.keyword!,
      searchVolume: item.keyword_info?.search_volume ?? null,
      difficulty: item.keyword_properties?.keyword_difficulty ?? null,
      cpc: item.keyword_info?.cpc ?? null,
      intent: item.search_intent_info?.main_intent ?? null,
    }));
  const returned = new Set(rows.map((row) => row.keyword.toLowerCase()));
  return {
    rows,
    missingKeywords: keywords.filter((keyword) => !returned.has(keyword.toLowerCase())),
    costUsd: task.cost,
    raw,
  };
}
