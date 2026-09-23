import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const tsx = import.meta.resolve("tsx");
const mockFetch = new URL("./mock-fetch.ts", import.meta.url).href;

/** Runs the CLI from source; `mock` swaps global fetch for the DataForSEO fixture. */
export function runCli(cwd: string, args: string[], { env = {}, mock = false }: { env?: Record<string, string>; mock?: boolean } = {}) {
  const imports = ["--import", tsx, ...(mock ? ["--import", mockFetch] : [])];
  return spawnSync(process.execPath, [...imports, cli, ...args], {
    cwd,
    env: { ...process.env, DATAFORSEO_API_KEY: "", ...env },
    encoding: "utf8",
  });
}

/** Runs a check inside a freshly initialized US/en project for example.com. */
export async function withProject(check: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "agenticseo-"));
  try {
    const init = runCli(root, ["init", "--domain", "https://example.com/", "--location", "2840", "--language", "en"]);
    assert.equal(init.status, 0, init.stderr);
    await check(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** Swaps global fetch (the ported client calls it directly) and records each request. */
export async function withFetch<T>(handler: Handler, run: () => Promise<T>, apiKey = "TEST_KEY") {
  const requests: Array<{ url: string; body: unknown; authorization: string | null }> = [];
  const original = globalThis.fetch;
  const originalKey = process.env.DATAFORSEO_API_KEY;
  process.env.DATAFORSEO_API_KEY = apiKey;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, body: init.body == null ? undefined : JSON.parse(String(init.body)), authorization: new Headers(init.headers).get("Authorization") });
    return handler(url, init);
  };
  try {
    return { result: await run(), requests };
  } finally {
    globalThis.fetch = original;
    process.env.DATAFORSEO_API_KEY = originalKey;
  }
}
