import { readFileSync } from "node:fs";

// Stands in for DataForSEO in CLI tests (loaded with --import); fails loudly on anything unexpected.
const api = "https://api.dataforseo.com/v3";
const task = (items: unknown[], cost: number) => Response.json({ status_code: 20000, tasks: [{ status_code: 20000, cost, path: ["v3"], result: [{ items }] }] });

globalThis.fetch = async (input, init) => {
  const url = String(input);
  const request = JSON.parse(String(init?.body)) as Array<{ keywords?: string[]; location_code?: number }>;
  if (init?.method !== "POST" || request[0]?.location_code !== 2840) throw new Error("Unexpected DataForSEO request");

  if (url === `${api}/dataforseo_labs/google/keyword_overview/live`) {
    // Lets CLI tests exercise the provider-failure exit code without a network.
    if (request[0].keywords?.includes("provider outage")) return new Response("upstream unavailable", { status: 502 });
    return new Response(readFileSync(new URL("./keyword-overview.json", import.meta.url)), { headers: { "Content-Type": "application/json" } });
  }
  if (url === `${api}/dataforseo_labs/google/related_keywords/live`) {
    const keywords = ["seo audit", "seo audit tool", "free seo audit", "seo audit checklist", "website seo audit", "seo audit report"];
    return task(keywords.map((keyword) => ({ keyword_data: { keyword, keyword_info: { search_volume: 100 } } })), 0.02);
  }
  if (url === `${api}/serp/google/organic/live/advanced`) {
    return task([{ type: "organic", rank_absolute: 1, rank_group: 1, domain: "a.com", title: "A", url: "https://a.com/", description: "First" }], 0.004);
  }
  throw new Error(`Unexpected DataForSEO endpoint ${url}`);
};
