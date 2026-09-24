import { readFileSync } from "node:fs";

// Stands in for DataForSEO in CLI tests (loaded with --import); fails loudly on anything unexpected.
const api = "https://api.dataforseo.com/v3";
const task = (items: unknown[], cost: number) => Response.json({ status_code: 20000, tasks: [{ status_code: 20000, cost, path: ["v3"], result: [{ items }] }] });

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === `${api}/backlinks/referring_domains/live`) {
    // Answers differently with and without the spam cutoff, so CLI tests can see which was sent.
    const hidesSpam = JSON.stringify(JSON.parse(String(init?.body))[0].filters ?? []).includes("backlinks_spam_score");
    return task([{ domain: hidesSpam ? "without-spam.com" : "with-spam.com" }], 0.02);
  }
  if (url === `${api}/serp/google/maps/live/advanced`) {
    return task([{ rank_absolute: 1, title: "Little Charli", cid: "1", rating: { value: 4.9 }, work_hours: { timetable: { monday: [] } }, local_justifications: [{ text: "x" }] }], 0.002);
  }
  if (url === `${api}/business_data/google/reviews/task_post`) {
    return Response.json({ status_code: 20000, tasks: [{ id: "r-1", status_code: 20100, cost: 0.0015, path: ["v3"] }] });
  }
  if (url === `${api}/business_data/google/reviews/task_get/r-1`) {
    return Response.json({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0, path: ["v3"], result: [{ items: [{ rating: { value: 1 }, review_text: "Cold", original_review_text: "Cold", review_highlights: [{ feature: "x" }] }] }] }] });
  }
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
