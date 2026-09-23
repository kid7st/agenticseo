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
