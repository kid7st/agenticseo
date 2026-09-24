#!/usr/bin/env node
// Live end-to-end check: runs every command against real providers in a fresh temporary
// project, reads back each mutation and checks each export. It spends money (about $1.20
// with every section on 2026-09-24) and needs real accounts, so it is a manual release check,
// not part of `npm run check`.
//
// Usage: npm run build && LIVE_DOMAIN=example.com LIVE_SEEDS="seed one,seed two" node scripts/live-check.mjs
//   DATAFORSEO_API_KEY               required
//   AHREFS_API_KEY                   optional: Domain Rating
//   LIVE_GSC_SITE, LIVE_GA4_PROPERTY optional: Search Console and GA4 (after `agenticseo google connect`)
//   LIVE_LOCAL_CID, LIVE_LOCAL_NEAR (LAT,LNG), LIVE_LOCAL_QUERY  optional: local SEO
// Exits 1 when any command or check fails.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/src/cli.js", import.meta.url));
const env = process.env;
if (!env.DATAFORSEO_API_KEY || !env.LIVE_DOMAIN || !env.LIVE_SEEDS) {
  console.error("Set DATAFORSEO_API_KEY, LIVE_DOMAIN and LIVE_SEEDS; see the header of this file.");
  process.exit(2);
}
const domain = env.LIVE_DOMAIN;
const [seed, seed2 = seed] = env.LIVE_SEEDS.split(",").map((value) => value.trim());
const root = mkdtempSync(join(tmpdir(), "agenticseo-live-"));
let failures = 0;
let spent = 0;

function run(args, expect = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {}
  // `rank estimate` reports a projected cost, not a charge.
  const charged = args[1] !== "estimate" && typeof json?.costUsd === "number" ? json.costUsd : 0;
  spent += charged + (json?.backlinksRefresh?.costUsd ?? 0);
  const ok = result.status === expect;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} [${result.status}] ${result.stdout.length}B agenticseo ${args.join(" ")}`);
  if (!ok) console.log(`     ${result.stderr.trim().slice(0, 500)}`);
  return json;
}
function check(label, condition) {
  if (!condition) failures++;
  console.log(`${condition ? "  ✓" : "  ✗"} ${label}`);
}
const contextFile = join(root, ".agenticseo", "context.json");
const writeContext = (context) => writeFileSync(contextFile, JSON.stringify(context));

// Project and context
run(["init", "--domain", domain, "--location", "US"]);
writeContext({ sections: { business_overview: "Live check." }, competitors: [{ domain: `https://www.${domain}/` }], keyPages: [], researchLog: [] });
const context = run(["context"]);
check("context canonicalizes a competitor domain", context?.context.competitors[0].domain === domain);
writeContext({ ...context.context, researchLog: [{ entryDate: context.today, summary: "Live check. Verdict: ok" }] });
check("a research log entry reads back", run(["context"])?.context.researchLog.length === 1);
writeContext({ ...context.context, researchLog: [{ entryDate: "2999-01-01", summary: "future" }] });
run(["context"], 2);
writeContext(context.context);

// Keywords, research, SERP
const metrics = run(["keywords", seed, seed2, "zzqx not a keyword"]);
check("keywords returns metrics and lists missing terms", metrics?.rows.length >= 1 && metrics.missingKeywords.includes("zzqx not a keyword"));
check("research runs each seed", run(["research", seed, seed2])?.results.every((result) => result.ok));
check("a repeated research is cached and free", run(["research", seed, seed2])?.costUsd === 0);
run(["research", seed, "--mode", "ideas"]);
check("serp runs each query", run(["serp", seed, seed2])?.results.every((result) => result.ok));

// Saved keywords
run(["saved", "add", seed, seed2, "--tags", "live,check"]);
let saved = run(["saved", "list", "--tags", "live"]);
check("saved keywords read back with stored metrics", saved?.rows.length === 2 && saved.rows.some((row) => row.searchVolume !== null));
const [first, second] = saved.rows.map((row) => row.id);
run(["saved", "tag", first, "--add", "priority"]);
run(["saved", "rename-tag", "live", "--to", "live-renamed"]);
check("tags read back", run(["saved", "list", "--tags", "live-renamed,priority"])?.rows.length >= 1);
const savedExport = run(["saved", "export"]);
check("saved export has a header and rows", savedExport && readFileSync(savedExport.file, "utf8").trim().split("\n").length === 3);
run(["saved", "refresh"]);
run(["saved", "remove", second]);
run(["saved", "delete-tag", "priority"], 2);
run(["saved", "tag", first, "--remove", "priority"]);
run(["saved", "delete-tag", "priority"]);
saved = run(["saved", "list"]);
check("removal and tag deletion read back", saved?.rows.length === 1 && !JSON.stringify(saved).includes('"priority"'));

// Domain research and backlinks
run(["domain", domain]);
check("ranked returns a total count", typeof run(["ranked", domain, "--limit", "5"])?.totalCount === "number");
run(["domain-keywords", domain, "--max-difficulty", "40", "--page-size", "50"]);
run(["pages", domain, "--page-size", "50"]);
run(["competitors", seed, seed2, "--exclude-domains", domain, "--limit", "10"]);
for (const view of ["overview", "links", "domains", "pages"]) run(["backlinks", view, domain, ...(view === "overview" ? [] : ["--page-size", "50"])]);
if (env.AHREFS_API_KEY) check("Domain Rating returns a rating", typeof run(["domain-rating", domain])?.ratings[domain] === "number");

// Local SEO
if (env.LIVE_LOCAL_CID && env.LIVE_LOCAL_NEAR && env.LIVE_LOCAL_QUERY) {
  const [cid, near, query] = [env.LIVE_LOCAL_CID, env.LIVE_LOCAL_NEAR, env.LIVE_LOCAL_QUERY];
  run(["local", "categories", query, "--limit", "5"]);
  run(["local", "businesses", "--near", near, "--radius", "1", "--query", query, "--limit", "5"]);
  run(["local", "serp", query, "--near", near]);
  run(["local", "profile", "--cid", cid]);
  run(["local", "questions", "--cid", cid, "--near", near, "--radius", "1"]);
  for (const kind of ["reviews", "posts"]) {
    const posted = run(["local", kind, "--cid", cid]);
    if (posted?.status === "processing") {
      await new Promise((resolve) => setTimeout(resolve, 45_000));
      check(`${kind} are collected by task id at no cost`, run(["local", kind, "--task-id", posted.taskId])?.costUsd === 0);
    }
  }
  check("the rank grid has nine points", run(["local", "grid", query, "--center", near, "--cid", cid])?.grid?.length === 9);
}

// AI visibility
run(["ai", "brand", domain]);
run(["ai", "prompt", `What is ${seed}?`, "--models", "chat_gpt"]);

// Rank tracking
run(["rank", "locations", "Seattle", "--location", "US"]);
const tracker = run(["rank", "create", domain, "--devices", "both", "--depth", "10"])?.config.id;
run(["rank", "add", tracker, seed, seed2]);
run(["rank", "estimate", tracker]);
run(["rank", "run", tracker]);
const shown = run(["rank", "show", tracker]);
check("a rank run reads back", shown?.keywords.length === 2 && shown.latestRun?.status === "completed");
run(["rank", "history", tracker, shown.keywords[0].trackingKeywordId]);
run(["rank", "trend", tracker, "--device", "desktop"]);
run(["rank", "matrix", tracker, "--device", "mobile"]);
run(["rank", "metrics", tracker]);
run(["rank", "update", tracker, "--schedule", "weekly"]);
run(["rank", "schedule"]);
run(["rank", "remove", tracker, shown.keywords[1].trackingKeywordId]);
run(["rank", "archive", tracker]);
check("an archived tracker leaves the list", run(["rank", "list"])?.trackers.length === 0);

// Site audit with Lighthouse
const audit = run(["audit", "start", `https://${domain}/`, "--max-pages", "10", "--lighthouse", "--wait"])?.id;
check("the audit completed", run(["audit", "status", audit])?.status === "completed");
run(["audit", "issues", audit, "--limit", "20"]);
run(["audit", "pages", audit, "--limit", "20"]);
const lighthouse = run(["audit", "lighthouse", audit])?.results.find((result) => !result.error)?.resultId;
run(["audit", "lighthouse", audit, "--result", lighthouse, "--category", "seo"]);
for (const table of ["issues", "pages", "performance"]) {
  const exported = run(["audit", "export", audit, "--table", table]);
  check(`the ${table} export exists`, exported && existsSync(exported.file));
}
run(["audit", "export", audit, "--table", "lighthouse", "--result", lighthouse, "--full"]);

// Search Console and GA4
if (env.LIVE_GSC_SITE) {
  run(["gsc", "sites"]);
  run(["gsc", "use", env.LIVE_GSC_SITE]);
  run(["gsc", "performance", "--dimensions", "query", "--limit", "5"]);
  run(["gsc", "report"]);
  run(["gsc", "export", "--dimension", "page"]);
  run(["gsc", "inspect", `https://${domain}/`]);
}
if (env.LIVE_GA4_PROPERTY) {
  run(["ga4", "properties"]);
  run(["ga4", "use", env.LIVE_GA4_PROPERTY]);
  for (const report of ["landing-pages", "page-performance", "key-events", "traffic-acquisition", "ecommerce", "site-search", "audience"]) run(["ga4", "report", report, "--limit", "5"]);
  run(["ga4", "overview"]);
  run(["ga4", "health"]);
  if (env.LIVE_GSC_SITE) run(["ga4", "opportunities", "--limit", "5"]);
}

// Dashboard, reports, SQL, cleanup
const overview = run(["overview", "--refresh-backlinks"]);
check("the overview shows the audit and a backlink snapshot", overview?.audit?.id === audit && typeof overview.backlinks.backlinks === "number");
mkdirSync(join(root, ".agenticseo", "reports"), { recursive: true });
writeFileSync(join(root, ".agenticseo", "reports", "live.md"), "# Live check\n\nEvery command ran.\n\n## Detail\n\nok\n");
writeFileSync(join(root, ".agenticseo", "reports", "live.html"), "<!doctype html><html><body><h1>Live check</h1></body></html>");
check("reports index the report with its HTML", run(["reports"])?.reports[0]?.html);
run(["query", "SELECT COUNT(*) AS n FROM saved_keywords"]);
if (env.LIVE_GSC_SITE) run(["gsc", "disconnect"]);
if (env.LIVE_GA4_PROPERTY) run(["ga4", "disconnect"]);
run(["audit", "delete", audit]);
check("audit deletion reads back", run(["audit", "list"])?.audits.length === 0);

console.log(`\n${failures === 0 ? "All passed" : `${failures} failed`}; provider charges about $${spent.toFixed(2)}; project kept at ${root}`);
process.exitCode = failures === 0 ? 0 : 1;
