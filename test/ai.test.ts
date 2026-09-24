import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { brandLookup, promptLookup } from "../src/ai.js";
import { OperationError } from "../src/errors.js";
import { withFetch } from "./helpers.js";

const api = "https://api.dataforseo.com/v3/ai_optimization";
const us = { locationCode: 2840, languageCode: "en" };
const ok = (result: unknown, cost = 0.1) => Response.json({ status_code: 20000, tasks: [{ status_code: 20000, cost, path: ["v3", "ai_optimization"], result: [result] }] });

async function withCache(run: (cacheDirectory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "agenticseo-ai-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** The LLM Mentions endpoints for one brand; `fail` answers one path with an HTTP error. */
function mentionsHandler(fail?: { path: string; status: number; body?: string }) {
  return (url: string, init: RequestInit) => {
    const path = url.slice(api.length);
    if (fail && path === fail.path) return new Response(fail.body ?? "error", { status: fail.status });
    const [task] = JSON.parse(String(init.body)) as Array<{ platform: string; targets?: unknown[] }>;
    const platform = task.platform;
    if (path === "/llm_mentions/aggregated_metrics/live") {
      return ok({ total: { platform: [{ type: "group_element", key: platform, mentions: platform === "chat_gpt" ? 27 : 6, ai_search_volume: 400 }] } });
    }
    if (path === "/llm_mentions/top_pages/live") {
      return ok({ items: [{ key: "https://kua.ai/blog/fnsku", platform: [{ key: platform, mentions: 3, ai_search_volume: 90 }] }] });
    }
    if (path === "/llm_mentions/search/live") {
      return ok({
        items: [
          {
            question: `how to print fnsku labels (${platform})`,
            ai_search_volume: 50,
            sources: [{ url: "https://kua.ai/blog/fnsku", domain: "kua.ai", title: "FNSKU" }],
            monthly_searches: [{ year: 2026, month: 8, search_volume: 50 }],
          },
        ],
      });
    }
    if (path === "/llm_mentions/cross_aggregated_metrics/live") {
      return ok({
        items: [
          { key: "kua.ai", platform: [{ key: platform, mentions: 10 }] },
          { key: "helium10.com", platform: [{ key: platform, mentions: 30 }] },
        ],
      });
    }
    throw new Error(`Unexpected DataForSEO path ${path}`);
  };
}

describe("AI brand lookup", () => {
  it("combines ChatGPT and Google AI Overview, computes share of voice, and caches a complete result", async () => {
    await withCache(async (cacheDirectory) => {
      const { result, requests } = await withFetch(mentionsHandler(), () => brandLookup(us, { query: "kua.ai", competitors: ["helium10.com"], cacheDirectory }));
      assert.equal(requests.length, 8, "three calls per platform plus one share-of-voice call per platform");
      const chatgpt = requests.find((request) => (request.body as Array<{ platform: string }>)[0].platform === "chat_gpt")?.body as Array<Record<string, unknown>>;
      assert.deepEqual([chatgpt[0].location_code, chatgpt[0].language_code], [2840, "en"]);
      assert.deepEqual(result.perPlatform.map((platform) => [platform.platform, platform.mentions]), [
        ["chat_gpt", 27],
        ["google", 6],
      ]);
      assert.equal(result.totalMentions, 33);
      assert.deepEqual(result.shareOfVoice?.entries.map((entry) => [entry.label, entry.mentions, entry.sharePct]), [
        ["helium10.com", 60, 75],
        ["kua.ai", 20, 25],
      ]);
      assert.deepEqual(result.failedCalls, []);
      assert.equal(result.costUsd, 0.8);

      const again = await withFetch(() => Response.error(), () => brandLookup(us, { query: "KUA.ai", competitors: ["helium10.com"], cacheDirectory }));
      assert.equal(again.requests.length, 0);
      assert.deepEqual([again.result.cached, again.result.costUsd], [true, 0]);
    });
  });

  it("names a failed sub-call and does not cache the incomplete result", async () => {
    await withCache(async (cacheDirectory) => {
      const handler = mentionsHandler({ path: "/llm_mentions/top_pages/live", status: 500 });
      const { result } = await withFetch(handler, () => brandLookup(us, { query: "kua.ai", cacheDirectory }));
      assert.equal(result.failedCalls.length, 2);
      assert.match(result.failedCalls[0], /^chat_gpt topPages: DataForSEO HTTP 500/);
      const again = await withFetch(mentionsHandler(), () => brandLookup(us, { query: "kua.ai", cacheDirectory }));
      assert.ok(again.requests.length > 0, "an incomplete result is fetched again");
    });
  });

  it("stops on a rejected key or an unpaid account instead of returning empty platforms", async () => {
    await withCache(async (cacheDirectory) => {
      await withFetch(
        () => new Response("Unauthorized", { status: 401 }),
        () => assert.rejects(brandLookup(us, { query: "kua.ai", cacheDirectory }), (error: unknown) => error instanceof OperationError && error.kind === "credentials"),
      );
      await withFetch(
        () => Response.json({ status_code: 40200, status_message: "Payment Required. Insufficient funds." }),
        () => assert.rejects(brandLookup(us, { query: "kua.ai", cacheDirectory }), { code: "AI_SEARCH_BILLING_ISSUE", kind: "provider" }),
      );
    });
  });
});

describe("AI prompt explorer", () => {
  const answer = (model: string, text: string) =>
    ok(
      {
        model_name: model,
        output_tokens: 120,
        web_search: true,
        items: [{ type: "message", sections: [{ type: "text", text, annotations: [{ title: "Kua", url: "https://kua.ai/" }, { url: "javascript:alert(1)" }] }] }],
        fan_out_queries: ["best amazon listing tool"],
      },
      0.02,
    );

  it("asks each model, keeps a failing model's reason, highlights the brand and caches answers", async () => {
    await withCache(async (cacheDirectory) => {
      const handler = (url: string) => {
        if (url === `${api}/chat_gpt/llm_responses/live`) return answer("gpt-5", "Try Kua.ai for listings.");
        if (url === `${api}/claude/llm_responses/live`) return Response.json({ status_code: 20000, tasks: [{ status_code: 40000, status_message: "Model overloaded.", cost: 0, path: ["v3"] }] });
        throw new Error(`Unexpected ${url}`);
      };
      const input = { prompt: "Best AI tool for Amazon listings?", models: ["chat_gpt", "claude"], webSearch: true, cacheDirectory };
      const { result } = await withFetch(handler, () => promptLookup({ ...input, highlightBrand: "kua" }));
      const [chatgpt, claude] = result.results;
      assert.ok(chatgpt.status === "success");
      assert.equal(chatgpt.brandMentioned, true);
      assert.deepEqual(chatgpt.citations.map((citation) => [citation.url, citation.matchedBrand]), [["https://kua.ai/", true]], "unsafe links are dropped");
      assert.ok(claude.status === "error");
      assert.match(claude.message, /Model overloaded/, "the provider's reason is shown");

      const again = await withFetch((url) => (url.includes("/claude/") ? handler(url) : Response.error()), () => promptLookup({ ...input, highlightBrand: "semrush" }));
      assert.deepEqual(again.requests.map((request) => request.url), [`${api}/claude/llm_responses/live`], "the cached answer is reused, the failed one retried");
      assert.equal(again.result.results[0].status === "success" && again.result.results[0].brandMentioned, false, "the brand highlight is applied to the cached answer");
    });
  });

  it("stops every model on a rejected key and rejects unknown models", async () => {
    await withCache(async (cacheDirectory) => {
      await withFetch(
        () => new Response("Unauthorized", { status: 401 }),
        () => assert.rejects(promptLookup({ prompt: "x", models: ["gemini"], webSearch: true, cacheDirectory }), (error: unknown) => error instanceof OperationError && error.kind === "credentials"),
      );
      await assert.rejects(promptLookup({ prompt: "x", models: ["grok"], webSearch: true, cacheDirectory }), (error: unknown) => error instanceof OperationError && error.kind === "input");
    });
  });
});
