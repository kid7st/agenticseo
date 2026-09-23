import { readFileSync } from "node:fs";

globalThis.fetch = async (input, init) => {
  const request = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
  if (String(input) !== "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live" || init?.method !== "POST" || request[0]?.location_code !== 2840) {
    throw new Error("Unexpected DataForSEO request");
  }
  return new Response(readFileSync(new URL("./keyword-overview.json", import.meta.url)), {
    headers: { "Content-Type": "application/json" },
  });
};
