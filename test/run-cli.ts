import { spawnSync } from "node:child_process";
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
