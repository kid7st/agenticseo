import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OperationError } from "../src/errors.js";
import { marketForCall } from "../src/market.js";
import { runCli, withProject } from "./helpers.js";

test("init canonicalizes the domain and validates the market like OpenSEO, rejecting bad input with the input exit code", async () => {
  const root = await mkdtemp(join(tmpdir(), "agenticseo-"));
  try {
    for (const args of [
      ["init", "--domain", "my_site.com", "--location", "2840", "--language", "en"],
      ["init", "--domain", "example.por", "--location", "2840", "--language", "en"],
      ["init", "--domain", "example.com", "--location", "1"],
      ["init", "--domain", "example.com", "--location", "XX"],
      ["init", "--domain", "example.com", "--location", "US", "--language", "ru"],
      ["init", "--domain", "example.com", "--language", "en"],
      ["init", "--domain", "example.com", "--location", "2840", "--language", "en", "--extra"],
      ["unknown-command"],
    ]) {
      const result = runCli(root, args);
      assert.equal(result.status, 2, `${args.join(" ")}: ${result.stderr}`);
    }
    await assert.rejects(access(join(root, ".agenticseo")), "rejected input must not create project state");
    assert.match(runCli(root, ["init", "--domain", "example.com", "--location", "US", "--language", "ru"]).stderr, /Language 'ru' is not available for this location\. Available: en, es\./);
    assert.match(runCli(root, ["init", "--domain", "example.com", "--location", "1"]).stderr, /Unsupported location "1"/);

    const init = runCli(root, ["init", "--domain", "https://WWW.Example.com/pricing?x=1", "--location", "gb"]);
    assert.equal(init.status, 0, init.stderr);
    assert.deepEqual(JSON.parse(await readFile(join(root, ".agenticseo", "project.json"), "utf8")), { domain: "example.com", locationCode: 2826, languageCode: "en" }, "country code resolves and the language defaults to the country's");
    const again = runCli(root, ["init", "--domain", "example.com", "--location", "2840", "--language", "en"]);
    assert.equal(again.status, 2);
    assert.match(again.stderr, /already has a project/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

type ContextOutput = {
  file: string;
  today: string;
  context: {
    competitors: Array<{ domain: string }>;
    keyPages: Array<{ url: string }>;
    researchLog: Array<{ entryDate: string; summary: string }>;
  };
  researchLogOmitted: number;
  missingSections: string[];
  reportTemplates: Array<{ name: string; description: string }>;
};

function daysAgo(days: number) {
  const date = new Date(Date.now() - days * 86_400_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test("context normalizes entries, windows the research log and lists report templates", async () => {
  await withProject(async (root) => {
    const empty = runCli(root, ["context"]);
    assert.equal(empty.status, 0, empty.stderr);
    const emptyOutput = JSON.parse(empty.stdout) as ContextOutput;
    assert.deepEqual(emptyOutput.missingSections, ["business_overview", "current_goal", "positioning", "writing_preferences"]);
    assert.equal(emptyOutput.today, daysAgo(0), "today is the local calendar date");

    const file = join(root, ".agenticseo", "context.json");
    await mkdir(join(root, ".agenticseo", "templates"));
    await writeFile(join(root, ".agenticseo", "templates", "monthly.md"), "# Monthly client report\n\nOne verdict, three numbers, one action.\n");
    await writeFile(file, JSON.stringify({
      sections: { current_goal: "Rank top 10 for buying-intent audit terms by Q4." },
      competitors: [{ domain: "https://www.Rival.com/pricing", notes: "owns comparison pages" }],
      keyPages: [{ url: "http://www.example.com/pricing#plans", role: "money" }],
      customSections: { "launch-plan": { title: "Launch plan", content: "Ship docs first." } },
      researchLog: [
        ...Array.from({ length: 21 }, (_, day) => ({ entryDate: daysAgo(day), summary: `Keyword snapshot ${day}. Verdict: keep.` })),
        { entryDate: daysAgo(120), summary: "Too old to show." },
      ],
    }));
    const edited = runCli(root, ["context"]);
    assert.equal(edited.status, 0, edited.stderr);
    const output = JSON.parse(edited.stdout) as ContextOutput;
    assert.equal(output.file, await realpath(file));
    assert.deepEqual(output.context.competitors.map((entry) => entry.domain), ["rival.com"]);
    assert.deepEqual(output.context.keyPages.map((entry) => entry.url), ["https://example.com/pricing"]);
    assert.equal(output.context.researchLog.length, 20);
    assert.equal(output.context.researchLog[0].entryDate, daysAgo(0), "newest entries first");
    assert.equal(output.researchLogOmitted, 2);
    assert.deepEqual(output.missingSections, ["business_overview", "positioning", "writing_preferences"]);
    assert.deepEqual(output.reportTemplates.map(({ name, description }) => ({ name, description })), [{ name: "Monthly client report", description: "One verdict, three numbers, one action." }]);

    await writeFile(file, JSON.stringify({ researchLog: [{ entryDate: daysAgo(120), summary: "Too old to show." }, { entryDate: daysAgo(1), summary: "Recent." }] }));
    const windowed = JSON.parse(runCli(root, ["context"]).stdout) as ContextOutput;
    assert.deepEqual(windowed.context.researchLog.map((entry) => entry.summary), ["Recent."], "entries older than 90 days are not shown");
    assert.equal(windowed.researchLogOmitted, 1);
  });
});

test("context rejects invalid hand edits with the input exit code", async () => {
  await withProject(async (root) => {
    const file = join(root, ".agenticseo", "context.json");
    const customSections = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`section-${index}`, { content: "x" }]));
    for (const invalid of [
      "{ not json",
      JSON.stringify({ sections: { current_goals: "typo" } }),
      JSON.stringify({ competitors: [{ domain: "rival.com" }, { domain: "www.RIVAL.com" }] }),
      JSON.stringify({ competitors: [{ domain: "not a domain" }] }),
      JSON.stringify({ keyPages: [{ url: "https://example.com/a" }, { url: "http://www.example.com/a#top" }] }),
      JSON.stringify({ keyPages: [{ url: "https://example.com/", role: "landing" }] }),
      JSON.stringify({ customSections }),
      JSON.stringify({ researchLog: [{ entryDate: "yesterday", summary: "x" }] }),
      JSON.stringify({ researchLog: [{ entryDate: daysAgo(-1), summary: "A guessed date after today." }] }),
    ]) {
      await writeFile(file, invalid);
      const result = runCli(root, ["context"]);
      assert.equal(result.status, 2, `${invalid.slice(0, 80)}: ${result.stderr}`);
      assert.match(result.stderr, /context\.json/);
    }
  });
});

test("a market override resolves like OpenSEO's resolveMarket and is validated before any paid call", () => {
  const project = { locationCode: 2840, languageCode: "en" };
  assert.deepEqual(marketForCall(project, {}), project);
  assert.deepEqual(marketForCall(project, { location: "DE" }), { locationCode: 2276, languageCode: "de" }, "a new location snaps to its language");
  assert.deepEqual(marketForCall(project, { language: "es" }), { locationCode: 2840, languageCode: "es" });
  assert.throws(() => marketForCall(project, { language: "ru" }), (error: unknown) => error instanceof OperationError && error.kind === "input" && /Available: en, es/.test(error.message));
  assert.throws(() => marketForCall(project, { location: "Atlantis" }), /Unsupported location "Atlantis"/);
  assert.throws(() => marketForCall(project, { location: "1" }), /Unsupported location "1"/);
});

test("paid commands refuse an invalid market from project.json or the command line without calling DataForSEO", async () => {
  await withProject(async (root) => {
    const env = { DATAFORSEO_API_KEY: "TEST_KEY" };
    const override = runCli(root, ["keywords", "seo audit", "--language", "ru"], { env, mock: true });
    assert.equal(override.status, 2, override.stderr);
    assert.match(override.stderr, /Language 'ru' is not available/);

    await writeFile(join(root, ".agenticseo", "project.json"), JSON.stringify({ domain: "example.com", locationCode: 2840, languageCode: "ru" }));
    const stored = runCli(root, ["serp", "seo audit"], { env, mock: true });
    assert.equal(stored.status, 2, stored.stderr);
    assert.match(stored.stderr, /project\.json[\s\S]*languageCode/);
  });
});

test("help prints the usage and succeeds; an unknown command is an input error", async () => {
  await withProject(async (root) => {
    for (const args of [[], ["--help"], ["help"]]) {
      const help = runCli(root, args);
      assert.equal(help.status, 0, help.stderr);
      assert.match(help.stdout, /^Usage:\n {2}agenticseo init/);
    }
    assert.equal(runCli(root, ["nope"]).status, 2);
  });
});
