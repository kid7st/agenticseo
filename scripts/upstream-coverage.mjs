#!/usr/bin/env node
// Lists upstream OpenSEO modules that docs/PRODUCT.md never names, so a capability
// review starts from a mechanical list instead of memory. Output is a review queue,
// not a gate: inventory rows cite representative paths, so a module can be covered by
// a row that names a sibling file. Judge each line by hand.
// Usage: node scripts/upstream-coverage.mjs   (needs `gh` authenticated for the GitHub API)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const product = readFileSync(new URL("../docs/PRODUCT.md", import.meta.url), "utf8");
const commit = product.match(/OpenSEO commit `([0-9a-f]{40})`/)?.[1];
if (!commit) throw new Error("docs/PRODUCT.md does not pin an upstream commit");

const tree = execFileSync("gh", [
  "api",
  `repos/every-app/open-seo/git/trees/${commit}?recursive=1`,
  "--jq",
  '.tree[] | select(.type=="blob") | .path',
], { encoding: "utf8" }).split("\n").filter(Boolean);

const isSource = (path) => path.endsWith(".ts") && !/\.test\.ts$/.test(path);

// Each group names the upstream units to check and how a PRODUCT.md mention is recognised.
const groups = [
  {
    name: "MCP tools",
    units: tree.filter((p) => p.startsWith("src/server/mcp/tools/") && isSource(p)),
  },
  {
    name: "Server functions",
    units: tree.filter((p) => p.startsWith("src/serverFunctions/") && isSource(p)),
  },
  {
    name: "Feature modules",
    units: [...new Set(tree.flatMap((p) => p.match(/^src\/server\/features\/[^/]+/) ?? []))],
  },
  {
    name: "Skills",
    units: [...new Set(tree.flatMap((p) => p.match(/^plugins\/openseo\/skills\/[^/]+/) ?? []))],
    // The skills rows list directory names in prose rather than full paths.
    mention: (unit) => unit.split("/").pop(),
  },
];

let unnamed = 0;
for (const { name, units, mention = (unit) => unit.replace(/\.ts$/, "") } of groups) {
  const missing = units.filter((unit) => !product.includes(mention(unit)));
  console.log(`\n## ${name}: ${units.length - missing.length}/${units.length} named in PRODUCT.md`);
  for (const unit of missing) console.log(`  review: ${unit}`);
  unnamed += missing.length;
}

console.log(`\n${unnamed} upstream unit(s) to judge by hand against the inventory rows.`);
