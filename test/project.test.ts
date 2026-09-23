import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli, withProject } from "./helpers.js";

test("init canonicalizes the domain like OpenSEO and rejects bad input with the input exit code", async () => {
  const root = await mkdtemp(join(tmpdir(), "agenticseo-"));
  try {
    for (const args of [
      ["init", "--domain", "my_site.com", "--location", "2840", "--language", "en"],
      ["init", "--domain", "example.por", "--location", "2840", "--language", "en"],
      ["init", "--domain", "example.com", "--location", "US", "--language", "en"],
      ["init", "--domain", "example.com", "--location", "2840", "--language", "en", "--extra"],
      ["unknown-command"],
    ]) {
      const result = runCli(root, args);
      assert.equal(result.status, 2, `${args.join(" ")}: ${result.stderr}`);
    }
    await assert.rejects(access(join(root, ".agenticseo")), "rejected input must not create project state");

    const init = runCli(root, ["init", "--domain", "https://WWW.Example.com/pricing?x=1", "--location", "2840", "--language", "en"]);
    assert.equal(init.status, 0, init.stderr);
    assert.equal(JSON.parse(await readFile(join(root, ".agenticseo", "project.json"), "utf8")).domain, "example.com");
    const again = runCli(root, ["init", "--domain", "example.com", "--location", "2840", "--language", "en"]);
    assert.equal(again.status, 2);
    assert.match(again.stderr, /already has a project/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

type ContextOutput = {
  file: string;
  context: {
    competitors: Array<{ domain: string }>;
    keyPages: Array<{ url: string }>;
    researchLog: Array<{ entryDate: string; summary: string }>;
  };
  researchLogOmitted: number;
  missingSections: string[];
  reportTemplates: Array<{ name: string; description: string }>;
};

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

test("context normalizes entries, windows the research log and lists report templates", async () => {
  await withProject(async (root) => {
    const empty = runCli(root, ["context"]);
    assert.equal(empty.status, 0, empty.stderr);
    assert.deepEqual((JSON.parse(empty.stdout) as ContextOutput).missingSections, ["business_overview", "current_goal", "positioning", "writing_preferences"]);

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
    ]) {
      await writeFile(file, invalid);
      const result = runCli(root, ["context"]);
      assert.equal(result.status, 2, `${invalid.slice(0, 80)}: ${result.stderr}`);
      assert.match(result.stderr, /context\.json/);
    }
  });
});
