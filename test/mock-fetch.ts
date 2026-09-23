import { readFileSync } from "node:fs";

globalThis.fetch = async (input, init) => {
  const request = JSON.parse(String(init?.body)) as Array<{ keywords?: string[]; location_code?: number }>;
  if (String(input) !== "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live" || init?.method !== "POST" || request[0]?.location_code !== 2840) {
    throw new Error("Unexpected DataForSEO request");
  }
  // Lets CLI tests exercise the provider-failure exit code without a network.
  if (request[0].keywords?.includes("provider outage")) return new Response("upstream unavailable", { status: 502 });
  return new Response(readFileSync(new URL("./keyword-overview.json", import.meta.url)), {
    headers: { "Content-Type": "application/json" },
  });
};
